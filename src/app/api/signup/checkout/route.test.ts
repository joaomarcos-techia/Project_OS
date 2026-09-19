import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  resolve: vi.fn(),
  hashUser: vi.fn(),
  writeLimit: vi.fn(),
  start: vi.fn(),
  provision: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({ resolvePreTenantOnboarding: mocks.resolve }));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hashUser }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftWriteAllowed: mocks.writeLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', () => ({
  startSignupSubscription: mocks.start,
  provisionTenantFromSignup: mocks.provision,
  reconcileSignupSubscription: mocks.reconcile,
}));

import { POST } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'dona@example.invalid';
/** CPF de teste do sandbox Asaas; não é PII real. */
const CPF = '24971563792';
const BODY = JSON.stringify({ cpfCnpj: '249.715.637-92' });

function request(init: { origin?: string; site?: string; body?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('origin', init.origin ?? 'https://app.qoro.test');
  if (init.site) headers.set('sec-fetch-site', init.site);
  return new Request('https://app.qoro.test/api/signup/checkout', {
    method: 'POST',
    headers,
    body: init.body ?? BODY,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
  mocks.hashUser.mockReturnValue('user-hmac');
  mocks.writeLimit.mockResolvedValue({ ok: true });
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: USER_ID,
    email: EMAIL,
  });
  mocks.start.mockResolvedValue({ ok: true, state: 'active', subscriptionId: 'sub_1' });
  mocks.provision.mockResolvedValue({ ok: true, clinicId: 'clinic-1' });
  mocks.reconcile.mockResolvedValue({ ok: true, state: 'active' });
});

describe('POST /api/signup/checkout', () => {
  it('assina e provisiona com a identidade verificada, sem nada vindo do corpo', async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'provisioned' });
    // O documento chega NORMALIZADO (só dígitos) aos dois passos — a máscara
    // que o browser mandou não vaza para o provedor nem para o banco.
    expect(mocks.start).toHaveBeenCalledWith({
      userId: USER_ID,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
    });
    expect(mocks.provision).toHaveBeenCalledWith({
      userId: USER_ID,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
    });
  });

  it('não devolve clinicId nem id de assinatura para o browser', async () => {
    const body = await (await POST(request())).text();

    expect(body).not.toContain('clinic-1');
    expect(body).not.toContain('sub_1');
  });

  it.each([
    ['plano junto do documento', JSON.stringify({ cpfCnpj: CPF, planId: 'outro' })],
    ['preço junto do documento', JSON.stringify({ cpfCnpj: CPF, priceCents: 1 })],
    ['clinic_id forjado', JSON.stringify({ cpfCnpj: CPF, clinicId: 'alheia' })],
    ['papel forjado', JSON.stringify({ cpfCnpj: CPF, role: 'owner' })],
    ['corpo vazio', ''],
    ['sem documento', '{}'],
  ])('recusa campo extra ou ausência em vez de ignorar: %s', async (_l, body) => {
    const res = await POST(request({ body }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it.each([
    ['repetidos, que passam no módulo 11', '11111111111'],
    ['dígito verificador errado', '24971563793'],
    ['comprimento que não é CPF nem CNPJ', '249715637921'],
    ['texto', 'nao tenho'],
  ])('documento inválido é 422 antes de tocar no provedor: %s', async (_l, cpfCnpj) => {
    const res = await POST(request({ body: JSON.stringify({ cpfCnpj }) }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_document' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('aceita CNPJ, não só CPF — clínica pode assinar como pessoa jurídica', async () => {
    const res = await POST(request({ body: JSON.stringify({ cpfCnpj: '11.222.333/0001-81' }) }));

    expect(res.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ cpfCnpj: '11222333000181' }),
    );
  });

  it('não devolve o documento na resposta', async () => {
    const body = await (await POST(request())).text();

    expect(body).not.toContain(CPF);
    expect(body).not.toContain('249');
  });

  it.each([
    ['origem estranha', { origin: 'https://evil.test' }],
    ['navegação cross-site', { site: 'cross-site' }],
  ])('bloqueia %s antes de qualquer efeito', async (_l, init) => {
    const res = await POST(request(init));

    expect(res.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['sem identidade', { ok: false, reason: 'unauthenticated' }, 401],
    ['perfil negado', { ok: false, reason: 'profile_denied' }, 403],
    ['já tem tenant', { ok: true, kind: 'redirect', route: '/dashboard' }, 403],
  ])('%s não chega ao billing', async (_l, resolved, status) => {
    mocks.resolve.mockResolvedValue(resolved);

    expect((await POST(request())).status).toBe(status);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('respeita o limite antes de gastar chamada externa', async () => {
    mocks.writeLimit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 30 });

    const res = await POST(request());

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['recusa do provedor', 'declined', 402],
    ['disputa', 'conflict', 409],
    ['sem plano', 'no_plan', 409],
    ['draft ausente', 'gone', 410],
    ['provedor fora', 'provider_unreachable', 503],
  ])('mapeia %s para o status próprio e não provisiona', async (_l, reason, status) => {
    mocks.start.mockResolvedValue({ ok: false, reason });

    const res = await POST(request());

    expect(res.status).toBe(status);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  describe('creation_unknown: concilia antes de desistir', () => {
    beforeEach(() => {
      mocks.start.mockResolvedValue({ ok: false, reason: 'reconcile_required' });
    });

    it('encontrando a assinatura perdida, segue para o tenant', async () => {
      const res = await POST(request());

      expect(mocks.reconcile).toHaveBeenCalledWith({ userId: USER_ID });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state: 'provisioned' });
      expect(mocks.provision).toHaveBeenCalled();
    });

    it('não encontrando nada, NÃO libera nova criação', async () => {
      mocks.reconcile.mockResolvedValue({ ok: true, state: 'not_found' });

      const res = await POST(request());

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'reconcile_required' });
      // O ponto: provisionar aqui seria dar clínica sem assinatura confirmada.
      expect(mocks.provision).not.toHaveBeenCalled();
    });

    it('provedor fora durante a conciliação não altera nada', async () => {
      mocks.reconcile.mockResolvedValue({ ok: false, reason: 'provider_unreachable' });

      const res = await POST(request());

      expect(res.status).toBe(503);
      expect(mocks.provision).not.toHaveBeenCalled();
    });
  });

  it('assinatura já ativa segue para o provisionamento — é a resposta perdida voltando', async () => {
    mocks.start.mockResolvedValue({ ok: false, reason: 'already_active' });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'provisioned' });
    expect(mocks.provision).toHaveBeenCalled();
  });

  it('sessão já consumida por provisionamento anterior é sucesso, não erro', async () => {
    mocks.provision.mockResolvedValue({ ok: false, reason: 'gone' });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'provisioned' });
  });

  it('não provisiona sobre assinatura não confirmada', async () => {
    mocks.provision.mockResolvedValue({ ok: false, reason: 'not_paid' });

    const res = await POST(request());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_paid' });
  });

  it('fica fechado com o gate desligado, sem tocar em identidade', async () => {
    mocks.env.SIGNUP_IDENTITY_ENABLED = false;

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('erro inesperado vira 503 sem vazar detalhe', async () => {
    mocks.start.mockRejectedValue(new Error('segredo: postgres://user:pass@host/db'));

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('postgres://');
  });
});
