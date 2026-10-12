/**
 * EC-32 — a regra que decide o que entra na faixa da Agenda.
 *
 * O caso que motivou tudo: o link do sinal não chega e a vaga vence. Enquanto o
 * hold vale, a falha é acionável e o link pode ser copiado; depois, ela só
 * explica (no selo) por que a consulta caiu.
 */
import { describe, expect, it } from 'vitest';

import type { ProactiveDeliveryFailureDTO } from '@/contexts/ai-agent/queries';

import {
  buildAgendaDeliveryFailures,
  type AgendaFailureAppointment,
  type BuildAgendaDeliveryFailuresInput,
} from './delivery-failures';

const NOW = new Date('2026-10-08T15:00:00.000Z'); // 12:00 em São Paulo
const TODAY = '2026-10-08';
const PATIENT = '44444444-4444-4444-8444-444444444444';
const APPOINTMENT = '55555555-5555-4555-8555-555555555555';
const CHARGE = '66666666-6666-4666-8666-666666666666';

function failure(over: Partial<ProactiveDeliveryFailureDTO>): ProactiveDeliveryFailureDTO {
  return {
    jobId: 'job-1',
    type: 'deposit_link',
    patientId: PATIENT,
    appointmentId: APPOINTMENT,
    chargeId: CHARGE,
    scheduledAt: null,
    returnDate: null,
    attemptedAt: '2026-10-08T14:01:00.000Z',
    cause: { kind: 'meta_refused', code: '131042' },
    ...over,
  };
}

function appointment(over: Partial<AgendaFailureAppointment> = {}): AgendaFailureAppointment {
  return {
    status: 'agendado',
    scheduledAt: '2026-10-10T13:00:00.000Z',
    depositStatus: 'pending',
    holdExpiresAt: '2026-10-08T21:00:00.000Z',
    ...over,
  };
}

function build(over: Partial<BuildAgendaDeliveryFailuresInput>) {
  return buildAgendaDeliveryFailures({
    failures: [],
    appointments: new Map([[APPOINTMENT, appointment()]]),
    chargeStatus: new Map([[CHARGE, 'pending']]),
    patientNames: new Map([[PATIENT, 'Maria Souza']]),
    now: NOW,
    today: TODAY,
    ...over,
  });
}

describe('buildAgendaDeliveryFailures — sinal', () => {
  it('hold vigente: acionável, com o prazo da CONSULTA e o link copiável', () => {
    const [item] = build({ failures: [failure({})] });

    expect(item).toEqual({
      jobId: 'job-1',
      kind: 'deposit_link',
      pacienteNome: 'Maria Souza',
      appointmentId: APPOINTMENT,
      consultaEm: '2026-10-10T13:00:00.000Z',
      retornoEm: null,
      vagaSeguradaAte: '2026-10-08T21:00:00.000Z',
      acionavel: true,
      linkCopiavel: true,
      causa: { kind: 'meta_refused', code: '131042' },
    });
  });

  it('hold vencido: sai da faixa, mas o item fica para o selo explicar a vaga caída', () => {
    const [vencido] = build({
      failures: [failure({})],
      appointments: new Map([
        [APPOINTMENT, appointment({ holdExpiresAt: '2026-10-08T14:59:00.000Z' })],
      ]),
    });
    expect(vencido).toMatchObject({ acionavel: false, linkCopiavel: false, vagaSeguradaAte: null });

    const [cancelada] = build({
      failures: [failure({})],
      appointments: new Map([
        [
          APPOINTMENT,
          appointment({ status: 'cancelado', depositStatus: 'expired', holdExpiresAt: null }),
        ],
      ]),
    });
    expect(cancelada).toMatchObject({ acionavel: false, vagaSeguradaAte: null });
  });

  it('sinal já pago ou consulta desconhecida: nada a fazer', () => {
    const [pago] = build({
      failures: [failure({})],
      appointments: new Map([
        [APPOINTMENT, appointment({ depositStatus: 'paid', holdExpiresAt: null })],
      ]),
      chargeStatus: new Map([[CHARGE, 'paid']]),
    });
    expect(pago).toMatchObject({ acionavel: false, linkCopiavel: false });

    const [semConsulta] = build({ failures: [failure({})], appointments: new Map() });
    expect(semConsulta).toMatchObject({ acionavel: false, consultaEm: null });
  });

  it('hold vigente mas cobrança fora de `pending`: acionável, sem botão', () => {
    const [item] = build({
      failures: [failure({})],
      chargeStatus: new Map([[CHARGE, 'cancelled']]),
    });
    expect(item).toMatchObject({ acionavel: true, linkCopiavel: false });
  });
});

