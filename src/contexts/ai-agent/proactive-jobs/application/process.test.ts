/**
 * Processor C14 — matriz de decisão (T1/T2/T5/T6 do §14.6) com I/O mockado.
 *
 * Cobre o que é do C14: accepted→sent, bloqueio (suppression/consent)→cancelled,
 * guard de dunning (já pago)→cancelled e a recusa da Meta (ADR-064): reenvio
 * com chave nova só para código retentável, falha na hora para o resto.
 * T3/T4 (paciente responde SIM/REMARCAR) NÃO estão aqui: são do C11 (inbound
 * webhook → tools confirm/reschedule), que C14 não altera — cobertos por C11.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infra/repository', () => ({
  claimDue: vi.fn(),
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
  finalizeSent: vi.fn(async () => {}),
  finalizeRetry: vi.fn(async () => {}),
  finalizeResend: vi.fn(async () => {}),
  finalizeFailed: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
}));
vi.mock('../infra/templates', () => ({
  buildProactiveTemplate: vi.fn(() => ({
    templateName: 't',
    languageCode: 'pt_BR',
    variables: [],
  })),
  TemplateNotConfiguredError: class extends Error {},
}));
vi.mock('@/contexts/messaging', () => ({
  messagingApiV1: { sendText: vi.fn() },
  SuppressedRecipientError: class extends Error {},
  NumberNotConnectedError: class extends Error {},
}));
vi.mock('@/contexts/patient', () => ({ patientApiV1: { getProactiveContact: vi.fn() } }));
vi.mock('@/contexts/payments', () => ({ paymentsApiV1: { getPayableCharge: vi.fn() } }));
vi.mock('@/contexts/financial', () => ({ financialApiV1: { getLancamento: vi.fn() } }));
vi.mock('@/contexts/clinical', () => ({ clinicalApiV1: { getFollowupState: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
    lookupAppointment: vi.fn(),
    lookupWaitlistOffer: vi.fn(),
    hasFutureEquivalentAppointment: vi.fn(),
    hasSubsequentCompletedAppointment: vi.fn(),
  },
}));

/* eslint-disable boundaries/element-types -- imports dos módulos mockados (vi.mock) p/ asserção. */
import { financialApiV1 } from '@/contexts/financial';
import { clinicalApiV1 } from '@/contexts/clinical';
import { messagingApiV1 } from '@/contexts/messaging';
import { patientApiV1 } from '@/contexts/patient';
import { paymentsApiV1 } from '@/contexts/payments';
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import * as repo from '../infra/repository';
import { buildProactiveTemplate } from '../infra/templates';
import { processProactiveBatch } from './process';

const U = '11111111-1111-1111-1111-111111111111';
const okContact = {
  nome: 'Maria',
  phone: '5511999990000',
  deceased: false,
  cobrancaWhatsapp: true,
  consentRevoked: false,
  suppressedWhatsapp: false,
  suppressedWhatsappPurposes: [],
};
const reminderPayload = {
  patientId: U,
  appointmentId: U,
  scheduledAt: '2026-06-19T12:00:00Z',
  doctorNome: 'Dr X',
};
const dunningPayload = {
  patientId: U,
  lancamentoId: U,
  stage: 3,
  valor: 200,
  dueDate: '2026-06-10',
  procedureNome: 'Consulta',
};
const followupPayload = {
  patientId: U,
  prontuarioId: U,
  doctorNome: 'Dr X',
  returnDate: '2026-09-10',
};
const noShowFollowupPayload = {
  patientId: U,
  appointmentId: U,
  noShowAt: '2026-09-04T15:00:00.000Z',
};
const depositPayload = {
  patientId: U,
  chargeId: U,
  appointmentId: U,
  amount: 150,
  holdExpiresAt: '2026-08-26T17:00:00.000Z',
};
const remainderPayload = {
  patientId: U,
  chargeId: U,
  appointmentId: U,
  amount: 80,
};
// WAIT-001 — vaga liberada por cancelamento, ofertada ao 1º da fila.
const RELEASED = '22222222-2222-2222-2222-222222222222';
const waitlistPayload = {
  patientId: U,
  waitlistEntryId: U,
  releasedAppointmentId: RELEASED,
  scheduledAt: '2026-09-12T13:00:00Z',
  doctorNome: 'Dr X',
};

