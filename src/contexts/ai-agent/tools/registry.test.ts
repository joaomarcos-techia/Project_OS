/**
 * Teste 11.6.2 — tool call do LLM validada via Zod (payload malformado é
 * rejeitado SEM executar) + G9 (tool desconhecida = security event, nunca
 * executa) + R5 (output do handler validado — LLM nunca recebe lixo).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertOperationalModuleAccessTx } from '@/lib/entitlements';
import { OperationalAccessError } from '@/lib/entitlements/policy';
vi.mock('@/lib/entitlements', () => ({ assertOperationalModuleAccessTx: vi.fn(async () => {}) }));
import { z } from 'zod';

import type { Tx } from '@/lib/db';

import {
  __testing__,
  listToolDeclarations,
  preflightToolCalls,
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
  patientId: null,
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'mensagem de teste',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
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
  it('refuses an otherwise valid tool after the subscription gate closes', async () => {
    const state = registerEcho();
    vi.mocked(assertOperationalModuleAccessTx).mockRejectedValueOnce(
      new OperationalAccessError('ai_agents', 'period_expired'),
    );
    expect(
      await validateAndExecute({ name: 'echo_tool', args: { reason: 'oi' } }, ctx),
    ).toMatchObject({ ok: false, kind: 'handler_error' });
    expect(state.calls).toBe(0);
    expect(assertOperationalModuleAccessTx).toHaveBeenCalledWith(ctx.tx, ctx.clinicId, 'ai_agents');
  });
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

describe('preflightToolCalls — uma mutação por turno', () => {
  function registerBatchTool(name: string, effect: 'read' | 'mutation', state: { calls: number }) {
    registerTool({
      name,
      effect,
      description: name,
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => {
        state.calls += 1;
        return { ok: true };
      },
    });
  }

  it('rejeita duas mutações antes de executar qualquer handler', async () => {
    const state = { calls: 0 };
    registerBatchTool('mutation_a', 'mutation', state);
    registerBatchTool('mutation_b', 'mutation', state);

    const calls = [
      { name: 'mutation_a', args: { value: 'a' } },
      { name: 'mutation_b', args: { value: 'b' } },
    ];
    expect(preflightToolCalls(calls, ctx)).toMatchObject({
      ok: false,
      kind: 'multiple_mutations',
    });
    expect(state.calls).toBe(0);
  });

  it('permite leituras combinadas com uma única mutação', () => {
    const state = { calls: 0 };
    registerBatchTool('read_a', 'read', state);
    registerBatchTool('mutation_a', 'mutation', state);
    registerBatchTool('read_b', 'read', state);

    expect(
      preflightToolCalls(
        [
          { name: 'read_a', args: { value: 'a' } },
          { name: 'mutation_a', args: { value: 'b' } },
          { name: 'read_b', args: { value: 'c' } },
        ],
        ctx,
      ),
    ).toEqual({ ok: true });
  });

  it('rejeita lote com chamada inválida antes da mutação', () => {
    const state = { calls: 0 };
    registerBatchTool('mutation_a', 'mutation', state);
    registerBatchTool('read_a', 'read', state);

    expect(
      preflightToolCalls(
        [
          { name: 'mutation_a', args: { value: 'a' } },
          { name: 'read_a', args: { value: 123 } },
        ],
        ctx,
      ),
    ).toMatchObject({ ok: false, kind: 'invalid_input', toolName: 'read_a' });
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

  it('declara enum de pagamento e parcelas inteiras para o provider', () => {
    registerTool({
      name: 'payment_tool',
      description: 'd',
      inputSchema: z.object({
        payment_method: z.enum(['pix', 'credit_card']).optional(),
        installment_count: z.number().int().min(1).max(12).optional(),
      }),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    expect(listToolDeclarations()[0]?.parameters).toEqual({
      type: 'object',
      properties: {
        payment_method: { type: 'string', enum: ['pix', 'credit_card'] },
        installment_count: { type: 'integer' },
      },
    });
  });
});
