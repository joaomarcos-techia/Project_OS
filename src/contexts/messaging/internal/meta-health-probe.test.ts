/**
 * META-001 — sondagem read-only do canal contra o Graph (`fetch` global mockado).
 *
 * Complementa `channel-health.test.ts`: lá se testa o VEREDITO a partir de um
 * probe pronto; aqui se testa a TRADUÇÃO das respostas reais do Graph em
 * outcomes — inclusive a distinção entre uma negativa DOCUMENTADA (401/403/404
 * ou código Meta de autorização) e indeterminação (5xx, timeout, rate limit,
 * 400 sem código reconhecido), que é o que impede o health de derrubar todas as
 * clínicas durante uma instabilidade ou um pico de tráfego da Meta.
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

import { evaluateChannelHealth } from './channel-health';
import { probeMetaChannel } from './meta-onboarding';

type Body = Record<string, unknown>;
const res = (body: Body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const fetchMock = vi.fn();

const VALID_TOKEN = {
  data: {
    is_valid: true,
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
  },
};

const INPUT = {
  token: 'TENANT-TOKEN',
  wabaId: 'waba-1',
  phoneNumberId: 'phone-1',
  expectedAppId: 'app-123',
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('probeMetaChannel — leitura do estado externo', () => {
  it('1. tudo válido: token, escopos, número e app inscrito', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ whatsapp_business_api_data: { id: 'app-123' } }] }))
      .mockResolvedValueOnce(res({ account_review_status: 'APPROVED' }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe).toEqual({
      token: 'ok',
      scopes: 'ok',
      phone: 'ok',
      waba: 'ok',
      appSubscription: 'ok',
      phoneStatus: 'ok',
      accountReview: 'ok',
    });
    expect(evaluateChannelHealth(probe).verdict).toBe('healthy');
  });

  it('6. subscribed_apps VAZIO com HTTP 200 → appSubscription failed (o achado)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [] }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.waba).toBe('ok'); // a WABA responde; o que falta é a assinatura
    expect(probe.appSubscription).toBe('failed');
    expect(evaluateChannelHealth(probe)).toEqual({
      verdict: 'broken',
      reasons: ['app_not_subscribed'],
    });
  });

  it('7. subscribed_apps com app de TERCEIRO → failed', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ whatsapp_business_api_data: { id: 'app-999' } }] }));

    expect((await probeMetaChannel(INPUT)).appSubscription).toBe('failed');
  });

  it('aceita o `id` no topo do item, além do aninhado', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ id: 'app-123' }] }));

    expect((await probeMetaChannel(INPUT)).appSubscription).toBe('ok');
  });

  it('lista não vazia sem app esperado configurado → unknown, não failed', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ id: 'app-outro' }] }));

    const probe = await probeMetaChannel({ ...INPUT, expectedAppId: null });
    expect(probe.appSubscription).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('lista VAZIA continua failed mesmo sem app esperado — ninguém recebe webhook', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [] }));

    expect((await probeMetaChannel({ ...INPUT, expectedAppId: null })).appSubscription).toBe(
      'failed',
    );
  });

  it('2. is_valid=false → token failed e nenhuma chamada seguinte', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: { is_valid: false } }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.token).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(evaluateChannelHealth(probe).reasons).toEqual(['token_invalid']);
  });

  it('3. escopo obrigatório ausente → scopes failed', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res({ data: { is_valid: true, scopes: ['whatsapp_business_management'] } }),
      )
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ id: 'app-123' }] }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.scopes).toBe('failed');
    expect(evaluateChannelHealth(probe).reasons).toEqual(['scopes_missing']);
  });

  it('aceita granular_scopes como fonte de escopo', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res({
          data: {
            is_valid: true,
            granular_scopes: [
              { scope: 'whatsapp_business_management' },
              { scope: 'whatsapp_business_messaging' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [{ id: 'app-123' }] }));

    expect((await probeMetaChannel(INPUT)).scopes).toBe('ok');
  });

  it('4. phone ID inválido (404) → phone failed, sem contaminar os demais', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ error: { code: 100 } }, false, 404))
      .mockResolvedValueOnce(res({ data: [{ id: 'app-123' }] }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.phone).toBe('failed');
    expect(probe.appSubscription).toBe('ok');
    expect(evaluateChannelHealth(probe).reasons).toEqual(['phone_unreachable']);
  });

  it('5. WABA inacessível (403) → waba failed', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ error: { code: 200 } }, false, 403));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.waba).toBe('failed');
    expect(probe.appSubscription).toBe('unknown');
    expect(evaluateChannelHealth(probe).reasons).toEqual(['waba_unreachable']);
  });

  it('8. timeout do Graph no debug_token → unknown (indeterminado), NÃO failed', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.token).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('9. code 190 no debug_token → failed (negativa documentada de token)', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 190 } }, false, 400));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.token).toBe('failed');
    expect(evaluateChannelHealth(probe).verdict).toBe('broken');
  });

  it('10. Graph 5xx → unknown; instabilidade da Meta não derruba a conexão', async () => {
    fetchMock.mockResolvedValueOnce(res({}, false, 503));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.token).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  // D78 — a regra antiga ("todo 4xx nega") marcava como quebrado todo canal
  // sondado durante um pico de tráfego. Rate limit não é evidência de recusa.
  it('D78: HTTP 429 no debug_token → unknown, NUNCA failed', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 4 } }, false, 429));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.token).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('D78: rate limit no CORPO com HTTP 400 → waba unknown, não failed', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ error: { code: 80007 } }, false, 400));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.waba).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).not.toBe('broken');
  });

  it('D78: HTTP 400 sem código documentado → unknown (conservador)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));

    expect((await probeMetaChannel(INPUT)).waba).toBe('unknown');
  });

  it('D78: HTTP 400 com 100/33 continua sendo negativa de acesso', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ error: { code: 100, error_subcode: 33 } }, false, 400));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.waba).toBe('failed');
    expect(evaluateChannelHealth(probe).reasons).toEqual(['waba_unreachable']);
  });

  it('11. resposta parcial: subscribed_apps cai em 500 após token/phone OK', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({}, false, 500));

    const probe = await probeMetaChannel(INPUT);
    expect(probe).toMatchObject({ token: 'ok', phone: 'ok', waba: 'unknown' });
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('sem wabaId local (linha legada) → não inventa veredito sobre a assinatura', async () => {
    fetchMock.mockResolvedValueOnce(res(VALID_TOKEN)).mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));

    const probe = await probeMetaChannel({ ...INPUT, wabaId: null });
    expect(probe.waba).toBe('unknown');
    expect(probe.appSubscription).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('só faz GET: a sondagem NUNCA reinscreve o app', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [] }));

    await probeMetaChannel(INPUT);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as { method?: string }).method).toBe('GET');
    }
  });

  it('nunca vaza o token do tenant nem o app secret na URL do subscribed_apps', async () => {
    fetchMock
      .mockResolvedValueOnce(res(VALID_TOKEN))
      .mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }))
      .mockResolvedValueOnce(res({ data: [] }));

    await probeMetaChannel(INPUT);
    const subscribedCall = fetchMock.mock.calls[2]!;
    expect(String(subscribedCall[0])).not.toContain('TENANT-TOKEN');
    expect(String(subscribedCall[0])).not.toContain('secret-xyz');
    // O token do tenant vai no header Authorization, não na query.
    const headers = (subscribedCall[1] as { headers?: Record<string, string> }).headers ?? {};
    expect(headers.authorization).toBe('Bearer TENANT-TOKEN');
  });
});

/**
 * Sondas acrescentadas depois do META-001. A Meta NÃO expõe método de pagamento
 * no nó da WABA, então não há sonda de crédito; estas são as duas negativas
 * documentadas mais próximas de "conectado na tela, mudo na prática".
 */
