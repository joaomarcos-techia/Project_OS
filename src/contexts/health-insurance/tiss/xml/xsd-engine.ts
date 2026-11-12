/**
 * Motor de validação XSD do Qoro (P9.2): libxml2 compilada para WebAssembly
 * (`xmllint-wasm` 5.3.0, decisão D7), rodando DENTRO do app. Nenhum programa externo,
 * site de terceiro ou passo manual valida XML do Qoro.
 *
 * Driver próprio sobre o worker do pacote, em vez do `validateXML` dele, porque:
 *  - TIMEOUT de verdade: o `validateXML` não aceita cancelamento; aqui o worker é
 *    encerrado (`terminate`) quando o prazo estoura, e isso conta como FALHA do validador
 *    (nunca como "válido").
 *  - MEMÓRIA limitada duas vezes: teto da memória do WebAssembly (páginas de 64 KiB) e do
 *    heap JS do worker (`resourceLimits`). Estouro = falha, nunca "válido".
 *  - CONCORRÊNCIA limitada por processo: até N validações simultâneas, as demais esperam
 *    numa fila com teto; fila cheia = `busy` (o chamador tenta de novo depois).
 *  - INTEGRIDADE do que roda: versão do pacote e SHA-256 do `xmllint.wasm` e do worker
 *    conferidos contra os valores fixados aqui; cada XSD conferido contra o `MANIFEST.json`
 *    oficial. Divergência = validador indisponível (fail closed).
 *  - ENTRADA HOSTIL barrada antes do parser (`envelope-check`): sem DTD/entidade, sem
 *    XInclude, tamanho máximo, raiz e namespace oficiais, versão do padrão. O libxml2
 *    roda ainda com `--nonet` e sem `--noent` (entidades nunca são substituídas).
 *  - SAÍDA sem dado pessoal: só as linhas de diagnóstico do libxml2, com os valores
 *    citados mascarados (o trecho do arquivo que o parser ecoa é descartado).
 */
import 'server-only';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

import { checkTissEnvelope } from './envelope-check';

/** Pacote aprovado na D7. Trocar de versão exige rever estes três valores conscientemente. */
export const XMLLINT_PIN = {
  version: '5.3.0',
  wasmSha256: '4e3cc21a67e8dd40ccb59822e4193fd1923b4cda08b40fe8ff8973de5eed9515',
  workerSha256: '135ef53a1f3be23e850ab262e39c15732c4b19df5538e6e15891aa64c7bc0f30',
} as const;

/** Pasta dos XSD oficiais versionados, relativa à raiz do app (incluída no bundle pelo next.config). */
export const TISS_SCHEMA_DIR = 'src/contexts/health-insurance/tiss/schemas/4.03.00';

export type XsdEngineFailure = 'unavailable' | 'integrity' | 'timeout' | 'memory' | 'busy' | 'engine_failure';

/** Falha do VALIDADOR (não do XML): quem chama recusa a operação, nunca a trata como "válido". */
export class XsdEngineError extends Error {
  constructor(
    readonly reason: XsdEngineFailure,
    message: string,
  ) {
    super(message);
    this.name = 'XsdEngineError';
  }
}

export interface XsdEngineOptions {
  /** Pasta dos XSD com `MANIFEST.json` (padrão: a versionada no app). */
  schemaDir?: string;
  /** Pasta cujo `node_modules` tem o `xmllint-wasm` (padrão: a raiz do app). */
  packageDir?: string;
  /** Prazo de uma validação, incluindo a subida do worker (padrão 30 s). */
  timeoutMs?: number;
  /** Maior XML aceito (padrão 16 MiB; o lote TISS tem no máximo 100 guias). */
  maxXmlBytes?: number;
  /** Teto da memória do WebAssembly em páginas de 64 KiB (padrão 2048 = 128 MiB). */
  maxMemoryPages?: number;
  /** Teto do heap JS do worker em MiB (padrão 64). */
  workerHeapMb?: number;
  /** Validações simultâneas por processo (padrão 2). */
  maxConcurrency?: number;
  /** Validações esperando vaga (padrão 32); acima disso, `busy`. */
  maxQueue?: number;
}

export interface XsdValidation {
  valid: boolean;
  /** Onde a recusa aconteceu: estrutura (antes do parser) ou o XSD. */
  stage: 'envelope' | 'xsd';
  /** Mensagens curtas, sem conteúdo do arquivo (no máximo 10). */
  errors: string[];
  /** Linhas do XML com erro, quando o libxml2 informa (sem o texto da linha). */
  lines: number[];
  engine: string;
  schemaVersion: string;
  schemaSetSha256: string;
  ms: number;
}

export interface TissXsdEngine {
  readonly engine: string;
  readonly schemaVersion: string;
  readonly schemaSetSha256: string;
  validate(xml: { bytes: Uint8Array }): Promise<XsdValidation>;
}

interface InputFile {
  fileName: string;
  contents: Uint8Array;
}

interface SchemaSet {
  version: string;
  entry: InputFile;
  preload: InputFile[];
  sha256: string;
}

