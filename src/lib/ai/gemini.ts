/**
 * GeminiProvider — Google Gemini via Generative Language API (REST v1beta).
 *
 * Implementa `AIProvider` direto via fetch cru (mesmo padrão do
 * MetaCloudProvider — sem SDK, sem dependência nova). Modelo default
 * gemini-3.6-flash (env.GEMINI_MODEL).
 *
 * Timeout: todo fetch usa `AbortSignal.timeout` (env.AI_HTTP_TIMEOUT_MS,
 * default 15s). Sem o teto, um request lento segura o worker do outbox.
 *
 * R10 (review do founder) — generationConfig CONGELADO em código:
 * temperature 0.1 / topP 0.9. NÃO configurável por env/banco/clínica —
 * mudança silenciosa de sampling é prompt drift invisível (ADR-022).
 *
 * Classificação de erro (espelha lib/messaging): HTTP de erro →
 * AIProviderError (definitivo); timeout/abort/reset → AIProviderUnreachableError
 * (indeterminado). Jamais retorna payload cru — só { text, toolCalls, usage }.
 */
import 'server-only';

import { assertAiRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import {
  AIProviderError,
  AIProviderUnreachableError,
  type AIProvider,
  type GenerateOpts,
  type GenerateResult,
  type ToolCall,
} from './provider';

// R10 — congelado (ADR-022). Mudança aqui exige bump de PROMPT_VERSION no
// ai-agent (comportamento do agente muda) + nota na ADR.
const GENERATION_CONFIG = Object.freeze({
  temperature: 0.1,
  topP: 0.9,
});

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// --- wire shapes mínimos da resposta (loose, validados por guards) ----------
interface GeminiResponseBody {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** Tokens de raciocínio — cobrados pelo preço de SAÍDA. */
    thoughtsTokenCount?: number;
  };
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
  /** Gemini 3: assinatura do raciocínio que precisa voltar com o functionCall. */
  thoughtSignature?: string;
}

type GeminiContent = { role: 'user' | 'model'; parts: Record<string, unknown>[] };

function buildContents(opts: GenerateOpts): GeminiContent[] {
  const contents: GeminiContent[] = opts.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  // Re-chamada pós-tool: o protocolo exige o turno `functionCall` do modelo
  // seguido do turno `functionResponse` do caller — reconstituímos ambos a
  // partir dos ToolResult (que ecoam os args originais). Os modelos Gemini 3
  // recusam com 400 um functionCall sem a `thoughtSignature` que eles mesmos
  // emitiram; ela volta intacta quando existir.
  if (opts.toolResults && opts.toolResults.length > 0) {
    contents.push({
      role: 'model',
      parts: opts.toolResults.map((r) => ({
        functionCall: { name: r.name, args: r.args ?? {} },
        ...(r.signature ? { thoughtSignature: r.signature } : {}),
      })),
    });
    contents.push({
      role: 'user',
      parts: opts.toolResults.map((r) => ({
        functionResponse: { name: r.name, response: r.response },
      })),
    });
  }
  return contents;
}

export class GeminiProvider implements AIProvider {
  private readonly model: string;

  constructor(model: string = env.GEMINI_MODEL) {
    this.model = model;
  }

  async generateWithTools(opts: GenerateOpts): Promise<GenerateResult> {
    assertAiRuntimeReady();

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      contents: buildContents(opts),
      generationConfig: GENERATION_CONFIG,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const timeoutMs = opts.timeoutMs ?? env.AI_HTTP_TIMEOUT_MS;
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY!,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Timeout/abort/reset — indeterminado (nunca vimos resposta).
      // N1: `ai.provider.error` é o sinal EM TEMPO REAL do SLO nº4. A saved
      // search do log-search.md já alertava sobre ele — mas NADA o emitia, então
      // a busca voltava vazia para sempre e isso é indistinguível de "está tudo
      // bem". O `ia_error_rate` do rollup é a fonte formal (diária); este é o
      // que dá para reagir hoje. Só a CLASSE do erro, nunca o corpo (ecoaria o
      // prompt, que pode conter dado de paciente).
      metrics.emit('ai.provider.error', { kind: 'unreachable', timeout_ms: timeoutMs });
      throw new AIProviderUnreachableError(
        `[ai] Gemini unreachable (timeout ${timeoutMs}ms ou rede)`,
        { cause: err },
      );
    }

    if (!res.ok) {
      // Corpo de erro NÃO propaga inteiro (pode ecoar o prompt) — só status.
      metrics.emit('ai.provider.error', { kind: 'http', status: res.status });
      throw new AIProviderError(
        `[ai] Gemini HTTP ${res.status}`,
        res.status >= 500 ? 'gemini_server_error' : 'gemini_request_error',
        res.status,
      );
    }

    let parsed: GeminiResponseBody;
    try {
      parsed = (await res.json()) as GeminiResponseBody;
    } catch {
      throw new AIProviderError('[ai] Gemini retornou corpo não-JSON', 'gemini_bad_body', null);
    }

    const parts = parsed.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      // Sem candidates/parts (ex.: bloqueio de safety) — definitivo p/ este input.
      throw new AIProviderError('[ai] Gemini sem candidates na resposta', 'gemini_empty_response');
    }

    const textParts = parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string);
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall && typeof p.functionCall.name === 'string')
      .map((p) => ({
        name: p.functionCall!.name!,
        args: p.functionCall!.args ?? {},
        ...(typeof p.thoughtSignature === 'string' && p.thoughtSignature
          ? { signature: p.thoughtSignature }
          : {}),
      }));

    return {
      text: textParts.length > 0 ? textParts.join('') : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        tokensInput: parsed.usageMetadata?.promptTokenCount ?? 0,
        // O Gemini cobra o raciocínio como saída. Sem `thoughtsTokenCount`, um
        // turno de 10 tokens visíveis e ~500 de raciocínio (medido em 08/10/2026)
        // era contabilizado como 10: custo e teto por clínica (R4) subestimados.
        tokensOutput:
          (parsed.usageMetadata?.candidatesTokenCount ?? 0) +
          (parsed.usageMetadata?.thoughtsTokenCount ?? 0),
        model: this.model,
      },
    };
  }
}

/** Exposto para testes (gemini.test.ts) — verifica o contrato congelado R10. */
export const __testing__ = { GENERATION_CONFIG };
