/**
 * Context Builder (C11) — produz DADOS estruturados (PromptContext), nunca
 * prompt (a prompt layer monta o texto). Contexto 100% derivado do tx
 * tenant-scoped — isolamento por construção.
 *
 * Lazy context (review G3): NÃO consulta scheduling (slots/procedures). As
 * tools buscam os próprios dados sob demanda — toda conversa deixava de pagar
 * 2 consultas que talvez nunca fossem usadas. `listSlots` volta na C12 com a
 * tool list_slots.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { MAX_CONTEXT_MESSAGES } from '../limits';
import { truncateInbound } from '../prompts/system';
import { aiClinicConfig } from '../schema';
import type { PromptContext } from '../types';
import { getRecentMessages } from './conversation';

const DEFAULT_TZ = 'America/Sao_Paulo';

export async function buildContext(
  tx: Tx,
  args: {
    clinicId: string;
    conversationId: string;
    currentMessage: string;
    patient: { id: string; nome: string } | null;
    /** Turno corrente (eventId) — excluído da janela p/ não duplicar no prompt. */
    excludeEventId?: string;
  },
): Promise<PromptContext> {
  // Clínica: single-table read da fundação tenancy (precedente financial:96-100).
  const clinicRows = await tx.execute<{
    nome: string;
    endereco: string | null;
    timezone: string | null;
  }>(sql`SELECT nome, endereco, timezone FROM clinics WHERE id = ${args.clinicId} LIMIT 1`);
  const clinic = clinicRows[0];
  if (!clinic) throw new Error('[ai-agent] clínica não encontrada no contexto tenant');

  // Config do agente — defaults seguros quando a clínica ainda não configurou.
  const [config] = await tx
    .select()
    .from(aiClinicConfig)
    .where(eq(aiClinicConfig.clinicId, args.clinicId))
    .limit(1);

  const history = await getRecentMessages(
    tx,
    args.clinicId,
    args.conversationId,
    MAX_CONTEXT_MESSAGES,
    args.excludeEventId,
  );

  return {
    clinic: {
      id: args.clinicId,
      nome: clinic.nome,
      endereco: clinic.endereco ?? null,
      timezone: clinic.timezone ?? DEFAULT_TZ,
    },
    aiConfig: {
      workingHours: config?.workingHours ?? null,
      especialidades: config?.especialidades ?? null,
      canScheduleAnonymous: config?.canScheduleAnonymous ?? false,
      maxDaysAhead: config?.maxDaysAhead ?? 30,
      canDisclosePayments: config?.canDisclosePaymentsViaAgent ?? false,
    },
    patient: args.patient,
    history,
    currentMessage: truncateInbound(args.currentMessage),
  };
}
