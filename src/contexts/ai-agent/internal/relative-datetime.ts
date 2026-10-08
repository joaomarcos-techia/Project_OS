/**
 * Resolvedor de data/hora relativa (C12 — F-04 da auditoria 2026-08-14).
 *
 * SUBSTITUI `tomorrowTimeFromMessage`, que era um regex de "amanhã às N" com
 * dois defeitos provados:
 *   - vencia SEMPRE o `scheduled_at` do modelo, mesmo quando a frase negava o
 *     horário ("amanhã às 9 não posso, pode ser às 14?" agendava 09:00);
 *   - não era ancorado, então "depois de amanhã às 9" casava o trecho "amanhã"
 *     e marcava no DIA ERRADO.
 *
 * Decisão de contrato: a data é do SERVIDOR. O modelo interpreta linguagem, mas
 * quem converte "sexta de manhã" em instante é este módulo, ancorado no fuso e
 * no relógio da clínica. Quando a frase não permite certeza, devolvemos uma
 * JANELA (a busca de slots desambigua com dados reais) ou CANDIDATOS (a tool
 * pergunta) — nunca um palpite silencioso.
 *
 * Puro: `now` e `timeZone` são injetados, sem Date.now() implícito.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Rótulo de um instante resolvido SEM data na frase ("às 8h"): a data é um palpite. */
const TIME_ONLY_LABEL = 'no horário informado';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`could not resolve timezone ${timeZone}`);
    return Number(part);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant.getTime()
  );
}

/** Wall-clock local da clínica → instante UTC (correto sob DST). */
/**
 * Data e hora de uma consulta como o PACIENTE lê: no fuso da clínica.
 *
 * Os resumos de cancelar, reagendar e confirmar presença mostravam o ISO em UTC
 * ("2026-10-09T13:00:00.000Z"): 10:00 em São Paulo virava "13:00" na tela do
 * paciente, e o "SIM" confirmava um horário que ele leu errado (08/10/2026).
 */
export function appointmentTimeForPatient(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} às ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function wallClockInTimeZoneToInstant(args: ZonedParts, timeZone: string): Date {
  const wallClockUtc = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute);
  let instant = new Date(wallClockUtc - timeZoneOffsetMs(new Date(wallClockUtc), timeZone));
  const adjustedOffset = timeZoneOffsetMs(instant, timeZone);
  if (wallClockUtc - adjustedOffset !== instant.getTime()) {
    instant = new Date(wallClockUtc - adjustedOffset);
  }
  return instant;
}

