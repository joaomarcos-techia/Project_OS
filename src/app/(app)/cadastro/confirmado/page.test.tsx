import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureDraft: vi.fn(),
  ensureAuthBinding: vi.fn(),
  validateAuthBinding: vi.fn(),
  readOwnedReference: vi.fn(),
  cookieGet: vi.fn(),
  redirect: vi.fn(),
  resolve: vi.fn(),
  ready: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock('@/lib/auth/signup-confirmation-grant', () => ({
  SIGNUP_CONFIRMATION_GRANT_COOKIE: 'qoro_signup_confirm',
  readSignupConfirmationGrant: (value: string | undefined) =>
    value === 'repair-grant'
      ? {
          userId: '11111111-1111-4111-8111-111111111111',
          signupRef: 'b'.repeat(64),
          expiresAt: Date.now() + 60_000,
        }
      : null,
}));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({
  resolvePreTenantOnboarding: mocks.resolve,
}));
vi.mock('@/contexts/onboarding', () => ({
  ensureSignupDraftForVerifiedEmail: mocks.ensureDraft,
  ensureVerifiedSignupAuthBinding: mocks.ensureAuthBinding,
  validateVerifiedSignupAuthUserForClaim: mocks.validateAuthBinding,
  readOwnedSignupReference: mocks.readOwnedReference,
  resolveReadyOwnedSignupOnboarding: mocks.ready,
}));

import CadastroConfirmadoPage from './page';

const page = () => CadastroConfirmadoPage();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'private@example.invalid',
    pendingSignupRef: null,
  });
  mocks.ensureDraft.mockResolvedValue({ ok: true, rowVersion: 7 });
  mocks.ensureAuthBinding.mockResolvedValue({ ok: true });
  mocks.validateAuthBinding.mockResolvedValue({ ok: true });
  mocks.readOwnedReference.mockResolvedValue({ ok: true, signupRef: 'a'.repeat(64) });
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.ready.mockResolvedValue({ ok: false, reason: 'credentials_pending' });
});

