/**
 * Tool lgpd_delete_request (C12) — registra solicitação de EXCLUSÃO LGPD.
 * NUNCA exclui (a Server Action admin é que soft-deleta; a IA jamais dispara
 * isso a partir de um WhatsApp não verificado). Grava intake `pending` SEM
 * publicar o evento de cumprimento e SEMPRE escala handoff humano para verificar
 * identidade. Requer paciente casado pelo telefone verificado.
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
  name: 'lgpd_delete_request',
  description: 'Registra um pedido de exclusão de dados (LGPD). Não exclui na hora.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    if (!ctx.patientId) {
      await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, 'lgpd_delete sem identidade');
      return { requested: false, handoff: true };
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'lgpd_delete_request', { p: ctx.patientId });
    await patientApiV1.createLgpdRequestPending(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      ctx.patientId,
      'delete',
      idemKey,
    );
    await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, 'lgpd_delete verificação');
    return { requested: true, handoff: true };
  },
});
