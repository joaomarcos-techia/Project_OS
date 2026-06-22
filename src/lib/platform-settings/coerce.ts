/**
 * Parsers PUROS de valor de flag (jsonb → tipo seguro), com DEFAULTS SEGUROS.
 *
 * Sem 'server-only' / sem dbAdmin → testável isoladamente (coerce.test.ts).
 * Um valor corrompido/inesperado no banco NUNCA deve degradar a operação: cada
 * coerce cai no default seguro (jobs ligados, agente normal, sem manutenção).
 */
export type AiAgentMode = 'normal' | 'fallback_only';

export function coerceBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function coerceAiMode(value: unknown): AiAgentMode {
  return value === 'fallback_only' ? 'fallback_only' : 'normal';
}
