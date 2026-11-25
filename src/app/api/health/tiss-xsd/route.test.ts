import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ healthAuthLevel: vi.fn(), tissXsdSelfCheck: vi.fn(), tissXsdLimitsProbe: vi.fn() }));

vi.mock('@/lib/http/health-auth', () => ({ healthAuthLevel: mocks.healthAuthLevel }));
vi.mock('@/contexts/health-insurance', () => ({
  tissXsdSelfCheck: mocks.tissXsdSelfCheck,
  tissXsdLimitsProbe: mocks.tissXsdLimitsProbe,
}));

import { GET } from './route';

const report = (status: 'ok' | 'down') => ({
  status,
  engine: 'xmllint-wasm@5.3.0',
  schemaVersion: '4.03.00',
  schemaSetSha256: 'c'.repeat(64),
  failure: status === 'ok' ? null : 'unavailable',
  checks: { validAccepted: status === 'ok', invalidRejected: true, hostileRejected: true },
  ms: { valid: 1, invalid: 1, total: 2 },
  rssMb: 1,
});
const limits = (status: 'ok' | 'down') => ({
  status,
  checks: { namespaceRejected: true, largeBatchAccepted: true, timeoutEnforced: true, memoryLimitEnforced: status === 'ok', queueEnforced: true },
});
const call = (query = '') => GET(new Request(`https://app.qoro.dev/api/health/tiss-xsd${query}`));

describe('GET /api/health/tiss-xsd (P9.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tissXsdSelfCheck.mockResolvedValue(report('ok'));
    mocks.tissXsdLimitsProbe.mockResolvedValue(limits('ok'));
  });

  it('sem credencial: 401 e nem o autoteste nem a sonda rodam', async () => {
    mocks.healthAuthLevel.mockResolvedValueOnce('denied');
    const res = await call('?probe=limits');
    expect(res.status).toBe(401);
    expect(mocks.tissXsdSelfCheck).not.toHaveBeenCalled();
    expect(mocks.tissXsdLimitsProbe).not.toHaveBeenCalled();
  });

  it('monitoramento: 200 com o relatório quando o motor confere; 503 quando falha', async () => {
    mocks.healthAuthLevel.mockResolvedValue('monitoring');
    const ok = await call();
    expect([ok.status, ok.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(await ok.json()).toMatchObject({ status: 'ok', engine: 'xmllint-wasm@5.3.0', runtime: { node: process.version } });
    expect(mocks.tissXsdLimitsProbe).not.toHaveBeenCalled();
    mocks.tissXsdSelfCheck.mockResolvedValueOnce(report('down'));
    expect((await call()).status).toBe(503);
  });

  it('?probe=limits: a sonda de limites entra no relatório; um limite que não vale dá 503', async () => {
    mocks.healthAuthLevel.mockResolvedValue('monitoring');
    const ok = await call('?probe=limits');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ limits: { status: 'ok' } });
    mocks.tissXsdLimitsProbe.mockResolvedValueOnce(limits('down'));
    expect((await call('?probe=limits')).status).toBe(503);
    // Motor fora: a sonda nem roda.
    mocks.tissXsdLimitsProbe.mockClear();
    mocks.tissXsdSelfCheck.mockResolvedValueOnce(report('down'));
    expect((await call('?probe=limits')).status).toBe(503);
    expect(mocks.tissXsdLimitsProbe).not.toHaveBeenCalled();
  });
});
