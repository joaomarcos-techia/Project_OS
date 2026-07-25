/**
 * Tool lgpd_export_request (C12) — registra solicitação de EXPORTAÇÃO LGPD.
 * NUNCA exporta: grava intake `pending` (sem publicar o evento de cumprimento,
 * que geraria o PDF/URL) e SEMPRE escala handoff para verificação de identidade
 * humana (telefone não é prova). Requer paciente casado pelo telefone verificado.
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- patientApiV1 é a API interna pública (M14). */
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import { escalateToHuman } from '../internal/conversation';
import { registerTool } from './registry';

const InputSchema = z.object({});

const OutputSchema = z.object({ requested: z.boolean(), handoff: z.boolean() });

registerTool({
  name: 'lgpd_export_request',
  effect: 'mutation',
  description: 'Registra um pedido de exportação de dados (LGPD). Não exporta na hora.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    if (!ctx.patientId) {
      await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, 'lgpd_export sem identidade');
      return { requested: false, handoff: true };
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'lgpd_export_request', { p: ctx.patientId });
    await patientApiV1.createLgpdRequestPending(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      ctx.patientId,
      'export',
      idemKey,
    );
    await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, 'lgpd_export verificação');
    return { requested: true, handoff: true };
  },
});
