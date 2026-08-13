import { describe, expect, it } from 'vitest';

import { AIProviderError } from '@/lib/ai/provider';

import { generateWithEmptyResponseRetry } from './inbound-received';

describe('generateWithEmptyResponseRetry', () => {
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
      generateWithEmptyResponseRetry(provider, {
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
      generateWithEmptyResponseRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_empty_response' });
    expect(attempts).toBe(3);
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
      generateWithEmptyResponseRetry(provider, {
        systemPrompt: 's',
        messages: [{ role: 'user', text: 'oi' }],
      }),
    ).rejects.toMatchObject({ code: 'gemini_request_error' });
    expect(attempts).toBe(1);
  });
});
