import { describe, expect, it } from 'vitest';

import { AIProviderError, AIProviderUnreachableError } from '@/lib/ai/provider';

import { generateWithTransientRetry } from './inbound-received';

describe('generateWithTransientRetry', () => {
  it('repete até três tentativas quando o Gemini devolve 200 sem candidate utilizável', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new AIProviderError('empty', 'gemini_empty_response');
        }
        return {
          text: 'Olá!',
          usage: { tokensInput: 10, tokensOutput: 2, model: 'gemini-2.5-flash' },
        };
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).resolves.toMatchObject({ text: 'Olá!' });
    expect(attempts).toBe(3);
  });

  it('para depois da terceira resposta vazia', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        throw new AIProviderError('empty', 'gemini_empty_response');
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_empty_response' });
    expect(attempts).toBe(3);
  });

  it('repete HTTP 5xx do provider (503 "service unavailable") e devolve a resposta', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        if (attempts < 2) throw new AIProviderError('503', 'gemini_server_error', 503);
        return {
          text: 'Olá!',
          usage: { tokensInput: 10, tokensOutput: 2, model: 'gemini-3.6-flash' },
        };
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).resolves.toMatchObject({ text: 'Olá!' });
    expect(attempts).toBe(2);
  });

  it('desiste depois da terceira falha 5xx', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        throw new AIProviderError('503', 'gemini_server_error', 503);
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_server_error' });
    expect(attempts).toBe(3);
  });

  it('timeout não repete: o turno inteiro cabe em 60 s', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        throw new AIProviderUnreachableError('[ai] Gemini unreachable (timeout 15000ms ou rede)');
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toBeInstanceOf(AIProviderUnreachableError);
    expect(attempts).toBe(1);
  });

  it('não repete erros que não sejam a resposta vazia transitória', async () => {
    let attempts = 0;
    const provider = {
      generateWithTools: async () => {
        attempts += 1;
        throw new AIProviderError('bad request', 'gemini_request_error', 400);
      },
    };

    await expect(
      generateWithTransientRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_request_error' });
    expect(attempts).toBe(1);
  });
});