/** Geração 0 por padrão: a chave de envio é o próprio id do job. */
function claim(job: Record<string, unknown>): void {
  vi.mocked(repo.claimDue).mockResolvedValue([
    { leaseToken: 'lease-1', sendKey: job.id, resend: false, failedReason: null, ...job } as never,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getClinicTimezone).mockResolvedValue('America/Sao_Paulo');
  vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue(okContact);
  vi.mocked(paymentsApiV1.getPayableCharge).mockResolvedValue({
    chargeId: U,
    appointmentId: U,
    amount: 80,
    invoiceUrl: 'https://www.asaas.com/i/current-link',
    holdExpiresAt: null,
  });
  vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({ status: 'confirmado' } as never);
  vi.mocked(financialApiV1.getLancamento).mockResolvedValue({ status: 'pendente' } as never);
  vi.mocked(clinicalApiV1.getFollowupState).mockResolvedValue({
    prontuarioId: U,
    patientId: U,
    doctorId: U,
    appointmentId: U,
    status: 'assinado',
    needsReturn: true,
    signedAt: new Date('2026-06-10T12:00:00Z'),
  });
  vi.mocked(schedulingApiV1.hasSubsequentCompletedAppointment).mockResolvedValue(false);
  vi.mocked(schedulingApiV1.hasFutureEquivalentAppointment).mockResolvedValue(false);
  vi.mocked(schedulingApiV1.lookupWaitlistOffer).mockResolvedValue({
    status: 'offered',
    patientId: U,
    offeredAppointmentId: RELEASED,
  });
});

describe('WAIT-001 — oferta da lista de espera', () => {
  /** A vaga só existe enquanto o atendimento liberado seguir cancelado. */
  function slotStillFree(): void {
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'cancelado',
    } as never);
  }

  it('oferta aberta com vaga livre → envia e marca sent', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'waitlist_offer',
      payload: waitlistPayload,
      attempts: 1,
    });
    slotStillFree();
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const s = await processProactiveBatch('waitlist_offer');
    expect(s.sent).toBe(1);
    // Respeita o opt-out de `followup`: é contato proativo de agendamento.
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'followup' }),
    );
  });

  it('oferta já aceita/recusada → cancelled, sem convidar para vaga inexistente', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'waitlist_offer',
      payload: waitlistPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupWaitlistOffer).mockResolvedValue({
      status: 'booked',
      patientId: U,
      offeredAppointmentId: RELEASED,
    });

    const s = await processProactiveBatch('waitlist_offer');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'waitlist_offer_closed');
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('vaga reaberta ou preenchida por outro caminho → cancelled', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'waitlist_offer',
      payload: waitlistPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'agendado',
    } as never);

    const s = await processProactiveBatch('waitlist_offer');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'waitlist_slot_unavailable');
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('entrada já ofertada para OUTRA vaga → cancelled (oferta superada)', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'waitlist_offer',
      payload: waitlistPayload,
      attempts: 1,
    });
    slotStillFree();
    vi.mocked(schedulingApiV1.lookupWaitlistOffer).mockResolvedValue({
      status: 'offered',
      patientId: U,
      offeredAppointmentId: '33333333-3333-3333-3333-333333333333',
    });

    const s = await processProactiveBatch('waitlist_offer');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'waitlist_offer_superseded');
  });

  it('paciente na suppression não recebe oferta', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'waitlist_offer',
      payload: waitlistPayload,
      attempts: 1,
    });
    slotStillFree();
    vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue({
      ...okContact,
      suppressedWhatsappPurposes: ['followup'],
    });

    const s = await processProactiveBatch('waitlist_offer');
    expect(s.cancelled).toBe(1);
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });
});

