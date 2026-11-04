/**
 * Tool provide_clinic_info (C11) — horário de funcionamento, endereço,
 * especialidades e convênios aceitos pela clínica.
 *
 * Lazy context (G3): busca os PRÓPRIOS dados quando o LLM pede — leitura de
 * `clinics` é single-table read da fundação tenancy via ctx.tx (precedente:
 * financial/appointment-completed.ts:96; não é JOIN cross-context) +
 * ai_clinic_config do próprio contexto.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { aiClinicConfig } from '../schema';
import { EMPTY_OPERATIONAL_INFO, OperationalInfoSchema } from '../config-types';
import { operationalQuestionReply } from '../internal/operational-information';
import { registerTool } from './registry';

const InputSchema = z.object({}).strict();

const OutputSchema = z.object({
  nome: z.string(),
  endereco: z.string().nullable(),
  timezone: z.string(),
  working_hours: z.unknown().nullable(),
  especialidades: z.array(z.string()).nullable(),
  // Vazio = informação não cadastrada. O prompt proíbe inferir ou traduzir
  // isso como "a clínica não aceita convênios".
  convenios: z.array(z.string()),
  operational_info: OperationalInfoSchema,
  patient_message: z.string().nullable(),
});

registerTool({
  name: 'provide_clinic_info',
  description:
    'Retorna informações operacionais da clínica: nome, endereço, fuso horário, horários de funcionamento, especialidades, convênios aceitos e regras cadastradas de atendimento online, infantil e retorno. Use nas perguntas sobre essas informações. Campos vazios significam informação não cadastrada. Se patient_message vier preenchida, apresente essa resposta sem repetir consultas nem inventar regras.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    const clinicRows = await ctx.tx.execute<{
      nome: string;
      endereco: string | null;
      timezone: string | null;
    }>(sql`SELECT nome, endereco, timezone FROM clinics WHERE id = ${ctx.clinicId} LIMIT 1`);
    const clinic = clinicRows[0];
    if (!clinic) throw new Error('clínica não encontrada no contexto tenant');

    const [config] = await ctx.tx.select().from(aiClinicConfig).limit(1);

    return {
      nome: clinic.nome,
      endereco: clinic.endereco ?? null,
      timezone: clinic.timezone ?? 'America/Sao_Paulo',
      working_hours: config?.workingHours ?? null,
      especialidades: config?.especialidades ?? null,
      convenios: config?.convenios ?? [],
      operational_info: { ...EMPTY_OPERATIONAL_INFO, ...config?.operationalInfo },
      patient_message: operationalQuestionReply(ctx.currentMessage, config?.operationalInfo),
    };
  },
});
