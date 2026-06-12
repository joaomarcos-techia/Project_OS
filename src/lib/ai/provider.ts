/**
 * AIProvider — contrato CONGELADO da C11 (ADR-022, PlanoAção §11.18).
 *
 * Camada de transporte puro de LLM (sem DB, sem contexto de negócio) — mesma
 * separação do lib/messaging: implementações vivem aqui (gemini.ts, openai.ts);
 * intent/conversa/tools de negócio vivem em src/contexts/ai-agent.
 *
 * Regras congeladas:
 *   - Toda chamada retorna { text?, toolCalls?, usage } — JAMAIS payload cru
 *     do provider (o caller nunca vê o wire format do Gemini/OpenAI).
 *   - `ToolCall.args` é `unknown` ATÉ o caller validar com Zod (tool registry).
 *   - Classificação de erro espelha lib/messaging: HTTP de erro = definitivo
 *     (AIProviderError); timeout/abort/reset = indeterminado
 *     (AIProviderUnreachableError). O circuit breaker conta ambos como falha.
 */

/** Tokens consumidos numa chamada — base do cost tracking (tokens × $/1M). */
export type Usage = {
  tokensInput: number;
  tokensOutput: number;
  model: string;
};

/** Tool call emitida pelo LLM. `args` NÃO é confiável até passar pelo Zod. */
export type ToolCall = {
  name: string;
  args: unknown;
};

/**
 * Declaração de tool no formato neutro (JSON Schema em `parameters`).
 * O registry do ai-agent converte Zod → JSON Schema; o provider converte
 * isto para o wire format específico (functionDeclarations no Gemini).
 */
export type AIToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Resultado de tool executada, devolvido ao LLM na re-chamada (1 rodada —
 * MAX_TOOL_ROUNDS do ai-agent). `args` ecoa o que o modelo pediu (o wire
 * format do Gemini exige reconstituir o turno functionCall antes do
 * functionResponse).
 */
export type ToolResult = {
  name: string;
  args: unknown;
  response: object;
};

export type GenerateOpts = {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  tools?: AIToolDeclaration[];
  toolResults?: ToolResult[];
  timeoutMs?: number;
};

export type GenerateResult = {
  text?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
  usage: Usage;
};

export interface AIProvider {
  generateWithTools(opts: GenerateOpts): Promise<GenerateResult>;
}

/**
 * Falha DEFINITIVA do provider — resposta HTTP de erro (4xx/5xx) ou payload
 * sem candidates. Não adianta re-chamar com o mesmo input imediatamente.
 */
export class AIProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(message: string, code = 'ai_provider_error', httpStatus: number | null = null) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Falha INDETERMINADA — timeout/abort/connection reset, sem resposta. Não
 * sabemos se o provider processou. Para o agente a distinção não muda o
 * fallback (turno é stateless), mas o breaker e as métricas separam as causas.
 */
export class AIProviderUnreachableError extends Error {
  readonly code = 'ai_provider_unreachable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AIProviderUnreachableError';
  }
}
