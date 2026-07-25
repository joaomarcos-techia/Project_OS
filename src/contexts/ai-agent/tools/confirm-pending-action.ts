import { z } from 'zod';

import { executePendingAction } from '../internal/pending-action';
import { registerTool } from './registry';

const InputSchema = z.object({});
const OutputSchema = z.object({
  pending_action_id: z.string().uuid(),
  action: z.string(),
  appointment_id: z.string().uuid(),
  status: z.string(),
  scheduled_at: z.string().optional(),
});

registerTool({
  name: 'confirm_pending_action',
  effect: 'mutation',
  description:
    'Executa a ação pendente somente depois de uma nova confirmação explícita do paciente. Nunca use na mesma mensagem que preparou a ação.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    const result = await executePendingAction(ctx);
    return {
      pending_action_id: result.pendingActionId,
      action: result.action,
      appointment_id: result.appointmentId,
      status: result.status,
      scheduled_at: result.scheduledAt,
    };
  },
});
