/**
 * GeminiProvider — testes de mapeamento wire-format (fetch stubado, sem rede):
 * structured response { text, toolCalls, usage } (jamais payload cru), tools →
 * functionDeclarations, toolResults → functionCall/functionResponse, timeout →
 * AIProviderUnreachableError, HTTP erro → AIProviderError, e R10:
 * generationConfig congelado (temperature 0.1 / topP 0.9) presente em TODA
 * chamada.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { GeminiProvider, __testing__ } from './gemini';
import { AIProviderUnreachableError } from './provider';

// GEMINI_API_KEY fictícia vem do vitest.config.ts (env singleton).
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stub que captura o request body enviado ao Gemini. */
function stubFetch(body: unknown, status = 200): { requests: { url: string; body: unknown }[] } {
  const captured: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return jsonResponse(body, status);
  }) as typeof globalThis.fetch;
  return { requests: captured };
}

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: 'Olá! ' }, { text: 'Como posso ajudar?' }] } }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 25 },
};

describe('GeminiProvider', () => {
  it('mapeia texto + usage e NUNCA retorna payload cru', async () => {
    stubFetch(GEMINI_OK);
    const provider = new GeminiProvider('gemini-2.5-flash');
    const res = await provider.generateWithTools({
      systemPrompt: 'Você é o assistente.',
      messages: [{ role: 'user', text: 'oi' }],
    });
    expect(res.text).toBe('Olá! Como posso ajudar?');
    expect(res.toolCalls).toBeUndefined();
    expect(res.usage).toEqual({ tokensInput: 120, tokensOutput: 25, model: 'gemini-2.5-flash' });
    // Sem campos do wire format do Gemini vazando.
    expect(Object.keys(res).sort()).toEqual(['text', 'toolCalls', 'usage'].sort());
  });

  it('soma os tokens de raciocínio à saída: o Gemini os cobra pelo preço de saída', async () => {
    // Medido em 08/10/2026: 10 tokens visíveis e ~500 de raciocínio por chamada.
    stubFetch({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 3076, candidatesTokenCount: 10, thoughtsTokenCount: 567 },
    });
    const provider = new GeminiProvider('gemini-3.6-flash');
    const res = await provider.generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'oi' }],
    });
    expect(res.usage).toEqual({ tokensInput: 3076, tokensOutput: 577, model: 'gemini-3.6-flash' });
  });

  it('mapeia functionCall → toolCalls com args unknown', async () => {
    stubFetch({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'provide_clinic_info', args: { foo: 1 } } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const res = await new GeminiProvider('gemini-2.5-flash').generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'qual o horário?' }],
    });
    expect(res.toolCalls).toEqual([{ name: 'provide_clinic_info', args: { foo: 1 } }]);
  });

  it('R10: envia generationConfig CONGELADO (temperature 0.1, topP 0.9) em toda chamada', async () => {
    const { requests } = stubFetch(GEMINI_OK);
    await new GeminiProvider('gemini-2.5-flash').generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'oi' }],
    });
    const sent = requests[0]!.body as { generationConfig: unknown };
    expect(sent.generationConfig).toEqual({ temperature: 0.1, topP: 0.9 });
    expect(__testing__.GENERATION_CONFIG).toEqual({ temperature: 0.1, topP: 0.9 });
    expect(Object.isFrozen(__testing__.GENERATION_CONFIG)).toBe(true);
  });

  it('serializa tools → functionDeclarations e toolResults → functionCall/functionResponse', async () => {
    const { requests } = stubFetch(GEMINI_OK);
    await new GeminiProvider('gemini-2.5-flash').generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'preço?' }],
      tools: [{ name: 't1', description: 'd1', parameters: { type: 'object' } }],
      toolResults: [{ name: 't1', args: { a: 1 }, response: { ok: true } }],
    });
    const sent = requests[0]!.body as {
      tools: { functionDeclarations: { name: string }[] }[];
      contents: { role: string; parts: Record<string, unknown>[] }[];
    };
    expect(sent.tools[0]!.functionDeclarations[0]!.name).toBe('t1');
    const [modelTurn, userTurn] = sent.contents.slice(-2);
    expect(modelTurn!.role).toBe('model');
    expect(modelTurn!.parts[0]).toEqual({ functionCall: { name: 't1', args: { a: 1 } } });
    expect(userTurn!.role).toBe('user');
    expect(userTurn!.parts[0]).toEqual({
      functionResponse: { name: 't1', response: { ok: true } },
    });
  });

  it('Gemini 3: devolve a thoughtSignature do functionCall como assinatura opaca', async () => {
    stubFetch({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'prepare_appointment', args: { procedure_name: 'x' } },
                thoughtSignature: 'sig-opaca-1',
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const res = await new GeminiProvider('gemini-3.8-flash').generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'quero marcar' }],
    });
    expect(res.toolCalls).toEqual([
      { name: 'prepare_appointment', args: { procedure_name: 'x' }, signature: 'sig-opaca-1' },
    ]);
  });

  it('Gemini 3: reenvia a thoughtSignature junto do functionCall na re-chamada', async () => {
    // Sem ela a API responde 400 ("Function call is missing a thought_signature")
    // e todo turno com tool cai no fallback — observado no DEV em 08/10/2026.
    const { requests } = stubFetch(GEMINI_OK);
    await new GeminiProvider('gemini-3.8-flash').generateWithTools({
      systemPrompt: 's',
      messages: [{ role: 'user', text: 'SIM' }],
      tools: [{ name: 't1', description: 'd1', parameters: { type: 'object' } }],
      toolResults: [
        { name: 't1', args: { a: 1 }, response: { ok: true }, signature: 'sig-opaca-1' },
      ],
    });
    const sent = requests[0]!.body as {
      contents: { role: string; parts: Record<string, unknown>[] }[];
    };
    const [modelTurn] = sent.contents.slice(-2);
    expect(modelTurn!.parts[0]).toEqual({
      functionCall: { name: 't1', args: { a: 1 } },
      thoughtSignature: 'sig-opaca-1',
    });
  });

  it('HTTP 503 → AIProviderError (definitivo, sem corpo vazado)', async () => {
    stubFetch({ error: { message: 'overloaded' } }, 503);
    await expect(
      new GeminiProvider('gemini-2.5-flash').generateWithTools({
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ name: 'AIProviderError', httpStatus: 503 });
  });

  it('timeout/abort → AIProviderUnreachableError', async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }) as typeof globalThis.fetch;
    await expect(
      new GeminiProvider('gemini-2.5-flash').generateWithTools({
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(AIProviderUnreachableError);
  });

  it('resposta sem candidates → AIProviderError gemini_empty_response', async () => {
    stubFetch({ candidates: [] });
    await expect(
      new GeminiProvider('gemini-2.5-flash').generateWithTools({
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_empty_response' });
  });
});
