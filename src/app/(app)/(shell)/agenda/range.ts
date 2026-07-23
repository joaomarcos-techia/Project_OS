/**
 * Cálculo de faixas de data da Agenda (Mês/Semana/Dia) no fuso da CLÍNICA —
 * puro e testável (item 12). A UI navega por URL (?view=&date=), o servidor
 * resolve a faixa aqui e busca os atendimentos.
 *
 * Convenções: semana começa na SEGUNDA (BR). `ymd` = 'YYYY-MM-DD'. Os bounds
 * saem como instantes UTC (Date) para a query; o agrupamento por dia usa o
 * fuso da clínica (um atendimento às 23h SP não "vaza" para o dia seguinte UTC).
 */
export type AgendaView = 'month' | 'week' | 'day';

export function isAgendaView(v: string | undefined): v is AgendaView {
  return v === 'month' || v === 'week' || v === 'day';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset do fuso (ms) no instante dado — mesmo método de data.ts. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
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

/** Instante UTC da meia-noite local (fuso da clínica) de um dia calendário. */
function clinicMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

/** 'YYYY-MM-DD' de uma Date pelos componentes UTC (dias calendário puros). */
function ymdOfUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' de HOJE no fuso da clínica. */
export function todayYmd(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Dia calendário de um instante ISO no fuso da clínica → 'YYYY-MM-DD'. */
export function ymdInTz(iso: string, tz: string): string {
  return todayYmd(tz, new Date(iso));
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/** Normaliza a entrada `?date=`: aceita 'YYYY-MM-DD' ou 'YYYY-MM'; fallback hoje. */
export function normalizeDateParam(raw: string | undefined, tz: string): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  return todayYmd(tz);
}

export interface DateRange {
  from: Date;
  to: Date;
}

/** Faixa [from, to) da view a partir de um `ymd` de referência, no fuso da clínica. */
export function rangeFor(view: AgendaView, ymd: string, tz: string): DateRange {
  const { y, m, d } = parseYmd(ymd);
  if (view === 'day') {
    const from = clinicMidnightUtc(y, m, d, tz);
    return { from, to: new Date(from.getTime() + DAY_MS) };
  }
  if (view === 'week') {
    // Segunda-feira da semana que contém y-m-d.
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sáb
    const lead = (wd + 6) % 7; // dias desde segunda
    const mon = new Date(Date.UTC(y, m - 1, d - lead));
    const from = clinicMidnightUtc(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate(), tz);
    return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
  }
  // month
  const from = clinicMidnightUtc(y, m, 1, tz);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const to = clinicMidnightUtc(ny, nm, 1, tz);
  return { from, to };
}

/**
 * Matriz do mês: 6 semanas × 7 dias (segunda→domingo), incluindo dias vizinhos
 * para preencher a grade. Cada célula é um 'YYYY-MM-DD'.
 */
export function monthMatrix(year: number, month1: number): string[][] {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // segunda-start
  const start = new Date(Date.UTC(year, month1 - 1, 1 - lead));
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let dow = 0; dow < 7; dow++) {
      row.push(ymdOfUtc(new Date(start.getTime() + (w * 7 + dow) * DAY_MS)));
    }
    weeks.push(row);
  }
  return weeks;
}

/** Os 7 dias (seg→dom) da semana que contém `ymd`. */
export function weekDays(ymd: string): string[] {
  const { y, m, d } = parseYmd(ymd);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const lead = (wd + 6) % 7;
  const mon = new Date(Date.UTC(y, m - 1, d - lead));
  return Array.from({ length: 7 }, (_, i) => ymdOfUtc(new Date(mon.getTime() + i * DAY_MS)));
}

/** Navega `ymd` por ±1 unidade da view (para os botões prev/next). */
export function shift(view: AgendaView, ymd: string, dir: -1 | 1): string {
  const { y, m, d } = parseYmd(ymd);
  if (view === 'day') return ymdOfUtc(new Date(Date.UTC(y, m - 1, d + dir)));
  if (view === 'week') return ymdOfUtc(new Date(Date.UTC(y, m - 1, d + dir * 7)));
  return ymdOfUtc(new Date(Date.UTC(y, m - 1 + dir, 1))); // month
}

/** Agrupa atendimentos (com `horario` ISO) por dia calendário no fuso da clínica. */
export function groupByDay<T extends { horario: string }>(
  items: T[],
  tz: string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const key = ymdInTz(it.horario, tz);
    const arr = out.get(key);
    if (arr) arr.push(it);
    else out.set(key, [it]);
  }
  return out;
}