/** Data civil local, sem hora — base da aritmética de calendário. */
interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function civilToday(now: Date, timeZone: string): CivilDate {
  const p = zonedParts(now, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOfCivil(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function atLocalTime(date: CivilDate, minutes: number, timeZone: string): Date {
  return wallClockInTimeZoneToInstant(
    { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    timeZone,
  );
}

export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// --- gramática ----------------------------------------------------------------

const WEEKDAYS: ReadonlyArray<{ re: RegExp; dow: number }> = [
  { re: /\b(domingo|dom)\b/, dow: 0 },
  { re: /\b(segunda|segunda-feira|seg)\b/, dow: 1 },
  { re: /\b(terca|terca-feira|ter)\b/, dow: 2 },
  { re: /\b(quarta|quarta-feira|qua)\b/, dow: 3 },
  { re: /\b(quinta|quinta-feira|qui)\b/, dow: 4 },
  { re: /\b(sexta|sexta-feira|sex)\b/, dow: 5 },
  { re: /\b(sabado|sab)\b/, dow: 6 },
];

/** Períodos do dia → janela local [início, fim) em minutos. */
const PERIODS: ReadonlyArray<{ re: RegExp; from: number; to: number; label: string }> = [
  { re: /\b(de manha|pela manha|manha|matutino)\b/, from: 8 * 60, to: 12 * 60, label: 'de manhã' },
  { re: /\b(mais cedo|bem cedo|cedo)\b/, from: 7 * 60, to: 10 * 60, label: 'cedo' },
  {
    re: /\b(fim da tarde|final da tarde)\b/,
    from: 16 * 60,
    to: 19 * 60,
    label: 'no fim da tarde',
  },
  { re: /\b(a tarde|de tarde|tarde|vespertino)\b/, from: 12 * 60, to: 18 * 60, label: 'à tarde' },
  { re: /\b(a noite|de noite|noite|noturno)\b/, from: 18 * 60, to: 21 * 60, label: 'à noite' },
];

/**
 * Marcadores que NEGAM ou SUBSTITUEM o que foi dito antes. O texto após o último
 * deles é o que vale — é o que faz "amanhã às 9 não posso, pode ser às 14?"
 * resolver 14:00 em vez de 09:00. A data, quando só aparece na primeira metade,
 * é herdada: o paciente trocou a HORA, não o dia.
 */
const CONTRAST_RE =
  /\b(nao posso|nao da|nao consigo|nao vai dar|mas|porem|contudo|na verdade|melhor|prefiro|mudei|troca|trocar)\b/g;

interface DatePart {
  date: CivilDate;
  /** Marcador textual, para telemetria/mensagem. */
  label: string;
}

function extractDatePart(text: string, today: CivilDate): DatePart | null {
  // Ordem IMPORTA: "depois de amanhã" contém "amanhã".
  if (/\bdepois de amanha\b/.test(text)) {
    return { date: addDays(today, 2), label: 'depois de amanhã' };
  }
  if (/\bamanha\b/.test(text)) return { date: addDays(today, 1), label: 'amanhã' };
  if (/\bhoje\b/.test(text)) return { date: today, label: 'hoje' };

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    return {
      date: { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      label: 'data informada',
    };
  }

  // dd/mm[/aaaa] — ano ausente resolve para a próxima ocorrência não-passada.
  const dmy = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const rawYear = dmy[3] ? Number(dmy[3]) : undefined;
      const year =
        rawYear === undefined
          ? month < today.month || (month === today.month && day < today.day)
            ? today.year + 1
            : today.year
          : rawYear < 100
            ? 2000 + rawYear
            : rawYear;
      return { date: { year, month, day }, label: 'data informada' };
    }
  }

  const dayOnly = /\bdia (\d{1,2})\b/.exec(text);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      const thisMonth = { year: today.year, month: today.month, day };
      const date = day < today.day ? addMonth(thisMonth) : thisMonth;
      return { date, label: `dia ${day}` };
    }
  }

  for (const { re, dow } of WEEKDAYS) {
    if (!re.test(text)) continue;
    // "sexta" dita numa sexta significa a PRÓXIMA sexta, nunca hoje.
    let delta = (dow - weekdayOfCivil(today) + 7) % 7;
    if (delta === 0) delta = 7;
    if (/\b(proxima|proximo|que vem)\b/.test(text) && delta < 7) delta += 7;
    return { date: addDays(today, delta), label: 'no dia da semana informado' };
  }
  return null;
}

function addMonth(date: CivilDate): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month, date.day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

interface TimePart {
  minutes: number;
  /** Hora nua em que as duas leituras (AM e PM) são plausíveis numa clínica. */
  ambiguous: boolean;
}

/**
 * Resolve uma hora nua (sem "da manhã"/"da tarde") em minutos do dia.
 *
 * NÃO existe envelope de horário aqui, de propósito. "às 3" pode ser 03:00 ou
 * 15:00; qual delas é possível depende da agenda que a CLÍNICA configurou, e
 * este módulo é puro — não conhece clínica. Chutar por uma faixa fixa erraria
 * nos dois extremos: clínica que abre às 07:00 e clínica que atende até 22:00.
 *
 * Então marcamos as duas leituras como candidatas e deixamos
 * `prepare_appointment` desempatar contra a DISPONIBILIDADE REAL. Numa clínica
 * 08–18, 03:00 não tem slot e o candidato morre sozinho — sem perguntar nada ao
 * paciente. Numa clínica que atende à noite, 21:00 é legítimo e é considerado.
 *
 * `hour + 12 <= 23` delimita a única restrição de relógio que existe: acima
 * disso não há segunda leitura possível.
 */
