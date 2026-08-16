import { describe, expect, it } from 'vitest';

import { chooseWaitlistCandidate, type WaitlistCandidate } from './waitlist-policy';

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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
