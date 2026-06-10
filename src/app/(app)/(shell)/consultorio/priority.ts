/**
 * Prioridade visual da Sala de Espera (C8) — função pura, testável sem DB.
 * Tempo de espera = agora − check-in. Faixas (VisãoGeral §4.5 / prompt C8):
 *   0–15 min  normal | 15–30 min  atenção | 30+ min  crítico.
 * Apenas realce visual — sem popup/modal/notificação.
 */
export type WaitTone = 'normal' | 'attention' | 'critical';

export function waitMinutes(checkInAt: string | null, now: number = Date.now()): number | null {
  if (!checkInAt) return null;
  const t = new Date(checkInAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

export function waitTone(minutes: number | null): WaitTone {
  if (minutes == null) return 'normal';
  if (minutes >= 30) return 'critical';
  if (minutes >= 15) return 'attention';
  return 'normal';
}

/** "h aguardando" formatado curto (ex.: "8 min", "1h12"). */
export function formatWait(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}