function bareHourToTimePart(hour: number, extraMinutes = 0): TimePart | null {
  if (hour > 23) return null;
  return {
    minutes: hour * 60 + extraMinutes,
    ambiguous: hour >= 1 && hour + 12 <= 23,
  };
}

function extractTimePart(text: string): TimePart | null {
  if (/\bmeio dia\b/.test(text)) return { minutes: 12 * 60, ambiguous: false };
  if (/\bmeia noite\b/.test(text)) return { minutes: 0, ambiguous: false };

  const suffix = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/.exec(text); // 9h30 / 09:30
  if (suffix) {
    const h = Number(suffix[1]);
    const m = Number(suffix[2]);
    if (h <= 23 && m <= 59) return { minutes: h * 60 + m, ambiguous: false };
  }

  const half = /\b(\d{1,2})\s*e\s*meia\b/.exec(text); // "9 e meia"
  if (half) {
    const part = bareHourToTimePart(Number(half[1]), 30);
    if (part) return part;
  }

  const period = /\b(\d{1,2})\s*(?:h(?:oras?)?\s*)?d[ae]\s*(manha|tarde|noite)\b/.exec(text);
  if (period) {
    const raw = Number(period[1]);
    if (raw <= 12) {
      const isMorning = period[2] === 'manha';
      const h = isMorning ? (raw === 12 ? 0 : raw) : raw < 12 ? raw + 12 : raw;
      return { minutes: h * 60, ambiguous: false };
    }
  }

  const bare = /\b(?:as|a)?\s*(\d{1,2})\s*(?:h|hs|horas?)\b/.exec(text); // 9h / 9 horas
  if (bare) {
    const part = bareHourToTimePart(Number(bare[1]));
    if (part) return part;
  }

  const prefixed = /\b(?:as|para as|pras|umas|depois das)\s*(\d{1,2})\b/.exec(text); // "às 9"
  if (prefixed) {
    const part = bareHourToTimePart(Number(prefixed[1]));
    if (part) return part;
  }
  return null;
}

function extractPeriod(text: string): { from: number; to: number; label: string } | null {
  for (const p of PERIODS) {
    if (p.re.test(text)) return { from: p.from, to: p.to, label: p.label };
  }
  return null;
}

// --- contrato -------------------------------------------------------------------

export type ResolvedWhen =
  | { kind: 'none' }
  /** Data E hora determinadas — o servidor sabe exatamente o instante. */
  | { kind: 'instant'; atIso: string; label: string }
  /** Só a data, ou data + período: a busca de slots escolhe dentro da janela. */
  | { kind: 'window'; fromIso: string; toIso: string; label: string }
  /** Hora nua 1–7 sem AM/PM: perguntar, nunca chutar. */
  | { kind: 'ambiguous'; candidatesIso: [string, string]; label: string };

export interface ResolveArgs {
  text: string;
  now: Date;
  timeZone: string;
  maxDaysAhead: number;
}

/**
 * Traduz a frase do paciente em instante, janela ou candidatos.
 *
 * Só devolve algo quando há um MARCADOR DE DATA explícito ou uma hora sozinha —
 * `none` é o default deliberado: na dúvida, quem decide é o `scheduled_at` do
 * modelo (validado depois contra a disponibilidade real).
 */
