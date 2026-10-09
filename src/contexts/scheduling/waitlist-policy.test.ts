import { describe, expect, it } from 'vitest';

import {
  WAITLIST_OFFER_SEND_HOURS,
  WAITLIST_OFFER_TTL_MINUTES,
  chooseWaitlistCandidate,
  isWaitlistOfferExpired,
  waitlistOfferExpiresAt,
  type WaitlistCandidate,
} from './waitlist-policy';

const core = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/appointment-core.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0063_waitlist_recurrence.sql'),
  'utf8',
);
const waitlistPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/lista-espera/page.tsx'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const handlerBoot = readFileSync(
  resolve(process.cwd(), 'src/app/api/cron/outbox/handlers.ts'),
  'utf8',
);
const offerHandler = readFileSync(
  resolve(
    process.cwd(),
    'src/contexts/ai-agent/proactive-jobs/internal/handlers/waitlist-offered.ts',
  ),
  'utf8',
);
const manager = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/lista-espera/waitlist-manager.tsx'),
  'utf8',
);

describe('waitlist candidate selection', () => {
  const slot = {
    doctorId: 'doctor-1',
    procedureId: 'procedure-1',
    startsAt: new Date('2026-07-30T13:00:00.000Z'),
  };

  it('prefers urgent compatible candidates, then oldest request', () => {
    const candidates: WaitlistCandidate[] = [
      {
        id: 'old-normal',
        doctorId: null,
        procedureId: 'procedure-1',
        priority: 'normal',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
      {
        id: 'new-urgent',
        doctorId: 'doctor-1',
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date('2026-07-24T10:00:00Z'),
      },
    ];

    expect(chooseWaitlistCandidate(candidates, slot)?.id).toBe('new-urgent');
  });

  it('ignores candidates for another doctor, procedure or preferred period', () => {
    const candidates: WaitlistCandidate[] = [
      {
        id: 'doctor',
        doctorId: 'doctor-2',
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date(),
      },
      {
        id: 'procedure',
        doctorId: null,
        procedureId: 'procedure-2',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date(),
      },
      {
        id: 'period',
        doctorId: null,
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: new Date('2026-08-01T00:00:00Z'),
        preferredUntil: null,
        createdAt: new Date(),
      },
    ];

    expect(chooseWaitlistCandidate(candidates, slot)).toBeNull();
  });

  it('offers a compatible waiting entry when an appointment is cancelled', () => {
    expect(core).toContain('offerWaitlistForCancelledAppointment');
    expect(migration).toContain('waitlist entry tenant mismatch');
    expect(migration).toContain('waitlist_entries_clinic_status_priority_idx');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(waitlistPage).toContain('listWaitlistEntries(clinicId, true)');
    expect(waitlistPage).toContain('PERMISSIONS.EDIT_AGENDA');
  });

  // WAIT-001 — o achado: só `applyTransition(target=cancelado)` ofertava. O
  // cancelamento humano da Agenda (`exceptional_cancel`) tem implementação
  // própria em `recoverAppointment` e liberava a vaga sem ofertar a ninguém.
  it('o cancelamento humano da Agenda também oferta a vaga', () => {
    const recoverBlock = actions.slice(
      actions.indexOf('export async function recoverAppointment'),
      actions.indexOf('export async function createDoctorAbsence'),
    );
    expect(recoverBlock).toContain('offerWaitlistForCancelledAppointment');
    expect(recoverBlock).toContain("decision.target === 'cancelado'");
  });

  // Ausência médica NÃO oferta de propósito: os horários afetados estão dentro
  // da janela em que o profissional não estará na clínica.
  it('ausência médica não oferta a vaga que ela mesma bloqueia', () => {
    const absenceBlock = actions.slice(
      actions.indexOf('export async function createDoctorAbsence'),
    );
    expect(absenceBlock).not.toContain('await offerWaitlistForCancelledAppointment');
  });

  it('o evento de oferta tem handler registrado (não termina em `skipped`)', () => {
    // A UI rotulava `offered` como "Oferta enviada" enquanto o worker
    // descartava o evento por falta de consumidor.
    expect(handlerBoot).toContain('proactive-jobs/internal/handlers/waitlist-offered');
    expect(offerHandler).toContain('SCHEDULING_EVENTS.WAITLIST_OFFERED');
    expect(offerHandler).toContain("type: 'waitlist_offer'");
  });

  it('a oferta tem aceite e recusa reais, com permissão e idempotência', () => {
    expect(actions).toContain('export async function acceptWaitlistOffer');
    expect(actions).toContain('export async function declineWaitlistOffer');
    expect(actions).toContain('scheduling.waitlist.offer_declined');
    // Aceitar cria a consulta pelo MESMO core de qualquer agendamento.
    const acceptBlock = actions.slice(
      actions.indexOf('export async function acceptWaitlistOffer'),
      actions.indexOf('export async function declineWaitlistOffer'),
    );
    expect(acceptBlock).toContain('insertScheduledAppointment');
    expect(acceptBlock).toContain('PERMISSIONS.EDIT_AGENDA');
    expect(acceptBlock).toContain('idemKey(');
    expect(manager).toContain('Aceitar vaga');
    expect(manager).toContain('Recusar');
  });
});

// ADR-066 — o TTL da oferta corre só nas horas em que o convite pode sair.
describe('janela de resposta da oferta', () => {
  const SP = 'America/Sao_Paulo';
  const MINUTE = 60 * 1000;

  it('o TTL segue 240 min', () => {
    expect(WAITLIST_OFFER_TTL_MINUTES).toBe(240);
  });

  it.each([
    ['diurna: as 4 h no mesmo dia', '2026-10-09T10:00-03:00', '2026-10-09T14:00-03:00'],
    ['às 21h: abre às 8h e fecha às 12h', '2026-10-09T21:00-03:00', '2026-10-10T12:00-03:00'],
    ['de madrugada: abre às 8h', '2026-10-10T04:30-03:00', '2026-10-10T12:00-03:00'],
    ['às 17h: 3 h hoje e 1 h amanhã', '2026-10-09T17:00-03:00', '2026-10-10T09:00-03:00'],
    ['às 8h em ponto', '2026-10-09T08:00-03:00', '2026-10-09T12:00-03:00'],
    ['um minuto antes das 8h', '2026-10-09T07:59-03:00', '2026-10-09T12:00-03:00'],
    ['às 16h fecha às 20h em ponto', '2026-10-09T16:00-03:00', '2026-10-09T20:00-03:00'],
    ['às 19h59: 1 min hoje e 239 amanhã', '2026-10-09T19:59-03:00', '2026-10-10T11:59-03:00'],
    ['às 20h em ponto já conta amanhã', '2026-10-09T20:00-03:00', '2026-10-10T12:00-03:00'],
    ['na virada do ano', '2026-12-31T21:00-03:00', '2027-01-01T12:00-03:00'],
  ])('oferta %s', (_label, offeredAt, expiresAt) => {
    expect(waitlistOfferExpiresAt(new Date(offeredAt), SP)).toEqual(new Date(expiresAt));
  });

  it('as horas são as do fuso da clínica', () => {
    // Manaus é UTC−4: às 12h locais, em São Paulo já são 13h.
    expect(waitlistOfferExpiresAt(new Date('2026-10-09T21:00-04:00'), 'America/Manaus')).toEqual(
      new Date('2026-10-10T12:00-04:00'),
    );
  });

  it('a oferta das 21h segue aberta às 8h e vence às 12h em ponto', () => {
    const offeredAt = new Date('2026-10-09T21:00-03:00');
    expect(isWaitlistOfferExpired(offeredAt, SP, new Date('2026-10-10T08:00-03:00'))).toBe(false);
    expect(isWaitlistOfferExpired(offeredAt, SP, new Date('2026-10-10T11:59:59.999-03:00'))).toBe(
      false,
    );
    expect(isWaitlistOfferExpired(offeredAt, SP, new Date('2026-10-10T12:00-03:00'))).toBe(true);
  });

  it('qualquer horário de oferta ganha o TTL inteiro em horas de envio, e nada além', () => {
    // Conta minuto a minuto, sem a regra. São Paulo não tem horário de verão
    // desde 2019: a hora local é a UTC menos 3.
    const isSendMinute = (instant: number) => {
      const hour = new Date(instant - 3 * 60 * MINUTE).getUTCHours();
      return hour >= WAITLIST_OFFER_SEND_HOURS.start && hour < WAITLIST_OFFER_SEND_HOURS.end;
    };
    const first = new Date('2026-10-09T00:00-03:00').getTime();
    const wrong: string[] = [];
    for (let offeredAt = first; offeredAt < first + 48 * 60 * MINUTE; offeredAt += 15 * MINUTE) {
      const expiresAt = waitlistOfferExpiresAt(new Date(offeredAt), SP).getTime();
      let counted = 0;
      for (let minute = offeredAt; minute < expiresAt; minute += MINUTE) {
        if (isSendMinute(minute)) counted += 1;
      }
      // O último minuto da janela também é de envio: ela não se estende noite adentro.
      if (counted !== WAITLIST_OFFER_TTL_MINUTES || !isSendMinute(expiresAt - MINUTE)) {
        wrong.push(new Date(offeredAt).toISOString());
      }
    }
    expect(wrong).toEqual([]);
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