const XML_NAME = 'mensagem.xml';
const MESSAGE_KEY = 'xmllint-wasm';
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/**
 * Troca os VALORES citados pelo motor (podem ser nome ou carteirinha) por reticências e
 * mantém o nome do elemento e a regra do XSD, que dizem o que corrigir.
 * Formatos do libxml2: "The value 'V' …" e "Element 'E': 'V' is not a valid value …".
 */
export function maskValues(message: string): string {
  return message
    .replace(/(\bvalue\s+)'[^']*'/giu, "$1'…'")
    .replace(/(:\s*)'[^']*'(\s+is not)/giu, "$1'…'$2")
    .replace(/"[^"]*"/gu, '"…"')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

/** Lê e confere os XSD contra o MANIFEST.json (SHA-256 de cada arquivo). */
export function loadSchemaSet(schemaDir: string): SchemaSet {
  let manifest: { version?: string; entrypoint?: string; files?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(path.join(schemaDir, 'MANIFEST.json'), 'utf8')) as typeof manifest;
  } catch {
    throw new XsdEngineError('unavailable', 'XSD oficiais não encontrados no app');
  }
  const files = Object.entries(manifest.files ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!manifest.version || !manifest.entrypoint || files.length === 0 || !manifest.files?.[manifest.entrypoint]) {
    throw new XsdEngineError('integrity', 'MANIFEST.json dos XSD incompleto');
  }
  const loaded: InputFile[] = [];
  for (const [fileName, expected] of files) {
    if (!/^[\w.-]+\.xsd$/u.test(fileName)) throw new XsdEngineError('integrity', 'nome de XSD inválido no MANIFEST');
    let contents: Uint8Array;
    try {
      contents = new Uint8Array(readFileSync(path.join(schemaDir, fileName)));
    } catch {
      throw new XsdEngineError('unavailable', `XSD ${fileName} ausente`);
    }
    if (sha256(contents) !== expected) throw new XsdEngineError('integrity', `XSD ${fileName} não confere com o MANIFEST`);
    loaded.push({ fileName, contents });
  }
  const entry = loaded.find((f) => f.fileName === manifest.entrypoint)!;
  return {
    version: manifest.version,
    entry,
    preload: loaded.filter((f) => f !== entry),
    sha256: sha256(files.map(([n, h]) => `${n}:${h}`).join('\n')),
  };
}

/** Localiza o worker do pacote e confere versão e SHA-256 (o `.wasm` fica ao lado dele). */
export function resolveXmllint(packageDir?: string): { workerPath: string; version: string } {
  const bases = [packageDir ?? process.cwd()];
  // Só fora de produção: worktrees de desenvolvimento podem apontar para uma instalação isolada.
  if (!packageDir && process.env.NODE_ENV !== 'production' && process.env.TISS_XMLLINT_WASM_DIR) {
    bases.push(process.env.TISS_XMLLINT_WASM_DIR);
  }
  for (const base of bases) {
    let pkgJson: string;
    try {
      // Resolução NATIVA do Node em tempo de execução: o webpack não reescreve getBuiltinModule
      // (com import de createRequire ele tenta interpretar o argumento e avisa que não consegue).
      pkgJson = process.getBuiltinModule('node:module').createRequire(path.join(base, 'package.json')).resolve('xmllint-wasm/package.json');
    } catch {
      continue;
    }
    const dir = path.dirname(pkgJson);
    let version: string;
    let wasm: Buffer;
    let worker: Buffer;
    try {
      version = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string }).version;
      wasm = readFileSync(path.join(dir, 'xmllint.wasm'));
      worker = readFileSync(path.join(dir, 'xmllint-node.js'));
    } catch {
      throw new XsdEngineError('unavailable', 'xmllint-wasm incompleto no app (worker ou .wasm ausente)');
    }
    if (version !== XMLLINT_PIN.version || sha256(wasm) !== XMLLINT_PIN.wasmSha256 || sha256(worker) !== XMLLINT_PIN.workerSha256) {
      throw new XsdEngineError('integrity', `xmllint-wasm ${version} não confere com a versão aprovada (${XMLLINT_PIN.version})`);
    }
    return { workerPath: path.join(dir, 'xmllint-node.js'), version };
  }
  throw new XsdEngineError('unavailable', 'xmllint-wasm não está instalado no app');
}

/** Só as linhas de diagnóstico do arquivo validado; o eco do conteúdo (e o "^") é descartado. */
function parseDiagnostics(stderr: string): { errors: string[]; lines: number[] } {
  const errors: string[] = [];
  const lines: number[] = [];
  for (const raw of stderr.split('\n')) {
    const m = /^mensagem\.xml:(\d+):\s*(.*)$/u.exec(raw.trim());
    if (!m) continue;
    lines.push(Number(m[1]));
    errors.push(maskValues(`linha ${m[1]}: ${m[2]}`));
    if (errors.length >= 10) break;
  }
  return { errors, lines };
}

interface WorkerOutcome {
  exitCode: number;
  stderr: string;
}

