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

import { registerTool } from './registry';

const InputSchema = z
  .object({
    procedure_name: z
      .string()
      .min(1)
      .max(200)
      .describe('Nome (ou parte do nome) do procedimento que o paciente perguntou. Omita para listar todos.')
      .optional(),
  })
  .strict();

const OutputSchema = z.object({
  procedures: z.array(
    z.object({
      descricao: z.string(),
      categoria: z.string().nullable(),
      valor: z.number(),
      duracao_min: z.number(),
    }),
  ),
});

/** Normaliza para matching tolerante (minúsculas, sem acentos). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

registerTool({
  name: 'provide_procedure_price',
  description:
    'Lista procedimentos da clínica com preço (BRL) e duração. Passe procedure_name para filtrar pelo procedimento que o paciente mencionou; sem filtro retorna o catálogo (top 20).',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const all = await schedulingApiV1.listProcedures(ctx.clinicId, { limit: 20 });
    const filtered = input.procedure_name
      ? all.filter((p) => fold(p.descricao).includes(fold(input.procedure_name!)))
      : all;
    return {
      procedures: filtered.map((p) => ({
        descricao: p.descricao,
        categoria: p.categoria,
        valor: p.valorPadrao,
        duracao_min: p.duracaoPadraoMin,
      })),
    };
  },
});
