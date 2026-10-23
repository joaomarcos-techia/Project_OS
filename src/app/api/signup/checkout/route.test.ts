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
  complete: vi.fn(),
  provision: vi.fn(),
  reconcile: vi.fn(),
  readBilling: vi.fn(),
  getCustomer: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hashUser }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftWriteAllowed: mocks.writeLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/contexts/onboarding', () => ({
  startSignupHostedCheckout: mocks.start,
  completeSignupHostedCheckout: mocks.complete,
  provisionTenantFromSignup: mocks.provision,
  reconcileSignupSubscription: mocks.reconcile,
  readSignupBilling: mocks.readBilling,
  resolveReadyOwnedSignupOnboarding: mocks.resolve,
}));
vi.mock('@/lib/payments/asaas', () => ({
  asaasProvider: { getCustomer: mocks.getCustomer },
}));

import { POST } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'dona@example.invalid';
const CPF = '24971563792';
const BODY = JSON.stringify({});
const CHECKOUT_URL = 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1';

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
  mocks.start.mockResolvedValue({
    ok: true,
    state: 'checkout_pending',
    checkoutUrl: CHECKOUT_URL,
  });
  mocks.complete.mockResolvedValue({ ok: true, state: 'provisioned' });
  mocks.provision.mockResolvedValue({ ok: true, clinicId: 'clinic-1' });
  mocks.reconcile.mockResolvedValue({ ok: true, state: 'active' });
  mocks.readBilling.mockResolvedValue({
    ok: true,
    snapshot: { asaasCustomerId: 'cus_legacy', asaasSubscriptionId: 'sub_legacy' },
  });
  mocks.getCustomer.mockResolvedValue({ customerId: 'cus_legacy', cpfCnpj: CPF });
});

describe('POST /api/signup/checkout', () => {
  it('cria o Checkout hospedado e não provisiona antes do retorno do Asaas', async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: 'checkout_pending',
      checkoutUrl: CHECKOUT_URL,
    });
    expect(mocks.start).toHaveBeenCalledWith({
      userId: USER_ID,
      publicOrigin: 'https://app.qoro.test',
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('não devolve documento, clinicId ou assinatura para o browser', async () => {
    const body = await (await POST(request())).text();

    expect(body).not.toContain(CPF);
    expect(body).not.toContain('clinic-1');
    expect(body).not.toContain('sub_1');
  });

  it.each([
    ['plano forjado', JSON.stringify({ planId: 'outro' })],
    ['preço forjado', JSON.stringify({ priceCents: 1 })],
    ['clinic_id forjado', JSON.stringify({ clinicId: 'alheia' })],
    ['papel forjado', JSON.stringify({ role: 'owner' })],
    ['documento que deve ficar no Asaas', JSON.stringify({ cpfCnpj: CPF })],
    ['corpo vazio', ''],
  ])('recusa campo extra ou JSON inválido em vez de ignorar: %s', async (_label, body) => {
    const res = await POST(request({ body }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['origem estranha', { origin: 'https://evil.test' }],
    ['navegação cross-site', { site: 'cross-site' }],
  ])('bloqueia %s antes de qualquer efeito', async (_label, init) => {
    const res = await POST(request(init));

    expect(res.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['sem identidade', { ok: false, reason: 'unauthenticated' }, 401],
    ['perfil negado', { ok: false, reason: 'profile_denied' }, 403],
    ['credencial pendente', { ok: false, reason: 'credentials_pending' }, 403],
    ['marcador inválido', { ok: false, reason: 'credentials_invalid' }, 403],
    ['já tem tenant', { ok: true, kind: 'redirect', route: '/dashboard' }, 403],
  ])('%s não chega ao billing', async (_label, resolved, status) => {
    mocks.resolve.mockResolvedValue(resolved);

    expect((await POST(request())).status).toBe(status);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('respeita o limite antes da chamada externa', async () => {
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
  ])('mapeia %s e não provisiona', async (_label, reason, status) => {
    mocks.start.mockResolvedValue({ ok: false, reason });

    const res = await POST(request());

    expect(res.status).toBe(status);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('mantém recuperação dos drafts ativos do contrato anterior', async () => {
    mocks.start.mockResolvedValue({ ok: false, reason: 'already_active' });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'provisioned' });
    expect(mocks.provision).toHaveBeenCalledWith({
      userId: USER_ID,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      expectedAsaasSubscriptionId: 'sub_legacy',
    });
  });

  it('reconfere assinatura do Checkout hospedado ativo antes de provisionar', async () => {
    mocks.start.mockResolvedValue({ ok: false, reason: 'already_active' });
    mocks.readBilling.mockResolvedValue({
      ok: true,
      snapshot: { asaasCheckoutId: 'checkout_1', asaasSubscriptionId: 'sub_1' },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'provisioned' });
    expect(mocks.complete).toHaveBeenCalledWith({ userId: USER_ID, verifiedEmail: EMAIL });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('não declara provisionado se o draft legado expirou durante o readback', async () => {
    mocks.start.mockResolvedValue({ ok: false, reason: 'already_active' });
    mocks.provision.mockResolvedValue({ ok: false, reason: 'gone' });

    const res = await POST(request());

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'gone' });
  });

  it('creation_unknown antigo só provisiona depois da conciliação', async () => {
    mocks.start.mockResolvedValue({ ok: false, reason: 'reconcile_required' });

    const res = await POST(request());

    expect(mocks.reconcile).toHaveBeenCalledWith({ userId: USER_ID });
    expect(res.status).toBe(200);
    expect(mocks.provision).toHaveBeenCalled();
  });

  it('fica fechado com o gate desligado', async () => {
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
