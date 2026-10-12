import { addCalendarDays, clinicLocalHour, clinicLocalToUtc, localDateYMD } from './tz';

/** Janela de envio permitida da C14: [08:00, 20:00) no fuso da clínica. */
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 20;

/** Se a janela fechou, devolve o início da próxima janela em UTC. */
export function nextSendWindowStart(tz: string, now: Date): Date | null {
  const hour = clinicLocalHour(tz, now);
  if (hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR) return null;
  const date = localDateYMD(tz, now);
  const nextDate = hour >= SEND_WINDOW_END_HOUR ? addCalendarDays(date, 1) : date;
  return clinicLocalToUtc(tz, nextDate, SEND_WINDOW_START_HOUR);
}
