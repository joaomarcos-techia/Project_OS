import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

import {
  legacySignupTrialEnd,
  readSignupAuthCreatedAt,
  resolveSignupTrialTerms,
} from './signup-trial';

const USER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('marco do trial no cadastro', () => {
  it('lê a criação do mesmo usuário diretamente no Auth', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER_ID, created_at: '2026-10-19T13:45:00.000Z' } },
      error: null,
    });
    await expect(readSignupAuthCreatedAt(USER_ID)).resolves.toEqual(
      new Date('2026-10-19T13:45:00.000Z'),
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    { user: { id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-19T13:45:00Z' } },
    { user: { id: USER_ID, created_at: 'invalid' } },
    { user: null },
  ])('recusa identidade ou data inválida: %j', async ({ user }) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    await expect(readSignupAuthCreatedAt(USER_ID)).resolves.toBeNull();
  });

  it('recusa falha externa sem vazar detalhes', async () => {
    mocks.getUser.mockRejectedValue(new Error('private provider response'));
    await expect(readSignupAuthCreatedAt(USER_ID)).resolves.toBeNull();
    await expect(readSignupAuthCreatedAt('not-a-uuid')).resolves.toBeNull();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it('preserva os sete dias legados depois da tentativa', () => {
    expect(legacySignupTrialEnd(new Date('2026-10-19T13:45:00Z')).toISOString()).toBe(
      '2026-10-26T13:45:00.000Z',
    );
  });

  it('calcula 14 dias exatos desde Auth e cobra no dia posterior', async () => {
    expect(
      resolveSignupTrialTerms({
        planCode: 'consultorio_2026',
        attemptedAt: new Date('2026-10-20T10:00:00Z'),
        authCreatedAt: new Date('2026-10-19T13:45:00Z'),
      }),
    ).toEqual({
      endsAt: new Date('2026-11-02T13:45:00Z'),
      firstDueDate: '2026-11-03',
      days: 14,
      strictDeadline: true,
      expiredAtCheckout: false,
    });
  });

  it('mantém 14 dias exatos na meia-noite brasileira sem antecipar o vencimento', () => {
    const createdAt = new Date('2026-10-27T02:59:59.000Z'); // 26/10 23:59:59 em Brasília
    const beforeDeadline = new Date('2026-11-10T02:59:58.000Z');
    const atDeadline = new Date('2026-11-10T02:59:59.000Z');
    expect(
      resolveSignupTrialTerms({
        planCode: 'clinica_2026_2',
        attemptedAt: beforeDeadline,
        authCreatedAt: createdAt,
      }),
    ).toMatchObject({
      endsAt: atDeadline,
      firstDueDate: '2026-11-11',
      expiredAtCheckout: false,
    });
    expect(
      resolveSignupTrialTerms({
        planCode: 'clinica_2026_2',
        attemptedAt: atDeadline,
        authCreatedAt: createdAt,
      }),
    ).toMatchObject({ firstDueDate: '2026-11-10', expiredAtCheckout: true });
  });

  it('atravessa fevereiro bissexto sem reiniciar o trial de uma conta antiga', () => {
    expect(
      resolveSignupTrialTerms({
        planCode: 'consultorio_2026',
        attemptedAt: new Date('2028-03-01T12:00:00.000Z'),
        authCreatedAt: new Date('2028-02-29T12:00:00.000Z'),
      }),
    ).toMatchObject({
      endsAt: new Date('2028-03-14T12:00:00.000Z'),
      firstDueDate: '2028-03-15',
      expiredAtCheckout: false,
    });
  });

  it('após o prazo, não reinicia o trial e vence no dia do checkout', async () => {
    expect(
      resolveSignupTrialTerms({
        planCode: 'clinica_2026_2',
        attemptedAt: new Date('2026-10-19T10:00:00Z'),
        authCreatedAt: new Date('2026-10-01T13:45:00Z'),
      }),
    ).toMatchObject({
      endsAt: new Date('2026-10-15T13:45:00Z'),
      firstDueDate: '2026-10-19',
      expiredAtCheckout: true,
    });
  });

  it('não consulta Auth nem altera os termos de um contrato legado', async () => {
    expect(
      resolveSignupTrialTerms({
        planCode: 'solo',
        attemptedAt: new Date('2026-10-19T13:45:00Z'),
      }),
    ).toMatchObject({ firstDueDate: '2026-10-26', strictDeadline: false });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
