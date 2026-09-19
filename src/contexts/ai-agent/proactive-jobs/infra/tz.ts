/**
 * Timezone helpers para C14 — PUROS (sem DB, sem I/O), testáveis.
 *
 * ADR-2 (review C14): D±N são dias-CALENDÁRIO no timezone da clínica, NUNCA
 * horas UTC decorridas. Usa `Intl.DateTimeFormat` (ICU embutido no Node — sem
 * dependência, DST-correct), mesmo approach do scheduling/slot-resolver.
 *
 * ponytail: a conversão wall-clock→UTC usa correção de offset em 1 passo. Para
 * America/Sao_Paulo (sem DST desde 2019) é exato; em zonas com DST a hora exata
 * da transição (~1x/ano, de madrugada) pode cair na vizinhança — irrelevante p/
 * janelas de 8-20h. Sobe p/ date-fns-tz se DST fina virar requisito.
 */

const PARTS_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = PARTS_FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FMT_CACHE.set(tz, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

function localParts(tz: string, instant: Date): LocalParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset (ms) do tz no instante dado: localWall(instant) − instant. */
function tzOffsetMs(tz: string, instant: Date): number {
  const p = localParts(tz, instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** YYYY-MM-DD → [ano, mês(1-12), dia]. */
function parseYMD(ymd: string): [number, number, number] {
  const parts = ymd.split('-');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Data-calendário local (YYYY-MM-DD) de um instante no tz da clínica. */
export function localDateYMD(tz: string, instant: Date): string {
  const p = localParts(tz, instant);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Hora local (0-23) de um instante no tz da clínica. Base do guard 8-20h. */
export function clinicLocalHour(tz: string, instant: Date): number {
  return localParts(tz, instant).hour;
}

/**
 * Converte um wall-clock LOCAL (data YYYY-MM-DD + hora inteira) no tz da clínica
 * para o instante UTC correspondente. Correção de offset em 1 passo.
 */
export function clinicLocalToUtc(tz: string, dateYMD: string, hour: number): Date {
  const [y, mo, d] = parseYMD(dateYMD);
  const guessUtc = Date.UTC(y, mo - 1, d, hour, 0, 0);
  const offset = tzOffsetMs(tz, new Date(guessUtc));
  return new Date(guessUtc - offset);
}

/** Soma N dias-CALENDÁRIO a uma data YYYY-MM-DD (aritmética pura, sem tz). */
export function addCalendarDays(dateYMD: string, n: number): string {
  const [y, mo, d] = parseYMD(dateYMD);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Próximo dia útil simples (segunda–sexta). Feriados exigem calendário próprio. */
export function nextWeekday(dateYMD: string): string {
  let candidate = addCalendarDays(dateYMD, 1);
  while (true) {
    const [year, month, day] = parseYMD(candidate);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return candidate;
    candidate = addCalendarDays(candidate, 1);
  }
}

/** Dias-CALENDÁRIO inteiros entre dois instantes, no tz da clínica (b − a). */
export function calendarDaysBetween(tz: string, a: Date, b: Date): number {
  const [ay, am, ad] = parseYMD(localDateYMD(tz, a));
  const [by, bm, bd] = parseYMD(localDateYMD(tz, b));
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / 86_400_000);
}
