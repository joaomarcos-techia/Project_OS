/**
 * C2 — o health check precisa enxergar outage REAL de dependência externa.
 *
 * O buraco que isto fecha: os checks eram `checkConfig(Boolean(env.X))`, ou
 * seja, só perguntavam "a variável existe?". Um provedor totalmente fora do ar,
 * com a key configurada, reportava `ok` — e o uptime monitor ficava verde
 * durante um apagão do WhatsApp. Os runbooks (gemini-down.md) já mandavam olhar
 * `/api/health` como sintoma primário, o que simplesmente não funcionava.
 *
 * O check raso continua existindo para o poll barato; o profundo é o que o
 * monitor usa (`?strict=1` → deep).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  value: {
    GEMINI_API_KEY: 'g-key',
    META_APP_SECRET: 'm-secret',
    META_GRAPH_API_VERSION: 'v21.0',
    ASAAS_API_KEY: 'a-key',
    ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'r-token',
  } as Record<string, string | undefined>,
}));

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock('@/lib/env', () => ({
  get env() {
    return envMock.value;
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

async function freshModule() {
  vi.resetModules();
  return import('./health-probes');
}

beforeEach(() => {
  vi.restoreAllMocks();
  emit.mockReset();
  envMock.value = {
    GEMINI_API_KEY: 'g-key',
    META_APP_SECRET: 'm-secret',
    META_GRAPH_API_VERSION: 'v21.0',
    ASAAS_API_KEY: 'a-key',
    ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'r-token',
  };
});

describe('checkExternals — raso (poll barato)', () => {
  it('NÃO faz chamada de rede', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { checkExternals } = await freshModule();

    const out = await checkExternals(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toEqual({ gemini: 'ok', meta: 'ok', asaas: 'ok', redis: 'ok', reasons: {} });
  });

  it('env ausente continua sendo degraded', async () => {
    envMock.value.GEMINI_API_KEY = undefined;
    const { checkExternals } = await freshModule();

    expect((await checkExternals(false)).gemini).toBe('degraded');
  });
});

describe('checkExternals — profundo (o que o monitor usa)', () => {
  it('provedor no ar (2xx) → ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { checkExternals } = await freshModule();

    expect(await checkExternals(true)).toEqual({
      gemini: 'ok',
      meta: 'ok',
      asaas: 'ok',
      redis: 'ok',
      reasons: {},
    });
  });

  // ─── Diagnóstico (incidente 2026-07-20) ────────────────────────────────────
  // O probe engolia a causa e devolvia só `degraded`. Resultado real em prod:
  // `asaas: degraded`, nada no Sentry, e nenhuma forma de saber se era timeout,
  // 401 ou env ausente. Era um swallow silencioso — a mesma classe do M2 que
  // esta remediação fechou.

  it('reporta o MOTIVO de cada degradação (era o buraco do incidente)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const { checkExternals } = await freshModule();

    const out = await checkExternals(true);
    expect(out.asaas).toBe('degraded');
    expect(out.reasons.asaas).toBe('http_401');
  });

  it('distingue timeout de erro de rede', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);
    const { checkExternals } = await freshModule();

    expect((await checkExternals(true)).reasons.asaas).toBe('timeout');
  });

  it('env ausente reporta `not_configured`, não um falso problema de rede', async () => {
    envMock.value.ASAAS_API_KEY = undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { checkExternals } = await freshModule();

    expect((await checkExternals(true)).reasons.asaas).toBe('not_configured');
  });

  it('emite métrica por provedor degradado — o sinal que faltava', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const { checkExternals } = await freshModule();

    await checkExternals(true);

    expect(emit).toHaveBeenCalledWith(
      'health.external.degraded',
      expect.objectContaining({ provider: 'asaas', reason: 'http_401' }),
    );
  });

  it('PROVEDOR FORA DO AR com key válida → degraded (o falso "ok" do C2)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const { checkExternals } = await freshModule();

    expect(await checkExternals(true)).toEqual({
      gemini: 'degraded',
      meta: 'degraded',
      asaas: 'degraded',
      redis: 'degraded',
      // `network` (não `timeout`): o mock rejeita com Error comum, não TimeoutError.
      reasons: {
        gemini: 'network',
        meta: 'network',
        asaas: 'network',
        redis: 'network',
      },
    });
  });

  it('credencial inválida (401/403) → degraded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const { checkExternals } = await freshModule();

    const out = await checkExternals(true);
    expect(out.gemini).toBe('degraded');
    expect(out.asaas).toBe('degraded');
  });

  it('env ausente NÃO vira chamada de rede', async () => {
    envMock.value.GEMINI_API_KEY = undefined;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const { checkExternals } = await freshModule();

    const out = await checkExternals(true);

    expect(out.gemini).toBe('degraded');
    // meta + asaas + redis = 3 chamadas; gemini não entra.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('faz cache: um 2º poll dentro do TTL não martela o provedor', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const { checkExternals } = await freshModule();

    await checkExternals(true);
    const afterFirst = fetchSpy.mock.calls.length;
    await checkExternals(true);

    expect(fetchSpy.mock.calls.length).toBe(afterFirst);
  });

  it('NUNCA lança — health check não pode derrubar a si mesmo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('explosão síncrona');
    });
    const { checkExternals } = await freshModule();

    await expect(checkExternals(true)).resolves.toMatchObject({ gemini: 'degraded' });
  });
});
