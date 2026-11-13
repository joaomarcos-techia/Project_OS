import { QORO_DATE_TIME_ZONE } from '@/lib/format';

/**
 * Hora curta pt-BR (HH:MM) a partir de um ISO, no fuso explícito: sem ele o servidor (UTC)
 * e o navegador (Brasília) escreviam horas diferentes e a hidratação acusava erro 418 (R51).
 */
export function formatHora(iso: string, timeZone: string = QORO_DATE_TIME_ZONE): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone });
}
