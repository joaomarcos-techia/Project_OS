/**
 * Tool provide_procedure_price (C11) — catálogo de preços de procedimentos.
 *
 * Lazy context (G3): consulta o Scheduling SOB DEMANDA via API interna
 * versionada (api.scheduling.listProcedures — mandato do PlanoAção §11.2).
 * Nunca toca tabela do scheduling diretamente. Nota: listProcedures gerencia a
 * própria withTenant TX (leitura curta) — não usa o ctx.tx desta fase.
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna PÚBLICA do Scheduling (M14), desenhada p/ o AI Agent (C11/C12) — mesma exceção do handler financial/appointment-completed. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */
/* eslint-disable-next-line boundaries/element-types -- consulta comercial pela superfície pública de Payments. */
import { getPaymentPricingPolicy, listProcedurePaymentPrices } from '@/contexts/payments';

import { registerTool } from './registry';

const InputSchema = z
  .object({
    procedure_name: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Nome (ou parte do nome) do procedimento que o paciente perguntou. Omita para listar todos.',
      )
      .optional(),
  })
  .strict();

const OutputSchema = z.object({
  procedures: z.array(
    z.object({
      // procedure_id é o identificador que list_slots aceita como filtro.
      // Sem ele o agente não tinha como referenciar o procedimento para agendar
      // (o preço era divulgável, mas o agendamento ficava impossível).
      procedure_id: z.string(),
      descricao: z.string(),
      categoria: z.string().nullable(),
      valor: z.number().nullable(),
      duracao_min: z.number(),
      payment_options: z.array(
        z.object({
          payment_method: z.enum(['pix', 'credit_card']),
          installment_count: z.number().int().nullable(),
          gross_amount: z.number(),
          hosted_checkout_supports_option: z.boolean(),
        }),
      ),
    }),
  ),
});

/** Normaliza para matching tolerante (minúsculas, sem acentos). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

registerTool({
  name: 'provide_procedure_price',
  description:
    'Lista procedimentos da clínica com procedure_id, duração e preços em BRL. Em preço por forma de pagamento, valor é nulo e payment_options traz os preços configurados por Pix/cartão e parcelas; hosted_checkout_supports_option indica apenas compatibilidade técnica do Checkout, não promessa de link imediato. O envio depende da política de cobrança e da elegibilidade do atendimento. Passe procedure_name para filtrar; sem filtro retorna o catálogo (top 20). Para agendar, use prepare_appointment com o NOME do procedimento.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const all = await schedulingApiV1.listProcedures(ctx.clinicId, { limit: 20 });
    const filtered = input.procedure_name
      ? all.filter((p) => fold(p.descricao).includes(fold(input.procedure_name!)))
      : all;
    const pricingPolicy = await getPaymentPricingPolicy(ctx.clinicId);
    const prices =
      pricingPolicy.mode === 'payment_method_pricing'
        ? await listProcedurePaymentPrices(ctx.clinicId)
        : [];
    return {
      procedures: filtered.map((p) => ({
        procedure_id: p.id,
        descricao: p.descricao,
        categoria: p.categoria,
        valor: pricingPolicy.mode === 'absorb_fees' ? p.valorPadrao : null,
        duracao_min: p.duracaoPadraoMin,
        payment_options: prices.flatMap((price) => {
          if (
            price.procedureId !== p.id ||
            (price.paymentMethod !== 'pix' && price.paymentMethod !== 'credit_card')
          ) {
            return [];
          }
          return [
            {
              payment_method: price.paymentMethod,
              installment_count: price.installmentCount,
              gross_amount: price.grossAmount,
              hosted_checkout_supports_option:
                price.paymentMethod === 'pix' || price.installmentCount === 1,
            },
          ];
        }),
      })),
    };
  },
});