export function resolveRequestedDateTime(args: ResolveArgs): ResolvedWhen {
  const raw = fold(args.text);
  const today = civilToday(args.now, args.timeZone);

  // Pré-passe de contraste: o trecho APÓS o último marcador é o que vale.
  const matches = [...raw.matchAll(CONTRAST_RE)];
  const last = matches.at(-1);
  const head = last ? raw.slice(0, last.index) : raw;
  const tail = last ? raw.slice(last.index + last[0].length) : raw;

  const tailDate = extractDatePart(tail, today);
  const tailTime = extractTimePart(tail);
  const tailPeriod = extractPeriod(tail);

  // A correção troca a HORA e herda o DIA quando a data só aparece na 1ª metade.
  const datePart = tailDate ?? (tailTime || tailPeriod ? extractDatePart(head, today) : null);
  const timePart = tailTime ?? (tailDate ? extractTimePart(head) : null);
  const period = tailPeriod ?? (tailDate ? extractPeriod(head) : null);

  if (!datePart && !timePart && !period) return { kind: 'none' };

  const horizon = args.now.getTime() + args.maxDaysAhead * DAY_MS;
  const inHorizon = (d: Date): boolean => d.getTime() <= horizon;

  // Data + hora → instante. Sem data, uma hora sozinha vale para hoje; se já
  // passou (ou está colada em agora), o paciente só pode estar falando de amanhã.
  if (timePart) {
    const base = datePart?.date ?? today;
    /**
     * Sem data explícita, uma hora que já passou só pode ser de amanhã.
     *
     * O rolamento é POR LEITURA, nunca das duas juntas: às 09:00, "às 3" tem a
     * leitura vespertina (15:00) ainda hoje e a matinal já vencida — empurrar
     * ambas para amanhã perderia justamente a mais provável. Às 22:00 as duas
     * venceram e as duas rolam, que é o que impede o resolvedor de chutar a
     * madrugada e contradizer o contrato de nunca escolher sozinho.
     */
    const atOrNextDay = (minutes: number): Date => {
      const candidate = atLocalTime(base, minutes, args.timeZone);
      if (datePart || candidate.getTime() > args.now.getTime()) return candidate;
      return atLocalTime(addDays(base, 1), minutes, args.timeZone);
    };

    const at = atOrNextDay(timePart.minutes);
    if (at.getTime() < args.now.getTime() || !inHorizon(at)) return { kind: 'none' };

    if (timePart.ambiguous) {
      const pm = atOrNextDay(timePart.minutes + 12 * 60);
      if (inHorizon(pm) && pm.getTime() >= args.now.getTime()) {
        return {
          kind: 'ambiguous',
          candidatesIso: [pm.toISOString(), at.toISOString()],
          label: datePart?.label ?? TIME_ONLY_LABEL,
        };
      }
    }
    return {
      kind: 'instant',
      atIso: at.toISOString(),
      label: datePart?.label ?? TIME_ONLY_LABEL,
    };
  }

  // Sem hora: janela. Data + período ("sexta de manhã"), data pura (o dia todo)
  // ou período puro ("de manhã" → o próximo dia útil a partir de agora).
  const base = datePart?.date ?? today;
  const from = atLocalTime(base, period ? period.from : 0, args.timeZone);
  const to = atLocalTime(base, period ? period.to : 24 * 60, args.timeZone);
  const clampedFrom = new Date(Math.max(from.getTime(), args.now.getTime()));
  if (clampedFrom.getTime() >= to.getTime()) {
    // A janela de hoje já fechou; se o paciente só disse o período, vale amanhã.
    if (datePart) return { kind: 'none' };
    const tomorrow = addDays(today, 1);
    const f = atLocalTime(tomorrow, period ? period.from : 0, args.timeZone);
    const t = atLocalTime(tomorrow, period ? period.to : 24 * 60, args.timeZone);
    if (!inHorizon(f)) return { kind: 'none' };
    return {
      kind: 'window',
      fromIso: f.toISOString(),
      toIso: t.toISOString(),
      label: period ? `amanhã ${period.label}` : 'amanhã',
    };
  }
  if (!inHorizon(clampedFrom)) return { kind: 'none' };
  return {
    kind: 'window',
    fromIso: clampedFrom.toISOString(),
    toIso: to.toISOString(),
    label: [datePart?.label, period?.label].filter(Boolean).join(' ') || 'no período informado',
  };
}

