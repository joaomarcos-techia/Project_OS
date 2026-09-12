import 'server-only';

import { sql } from 'drizzle-orm';

import { practitionerSql, profiles } from '@/contexts/identity';
import { listPatientCards } from '@/contexts/patient/queries';
import { getCheckInTimes, listAppointments } from '@/contexts/scheduling/queries';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { withTenant } from '@/lib/db/tenant';

/**
 * Dados do dashboard (Visão operacional). Apenas o que é REAL hoje: o pulso de
 * agendamentos do dia (C6) + nomes dos pacientes (C5). Métricas de faturamento /
 * IA são placeholders honestos na UI (C9/C11), nunca dados mockados (ADR-018).
 */

export interface DashboardUpcoming {
  appointmentId: string;
  horario: string;
  nome: string;
  /** Procedimento agendado — a terceira coluna de "Próximos da agenda". */
  procedimento: string;
  status: AppointmentStatusDTO;
}

export interface DashboardDTO {
  consultasHoje: number;
  aguardando: number;
  emAtendimento: number;
  finalizadas: number;
  faltas: number;
  cancelados: number;
  /** Nome de quem falta faturar aparece só quando há exatamente uma falta. */
  faltaNome: string | null;
  /**
   * Maior espera REAL, em minutos, entre quem fez check-in e ainda não entrou.
   *
   * Vem de `appointment_state_log` (transição para `chegou`) via
   * `getCheckInTimes` — a mesma fonte que o Consultório usa —, não do horário
   * agendado. `null` quando a fila está vazia ou ninguém tem check-in
   * registrado; nesse caso o cartão mostra travessão em vez de um zero falso.
   */
  maiorEsperaMin: number | null;
  maiorEsperaNome: string | null;
  /** Atendidos hoje que seguem com faturamento pendente (alerta do Caixa). */
  naoFaturados: number;
  proximos: DashboardUpcoming[];
}

// `faltou` e `cancelado` entram na busca para alimentar os contadores de Faltas
// e Cancelados do turno. Eles ficam FORA de `consultasHoje` — um cancelamento
// não é consulta do dia —, por isso a contagem abaixo filtra em vez de usar
// `appts.length`.
const STATUSES: AppointmentStatusDTO[] = [
  'agendado',
  'confirmado',
  'chegou',
  'em_atendimento',
  'atendido',
  'faltou',
  'cancelado',
];

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    // hourCycle:'h23' (não hour12:false): evita o bug do ICU que renderiza meia-noite como "24".
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUtc - date.getTime();
}

