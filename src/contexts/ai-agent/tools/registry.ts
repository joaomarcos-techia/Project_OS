/**
 * Tools registry (C11) — framework de tools do agente. Contrato CONGELADO
 * (ADR-022): name, description, inputSchema, outputSchema (R5), handler.
 *
 * Validação em AMBAS as direções:
 *   - INPUT (do LLM): Zod safeParse ANTES de executar. Inválido → rejeita,
 *     registra, fallback. JAMAIS executa payload inválido.
 *   - OUTPUT (do handler): Zod safeParse ANTES de devolver ao LLM. Inválido →
 *     rejeita (R5 — o LLM nunca recebe lixo).
 *
 * G9 — whitelist enforcement: tool fora do registry (ex.: LLM alucina
 * "delete_patient") é SECURITY EVENT (`ai_agent.tool.unknown`), não erro
 * comum. Nunca executa.
 *
 * SOMENTE as 3 tools da C11 são registradas (provide_clinic_info,
 * provide_procedure_price, request_human_handoff). Tools extras = escopo
 * inválido até C12.
 */
import type { z } from 'zod';

import type { AIToolDeclaration, ToolCall } from '@/lib/ai/provider';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

export type ToolContext = {
  tx: Tx;
  clinicId: string;
  conversationId: string;
  eventId: string;
  aiRequestId: string;
  // C12 — identidade VERIFICADA pelo telefone (Meta). As tools sensíveis usam
  // ISTO, JAMAIS um patient_id vindo do LLM (anti-spoofing — matriz de
  // identidade). patientId = paciente casado pelo telefone (null = não
  // cadastrado). verifiedPhone = número do inbound (E.164 normalizado).
  patientId: string | null;
  patientNome: string | null;
  identityAmbiguous: boolean;
  verifiedPhone: string;
  // Texto ORIGINAL do turno. Gates server-side (ex.: confirmação explícita)
  // nunca confiam em um argumento que o próprio LLM poderia fabricar.
  currentMessage: string;
  // Configuração autoritativa usada pelas tools, não apenas pelo prompt.
  canScheduleAnonymous: boolean;
  maxDaysAhead: number;
  // Opt-in da clínica para divulgar VALORES de cobranças (list_pending_payments).
  canDisclosePayments: boolean;
};

export type ToolEffect = 'read' | 'mutation';

export type Tool<
  In extends z.ZodTypeAny = z.ZodTypeAny,
  Out extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  name: string;
  description: string;
  /** Default `read`; mutações são limitadas a uma por turno no servidor. */
  effect?: ToolEffect;
  inputSchema: In;
  outputSchema: Out;
  handler: (input: z.infer<In>, ctx: ToolContext) => Promise<z.infer<Out>>;
};

export type ToolExecutionResult =
  | { ok: true; response: object }
  | {
      ok: false;
      kind: 'unknown_tool' | 'invalid_input' | 'invalid_output' | 'handler_error';
      error: string;
      /** Paths das issues Zod (sem valores — seguro p/ failures/metrics). */
      issuePaths?: string[];
    };

export type ToolBatchPreflightResult =
  | { ok: true }
  | {
      ok: false;
      kind: 'unknown_tool' | 'invalid_input' | 'multiple_mutations';
      error: string;
      toolName?: string;
      issuePaths?: string[];
    };

const registry = new Map<string, Tool>();

export function registerTool<In extends z.ZodTypeAny, Out extends z.ZodTypeAny>(
  tool: Tool<In, Out>,
): void {
  if (registry.has(tool.name)) {
    throw new Error(`[ai-agent] tool duplicada no registry: ${tool.name}`);
  }
  registry.set(tool.name, tool as unknown as Tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return [...registry.values()];
}

/**
 * Declarações no formato neutro do AIProvider. JSON Schema derivado do Zod
 * via conversor mínimo local (3 schemas simples — sem dependência nova).
 */
export function listToolDeclarations(): AIToolDeclaration[] {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodObjectToJsonSchema(t.inputSchema),
  }));
}

/**
 * Conversor Zod→JSON Schema MÍNIMO: cobre ZodObject de ZodString /
 * ZodOptional<ZodString> com describe() — exatamente o que as 3 tools da C11
 * usam. Tool nova com shape diferente deve estender isto conscientemente
 * (gate: lança em vez de emitir schema errado).
 */
function zodObjectToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def?: { typeName?: string } })._def;
  if (def?.typeName !== 'ZodObject') {
    throw new Error('[ai-agent] inputSchema de tool deve ser z.object(...) (C11)');
  }
  const shape = (
    schema as unknown as { shape: Record<string, z.ZodTypeAny> }
  ).shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    let inner = field as z.ZodTypeAny;
    let optional = false;
    let innerDef = (inner as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
    while (innerDef?.typeName === 'ZodOptional' || innerDef?.typeName === 'ZodDefault') {
      optional = true;
      inner = innerDef.innerType as z.ZodTypeAny;
      innerDef = (inner as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
    }
    if (innerDef?.typeName !== 'ZodString') {
      throw new Error(
        `[ai-agent] zodObjectToJsonSchema só cobre strings (campo '${key}') — estenda o conversor`,
      );
    }
    properties[key] = {
      type: 'string',
      ...(inner.description ? { description: inner.description } : {}),
    };
    if (!optional) required.push(key);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((i) => i.path.join('.') || '(root)').slice(0, 10);
}

/**
 * Valida o lote inteiro ANTES de qualquer handler executar. Além de enforçar
 * uma mutação por turno, impede o caso "mutação válida seguida de tool
 * inválida", no qual a primeira ação já teria sido persistida.
 */
export function preflightToolCalls(
  calls: ToolCall[],
  ctx: ToolContext,
): ToolBatchPreflightResult {
  const mutations: string[] = [];

  for (const call of calls) {
    const tool = getTool(call.name);
    if (!tool) {
      metrics.emit('ai_agent.tool.unknown', {
        clinicId: ctx.clinicId,
        toolName: call.name,
        aiRequestId: ctx.aiRequestId,
      });
      return {
        ok: false,
        kind: 'unknown_tool',
        toolName: call.name,
        error: `tool desconhecida: ${call.name}`,
      };
    }

    const parsedInput = tool.inputSchema.safeParse(call.args);
    if (!parsedInput.success) {
      const paths = issuePaths(parsedInput.error);
      metrics.emit('ai_agent.tool.invalid', {
        clinicId: ctx.clinicId,
        toolName: call.name,
        aiRequestId: ctx.aiRequestId,
        issues: paths,
      });
      return {
        ok: false,
        kind: 'invalid_input',
        toolName: call.name,
        error: `input inválido para ${call.name}`,
        issuePaths: paths,
      };
    }

    if (tool.effect === 'mutation') mutations.push(call.name);
  }

  if (mutations.length > 1) {
    metrics.emit('ai_agent.tool.multiple_mutations_rejected', {
      clinicId: ctx.clinicId,
      aiRequestId: ctx.aiRequestId,
      toolNames: mutations,
    });
    return {
      ok: false,
      kind: 'multiple_mutations',
      error: 'mais de uma mutação no mesmo turno',
    };
  }

  return { ok: true };
}

/**
 * Pipeline obrigatório de execução: whitelist → Zod input → handler →
 * Zod output. Métrica em cada rejeição; o caller (handler da saga) registra
 * em ai_agent_failures e decide o fallback.
 */
export async function validateAndExecute(
  call: ToolCall,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = getTool(call.name);
  if (!tool) {
    // G9 — security event: o LLM tentou uma tool fora da whitelist.
    metrics.emit('ai_agent.tool.unknown', {
      clinicId: ctx.clinicId,
      toolName: call.name,
      aiRequestId: ctx.aiRequestId,
    });
    return { ok: false, kind: 'unknown_tool', error: `tool desconhecida: ${call.name}` };
  }

  const parsedInput = tool.inputSchema.safeParse(call.args);
  if (!parsedInput.success) {
    metrics.emit('ai_agent.tool.invalid', {
      clinicId: ctx.clinicId,
      toolName: call.name,
      aiRequestId: ctx.aiRequestId,
      issues: issuePaths(parsedInput.error),
    });
    return {
      ok: false,
      kind: 'invalid_input',
      error: `input inválido para ${call.name}`,
      issuePaths: issuePaths(parsedInput.error),
    };
  }

  let raw: unknown;
  try {
    raw = await tool.handler(parsedInput.data, ctx);
  } catch (err) {
    metrics.emit('ai_agent.tool.handler_error', {
      clinicId: ctx.clinicId,
      toolName: call.name,
      aiRequestId: ctx.aiRequestId,
      error: err,
    });
    return { ok: false, kind: 'handler_error', error: `handler de ${call.name} falhou` };
  }

  const parsedOutput = tool.outputSchema.safeParse(raw);
  if (!parsedOutput.success) {
    // R5 — o LLM nunca recebe output fora de contrato.
    metrics.emit('ai_agent.tool.invalid_output', {
      clinicId: ctx.clinicId,
      toolName: call.name,
      aiRequestId: ctx.aiRequestId,
      issues: issuePaths(parsedOutput.error),
    });
    return {
      ok: false,
      kind: 'invalid_output',
      error: `output inválido de ${call.name}`,
      issuePaths: issuePaths(parsedOutput.error),
    };
  }

  return { ok: true, response: parsedOutput.data as object };
}

/** Test-only (padrão __testing__ do repo). */
export const __testing__ = {
  clear: () => registry.clear(),
  size: () => registry.size,
};
