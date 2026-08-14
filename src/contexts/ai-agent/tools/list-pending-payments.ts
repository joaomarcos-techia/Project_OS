/**
 * Tool list_pending_payments (C12) — SOMENTE LEITURA (a IA nunca cria/edita
 * cobrança). Elo mais sensível (ADR-023): telefone é fator, não prova. Por
 * padrão NÃO divulga valores — só confirma existência e escala handoff.
 * Divulgação completa exige opt-in da clínica (canDisclosePayments) E paciente
 * casado pelo telefone verificado.
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- financialApiV1 é a API interna pública (M14). */
import { financialApiV1 } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { escalateToHuman } from '../internal/conversation';
import { registerTool } from './registry';

const InputSchema = z.object({});

const OutputSchema = z.object({
  disclosed: z.boolean(),
  has_pending: z.boolean(),
  count: z.number(),
  items: z
    .array(
      z.object({
        descricao: z.string(),
        valor: z.number(),
        status: z.string(),
        due_date: z.string().nullable(),
      }),
    )
    .optional(),
  handoff: z.boolean(),
});

registerTool({
  name: 'list_pending_payments',
  // F-10 (auditoria 2026-08-14): declarada MUTATION porque escala handoff
  // (escalateToHuman muda o status da conversa). Como 'read' ela escapava do
  // teto de uma mutação por turno e podia rodar junto de um agendamento,
  // deixando uma ação pendente órfã numa conversa já entregue ao humano.
  effect: 'mutation',
  description:
    'Verifica cobranças pendentes do paciente. Não revela valores sem autorização da clínica.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    // Sem paciente casado pelo telefone verificado → não há o que listar + handoff.
    if (!ctx.patientId) {
      await escalateToHuman(
        ctx.tx,
        ctx.clinicId,
        ctx.conversationId,
        'financeiro sem identidade verificada',
      );
      return { disclosed: false, has_pending: false, count: 0, handoff: true };
    }
    const pend = await financialApiV1.listPendingByPatient(ctx.clinicId, ctx.patientId);
    const hasPending = pend.length > 0;

    // Sem opt-in da clínica: não divulga valores; se há pendência, escala.
    if (!ctx.canDisclosePayments) {
      if (hasPending) {
        await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, 'divulgação de cobrança');
      }
      return { disclosed: false, has_pending: hasPending, count: pend.length, handoff: hasPending };
    }

    return {
      disclosed: true,
      has_pending: hasPending,
      count: pend.length,
      items: pend.slice(0, 20).map((p) => ({
        descricao: p.descricao,
        valor: p.valor,
        status: p.status,
        due_date: p.dueDate,
      })),
      handoff: false,
    };
  },
});
