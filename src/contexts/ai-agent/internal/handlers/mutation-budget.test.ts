/**
 * Teto de mutação por turno (G1) — com MAX_TOOL_ROUNDS>1 a invariante "≤ 1
 * mutação por turno" NÃO pode mais depender do teto de rodadas; é enforçada
 * explicitamente no handler via roundMutationCount + MAX_MUTATIONS_PER_TURN.
 * Este teste cobre a REGRA de contagem (efeito da whitelist) e o orçamento.
 */
import { describe, expect, it } from 'vitest';

import { MAX_MUTATIONS_PER_TURN, MAX_TOOL_ROUNDS } from '../../limits';
// Importa o handler → registra as 15 tools de produção (side-effect via register).
import { roundMutationCount } from './inbound-received';

const budgetExceeded = (prior: number, names: string[]): boolean =>
  prior + roundMutationCount(names.map((name) => ({ name }))) > MAX_MUTATIONS_PER_TURN;

describe('limits — orçamentos após o amend 2026-07-30', () => {
  it('MAX_TOOL_ROUNDS>=2 (agendamento precisa de múltiplas rodadas) e MAX_MUTATIONS_PER_TURN=1', () => {
    expect(MAX_TOOL_ROUNDS).toBeGreaterThanOrEqual(2);
    expect(MAX_MUTATIONS_PER_TURN).toBe(1);
  });
});

describe('roundMutationCount (efeito da whitelist)', () => {
  it('só leituras → 0', () => {
    expect(roundMutationCount([{ name: 'provide_clinic_info' }, { name: 'list_slots' }])).toBe(0);
    expect(roundMutationCount([{ name: 'provide_procedure_price' }])).toBe(0);
    expect(roundMutationCount([{ name: 'list_my_appointments' }])).toBe(0);
  });

  it('cada mutação conta 1', () => {
    for (const name of [
      'schedule_appointment',
      'cancel_appointment',
      'reschedule_appointment',
      'confirm_pending_action',
      'collect_patient_data',
      'lgpd_delete_request',
    ]) {
      expect(roundMutationCount([{ name }])).toBe(1);
    }
  });

  it('mistura leitura + mutação conta só a mutação', () => {
    expect(
      roundMutationCount([{ name: 'provide_clinic_info' }, { name: 'collect_patient_data' }]),
    ).toBe(1);
  });

  it('tool desconhecida conta 0 (preflight já barra como security event)', () => {
    expect(roundMutationCount([{ name: 'delete_patient' }])).toBe(0);
  });
});

describe('orçamento cross-round de mutação', () => {
  it('permite a 1ª mutação do turno', () => {
    expect(budgetExceeded(0, ['schedule_appointment'])).toBe(false);
  });

  it('rejeita a 2ª mutação mesmo em rodada seguinte', () => {
    expect(budgetExceeded(1, ['cancel_appointment'])).toBe(true);
  });

  it('leitura numa rodada seguinte após uma mutação NÃO é bloqueada', () => {
    expect(budgetExceeded(1, ['list_my_appointments'])).toBe(false);
  });
});
