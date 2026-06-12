/**
 * R8 — sanitizeAiFailurePayload é WHITELIST: telefone, nome, mensagem,
 * conteúdo, prompt e snapshot NUNCA passam, mesmo que o caller os injete.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeAiFailurePayload, type AiFailurePayloadInput } from './sanitize';

describe('sanitizeAiFailurePayload (R8 — whitelist congelada)', () => {
  it('passa apenas os campos da whitelist', () => {
    const out = sanitizeAiFailurePayload({
      toolName: 'provide_clinic_info',
      zodIssuePaths: ['reason'],
      errorCode: 'invalid_input',
      model: 'gemini-2.5-flash',
      httpStatus: 503,
      stage: 'tool_invalid',
    });
    expect(out).toEqual({
      toolName: 'provide_clinic_info',
      zodIssuePaths: ['reason'],
      errorCode: 'invalid_input',
      model: 'gemini-2.5-flash',
      httpStatus: 503,
      stage: 'tool_invalid',
    });
  });

  it('campos FORA da whitelist são descartados (mesmo PII injetada)', () => {
    const hostile = {
      toolName: 'x',
      telefone: '11999999999',
      nome: 'Maria da Silva',
      message: 'estou com dor no peito',
      content: 'conversa inteira',
      prompt: 'system prompt',
      promptSnapshot: 'gzip...',
      cpf: '12345678900',
    } as AiFailurePayloadInput & Record<string, unknown>;
    const out = sanitizeAiFailurePayload(hostile);
    expect(Object.keys(out)).toEqual(['toolName']);
    expect(JSON.stringify(out)).not.toContain('11999999999');
    expect(JSON.stringify(out)).not.toContain('Maria');
    expect(JSON.stringify(out)).not.toContain('dor no peito');
  });

  it('caps: strings ≤200 chars, issuePaths ≤10 itens', () => {
    const out = sanitizeAiFailurePayload({
      toolName: 'x'.repeat(500),
      zodIssuePaths: Array.from({ length: 30 }, (_, i) => `f${i}`),
    });
    expect((out.toolName as string).length).toBe(200);
    expect((out.zodIssuePaths as string[]).length).toBe(10);
  });

  it('tipos errados são descartados em vez de coeridos', () => {
    const out = sanitizeAiFailurePayload({
      toolName: 123 as unknown as string,
      httpStatus: 'abc' as unknown as number,
      errorCode: '',
    });
    expect(out).toEqual({});
  });
});
