/**
 * Processor C14 — matriz de decisão (T1/T2/T5/T6 do §14.6) com I/O mockado.
 *
 * Cobre o que é do C14: accepted→sent, bloqueio (suppression/consent)→cancelled,
 * guard de dunning (já pago)→cancelled, falha Meta→retry/backoff→failed.
 * T3/T4 (paciente responde SIM/REMARCAR) NÃO estão aqui: são do C11 (inbound
 * webhook → tools confirm/reschedule), que C14 não altera — cobertos por C11.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infra/repository', () => ({
  claimDue: vi.fn(),
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
  finalizeSent: vi.fn(async () => {}),
  finalizeRetry: vi.fn(async () => {}),
  finalizeFailed: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
}));
vi.mock('../infra/templates', () => ({
  buildProactiveTemplate: vi.fn(() => ({ templateName: 't', languageCode: 'pt_BR', variables: [] })),
  TemplateNotConfiguredError: class extends Error {},
}));
vi.mock('@/contexts/messaging', () => ({
  messagingApiV1: { sendText: vi.fn() },
  SuppressedRecipientError: class extends Error {},
  NumberNotConnectedError: class extends Error {},
}));
vi.mock('@/contexts/patient', () => ({ patientApiV1: { getProactiveContact: vi.fn() } }));
vi.mock('@/contexts/financial', () => ({ financialApiV1: { getLancamento: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({ schedulingApiV1: { lookupAppointment: vi.fn() } }));

/* eslint-disable boundaries/element-types -- imports dos módulos mockados (vi.mock) p/ asserção. */
import { financialApiV1 } from '@/contexts/financial';
import { messagingApiV1 } from '@/contexts/messaging';
import { patientApiV1 } from '@/contexts/patient';
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import * as repo from '../infra/repository';
import { processProactiveBatch } from './process';

const U = '11111111-1111-1111-1111-111111111111';
const okContact = {
  nome: 'Maria',
  phone: '5511999990000',
  cobrancaWhatsapp: true,
  consentRevoked: false,
  suppressedWhatsapp: false,
};
const reminderPayload = { patientId: U, appointmentId: U, scheduledAt: '2026-06-19T12:00:00Z', doctorNome: 'Dr X' };
const dunningPayload = { patientId: U, lancamentoId: U, stage: 3, valor: 200, dueDate: '2026-06-10', procedureNome: 'Consulta' };

function claim(job: Record<string, unknown>): void {
  vi.mocked(repo.claimDue).mockResolvedValue([job as never]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getClinicTimezone).mockResolvedValue('America/Sao_Paulo');
  vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue(okContact);
  vi.mocked(schedulingApiV1.lookupAppointment).mockResolvedValue({ status: 'confirmado' } as never);
  vi.mocked(financialApiV1.getLancamento).mockResolvedValue({ status: 'pendente' } as never);
});

describe('processProactiveBatch (C14 §14.6)', () => {
  it('T1: reminder de consulta ativa, contato OK, Meta aceita → sent', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({ id: 'o1', status: 'accepted', providerMessageId: 'w', deduped: false });

    const s = await processProactiveBatch('reminder');
    expect(s.sent).toBe(1);
    expect(repo.finalizeSent).toHaveBeenCalledWith('c1', 'j1');
  });

  it('T2a: telefone em suppression → cancelled(suppressed), não envia', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue({ ...okContact, suppressedWhatsapp: true });

    const s = await processProactiveBatch('reminder');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'suppressed');
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('T2b: dunning sem opt-in de cobrança → cancelled(no_consent)', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'dunning', payload: dunningPayload, attempts: 1 });
    vi.mocked(patientApiV1.getProactiveContact).mockResolvedValue({ ...okContact, cobrancaWhatsapp: false });

    const s = await processProactiveBatch('dunning');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'no_consent');
  });

  it('T5: dunning cujo lançamento já foi pago → cancelled(already_paid), não envia', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'dunning', payload: dunningPayload, attempts: 1 });
    vi.mocked(financialApiV1.getLancamento).mockResolvedValue({ status: 'pago' } as never);

    const s = await processProactiveBatch('dunning');
    expect(s.cancelled).toBe(1);
    expect(repo.cancel).toHaveBeenCalledWith('c1', 'j1', 'already_paid');
    expect(patientApiV1.getProactiveContact).not.toHaveBeenCalled();
    expect(messagingApiV1.sendText).not.toHaveBeenCalled();
  });

  it('T6a: falha Meta na 1ª tentativa → retry com backoff (+30s)', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 1 });
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({ id: 'o1', status: 'failed', providerMessageId: null, deduped: false });

    const before = Date.now();
    const s = await processProactiveBatch('reminder');
    expect(s.retried).toBe(1);
    expect(repo.finalizeRetry).toHaveBeenCalledTimes(1);
    const [, , nextAt, reason] = vi.mocked(repo.finalizeRetry).mock.calls[0]!;
    expect(reason).toBe('meta_failed');
    expect((nextAt as Date).getTime()).toBeGreaterThanOrEqual(before + 30_000 - 1000);
  });

  it('T6b: falha Meta após esgotar MAX_ATTEMPTS → failed definitivo', async () => {
    claim({ id: 'j1', clinicId: 'c1', type: 'reminder', payload: reminderPayload, attempts: 5 });
    vi.mocked(messagingApiV1.sendText).mockResolvedValue({ id: 'o1', status: 'failed', providerMessageId: null, deduped: false });

    const s = await processProactiveBatch('reminder');
    expect(s.failed).toBe(1);
    expect(repo.finalizeFailed).toHaveBeenCalledWith('c1', 'j1', 'meta_failed');
    expect(repo.finalizeRetry).not.toHaveBeenCalled();
  });
});
