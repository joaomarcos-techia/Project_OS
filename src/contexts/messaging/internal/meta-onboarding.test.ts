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

import { MetaConnectError } from '../errors';

import {
  classifyGraphFailure,
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
  it('válido + ambos escopos → ok, sem WABA declarada quando não há target_ids', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: {
          is_valid: true,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        },
      }),
    );
    await expect(validateTokenScopes('T')).resolves.toEqual({ wabaIds: [] });
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
    await expect(validateTokenScopes('T')).resolves.toEqual({ wabaIds: [] });
  });

  // D78 — caminho documentado pela Meta para descobrir a WABA de um token de
  // Embedded Signup sem `business_management`.
  it('extrai as WABAs de granular_scopes só do escopo de gerência, sem duplicar', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: {
          is_valid: true,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['waba-2', 'waba-1', 'waba-2'] },
            { scope: 'whatsapp_business_messaging', target_ids: ['waba-2', 'waba-9'] },
          ],
        },
      }),
    );
    // `waba-9` só aparece em `messaging`: não autoriza register/subscribe.
    await expect(validateTokenScopes('T')).resolves.toEqual({ wabaIds: ['waba-2', 'waba-1'] });
  });

  it('ignora target_ids malformados sem derrubar a validação', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: {
          is_valid: true,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['waba-1', '', null, 7] },
          ],
        },
      }),
    );
    await expect(validateTokenScopes('T')).resolves.toEqual({ wabaIds: ['waba-1'] });
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
  const granted = (...wabaIds: string[]) => ({ wabaIds });

  it('FINISH: WABA concedida pelo token → número normalizado', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: 'phone-1', display_phone_number: '+55 11 99999-1234' }] }),
    );
    const r = await resolveWabaAndPhone(
      'T',
      { wabaId: 'waba-1', phoneNumberId: 'phone-1' },
      granted('waba-1'),
    );
    expect(r).toEqual({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      phoneNumber: '+5511999991234',
    });
    expect(new URL(urlOf(fetchMock.mock.calls[0]!)).pathname).toContain('/waba-1/phone_numbers');
  });

  it('FINISH_ONLY_WABA (sem phone_number_id) → usa o único número da WABA provada', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: 'phone-only', display_phone_number: '+55 21 98888-0000' }] }),
    );
    const r = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted('waba-1'));
    expect(r).toEqual({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-only',
      phoneNumber: '+5521988880000',
    });
  });

  it('anti-sequestro: WABA fora da allowlist do token → falha sem consultar a Meta', async () => {
    await expect(
      resolveWabaAndPhone(
        'T',
        { wabaId: 'waba-hijack', phoneNumberId: 'phone-x' },
        granted('waba-real'),
      ),
    ).rejects.toMatchObject({ name: 'MetaConnectError', stage: 'account' });
    // Nenhuma chamada: o próprio token já negou o id vindo do navegador.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('anti-sequestro: token não alcança a WABA → falha, sem varrer portfólios', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const p = new URL(String(url)).pathname;
      // 403 é negativa inequívoca; um 400 genérico seria indeterminação e tem
      // teste próprio logo abaixo.
      if (p.includes('/waba-hijack/phone_numbers'))
        return res({ error: { code: 200 } }, false, 403);
      return res({}, false, 404);
    });
    await expect(
      resolveWabaAndPhone('T', { wabaId: 'waba-hijack' }, granted()),
    ).rejects.toMatchObject({ name: 'MetaConnectError', stage: 'account' });
    // D78: o fallback por portfólio foi removido — `business_management` não é
    // exigido no runtime e nenhuma WABA de terceiro pode ser adotada.
    const paths = fetchMock.mock.calls.map((c) => new URL(urlOf(c)).pathname);
    expect(paths).toEqual(['/v21.0/waba-hijack/phone_numbers']);
    expect(paths.some((p) => p.includes('me/businesses'))).toBe(false);
    expect(paths.some((p) => p.includes('owned_whatsapp_business_accounts'))).toBe(false);
  });

  it('sem target_ids no token, a prova continua sendo /{waba}/phone_numbers', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: 'phone-1', display_phone_number: '+55 11 99999-1234' }] }),
    );
    const r = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted());
    expect(r.wabaId).toBe('waba-1');
  });

  it('token com múltiplas WABAs: só a declarada no evento é adotada', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const p = new URL(String(url)).pathname;
      if (p.includes('/waba-b/phone_numbers'))
        return res({ data: [{ id: 'phone-b', display_phone_number: '+55 31 97777-0000' }] });
      return res({}, false, 404);
    });
    const r = await resolveWabaAndPhone(
      'T',
      { wabaId: 'waba-b' },
      granted('waba-a', 'waba-b', 'waba-c'),
    );
    expect(r).toEqual({
      wabaId: 'waba-b',
      phoneNumberId: 'phone-b',
      phoneNumber: '+5531977770000',
    });
    // Nenhuma outra WABA da lista foi consultada nem adotada.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('WABA sem número → MetaConnectError, sem adotar outra conta', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    await expect(
      resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted('waba-1')),
    ).rejects.toMatchObject({ name: 'MetaConnectError', stage: 'account' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ==== D78 — seleção de telefone: nunca por posição em lista ambígua ========

  it('phone_number_id inexistente na WABA → falha; NÃO cai para o primeiro', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: [
          { id: 'phone-a', display_phone_number: '+55 11 90000-0001' },
          { id: 'phone-b', display_phone_number: '+55 11 90000-0002' },
        ],
      }),
    );
    const err = await resolveWabaAndPhone(
      'T',
      { wabaId: 'waba-1', phoneNumberId: 'phone-de-outra-conta' },
      granted('waba-1'),
    ).catch((e) => e);

    expect(err).toMatchObject({ name: 'MetaConnectError', stage: 'account' });
    // A prova do bug antigo: nenhum dos números da lista foi adotado.
    expect(JSON.stringify(err.message)).not.toContain('phone-a');
  });

  it('phone_number_id existente é escolhido por igualdade exata, não por posição', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: [
          { id: 'phone-a', display_phone_number: '+55 11 90000-0001' },
          { id: 'phone-b', display_phone_number: '+55 11 90000-0002' },
        ],
      }),
    );
    const r = await resolveWabaAndPhone(
      'T',
      { wabaId: 'waba-1', phoneNumberId: 'phone-b' },
      granted('waba-1'),
    );
    expect(r).toEqual({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-b',
      phoneNumber: '+5511900000002',
    });
  });

  it('sem phone_number_id e com vários números → seleção ambígua, sem escolher', async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: [
          { id: 'phone-a', display_phone_number: '+55 11 90000-0001' },
          { id: 'phone-b', display_phone_number: '+55 11 90000-0002' },
        ],
      }),
    );
    await expect(
      resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted('waba-1')),
    ).rejects.toMatchObject({ name: 'MetaConnectError', stage: 'phone_ambiguous' });
  });

  it('descarta entradas sem id antes de decidir se há ambiguidade', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ display_phone_number: '+55 11 90000-0001' }, { id: 'phone-b' }] }),
    );
    // Só um número utilizável ⇒ não é ambíguo.
    const r = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted('waba-1'));
    expect(r.phoneNumberId).toBe('phone-b');
  });

  // ==== D78 — indeterminação da Meta ≠ WABA inacessível =====================

  it('HTTP 403 é negativa autoritativa: WABA inacessível, com graphStatus preservado', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 403));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({ name: 'MetaConnectError', stage: 'account', graphStatus: 403 });
  });

  it('5xx NÃO vira WABA inacessível: fica indeterminado', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 1 } }, false, 503));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({
      name: 'MetaConnectError',
      stage: 'provider_unavailable',
      graphStatus: 503,
    });
  });

  it('timeout/rede NÃO vira WABA inacessível: indeterminado sem graphStatus', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const err = await resolveWabaAndPhone('SEGREDO_TOKEN', { wabaId: 'waba-1' }, granted()).catch(
      (e) => e,
    );
    expect(err).toMatchObject({
      name: 'MetaConnectError',
      stage: 'provider_unavailable',
      graphStatus: null,
    });
    // A causa original é preservada para o log, sem vazar o token.
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.message).not.toContain('SEGREDO_TOKEN');
    expect(String(err.cause?.message ?? '')).not.toContain('SEGREDO_TOKEN');
  });

  it('WABA alcançável e vazia continua sendo negativa de conta, não indeterminação', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    await expect(resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted())).rejects.toMatchObject({
      name: 'MetaConnectError',
      stage: 'account',
    });
  });

  // ==== D78 — rate limit NUNCA vira negativa de conta ========================

  it('HTTP 429 não vira `account`: é rate limit, não recusa de acesso', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 4 } }, false, 429));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({
      name: 'MetaConnectError',
      stage: 'provider_rate_limited',
      graphStatus: 429,
      graphCode: 4,
    });
  });

  it('rate limit no CORPO com HTTP 400 também não vira `account`', async () => {
    // A Meta devolve throttling com status 400; classificar pela classe HTTP
    // marcaria a conta como inacessível durante um pico.
    fetchMock.mockResolvedValueOnce(res({ error: { code: 80007 } }, false, 400));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({
      stage: 'provider_rate_limited',
      graphStatus: 400,
      graphCode: 80007,
    });
  });

  it('HTTP 400 sem código documentado é indeterminado, não negativa', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({ stage: 'provider_unavailable', graphStatus: 400, graphCode: 100 });
  });

  it('HTTP 400 com 100/33 É negativa: token sem a permissão de usuário do sistema', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100, error_subcode: 33 } }, false, 400));
    const err = await resolveWabaAndPhone('T', { wabaId: 'waba-1' }, granted()).catch((e) => e);
    expect(err).toMatchObject({ stage: 'account', graphCode: 100, graphSubcode: 33 });
  });

  it('nenhum detalhe sensível vaza no erro classificado', async () => {
    fetchMock.mockResolvedValueOnce(
      res(
        { error: { code: 190, message: 'token SEGREDO_TOKEN inválido', fbtrace_id: 'TRACE-XYZ' } },
        false,
        401,
      ),
    );
    const err = await resolveWabaAndPhone('SEGREDO_TOKEN', { wabaId: 'waba-1' }, granted()).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ stage: 'account', graphStatus: 401, graphCode: 190 });
    const serialized = `${err.message} ${String(err.cause?.message ?? '')}`;
    expect(serialized).not.toContain('SEGREDO_TOKEN');
    expect(serialized).not.toContain('TRACE-XYZ');
    expect(serialized).not.toContain('graph.facebook.com');
  });
});