describe('buildAgendaDeliveryFailures — demais tipos', () => {
  it('saldo restante vale enquanto a cobrança estiver pendente', () => {
    const remainder = failure({ type: 'remainder_link' });
    expect(build({ failures: [remainder] })[0]).toMatchObject({
      acionavel: true,
      linkCopiavel: true,
      vagaSeguradaAte: null,
    });
    expect(
      build({ failures: [remainder], chargeStatus: new Map([[CHARGE, 'paid']]) })[0],
    ).toMatchObject({ acionavel: false, linkCopiavel: false });
  });

  it('lembrete: só para consulta ativa que ainda não aconteceu', () => {
    const reminder = failure({
      type: 'reminder',
      chargeId: null,
      scheduledAt: '2026-10-09T13:00:00.000Z',
    });
    const active = new Map([
      [APPOINTMENT, appointment({ status: 'confirmado', scheduledAt: '2026-10-09T13:00:00.000Z' })],
    ]);
    expect(build({ failures: [reminder], appointments: active })[0]).toMatchObject({
      acionavel: true,
      linkCopiavel: false,
      consultaEm: '2026-10-09T13:00:00.000Z',
    });

    const past = new Map([
      [APPOINTMENT, appointment({ status: 'agendado', scheduledAt: '2026-10-08T13:00:00.000Z' })],
    ]);
    expect(build({ failures: [reminder], appointments: past })[0]?.acionavel).toBe(false);

    const cancelled = new Map([[APPOINTMENT, appointment({ status: 'cancelado' })]]);
    expect(build({ failures: [reminder], appointments: cancelled })[0]?.acionavel).toBe(false);
  });

  it('contato pós-falta vale enquanto a falta valer', () => {
    const noShow = failure({ type: 'no_show_followup', chargeId: null });
    expect(
      build({
        failures: [noShow],
        appointments: new Map([[APPOINTMENT, appointment({ status: 'faltou' })]]),
      })[0]?.acionavel,
    ).toBe(true);
    expect(
      build({
        failures: [noShow],
        appointments: new Map([[APPOINTMENT, appointment({ status: 'agendado' })]]),
      })[0]?.acionavel,
    ).toBe(false);
  });

  it('oferta de vaga vale até o horário da vaga; retorno, até a data do retorno', () => {
    const offer = failure({
      type: 'waitlist_offer',
      chargeId: null,
      scheduledAt: '2026-10-09T13:00:00.000Z',
    });
    expect(build({ failures: [offer], appointments: new Map() })[0]).toMatchObject({
      acionavel: true,
      consultaEm: '2026-10-09T13:00:00.000Z',
    });
    expect(
      build({
        failures: [{ ...offer, scheduledAt: '2026-10-08T13:00:00.000Z' }],
        appointments: new Map(),
      })[0]?.acionavel,
    ).toBe(false);

    const followup = failure({
      type: 'followup',
      appointmentId: null,
      chargeId: null,
      returnDate: TODAY,
    });
    expect(build({ failures: [followup] })[0]).toMatchObject({
      acionavel: true,
      retornoEm: TODAY,
      consultaEm: null,
    });
    expect(build({ failures: [{ ...followup, returnDate: '2026-10-07' }] })[0]?.acionavel).toBe(
      false,
    );
  });

  it('cobrança D+3/D+7 fica fora da Agenda (é valor, e a Agenda não mostra valor)', () => {
    expect(build({ failures: [failure({ type: 'dunning', appointmentId: null })] })).toEqual([]);
  });

  it('sem paciente resolvido não há a quem recorrer; nome ausente vira null', () => {
    const [semPaciente] = build({
      failures: [failure({ patientId: null, cause: { kind: 'internal' } })],
    });
    expect(semPaciente).toMatchObject({ acionavel: false, pacienteNome: null });

    const [semNome] = build({ failures: [failure({})], patientNames: new Map() });
    expect(semNome).toMatchObject({ acionavel: true, pacienteNome: null });
  });
});

describe('buildAgendaDeliveryFailures — ordem', () => {
  it('o que vence primeiro vem primeiro; sem prazo, fica a ordem da leitura', () => {
    const OTHER = '77777777-7777-4777-8777-777777777777';
    const items = build({
      failures: [
        failure({ jobId: 'saldo', type: 'remainder_link' }),
        failure({
          jobId: 'retorno',
          type: 'followup',
          appointmentId: null,
          chargeId: null,
          returnDate: '2026-10-12',
        }),
        failure({ jobId: 'sinal-tarde', appointmentId: OTHER }),
        failure({ jobId: 'sinal-cedo' }),
        failure({ jobId: 'pos-falta', type: 'no_show_followup', chargeId: null }),
      ],
      appointments: new Map([
        [APPOINTMENT, appointment({ holdExpiresAt: '2026-10-08T18:00:00.000Z' })],
        [OTHER, appointment({ holdExpiresAt: '2026-10-09T11:00:00.000Z' })],
      ]),
    });

    expect(items.map((item) => item.jobId)).toEqual([
      'sinal-cedo',
      'sinal-tarde',
      'retorno',
      'saldo',
      'pos-falta',
    ]);
  });
});
