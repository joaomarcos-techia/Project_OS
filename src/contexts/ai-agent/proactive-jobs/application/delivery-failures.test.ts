/**
 * EC-32 — o DTO das mensagens que não chegaram.
 *
 * Do payload sai só o que a tela usa: paciente, consulta, cobrança, data do
 * retorno. Valor, nome de médico e o resto do snapshot ficam no job. O link de
 * pagamento nunca esteve no payload, e esta leitura também não o busca.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  listFailedSince: vi.fn(),
  countFailedSince: vi.fn(),
  findFailedJob: vi.fn(),
}));

vi.mock('../infra/repository', () => repo);

import {
  countRecentProactiveFailures,
  getFailedJobChargeRef,
  listRecentProactiveFailures,
  toDeliveryFailureDTO,
} from './delivery-failures';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const PATIENT = '44444444-4444-4444-8444-444444444444';
const APPOINTMENT = '55555555-5555-4555-8555-555555555555';
const CHARGE = '66666666-6666-4666-8666-666666666666';
const SENT_AT = new Date('2026-10-08T11:01:00.000Z');

function job(type: string, payload: unknown, failedReason: string | null = 'meta_131042') {
  return { id: JOB, type, payload, failedReason, lastAttemptAt: SENT_AT };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toDeliveryFailureDTO', () => {
  it('sinal: paciente, consulta e cobrança — nunca valor nem prazo do payload', () => {
    const dto = toDeliveryFailureDTO(
      job('deposit_link', {
        patientId: PATIENT,
        chargeId: CHARGE,
        appointmentId: APPOINTMENT,
        amount: 75,
        holdExpiresAt: '2026-10-09T11:00:00.000Z',
      }) as never,
    );

    expect(dto).toEqual({
      jobId: JOB,
      type: 'deposit_link',
      patientId: PATIENT,
      appointmentId: APPOINTMENT,
      chargeId: CHARGE,
      scheduledAt: null,
      returnDate: null,
      attemptedAt: '2026-10-08T11:01:00.000Z',
      cause: { kind: 'meta_refused', code: '131042' },
    });
  });

  it('saldo restante leva a cobrança; lembrete e oferta levam o horário', () => {
    expect(
      toDeliveryFailureDTO(
        job('remainder_link', {
          patientId: PATIENT,
          chargeId: CHARGE,
          appointmentId: APPOINTMENT,
          amount: 75,
        }) as never,
      ),
    ).toMatchObject({ patientId: PATIENT, appointmentId: APPOINTMENT, chargeId: CHARGE });

    expect(
      toDeliveryFailureDTO(
        job('reminder', {
          patientId: PATIENT,
          appointmentId: APPOINTMENT,
          scheduledAt: '2026-10-09T13:00:00.000Z',
          doctorNome: 'Dra. Ana',
        }) as never,
      ),
    ).toMatchObject({
      appointmentId: APPOINTMENT,
      chargeId: null,
      scheduledAt: '2026-10-09T13:00:00.000Z',
    });

    // A oferta aponta para a vaga LIBERADA, que é a consulta de onde ela veio.
    expect(
      toDeliveryFailureDTO(
        job('waitlist_offer', {
          patientId: PATIENT,
          waitlistEntryId: CHARGE,
          releasedAppointmentId: APPOINTMENT,
          scheduledAt: '2026-10-10T13:00:00.000Z',
          doctorNome: null,
        }) as never,
      ),
    ).toMatchObject({ appointmentId: APPOINTMENT, scheduledAt: '2026-10-10T13:00:00.000Z' });
  });

  it('pós-falta, retorno e cobrança D+3/D+7 levam o que cada um tem', () => {
    expect(
      toDeliveryFailureDTO(
        job('no_show_followup', {
          patientId: PATIENT,
          appointmentId: APPOINTMENT,
          noShowAt: '2026-10-07T13:30:00.000Z',
        }) as never,
      ),
    ).toMatchObject({ patientId: PATIENT, appointmentId: APPOINTMENT });

    expect(
      toDeliveryFailureDTO(
        job('followup', {
          patientId: PATIENT,
          prontuarioId: CHARGE,
          doctorNome: null,
          returnDate: '2026-10-20',
        }) as never,
      ),
    ).toMatchObject({ patientId: PATIENT, appointmentId: null, returnDate: '2026-10-20' });

    expect(
      toDeliveryFailureDTO(
        job('dunning', {
          patientId: PATIENT,
          lancamentoId: CHARGE,
          stage: 3,
          valor: 150,
          dueDate: '2026-10-01',
          procedureNome: null,
        }) as never,
      ),
    ).toMatchObject({ type: 'dunning', patientId: PATIENT, appointmentId: null, chargeId: null });
  });

  it('payload inválido não derruba a lista: o item sai sem referências, com a causa', () => {
    const dto = toDeliveryFailureDTO(
      job('deposit_link', { patientId: 'x' }, 'invalid_payload') as never,
    );

    expect(dto).toMatchObject({
      patientId: null,
      appointmentId: null,
      chargeId: null,
      cause: { kind: 'internal' },
    });
  });

  it('sem última tentativa, sem data', () => {
    const dto = toDeliveryFailureDTO({
      ...job('followup', {
        patientId: PATIENT,
        prontuarioId: CHARGE,
        doctorNome: null,
        returnDate: '2026-10-20',
      }),
      lastAttemptAt: null,
    } as never);
    expect(dto.attemptedAt).toBeNull();
  });
});

describe('listRecentProactiveFailures / countRecentProactiveFailures', () => {
  it('lista pela janela pedida, com o teto padrão de 100', async () => {
    const since = new Date('2026-10-01T12:00:00.000Z');
    repo.listFailedSince.mockResolvedValue([
      job('reminder', {
        patientId: PATIENT,
        appointmentId: APPOINTMENT,
        scheduledAt: '2026-10-09T13:00:00.000Z',
        doctorNome: 'Dra. Ana',
      }),
    ]);

    const rows = await listRecentProactiveFailures(CLINIC, { since });

    expect(repo.listFailedSince).toHaveBeenCalledWith(CLINIC, since, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'reminder', appointmentId: APPOINTMENT });

    await listRecentProactiveFailures(CLINIC, { since, limit: 5 });
    expect(repo.listFailedSince).toHaveBeenLastCalledWith(CLINIC, since, 5);
  });

  it('conta pelo mesmo critério do repositório', async () => {
    const since = new Date('2026-10-01T12:00:00.000Z');
    repo.countFailedSince.mockResolvedValue(4);

    await expect(countRecentProactiveFailures(CLINIC, since)).resolves.toBe(4);
    expect(repo.countFailedSince).toHaveBeenCalledWith(CLINIC, since);
  });
});

describe('getFailedJobChargeRef', () => {
  it('link de sinal ou de saldo que falhou → a cobrança, sem o link', async () => {
    repo.findFailedJob.mockResolvedValue(
      job('deposit_link', {
        patientId: PATIENT,
        chargeId: CHARGE,
        appointmentId: APPOINTMENT,
        amount: 75,
        holdExpiresAt: '2026-10-09T11:00:00.000Z',
      }),
    );

    await expect(getFailedJobChargeRef(CLINIC, JOB)).resolves.toEqual({
      jobId: JOB,
      type: 'deposit_link',
      chargeId: CHARGE,
    });
    expect(repo.findFailedJob).toHaveBeenCalledWith(CLINIC, JOB);
  });

  it('job inexistente, de outro tipo ou com payload inválido → null', async () => {
    repo.findFailedJob.mockResolvedValueOnce(null);
    await expect(getFailedJobChargeRef(CLINIC, JOB)).resolves.toBeNull();

    repo.findFailedJob.mockResolvedValueOnce(
      job('reminder', {
        patientId: PATIENT,
        appointmentId: APPOINTMENT,
        scheduledAt: '2026-10-09T13:00:00.000Z',
        doctorNome: 'Dra. Ana',
      }),
    );
    await expect(getFailedJobChargeRef(CLINIC, JOB)).resolves.toBeNull();

    repo.findFailedJob.mockResolvedValueOnce(job('remainder_link', { patientId: PATIENT }));
    await expect(getFailedJobChargeRef(CLINIC, JOB)).resolves.toBeNull();
  });
});
