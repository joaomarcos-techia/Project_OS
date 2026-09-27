import { beforeEach, describe, expect, it, vi } from 'vitest';

const { record, limit } = vi.hoisted(() => ({ record: vi.fn(), limit: vi.fn() }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupAnswersSchema } = await import('@/contexts/onboarding/internal/signup-answers');
  return { signupAnswersSchema, recordSignupAnswers: record };
});
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupReadAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));

import { POST } from './route';

const answers = {
  professionalsBand: '2_5',
  weeklyAppointmentsBand: '21_50',
  currentTooling: 'outro_sistema',
  discoverySource: 'outro',
  rowVersion: 1,
};
const request = (token?: string, body = JSON.stringify(answers)) =>
  new Request('https://localhost/api/signup/sessions/answers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { cookie: `__Host-qoro_signup=${token}` }),
    },
    body,
  });

describe('POST signup answers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ ok: true });
    record.mockResolvedValue({ ok: true, rowVersion: 2 });
  });

  it('uses cookie authority and the actual strict schema', async () => {
    const res = await POST(request('valid%2Dtoken'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rowVersion: 2 });
    expect(record).toHaveBeenCalledWith('valid-token', answers);
  });

  it.each([undefined, '', '%', '%E0%A4'])(
    'clears unusable cookie %s before persistence',
    async (token) => {
      const res = await POST(request(token));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'gone' });
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(record).not.toHaveBeenCalled();
    },
  );

  it.each(['unknown', 'idle-expired', 'absolute-expired', 'blocked', 'consumed'])(
    'clears gone session %s',
    async (token) => {
      record.mockResolvedValue({ ok: false, reason: 'gone' });
      const res = await POST(request(token));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'gone' });
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    },
  );

  it('preserves a live session cookie on CAS conflict', async () => {
    record.mockResolvedValue({ ok: false, reason: 'conflict' });
    const res = await POST(request('valid'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    '{',
    '{}',
    JSON.stringify({ ...answers, clinicId: 'foreign' }),
    JSON.stringify({ ...answers, discoverySource: 'Alice' }),
    JSON.stringify({ ...answers, rowVersion: 0 }),
  ])('rejects invalid JSON/schema before persistence', async (body) => {
    expect((await POST(request('valid', body))).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it('limits before reading the body or persisting', async () => {
    limit.mockResolvedValue({ ok: false });
    const req = request('valid');
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(req.bodyUsed).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('caps actual bytes at 1024, including multibyte input', async () => {
    const raw = JSON.stringify(answers);
    expect((await POST(request('valid', raw + ' '.repeat(1024 - raw.length)))).status).toBe(200);
    record.mockClear();
    expect((await POST(request('valid', raw + ' '.repeat(1025 - raw.length)))).status).toBe(413);
    expect((await POST(request('valid', JSON.stringify({ value: 'é'.repeat(600) })))).status).toBe(
      413,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('cancels large streaming input without Content-Length early', async () => {
    let bytes = 0;
    let cancelled = false;
    const total = 8 * 1024 * 1024;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (bytes === total) {
            controller.close();
            return;
          }
          bytes += 65536;
          controller.enqueue(new Uint8Array(65536));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' };
    expect(
      (await POST(new Request('https://localhost/api/signup/sessions/answers', init))).status,
    ).toBe(413);
    expect(cancelled).toBe(true);
    expect(bytes).toBeLessThan(total);
    expect(record).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    record.mockRejectedValue(new Error('database unavailable'));
    await expect(POST(request('valid'))).rejects.toThrow('database unavailable');
  });
});
