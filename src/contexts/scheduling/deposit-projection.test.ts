/**
 * ADR-049 1.6b — o estado do sinal chega até a projeção lida pela UI.
 *
 * As colunas existem desde a migration 0085, e mesmo assim a recepção não via
 * nada: `toAppointmentSummary` simplesmente não as mapeava. É o mesmo formato de
 * falha do **D32** — a camada de baixo correta e o produto inexistente, porque o
 * dado parava no meio do caminho.
 *
 * Este teste é a trava contra isso voltar: o mapeamento é feito à mão, campo a
 * campo, então nada avisa quando um campo novo é esquecido.
 */
import { describe, expect, it } from 'vitest';

import { toAppointmentSummary } from './queries';
import type { AppointmentRow } from './schema';

/** Linha mínima do banco — só o que o mapeamento lê. */
function row(over: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: 'apt-1',
    clinicId: 'clinic-1',
    unitId: null,
    doctorId: 'doc-1',
    patientId: 'pac-1',
    procedureId: 'proc-1',
    scheduledAt: new Date('2026-08-26T13:00:00.000Z'),
    durationMin: 50,
    status: 'agendado',
    valor: '300.00',
    valorAjustado: false,
    valorAjusteMotivo: null,
    snapshotProcedureName: 'Consulta',
    snapshotProcedureCodigo: null,
    snapshotProcedureCategoria: null,
    snapshotProcedureValor: '300.00',
    snapshotProcedureDuracaoMin: 50,
    snapshotDoctorNome: 'Ana Costa',
    snapshotDoctorCrm: null,
    snapshotDoctorEspecialidade: null,
    createdVia: 'ui',
    urgencia: false,
    faturamentoPendente: false,
    observacoes: null,
    rescheduledFromAppointmentId: null,
    recurrenceSeriesId: null,
    recurrenceOccurrence: null,
    createdBy: null,
    createdAt: new Date('2026-08-25T10:00:00.000Z'),
    updatedAt: new Date('2026-08-25T10:00:00.000Z'),
    depositStatus: 'none',
    holdExpiresAt: null,
    ...over,
  } as AppointmentRow;
}

describe('projeção do sinal no AppointmentSummary', () => {
  it('sem sinal: `none` e sem prazo — o comportamento de toda clínica hoje', () => {
    const summary = toAppointmentSummary(row());

    expect(summary.depositStatus).toBe('none');
    expect(summary.holdExpiresAt).toBeNull();
  });

  it('vaga segurada: leva o estado E o prazo (é ele que diz se dá para agir)', () => {
    const summary = toAppointmentSummary(
      row({ depositStatus: 'pending', holdExpiresAt: new Date('2026-08-26T12:00:00.000Z') }),
    );

    expect(summary.depositStatus).toBe('pending');
    expect(summary.holdExpiresAt).toBe('2026-08-26T12:00:00.000Z');
  });

  it.each(['paid', 'expired', 'refunded'] as const)(
    'desfecho %s chega à projeção sem prazo (CHECK da 0085)',
    (depositStatus) => {
      const summary = toAppointmentSummary(row({ depositStatus, holdExpiresAt: null }));

      expect(summary.depositStatus).toBe(depositStatus);
      expect(summary.holdExpiresAt).toBeNull();
    },
  );

  it('o sinal NÃO substitui o status do agendamento — as dimensões são ortogonais', () => {
    // Um agendamento pode estar `agendado` com sinal pago: quem move `status` é
    // só a máquina de estados, e `deposit_status` é dimensão separada (0085).
    const summary = toAppointmentSummary(row({ status: 'agendado', depositStatus: 'paid' }));

    expect(summary.status).toBe('agendado');
    expect(summary.depositStatus).toBe('paid');
  });
});
