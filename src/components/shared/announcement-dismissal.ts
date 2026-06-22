/**
 * Lógica PURA do "pop-up único" de aviso (sem 'use client'/DOM → testável).
 * O estado de "já vi" vive no localStorage do navegador (uma vez por usuário/
 * dispositivo). Aqui só as funções puras; o componente faz o I/O com try/catch.
 */
export const ANNOUNCEMENT_SEEN_KEY = 'qoro_ann_seen';

/** Mostra o aviso se tiver id e ainda não tiver sido visto. */
export function shouldShowAnnouncement(id: string, seenIds: readonly string[]): boolean {
  return id.length > 0 && !seenIds.includes(id);
}

/** Marca como visto (idempotente). Cap de 50 ids p/ o storage não crescer sem fim. */
export function addSeen(seenIds: readonly string[], id: string): string[] {
  if (seenIds.includes(id)) return [...seenIds];
  return [...seenIds, id].slice(-50);
}

/** Lê a lista de ids vistos do raw do localStorage, tolerando lixo. */
export function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
