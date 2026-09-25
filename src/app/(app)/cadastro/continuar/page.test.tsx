import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), resolve: vi.fn(), claim: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/contexts/onboarding', () => ({
  claimSignupDraftByVerifiedEmail: mocks.claim,
  resolveReadyOwnedSignupOnboarding: mocks.resolve,
}));

import ContinueSignupPage from './page';

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
  });
  mocks.claim.mockResolvedValue({ ok: true, rowVersion: 6 });
});

describe('/cadastro/continuar', () => {
  it('renderiza somente após a seam e não expõe e-mail/id', async () => {
    const html = renderToStaticMarkup(await ContinueSignupPage());
    expect(html).toContain('Revise seu cadastro');
    expect(html).toContain('Consultando seu cadastro verificado');
    expect(html).not.toContain('private@example.invalid');
    expect(html).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('não vincula draft durante o render: o vínculo é do endpoint limitado', async () => {
    renderToStaticMarkup(await ContinueSignupPage());
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, reason: 'invalid_session' }, '/login'],
    [{ ok: false, reason: 'email_unverified' }, '/login'],
    [{ ok: false, reason: 'credentials_pending' }, '/login'],
    [{ ok: false, reason: 'credentials_invalid' }, '/login'],
    [{ ok: true, kind: 'redirect', route: '/login/mfa' }, '/login/mfa'],
    [{ ok: true, kind: 'redirect', route: '/convite' }, '/convite'],
  ])('redireciona estados que não são pré-tenant %#', async (result, destination) => {
    mocks.resolve.mockResolvedValue(result);
    await expect(ContinueSignupPage()).rejects.toThrow(`REDIRECT:${destination}`);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
