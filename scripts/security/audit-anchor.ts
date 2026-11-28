/**
 * S5 / P12.10 — ferramenta do OPERADOR para a ancoragem das trilhas (`src/lib/db/audit-anchor.ts`) e o selo por
 * carimbo de tempo (`src/lib/db/audit-anchor-seal.ts`). Nada aqui grava no banco: `compute` e `verify` rodam numa
 * transação READ ONLY, sem SET de sessão (servem também pelo pooler em modo transação); `seal` e `verify-seal` nem
 * abrem conexão.
 *
 * 1. Calcular (uma linha JSON por dia, por trilha):
 *   ANCHOR_DATABASE_URL=... npx tsx scripts/security/audit-anchor.ts compute --trail clinic_audit --from D --to D [--prev H] > clinic.jsonl
 *
 * 2. Selar (pede o carimbo RFC 3161 a uma ou mais TSAs; vale com pelo menos um; sem nenhum, não grava o selo):
 *   npx tsx scripts/security/audit-anchor.ts seal --anchors clinic.jsonl --anchors platform.jsonl \
 *     --tsa http://timestamp.digicert.com --tsa http://timestamp.sectigo.com --out selo.json
 *
 * 3. Conferir o selo sem o banco (assinatura da TSA, enunciado, cadeias dos arquivos e janela do carimbo):
 *   npx tsx scripts/security/audit-anchor.ts verify-seal --anchors clinic.jsonl --anchors platform.jsonl \
 *     --seal selo.json --ca raizes-das-tsas.pem [--untrusted intermediarios.pem] [--max-delay-hours 48]
 *
 * 4. Conferir o banco de agora contra as âncoras guardadas (o que mudou, em que dia):
 *   ANCHOR_DATABASE_URL=... npx tsx scripts/security/audit-anchor.ts verify --trail clinic_audit --file clinic.jsonl
 *
 * Códigos de saída: 0 íntegro; 1 achado (adulteração ou arquivo editado); 2 uso; 3 sem selo para o período (o lugar
 * de guarda foi perdido: não há prova, e isso é um achado, não um "ok"); 4 nenhum carimbo válido.
 *
 * A URL vem de `ANCHOR_DATABASE_URL` (de propósito diferente de `DATABASE_URL`, para não herdar o ambiente do app) e
 * nunca é impressa.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

import {
  ANCHOR_TRAILS,
  computeAnchors,
  verifyAnchors,
  type AnchorQuery,
  type DayAnchor,
} from '../../src/lib/db/audit-anchor';
import {
  buildSeal,
  checkSeal,
  sealWindow,
  type SealRecord,
} from '../../src/lib/db/audit-anchor-seal';

import { collectTimestamps, timestampInfo, verifyTimestamp } from './audit-anchor-tsa';

const [, , mode, ...rest] = process.argv;
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const args = (name: string) =>
  rest.flatMap((value, i) => (rest[i - 1] === `--${name}` ? [value] : []));
const readAnchors = (file: string): DayAnchor[] =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as DayAnchor);

const USAGE =
  'uso: audit-anchor.ts compute|verify --trail clinic_audit|platform_audit (--from D --to D [--prev H] | --file F) ' +
  '| seal --anchors F... --tsa URL... --out S | verify-seal --anchors F... --seal S --ca PEM [--untrusted PEM] [--max-delay-hours N]';

async function seal(): Promise<number> {
  const files = args('anchors');
  const tsas = args('tsa');
  const out = arg('out');
  if (files.length === 0 || tsas.length === 0 || !out) {
    console.error(USAGE);
    return 2;
  }
  const anchors = files.map(readAnchors);
  const draft = buildSeal(anchors, []);
  const structural = checkSeal({ ...draft, tokens: [{ tsa: 'rascunho', response: '' }] }, anchors);
  if (structural.length > 0) {
    for (const f of structural) console.log(JSON.stringify(f));
    console.error('ATENÇÃO: os arquivos de âncoras não estão consistentes; nada foi selado');
    return 1;
  }
  const { tokens, errors } = await collectTimestamps(tsas, draft.digest);
  for (const e of errors) console.error(`TSA indisponível: ${e}`);
  if (tokens.length === 0) {
    console.error(
      'nenhuma TSA concedeu o carimbo: o selo NÃO foi gravado (tente de novo; as âncoras seguem válidas)',
    );
    return 4;
  }
  const record: SealRecord = { ...draft, tokens };
  writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`);
  console.error(`selado: ${record.digest} (${tokens.length} carimbo(s))`);
  return 0;
}

function verifySeal(): number {
  const files = args('anchors');
  const sealFile = arg('seal');
  const ca = arg('ca');
  if (files.length === 0 || !sealFile || !ca) {
    console.error(USAGE);
    return 2;
  }
  if (!existsSync(sealFile)) {
    console.error(`SEM SELO: ${sealFile} não existe; este período não tem prova de integridade`);
    return 3;
  }
  const record = JSON.parse(readFileSync(sealFile, 'utf8')) as SealRecord;
  const anchors = files.map(readAnchors);
  const findings = checkSeal(record, anchors);
  for (const f of findings) console.log(JSON.stringify(f));
  const maxDelay = Number(arg('max-delay-hours') ?? 48);
  let valid = 0;
  for (const token of record.tokens) {
    const der = Buffer.from(token.response, 'base64');
    const check = verifyTimestamp(der, record.digest, ca, arg('untrusted'));
    const info = timestampInfo(der);
    const window = info.stampedAt ? sealWindow(record.heads, info.stampedAt, maxDelay) : null;
    console.log(
      JSON.stringify({
        tsa: token.tsa,
        signature: check.ok ? 'ok' : 'invalid',
        stampedAt: info.stampedAt?.toISOString() ?? null,
        windowHours: window?.hours ?? null,
        late: window?.late ?? null,
        ...(check.ok ? {} : { detail: check.detail }),
      }),
    );
    if (check.ok) valid += 1;
  }
  if (findings.length > 0) {
    console.error(`ATENÇÃO: ${findings.length} achado(s); o selo não confere com estas âncoras`);
    return 1;
  }
  if (valid === 0) {
    console.error('ATENÇÃO: nenhum carimbo com assinatura válida para este selo');
    return 4;
  }
  console.error(`selo íntegro: ${valid} carimbo(s) válido(s) de ${record.tokens.length}`);
  return 0;
}

async function database(): Promise<number> {
  const spec = ANCHOR_TRAILS.find((t) => t.id === arg('trail'));
  const url = process.env.ANCHOR_DATABASE_URL;
  if (!spec || !url) {
    console.error(USAGE);
    return 2;
  }
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 45,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    return await sql.begin('read only', async (tx) => {
      const query: AnchorQuery = async (text, params) =>
        (await tx.unsafe(text, params as never[])) as unknown as Array<Record<string, unknown>>;
      if (mode === 'compute') {
        const from = arg('from');
        const to = arg('to');
        if (!from || !to) throw new Error('compute exige --from e --to');
        const prev = arg('prev');
        for (const a of await computeAnchors(query, spec, from, to, ...(prev ? [prev] : [])))
          console.log(JSON.stringify(a));
        return 0;
      }
      const file = arg('file');
      if (!file) throw new Error('verify exige --file');
      const stored = readAnchors(file);
      const findings = await verifyAnchors(query, spec, stored);
      for (const f of findings) console.log(JSON.stringify(f));
      console.error(
        findings.length === 0
          ? `íntegro: ${stored.length} dia(s) conferido(s)`
          : `ATENÇÃO: ${findings.length} achado(s) em ${stored.length} dia(s)`,
      );
      return findings.length === 0 ? 0 : 1;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const run = async (): Promise<number> => {
  if (mode === 'seal') return seal();
  if (mode === 'verify-seal') return verifySeal();
  if (mode === 'compute' || mode === 'verify') return database();
  console.error(USAGE);
  return 2;
};
process.exitCode = await run();
