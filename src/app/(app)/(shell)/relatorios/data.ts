import 'server-only';

import { getFaturamentoPeriodo } from '@/contexts/financial/queries';
import {
  getAppointmentStats,
  getAvailableSlots,
  getClinicTimezone,
} from '@/contexts/scheduling/queries';

/**
 * Dados de Relatórios (painéis Solo: faturamento · no-show · ocupação). Tudo de
 * leitura, tenant-scoped. A janela do período é calculada no FUSO DA CLÍNICA
 * (mesma técnica do dashboard) — dias locais inteiros. A OCUPAÇÃO reusa o
 * slot-resolver canônico (getAvailableSlots) para a capacidade livre — NÃO conta
 * doctor_availability de forma ingênua (respeita almoço/feriado/bloqueio).
 *
 * Ocupação = minutos ocupados ÷ (minutos ocupados + minutos livres). É uma
 * aproximação honesta: "livre" vem dos slots de 30min do resolver; "ocupado" da
 * soma das durações reais dos atendimentos que ocupam instante.
 */

export type PeriodKey = '7d' | '30d' | '90d';

export const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string; days: number }> = [
  { key: '7d', label: 'Últimos 7 dias', days: 7 },
  { key: '30d', label: 'Últimos 30 dias', days: 30 },
  { key: '90d', label: 'Últimos 90 dias', days: 90 },
];

export function resolvePeriod(raw: string | undefined): { key: PeriodKey; days: number } {
  const found = PERIODS.find((p) => p.key === raw);
  return found ? { key: found.key, days: found.days } : { key: '30d', days: 30 };
}

export interface RelatoriosDTO {
  faturamento: { recebido: number; pago: number; saldo: number };
  noShow: { faltou: number; atendido: number; cancelado: number; total: number; taxa: number | null };
  ocupacao: { busyMinutes: number; freeMinutes: number; taxa: number | null };
  fromLabel: string;
  toLabel: string;
}

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

/** Instante UTC da meia-noite local de hoje, no fuso da clínica. */
function clinicTodayStart(tz: string): Date {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  return new Date(utcGuess - tzOffsetMs(new Date(utcGuess), tz));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getRelatorios(
  clinicId: string,
  days: number,
  opts: { includeFaturamento: boolean },
): Promise<RelatoriosDTO> {
  const tz = await getClinicTimezone(clinicId);
  const todayStart = clinicTodayStart(tz);
  const to = new Date(todayStart.getTime() + DAY_MS); // fim de hoje (exclusivo)
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);

  const [stats, freeSlots, faturamento] = await Promise.all([
    getAppointmentStats(clinicId, from, to),
    getAvailableSlots({ clinicId, from, to }),
    opts.includeFaturamento
      ? getFaturamentoPeriodo(clinicId, from, to)
      : Promise.resolve({ recebido: 0, pago: 0, saldo: 0 }),
  ]);

  const decididos = stats.atendido + stats.faltou; // consultas com desfecho
  const taxaNoShow = decididos > 0 ? stats.faltou / decididos : null;

  const freeMinutes = freeSlots.reduce((s, slot) => s + slot.durationMin, 0);
  const capacidade = stats.busyMinutes + freeMinutes;
  const taxaOcupacao = capacidade > 0 ? stats.busyMinutes / capacidade : null;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);

  return {
    faturamento,
    noShow: {
      faltou: stats.faltou,
      atendido: stats.atendido,
      cancelado: stats.cancelado,
      total: stats.total,
      taxa: taxaNoShow,
    },
    ocupacao: { busyMinutes: stats.busyMinutes, freeMinutes, taxa: taxaOcupacao },
    fromLabel: fmt(from),
    toLabel: fmt(new Date(to.getTime() - DAY_MS)),
  };
}