/** Janela [00:00, 24:00) de hoje no fuso da clínica, em instantes UTC. */
function clinicDayBounds(tz: string): { from: Date; to: Date } {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const from = new Date(utcGuess - tzOffsetMs(new Date(utcGuess), tz));
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export async function getDashboard(clinicId: string, timezone: string): Promise<DashboardDTO> {
  const { from, to } = clinicDayBounds(timezone);
  const appts = await listAppointments(clinicId, { from, to, status: STATUSES, limit: 200 });

  const naFila = appts.filter((a) => a.status === 'chegou');
  const faltouAppts = appts.filter((a) => a.status === 'faltou');
  const aguardando = naFila.length;
  const emAtendimento = appts.filter((a) => a.status === 'em_atendimento').length;
  const finalizadas = appts.filter((a) => a.status === 'atendido').length;
  const cancelados = appts.filter((a) => a.status === 'cancelado').length;
  const consultasHoje = appts.filter((a) => a.status !== 'cancelado').length;
  const naoFaturados = appts.filter((a) => a.status === 'atendido' && a.faturamentoPendente).length;

  // Espera REAL: instante do check-in, não o horário agendado. Quem está na
  // fila sem transição registrada fica de fora em vez de virar zero enganoso.
  const checkIns = await getCheckInTimes(
    clinicId,
    naFila.map((a) => a.id),
  );
  const agora = Date.now();
  const esperando = naFila
    .flatMap((appt) => {
      const desde = checkIns[appt.id];
      if (!desde) return [];
      return [{ appt, min: Math.floor((agora - new Date(desde).getTime()) / 60_000) }];
    })
    .filter((x) => x.min > 0)
    .sort((x, y) => y.min - x.min);
  const maiorEspera = esperando[0] ?? null;

  const upcoming = appts
    .filter((a) => a.status === 'agendado' || a.status === 'confirmado' || a.status === 'chegou')
    .slice(0, 6);

  // Os nomes de quem está atrasado e da falta única não saem de `upcoming`
  // (uma falta nunca está lá), então entram no mesmo lote de cartões.
  const nomeados = [
    ...upcoming,
    ...(maiorEspera ? [maiorEspera.appt] : []),
    ...(faltouAppts.length === 1 ? faltouAppts : []),
  ];
  const ids = [...new Set(nomeados.filter((a) => a.patientId).map((a) => a.patientId!))];
  const cards = await listPatientCards(clinicId, ids);
  const nameOf = new Map(cards.map((c) => [c.id, c.nome]));
  const nomeDe = (patientId: string | null): string =>
    patientId ? (nameOf.get(patientId) ?? 'Paciente') : 'Walk-in';

  const proximos: DashboardUpcoming[] = upcoming.map((a) => ({
    appointmentId: a.id,
    horario: a.scheduledAt,
    nome: nomeDe(a.patientId),
    procedimento: a.snapshotProcedureName,
    status: a.status,
  }));

  return {
    consultasHoje,
    aguardando,
    emAtendimento,
    finalizadas,
    faltas: faltouAppts.length,
    cancelados,
    faltaNome: faltouAppts.length === 1 ? nomeDe(faltouAppts[0]!.patientId) : null,
    maiorEsperaMin: maiorEspera?.min ?? null,
    maiorEsperaNome: maiorEspera ? nomeDe(maiorEspera.appt.patientId) : null,
    naoFaturados,
    proximos,
  };
}

/* =====================================================================
   Checklist de ativação (Fase 2) — GAP 8. Derivada de PRESENÇA de dado
   (sem tabela nova): médico cadastrado · horários definidos · 1º paciente.
   Leitura tenant-scoped via withTenant (RLS); EXISTS é clinic-scoped pelas
   policies. Some sozinha quando os 3 passos estão concluídos.
   ===================================================================== */
export interface ActivationItem {
  key: string;
  label: string;
  desc: string;
  href: string;
  done: boolean;
}
export interface ActivationChecklistDTO {
  items: ActivationItem[];
  done: number;
  total: number;
  complete: boolean;
}

export type ActivationChecklistFlags = {
  hasDoctor: boolean;
  hasHours: boolean;
  hasPatient: boolean;
  hasProcedure: boolean;
  hasWhatsapp: boolean;
};

export function buildActivationChecklist(flags: ActivationChecklistFlags): ActivationChecklistDTO {
  const items: ActivationItem[] = [
    {
      key: 'doctor',
      label: 'Cadastre um médico',
      desc: 'Adicione quem vai atender na clínica.',
      href: '/equipe',
      done: flags.hasDoctor,
    },
    {
      key: 'hours',
      label: 'Defina os horários de atendimento',
      desc: 'Configure a disponibilidade para a agenda funcionar.',
      href: '/configuracoes/horarios',
      done: flags.hasHours,
    },
    {
      key: 'patient',
      label: 'Cadastre o primeiro paciente',
      desc: 'Comece sua base de pacientes.',
      href: '/pacientes/novo',
      done: flags.hasPatient,
    },
    {
      key: 'procedure',
      label: 'Cadastre um procedimento',
      desc: 'A agenda exige ao menos um procedimento ativo.',
      href: '/configuracoes/procedimentos',
      done: flags.hasProcedure,
    },
    {
      key: 'whatsapp',
      label: 'Conecte o WhatsApp',
      desc: 'Ative o atendimento por IA no WhatsApp da clínica.',
      href: '/configuracoes/whatsapp',
      done: flags.hasWhatsapp,
    },
  ];
  const done = items.filter((item) => item.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}

export async function getActivationChecklist(clinicId: string): Promise<ActivationChecklistDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`SELECT
        EXISTS(SELECT 1 FROM profiles WHERE ${practitionerSql(profiles.role, profiles.crm)}) AS has_doctor,
        EXISTS(SELECT 1 FROM doctor_availability) AS has_hours,
        EXISTS(SELECT 1 FROM patients) AS has_patient,
        EXISTS(SELECT 1 FROM procedures WHERE ativo = true) AS has_procedure,
        EXISTS(SELECT 1 FROM clinic_whatsapp_numbers WHERE active = true AND connection_status = 'connected') AS has_whatsapp`),
  )) as unknown as Array<{
    has_doctor: boolean;
    has_hours: boolean;
    has_patient: boolean;
    has_procedure: boolean;
    has_whatsapp: boolean;
  }>;
  const r = rows[0] ?? {
    has_doctor: false,
    has_hours: false,
    has_patient: false,
    has_procedure: false,
    has_whatsapp: false,
  };
  return buildActivationChecklist({
    hasDoctor: r.has_doctor,
    hasHours: r.has_hours,
    hasPatient: r.has_patient,
    hasProcedure: r.has_procedure,
    hasWhatsapp: r.has_whatsapp,
  });
}
