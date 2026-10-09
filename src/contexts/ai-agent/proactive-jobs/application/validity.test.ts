/**
 * ADR-065 — validade por tipo da C14, nas bordas exatas. Fuso America/Sao_Paulo
 * (UTC−3, sem horário de verão): a meia-noite local é 03:00Z.
 */
import { describe, expect, it } from 'vitest';

/* eslint-disable-next-line boundaries/element-types -- só o teste lê a política do Financial, para prender o corte do dunning a ela. */
import { routeDunning } from '@/contexts/financial/dunning-policy';

import type { ProactivePayload } from '../domain/types';
import type { ProactiveJobType } from '../schema';
import {
  DUNNING_STAGE_VALID_UNTIL_DAYS,
  expiredReason,
  isExpired,
  sendDeadline,
  type ValidityContext,
} from './validity';

const U = '11111111-1111-1111-1111-111111111111';
const TZ = 'America/Sao_Paulo';
const CREATED_AT = new Date('2026-10-01T15:00:00.000Z');
const ctx: ValidityContext = { timezone: TZ, createdAt: CREATED_AT };

function expiredAt(type: ProactiveJobType, payload: ProactivePayload, now: string): boolean {
  return isExpired(type, payload, { ...ctx, now: new Date(now) });
}

describe('validade por tipo (ADR-065)', () => {
  it('motivo estável por tipo', () => {
    expect(
      (
        [
          'reminder',
          'dunning',
          'followup',
          'no_show_followup',
          'waitlist_offer',
          'deposit_link',
          'remainder_link',
        ] as const
      ).map(expiredReason),
    ).toEqual([
      'expired_reminder',
      'expired_dunning',
      'expired_followup',
      'expired_no_show_followup',
      'expired_waitlist_offer',
      'expired_deposit_link',
      'expired_remainder_link',
    ]);
  });

  describe('reminder — até a virada do dia da consulta', () => {
    // Consulta sábado 10/10 às 14:00 locais.
    const payload = {
      patientId: U,
      appointmentId: U,
      scheduledAt: '2026-10-10T17:00:00.000Z',
      doctorNome: 'Dra. Ana',
    };

    it('vale até 23:59 da véspera', () => {
      expect(sendDeadline('reminder', payload, ctx)).toEqual(new Date('2026-10-10T03:00:00.000Z'));
      expect(expiredAt('reminder', payload, '2026-10-09T21:00:00.000Z')).toBe(false);
      expect(expiredAt('reminder', payload, '2026-10-10T02:59:59.999Z')).toBe(false);
    });

    it('vence à meia-noite — 8h do dia, antes da consulta, já diria "amanhã" errado', () => {
      expect(expiredAt('reminder', payload, '2026-10-10T03:00:00.000Z')).toBe(true);
      expect(expiredAt('reminder', payload, '2026-10-10T11:00:00.000Z')).toBe(true);
    });

    it('a data é a local, não a UTC', () => {
      // 22:30 de sexta 09/10 em São Paulo já é sábado em UTC.
      const lateNight = { ...payload, scheduledAt: '2026-10-10T01:30:00.000Z' };
      expect(sendDeadline('reminder', lateNight, ctx)).toEqual(
        new Date('2026-10-09T03:00:00.000Z'),
      );
    });
  });

  describe('deposit_link — até o prazo do sinal', () => {
    const payload = {
      patientId: U,
      chargeId: U,
      appointmentId: U,
      amount: 150,
      holdExpiresAt: '2026-10-09T20:00:00.000Z',
    };

    it('vale até o instante anterior ao hold', () => {
      expect(expiredAt('deposit_link', payload, '2026-10-09T19:59:59.999Z')).toBe(false);
    });

    it('vence no hold', () => {
      expect(expiredAt('deposit_link', payload, '2026-10-09T20:00:00.000Z')).toBe(true);
    });
  });

  describe('waitlist_offer — até o início do horário', () => {
    const payload = {
      patientId: U,
      waitlistEntryId: U,
      releasedAppointmentId: U,
      scheduledAt: '2026-10-10T12:00:00.000Z',
      doctorNome: null,
    };

    it('vale antes do horário começar', () => {
      expect(expiredAt('waitlist_offer', payload, '2026-10-10T11:59:59.999Z')).toBe(false);
    });

    it('vence quando o horário começa', () => {
      expect(expiredAt('waitlist_offer', payload, '2026-10-10T12:00:00.000Z')).toBe(true);
    });
  });

  describe('dunning — por estágio, em dias de atraso locais', () => {
    const base = {
      patientId: U,
      lancamentoId: U,
      valor: 200,
      dueDate: '2026-10-01',
      procedureNome: null,
    };

    it('D+3 vale até o fim do D+6 e vence no D+7', () => {
      const d3 = { ...base, stage: 3 as const };
      expect(sendDeadline('dunning', d3, ctx)).toEqual(new Date('2026-10-08T03:00:00.000Z'));
      expect(expiredAt('dunning', d3, '2026-10-08T02:59:59.999Z')).toBe(false);
      expect(expiredAt('dunning', d3, '2026-10-08T03:00:00.000Z')).toBe(true);
    });

    it('D+7 vale até o fim do D+14 e vence no D+15', () => {
      const d7 = { ...base, stage: 7 as const };
      expect(sendDeadline('dunning', d7, ctx)).toEqual(new Date('2026-10-16T03:00:00.000Z'));
      expect(expiredAt('dunning', d7, '2026-10-16T02:59:59.999Z')).toBe(false);
      expect(expiredAt('dunning', d7, '2026-10-16T03:00:00.000Z')).toBe(true);
    });

    it('os cortes seguem a política do Financial', () => {
      // O D+3 cede lugar quando o D+7 passa a ser roteado.
      const d7Starts = routeDunning(DUNNING_STAGE_VALID_UNTIL_DAYS[3]);
      expect(d7Starts.mode === 'automatic' && d7Starts.stages.includes(7)).toBe(true);
      // Até a véspera de cada corte, o estágio ainda é contato automático.
      for (const stage of [3, 7] as const) {
        const before = routeDunning(DUNNING_STAGE_VALID_UNTIL_DAYS[stage] - 1);
        expect(before.mode === 'automatic' && before.stages.includes(stage)).toBe(true);
      }
      // No corte do D+7 o caso já é da revisão humana.
      expect(routeDunning(DUNNING_STAGE_VALID_UNTIL_DAYS[7]).mode).toBe('manual');
    });
  });

  describe('followup — até uma semana depois da data do retorno', () => {
    const payload = { patientId: U, prontuarioId: U, doctorNome: null, returnDate: '2026-10-20' };

    it('vale até o fim de retorno + 7 dias', () => {
      expect(sendDeadline('followup', payload, ctx)).toEqual(new Date('2026-10-28T03:00:00.000Z'));
      expect(expiredAt('followup', payload, '2026-10-28T02:59:59.999Z')).toBe(false);
    });

    it('vence no 8º dia', () => {
      expect(expiredAt('followup', payload, '2026-10-28T03:00:00.000Z')).toBe(true);
    });
  });

  describe('no_show_followup — até o fim do 3º dia útil depois da falta', () => {
    // Falta na segunda 05/10 às 12:00 locais → terça, quarta e quinta.
    const monday = { patientId: U, appointmentId: U, noShowAt: '2026-10-05T15:00:00.000Z' };

    it('vale até 23:59 da quinta', () => {
      expect(sendDeadline('no_show_followup', monday, ctx)).toEqual(
        new Date('2026-10-09T03:00:00.000Z'),
      );
      expect(expiredAt('no_show_followup', monday, '2026-10-09T02:59:59.999Z')).toBe(false);
    });

    it('vence na sexta', () => {
      expect(expiredAt('no_show_followup', monday, '2026-10-09T03:00:00.000Z')).toBe(true);
    });

    it('fim de semana não conta como dia útil', () => {
      // Falta na sexta 02/10 → segunda, terça e quarta.
      const friday = { ...monday, noShowAt: '2026-10-02T15:00:00.000Z' };
      expect(sendDeadline('no_show_followup', friday, ctx)).toEqual(
        new Date('2026-10-08T03:00:00.000Z'),
      );
    });

    it('o dia da falta é o local', () => {
      // 22:30 de segunda em São Paulo já é terça em UTC.
      const lateNight = { ...monday, noShowAt: '2026-10-06T01:30:00.000Z' };
      expect(sendDeadline('no_show_followup', lateNight, ctx)).toEqual(
        new Date('2026-10-09T03:00:00.000Z'),
      );
    });
  });

  describe('remainder_link — 7 dias depois de enfileirado', () => {
    const payload = { patientId: U, chargeId: U, appointmentId: U, amount: 80 };

    it('vale até o instante anterior ao 7º dia', () => {
      expect(sendDeadline('remainder_link', payload, ctx)).toEqual(
        new Date('2026-10-08T15:00:00.000Z'),
      );
      expect(expiredAt('remainder_link', payload, '2026-10-08T14:59:59.999Z')).toBe(false);
    });

    it('vence no 7º dia — e o job de 34 dias na fila do DEV também', () => {
      expect(expiredAt('remainder_link', payload, '2026-10-08T15:00:00.000Z')).toBe(true);
      const stale = { ...ctx, createdAt: new Date('2026-09-04T15:00:00.000Z') };
      expect(
        isExpired('remainder_link', payload, {
          ...stale,
          now: new Date('2026-10-08T15:00:00.000Z'),
        }),
      ).toBe(true);
    });
  });
});