export function runXmllintWorker(
  workerPath: string,
  payload: Record<string, unknown>,
  limits: { timeoutMs: number; heapMb: number },
): Promise<WorkerOutcome> {
  return new Promise<WorkerOutcome>((resolve, reject) => {
    let settled = false;
    // stdout/stderr do worker NÃO vão para o log do processo (o parser pode ecoar conteúdo).
    const worker = new Worker(workerPath, {
      resourceLimits: { maxOldGenerationSizeMb: limits.heapMb, maxYoungGenerationSizeMb: 16 },
      stdout: true,
      stderr: true,
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new XsdEngineError('timeout', `validação XSD excedeu ${limits.timeoutMs} ms`))),
      limits.timeoutMs,
    );
    worker.on('message', (data: { exitCode?: number; stderr?: string } & Record<string, unknown>) => {
      if (!data || data[MESSAGE_KEY] !== true) return;
      finish(() => resolve({ exitCode: Number(data.exitCode), stderr: String(data.stderr ?? '') }));
    });
    worker.on('error', (error: Error & { code?: string }) =>
      finish(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new XsdEngineError('memory', 'validação XSD excedeu o limite de memória do worker')
            : new XsdEngineError('engine_failure', 'o motor XSD falhou ao iniciar ou executar'),
        ),
      ),
    );
    worker.on('exit', () =>
      finish(() => reject(new XsdEngineError('engine_failure', 'o motor XSD terminou sem resultado'))),
    );
    worker.postMessage(payload);
  });
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= this.maxQueue) {
      throw new XsdEngineError('busy', 'validador XSD ocupado: tente de novo em instantes');
    }
    // A vaga é entregue diretamente por `release` (o contador não muda na passagem).
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

/**
 * Cria um motor. Lança `XsdEngineError` (`unavailable`/`integrity`) se o pacote ou os XSD
 * não estiverem presentes e íntegros: sem motor, nenhum XML TISS sai do Qoro.
 */
export function createTissXsdEngine(opts: XsdEngineOptions = {}): TissXsdEngine {
  const schemas = loadSchemaSet(opts.schemaDir ?? path.join(process.cwd(), TISS_SCHEMA_DIR));
  const { workerPath, version } = resolveXmllint(opts.packageDir);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxXmlBytes = opts.maxXmlBytes ?? 16 * 1024 * 1024;
  const maxMemoryPages = opts.maxMemoryPages ?? 2048;
  const heapMb = opts.workerHeapMb ?? 64;
  const gate = new Semaphore(opts.maxConcurrency ?? 2, opts.maxQueue ?? 32);
  const engine = `xmllint-wasm@${version}`;
  const base = { engine, schemaVersion: schemas.version, schemaSetSha256: schemas.sha256 };

  return {
    ...base,
    async validate({ bytes }) {
      const started = performance.now();
      const envelope = checkTissEnvelope(bytes, { version: schemas.version, maxBytes: maxXmlBytes });
      if (envelope.length > 0) {
        return {
          ...base,
          valid: false,
          stage: 'envelope',
          errors: envelope.map((p) => `${p.code}: ${p.message}`),
          lines: [],
          ms: performance.now() - started,
        };
      }
      await gate.acquire();
      try {
        const out = await runXmllintWorker(
          workerPath,
          {
            [MESSAGE_KEY]: true,
            inputFiles: [{ fileName: XML_NAME, contents: bytes }, schemas.entry, ...schemas.preload],
            args: ['--schema', schemas.entry.fileName, '--noout', '--nonet', XML_NAME],
            initialMemory: Math.min(256, maxMemoryPages),
            maxMemory: maxMemoryPages,
          },
          { timeoutMs, heapMb },
        );
        const ms = performance.now() - started;
        if (out.exitCode === 0) return { ...base, valid: true, stage: 'xsd', errors: [], lines: [], ms };
        const diag = parseDiagnostics(out.stderr);
        // 3/4: o XML não passa no XSD. 1 com erro do parser NO ARQUIVO: XML malformado (inválido).
        if (out.exitCode === 3 || out.exitCode === 4 || (out.exitCode === 1 && diag.errors.length > 0 && /parser error/u.test(out.stderr))) {
          return { ...base, valid: false, stage: 'xsd', errors: diag.errors.length > 0 ? diag.errors : ['o XML não passa no XSD oficial'], lines: diag.lines, ms };
        }
        if (out.exitCode === 9 || /out of memory|Cannot enlarge memory|OOM/iu.test(out.stderr)) {
          throw new XsdEngineError('memory', 'validação XSD excedeu o limite de memória');
        }
        // Qualquer outro código (schema que não compila, abort do WASM…): falha do motor.
        throw new XsdEngineError('engine_failure', `o motor XSD terminou com código ${out.exitCode}`);
      } finally {
        gate.release();
      }
    },
  };
}

let shared: TissXsdEngine | null = null;

/**
 * Motor do app (um por processo, com fila compartilhada). Sucesso fica em cache; falha
 * não (a próxima chamada tenta de novo), e quem chama recusa a operação.
 */
export function getTissXsdEngine(): TissXsdEngine {
  shared ??= createTissXsdEngine();
  return shared;
}
