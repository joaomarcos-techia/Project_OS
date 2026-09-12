import 'server-only';

import { currentMonthInTimeZone } from '@/contexts/financial/accounting-export';
import {
  getFaturamentoPeriodo,
  getFaturamentoPorSemana,
  getRecebimentosByAppointment,
} from '@/contexts/financial/queries';
import {
  getAppointmentStats,
  getAppointmentStatsByDoctor,
  getAtendimentosPorSemana,
  getAvailableSlots,
} from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';

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

/**
 * Uma semana do período. `recebido`/`pago`/`saldo` e `atendido` são `null`
 * quando NÃO houve movimento registrado — diferente de zero, que significa
 * "houve e deu zero". A UI escreve "sem dado" para null, e é essa distinção que
 * impede um relatório de afirmar faturamento zero numa semana sem lançamento.
 */
export interface RelatorioSemana {
  /** Segunda-feira, `YYYY-MM-DD` no fuso da clínica. */
  weekStart: string;
  /** Rótulo humano do intervalo ("09 – 15 de agosto"). */
  label: string;
  recebido: number | null;
  pago: number | null;
  saldo: number | null;
  atendido: number | null;
  /**
   * A semana ainda está correndo: os dias que faltam não são zero, são
   * desconhecidos. Sem essa marca, a última barra desenha baixa ao lado de
   * quatro semanas fechadas e sugere uma queda que não aconteceu.
   */
  emCurso: boolean;
  /**
   * A semana inteira ainda não começou. `recebido: null` aqui NÃO é "sem dado"
   * — é "sem ter acontecido", e as duas coisas pedem leituras opostas: uma é
   * um buraco a investigar, a outra é o calendário seguindo seu curso.
   */
  futura: boolean;
}