export type RequestedTime =
  | { mode: 'none' }
  | { mode: 'instant'; atIso: string }
  | { mode: 'search'; fromIso: string; toIso: string }
  | { mode: 'candidates'; candidatesIso: string[]; label: string };

/** Mesma hora do dia em datas possivelmente diferentes (tolerância de 1 min). */
function sameTimeOfDay(a: number, b: number): boolean {
  const diff = Math.abs(a - b) % DAY_MS;
  return Math.min(diff, DAY_MS - diff) < MINUTE_MS;
}

/**
 * Precedência entre servidor e modelo — o ponto exato do F-04.
 *
 * O servidor vence quando resolveu um instante: ele está ancorado no fuso e no
 * relógio da clínica; o modelo não. Quando o servidor só tem uma JANELA e o
 * modelo propôs um instante DENTRO dela, o instante do modelo é aceito — é o
 * melhor dos dois (o paciente disse "sexta de manhã", o modelo escolheu 09:00).
 * Fora da janela, o palpite do modelo é descartado e a busca usa a janela.
 */
export function reconcileRequestedTime(args: {
  resolved: ResolvedWhen;
  modelIso: string | undefined;
}): RequestedTime {
  const { resolved, modelIso } = args;
  const modelAt = modelIso ? new Date(modelIso) : null;
  const modelValid = modelAt !== null && !Number.isNaN(modelAt.getTime());

  if (resolved.kind === 'instant') {
    // 08/10/2026 — "às 8h" logo depois de a conversa fixar a segunda-feira: o
    // resolvedor só vê esta frase e entende hoje (ou amanhã) às 8h; o modelo,
    // com o histórico, propõe segunda às 8h. Ao vivo, o servidor sobrescreveu
    // a data e respondeu "horário indisponível". Sem data na frase, a HORA é do
    // servidor e a DATA é da conversa: vale o instante do modelo de mesma hora.
    if (
      resolved.label === TIME_ONLY_LABEL &&
      modelValid &&
      sameTimeOfDay(modelAt.getTime(), new Date(resolved.atIso).getTime())
    ) {
      return { mode: 'instant', atIso: modelAt.toISOString() };
    }
    return { mode: 'instant', atIso: resolved.atIso };
  }

  if (resolved.kind === 'window') {
    if (modelValid) {
      const t = modelAt.getTime();
      if (t >= new Date(resolved.fromIso).getTime() && t < new Date(resolved.toIso).getTime()) {
        return { mode: 'instant', atIso: modelAt.toISOString() };
      }
    }
    return { mode: 'search', fromIso: resolved.fromIso, toIso: resolved.toIso };
  }

  if (resolved.kind === 'ambiguous') {
    if (modelValid) {
      const t = modelAt.getTime();
      const hit = resolved.candidatesIso.find(
        (c) => Math.abs(new Date(c).getTime() - t) < MINUTE_MS,
      );
      if (hit) return { mode: 'instant', atIso: hit };
      // Mesma regra do instante: sem data na frase, a data da conversa vale.
      if (
        resolved.label === TIME_ONLY_LABEL &&
        resolved.candidatesIso.some((c) => sameTimeOfDay(new Date(c).getTime(), t))
      ) {
        return { mode: 'instant', atIso: modelAt.toISOString() };
      }
    }
    return {
      mode: 'candidates',
      candidatesIso: [...resolved.candidatesIso],
      label: resolved.label,
    };
  }

  return modelValid ? { mode: 'instant', atIso: modelAt.toISOString() } : { mode: 'none' };
}

export const __testing__ = { extractDatePart, extractTimePart, extractPeriod, addDays };
