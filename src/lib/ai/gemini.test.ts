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
