import 'server-only';

import { sql } from 'drizzle-orm';

import { listPatientCards } from '@/contexts/patient/queries';
import { getClinicTimezone, listAppointments } from '@/contexts/scheduling/queries';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { requireUser } from '@/lib/auth/tenant-context';
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
  status: AppointmentStatusDTO;
}

export interface DashboardDTO {
  hasClinic: boolean;
  consultasHoje: number;
  aguardando: number;
  emAtendimento: number;
  finalizadas: number;
  proximos: DashboardUpcoming[];
}

const STATUSES: AppointmentStatusDTO[] = [
  'agendado',
  'confirmado',
  'chegou',
  'em_atendimento',
  'atendido',
];

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
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

export async function getDashboard(): Promise<DashboardDTO> {
  const user = await requireUser();
  if (!user.clinicId) {
    return { hasClinic: false, consultasHoje: 0, aguardando: 0, emAtendimento: 0, finalizadas: 0, proximos: [] };
  }
  const clinicId = user.clinicId;

  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);
  const appts = await listAppointments(clinicId, { from, to, status: STATUSES, limit: 200 });

  const aguardando = appts.filter((a) => a.status === 'chegou').length;
  const emAtendimento = appts.filter((a) => a.status === 'em_atendimento').length;
  const finalizadas = appts.filter((a) => a.status === 'atendido').length;

  const upcoming = appts
    .filter((a) => a.status === 'agendado' || a.status === 'confirmado' || a.status === 'chegou')
    .slice(0, 6);
  const ids = [...new Set(upcoming.filter((a) => a.patientId).map((a) => a.patientId!))];
  const cards = await listPatientCards(clinicId, ids);
  const nameOf = new Map(cards.map((c) => [c.id, c.nome]));

  const proximos: DashboardUpcoming[] = upcoming.map((a) => ({
    appointmentId: a.id,
    horario: a.scheduledAt,
    nome: a.patientId ? (nameOf.get(a.patientId) ?? 'Paciente') : 'Walk-in',
    status: a.status,
  }));

  return {
    hasClinic: true,
    consultasHoje: appts.length,
    aguardando,
    emAtendimento,
    finalizadas,
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

export async function getActivationChecklist(clinicId: string): Promise<ActivationChecklistDTO> {
  const rows = (await withTenant(clinicId, (tx) =>
    tx.execute(sql`SELECT
        EXISTS(SELECT 1 FROM profiles WHERE role = 'doctor') AS has_doctor,
        EXISTS(SELECT 1 FROM doctor_availability) AS has_hours,
        EXISTS(SELECT 1 FROM patients) AS has_patient,
        EXISTS(SELECT 1 FROM clinic_whatsapp_numbers WHERE active = true AND connection_status = 'connected') AS has_whatsapp`),
  )) as unknown as Array<{
    has_doctor: boolean;
    has_hours: boolean;
    has_patient: boolean;
    has_whatsapp: boolean;
  }>;
  const r = rows[0] ?? { has_doctor: false, has_hours: false, has_patient: false, has_whatsapp: false };

  const items: ActivationItem[] = [
    { key: 'doctor', label: 'Cadastre um médico', desc: 'Adicione quem vai atender na clínica.', href: '/equipe', done: r.has_doctor },
    { key: 'hours', label: 'Defina os horários de atendimento', desc: 'Configure a disponibilidade para a agenda funcionar.', href: '/equipe', done: r.has_hours },
    { key: 'patient', label: 'Cadastre o primeiro paciente', desc: 'Comece sua base de pacientes.', href: '/pacientes/novo', done: r.has_patient },
    { key: 'whatsapp', label: 'Conecte o WhatsApp', desc: 'Ative o atendimento por IA no WhatsApp da clínica.', href: '/configuracoes/whatsapp', done: r.has_whatsapp },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}
