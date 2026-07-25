/**
 * Tool request_human_handoff (C11) — paciente pediu (ou o LLM decidiu
 * escalar para) atendimento humano: cria entrada em ai_handoff_queue (dedup
 * de handoff aberto) e marca a conversa como 'handoff'.
 */
import { z } from 'zod';

import { escalateToHuman } from '../internal/conversation';
import { registerTool } from './registry';

const InputSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe('Motivo curto do encaminhamento, na perspectiva do paciente.'),
  })
  .strict();

const OutputSchema = z.object({
  queued: z.literal(true),
  message_to_patient: z.string(),
});

registerTool({
  name: 'request_human_handoff',
  effect: 'mutation',
  description:
    'Encaminha a conversa para um atendente humano. Use quando o paciente pedir para falar com uma pessoa, quando o assunto fugir do operacional ou quando você não conseguir resolver.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    await escalateToHuman(ctx.tx, ctx.clinicId, ctx.conversationId, input.reason);
    return {
      queued: true as const,
      message_to_patient:
        'Já encaminhei sua conversa para um atendente humano — você receberá retorno em breve.',
    };
  },
});
