/**
 * Tool list_insurance_options (P11.1) — por quais convênios a clínica AGENDA por aqui.
 *
 * Só leitura e só nomes: operadoras e planos ATIVOS da própria clínica (a consulta do Convênios já filtra por clínica
 * e status; a clínica vem do contexto verificado, nunca do modelo). Não é a lista informativa de "convênios aceitos"
 * (essa continua em provide_clinic_info): é a que permite marcar pelo convênio com prepare_appointment.
 *
 * Clínica sem o módulo ligado (ou sem operadora ativa) não "recusa" convênio: o agendamento por convênio dela é com a
 * recepção. Falha ao consultar = fail-closed (nada afirmado, nada criado).
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- superfície pública do Convênios (P11), mesma exceção das APIs de agenda e pagamentos. */
import {
  agentInsuranceOptions,
  AGENT_INSURANCE_TEXT,
  getSchedulingInsuranceOptions,
} from '@/contexts/health-insurance';
/* eslint-enable boundaries/element-types */
import { metrics } from '@/lib/observability/metrics';

import { registerTool } from './registry';

const InputSchema = z.object({});

const OutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('insurance_options'),
    insurers: z.array(z.object({ name: z.string(), plans: z.array(z.string()) })),
    patient_message: z.string(),
  }),
  z.object({ status: z.literal('insurance_not_available'), patient_message: z.string() }),
  z.object({ status: z.literal('insurance_unavailable'), patient_message: z.string() }),
]);

registerTool({
  name: 'list_insurance_options',
  description:
    'Lista os convênios (operadoras e planos) pelos quais a clínica AGENDA por aqui. Use quando o paciente quiser marcar pelo convênio ou plano de saúde e você não souber se a operadora dele está na lista. Não informa cobertura, autorização nem valor. Para só informar quais convênios a clínica aceita, use provide_clinic_info.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    let options: ReturnType<typeof agentInsuranceOptions>;
    try {
      options = agentInsuranceOptions(await getSchedulingInsuranceOptions(ctx.clinicId));
    } catch {
      metrics.emit('ai_agent.insurance.check_failed', {
        clinicId: ctx.clinicId,
        aiRequestId: ctx.aiRequestId,
        tool: 'list_insurance_options',
      });
      return {
        status: 'insurance_unavailable' as const,
        patient_message: AGENT_INSURANCE_TEXT.unavailable,
      };
    }
    if (options.kind === 'not_available') {
      return { status: 'insurance_not_available' as const, patient_message: options.reply };
    }
    return {
      status: 'insurance_options' as const,
      insurers: options.insurers.map((i) => ({ name: i.name, plans: i.plans.map((p) => p.name) })),
      patient_message: `Por aqui, a clínica agenda pelos convênios: ${options.insurers
        .map((i) => i.name)
        .join(', ')}. ${AGENT_INSURANCE_TEXT.receptionChecksCard}`,
    };
  },
});
