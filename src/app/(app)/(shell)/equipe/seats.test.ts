import { describe, expect, it } from 'vitest';

import { noSeatsLeft, seatLimitMessage, seatsFull, seatSummary, teamSeatsFrom } from './seats';

const owner = { role: 'owner' as const, crm: null, ativo: true };
const ownerWithCrm = { role: 'owner' as const, crm: '12345', ativo: true };
const doctor = { role: 'doctor' as const, crm: null, ativo: true };
const attendant = { role: 'attendant' as const, crm: null, ativo: true };
const inactiveDoctor = { role: 'doctor' as const, crm: null, ativo: false };

describe('vagas da equipe na tela (ADR-067)', () => {
  it('tabela antiga mantém o total de usuários de sempre', () => {
    const seats = teamSeatsFrom({ users: 5, professionals: null, staff: null }, [
      owner,
      doctor,
      inactiveDoctor,
    ]);
    expect(seats).toEqual({ model: 'users', used: 2, limit: 5 });
    expect(seatSummary(seats)).toBe('Usuários: 2 de 5');
    expect(seatsFull(seats, 'professionals')).toBe(false);
  });

  it('Consultório: o dono com CRM ocupa a vaga de profissional', () => {
    const seats = teamSeatsFrom({ users: null, professionals: 1, staff: 3 }, [
      ownerWithCrm,
      attendant,
      inactiveDoctor,
    ]);
    expect(seats).toEqual({
      model: 'categories',
      professionals: { used: 1, limit: 1 },
      staff: { used: 1, limit: 3 },
    });
    expect(seatsFull(seats, 'professionals')).toBe(true);
    expect(seatsFull(seats, 'staff')).toBe(false);
    expect(noSeatsLeft(seats)).toBe(false);
    expect(seatSummary(seats)).toBe('Profissionais: 1 de 1 · Equipe: 1 de 3');
  });

  it('Clínica: equipe ilimitada nunca enche', () => {
    const seats = teamSeatsFrom({ users: null, professionals: 2, staff: null }, [
      owner,
      doctor,
      doctor,
      attendant,
    ]);
    expect(seatsFull(seats, 'professionals')).toBe(true);
    expect(seatsFull(seats, 'staff')).toBe(false);
    expect(noSeatsLeft(seats)).toBe(false);
    expect(seatSummary(seats)).toBe('Profissionais: 2 de 2 · Equipe: 2');
  });

  it('a mensagem diz o que fazer em cada caso', () => {
    expect(seatLimitMessage('professionals', null)).toContain('Inclua profissionais');
    expect(seatLimitMessage('staff', null)).toContain('equipe administrativa é ilimitada');
    expect(seatLimitMessage('users', 5)).toContain('Seu plano permite 5 usuários');
  });
});