describe('processProactiveBatch (C14 §14.6)', () => {
  it('2.4B: falta ainda válida envia template próprio com propósito followup', async () => {
    claim({
      id: 'j-falta',
      clinicId: 'c1',
      type: 'no_show_followup',
      payload: noShowFollowupPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'faltou',
      patientId: U,
      procedureId: U,
    } as never);
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.sent).toBe(1);
    expect(schedulingApiV1.hasFutureEquivalentAppointment).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        patientId: U,
        procedureId: U,
        excludeAppointmentId: U,
        after: new Date('2026-09-04T15:00:00.000Z'),
      }),
    );
    expect(buildProactiveTemplate).toHaveBeenCalledWith(
      'no_show_followup',
      noShowFollowupPayload,
      'Maria',
      'America/Sao_Paulo',
      undefined,
    );
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'j-falta', purpose: 'followup' }),
    );
  });

  it('2.4B: falta corrigida antes do worker cancela sem contato', async () => {
    claim({
      id: 'j-falta',
      clinicId: 'c1',
      type: 'no_show_followup',
      payload: noShowFollowupPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'agendado',
      patientId: U,
      procedureId: U,
    } as never);

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j-falta', 'lease-1', 'no_show_reversed');
    expect(patientApiV1.getProactiveContact).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('2.4B: paciente divergente cancela sem procurar remarcação', async () => {
    claim({
      id: 'j-falta',
      clinicId: 'c1',
      type: 'no_show_followup',
      payload: noShowFollowupPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'faltou',
      patientId: '22222222-2222-2222-2222-222222222222',
      procedureId: U,
    } as never);

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith(
      'c1',
      'j-falta',
      'lease-1',
      'no_show_patient_mismatch',
    );
    expect(schedulingApiV1.hasFutureEquivalentAppointment).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('2.4B: remarcação equivalente existente cancela sem enviar', async () => {
    claim({
      id: 'j-falta',
      clinicId: 'c1',
      type: 'no_show_followup',
      payload: noShowFollowupPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({
      status: 'faltou',
      patientId: U,
      procedureId: U,
    } as never);
    vi.mocked(schedulingApiV1.hasFutureEquivalentAppointment).mockResolvedValue(true);

    const summary = await processProactiveBatch('no_show_followup');

    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith(
      'c1',
      'j-falta',
      'lease-1',
      'no_show_already_rescheduled',
    );
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('1.6c: remainder_link resolve cobrança no send-time e envia pelo template próprio', async () => {
    claim({
      id: 'j-restante',
      clinicId: 'c1',
      type: 'remainder_link',
      payload: remainderPayload,
      attempts: 1,
    });
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const summary = await processProactiveBatch('remainder_link');

    expect(summary.sent).toBe(1);
    expect(paymentsApiV1.getPayableCharge).toHaveBeenCalledWith('c1', U);
    expect(buildProactiveTemplate).toHaveBeenCalledWith(
      'remainder_link',
      remainderPayload,
      'Maria',
      'America/Sao_Paulo',
      { invoiceUrl: 'https://www.asaas.com/i/current-link' },
    );
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'j-restante', purpose: 'billing' }),
    );
    expect(schedulingApiV1.lookupAppointment).not.toHaveBeenCalled();
  });

  it('1.6c: cobrança paga/estornada/inválida antes do worker não envia', async () => {
    claim({
      id: 'j-restante',
      clinicId: 'c1',
      type: 'remainder_link',
      payload: remainderPayload,
      attempts: 1,
    });
    vi.mocked(paymentsApiV1.getPayableCharge).mockResolvedValue(null);

    const summary = await processProactiveBatch('remainder_link');

    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j-restante', 'lease-1', 'charge_not_payable');
    expect(buildProactiveTemplate).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('regressão: deposit_link mantém guard de agenda e template do sinal', async () => {
    claim({
      id: 'j-sinal',
      clinicId: 'c1',
      type: 'deposit_link',
      payload: depositPayload,
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({ status: 'agendado' } as never);
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const summary = await processProactiveBatch('deposit_link');

    expect(summary.sent).toBe(1);
    expect(buildProactiveTemplate).toHaveBeenCalledWith(
      'deposit_link',
      depositPayload,
      'Maria',
      'America/Sao_Paulo',
      { invoiceUrl: 'https://www.asaas.com/i/current-link' },
    );
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'j-sinal', purpose: 'reminder' }),
    );
  });

  it('T1: reminder de consulta ativa, contato OK, Meta aceita → sent', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const s = await processProactiveBatch('reminder');
    expect(s.sent).toBe(1);
    expect(repo.finalizeSent).toHaveBeenCalledWith('c1', 'j1', 'lease-1');
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'reminder' }),
    );
  });

  it('T2a: telefone em suppression → cancelled(suppressed), não envia', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue({
      ...okContact,
      suppressedWhatsapp: true,
    });

    const s = await processProactiveBatch('reminder');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'suppressed');
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('T2b: dunning sem opt-in de cobrança → cancelled(no_consent)', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'dunning', payload: dunningPayload, attempts: 1 });
    vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue({
      ...okContact,
      cobrancaWhatsapp: false,
    });

    const s = await processProactiveBatch('dunning');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'no_consent');
  });

  it('T5: dunning cujo lançamento já foi pago → cancelled(already_paid), não envia', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'dunning', payload: dunningPayload, attempts: 1 });
    vi.mocked(financialApiV1.getLancamento).mockResolvedValue({ status: 'pago' } as never);

    const s = await processProactiveBatch('dunning');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'already_paid');
    expect(patientApiV1.getProactiveContact).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('mantem cobranca de lancamento parcial pelo saldo residual', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'dunning', payload: dunningPayload, attempts: 1 });
    vi.mocked(financialApiV1.getLancamento).mockResolvedValue({ status: 'parcial' } as never);
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      status: 'accepted',
      providerMessageId: 'w',
      deduped: false,
    });

    const s = await processProactiveBatch('dunning');
    expect(s.sent).toBe(1);
    expect(repo.cancel).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'billing' }),
    );
  });

  it('cancela follow-up quando o retorno clínico deixou de ser necessário', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'followup', payload: followupPayload, attempts: 1 });
    vi.mocked(clinicalApiV1.getFollowupState).mockResolvedValue({
      prontuarioId: U,
      patientId: U,
      doctorId: U,
      appointmentId: U,
      status: 'assinado',
      needsReturn: false,
      signedAt: new Date('2026-06-10T12:00:00Z'),
    });

    const summary = await processProactiveBatch('followup');
    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'return_no_longer_needed');
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('cancela follow-up quando já houve consulta posterior equivalente', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'followup', payload: followupPayload, attempts: 1 });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({ procedureId: U } as never);
    vi.mocked(schedulingApiV1.hasSubsequentCompletedAppointment).mockResolvedValue(true);

    const summary = await processProactiveBatch('followup');
    expect(summary.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'return_already_completed');
    expect(schedulingApiV1.hasSubsequentCompletedAppointment).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ patientId: U, procedureId: U }),
    );
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });
});

