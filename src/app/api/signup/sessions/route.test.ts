import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, env } = vi.hoisted(() => ({
  create: vi.fn(),
  // Mutável de propósito: o kill switch do §21.20 é lido A CADA requisição, e o
  // teste precisa virá-lo entre casos sem reimportar a rota.
  env: { APP_BASE_URL: 'https://localhost', SIGNUP_ENABLED: true },
}));
vi.mock('@/contexts/onboarding', () => ({ createSignupSession: create }));
vi.mock('@/lib/auth/rate-limit', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/env', () => ({ env }));

import { POST } from './route';

const state = {
  status: 'initiated',
  rowVersion: 1,
  riskLevel: 0,
  expiresAt: '2026-09-14T15:00:00Z',
  answers: null,
};
const request = (body: string) =>
  new Request('https://localhost/api/signup/sessions', {
    method: 'POST',
    headers: { origin: 'https://localhost', 'content-type': 'application/json' },
    body,
  });

describe('POST signup sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.SIGNUP_ENABLED = true;
    create.mockResolvedValue({ ok: true, rawToken: 'synthetic-cookie', state });
  });

  it('fecha a entrada quando o kill switch está desligado, sem tocar no serviço', async () => {
    env.SIGNUP_ENABLED = false;
    const res = await POST(request('{}'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    // O ponto do portão: nenhuma linha, nenhum cookie, nenhum orçamento gasto.
    expect(create).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('falha de infraestrutura vira 503 acionavel, nao 500 opaco', async () => {
    // Medido no Preview: uma janela transitória devolvia `500` com corpo VAZIO —
    // sem código, sem Retry-After, nada que o cliente do funil saiba tratar.
    // As rotas irmãs (draft, plano, checkout) já convertiam; esta não.
    create.mockRejectedValue(new Error('conexao caiu no meio'));

    const res = await POST(request('{}'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('nao esconde o erro do cliente atras de um sucesso', async () => {
    create.mockRejectedValue(new Error('segredo: postgres://user:senha@host/db'));

    const res = await POST(request('{}'));
    const body = await res.text();

    expect(res.status).toBe(503);
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('senha');
  });

  it('recusa antes de ler o corpo, mesmo num corpo que seria rejeitado depois', async () => {
    env.SIGNUP_ENABLED = false;
    // Sem o portão este corpo daria 400 (JSON inválido). Com ele, 503 prova que
    // a decisão vem ANTES de qualquer leitura — é o que o torna barato sob abuso.
    const res = await POST(request('{'));

    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates only the sanitized state and a host-only HttpOnly cookie', async () => {
    const res = await POST(request('{}'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ session: state });
    expect(res.headers.get('set-cookie')).toContain('__Host-qoro_signup=');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=lax', 'Path=/']) {
      expect(res.headers.get('set-cookie')).toContain(attribute);
    }
    expect(res.headers.get('set-cookie')).not.toContain('Domain=');
    expect(create).toHaveBeenCalledWith({
      ip: '127.0.0.1',
      origin: 'https://localhost',
      expectedHost: 'localhost',
    });
  });

  it('usa o host efetivo do Preview para não classificar a própria página como cross-site', async () => {
    const previewRequest = new Request(
      'https://project-os-git-preview.example.vercel.app/api/signup/sessions',
      {
        method: 'POST',
        headers: {
          origin: 'https://project-os-git-preview.example.vercel.app',
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );

    expect((await POST(previewRequest)).status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://project-os-git-preview.example.vercel.app',
        expectedHost: 'project-os-git-preview.example.vercel.app',
      }),
    );
  });

  it.each([
    ['rate_limited', 429],
    ['at_capacity', 503],
    ['blocked', 403],
    ['challenge_required', 401],
  ])('preserves %s', async (reason, status) => {
    create.mockResolvedValue({ ok: false, reason });
    const res = await POST(request('{}'));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
    expect(res.headers.get('retry-after')).toBe(status === 429 || status === 503 ? '60' : null);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    '{',
    '{"clinicId":"foreign"}',
    '{"turnstileToken":""}',
    JSON.stringify({ turnstileToken: 'x'.repeat(2049) }),
  ])('rejects invalid JSON/schema without service effects', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts the existing 2048-character Turnstile schema, including JSON escapes', async () => {
    const token = 'a'.repeat(2048);
    expect((await POST(request(JSON.stringify({ turnstileToken: token })))).status).toBe(201);
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ turnstileToken: token }));
    expect(
      (await POST(request('{"turnstileToken":"' + '\\u0061'.repeat(2048) + '"}'))).status,
    ).toBe(201);
  });

  it('cancels a large stream without Content-Length before reading the remainder', async () => {
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
    expect((await POST(new Request('https://localhost/api/signup/sessions', init))).status).toBe(
      413,
    );
    expect(cancelled).toBe(true);
    expect(bytes).toBeLessThan(total);
    expect(create).not.toHaveBeenCalled();
  });

  it('enforces actual byte boundaries, including multibyte text', async () => {
    const cap = 16 * 1024;
    expect((await POST(request('{}' + ' '.repeat(cap - 2)))).status).toBe(201);
    create.mockClear();
    expect((await POST(request('{}' + ' '.repeat(cap - 1)))).status).toBe(413);
    expect(
      (await POST(request(JSON.stringify({ turnstileToken: 'é'.repeat(cap / 2) })))).status,
    ).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  /*
   * Este caso mudou de significado em 18/09/2026.
   *
   * Ele fixava o comportamento antigo: deixar a exceção subir, o que no runtime
   * vira `500` com corpo VAZIO. O Preview mostrou o custo disso — o cliente do
   * funil recebia um status que não sabe tratar, sem código e sem Retry-After,
   * numa janela transitória de infraestrutura.
   *
   * As três rotas irmãs (draft, plano, checkout) já convertiam para `503`. O
   * contrato do grupo era esse; esta rota é que era a exceção. O caso agora
   * prova a conversão, e os dois casos acima provam que ela não engole detalhe
   * nem vaza segredo.
   */
  it('converte indisponibilidade do servico em 503, em vez de propagar', async () => {
    create.mockRejectedValue(new Error('database unavailable'));

    const res = await POST(request('{}'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });
});
