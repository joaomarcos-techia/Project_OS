/**
 * Autoteste do validador XSD no RUNTIME do app (P9.2). Usado pela rota de prontidão
 * `/api/health/tiss-xsd` (protegida como as demais de health) e pelo `security:http`
 * do CI, que sobe o build real (`next start`) e chama a rota: assim a prova de que o
 * validador funciona é feita no mesmo artefato que vai para a Vercel, não só no
 * computador de quem desenvolve.
 *
 * Três casos com dado SINTÉTICO (fixtures do corpus): XML válido aceito, XML inválido
 * recusado pelo XSD e XML hostil (DTD) recusado antes do parser. Nada de dado real.
 */
import 'server-only';

import { performance } from 'node:perf_hooks';

import { consultaBatch, consultaGuide, sadtBatch, sadtGuide, sadtItem } from '../corpus/fixtures';
import { buildLoteGuiasMessage } from '../messages/lote-guias';
import { createTissXsdEngine, getTissXsdEngine, XsdEngineError } from './xsd-engine';

export interface TissXsdSelfCheck {
  status: 'ok' | 'down';
  engine: string | null;
  schemaVersion: string | null;
  schemaSetSha256: string | null;
  /** Motivo quando o motor não sobe ou falha (`unavailable`, `integrity`, `timeout`…). */
  failure: string | null;
  checks: {
    validAccepted: boolean;
    invalidRejected: boolean;
    hostileRejected: boolean;
  };
  ms: { valid: number | null; invalid: number | null; total: number };
  rssMb: number;
}

export async function tissXsdSelfCheck(): Promise<TissXsdSelfCheck> {
  const started = performance.now();
  const out: TissXsdSelfCheck = {
    status: 'down',
    engine: null,
    schemaVersion: null,
    schemaSetSha256: null,
    failure: null,
    checks: { validAccepted: false, invalidRejected: false, hostileRejected: false },
    ms: { valid: null, invalid: null, total: 0 },
    rssMb: 0,
  };
  try {
    const engine = getTissXsdEngine();
    out.engine = engine.engine;
    out.schemaVersion = engine.schemaVersion;
    out.schemaSetSha256 = engine.schemaSetSha256;
    const valid = buildLoteGuiasMessage(consultaBatch([consultaGuide(1)])).bytes;
    const text = valid.toString('latin1');
    const invalid = Buffer.from(
      text.replace(/<ans:codigoProcedimento>[^<]*</u, '<ans:codigoProcedimento>12345678901<'),
      'latin1',
    );
    const hostile = Buffer.from(
      text.replace(/^(<\?xml[^>]*\?>)/u, '$1<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'),
      'latin1',
    );
    const v = await engine.validate({ bytes: valid });
    const i = await engine.validate({ bytes: invalid });
    const h = await engine.validate({ bytes: hostile });
    out.checks = {
      validAccepted: v.valid,
      invalidRejected: !i.valid && i.stage === 'xsd',
      hostileRejected: !h.valid && h.stage === 'envelope',
    };
    out.ms.valid = Math.round(v.ms);
    out.ms.invalid = Math.round(i.ms);
    out.status = Object.values(out.checks).every(Boolean) ? 'ok' : 'down';
  } catch (error) {
    out.failure = error instanceof XsdEngineError ? error.reason : 'unexpected';
  }
  out.ms.total = Math.round(performance.now() - started);
  out.rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  return out;
}

// ── Sonda de limites (P9.2 na Preview) ─────────────────────────────────

export interface TissXsdLimitsProbe {
  status: 'ok' | 'down';
  checks: {
    /** Namespace diferente do da ANS: recusado no envelope, antes do parser. */
    namespaceRejected: boolean;
    /** Lote grande (100 guias SP/SADT, 3.000 procedimentos) validado pelo motor padrão. */
    largeBatchAccepted: boolean;
    /** Prazo estourado encerra o worker: falha do motor (`timeout`), nunca "válido". */
    timeoutEnforced: boolean;
    /** Teto de memória do WebAssembly estourado: falha do motor (`memory`), nunca "válido". */
    memoryLimitEnforced: boolean;
    /** Fila cheia devolve `busy`; as que entram terminam válidas e sem se misturar. */
    queueEnforced: boolean;
  };
  sizes: { largeBatchBytes: number; memoryProbeBytes: number };
  ms: { largeBatch: number | null; timeoutProbe: number | null; memoryProbe: number | null; queueProbe: number | null; total: number };
  rssMb: { before: number; after: number };
  failure: string | null;
}

