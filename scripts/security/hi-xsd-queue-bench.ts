/**
 * P6 — fila do validador XSD (motor do app, xmllint-wasm em worker) em UM processo, com
 * limites de concorrência diferentes. Mede vazão, latência p50/p95/p99, espera na fila
 * (latência − tempo de validação isolado), memória (RSS e heap) e erros, para lote pequeno
 * (1 guia de Consulta) e lote grande (100 guias SP/SADT × 30 itens, ~3 MiB).
 * Só dados sintéticos; nada de rede.
 *
 *   TISS_XMLLINT_WASM_DIR=… NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/hi-xsd-queue-bench.ts
 */
import { consultaBatch, consultaGuide, sadtBatch, sadtGuide, sadtItem } from '../../src/contexts/health-insurance/tiss/corpus/fixtures';
import { buildLoteGuiasMessage } from '../../src/contexts/health-insurance/tiss/messages/lote-guias';
import { createTissXsdEngine } from '../../src/contexts/health-insurance/tiss/xml/xsd-engine';

const LEVELS = (process.env.LEVELS ?? '1,2,4,8').split(',').map(Number);
const SMALL_N = Number(process.env.SMALL_N ?? 48);
const LARGE_N = Number(process.env.LARGE_N ?? 16);
const packageDir = process.env.TISS_XMLLINT_WASM_DIR;

const small = buildLoteGuiasMessage(consultaBatch([consultaGuide(1)])).bytes;
const large = buildLoteGuiasMessage(
  sadtBatch(Array.from({ length: 100 }, (_, g) => sadtGuide(g + 1, { procedimentos: Array.from({ length: 30 }, (_, i) => sadtItem(i + 1)) }))),
).bytes;

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!);
};

async function run(label: string, bytes: Buffer, n: number, concurrency: number) {
  const engine = createTissXsdEngine({ maxConcurrency: concurrency, maxQueue: 10_000, ...(packageDir ? { packageDir } : {}) });
  // Tempo de validação sem disputa (base da espera na fila).
  const solo = (await engine.validate({ bytes })).ms;
  let maxRss = 0;
  let maxHeap = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    maxRss = Math.max(maxRss, m.rss);
    maxHeap = Math.max(maxHeap, m.heapUsed);
  }, 50);
  const lat: number[] = [];
  let errors = 0;
  let invalid = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: n }, async () => {
      const s = performance.now();
      try {
        const r = await engine.validate({ bytes });
        if (!r.valid) invalid += 1;
      } catch {
        errors += 1;
      }
      lat.push(performance.now() - s);
    }),
  );
  const wall = performance.now() - t0;
  clearInterval(sampler);
  const row = {
    lote: label,
    concorrencia: concurrency,
    validacoes: n,
    porSegundo: Math.round((n / wall) * 1000 * 10) / 10,
    soloMs: Math.round(solo),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    esperaFilaP95Ms: Math.max(0, pct(lat, 95) - Math.round(solo)),
    rssMaxMb: Math.round(maxRss / 1024 / 1024),
    heapMaxMb: Math.round(maxHeap / 1024 / 1024),
    erros: errors,
    invalidos: invalid,
  };
  console.log(JSON.stringify(row));
  return row;
}

const rows = [];
console.log(JSON.stringify({ smallBytes: small.length, largeBytes: large.length, cpus: (await import('node:os')).cpus().length }));
for (const c of LEVELS) rows.push(await run('1 guia', small, SMALL_N, c));
for (const c of LEVELS) rows.push(await run('100 guias × 30 itens', large, LARGE_N, c));
console.log(`\nOK — ${rows.length} medições (${LEVELS.join('/')} validações simultâneas por processo).`);
