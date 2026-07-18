/**
 * withCron — fronteira única de execução dos 13 crons (C3/A2/A3/M2).
 *
 * O que este teste CONGELA, porque é o que a auditoria cobrava e o que uma
 * refatoração futura pode quebrar sem perceber:
 *  - o nome do evento de erro é o EXISTENTE, passado verbatim (renomear para um
 *    `cron.*.error` uniforme quebraria as saved searches do Better Stack);
 *  - a exceção de background chega ao Sentry COM stack (era o buraco do C3);
 *  - o wrapper NUNCA deixa a exceção escapar (o cron responde 500, não 502 da
 *    plataforma);
 *  - auth negada não executa o handler nem suja o heartbeat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  value: {
    CRON_SECRET: 'c'.repeat(32),
    CRON_SECRET_DESTRUCTIVE: undefined as string | undefined,
    OUTBOX_CRON_ALLOW_NON_VERCEL: false,
    NODE_ENV: 'production',
  },
}));
const { emit, warn, recordHeartbeat, captureBackgroundError, assertCronRuntimeReady } = vi.hoisted(
  () => ({
    emit: vi.fn(),
    warn: vi.fn(),
    recordHeartbeat: vi.fn(async () => {}),
    captureBackgroundError: vi.fn(),
    assertCronRuntimeReady: vi.fn(),
  }),
);

vi.mock('@/lib/env', () => ({
  get env() {
    return envMock.value;
  },
  assertCronRuntimeReady,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));

import { getContext } from '@/lib/observability/context';

import { withCron } from './cron';

const SECRET = 'c'.repeat(32);
const DESTRUCTIVE = 'd'.repeat(32);

const req = (headers: Record<string, string> = {}): Request =>
  new Request('https://qoro.app/api/cron/data-retention', { headers });
const authed = (s = SECRET, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${s}`,
  ...extra,
});

const OPTS = {
  job: 'data-retention',
  route: 'data-retention',
  errorEvent: 'retention.error',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  envMock.value = {
    CRON_SECRET: SECRET,
    CRON_SECRET_DESTRUCTIVE: undefined,
    OUTBOX_CRON_ALLOW_NON_VERCEL: false,
    NODE_ENV: 'production',
  };
});

describe('withCron', () => {
  it('auth negada: 401, handler não executa e heartbeat não é sujo', async () => {
    const handler = vi.fn();
    const res = await withCron(OPTS, handler)(req());

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordHeartbeat).not.toHaveBeenCalled();
    expect(captureBackgroundError).not.toHaveBeenCalled();
  });

  it('sucesso: devolve a Response do handler intacta', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true, purged: { outbox: 3 } }));
    const res = await withCron(OPTS, handler)(req({ ...authed() }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, purged: { outbox: 3 } });
    expect(captureBackgroundError).not.toHaveBeenCalled();
  });

  it('handler lança: emite o evento de erro EXISTENTE (verbatim)', async () => {
    const boom = new Error('kaboom');
    const res = await withCron(OPTS, async () => {
      throw boom;
    })(req({ ...authed() }));

    expect(res.status).toBe(500);
    expect(emit).toHaveBeenCalledWith('retention.error', { error: boom });
  });

  it('handler lança: manda ao Sentry com o flow do cron (C3)', async () => {
    const boom = new Error('kaboom');
    await withCron(OPTS, async () => {
      throw boom;
    })(req({ ...authed() }));

    expect(captureBackgroundError).toHaveBeenCalledWith(boom, { flow: 'cron.data-retention' });
  });

  it('handler lança: registra heartbeat de erro (M2 — antes só o metrics-rollup fazia)', async () => {
    await withCron(OPTS, async () => {
      throw new Error('kaboom');
    })(req({ ...authed() }));

    expect(recordHeartbeat).toHaveBeenCalledWith('data-retention', 'error', expect.any(Object));
  });

  it('handler lança: a exceção NÃO escapa do wrapper', async () => {
    await expect(
      withCron(OPTS, async () => {
        throw new Error('kaboom');
      })(req({ ...authed() })),
    ).resolves.toBeInstanceOf(Response);
  });

  it('abre escopo de correlação com request_id do header e flow do cron', async () => {
    let seen: ReturnType<typeof getContext>;
    await withCron(OPTS, async () => {
      seen = getContext();
      return Response.json({ ok: true });
    })(req({ ...authed(), 'x-request-id': 'req-123' }));

    expect(seen).toMatchObject({ requestId: 'req-123', flow: 'cron.data-retention' });
  });

  it('rota destrutiva usa o CRON_SECRET_DESTRUCTIVE', async () => {
    envMock.value.CRON_SECRET_DESTRUCTIVE = DESTRUCTIVE;
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const run = withCron({ ...OPTS, destructive: true }, handler);

    // o segredo de monitoring não abre a rota destrutiva
    expect((await run(req({ ...authed(SECRET) }))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();

    expect((await run(req({ ...authed(DESTRUCTIVE) }))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('falha de config (assertCronRuntimeReady) é tratada, não escapa', async () => {
    assertCronRuntimeReady.mockImplementationOnce(() => {
      throw new Error('[env] CRON_SECRET is required');
    });

    const res = await withCron(OPTS, async () => Response.json({ ok: true }))(req({ ...authed() }));

    expect(res.status).toBe(500);
    expect(captureBackgroundError).toHaveBeenCalled();
  });
});
