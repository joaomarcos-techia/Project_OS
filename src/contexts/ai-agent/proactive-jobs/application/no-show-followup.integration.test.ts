/**
 * Integração controlada da 2.4B: no-show → job C14 → guarda de Scheduling →
 * template real → seam Messaging. Banco e Meta são as únicas bordas mockadas.
 *
 * Relógio fixo no horário em que o job sai (ADR-065: a validade do job depende
 * do instante do envio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// This controlled integration retains a paid contract; commercial state is tested separately.
vi.mock('@/lib/entitlements', () => ({
  getOperationalModuleAccess: vi.fn(async () => ({ allowed: true })),
}));

import type * as EnvModule from '@/lib/env';

const mocks = vi.hoisted(() => ({
  insertJobTx: vi.fn(),
  getClinicTimezoneTx: vi.fn(),
  claimDue: vi.fn(),
  getClinicTimezone: vi.fn(),
  finalizeSent: vi.fn(),
  finalizeRetry: vi.fn(),
  finalizeFailed: vi.fn(),
  cancel: vi.fn(),
  lookupAppointment: vi.fn(),
  hasFutureEquivalentAppointment: vi.fn(),
  getProactiveContact: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      META_TEMPLATE_NO_SHOW_FOLLOWUP_ID: 'qoro_no_show_followup',
      META_TEMPLATE_LANG: 'pt_BR',
    },
  };
});
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
    lookupAppointment: mocks.lookupAppointment,
    lookupWaitlistOffer: vi.fn(),
    hasFutureEquivalentAppointment: mocks.hasFutureEquivalentAppointment,
    hasSubsequentCompletedAppointment: vi.fn(),
  },
}));
vi.mock('@/contexts/patient', () => ({
  patientApiV1: { getProactiveContact: mocks.getProactiveContact },
}));
vi.mock('@/contexts/messaging', () => ({
  messagingApiV1: { sendText: mocks.sendText },
  SuppressedRecipientError: class extends Error {},
  NumberNotConnectedError: class extends Error {},
}));
vi.mock('@/contexts/payments', () => ({ paymentsApiV1: { getPayableCharge: vi.fn() } }));
vi.mock('@/contexts/financial', () => ({ financialApiV1: { getLancamento: vi.fn() } }));
vi.mock('@/contexts/clinical', () => ({ clinicalApiV1: { getFollowupState: vi.fn() } }));
vi.mock('../infra/repository', () => ({
  insertJobTx: mocks.insertJobTx,
  getClinicTimezoneTx: mocks.getClinicTimezoneTx,
  claimDue: mocks.claimDue,
  getClinicTimezone: mocks.getClinicTimezone,
  finalizeSent: mocks.finalizeSent,
  finalizeRetry: mocks.finalizeRetry,
  finalizeFailed: mocks.finalizeFailed,
  cancel: mocks.cancel,
}));

import { scheduleNoShowFollowup } from '../internal/handlers/appointment-no-show';
import { processProactiveBatch } from './process';

const CLINIC = '11111111-1111-1111-8111-111111111111';
const APPOINTMENT = '22222222-2222-2222-8222-222222222222';
const PATIENT = '33333333-3333-3333-8333-333333333333';
const PROCEDURE = '44444444-4444-4444-8444-444444444444';
const NO_SHOW_AT = '2026-09-04T15:00:00.000Z';
/** Segunda 07/09, 10:00 locais: o próximo dia útil depois da falta. */
const SEND_AT = new Date('2026-09-07T13:00:00.000Z');

async function enqueueAndClaim(): Promise<void> {
  await scheduleNoShowFollowup({
    tx: 'TX' as never,
    clinicId: CLINIC,
    eventId: 'evt-1',
    payload: {
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      patientId: PATIENT,
      fromStatus: 'confirmado',
      toStatus: 'faltou',
      noShowAt: NO_SHOW_AT,
    },
  });
  const queued = mocks.insertJobTx.mock.calls[0]![1] as {
    type: 'no_show_followup';
    payload: unknown;
  };
  mocks.claimDue.mockResolvedValue([
    {
      id: 'job-no-show',
      clinicId: CLINIC,
      type: queued.type,
      payload: queued.payload,
      attempts: 1,
      leaseToken: 'lease-1',
      // Geração 0 (ADR-064): a chave de envio é o próprio id.
      sendKey: 'job-no-show',
      resend: false,
      failedReason: null,
      createdAt: new Date(NO_SHOW_AT),
    },
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: SEND_AT, toFake: ['Date'] });
  mocks.getClinicTimezoneTx.mockResolvedValue('America/Sao_Paulo');
  mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
  mocks.lookupAppointment.mockResolvedValue({
    status: 'faltou',
    patientId: PATIENT,
    procedureId: PROCEDURE,
  });
  mocks.hasFutureEquivalentAppointment.mockResolvedValue(false);
  mocks.getProactiveContact.mockResolvedValue({
    nome: 'Maria Silva',
    phone: '5511999990000',
    deceased: false,
    cobrancaWhatsapp: false,
    agendamentoWhatsapp: true,
    consentRevoked: true,
    suppressedWhatsapp: false,
    suppressedWhatsappPurposes: [],
  });
  mocks.sendText.mockResolvedValue({
    id: 'out-1',
    status: 'accepted',
    providerMessageId: 'meta-1',
    deduped: false,
  });
});

describe('2.4B — integração no_show → C14 → send', () => {
  it('agenda para o próximo dia útil e envia copy operacional pelo purpose followup', async () => {
    await enqueueAndClaim();

    const queued = mocks.insertJobTx.mock.calls[0]![1];
    expect(queued).toEqual({
      clinicId: CLINIC,
      type: 'no_show_followup',
      scheduledFor: new Date('2026-09-07T13:00:00.000Z'),
      payload: {
        patientId: PATIENT,
        appointmentId: APPOINTMENT,
        noShowAt: NO_SHOW_AT,
      },
      dedupKey: `no_show_followup:${APPOINTMENT}`,
    });
    expect(JSON.stringify(queued)).not.toMatch(/procedimento|diagnóstico|pagamento|R\$/iu);

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.sent).toBe(1);
    expect(mocks.sendText).toHaveBeenCalledWith({
      clinicId: CLINIC,
      toNumber: '5511999990000',
      idempotencyKey: 'job-no-show',
      purpose: 'followup',
      body: {
        kind: 'template',
        templateName: 'qoro_no_show_followup',
        languageCode: 'pt_BR',
        variables: ['Maria Silva'],
      },
    });
  });

  it('cancela no send-time se o paciente já remarcou', async () => {
    await enqueueAndClaim();
    mocks.hasFutureEquivalentAppointment.mockResolvedValue(true);

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.cancelled).toBe(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      CLINIC,
      'job-no-show',
      'lease-1',
      'no_show_already_rescheduled',
    );
    expect(mocks.sendText).not.toHaveBeenCalled();
  });
});