describe('probeMetaChannel — status do número e revisão da conta', () => {
  const okToken = () => fetchMock.mockResolvedValueOnce(res(VALID_TOKEN));
  const okSubscription = () =>
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ whatsapp_business_api_data: { id: 'app-123' } }] }),
    );

  it('pede o status junto do id — sem GET extra para o número', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ account_review_status: 'APPROVED' }));

    await probeMetaChannel(INPUT);
    const phoneUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(phoneUrl.searchParams.get('fields')).toBe('id,status');
  });

  it('número alcançável mas FLAGGED → phoneStatus failed', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'FLAGGED' }));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ account_review_status: 'APPROVED' }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.phone).toBe('ok'); // responde 200 — alcançar não é enviar
    expect(probe.phoneStatus).toBe('failed');
    expect(evaluateChannelHealth(probe)).toEqual({
      verdict: 'broken',
      reasons: ['phone_not_connected'],
    });
  });

  it('resposta sem o campo status não inventa veredito', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1' }));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ account_review_status: 'APPROVED' }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.phoneStatus).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('404 no número não duplica a causa', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 404));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ account_review_status: 'APPROVED' }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.phone).toBe('failed');
    expect(probe.phoneStatus).toBe('unknown');
    expect(evaluateChannelHealth(probe).reasons).toEqual(['phone_unreachable']);
  });

  it('conta REJECTED → accountReview failed', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ account_review_status: 'REJECTED' }));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.accountReview).toBe('failed');
    expect(evaluateChannelHealth(probe)).toEqual({
      verdict: 'broken',
      reasons: ['account_rejected'],
    });
  });

  it.each(['APPROVED', 'PENDING', 'DEFERRED'])(
    'conta %s não rebaixa: fila de revisão ainda atende',
    async (status) => {
      okToken();
      fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));
      okSubscription();
      fetchMock.mockResolvedValueOnce(res({ account_review_status: status }));

      const probe = await probeMetaChannel(INPUT);
      expect(probe.accountReview).toBe('ok');
      expect(evaluateChannelHealth(probe).verdict).toBe('healthy');
    },
  );

  it('5xx na revisão é indeterminação, não negativa', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));
    okSubscription();
    fetchMock.mockResolvedValueOnce(res({ error: { code: 1 } }, false, 500));

    const probe = await probeMetaChannel(INPUT);
    expect(probe.accountReview).toBe('unknown');
    expect(evaluateChannelHealth(probe).verdict).toBe('indeterminate');
  });

  it('sem wabaId não consulta a revisão', async () => {
    okToken();
    fetchMock.mockResolvedValueOnce(res({ id: 'phone-1', status: 'CONNECTED' }));

    const probe = await probeMetaChannel({ ...INPUT, wabaId: null });
    expect(probe.accountReview).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
