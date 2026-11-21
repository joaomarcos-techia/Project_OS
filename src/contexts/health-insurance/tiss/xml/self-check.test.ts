/**
 * Autoteste e sonda de limites do motor XSD com o motor REAL (xmllint-wasm do app):
 * é o mesmo código que a rota /api/health/tiss-xsd roda na Preview.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { tissXsdLimitsProbe, tissXsdSelfCheck } from './self-check';

describe('autoteste do motor XSD (P9.2)', () => {
  it('válido aceito, inválido recusado pelo XSD, hostil recusado antes do parser', async () => {
    const r = await tissXsdSelfCheck();
    expect(r).toMatchObject({ status: 'ok', failure: null, checks: { validAccepted: true, invalidRejected: true, hostileRejected: true } });
  }, 60_000);

  it('sonda de limites: namespace, lote grande, timeout, memória e fila valem de verdade', async () => {
    const p = await tissXsdLimitsProbe();
    expect(p.failure).toBeNull();
    expect(p.checks).toEqual({
      namespaceRejected: true,
      largeBatchAccepted: true,
      timeoutEnforced: true,
      memoryLimitEnforced: true,
      queueEnforced: true,
    });
    expect(p.status).toBe('ok');
    // 100 guias × 30 procedimentos (~2,8 MiB) e 100 × 150 (~13 MiB, acima do teto de 16 MiB de WASM).
    expect(p.sizes.largeBatchBytes).toBeGreaterThan(2_000_000);
    expect(p.sizes.memoryProbeBytes).toBeGreaterThan(10_000_000);
  }, 180_000);
});
