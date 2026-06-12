/**
 * OpenAIProvider — PLACEHOLDER (PlanoAção §11.2).
 *
 * Existe apenas para preservar o contrato `AIProvider` multi-provider (a
 * abstração é decisão sólida §11.17; runtime multi-LLM é PROIBIDO no MVP —
 * Kill Criteria §11.15). NÃO deve ser instanciado em produção: qualquer
 * chamada falha com erro definitivo. Implementação real só se/quando uma
 * camada futura decidir custo dinâmico de provider (refactor previsto §11.13).
 */
import { AIProviderError, type AIProvider, type GenerateResult } from './provider';

export class OpenAIProvider implements AIProvider {
  async generateWithTools(): Promise<GenerateResult> {
    throw new AIProviderError(
      '[ai] OpenAIProvider é placeholder (C11) — use GeminiProvider. Multi-LLM runtime é proibido no MVP.',
      'openai_not_implemented',
    );
  }
}
