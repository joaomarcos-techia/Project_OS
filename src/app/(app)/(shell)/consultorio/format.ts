/** Hora curta pt-BR (HH:MM) a partir de um ISO. */
export function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
