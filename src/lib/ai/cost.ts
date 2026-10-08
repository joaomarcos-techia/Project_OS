/**
 * Cost tracking do LLM (C11) — modelo congelado: tokens × $/1M (ADR-022).
 *
 * Tabela de preços EM CÓDIGO (mudança = git commit + deploy, igual ao system
 * prompt). Preços do Google AI Studio versionados por modelo. Aposta
 * documentada §11.17: o preço pode mudar — vigiar fatura e atualizar esta
 * tabela junto com qualquer troca de modelo.
 *
 * Modelo fora da tabela → custo 0 + métrica `ai.cost.unknown_model` (melhor
 * subcobrar e alertar do que inventar preço).
 */
import { metrics } from '@/lib/observability/metrics';

import type { Usage } from './provider';

/** USD por 1.000.000 de tokens. */
export const AI_PRICE_TABLE_USD_PER_1M: Readonly<
  Record<string, { input: number; output: number }>
> = Object.freeze({
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // Preço introdutório oficial até 31/12/2026 (1.50/7.50 a partir de 2027).
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  // Preço introdutório oficial até 31/12/2026.
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
});

/** Arredonda a 6 casas — compatível com ai_messages.cost_usd numeric(10,6). */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function computeCostUsd(usage: Usage): number {
  const price = AI_PRICE_TABLE_USD_PER_1M[usage.model];
  if (!price) {
    metrics.emit('ai.cost.unknown_model', { model: usage.model });
    return 0;
  }
  return round6((usage.tokensInput * price.input + usage.tokensOutput * price.output) / 1_000_000);
}
