import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ healthAuthLevel: vi.fn(), tissXsdSelfCheck: vi.fn() }));

vi.mock('@/lib/http/health-auth', () => ({ healthAuthLevel: mocks.healthAuthLevel }));
vi.mock('@/contexts/health-insurance', () => ({ tissXsdSelfCheck: mocks.tissXsdSelfCheck }));

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

describe('GET /api/health/tiss-xsd (P9.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tissXsdSelfCheck.mockResolvedValue(report('ok'));
  });

  it('sem credencial: 401 e o autoteste nem roda', async () => {
    mocks.healthAuthLevel.mockResolvedValueOnce('denied');
    const res = await GET(new Request('https://app.qoro.dev/api/health/tiss-xsd'));
    expect(res.status).toBe(401);
    expect(mocks.tissXsdSelfCheck).not.toHaveBeenCalled();
  });

  it('monitoramento: 200 com o relatório quando o motor confere; 503 quando falha', async () => {
    mocks.healthAuthLevel.mockResolvedValue('monitoring');
    const ok = await GET(new Request('https://app.qoro.dev/api/health/tiss-xsd'));
    expect([ok.status, ok.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(await ok.json()).toMatchObject({ status: 'ok', engine: 'xmllint-wasm@5.3.0' });
    mocks.tissXsdSelfCheck.mockResolvedValueOnce(report('down'));
    expect((await GET(new Request('https://app.qoro.dev/api/health/tiss-xsd'))).status).toBe(503);
  });
});
