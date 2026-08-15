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

import { normalizeCpf, validateCpf } from '@/lib/crypto';

import { getCollectedData, mergeCollectedData, setCollectedData } from '../internal/conversation';
import { isExplicitConfirmation } from '../internal/pending-action';
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

const RegistrationFieldSchema = z.enum(['nome', 'cpf', 'motivo']);

const OutputSchema = z.object({
  accepted: z.boolean(),
  missing: z.array(RegistrationFieldSchema),
  complete: z.boolean(),
  confirmed: z.boolean(),
  next_required_field: RegistrationFieldSchema.nullable(),
  /** Resposta autoritativa que o handler entrega sem deixar o LLM improvisar. */
  patient_message: z.string(),
});

export type RegistrationField = z.infer<typeof RegistrationFieldSchema>;

const REQUIRED_FIELDS = ['nome', 'cpf', 'motivo'] as const satisfies readonly RegistrationField[];

const NAME_PREFIX = /^(?:meu\s+nome\s+(?:é|e)|nome\s*[:\-]|sou)\s+/iu;
const NON_NAME_WORDS = new Set([
  'agendar',
  'atendente',
  'consulta',
  'gostaria',
  'humano',
  'marcar',
  'preciso',
  'quero',
]);

export type RegistrationFieldFromMessage =
  | { accepted: true; partial: Pick<CollectedData, RegistrationField> }
  | { accepted: false; patientMessage: string };

/**
 * Extrai somente o campo que o servidor já sabe que está aguardando. Isso evita
 * que um CPF válido dependa de o modelo copiá-lo corretamente para uma tool.
 */
export function registrationFieldFromMessage(
  field: RegistrationField,
  text: string,
): RegistrationFieldFromMessage {
  const value = text.trim();
  if (field === 'cpf') {
    if (!validateCpf(value)) {
      return {
        accepted: false,
        patientMessage: patientRegistrationMessage({
          nextRequiredField: 'cpf',
          complete: false,
          confirmed: false,
          invalidCpf: true,
        }),
      };
    }
    return { accepted: true, partial: { cpf: normalizeCpf(value) } };
  }

  if (field === 'nome') {
    const nome = value.replace(NAME_PREFIX, '').trim();
    const words = nome.split(/\s+/u);
    const looksLikeName =
      nome.length <= 120 &&
      // F-15: teclados de iOS/Android trocam a apóstrofe reta (') pela
      // tipográfica (’) automaticamente. Aceitar só a reta rejeitava nomes
      // legítimos — D’Ávila, D’Angelo, N’Doye — e prendia a pessoa no cadastro.
      /^[\p{L}][\p{L}'’ -]*$/u.test(nome) &&
      words.length >= 2 &&
      !words.some((word) => NON_NAME_WORDS.has(word.toLocaleLowerCase('pt-BR')));
    if (!looksLikeName) {
      return {
        accepted: false,
        patientMessage: 'Para iniciar seu cadastro, informe seu nome completo.',
      };
    }
    return { accepted: true, partial: { nome } };
  }

  if (value.length === 0 || value.length > 200) {
    return {
      accepted: false,
      patientMessage: 'Informe o motivo da consulta em até 200 caracteres.',
    };
  }
  return { accepted: true, partial: { motivo: value } };
}

function nextRequiredField(data: CollectedData): RegistrationField | null {
  return REQUIRED_FIELDS.find((field) => !data[field]) ?? null;
}

export function patientRegistrationMessage(args: {
  nextRequiredField: RegistrationField | null;
  complete: boolean;
  confirmed: boolean;
  invalidCpf?: boolean;
  confirmationRejected?: boolean;
}): string {
  if (args.invalidCpf) {
    return 'O CPF informado é inválido. Envie novamente os 11 dígitos, com ou sem pontuação.';
  }
  if (args.nextRequiredField === 'nome') {
    return 'Para iniciar seu cadastro, informe seu nome completo.';
  }
  if (args.nextRequiredField === 'cpf') {
    return 'Agora, informe seu CPF, com ou sem pontuação.';
  }
  if (args.nextRequiredField === 'motivo') {
    return 'Qual é o motivo da consulta?';
  }
  if (!args.complete) {
    return 'Para continuar seu cadastro, informe os dados pendentes.';
  }
  if (args.confirmationRejected) {
    return 'Para concluir seu cadastro, responda SIM ou envie a correção necessária.';
  }
  if (!args.confirmed) {
    return 'Recebi os dados necessários. Responda SIM para confirmar o cadastro ou envie a correção.';
  }
  return 'Cadastro confirmado. Estou concluindo o registro.';
}

registerTool({
  name: 'collect_patient_data',
  effect: 'mutation',
  description:
    'Registra dados de cadastro de paciente novo (nome, CPF, motivo). O telefone é o do contato. Registre somente o próximo dado obrigatório. Chame com confirmed="true" apenas quando a mensagem atual for uma confirmação explícita. Após a chamada, responda exatamente com patient_message retornada.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    // telefone vem SEMPRE do número verificado — nunca do LLM (anti-spoofing).
    // Constrói só com campos definidos (exactOptionalPropertyTypes).
    const partial: CollectedData = { telefone: ctx.verifiedPhone };
    if (input.nome !== undefined) partial.nome = input.nome;
    const invalidCpf = input.cpf !== undefined && !validateCpf(input.cpf);
    if (input.cpf !== undefined && !invalidCpf) partial.cpf = normalizeCpf(input.cpf);
    if (input.motivo !== undefined) partial.motivo = input.motivo;
    const merged = await mergeCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId, partial);

    let confirmed = merged.data._confirmed ?? false;
    const confirmationRejected =
      input.confirmed === 'true' && !isExplicitConfirmation(ctx.currentMessage);
    if (input.confirmed === 'true' && !confirmationRejected && !invalidCpf) {
      confirmed = true;
      const cur = (await getCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId)) ?? merged.data;
      await setCollectedData(ctx.tx, ctx.clinicId, ctx.conversationId, {
        ...cur,
        _confirmed: true,
      });
    }

    const nextField = nextRequiredField(merged.data);
    const missing = REQUIRED_FIELDS.filter((field) => !merged.data[field]);

    return {
      accepted: !invalidCpf && !confirmationRejected,
      missing,
      complete: merged.complete,
      confirmed,
      next_required_field: nextField,
      patient_message: patientRegistrationMessage({
        nextRequiredField: nextField,
        complete: merged.complete,
        confirmed,
        invalidCpf,
        confirmationRejected,
      }),
    };
  },
});

export const __testing__ = { patientRegistrationMessage, registrationFieldFromMessage };
