/**
 * Calendário da clínica: a fronteira entre DATA CIVIL e INSTANTE.
 *
 * - Data civil (`YYYY-MM-DD`): nascimento, "De/Até" de um filtro, dia de um
 *   agendamento, dia de emissão de um documento. Não tem fuso; nunca passa por
 *   `new Date('YYYY-MM-DD')`, que a transforma em meia-noite UTC.
 * - Instante (`Date`): quando um evento aconteceu. Só vira data civil no fuso
 *   de alguém — aqui, sempre o da clínica, que é quem atende e assina.
 *
 * O servidor roda em UTC e o navegador pode estar em qualquer fuso. Por isso
 * "hoje" é sempre `todayInTimeZone(fuso da clínica)`, e o início de um dia
 * civil é o instante da meia-noite naquele fuso, resolvido pela tabela do
 * próprio Intl (sem somar ou subtrair horas fixas).
 */

export const DEFAULT_CLINIC_TIME_ZONE = 'America/Sao_Paulo';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

/** `YYYY-MM-DD` de um dia que existe no calendário; `null` para o resto. */
export function parseYmd(value: unknown): CivilDate | null {
  if (typeof value !== 'string') return null;
  const match = YMD.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function isYmd(value: unknown): value is string {
  return parseYmd(value) !== null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd({ y, m, d }: CivilDate): string {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

/** Fuso válido para o Intl; um valor inválido cai no fuso padrão das clínicas. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_CLINIC_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_CLINIC_TIME_ZONE;
  }
}

/** Data civil de um instante no fuso informado. */
export function ymdInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** "Hoje" no fuso da clínica, como data civil. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return ymdInTimeZone(now, timeZone);
}

/** Ano corrente num fuso — o rodapé "© ano" sai igual no servidor e no navegador. */
export function yearInTimeZone(timeZone: string, now: Date = new Date()): number {
  return Number(ymdInTimeZone(now, timeZone).slice(0, 4));
}

/** Soma dias a uma data civil (aritmética de calendário, sem fuso). */
export function addDaysToYmd(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  if (!date) throw new RangeError(`data civil inválida: ${ymd}`);
  const shifted = new Date(Date.UTC(date.y, date.m - 1, date.d) + days * DAY_MS);
  return formatYmd({
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  });
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC, naquele instante. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return wall - (instant.getTime() - instant.getUTCMilliseconds());
}

/**
 * Primeiro instante do dia civil no fuso. Dois candidatos, um por deslocamento
 * em vigor perto da meia-noite; vale o mais cedo que de fato cai naquele dia.
 * Assim os dias de horário de verão saem certos: quando a meia-noite não
 * existiu (o relógio pulou para 01:00), o dia começa à 01:00; quando ela se
 * repetiu, começa na segunda.
 */
export function startOfDayInTimeZone(ymd: string, timeZone: string): Date {
  const date = parseYmd(ymd);
  if (!date) throw new RangeError(`data civil inválida: ${ymd}`);
  const zone = resolveTimeZone(timeZone);
  const wallMidnight = Date.UTC(date.y, date.m - 1, date.d);
  const first = wallMidnight - offsetMs(new Date(wallMidnight), zone);
  const second = wallMidnight - offsetMs(new Date(first), zone);
  for (const candidate of [Math.min(first, second), Math.max(first, second)]) {
    if (ymdInTimeZone(new Date(candidate), zone) === ymd) return new Date(candidate);
  }
  return new Date(first);
}

/**
 * Faixa de instantes que cobre os dias civis `from` a `to` (inclusive) no fuso
 * da clínica: do início de `from` ao último milissegundo de `to`. `null` para
 * entrada que não é data civil válida.
 */
export function clinicDayRange(
  fromYmd: unknown,
  toYmd: unknown,
  timeZone: string,
): { from: Date; to: Date } | null {
  if (!isYmd(fromYmd) || !isYmd(toYmd)) return null;
  const from = startOfDayInTimeZone(fromYmd, timeZone);
  const nextDay = startOfDayInTimeZone(addDaysToYmd(toYmd, 1), timeZone);
  return { from, to: new Date(nextDay.getTime() - 1) };
}

/**
 * Idade em anos completos numa data civil. Compara calendários, não instantes:
 * quem nasceu em 29/02 completa ano em 01/03 nos anos sem 29/02 (Código Civil,
 * art. 132, § 3º). `null` para data ausente, inválida ou no futuro.
 */
export function ageOnDate(birthYmd: string | null | undefined, todayYmd: string): number | null {
  const birth = parseYmd(birthYmd);
  const today = parseYmd(todayYmd);
  if (!birth || !today) return null;
  let age = today.y - birth.y;
  if (today.m < birth.m || (today.m === birth.m && today.d < birth.d)) age -= 1;
  return age >= 0 && age < 200 ? age : null;
}
