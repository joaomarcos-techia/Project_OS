/**
 * F2 — helper de Graph do Embedded Signup. `fetch` global mockado. Cobre:
 * endpoints/params corretos, validação de escopo, resolução anti-sequestro
 * (hint só vale se o token alcança), e que o token NUNCA vaza em erro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    META_APP_ID: 'app-123',
    META_APP_SECRET: 'secret-xyz',
    META_GRAPH_API_VERSION: 'v21.0',
    META_HTTP_TIMEOUT_MS: 10_000,
  },
}));

import {
  ensureMessageTemplates,
  exchangeCodeForToken,
  registerPhoneNumber,
  resolveWabaAndPhone,
  subscribeAppToWaba,
  unsubscribeAppFromWaba,
  validateTokenScopes,
} from './meta-onboarding';

type Body = Record<string, unknown>;
const res = (body: Body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (call: unknown[]) => String(call[0]);
const optOf = (call: unknown[]) =>
  call[1] as { method?: string; headers?: Record<string, string>; body?: string };

describe('exchangeCodeForToken', () => {
  it('GET /oauth/access_token com client_id/secret/code → access_token', async () => {
    fetchMock.mockResolvedValueOnce(res({ access_token: 'TOK' }));
    const token = await exchangeCodeForToken('CODE');
    expect(token).toBe('TOK');
    const u = new URL(urlOf(fetchMock.mock.calls[0]!));
    expect(u.pathname).toContain('/v21.0/oauth/access_token');
    expect(u.searchParams.get('client_id')).toBe('app-123');
    expect(u.searchParams.get('client_secret')).toBe('secret-xyz');
    expect(u.searchParams.get('code')).toBe('CODE');
  });

  it('sem access_token → MetaConnectError', async () => {
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(exchangeCodeForToken('CODE')).rejects.toMatchObject({
      name: 'MetaConnectError',
      stage: 'authorization',
    });
  });

  it('HTTP erro → MetaConnectError sem vazar secret/token', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 190 } }, false, 400));
    const err = await exchangeCodeForToken('CODE').catch((e) => e);
    expect(err.name).toBe('MetaConnectError');
    expect(err.stage).toBe('authorization');
    expect(err.message).toContain('code=190');
    expect(err.message).not.toContain('secret-xyz');
    expect(err.message).not.toContain('CODE');
  });

  it('rede inalcançável → MetaConnectError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(exchangeCodeForToken('CODE')).rejects.toMatchObject({ name: 'MetaConnectError' });
  });
});

describe('validateTokenScopes', () => {
  it('válido + ambos escopos → ok', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: {
          is_valid: true,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        },
      }),
    );
    await expect(validateTokenScopes('T')).resolves.toBeUndefined();
    const u = new URL(urlOf(fetchMock.mock.calls[0]!));
    expect(u.pathname).toContain('/debug_token');
    expect(u.searchParams.get('access_token')).toBe('app-123|secret-xyz');
  });

  it('escopos via granular_scopes também contam', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: {
          is_valid: true,
          granular_scopes: [
            { scope: 'whatsapp_business_management' },
            { scope: 'whatsapp_business_messaging' },
          ],
        },
      }),
    );
    await expect(validateTokenScopes('T')).resolves.toBeUndefined();
  });

  it('falta um escopo → MetaConnectError', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: { is_valid: true, scopes: ['whatsapp_business_management'] } }),
    );
    await expect(validateTokenScopes('T')).rejects.toMatchObject({
      name: 'MetaConnectError',
      stage: 'permissions',
    });
  });

  it('token inválido → MetaConnectError', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: { is_valid: false } }));
    await expect(validateTokenScopes('T')).rejects.toMatchObject({ name: 'MetaConnectError' });
  });
});

describe('resolveWabaAndPhone', () => {
  it('hint válido (token alcança a WABA) → número normalizado', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: 'phone-1', display_phone_number: '+55 11 99999-1234' }] }),
    );
    const r = await resolveWabaAndPhone('T', { wabaId: 'waba-1', phoneNumberId: 'phone-1' });
    expect(r).toEqual({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      phoneNumber: '+5511999991234',
    });
    expect(new URL(urlOf(fetchMock.mock.calls[0]!)).pathname).toContain('/waba-1/phone_numbers');
  });

  it('anti-sequestro: token NÃO alcança a WABA do hint → fallback businesses', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const p = new URL(String(url)).pathname;
      if (p.includes('/waba-hijack/phone_numbers'))
        return res({ error: { code: 100 } }, false, 400);
      if (p.includes('/me/businesses')) return res({ data: [{ id: 'biz-1' }] });
      if (p.includes('/biz-1/owned_whatsapp_business_accounts'))
        return res({ data: [{ id: 'waba-real' }] });
      if (p.includes('/waba-real/phone_numbers'))
        return res({ data: [{ id: 'phone-real', display_phone_number: '+55 21 98888-0000' }] });
      return res({}, false, 404);
    });
    const r = await resolveWabaAndPhone('T', { wabaId: 'waba-hijack', phoneNumberId: 'phone-x' });
    expect(r).toEqual({
      wabaId: 'waba-real',
      phoneNumberId: 'phone-real',
      phoneNumber: '+5521988880000',
    });
  });

  it('nenhum número encontrado → MetaConnectError', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const p = new URL(String(url)).pathname;
      if (p.includes('/me/businesses')) return res({ data: [] });
      return res({}, false, 404);
    });
    await expect(resolveWabaAndPhone('T')).rejects.toMatchObject({
      name: 'MetaConnectError',
      stage: 'account',
    });
  });
});

describe('subscribe / unsubscribe', () => {
  it('register ativa o telefone com PIN e não o envia na URL', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await registerPhoneNumber('phone-1', 'TOK', '123456');
    const [call] = fetchMock.mock.calls;
    const url = new URL(urlOf(call!));
    expect(url.pathname).toContain('/phone-1/register');
    expect(url.search).toBe('');
    expect(optOf(call!).method).toBe('POST');
    expect(optOf(call!).headers?.authorization).toBe('Bearer TOK');
    expect(optOf(call!).headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(optOf(call!).body ?? '{}')).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    });
  });

  it('identifica a etapa quando a Meta recusa o registro do número', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));

    const err = await registerPhoneNumber('phone-1', 'TOK', '123456').catch((error) => error);

    expect(err).toMatchObject({ name: 'MetaConnectError', stage: 'phone_registration' });
    expect(err.message).not.toContain('123456');
    expect(err.message).not.toContain('TOK');
  });

  it('subscribe → POST /{waba}/subscribed_apps com bearer', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await subscribeAppToWaba('waba-1', 'TOK');
    const [call] = fetchMock.mock.calls;
    expect(new URL(urlOf(call!)).pathname).toContain('/waba-1/subscribed_apps');
    expect(optOf(call!).method).toBe('POST');
    expect(optOf(call!).headers?.authorization).toBe('Bearer TOK');
  });

  it('unsubscribe → DELETE /{waba}/subscribed_apps', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await unsubscribeAppFromWaba('waba-1', 'TOK');
    expect(optOf(fetchMock.mock.calls[0]!).method).toBe('DELETE');
  });
});

describe('ensureMessageTemplates', () => {
  const definition = (name: string, vars: number) => ({
    kind: 'reminder' as const,
    name,
    category: 'UTILITY' as const,
    languageCode: 'pt_BR',
    body: `Olá {{1}}${vars > 1 ? ' às {{2}}' : ''}, tudo certo?`,
    example: Array.from({ length: vars }, (_, i) => `ex${i + 1}`),
  });

  it('não chama a Meta quando não há definição', async () => {
    expect(await ensureMessageTemplates('waba-1', 'TOK', [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cria só o que falta e reporta o que já existia', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ name: 'ja_existe' }] }));
    fetchMock.mockResolvedValueOnce(res({ id: 'tpl-1' }));

    const outcomes = await ensureMessageTemplates('waba-1', 'TOK', [
      definition('ja_existe', 1),
      definition('novo', 2),
    ]);

    expect(outcomes).toEqual([
      { name: 'ja_existe', status: 'already_exists' },
      { name: 'novo', status: 'created' },
    ]);
    // 1 GET da listagem + 1 POST apenas do que faltava.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(optOf(fetchMock.mock.calls[1]!).method).toBe('POST');
  });

  it('envia o corpo no formato que a Meta espera', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    fetchMock.mockResolvedValueOnce(res({ id: 'tpl-1' }));

    await ensureMessageTemplates('waba-1', 'TOK', [definition('novo', 2)]);

    const body = JSON.parse(String(optOf(fetchMock.mock.calls[1]!).body)) as {
      name: string;
      language: string;
      category: string;
      components: Array<{ type: string; text: string; example?: { body_text: string[][] } }>;
    };
    expect(body).toMatchObject({ name: 'novo', language: 'pt_BR', category: 'UTILITY' });
    // Só BODY: o sender monta apenas esse componente. Header/botão quebraria o envio.
    expect(body.components).toHaveLength(1);
    expect(body.components[0]!.type).toBe('BODY');
    expect(body.components[0]!.example).toEqual({ body_text: [['ex1', 'ex2']] });
  });

  it('uma recusa não impede os outros modelos', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));
    fetchMock.mockResolvedValueOnce(res({ id: 'tpl-2' }));

    const outcomes = await ensureMessageTemplates('waba-1', 'TOK', [
      definition('recusado', 1),
      definition('aceito', 1),
    ]);

    expect(outcomes).toEqual([
      { name: 'recusado', status: 'failed' },
      { name: 'aceito', status: 'created' },
    ]);
  });

  it('nunca lança: listagem indisponível vira failed em todos', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const outcomes = await ensureMessageTemplates('waba-1', 'TOK', [
      definition('a', 1),
      definition('b', 1),
    ]);
    expect(outcomes).toEqual([
      { name: 'a', status: 'failed' },
      { name: 'b', status: 'failed' },
    ]);
    // Não tenta criar às cegas — duplicaria pedidos de revisão na Meta.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não vaza o token quando a Meta recusa', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));
    const outcomes = await ensureMessageTemplates('waba-1', 'SEGREDO', [definition('x', 1)]);
    expect(JSON.stringify(outcomes)).not.toContain('SEGREDO');
  });
});
