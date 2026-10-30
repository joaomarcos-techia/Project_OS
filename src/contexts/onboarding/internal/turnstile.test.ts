import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { emitMock, warnMock, envMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  warnMock: vi.fn(),
  envMock: { TURNSTILE_SECRET_KEY: 'segredo-de-teste' as string | undefined },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: envMock }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: emitMock } }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: warnMock } }));

import { verifySignupTurnstileProbe, verifyTurnstileToken } from './turnstile';

const IP = '203.0.113.9';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  envMock.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
  vi.stubGlobal('fetch', fetchMock);
});

describe('release probe uses real verifier semantics without granting access', () => {
  const accepted = { success: true, hostname: 'app.qoro.dev', action: 'signup-release-check' };
  const replayed = { success: false, 'error-codes': ['timeout-or-duplicate'] };
  const invalid = { success: false, 'error-codes': ['invalid-input-response'] };

  it('requires positive hostname/action, exact replay rejection and invalid rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(accepted))
      .mockResolvedValueOnce(resposta(replayed))
      .mockResolvedValueOnce(resposta(invalid));
    expect(await verifySignupTurnstileProbe('fresh-token', IP, 'app.qoro.dev')).toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const payloads = fetchMock.mock.calls.map((call) => call[1].body.get('response'));
    expect(payloads).toEqual(['fresh-token', 'fresh-token', 'qoro-release-check-invalid']);
    expect(JSON.stringify(emitMock.mock.calls)).not.toContain('fresh-token');
    expect(JSON.stringify(emitMock.mock.calls)).not.toContain('segredo-de-teste');
  });

  it.each([
    { ...accepted, hostname: 'other.example' },
    { success: true, action: 'signup-release-check' },
    { ...accepted, action: 'login' },
    { success: true, hostname: 'app.qoro.dev' },
  ])('rejects a token for another or absent hostname/action: %j', async (body) => {
    fetchMock.mockResolvedValue(resposta(body));
    expect(await verifySignupTurnstileProbe('token', IP, 'app.qoro.dev')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([accepted, invalid])(
    'does not call a replay PASS on any other outcome: %j',
    async (body) => {
      fetchMock.mockResolvedValueOnce(resposta(accepted)).mockResolvedValueOnce(resposta(body));
      expect(await verifySignupTurnstileProbe('token', IP, 'app.qoro.dev')).toEqual({
        ok: false,
        reason: 'unexpected_result',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not call the invalid test PASS if its token is accepted', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(accepted))
      .mockResolvedValueOnce(resposta(replayed))
      .mockResolvedValueOnce(resposta(accepted));
    expect(await verifySignupTurnstileProbe('token', IP, 'app.qoro.dev')).toEqual({
      ok: false,
      reason: 'unexpected_result',
    });
  });

  it('propagates provider outage instead of treating it as a rejection', async () => {
    fetchMock.mockResolvedValueOnce(resposta(accepted)).mockRejectedValueOnce(new Error('network'));
    expect(await verifySignupTurnstileProbe('token', IP, 'app.qoro.dev')).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it.each([null, 'success', { token: 'must-not-be-logged' }])(
    'rejects malformed provider bodies: %j',
    async (body) => {
      fetchMock.mockResolvedValue(resposta(body));
      expect(await verifyTurnstileToken('token', IP)).toEqual({ ok: false, reason: 'unreachable' });
      expect(JSON.stringify(emitMock.mock.calls)).not.toContain('must-not-be-logged');
    },
  );

  it('filters untrusted provider error content before logging', async () => {
    fetchMock.mockResolvedValue(
      resposta({
        success: false,
        'error-codes': [
          'invalid-input-response',
          'patient@example.test',
          { secret: 'not-for-logs' },
          'x'.repeat(65),
        ],
      }),
    );
    await verifyTurnstileToken('token', IP);
    expect(emitMock).toHaveBeenCalledWith('signup.turnstile.rejected', {
      codes: ['invalid-input-response'],
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function resposta(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('verificação do token do Turnstile', () => {
  it('aceita quando a Cloudflare responde success', async () => {
    fetchMock.mockResolvedValue(resposta({ success: true }));

    expect(await verifyTurnstileToken('token', IP)).toEqual({ ok: true });
  });

  it('manda secret, token e IP — e o segredo NUNCA vai na URL', async () => {
    fetchMock.mockResolvedValue(resposta({ success: true }));

    await verifyTurnstileToken('token-abc', IP);

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    // URL sem query: segredo em query string vaza em log de proxy e histórico.
    expect(url).not.toContain('segredo-de-teste');
    expect(url).not.toContain('?');
    expect(init.body.get('secret')).toBe('segredo-de-teste');
    expect(init.body.get('response')).toBe('token-abc');
    expect(init.body.get('remoteip')).toBe(IP);
  });

  it('recusa quando success é false', async () => {
    fetchMock.mockResolvedValue(
      resposta({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    expect(await verifyTurnstileToken('token', IP)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('revalida cada uso e recusa replay reportado pela Cloudflare', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta({ success: true }))
      .mockResolvedValueOnce(resposta({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await verifyTurnstileToken('same-synthetic-token', IP)).toEqual({ ok: true });
    expect(await verifyTurnstileToken('same-synthetic-token', IP)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resposta malformada não autoriza o desafio', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('invalid JSON');
      },
    });
    expect(await verifyTurnstileToken('synthetic-token', IP)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('reporta os error-codes da Cloudflare, que distinguem reuso de chave errada', async () => {
    fetchMock.mockResolvedValue(
      resposta({ success: false, 'error-codes': ['invalid-input-secret'] }),
    );

    await verifyTurnstileToken('token', IP);

    expect(emitMock).toHaveBeenCalledWith('signup.turnstile.rejected', {
      codes: ['invalid-input-secret'],
    });
  });

  it('token vazio é inválido sem gastar chamada de rede', async () => {
    expect(await verifyTurnstileToken('', IP)).toEqual({ ok: false, reason: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem secret configurada, reporta not_configured — distinto de inválido', async () => {
    envMock.TURNSTILE_SECRET_KEY = undefined;

    // O conserto de cada caso é outro: um é configuração, o outro é tentativa
    // recusada. Colapsar os dois faria o operador procurar no lugar errado.
    expect(await verifyTurnstileToken('token', IP)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP não-ok vira unreachable, não invalid', async () => {
    fetchMock.mockResolvedValue(resposta(null, false, 502));

    expect(await verifyTurnstileToken('token', IP)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('falha de rede vira unreachable e NÃO relança', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    // Não relançar é o contrato: quem chama já decidiu o que fazer com
    // "não consegui verificar" (fecha, no caminho de desafio).
    expect(await verifyTurnstileToken('token', IP)).toEqual({ ok: false, reason: 'unreachable' });
    expect(warnMock).toHaveBeenCalled();
  });

  it('usa timeout — um Cloudflare pendurado não segura a nossa rota', async () => {
    fetchMock.mockResolvedValue(resposta({ success: true }));

    await verifyTurnstileToken('token', IP);

    const [, init] = fetchMock.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
