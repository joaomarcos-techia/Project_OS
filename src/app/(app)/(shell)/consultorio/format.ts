import { QORO_DATE_TIME_ZONE } from '@/lib/format';

/**
 * Hora curta pt-BR (HH:MM) de um ISO, no fuso da clínica (padrão: o fuso das datas do Qoro). Sem
 * fuso explícito, o servidor (UTC) e o navegador escreviam horas diferentes, a recepção via a hora
 * errada ao abrir e a hidratação acusava erro 418 (R51).
 */
export function formatHora(iso: string, timeZone: string = QORO_DATE_TIME_ZONE): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}