describe('ADR-064 — recusa da Meta, reenvio e chave por geração', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const SECOND_KEY = '44444444-4444-4444-8444-444444444444';

  /** Resultado de `sendText` sem wamid: recusa síncrona, timeout ou reserva sem finalize. */
  function sendResult(over: {
    status: 'failed' | 'unknown' | 'pending' | 'accepted';
    deduped?: boolean;
    errorCode?: string | null;
    providerMessageId?: string | null;
  }) {
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({
      id: 'o1',
      providerMessageId: null,
      deduped: false,
      ...over,
    });
  }

  function dunningJob(over: Record<string, unknown> = {}): void {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'dunning',
      payload: dunningPayload,
      attempts: 1,
      ...over,
    });
  }

  it('T6a: geração 0 envia com a chave = job.id; o reenvio, com a send_key gravada', async () => {
    dunningJob();
    sendResult({ status: 'accepted', providerMessageId: 'w' });
    await processProactiveBatch('dunning');

    dunningJob({ sendKey: SECOND_KEY, resend: true, failedReason: 'meta_131000', attempts: 2 });
    await processProactiveBatch('dunning');

    expect(
      vi.mocked(messagingApiV1.sendText).mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual(['j1', SECOND_KEY]);
  });

  it('T6b: recusa síncrona retentável → pending com chave NOVA e backoff (+30 s)', async () => {
    dunningJob();
    sendResult({ status: 'failed', errorCode: '131000' });

    const before = Date.now();
    const s = await processProactiveBatch('dunning');

    expect(s.retried).toBe(1);
    expect(repo.finalizeResend).toHaveBeenCalledTimes(1);
    const [clinicId, jobId, leaseToken, nextAt, reason, nextKey] = vi.mocked(repo.finalizeResend)
      .mock.calls[0]!;
    expect([clinicId, jobId, leaseToken, reason]).toEqual(['c1', 'j1', 'lease-1', 'meta_131000']);
    expect(nextAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(nextAt.getTime()).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(nextKey).toMatch(UUID);
    expect(nextKey).not.toBe('j1');
    expect(repo.finalizeRetry).not.toHaveBeenCalled();
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
  });

  it('T6c: o reenvio usa a chave nova, então o sender envia de novo em vez de deduplicar', async () => {
    dunningJob();
    sendResult({ status: 'failed', errorCode: '130429' });
    await processProactiveBatch('dunning');
    const nextKey = vi.mocked(repo.finalizeResend).mock.calls[0]![5];

    dunningJob({ sendKey: nextKey, resend: true, failedReason: 'meta_130429', attempts: 2 });
    sendResult({ status: 'accepted', providerMessageId: 'w2' });
    const s = await processProactiveBatch('dunning');

    const keys = vi.mocked(messagingApiV1.sendText).mock.calls.map(([i]) => i.idempotencyKey);
    expect(keys).toEqual(['j1', nextKey]);
    expect(new Set(keys).size).toBe(2);
    expect(s.sent).toBe(1);
    expect(repo.finalizeSent).toHaveBeenCalledWith('c1', 'j1', 'lease-1');
  });

  it('T6d: recusa síncrona definitiva → failed NA HORA, com o código da Meta', async () => {
    dunningJob();
    sendResult({ status: 'failed', errorCode: '131026' });

    const s = await processProactiveBatch('dunning');

    expect(s.failed).toBe(1);
    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'meta_131026');
    expect(repo.finalizeRetry).not.toHaveBeenCalled();
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6e: 131048 (qualidade) e 131049 (esperar 24 h) são definitivos', async () => {
    for (const code of ['131048', '131049']) {
      vi.mocked(repo.finalizeFailed).mockClear();
      dunningJob();
      sendResult({ status: 'failed', errorCode: code });

      await processProactiveBatch('dunning');

      expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', `meta_${code}`);
    }
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6f: recusa sem código → meta_failed na hora (sem código não há como saber se passa)', async () => {
    dunningJob();
    sendResult({ status: 'failed', errorCode: null });

    await processProactiveBatch('dunning');

    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'meta_failed');
    expect(repo.finalizeRetry).not.toHaveBeenCalled();
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6g: recusa retentável na 5ª tentativa → failed com o código, sem chave nova', async () => {
    dunningJob({ attempts: 5 });
    sendResult({ status: 'failed', errorCode: '131000' });

    const s = await processProactiveBatch('dunning');

    expect(s.failed).toBe(1);
    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'meta_131000');
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6h: timeout (unknown) → failed meta_unknown NA HORA; nunca chave nova', async () => {
    for (const deduped of [false, true]) {
      vi.mocked(repo.finalizeFailed).mockClear();
      dunningJob();
      sendResult({ status: 'unknown', deduped });

      await processProactiveBatch('dunning');

      expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'meta_unknown');
    }
    expect(repo.finalizeRetry).not.toHaveBeenCalled();
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6i: failed deduplicado COM wamid foi aceito → sent; a recusa é do handler EC-32', async () => {
    dunningJob();
    sendResult({ status: 'failed', deduped: true, providerMessageId: 'wamid.X' });

    const s = await processProactiveBatch('dunning');

    expect(s.sent).toBe(1);
    expect(repo.finalizeSent).toHaveBeenCalledWith('c1', 'j1', 'lease-1');
    expect(repo.finalizeFailed).not.toHaveBeenCalled();
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6j: failed deduplicado SEM wamid usa o código guardado da recusa síncrona', async () => {
    dunningJob();
    sendResult({ status: 'failed', deduped: true, errorCode: '131016' });

    const s = await processProactiveBatch('dunning');

    expect(s.retried).toBe(1);
    expect(vi.mocked(repo.finalizeResend).mock.calls[0]![4]).toBe('meta_131016');
  });

  it('T6k: pending no dedup → backoff com a MESMA chave (outra tentativa em voo)', async () => {
    dunningJob();
    sendResult({ status: 'pending', deduped: true });

    const s = await processProactiveBatch('dunning');

    expect(s.retried).toBe(1);
    const [, , leaseToken, , reason] = vi.mocked(repo.finalizeRetry).mock.calls[0]!;
    expect([leaseToken, reason]).toEqual(['lease-1', 'meta_pending']);
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6l: exceção do sender → backoff com a MESMA chave (meta_error)', async () => {
    dunningJob();
    vi.mocked(messagingApiV1.sendText).mockRejectedValue(new Error('db down'));

    const s = await processProactiveBatch('dunning');

    expect(s.retried).toBe(1);
    expect(vi.mocked(repo.finalizeRetry).mock.calls[0]![4]).toBe('meta_error');
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6m: sinal — recusa retentável sem tempo de reenviar antes do hold → failed com o código', async () => {
    claim({
      id: 'j-sinal',
      clinicId: 'c1',
      type: 'deposit_link',
      payload: { ...depositPayload, holdExpiresAt: new Date(Date.now() + 10_000).toISOString() },
      attempts: 1,
    });
    vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({ status: 'agendado' } as never);
    sendResult({ status: 'failed', errorCode: '131000' });

    const s = await processProactiveBatch('deposit_link');

    expect(s.failed).toBe(1);
    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j-sinal', 'lease-1', 'meta_131000');
    expect(repo.finalizeResend).not.toHaveBeenCalled();
  });

  it('T6n: reenvio reivindicado depois do prazo não envia e fecha com a recusa que o motivou', async () => {
    claim({
      id: 'j1',
      clinicId: 'c1',
      type: 'reminder',
      // A consulta já passou: a janela 8–20 h empurrou o reenvio para depois dela.
      payload: { ...reminderPayload, scheduledAt: new Date(Date.now() - 60_000).toISOString() },
      attempts: 2,
      sendKey: SECOND_KEY,
      resend: true,
      failedReason: 'meta_131016',
    });

    const s = await processProactiveBatch('reminder');

    expect(s.failed).toBe(1);
    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'lease-1', 'meta_131016');
    expect(schedulingApiV1.lookupAppointment).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('T6o: o prazo só vale para reenvio; a geração 0 segue o guard de sempre', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    sendResult({ status: 'accepted', providerMessageId: 'w' });

    const s = await processProactiveBatch('reminder');

    expect(s.sent).toBe(1);
    expect(messagingApiV1.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'j1' }),
    );
  });
});
