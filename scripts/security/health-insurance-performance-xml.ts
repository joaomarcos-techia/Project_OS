/**
 * P14.4 — XML em processo Node LIMPO (como uma função que só exporta), para a memória medida ser
 * a do trabalho e não a do harness: gera e valida no XSD oficial o lote de 100 guias (consulta e
 * SP/SADT com 5 itens) e valida um demonstrativo de análise com 1.000 guias (o "retorno grande").
 * Imprime JSON com tempos e o pico de memória residente do processo (`maxRSS`).
 *
 *   TISS_XMLLINT_WASM_DIR=... NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-performance-xml.ts lote|mil
 *
 * Um modo por processo: o pico de memória (`maxRSS`) é do processo inteiro, então o lote de 100
 * e o demonstrativo de 1.000 são medidos em processos separados.
 */
import { performance } from 'node:perf_hooks';

const { createTissXsdEngine } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-engine');
const { buildLoteGuiasMessage } = await import('../../src/contexts/health-insurance/tiss/messages/lote-guias');
const { consultaGuide, sadtGuide, sadtItem, consultaBatch, sadtBatch } = await import('../../src/contexts/health-insurance/tiss/corpus/fixtures');
const { analysisStatementXml } = await import('../../src/contexts/health-insurance/tiss/corpus/statement-fixtures');

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const ms = (x: number) => Math.round(x * 10) / 10;
const rssBaseMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
const engine = createTissXsdEngine();
const mode = process.argv[2];
if (mode !== 'lote' && mode !== 'mil') throw new Error('uso: lote | mil');
const out: Record<string, unknown> = { modo: mode, rssInicialMb: rssBaseMb };

const inputs = {
  consulta: consultaBatch(Array.from({ length: 100 }, (_, i) => consultaGuide(i + 1))),
  sp_sadt: sadtBatch(Array.from({ length: 100 }, (_, i) => sadtGuide(i + 1, { procedimentos: Array.from({ length: 5 }, (_, k) => sadtItem(k + 1)) }))),
};
const lote: Record<string, unknown> = {};
for (const [label, input] of mode === 'lote' ? Object.entries(inputs) : []) {
  const runs: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    const built = buildLoteGuiasMessage(input);
    const v = await engine.validate({ bytes: built.bytes });
    runs.push(performance.now() - t);
    bytes = built.bytes.length;
    if (!v.valid) throw new Error(`${label}: ${v.errors.join('; ')}`);
  }
  lote[label] = { bytes, primeiraMs: ms(runs[0]!), seguintesP95Ms: ms(pct(runs.slice(1), 95)) };
}
if (mode === 'lote') out.lote100 = lote;

const big = mode !== 'mil' ? null : analysisStatementXml({
  registroANS: '123456',
  prestador: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
  numeroDemonstrativo: 'DA-P144',
  dataEmissao: '2026-11-20',
  protocolos: Array.from({ length: 10 }, (_, p) => ({
    numeroLote: String(p + 1),
    numeroProtocolo: `20261112${String(p).padStart(4, '0')}`,
    dataProtocolo: '2026-11-11',
    guias: Array.from({ length: 100 }, (_, i) => ({
      numeroGuiaPrestador: `G${String(p * 100 + i + 1).padStart(7, '0')}`,
      itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: 15000, valorLiberado: 10000, glosas: [{ codigo: '1705', valor: 5000 }] }],
    })),
  })),
});
if (big) {
  const t = performance.now();
  const v = await engine.validate({ bytes: big });
  if (!v.valid) throw new Error(`demonstrativo de 1.000 guias: ${v.errors.join('; ')}`);
  out.mil = { bytes: big.length, ms: ms(performance.now() - t) };
}
// Pico do processo inteiro (Node + motor XSD com o .wasm + o trabalho), em MB.
out.rssPicoMb = Math.round(process.resourceUsage().maxRSS / 1024);
console.log(JSON.stringify(out));
process.exit(0);
