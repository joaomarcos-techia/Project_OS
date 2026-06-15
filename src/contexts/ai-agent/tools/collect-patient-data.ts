/**
 * Tool collect_patient_data (C12) — coleta de paciente NOVO. SÓ escreve campos
 * na memória cifrada (collected_data); a saga é quem cria o paciente quando
 * completo E confirmado (register_patient NÃO é tool — par.12).
 *
 * Segurança: o `telefone` é SEMPRE o número verificado do contato (ctx), nunca
 * o que o LLM digitar — ancora o cadastro no telefone confirmado pela Meta
 * (anti-spoofing). `confirmed='true'` marca que o paciente confirmou o resumo.
 */
import { z } from 'zod';

import { getCollectedData, mergeCollectedData, setCollectedData } from '../internal/conversation';
import type { CollectedData } from '../types';
import { registerTool } from './registry';

const InputSchema = z.object({
  nome: z.string().max(120).optional().describe('Nome completo informado pelo paciente'),
  cpf: z.string().max(14).optional().describe('CPF informado (só dígitos/máscara)'),
  motivo: z.string().max(200).optional().describe('Motivo da consulta'),
  confirmed: z
    .string()
    .optional()
    .describe("'true' quando o paciente confirmar o resumo dos dados"),
});

const OutputSchema = z.object({
  accepted: z.boolean(),
  missing: z.array(z.string()),
  complete: z.boolean(),
  confirmed: z.boolean(),
});

const FIELD_LABEL: Record<string, string> = {
  nome: 'nome',
  cpf: 'cpf',
  telefone: 'telefone',
  motivo: 'motivo',
};

registerTool({
  name: 'collect_patient_data',
  description:
    'Registra dados de cadastro de paciente novo (nome, cpf, motivo). O telefone é o do contato. Chame com confirmed="true" quando o paciente confirmar o resumo.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    // telefone vem SEMPRE do número verificado — nunca do LLM (anti-spoofing).
    // Constrói só com campos definidos (exactOptionalPropertyTypes).
    const partial: CollectedData = { telefone: ctx.verifiedPhone };
    if (input.nome !== undefined) partial.nome = input.nome;
    if (input.cpf !== undefined) partial.cpf = input.cpf;
    if (input.motivo !== undefined) partial.motivo = input.motivo;
    const merged = await mergeCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId, partial);

    let confirmed = merged.data._confirmed ?? false;
    if (input.confirmed === 'true') {
      confirmed = true;
      const cur = (await getCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId)) ?? merged.data;
      await setCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId, { ...cur, _confirmed: true });
    }

    const missing = (['nome', 'cpf', 'telefone', 'motivo'] as const)
      .filter((k) => !merged.data[k])
      .map((k) => FIELD_LABEL[k]!);

    return { accepted: true, missing, complete: merged.complete, confirmed };
  },
});