describe('/cadastro/confirmado', () => {
  it('oferece a criação da senha e a continuação no próprio aparelho confirmado', async () => {
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('E-mail confirmado');
    expect(html).toContain('name="password"');
    expect(html).toContain('Criar senha e escolher plano');
    expect(html).not.toContain('name="email"');
    expect(html).not.toContain('name="verificationCode"');
    expect(mocks.readOwnedReference).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'private@example.invalid',
    );
    expect(mocks.ensureDraft).not.toHaveBeenCalled();
  });

  it('não pede outra senha quando ela já foi definida', async () => {
    mocks.ready.mockResolvedValue({ ok: true, kind: 'pretenant' });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('href="/cadastro/plano"');
    expect(html).not.toContain('name="password"');
  });

  it('não apresenta formulário quando a prontidão não pode ser verificada', async () => {
    mocks.ready.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('Não foi possível verificar agora');
    expect(html).not.toContain('name="password"');
  });

  it.each(['reserved', 'uncertain'])(
    'permite reconciliar senha já instalada após refresh: %s',
    async (credentialState) => {
      mocks.ready.mockResolvedValue({ ok: false, reason: 'credentials_invalid' });
      mocks.readOwnedReference.mockResolvedValue({
        ok: true,
        signupRef: 'a'.repeat(64),
        credentialState,
      });
      const html = renderToStaticMarkup(await page());
      expect(html).toContain('Digite a mesma senha');
      expect(html).toContain('Confirmar senha e continuar');
      expect(html).toContain('autoComplete="current-password"');
    },
  );

  it('não expõe e-mail nem id de quem confirmou', async () => {
    const html = renderToStaticMarkup(await page());
    expect(html).not.toContain('private@example.invalid');
    expect(html).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it.each([
    [{ ok: false, reason: 'invalid_session' }, '/login'],
    [{ ok: false, reason: 'email_unverified' }, '/login'],
    [{ ok: true, kind: 'redirect', route: '/dashboard' }, '/dashboard'],
  ])('sem sessão verificada a tela NÃO afirma confirmação %#', async (result, destination) => {
    // "E-mail confirmado" numa URL que qualquer um abre seria uma tela mentindo.
    mocks.resolve.mockResolvedValue(result);
    await expect(page()).rejects.toThrow(`REDIRECT:${destination}`);
  });

  it('não mente quando o e-mail não corresponde a um draft', async () => {
    mocks.readOwnedReference.mockResolvedValue({ ok: false, reason: 'gone' });
    await expect(page()).rejects.toThrow('REDIRECT:/auth/auth-error?reason=invalid_token');
  });

  it('mantém uma falha transitória recuperável sem exibir dados privados', async () => {
    mocks.readOwnedReference.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('Não foi possível verificar agora');
    expect(html).toContain('href="/cadastro/confirmado"');
    expect(html).not.toContain('private@example.invalid');
  });

  it('retoma pela referência server-side sem colocá-la na URL', async () => {
    const signupRef = 'a'.repeat(64);
    mocks.resolve.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      pendingSignupRef: signupRef,
    });
    mocks.readOwnedReference.mockResolvedValue({ ok: false, reason: 'gone' });
    mocks.ensureDraft.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('href="/cadastro/confirmado"');
    expect(html).not.toContain(signupRef);
    expect(mocks.ensureDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'private@example.invalid',
      signupRef,
    );
    expect(mocks.validateAuthBinding).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
    });
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();

    mocks.ensureDraft.mockResolvedValueOnce({ ok: true, rowVersion: 7 });
    const confirmedHtml = renderToStaticMarkup(await page());
    expect(confirmedHtml).toContain('E-mail confirmado');
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      signupRef,
    });
    expect(mocks.ensureDraft.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.ensureAuthBinding.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('repara pela referência possuída quando o claim venceu e o rebind anterior falhou', async () => {
    const staleRef = 'a'.repeat(64);
    const ownedRef = 'b'.repeat(64);
    mocks.resolve.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      pendingSignupRef: staleRef,
    });
    mocks.readOwnedReference.mockResolvedValue({ ok: true, signupRef: ownedRef });

    const html = renderToStaticMarkup(await page());

    expect(html).toContain('E-mail confirmado');
    expect(mocks.ensureDraft).not.toHaveBeenCalled();
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      signupRef: ownedRef,
    });
    expect(html).not.toContain(staleRef);
    expect(html).not.toContain(ownedRef);
  });

  it('retoma conta legada markerless pelo grant HttpOnly quando o claim falhou apos o OTP', async () => {
    const repairRef = 'b'.repeat(64);
    mocks.cookieGet.mockReturnValue({ value: 'repair-grant' });
    mocks.readOwnedReference.mockResolvedValue({ ok: false, reason: 'gone' });

    const html = renderToStaticMarkup(await page());

    expect(html).toContain('E-mail confirmado');
    expect(html).not.toContain(repairRef);
    expect(mocks.ensureDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'private@example.invalid',
      repairRef,
    );
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      signupRef: repairRef,
    });
  });

  it('prioriza o grant verificado quando o Auth ainda aponta para uma tentativa antiga', async () => {
    const staleRef = 'a'.repeat(64);
    const repairRef = 'b'.repeat(64);
    mocks.resolve.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      pendingSignupRef: staleRef,
    });
    mocks.cookieGet.mockReturnValue({ value: 'repair-grant' });
    mocks.readOwnedReference.mockResolvedValue({ ok: false, reason: 'gone' });

    const html = renderToStaticMarkup(await page());

    expect(html).toContain('E-mail confirmado');
    expect(mocks.ensureDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'private@example.invalid',
      repairRef,
    );
    expect(mocks.ensureDraft).not.toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'private@example.invalid',
      staleRef,
    );
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'private@example.invalid',
      signupRef: repairRef,
    });
  });
});
