/**
 * Hora curta pt-BR (HH:MM) de um ISO, no fuso da clínica. Sem ele, o servidor (UTC)
 * e o navegador renderizam horas diferentes e a recepção vê a hora errada ao abrir.
 */
export function formatHora(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}
