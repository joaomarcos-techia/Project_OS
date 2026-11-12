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

import { consultaBatch, consultaGuide } from '../corpus/fixtures';
import { buildLoteGuiasMessage } from '../messages/lote-guias';
import { getTissXsdEngine, XsdEngineError } from './xsd-engine';

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
