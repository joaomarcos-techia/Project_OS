import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * M2 (auditoria de APIs) — gate único de `/api/cron/**`.
 *
 * O helper recebe `Request` puro justamente para isto: dirigir o gate com
 * `new Request(url, { headers })`, sem runtime do Next.
 */
const envMock = vi.hoisted(() => ({
  value: {
    CRON_SECRET: 'c'.repeat(32),
    CRON_SECRET_DESTRUCTIVE: undefined as string | undefined,
    OUTBOX_CRON_ALLOW_NON_VERCEL: false,
    NODE_ENV: 'production',
  },
}));
const { emit, warn } = vi.hoisted(() => ({ emit: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/env', () => ({
  get env() {
    return envMock.value;
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { assertCronAuth } from './cron-auth';

const SECRET = 'c'.repeat(32);
const DESTRUCTIVE_SECRET = 'd'.repeat(32);

const req = (headers: Record<string, string> = {}): Request =>
  new Request('https://qoro.app/api/cron/outbox', { headers });
const bearer = (s: string) => ({ authorization: `Bearer ${s}` });

beforeEach(() => {
  vi.clearAllMocks();
  envMock.value = {
    CRON_SECRET: SECRET,
    CRON_SECRET_DESTRUCTIVE: undefined,
    OUTBOX_CRON_ALLOW_NON_VERCEL: false,
    NODE_ENV: 'production',
  };
});

describe('Bearer é o gate', () => {
  it('Bearer correto → null (autorizado)', () => {
    expect(assertCronAuth(req(bearer(SECRET)), { route: 'outbox' })).toBeNull();
  });

  it('sem Authorization → 401', async () => {
    const res = assertCronAuth(req(), { route: 'outbox' });
    expect(res?.status).toBe(401);
    expect(await res!.json()).toEqual({ error: 'unauthorized' });
  });

  it('Bearer errado do mesmo tamanho → 401', () => {
    expect(assertCronAuth(req(bearer('x'.repeat(32))), { route: 'outbox' })?.status).toBe(401);
  });

  it('segredo sem o prefixo Bearer → 401', () => {
    expect(assertCronAuth(req({ authorization: SECRET }), { route: 'outbox' })?.status).toBe(401);
  });
});

describe('x-vercel-cron NÃO é gate (F-09)', () => {
  it('Bearer válido sem header de origem → autorizado, mas emite a anomalia', () => {
    expect(assertCronAuth(req(bearer(SECRET)), { route: 'outbox' })).toBeNull();
    expect(emit).toHaveBeenCalledWith('cron.origin_header_missing', { route: 'outbox' });
  });

  it('x-vercel-cron presente → autorizado, sem anomalia', () => {
    expect(assertCronAuth(req({ ...bearer(SECRET), 'x-vercel-cron': '1' }), { route: 'outbox' })).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('cron.origin_header_missing', expect.anything());
  });

  it('x-vercel-cron-schedule (o header que a Vercel realmente documenta) também conta', () => {
    assertCronAuth(req({ ...bearer(SECRET), 'x-vercel-cron-schedule': '* * * * *' }), { route: 'outbox' });
    expect(emit).not.toHaveBeenCalledWith('cron.origin_header_missing', expect.anything());
  });

  it('header ausente NÃO vira 401 nem sem escape hatch — o worker não pode parar em silêncio', () => {
    envMock.value.OUTBOX_CRON_ALLOW_NON_VERCEL = false;
    envMock.value.NODE_ENV = 'production';
    expect(assertCronAuth(req(bearer(SECRET)), { route: 'outbox' })).toBeNull();
  });

  it('fora de produção → nem a anomalia é emitida', () => {
    envMock.value.NODE_ENV = 'development';
    assertCronAuth(req(bearer(SECRET)), { route: 'outbox' });
    expect(emit).not.toHaveBeenCalledWith('cron.origin_header_missing', expect.anything());
  });

  it('OUTBOX_CRON_ALLOW_NON_VERCEL silencia a anomalia em prod', () => {
    envMock.value.OUTBOX_CRON_ALLOW_NON_VERCEL = true;
    assertCronAuth(req(bearer(SECRET)), { route: 'outbox' });
    expect(emit).not.toHaveBeenCalledWith('cron.origin_header_missing', expect.anything());
  });
});

describe('blast radius: segredo destrutivo (V5)', () => {
  beforeEach(() => {
    envMock.value.CRON_SECRET_DESTRUCTIVE = DESTRUCTIVE_SECRET;
  });

  it('rota destrutiva exige o segredo destrutivo', () => {
    const opts = { route: 'patient-hard-delete', destructive: true };
    expect(assertCronAuth(req(bearer(DESTRUCTIVE_SECRET)), opts)).toBeNull();
    // O segredo de monitoring NÃO abre a rota que apaga PII — este é o ponto do V5.
    expect(assertCronAuth(req(bearer(SECRET)), opts)?.status).toBe(401);
  });

  it('rota normal segue no CRON_SECRET, e o destrutivo não a abre', () => {
    const opts = { route: 'outbox' };
    expect(assertCronAuth(req(bearer(SECRET)), opts)).toBeNull();
    expect(assertCronAuth(req(bearer(DESTRUCTIVE_SECRET)), opts)?.status).toBe(401);
  });

  it('sem CRON_SECRET_DESTRUCTIVE, destrutiva cai no CRON_SECRET (retrocompat)', () => {
    envMock.value.CRON_SECRET_DESTRUCTIVE = undefined;
    expect(
      assertCronAuth(req(bearer(SECRET)), { route: 'data-retention', destructive: true }),
    ).toBeNull();
  });
});

describe('fail-close', () => {
  // Mesma regressão travada em health-auth: CRON_SECRET é optional() no schema, e
  // `Bearer ${undefined}` interpola para a string "Bearer undefined".
  it('CRON_SECRET ausente → "Bearer undefined" NÃO autentica', () => {
    envMock.value.CRON_SECRET = undefined as unknown as string;
    expect(assertCronAuth(req({ authorization: 'Bearer undefined' }), { route: 'outbox' })?.status).toBe(401);
    expect(assertCronAuth(req(), { route: 'outbox' })?.status).toBe(401);
  });

  it('CRON_SECRET ausente numa rota destrutiva → 401', () => {
    envMock.value.CRON_SECRET = undefined as unknown as string;
    envMock.value.CRON_SECRET_DESTRUCTIVE = undefined;
    expect(
      assertCronAuth(req({ authorization: 'Bearer undefined' }), { route: 'data-retention', destructive: true })
        ?.status,
    ).toBe(401);
  });
});

describe('observabilidade do 401', () => {
  it('emite métrica + logger.warn (não Sentry — ADR-029 mantém log fora do Sentry)', () => {
    assertCronAuth(req(), { route: 'data-retention', destructive: true });
    const fields = {
      route: 'data-retention',
      destructive: true,
      hasBearer: false,
      hasVercelHeader: false,
      secretConfigured: true,
    };
    expect(emit).toHaveBeenCalledWith('cron.unauthorized', fields);
    expect(warn).toHaveBeenCalledWith('cron.unauthorized', fields);
  });

  it('o 401 não vaza o segredo nem o header recebido', async () => {
    const res = assertCronAuth(req(bearer('segredo-tentado-pelo-atacante')), { route: 'outbox' });
    const body = JSON.stringify(await res!.json());
    expect(body).not.toContain('segredo-tentado-pelo-atacante');
    expect(body).not.toContain(SECRET);
  });
});
