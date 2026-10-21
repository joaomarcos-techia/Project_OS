import { describe, expect, it } from 'vitest';

import { decideSeatQuota, effectiveSeatLimits, teamFitsSeatCaps } from './seat-limits';

const usage = (users: number, professionals: number, staff: number) => ({
  users,
  professionals,
  staff,
});

describe('tetos efetivos de equipe (ADR-067)', () => {
  it('tabela antiga: só o total de usuários', () => {
    expect(
      effectiveSeatLimits({ current: null, scheduledDowngrade: null, legacyUsers: 5 }),
    ).toEqual({ users: 5, professionals: null, staff: null });
  });

  it('oferta por profissional: profissionais e equipe, sem teto total', () => {
    expect(
      effectiveSeatLimits({
        current: { professionals: 3, staff: null },
        scheduledDowngrade: null,
        legacyUsers: null,
      }),
    ).toEqual({ users: null, professionals: 3, staff: null });
  });

  it('downgrade agendado reserva a capacidade do destino, como a trigger', () => {
    expect(
      effectiveSeatLimits({
        current: { professionals: 3, staff: null },
        scheduledDowngrade: { professionals: 1, staff: 3 },
        legacyUsers: null,
      }),
    ).toEqual({ users: null, professionals: 1, staff: 3 });
    expect(
      effectiveSeatLimits({
        current: { professionals: 5, staff: null },
        scheduledDowngrade: { professionals: 4, staff: null },
        legacyUsers: null,
      }),
    ).toEqual({ users: null, professionals: 4, staff: null });
  });
});

describe('cabe mais uma pessoa?', () => {
  const clinica3 = { users: null, professionals: 3, staff: null };
  const consultorio = { users: null, professionals: 1, staff: 3 };

  it('sem assinatura não há teto', () => {
    expect(decideSeatQuota(null, usage(40, 20, 20), 'professionals').allowed).toBe(true);
  });

  it('Clínica: a vaga de profissional acaba, a de equipe não', () => {
    expect(decideSeatQuota(clinica3, usage(3, 2, 1), 'professionals')).toEqual({
      allowed: true,
      dimension: null,
      limit: null,
    });
    expect(decideSeatQuota(clinica3, usage(4, 3, 1), 'professionals')).toEqual({
      allowed: false,
      dimension: 'professionals',
      limit: 3,
    });
    expect(decideSeatQuota(clinica3, usage(53, 3, 50), 'staff').allowed).toBe(true);
  });

  it('Consultório: 1 profissional e até 3 de equipe', () => {
    expect(decideSeatQuota(consultorio, usage(1, 1, 0), 'professionals').dimension).toBe(
      'professionals',
    );
    expect(decideSeatQuota(consultorio, usage(3, 1, 2), 'staff').allowed).toBe(true);
    expect(decideSeatQuota(consultorio, usage(4, 1, 3), 'staff')).toEqual({
      allowed: false,
      dimension: 'staff',
      limit: 3,
    });
  });

  it('tabela antiga: convite pendente conta no total, qualquer que seja a função', () => {
    const solo = { users: 1, professionals: null, staff: null };
    expect(decideSeatQuota(solo, usage(1, 0, 1), 'staff')).toEqual({
      allowed: false,
      dimension: 'users',
      limit: 1,
    });
  });
});

describe('a equipe cabe no plano de destino?', () => {
  it('Clínica 4 → 3 só com até 3 profissionais', () => {
    expect(teamFitsSeatCaps(usage(9, 3, 6), { professionals: 3, staff: null })).toBe(true);
    expect(teamFitsSeatCaps(usage(10, 4, 6), { professionals: 3, staff: null })).toBe(false);
  });

  it('Clínica → Consultório exige também equipe de no máximo 3', () => {
    expect(teamFitsSeatCaps(usage(4, 1, 3), { professionals: 1, staff: 3 })).toBe(true);
    expect(teamFitsSeatCaps(usage(5, 1, 4), { professionals: 1, staff: 3 })).toBe(false);
  });
});
