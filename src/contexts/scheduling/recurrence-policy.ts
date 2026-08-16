import { zonedWallToUtc } from './slot-resolver';

/**
 * Ocorrências de uma série semanal.
 *
 * ===================================================================
 * DATA-008 — por que somar 168 horas está errado
 * ===================================================================
 * A implementação anterior era `first + index * intervalWeeks * WEEK_MS`. Isso
 * mantém o INSTANTE separado por exatamente 168 horas — e é justamente o que
 * quebra quando o fuso muda de offset no meio da série. O pentest converteu
 * 07/03/2027 09:00 em `America/New_York` e recebeu 09:00, 10:00 e 10:00 locais:
 * a partir do início do DST em 14/03, toda a série passou a acontecer uma hora
 * depois do horário que o operador escolheu.
 *
 * Recorrência de calendário é uma promessa de HORÁRIO DE PAREDE ("toda
 * segunda às 9h"), não de intervalo físico. A correção avança a DATA local em
 * semanas, preserva hora:minuto e reconverte cada ocorrência para UTC com as
 * regras IANA daquela data — que é exatamente o que `zonedWallToUtc` faz.
 *
 * `America/Sao_Paulo` não tem DST desde 2019, então a Clínica A nunca foi
 * afetada. Mas a coluna de timezone aceita qualquer zona IANA, e o defeito
 * atingia qualquer clínica configurada num fuso com mudança de offset.
 *
 * ===================================================================
 * Política para instantes inexistentes e ambíguos
 * ===================================================================
 * No salto de primavera, uma hora local NÃO EXISTE (02:30 em Nova York no dia
 * da virada); no outono, uma hora local acontece DUAS VEZES.
 *
 * `zonedWallToUtc` já resolve os dois de forma determinística — dois passes de
 * offset — e a política aqui é aceitar esse resultado explicitamente:
 *
 *   - inexistente → cai no instante logo após a virada (o relógio "pula" com o
 *     paciente; ninguém é agendado para um horário que o país não viveu);
 *   - ambíguo     → resolve na PRIMEIRA ocorrência (o offset antes da virada).
 *
 * A alternativa — recusar a série inteira — puniria o operador por uma regra
 * de fuso que ele não controla, num horário que existe em 51 das 52 semanas.
 * O que NÃO é aceitável, e era o comportamento antigo, é a série derivar em
 * silêncio para outro horário de parede.
 */

export function buildWeeklyOccurrences(input: {
  firstScheduledAt: string;
  intervalWeeks: number;
  occurrences: number;
  /**
   * Fuso IANA da clínica. Opcional por compatibilidade com callers antigos;
   * ausente ⇒ UTC, que é estável e não inventa uma zona.
   */
  timeZone?: string | undefined;
}): Date[] {
  const first = new Date(input.firstScheduledAt);
  if (Number.isNaN(first.getTime())) throw new Error('firstScheduledAt is invalid');
  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1) {
    throw new Error('intervalWeeks must be a positive integer');
  }
  if (!Number.isInteger(input.occurrences) || input.occurrences < 2) {
    throw new Error('occurrences must be an integer greater than one');
  }

  const timeZone = input.timeZone ?? 'UTC';

  // Hora de parede da PRIMEIRA ocorrência, no fuso da clínica. É o que a série
  // promete repetir.
  const wall = wallClockIn(first, timeZone);

  return Array.from({ length: input.occurrences }, (_, index) => {
    if (index === 0) return first; // o instante escolhido é preservado exatamente
    // Avança a DATA em semanas usando aritmética de calendário UTC apenas como
    // contador de dias (não há DST em UTC, então +7d é sempre +7d de calendário).
    const shifted = new Date(
      Date.UTC(wall.year, wall.month - 1, wall.day + index * input.intervalWeeks * 7),
    );
    return zonedWallToUtc(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      wall.hour,
      wall.minute,
      timeZone,
    );
  });
}

/** Instante UTC → componentes do relógio de parede em `timeZone`. */
function wallClockIn(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}
