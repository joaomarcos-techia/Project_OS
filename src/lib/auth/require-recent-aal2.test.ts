import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaims = vi.fn();
vi.mock('./supabase-server', () => ({
  createServerClient: async () => ({ auth: { getClaims } }),
}));

import { requireRecentAal2 } from './require-recent-aal2';

const nowSec = () => Math.floor(Date.now() / 1000);

describe('requireRecentAal2 (C15, OR-I1) — step-up MFA', () => {
  beforeEach(() => getClaims.mockReset());

  it('AAL2 com TOTP recente (<10min) → resolve', async () => {
    getClaims.mockResolvedValueOnce({
      data: { claims: { aal: 'aal2', amr: [{ method: 'totp', timestamp: nowSec() - 60 }] } },
    });
    await expect(requireRecentAal2(10)).resolves.toBeUndefined();
  });

  it('AAL2 com TOTP antigo (>10min) → lança', async () => {
    getClaims.mockResolvedValueOnce({
      data: { claims: { aal: 'aal2', amr: [{ method: 'totp', timestamp: nowSec() - 11 * 60 }] } },
    });
    await expect(requireRecentAal2(10)).rejects.toThrow();
  });

  it('AAL1 → lança (precisa MFA)', async () => {
    getClaims.mockResolvedValueOnce({
      data: { claims: { aal: 'aal1', amr: [{ method: 'password', timestamp: nowSec() }] } },
    });
    await expect(requireRecentAal2(10)).rejects.toThrow();
  });

  it('AAL2 sem timestamp de MFA rastreável → lança (falha segura)', async () => {
    getClaims.mockResolvedValueOnce({
      data: { claims: { aal: 'aal2', amr: [{ method: 'password', timestamp: nowSec() }] } },
    });
    await expect(requireRecentAal2(10)).rejects.toThrow();
  });

  it('sem claims → lança', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireRecentAal2(10)).rejects.toThrow();
  });
});
