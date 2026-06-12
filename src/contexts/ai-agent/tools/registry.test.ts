/**
 * Teste 11.6.2 — tool call do LLM validada via Zod (payload malformado é
 * rejeitado SEM executar) + G9 (tool desconhecida = security event, nunca
 * executa) + R5 (output do handler validado — LLM nunca recebe lixo).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Tx } from '@/lib/db';

import {
  __testing__,
  listToolDeclarations,
  registerTool,
  validateAndExecute,
  type ToolContext,
} from './registry';

const ctx: ToolContext = {
  tx: {} as Tx, // tools de teste não tocam o banco
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
};

afterEach(() => __testing__.clear());

function registerEcho(opts?: { badOutput?: boolean; throws?: boolean }): { calls: number } {
  const state = { calls: 0 };
  registerTool({
    name: 'echo_tool',
    description: 'eco de teste',
    inputSchema: z.object({ reason: z.string().min(1).max(50) }).strict(),
    outputSchema: z.object({ echoed: z.string() }),
    handler: async (input) => {
      state.calls += 1;
      if (opts?.throws) throw new Error('boom');
      if (opts?.badOutput) return { wrong_field: 123 } as never;
      return { echoed: input.reason };
    },
  });
  return state;
}

describe('validateAndExecute (11.6.2 — Zod no input)', () => {
  it('payload malformado do LLM → rejeitado SEM executar o handler', async () => {
    const state = registerEcho();
    const malformed = [
      { reason: 123 }, // tipo errado
      { reason: '' }, // viola min(1)
      { reason: 'x'.repeat(51) }, // viola max(50)
      { reason: 'ok', extra_field: 'injected' }, // .strict() rejeita extra
      'not-an-object',
      null,
    ];
    for (const args of malformed) {
      const result = await validateAndExecute({ name: 'echo_tool', args }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid_input');
    }
    expect(state.calls).toBe(0); // JAMAIS executou
  });

  it('payload válido → executa e devolve o output validado', async () => {
    const state = registerEcho();
    const result = await validateAndExecute({ name: 'echo_tool', args: { reason: 'oi' } }, ctx);
    expect(result).toEqual({ ok: true, response: { echoed: 'oi' } });
    expect(state.calls).toBe(1);
  });

  it('issuePaths nunca contém valores do payload (só paths)', async () => {
    registerEcho();
    const result = await validateAndExecute(
      { name: 'echo_tool', args: { reason: 'CPF 123.456.789-00'.repeat(10) } },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.issuePaths ?? [])).not.toContain('123.456.789');
    }
  });
});

describe('whitelist enforcement (G9 — security event)', () => {
  it('tool desconhecida (LLM alucinou delete_patient) → unknown_tool, nunca executa', async () => {
    const state = registerEcho();
    const result = await validateAndExecute(
      { name: 'delete_patient', args: { patient_id: 'x' } },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('unknown_tool');
    expect(state.calls).toBe(0);
  });
});

describe('output validation (R5 — LLM nunca recebe lixo)', () => {
  it('handler retorna shape fora do outputSchema → invalid_output', async () => {
    registerEcho({ badOutput: true });
    const result = await validateAndExecute({ name: 'echo_tool', args: { reason: 'oi' } }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid_output');
  });

  it('handler lança → handler_error (sem propagar exceção crua)', async () => {
    registerEcho({ throws: true });
    const result = await validateAndExecute({ name: 'echo_tool', args: { reason: 'oi' } }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('handler_error');
  });
});

describe('listToolDeclarations (wire format p/ o provider)', () => {
  it('deriva JSON Schema do Zod (string obrigatória vs opcional)', () => {
    registerTool({
      name: 'decl_tool',
      description: 'd',
      inputSchema: z
        .object({
          required_field: z.string().describe('campo obrigatório'),
          optional_field: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    const [decl] = listToolDeclarations();
    expect(decl).toEqual({
      name: 'decl_tool',
      description: 'd',
      parameters: {
        type: 'object',
        properties: {
          required_field: { type: 'string', description: 'campo obrigatório' },
          optional_field: { type: 'string' },
        },
        required: ['required_field'],
      },
    });
  });

  it('nome duplicado no registry → lança (whitelist íntegra)', () => {
    registerEcho();
    expect(() => registerEcho()).toThrow(/duplicada/);
  });
});
