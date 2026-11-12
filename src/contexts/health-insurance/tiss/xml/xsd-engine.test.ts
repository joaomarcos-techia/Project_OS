/**
 * P9.2: o validador XSD roda DENTRO do app (xmllint-wasm 5.3.0) com timeout, teto de
 * memória, fila de concorrência, integridade do pacote e dos XSD, e barreira contra XML
 * hostil. Falha do validador nunca vira "válido".
 *
 * Fora do CI, o pacote pode vir de uma instalação isolada: `TISS_XMLLINT_WASM_DIR=<pasta>`.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { corpusScenarios } from '../corpus/scenarios';
import { buildLoteGuiasMessage, type LoteGuiasInput } from '../messages/lote-guias';
import { checkTissEncoding } from './encoding-check';
import { verifyEpilogueHash } from './hash-verify';
import {
  createTissXsdEngine,
  resolveXmllint,
  runXmllintWorker,
  TISS_SCHEMA_DIR,
  XMLLINT_PIN,
  type XsdEngineError,
} from './xsd-engine';
import { loadXmllintValidator } from './xsd-validator';

const SCHEMAS = path.join(process.cwd(), TISS_SCHEMA_DIR);
const engine = createTissXsdEngine();
const scenarios = corpusScenarios();
const scenario = (id: string) => scenarios.find((s) => s.id === id)!;
const validBytes = () => scenario('V1a-consulta-pj-codigo-operadora').bytes()!;
const latin1 = (s: string) => Buffer.from(s, 'latin1');
const tmp = mkdtempSync(path.join(tmpdir(), 'qoro-xsd-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function rebuild(id: string, edit: (input: LoteGuiasInput) => void): Buffer {
  const input = structuredClone(scenario(id).input!);
  edit(input);
  return buildLoteGuiasMessage(input).bytes;
}

function bigSadt(perGuide: number): Buffer {
  return rebuild('V2f-sadt-lote-100-guias', (input) => {
    if (input.lote.type !== 'sp_sadt') throw new Error('cenário mudou');
    for (const g of input.lote.guides) {
      const p = g.procedimentos[0]!;
      g.procedimentos = Array.from({ length: perGuide }, (_, i) => ({ ...p, sequencial: i + 1 }));
    }
  });
}

describe('motor XSD dentro do app', () => {
  it('é o pacote aprovado (versão e SHA-256 do .wasm e do worker) com os XSD do MANIFEST', () => {
    expect(engine.engine).toBe(`xmllint-wasm@${XMLLINT_PIN.version}`);
    expect(engine.schemaVersion).toBe('4.03.00');
    expect(engine.schemaSetSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolveXmllint().version).toBe(XMLLINT_PIN.version);
  });

  it('XML válido passa; XML inválido é recusado com o elemento e sem o valor do campo', async () => {
    const ok = await engine.validate({ bytes: validBytes() });
    expect(ok).toMatchObject({ valid: true, stage: 'xsd', errors: [] });

    const carteira = /<ans:numeroCarteira>([^<]*)</u.exec(validBytes().toString('latin1'))![1]!;
    const tooLong = latin1(validBytes().toString('latin1').replace(`<ans:numeroCarteira>${carteira}<`, `<ans:numeroCarteira>${carteira}${'9'.repeat(30)}<`));
    const bad = await engine.validate({ bytes: tooLong });
    expect(bad.valid).toBe(false);
    expect(bad.stage).toBe('xsd');
    expect(bad.errors.join(' ')).toContain('numeroCarteira');
    expect(bad.errors.join(' ')).not.toContain(carteira);
    expect(bad.lines.length).toBeGreaterThan(0);
  });

  it('confere o corpus c1 e c2 inteiro com a expectativa do XSD (P13.2 no CI)', async () => {
    for (const corpus of ['c1', 'c2']) {
      const dir = path.join(process.cwd(), 'data/tiss/corpus/4.03.00', corpus);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')) as {
        scenarios: Array<{ id: string; file?: string; rejectedBy: string[]; expectedIssues?: string[] }>;
      };
      for (const e of manifest.scenarios) {
        if (!e.file) continue;
        const r = await engine.validate({ bytes: readFileSync(path.join(dir, e.file)) });
        // A versão antiga no cabeçalho passa no XSD, mas o Qoro recusa antes (envelope).
        const oldVersion = e.expectedIssues?.includes('BATCH_VERSION') ?? false;
        expect(r.valid, `${corpus}/${e.id}`).toBe(!e.rejectedBy.includes('xsd') && !oldVersion);
        if (oldVersion) expect(r.errors[0], e.id).toMatch(/^VERSION_UNSUPPORTED/u);
      }
    }
  }, 120_000);

  it('campo obrigatório ausente e procedimento fora do formato são recusados pelo XSD', async () => {
    const text = validBytes().toString('latin1');
    const missing = await engine.validate({ bytes: latin1(text.replace(/<ans:numeroCarteira>[^<]*<\/ans:numeroCarteira>/u, '')) });
    expect(missing.valid).toBe(false);
    expect(missing.errors.join(' ')).toMatch(/numeroCarteira|Missing child|not expected/u);
    const proc = await engine.validate({ bytes: latin1(text.replace(/<ans:codigoProcedimento>[^<]*</u, '<ans:codigoProcedimento>12345678901<')) });
    expect(proc.valid).toBe(false);
    expect(proc.errors.join(' ')).toContain('codigoProcedimento');
  });

  it('caracteres especiais em ISO-8859-1 (acentos, ç, º, & < >) passam no XSD, no hash e na codificação', async () => {
    for (const id of ['V18-consulta-acentos-latin1', 'V1e-consulta-opcionais-valor-maximo']) {
      const bytes = scenario(id).bytes()!;
      expect(bytes.some((b) => b > 0x7f), id).toBe(true);
      expect((await engine.validate({ bytes })).valid, id).toBe(true);
      expect(verifyEpilogueHash(bytes).matches, id).toBe(true);
      expect(checkTissEncoding(bytes), id).toBeNull();
    }
  });

  it('hash errado e UTF-8 declarado como ISO-8859-1 passam no XSD: por isso o hash e a codificação são camadas próprias', async () => {
    const text = validBytes().toString('latin1');
    const wrongHash = latin1(text.replace(/<ans:hash>[0-9a-f]{32}<\/ans:hash>/u, `<ans:hash>${'0'.repeat(32)}</ans:hash>`));
    expect((await engine.validate({ bytes: wrongHash })).valid).toBe(true);
    expect(verifyEpilogueHash(wrongHash).matches).toBe(false);

    const accents = scenario('V18-consulta-acentos-latin1').bytes()!;
    const utf8 = Buffer.from(accents.toString('latin1'), 'utf8');
    expect(checkTissEncoding(utf8)).toBe('utf8_bytes_declared_latin1');
  });

  it('namespace errado, raiz errada e versão diferente são recusados antes do parser', async () => {
    const text = validBytes().toString('latin1');
    const ns = await engine.validate({ bytes: latin1(text.replace('http://www.ans.gov.br/padroes/tiss/schemas', 'http://example.org/tiss')) });
    expect(ns).toMatchObject({ valid: false, stage: 'envelope' });
    expect(ns.errors[0]).toMatch(/^NAMESPACE/u);
    const root = await engine.validate({ bytes: latin1('<?xml version="1.0" encoding="ISO-8859-1"?><outra/>') });
    expect(root.errors[0]).toMatch(/^ROOT_ELEMENT/u);
    const version = await engine.validate({ bytes: latin1(text.replace('<ans:Padrao>4.03.00<', '<ans:Padrao>4.01.00<')) });
    expect(version.errors[0]).toMatch(/^VERSION_UNSUPPORTED.*4\.01\.00.*4\.03\.00/u);
  });

  it('XML malicioso nunca chega ao parser: DTD, entidade externa, expansão exponencial, XInclude, PI', async () => {
    const decl = '<?xml version="1.0" encoding="ISO-8859-1"?>';
    const body = validBytes().toString('latin1').replace(/^<\?xml[^>]*\?>/u, '');
    const laughs = `${decl}<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>${body}`;
    const xxe = `${decl}<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${body.replace('<ans:Padrao>', '<ans:Padrao>&xxe;')}`;
    const xinclude = body.replace('<ans:mensagemTISS ', '<ans:mensagemTISS xmlns:xi="http://www.w3.org/2001/XInclude" ');
    const pi = `${decl}<?xml-stylesheet href="x.xsl"?>${body}`;
    for (const [name, xml, code] of [
      ['billion laughs', laughs, 'DTD_FORBIDDEN'],
      ['XXE', xxe, 'DTD_FORBIDDEN'],
      ['XInclude', `${decl}${xinclude}`, 'XINCLUDE_FORBIDDEN'],
      ['instrução de processamento', pi, 'PROCESSING_INSTRUCTION_FORBIDDEN'],
    ] as const) {
      const r = await engine.validate({ bytes: latin1(xml) });
      expect(r.valid, name).toBe(false);
      expect(r.stage, name).toBe('envelope');
      expect(r.errors[0], name).toMatch(new RegExp(`^${code}`, 'u'));
      expect(r.errors.join(' '), name).not.toContain('etc/passwd');
    }
  });

  it('XML malformado é inválido (não falha do motor) e o eco do conteúdo não sai na mensagem', async () => {
    const text = validBytes().toString('latin1');
    const r = await engine.validate({ bytes: latin1(text.replace('</ans:cabecalho>', '</ans:cabecalhoX>')) });
    expect(r.valid).toBe(false);
    expect(r.errors.every((e) => e.startsWith('linha '))).toBe(true);
    expect(r.errors.join(' ')).not.toContain('<ans:');
  });

  it('lote com 100 guias SP/SADT e 3.000 procedimentos é validado dentro do prazo e do teto padrão', async () => {
    const bytes = bigSadt(30);
    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    const r = await engine.validate({ bytes });
    expect(r.valid).toBe(true);
    expect(r.ms).toBeLessThan(30_000);
  }, 60_000);

  it('arquivo acima do limite é recusado sem subir o worker', async () => {
    const small = createTissXsdEngine({ maxXmlBytes: 1024 });
    const r = await small.validate({ bytes: validBytes() });
    expect(r).toMatchObject({ valid: false, stage: 'envelope' });
    expect(r.errors[0]).toMatch(/^TOO_LARGE/u);
  });

  it('limite de memória do WebAssembly: estouro é falha do motor, nunca "válido"', async () => {
    const tight = createTissXsdEngine({ maxMemoryPages: 256 });
    await expect(tight.validate({ bytes: bigSadt(150) })).rejects.toMatchObject({ reason: 'memory' });
  }, 60_000);

  it('timeout encerra o worker e conta como falha do motor', async () => {
    const quick = createTissXsdEngine({ timeoutMs: 5 });
    await expect(quick.validate({ bytes: bigSadt(30) })).rejects.toMatchObject({ reason: 'timeout' });
  }, 60_000);

  it('concorrência: validações simultâneas não se misturam; fila cheia devolve "busy"', async () => {
    const ok = validBytes();
    const bad = latin1(ok.toString('latin1').replace(/<ans:codigoProcedimento>[^<]*</u, '<ans:codigoProcedimento>12345678901<'));
    const inputs = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? ok : bad));
    const results = await Promise.all(inputs.map((bytes) => engine.validate({ bytes })));
    expect(results.map((r) => r.valid)).toEqual(inputs.map((_, i) => i % 2 === 0));

    const narrow = createTissXsdEngine({ maxConcurrency: 1, maxQueue: 1 });
    const settled = await Promise.allSettled([0, 1, 2, 3].map(() => narrow.validate({ bytes: ok })));
    const busy = settled.filter((s) => s.status === 'rejected' && (s.reason as XsdEngineError).reason === 'busy');
    expect(busy.length).toBe(2);
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBe(2);
  }, 60_000);
});

describe('falhas de carga: sem motor íntegro, nada é validado (fail closed)', () => {
  it('XSD ausente ou adulterado: motor indisponível e o validador do app vira null', () => {
    expect(() => createTissXsdEngine({ schemaDir: path.join(tmp, 'nada') })).toThrow(
      expect.objectContaining({ reason: 'unavailable' }) as Error,
    );
    const tampered = path.join(tmp, 'xsd-adulterado');
    cpSync(SCHEMAS, tampered, { recursive: true });
    const simple = path.join(tampered, 'tissSimpleTypesV4_03_00.xsd');
    writeFileSync(simple, `${readFileSync(simple, 'latin1')}<!-- adulterado -->`, 'latin1');
    expect(() => createTissXsdEngine({ schemaDir: tampered })).toThrow(expect.objectContaining({ reason: 'integrity' }) as Error);
    expect(loadXmllintValidator({ schemaDir: tampered })).toBeNull();
  });

  it('pacote com .wasm adulterado ou ausente: motor indisponível', () => {
    const real = path.dirname(resolveXmllint().workerPath);
    const fake = path.join(tmp, 'pkg', 'node_modules', 'xmllint-wasm');
    mkdirSync(fake, { recursive: true });
    writeFileSync(path.join(tmp, 'pkg', 'package.json'), '{}');
    cpSync(real, fake, { recursive: true });
    writeFileSync(path.join(fake, 'xmllint.wasm'), Buffer.from('não é wasm'));
    expect(() => createTissXsdEngine({ packageDir: path.join(tmp, 'pkg') })).toThrow(
      expect.objectContaining({ reason: 'integrity' }) as Error,
    );
    rmSync(path.join(fake, 'xmllint.wasm'));
    expect(() => createTissXsdEngine({ packageDir: path.join(tmp, 'pkg') })).toThrow(
      expect.objectContaining({ reason: 'unavailable' }) as Error,
    );
    expect(loadXmllintValidator({ packageDir: path.join(tmp, 'pkg') })).toBeNull();
  });

  it('worker que falha ao iniciar, termina sem resposta, trava ou estoura o heap: falha do motor', async () => {
    const script = (name: string, code: string) => {
      const file = path.join(tmp, `${name}.js`);
      writeFileSync(file, code);
      return file;
    };
    const limits = { timeoutMs: 2_000, heapMb: 16 };
    await expect(runXmllintWorker(script('throws', 'throw new Error("wasm init")'), {}, limits)).rejects.toMatchObject({
      reason: 'engine_failure',
    });
    await expect(runXmllintWorker(script('exits', 'process.exit(0)'), {}, limits)).rejects.toMatchObject({
      reason: 'engine_failure',
    });
    await expect(
      runXmllintWorker(script('hangs', 'setInterval(() => {}, 1000)'), {}, { ...limits, timeoutMs: 200 }),
    ).rejects.toMatchObject({ reason: 'timeout' });
    await expect(
      runXmllintWorker(script('oom', 'const a = []; for (;;) a.push(new Array(1e6).fill(Math.random()))'), {}, limits),
    ).rejects.toMatchObject({ reason: 'memory' });
    const ignored = script(
      'other-message',
      'const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ watch: true }); setTimeout(() => process.exit(0), 50)',
    );
    await expect(runXmllintWorker(ignored, {}, limits)).rejects.toMatchObject({ reason: 'engine_failure' });
  }, 60_000);
});
