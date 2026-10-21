import { describe, expect, it } from 'vitest';

import { UserQuotaExceededError } from '../errors';
import { rethrowSeatLimit, seatLimitErrorFrom } from './seat-limit-error';
import { mapIdentityError } from './map-error';

/** Forma do erro do postgres.js quando a trigger da migration 0119 recusa. */
function pgCheckViolation(constraint: string) {
  return Object.assign(new Error('Limite do plano atingido'), {
    code: '23514',
    constraint_name: constraint,
  });
}

describe('recusa de vaga da trigger de profiles (ADR-067)', () => {
  it('profissional e equipe viram o erro de domínio com a dimensão certa', () => {
    const professionals = seatLimitErrorFrom(pgCheckViolation('plan_professional_seat_limit'));
    expect(professionals).toBeInstanceOf(UserQuotaExceededError);
    expect(professionals?.dimension).toBe('professionals');
    expect(professionals?.limit).toBeNull();
    expect(seatLimitErrorFrom(pgCheckViolation('plan_staff_seat_limit'))?.dimension).toBe('staff');
  });

  it('encontra o erro do banco embrulhado pelo Drizzle em `cause`', () => {
    const wrapped = new Error('Failed query', {
      cause: pgCheckViolation('plan_professional_seat_limit'),
    });
    expect(seatLimitErrorFrom(wrapped)?.dimension).toBe('professionals');
  });

  it('não confunde outras violações nem outros erros', () => {
    expect(seatLimitErrorFrom(pgCheckViolation('outra_restricao'))).toBeNull();
    expect(
      seatLimitErrorFrom(Object.assign(new Error('dup'), { code: '23505', constraint_name: 'x' })),
    ).toBeNull();
    expect(seatLimitErrorFrom(new Error('rede'))).toBeNull();
    expect(seatLimitErrorFrom(null)).toBeNull();
  });

  it('relança como domínio ou deixa passar o erro original', () => {
    expect(() => rethrowSeatLimit(pgCheckViolation('plan_staff_seat_limit'))).toThrow(
      UserQuotaExceededError,
    );
    const other = new Error('outro');
    expect(() => rethrowSeatLimit(other)).toThrow(other);
  });

  it('a tela recebe uma mensagem acionável, não o genérico', () => {
    const message = mapIdentityError(
      seatLimitErrorFrom(pgCheckViolation('plan_professional_seat_limit')),
    );
    expect(message).toContain('Configurações › Assinatura');
    expect(message).not.toContain('Não foi possível concluir');
  });
});
