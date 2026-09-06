/**
 * RBAC-001 — contrato da configuração do agente (`manage:agent`).
 *
 * Separado de `config-actions.ts` porque aquele arquivo é `'use server'`: um
 * módulo de Server Actions só pode exportar funções async, então schema e tipos
 * precisam morar fora. Este arquivo é client-safe — o formulário o importa.
 */
import { z } from 'zod';

/** Parâmetros que a clínica controla. Nada aqui é PII. */
export const AgentConfigSchema = z.object({
  /** O agente pode agendar para um contato ainda não cadastrado. */
  canScheduleAnonymous: z.boolean(),
  /** Horizonte de agendamento oferecido pelo agente. */
  maxDaysAhead: z.number().int().min(1).max(180),
  /**
   * Opt-in para o agente DIVULGAR valores de cobranças pendentes por WhatsApp
   * (ADR-023). Sem isto a tool só confirma existência e faz handoff.
   */
  canDisclosePaymentsViaAgent: z.boolean(),
  especialidades: z.array(z.string().trim().min(1).max(80)).max(20),
  /** Convênios aceitos pela clínica; lista vazia significa não informado. */
  convenios: z.array(z.string().trim().min(1).max(80)).max(40),
});
export type AgentConfigInput = z.infer<typeof AgentConfigSchema>;

export interface AgentConfigDTO extends AgentConfigInput {
  updatedAt: string | null;
}

export type AgentConfigResult = { ok: true; data: AgentConfigDTO } | { ok: false; message: string };

export const AGENT_CONFIG_DEFAULTS: AgentConfigInput = {
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  canDisclosePaymentsViaAgent: false,
  especialidades: [],
  convenios: [],
};
