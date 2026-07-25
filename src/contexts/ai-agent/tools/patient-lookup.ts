/**
 * Tool patient_lookup (C12) — CONGELADA phone-only (ADR-023). Diz se há paciente
 * cadastrado para o telefone VERIFICADO do contato. Não aceita CPF/email/nome
 * (mistura identidade declarada vs verificada e vira hidra). Read-only: o match
 * por telefone já foi feito na saga; aqui só expõe o resultado ao LLM.
 */
import { z } from 'zod';

import { registerTool } from './registry';

const InputSchema = z.object({});

const OutputSchema = z.object({
  found: z.boolean(),
  ambiguous: z.boolean(),
  patient_id: z.string().nullable(),
  nome: z.string().nullable(),
});

registerTool({
  name: 'patient_lookup',
  description:
    'Verifica se o telefone deste contato já tem cadastro de paciente. Use no início para decidir entre fluxo normal e coleta de cadastro.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => ({
    found: !!ctx.patientId,
    ambiguous: ctx.identityAmbiguous,
    patient_id: ctx.patientId,
    nome: ctx.patientNome ?? null,
  }),
});
