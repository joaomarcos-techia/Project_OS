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

import { verifyTurnstileToken } from './turnstile';

const IP = '203.0.113.9';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  envMock.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
  vi.stubGlobal('fetch', fetchMock);
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