export interface RelatoriosDTO {
  faturamento: { recebido: number; pago: number; saldo: number };
  noShow: {
    faltou: number;
    atendido: number;
    cancelado: number;
    total: number;
    taxa: number | null;
  };
  ocupacao: { busyMinutes: number; freeMinutes: number; taxa: number | null };
  /** Série semanal do período — gráfico e tabela de Relatórios. */
  semanas: RelatorioSemana[];
  fromLabel: string;
  toLabel: string;
  /** Fuso IANA da clínica — a referência o mostra no cabeçalho, e ele é o que
   *  explica por que os cortes de dia não batem com o relógio de quem lê. */
  timezone: string;
  accountingMonth: string;
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

/** Data local (`YYYY-MM-DD`) de um instante, no fuso da clínica. */
function localYmd(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Segundas-feiras que cobrem o período, no fuso da clínica.
 *
 * Enumerar aqui (e não confiar só no que o banco devolveu) é o que permite
 * mostrar a semana SEM movimento: o SQL agrupado só traz semanas com linha, e
 * uma série que pula semanas mente sobre a forma da curva.
 *
 * O passo usa `YYYY-MM-DD` em UTC puro para andar de 7 em 7 dias — datas civis
 * não sofrem horário de verão, então somar dias aqui é seguro mesmo em fusos
 * que mudam de offset no meio do período.
 */
function weekStartsBetween(from: Date, to: Date, tz: string): string[] {
  const [y, m, d] = localYmd(from, tz).split('-').map(Number);
  const cursor = new Date(Date.UTC(y!, m! - 1, d!));
  // getUTCDay(): 0 = domingo. A semana do Postgres começa na segunda.
  const backToMonday = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - backToMonday);

  const lastYmd = localYmd(new Date(to.getTime() - DAY_MS), tz);
  const out: string[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const iso = cursor.toISOString().split('T')[0]!;
    out.push(iso);
    if (iso >= lastYmd) break;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  // O laço empurra ANTES de testar, então a série termina uma semana depois do
  // período. É de propósito: a última coluna é o ciclo que está começando, e
  // sem ela o gráfico dá a impressão de que a série acabou. Ela é desenhada
  // como "período futuro", nunca como "sem dado".
  return out;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** "09 – 15 de agosto", ou "30 de agosto – 05 de setembro" quando vira o mês. */
function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d!));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const dd = (date: Date) => String(date.getUTCDate()).padStart(2, '0');
  const mes = (date: Date) => MESES[date.getUTCMonth()]!;
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${dd(start)} – ${dd(end)} de ${mes(end)}`
    : `${dd(start)} de ${mes(start)} – ${dd(end)} de ${mes(end)}`;
}

export async function getRelatorios(
  clinicId: string,
  days: number,
  opts: { includeFaturamento: boolean },
): Promise<RelatoriosDTO> {
  const tz = await getClinicTimezone(clinicId);
  const todayStart = clinicTodayStart(tz);
  const to = new Date(todayStart.getTime() + DAY_MS); // fim de hoje (exclusivo)
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);

  const [stats, freeSlots, faturamento, semanasFin, semanasAgd] = await Promise.all([
    getAppointmentStats(clinicId, from, to),
    getAvailableSlots({ clinicId, from, to }),
    opts.includeFaturamento
      ? getFaturamentoPeriodo(clinicId, from, to)
      : Promise.resolve({ recebido: 0, pago: 0, saldo: 0 }),
    // Sem `view:financial` a série semanal de dinheiro nem é consultada — o
    // mesmo gate que já esconde o total do período.
    opts.includeFaturamento
      ? getFaturamentoPorSemana(clinicId, from, to, tz)
      : Promise.resolve<Awaited<ReturnType<typeof getFaturamentoPorSemana>>>([]),
    getAtendimentosPorSemana(clinicId, from, to, tz),
  ]);

  const finPorSemana = new Map(semanasFin.map((week) => [week.weekStart, week]));
  const agdPorSemana = new Map(semanasAgd.map((week) => [week.weekStart, week]));
  // Comparação de datas CIVIS no fuso da clínica, em string: `YYYY-MM-DD`
  // ordena lexicograficamente, e assim não há instante nem offset no meio.
  const hojeYmd = localYmd(new Date(), tz);
  const semanas: RelatorioSemana[] = weekStartsBetween(from, to, tz).map((weekStart) => {
    const fin = finPorSemana.get(weekStart);
    const agd = agdPorSemana.get(weekStart);
    const [y, m, d] = weekStart.split('-').map(Number);
    const fimDaSemana = new Date(Date.UTC(y!, m! - 1, d!) + 6 * DAY_MS)
      .toISOString()
      .split('T')[0]!;
    return {
      weekStart,
      label: weekLabel(weekStart),
      recebido: fin?.recebido ?? null,
      pago: fin?.pago ?? null,
      saldo: fin?.saldo ?? null,
      atendido: agd?.atendido ?? null,
      emCurso: weekStart <= hojeYmd && hojeYmd <= fimDaSemana,
      futura: weekStart > hojeYmd,
    };
  });

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
    semanas,
    fromLabel: fmt(from),
    toLabel: fmt(new Date(to.getTime() - DAY_MS)),
    timezone: tz,
    accountingMonth: currentMonthInTimeZone(tz),
  };
}

// --- consolidado por profissional (Fase B do plano pausa-almoço/export) -----

export interface DoctorConsolidadoDTO {
  doctorId: string;
  nome: string;
  total: number;
  atendidos: number;
  faltas: number;
  /** soma recebida (valorPago de pago/parcial) dos atendimentos do médico no
   *  período; null quando o chamador não tem view:financial. */
  recebido: number | null;
}

/**
 * Consolidado por profissional — composição no APP LAYER (sem JOIN
 * cross-context): Scheduling agrega atendimentos por médico; Financial agrega
 * os recebimentos por appointmentId; o app faz apenas a associação dos DTOs.
 */
export async function getConsolidadoPorProfissional(
  clinicId: string,
  days: number,
  opts: { includeFaturamento: boolean },
): Promise<DoctorConsolidadoDTO[]> {
  const tz = await getClinicTimezone(clinicId);
  const todayStart = clinicTodayStart(tz);
  const to = new Date(todayStart.getTime() + DAY_MS);
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);

  const stats = await getAppointmentStatsByDoctor(clinicId, from, to);
  const porMedico = new Map(
    stats.map((row) => [
      row.doctorId,
      {
        doctorId: row.doctorId,
        nome: row.nome,
        total: row.total,
        atendidos: row.atendidos,
        faltas: row.faltas,
        recebido: opts.includeFaturamento ? 0 : null,
      } satisfies DoctorConsolidadoDTO,
    ]),
  );

  if (opts.includeFaturamento) {
    const apptDoctor = new Map<string, string>();
    for (const row of stats) {
      for (const appointmentId of row.appointmentIds) {
        apptDoctor.set(appointmentId, row.doctorId);
      }
    }

    const appointmentIds = [...apptDoctor.keys()];
    const batchSize = 1_000;
    for (let start = 0; start < appointmentIds.length; start += batchSize) {
      const recebimentos = await getRecebimentosByAppointment(
        clinicId,
        appointmentIds.slice(start, start + batchSize),
      );
      for (const recebimento of recebimentos) {
        const doctorId = apptDoctor.get(recebimento.appointmentId);
        if (!doctorId) continue;
        const row = porMedico.get(doctorId);
        if (row?.recebido != null) row.recebido += recebimento.recebido;
      }
    }
  }

  return [...porMedico.values()].sort((a, b) => b.total - a.total);
}