/**
 * D78 — classificador único. A regra antiga ("todo 4xx é negativa autoritativa")
 * transformava `429 Too Many Requests` (rate limit temporário pelo RFC 6585 §4)
 * em canal quebrado, e vivia duplicada entre o connect e a sonda de saúde.
 */
/**
 * D78 — a classificação precisa valer em TODA etapa do connect, não só na
 * resolução da WABA. Antes, um `429` na troca de code aparecia como "a Meta
 * recusou a autorização", e um timeout no `/register` como "a Meta recusou a
 * ativação do número".
 */
describe('classificação por etapa do connect', () => {
  const RATE_LIMIT_429 = () => res({ error: { code: 4 } }, false, 429);
  const RATE_LIMIT_BODY = () => res({ error: { code: 80007 } }, false, 400);
  const SERVER_ERROR = () => res({}, false, 503);
  const DENIAL = () => res({ error: { code: 190 } }, false, 401);

  const steps = [
    {
      name: 'exchangeCodeForToken',
      functionalStage: 'authorization',
      method: 'GET' as const,
      run: () => exchangeCodeForToken('CODE'),
    },
    {
      name: 'validateTokenScopes',
      functionalStage: 'permissions',
      method: 'GET' as const,
      run: () => validateTokenScopes('TOK'),
    },
    {
      name: 'registerPhoneNumber',
      functionalStage: 'phone_registration',
      method: 'POST' as const,
      run: () => registerPhoneNumber('phone-1', 'TOK', '123456'),
    },
    {
      name: 'subscribeAppToWaba',
      functionalStage: 'webhook_subscription',
      method: 'POST' as const,
      run: () => subscribeAppToWaba('waba-1', 'TOK'),
    },
  ];

  for (const step of steps) {
    describe(step.name, () => {
      it('HTTP 429 → provider_rate_limited, nunca a etapa funcional', async () => {
        fetchMock.mockResolvedValueOnce(RATE_LIMIT_429());
        const err = await step.run().catch((e) => e);
        expect(err).toMatchObject({ stage: 'provider_rate_limited', graphStatus: 429 });
        expect(err.stage).not.toBe(step.functionalStage);
      });

      it('throttling no corpo com HTTP 400 → provider_rate_limited', async () => {
        fetchMock.mockResolvedValueOnce(RATE_LIMIT_BODY());
        const err = await step.run().catch((e) => e);
        expect(err).toMatchObject({ stage: 'provider_rate_limited', graphCode: 80007 });
      });

      // GET indeterminado é seguro ("nada mudou"); POST indeterminado NÃO é.
      const indeterminateStage =
        step.method === 'GET' ? 'provider_unavailable' : 'provider_outcome_unknown';

      it(`HTTP 5xx → ${indeterminateStage}`, async () => {
        fetchMock.mockResolvedValueOnce(SERVER_ERROR());
        const err = await step.run().catch((e) => e);
        expect(err).toMatchObject({ stage: indeterminateStage, graphStatus: 503 });
      });

      it(`timeout/rede → ${indeterminateStage}, sem graphStatus`, async () => {
        fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
        const err = await step.run().catch((e) => e);
        expect(err).toMatchObject({ stage: indeterminateStage, graphStatus: null });
      });

      it('negativa documentada preserva a etapa funcional', async () => {
        fetchMock.mockResolvedValueOnce(DENIAL());
        const err = await step.run().catch((e) => e);
        expect(err).toMatchObject({
          stage: step.functionalStage,
          graphStatus: 401,
          graphCode: 190,
        });
      });

      it('nenhuma falha vaza token, URL, corpo ou fbtrace_id', async () => {
        fetchMock.mockResolvedValueOnce(
          res(
            {
              error: {
                code: 4,
                message: 'segredo secret-xyz e token TOK',
                fbtrace_id: 'TRACE-XYZ',
              },
            },
            false,
            429,
          ),
        );
        const err = await step.run().catch((e) => e);
        const serialized = `${err.message} ${String(err.cause?.message ?? '')}`;
        expect(serialized).not.toContain('TRACE-XYZ');
        expect(serialized).not.toContain('secret-xyz');
        expect(serialized).not.toContain('graph.facebook.com');
        expect(serialized).not.toContain('123456');
      });
    });
  }

  it('mutação indeterminada NÃO é confundida com leitura indeterminada', async () => {
    // O par decisivo: mesmo status, semânticas opostas. No GET dá para dizer
    // que nada mudou; no POST o resultado externo é desconhecido.
    fetchMock.mockResolvedValueOnce(SERVER_ERROR());
    const read = await validateTokenScopes('TOK').catch((e) => e);
    fetchMock.mockResolvedValueOnce(SERVER_ERROR());
    const write = await subscribeAppToWaba('waba-1', 'TOK').catch((e) => e);

    expect(read.stage).toBe('provider_unavailable');
    expect(write.stage).toBe('provider_outcome_unknown');
  });

  it('DELETE indeterminado também é resultado desconhecido', async () => {
    fetchMock.mockResolvedValueOnce(SERVER_ERROR());
    const err = await unsubscribeAppFromWaba('waba-1', 'TOK').catch((e) => e);
    expect(err).toMatchObject({ stage: 'provider_outcome_unknown' });
  });
});

