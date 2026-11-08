import 'server-only';

import type { HandoffPulse } from '@/contexts/ai-agent/queries';
import type { CashFlowDTO } from '@/contexts/financial/types';
import type { AuditActivity } from '@/lib/audit/recent';

import type { DashboardDTO } from './data';

/** Prévia visual de uma conta de teste; nenhum registro é escrito no domínio. */
export function dashboardDemoData(userId: string, days: string[], now = new Date()) {
  const appointmentAt = (minutes: number) =>
    new Date(now.getTime() + minutes * 60_000).toISOString();
  const dashboard: DashboardDTO = {
    consultasHoje: 11,
    aguardando: 1,
    emAtendimento: 1,
    finalizadas: 7,
    faltas: 1,
    cancelados: 1,
    faltaNome: 'Paciente ilustrativo',
    maiorEsperaMin: 14,
    maiorEsperaNome: 'Paciente ilustrativo A',
    naoFaturados: 0,
    proximos: [
      {
        appointmentId: 'demo-appointment-1',
        horario: appointmentAt(20),
        nome: 'Paciente ilustrativo A',
        procedimento: 'Consulta de retorno',
        profissional: 'Profissional ilustrativo',
        status: 'chegou',
      },
      {
        appointmentId: 'demo-appointment-2',
        horario: appointmentAt(50),
        nome: 'Paciente ilustrativo B',
        procedimento: 'Primeira consulta',
        profissional: 'Profissional ilustrativo',
        status: 'confirmado',
      },
      {
        appointmentId: 'demo-appointment-3',
        horario: appointmentAt(80),
        nome: 'Paciente ilustrativo C',
        procedimento: 'Consulta de acompanhamento',
        profissional: 'Profissional ilustrativo',
        status: 'agendado',
      },
    ],
  };
  const flow: CashFlowDTO = {
    receber: 2360,
    pagar: 420,
    recebidoHoje: 1820,
    pagoHoje: 180,
    saldoHoje: 1640,
    contagens: { receber: 8, receberVencidos: 1, pagar: 2, recebimentos: 7, pagamentos: 1 },
  };
  const received = [760, 1120, 980, 1350, 1190, 1480, flow.recebidoHoje];
  const serie = days.map((date, index) => ({
    date,
    totalRecebido: received[index] ?? 0,
    totalPago: 0,
    saldo: received[index] ?? 0,
  }));
  const activity: AuditActivity[] = [
    {
      id: 'demo-activity-1',
      action: 'appointment.confirmed',
      resourceType: 'appointment',
      resourceId: null,
      userId,
      createdAt: appointmentAt(-10),
    },
    {
      id: 'demo-activity-2',
      action: 'patient.created',
      resourceType: 'patient',
      resourceId: null,
      userId,
      createdAt: appointmentAt(-35),
    },
    {
      id: 'demo-activity-3',
      action: 'appointment.completed',
      resourceType: 'appointment',
      resourceId: null,
      userId,
      createdAt: appointmentAt(-65),
    },
  ];
  const handoff: HandoffPulse = { abertos: 0, vencidos: 0 };
  return { dashboard, flow, serie, activity, handoff };
}