/** Lote SP/SADT sintético com `guides` guias de `perGuide` procedimentos (dado do corpus). */
function syntheticSadt(guides: number, perGuide: number): Buffer {
  const all = Array.from({ length: guides }, (_, i) => {
    const g = sadtGuide(i + 1);
    g.procedimentos = Array.from({ length: perGuide }, (_, j) => sadtItem(j + 1));
    return g;
  });
  return buildLoteGuiasMessage(sadtBatch(all)).bytes;
}

const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

async function rejectionReason(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (error) {
    return error instanceof XsdEngineError ? error.reason : 'unexpected';
  }
}

/**
 * Prova, no runtime onde o app roda (Preview/produção), que os limites do motor valem de
 * verdade: namespace, lote grande, timeout, teto de memória e fila. Usa instâncias
 * PRÓPRIAS do motor (o singleton do app não é afetado) e só XML sintético gerado aqui.
 * Custo limitado: ~16 MiB de XML no pico, 1 worker por vez, fora o caso da fila (2).
 */
export async function tissXsdLimitsProbe(): Promise<TissXsdLimitsProbe> {
  const started = performance.now();
  const out: TissXsdLimitsProbe = {
    status: 'down',
    checks: { namespaceRejected: false, largeBatchAccepted: false, timeoutEnforced: false, memoryLimitEnforced: false, queueEnforced: false },
    sizes: { largeBatchBytes: 0, memoryProbeBytes: 0 },
    ms: { largeBatch: null, timeoutProbe: null, memoryProbe: null, queueProbe: null, total: 0 },
    rssMb: { before: rss(), after: 0 },
    failure: null,
  };
  try {
    const engine = getTissXsdEngine();
    const valid = buildLoteGuiasMessage(consultaBatch([consultaGuide(1)])).bytes;
    const wrongNs = Buffer.from(
      valid.toString('latin1').replace('http://www.ans.gov.br/padroes/tiss/schemas', 'http://example.org/tiss'),
      'latin1',
    );
    const ns = await engine.validate({ bytes: wrongNs });
    out.checks.namespaceRejected = !ns.valid && ns.stage === 'envelope' && /^NAMESPACE/u.test(ns.errors[0] ?? '');

    const large = syntheticSadt(100, 30);
    out.sizes.largeBatchBytes = large.length;
    const big = await engine.validate({ bytes: large });
    out.checks.largeBatchAccepted = big.valid;
    out.ms.largeBatch = Math.round(big.ms);

    let t0 = performance.now();
    out.checks.timeoutEnforced = (await rejectionReason(createTissXsdEngine({ timeoutMs: 5 }).validate({ bytes: large }))) === 'timeout';
    out.ms.timeoutProbe = Math.round(performance.now() - t0);

    const huge = syntheticSadt(100, 150);
    out.sizes.memoryProbeBytes = huge.length;
    t0 = performance.now();
    out.checks.memoryLimitEnforced = (await rejectionReason(createTissXsdEngine({ maxMemoryPages: 256 }).validate({ bytes: huge }))) === 'memory';
    out.ms.memoryProbe = Math.round(performance.now() - t0);

    const narrow = createTissXsdEngine({ maxConcurrency: 1, maxQueue: 1 });
    t0 = performance.now();
    const settled = await Promise.allSettled([0, 1, 2, 3].map(() => narrow.validate({ bytes: valid })));
    out.ms.queueProbe = Math.round(performance.now() - t0);
    const busy = settled.filter((s) => s.status === 'rejected' && s.reason instanceof XsdEngineError && s.reason.reason === 'busy').length;
    const okCount = settled.filter((s) => s.status === 'fulfilled' && s.value.valid).length;
    out.checks.queueEnforced = busy === 2 && okCount === 2;

    out.status = Object.values(out.checks).every(Boolean) ? 'ok' : 'down';
  } catch (error) {
    out.failure = error instanceof XsdEngineError ? error.reason : 'unexpected';
  }
  out.ms.total = Math.round(performance.now() - started);
  out.rssMb.after = rss();
  return out;
}