describe('classifyGraphFailure', () => {
  const fail = (status: number | null, code?: number, subcode?: number) =>
    new MetaConnectError('[meta] falha', {
      stage: 'account',
      graphStatus: status,
      graphCode: code ?? null,
      graphSubcode: subcode ?? null,
    });

  it.each([
    ['HTTP 429 puro', fail(429)],
    ['429 com código', fail(429, 4)],
    ['code 4 — app rate limit', fail(400, 4)],
    ['code 17 — user rate limit', fail(400, 17)],
    ['code 341 — application limit', fail(400, 341)],
    ['code 80007 — WABA rate limit', fail(400, 80007)],
    ['code 130429 — throughput', fail(400, 130429)],
    ['code 133016 — register throttling', fail(400, 133016)],
  ])('%s → rate_limited', (_label, err) => {
    expect(classifyGraphFailure(err)).toBe('rate_limited');
  });

  it.each([
    ['code 0 — falha de autenticação', fail(400, 0)],
    ['code 3 — capability/permissão', fail(400, 3)],
    ['code 10 — permissão não concedida', fail(400, 10)],
    ['code 33 — número apagado', fail(400, 33)],
    ['code 102 — sessão inválida', fail(400, 102)],
    ['code 190 — token expirado', fail(400, 190)],
    ['code 200 — permissão', fail(400, 200)],
    ['code 299 — topo da faixa de permissão', fail(400, 299)],
    ['code 131005 — permissão Cloud API', fail(400, 131005)],
    ['code 100 com subcode 33', fail(400, 100, 33)],
    ['HTTP 401', fail(401)],
    ['HTTP 403', fail(403)],
    ['HTTP 404', fail(404)],
  ])('%s → denied', (_label, err) => {
    expect(classifyGraphFailure(err)).toBe('denied');
  });

  it.each([
    ['timeout / rede', fail(null)],
    ['HTTP 500', fail(500)],
    ['HTTP 503', fail(503)],
    ['HTTP 400 sem código', fail(400)],
    ['HTTP 400 com code 100 sem subcode', fail(400, 100)],
    ['code 2 — serviço temporário', fail(400, 2)],
    ['code 131016 — serviço indisponível', fail(400, 131016)],
    ['code 133004 — servidor indisponível', fail(400, 133004)],
    ['HTTP 409 sem código documentado', fail(409)],
  ])('%s → indeterminate', (_label, err) => {
    expect(classifyGraphFailure(err)).toBe('indeterminate');
  });

  it('rate limit vence a negativa quando os dois sinais aparecem', () => {
    // 429 carregando um código da faixa de permissão: o status de throttling é
    // o que descreve a situação; tratar como recusa apagaria a conexão.
    expect(classifyGraphFailure(fail(429, 200))).toBe('rate_limited');
    expect(classifyGraphFailure(fail(403, 4))).toBe('rate_limited');
  });

  it('erro que não é MetaConnectError é indeterminado', () => {
    expect(classifyGraphFailure(new Error('boom'))).toBe('indeterminate');
    expect(classifyGraphFailure(null)).toBe('indeterminate');
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

  it('recusa DOCUMENTADA (code 190) preserva a etapa phone_registration', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 190 } }, false, 400));

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
