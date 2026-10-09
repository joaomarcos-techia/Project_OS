/**
 * Tool prepare_appointment (C12+) — booking CONSOLIDADO em UMA chamada.
 *
 * Motivação (teste ao vivo 2026-07-30): a marcação decomposta em 3 tools
 * (provide_procedure_price → list_slots → schedule_appointment) exigia o modelo
 * orquestrar múltiplas rodadas e ele não convergia (ficava em loop em list_slots).
 * Esta tool recebe entradas HUMANAS (nome do procedimento/especialidade + horário
 * desejado, ou nada = primeiro horário livre) e resolve procedimento, médico e
 * slot SERVER-SIDE, devolvendo o pending action num passo só. A confirmação
 * continua em duas etapas (confirm_pending_action no turno seguinte).
 *
 * Segurança: idêntica a schedule_appointment — paciente é SEMPRE ctx.patientId
 * (telefone verificado), políticas de identidade/maxDaysAhead/passado aplicadas.
 * NÃO cria a consulta: só prepara (mesma trilha de proposePendingAction).
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14), mesma exceção das outras tools de agenda. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */
/* eslint-disable boundaries/element-types -- catálogo e resolução comerciais vêm da API pública de Payments. */
import {
  getPaymentPricingPolicy,
  listProcedurePaymentPrices,
  paymentsApiV1,
  resolveConfiguredProcedurePaymentPrice,
} from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import {
  anonymousSchedulingAllowed,
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  proposePendingAction,
} from '../internal/pending-action';
import {
  appointmentTimeForPatient,
  reconcileRequestedTime,
  resolveRequestedDateTime,
} from '../internal/relative-datetime';
import { agentSlotFloor } from './list-slots';
import { registerTool } from './registry';

const InputSchema = z.object({
  procedure_name: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Nome ou especialidade do procedimento que o paciente quer. Omita se a clínica só tiver um procedimento.',
    ),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Horário desejado (ISO 8601 com offset). Omita para pegar o primeiro horário livre.'),
  payment_method: z
    .enum(['pix', 'credit_card', 'cash'])
    .optional()
    .describe(
      'Forma de pagamento explicitamente escolhida pelo paciente: pix, credit_card ou cash (dinheiro na clínica).',
    ),
  installment_count: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe('Quantidade de parcelas escolhida pelo paciente no cartão. Para Pix, omita.'),
});

const PreparedOutputSchema = z.object({
  status: z.literal('appointment_prepared'),
  pending_action_id: z.string().uuid(),
  action: z.literal('schedule_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

const RegistrationRequiredOutputSchema = z.object({
  status: z.literal('patient_registration_required'),
  required_fields: z.tuple([z.literal('nome'), z.literal('cpf'), z.literal('motivo')]),
});

const AppointmentInformationRequiredOutputSchema = z.object({
  status: z.literal('appointment_information_required'),
  patient_message: z.string(),
});

const AppointmentUnavailableOutputSchema = z.object({
  status: z.literal('appointment_unavailable'),
  patient_message: z.string(),
});

const REGISTRATION_REQUIRED_FIELDS = ['nome', 'cpf', 'motivo'] satisfies ['nome', 'cpf', 'motivo'];

const OutputSchema = z.discriminatedUnion('status', [
  PreparedOutputSchema,
  RegistrationRequiredOutputSchema,
  AppointmentInformationRequiredOutputSchema,
  AppointmentUnavailableOutputSchema,
]);

/** Normaliza (minúsculas, sem acentos). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokens significativos (>= 4 chars) para matching tolerante. */
function procTokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/**
 * Nome EXATO do procedimento (sem caixa, acento nem espaço extra). Vence o
 * matching tolerante: com "Consulta" e "Consulta [demo]" cadastrados, o
 * tolerante casa os dois para "Consulta" e o paciente nunca conseguia escolher
 * o primeiro (visto no DEV em 08/10/2026).
 */
function isSameProcedureName(query: string, p: { descricao: string }): boolean {
  const normalized = (value: string) => fold(value).replace(/\s+/g, ' ').trim();
  return normalized(query) === normalized(p.descricao);
}

/**
 * Matching TOLERANTE de procedimento por nome/especialidade. Substring simples
 * falhava em casos reais (o paciente diz "cardiologia", o procedimento é
 * "Consulta Cardiológica"). Casa por token: inclusão em qualquer direção OU
 * prefixo de 5 chars compartilhado (cardiologia↔cardiológica, dermato↔dermatológica).
 */
function matchesProcedure(
  query: string,
  p: { descricao: string; categoria: string | null },
): boolean {
  const q = procTokens(query);
  const target = procTokens(`${p.descricao} ${p.categoria ?? ''}`);
  return q.some((qt) =>
    target.some((tt) => tt.includes(qt) || qt.includes(tt) || tt.slice(0, 5) === qt.slice(0, 5)),
  );
}

const HOUR_MS = 60 * 60 * 1000;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moneyForMessage = (value: number): string => money.format(value).replace(/\u00a0/g, ' ');

function paymentOptionLabel(method: 'pix' | 'cash' | 'credit_card'): string {
  if (method === 'pix') return 'Pix';
  if (method === 'cash') return 'dinheiro na clínica';
  return 'cartão de crédito em 1x';
}

function commercialPriceLabel(method: 'pix' | 'cash' | 'credit_card'): string {
  if (method === 'pix') return 'via Pix';
  if (method === 'cash') return 'em dinheiro, pago na clínica';
  return 'via cartão de crédito em 1x';
}

function patientPaymentChoice(message: string): {
  method: 'pix' | 'credit_card' | 'cash' | null;
  ambiguous: boolean;
  cardOneTime: boolean;
  cardInstallmentsRequested: boolean;
} {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const pix = /\bpix\b/.test(normalized);
  const card = /\b(?:cartao|credito)\b/.test(normalized);
  // 08/10/2026 — "Pix e o restante em dinheiro" escolhe o Pix: o dinheiro é do
  // RESTANTE, que a clínica recebe na recepção, e não a forma do agendamento.
  const cashWord = /\b(?:dinheiro|especie)\b/.test(normalized);
  const remainderInCash = cashWord && /\b(?:restante|resto|saldo)\b/.test(normalized);
  const cash = cashWord && !remainderInCash;
  const ambiguous = [pix, card, cash].filter(Boolean).length > 1;
  const denied =
    /\b(?:nao|sem)\s+(?:(?:quero|vou|prefiro|pagar|pago)\s+)?(?:no|via|com|em)?\s*(?:pix|cartao|credito|dinheiro)\b/.test(
      normalized,
    );
  const debit = /\bdebito\b/.test(normalized);
  return {
    method:
      ambiguous || denied || debit || /\?/.test(normalized)
        ? null
        : pix
          ? 'pix'
          : card
            ? 'credit_card'
            : cash
              ? 'cash'
              : null,
    ambiguous,
    cardOneTime: /\b1\s*x\b|\buma\s+vez\b|\ba\s+vista\b/.test(normalized),
    cardInstallmentsRequested:
      /\b(?:[2-9]|1[0-2])\s*x\b|\b(?:duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+vezes\b/.test(
        normalized,
      ),
  };
}

// F-04 (auditoria 2026-08-14): a resolução de data/hora mora em
// `internal/relative-datetime.ts`, com o formatador do horário para o paciente.

/** Test-only: matcher puro exposto p/ cobertura (bug real cardiologia↔cardiológica). */
export const __testing__ = {
  matchesProcedure,
  isSameProcedureName,
  appointmentTimeForPatient,
};

registerTool({
  name: 'prepare_appointment',
  effect: 'mutation',
  description:
    'Prepara uma marcação de atendimento novo de uma vez: resolve o serviço ou procedimento, profissional e horário. Passe procedure_name (omita se a clínica só tiver um) e scheduled_at (omita para o primeiro horário livre). Só PREPARA — o atendimento é criado depois com confirm_pending_action. Se retornar status="patient_registration_required", peça o nome completo para iniciar o cadastro; não encaminhe para humano nem tente agendar neste turno.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    // Cadastro é pré-condição do agendamento. É um estado recuperável da conversa,
    // não uma falha operacional: o resultado orienta o modelo a iniciar a coleta
    // em vez de cair no fallback que promete atendimento humano. Com o sinal
    // ligado, o cadastro é obrigatório mesmo que a clínica permita marcar sem ele.
    const unidentified = !ctx.patientId && !ctx.identityAmbiguous;
    const anonymousAllowed = unidentified && (await anonymousSchedulingAllowed(ctx));
    if (unidentified && !anonymousAllowed) {
      return {
        status: 'patient_registration_required' as const,
        required_fields: REGISTRATION_REQUIRED_FIELDS,
      };
    }

    assertAgentSchedulingIdentity({
      patientId: ctx.patientId,
      identityAmbiguous: ctx.identityAmbiguous,
      canScheduleAnonymous: anonymousAllowed,
    });

    // 1. Resolve o procedimento (server-side; nunca confia num id do LLM).
    const procedures = await schedulingApiV1.listProcedures(ctx.clinicId, { limit: 50 });
    if (procedures.length === 0) {
      return {
        status: 'appointment_information_required' as const,
        patient_message:
          'Não encontrei atendimentos disponíveis para agendamento. Por favor, informe qual serviço deseja marcar.',
      };
    }
    let procedure: (typeof procedures)[number] | undefined;
    const requestedProcedureName = input.procedure_name ?? ctx.pendingAppointmentProcedureName;
    if (requestedProcedureName) {
      const exact = procedures.filter((p) => isSameProcedureName(requestedProcedureName, p));
      const matches =
        exact.length === 1
          ? exact
          : procedures.filter((p) => matchesProcedure(requestedProcedureName, p));
      if (matches.length === 1) procedure = matches[0];
      else if (matches.length === 0) {
        // Sem match mas só há um procedimento → é ele (evita fricção boba).
        if (procedures.length === 1) procedure = procedures[0];
        else {
          return {
            status: 'appointment_information_required' as const,
            patient_message:
              'Não identifiquei o atendimento desejado. Informe o nome do serviço que quer agendar.',
          };
        }
      } else {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'Encontrei mais de um atendimento parecido. Informe o nome completo do serviço que deseja agendar.',
        };
      }
    } else if (procedures.length === 1) {
      procedure = procedures[0];
    } else {
      return {
        status: 'appointment_information_required' as const,
        patient_message: 'Informe qual atendimento ou serviço você deseja agendar.',
      };
    }

    // A condição comercial é decidida pela escolha do paciente e pelo catálogo
    // da clínica. O modelo nunca fornece preço ou identificador de versão.
    const pricingPolicy = await getPaymentPricingPolicy(ctx.clinicId);
    let commercialPrice: {
      paymentMethod: 'pix' | 'credit_card' | 'cash';
      installmentCount: number | null;
      priceId: string;
      grossAmount: number;
    } | null = null;
    if (pricingPolicy.mode === 'payment_method_pricing') {
      const patientChoice = patientPaymentChoice(ctx.currentMessage);
      const configuredPrices = (await listProcedurePaymentPrices(ctx.clinicId)).filter(
        (price) =>
          price.procedureId === procedure!.id &&
          (price.paymentMethod === 'pix' ||
            price.paymentMethod === 'cash' ||
            (price.paymentMethod === 'credit_card' && price.installmentCount === 1)),
      );
      // 08/10/2026 (decisão do usuário) — com sinal, o horário só se confirma
      // com o sinal pago pelo link; o restante pode ser em dinheiro na clínica.
      // "Tudo em dinheiro" só aparece quando NÃO há sinal: a mesma regra do
      // `createDepositCharge`, consultada sem efeito.
      const onlinePrices = configuredPrices.filter((price) => price.paymentMethod !== 'cash');
      const depositApplies =
        (await paymentsApiV1.previewDepositForBooking({
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
          basePrice: onlinePrices[0]?.grossAmount ?? procedure!.valorPadrao ?? 0,
        })) !== null;
      const availablePrices = depositApplies ? onlinePrices : configuredPrices;
      const options = availablePrices
        .map((price) => `${paymentOptionLabel(price.paymentMethod)}: ${moneyForMessage(price.grossAmount)}`)
        .join('; ');
      const depositNote = depositApplies
        ? ' O horário é confirmado com o sinal pago pelo link que enviamos por aqui; o restante pode ser pago na clínica, inclusive em dinheiro.'
        : '';
      if (patientChoice.ambiguous) {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'Você mencionou mais de uma forma de pagamento. Qual delas escolhe para este atendimento?',
        };
      }
      if (!patientChoice.method) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: options
            ? `Como prefere pagar ${procedure!.descricao}? ${options}.${depositNote} Informe uma das opções disponíveis.`
            : 'Não há preço com link de pagamento disponível para este atendimento. Solicite ajuda à clínica.',
        };
      }
      if (patientChoice.method === 'cash' && depositApplies) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: options
            ? `Para confirmar o horário, o sinal é pago pelo link que enviamos por aqui; o restante pode ser pago na clínica, inclusive em dinheiro. Como prefere pagar o sinal? ${options}.`
            : 'Para confirmar o horário, o sinal é pago pelo link, e não há preço com link para este atendimento. Solicite ajuda à clínica.',
        };
      }
      if (patientChoice.method === 'cash' && !configuredPrices.some((price) => price.paymentMethod === 'cash')) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: options
            ? `Não há preço em dinheiro para este atendimento. Escolha uma das opções: ${options}.`
            : 'Não há preço configurado para este atendimento. Solicite ajuda à clínica.',
        };
      }
      if (input.payment_method && input.payment_method !== patientChoice.method) {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'A forma de pagamento informada não corresponde à sua mensagem. Confirme se escolhe Pix, cartão ou dinheiro.',
        };
      }
      if (patientChoice.method === 'pix' && input.installment_count !== undefined) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: 'Pix não tem parcelas. Confirme se deseja pagar via Pix.',
        };
      }
      if (patientChoice.method === 'credit_card' && patientChoice.cardInstallmentsRequested) {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'Ainda não consigo gerar link de cartão parcelado com esse preço. Escolha Pix ou cartão em 1x, se disponíveis.',
        };
      }
      if (patientChoice.method === 'credit_card' && !patientChoice.cardOneTime) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: availablePrices.some((price) => price.paymentMethod === 'credit_card')
            ? 'Para pagar no cartão, responda "cartão em 1x" se desejar pagar à vista. O link de cartão parcelado ainda não está disponível.'
            : 'Não há preço para cartão em 1x neste atendimento. Escolha outra forma de pagamento disponível.',
        };
      }
      if (patientChoice.method === 'cash' && input.installment_count !== undefined) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: 'Dinheiro não tem parcelas. Confirme se deseja pagar em dinheiro na clínica.',
        };
      }
      if (
        patientChoice.method === 'credit_card' &&
        input.installment_count !== undefined &&
        input.installment_count !== 1
      ) {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'A quantidade de parcelas não corresponde à sua mensagem. Confirme "cartão em 1x".',
        };
      }
      const resolved = await resolveConfiguredProcedurePaymentPrice({
        clinicId: ctx.clinicId,
        procedureId: procedure!.id,
        standardGrossAmount: procedure!.valorPadrao,
        paymentMethod: patientChoice.method,
        installmentCount: patientChoice.method === 'credit_card' ? 1 : null,
      });
      if (
        !resolved ||
        resolved.mode !== 'payment_method_pricing' ||
        resolved.source !== 'explicit_method_price' ||
        !resolved.priceId ||
        resolved.paymentMethod !== patientChoice.method ||
        resolved.installmentCount !== (patientChoice.method === 'credit_card' ? 1 : null)
      ) {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'O preço dessa forma de pagamento mudou ou não está disponível. Confirme novamente a forma de pagamento com a clínica.',
        };
      }
      commercialPrice = {
        paymentMethod: patientChoice.method,
        installmentCount: resolved.installmentCount,
        priceId: resolved.priceId,
        grossAmount: resolved.grossAmount,
      };
    }

    // 2. Resolve o horário + médico (server-side, a partir da disponibilidade real).
    const now = new Date();
    let scheduledAt: string;
    let doctorId: string;
    // F-04: quem traduz "sexta de manhã" em instante é o SERVIDOR, ancorado no
    // fuso e no relógio da clínica. O modelo só decide quando o texto não traz
    // marcador de data; e quando o servidor só tem uma janela, um instante do
    // modelo DENTRO dela é aceito.
    const requested = reconcileRequestedTime({
      resolved: resolveRequestedDateTime({
        text: ctx.currentMessage,
        now,
        timeZone: ctx.clinicTimeZone,
        maxDaysAhead: ctx.maxDaysAhead,
      }),
      modelIso: input.scheduled_at,
    });

    // Hora nua sem marcador AM/PM ("às 3" = 03:00 ou 15:00). Quem desempata é a
    // AGENDA CONFIGURADA PELA CLÍNICA, não uma faixa de horário chutada aqui:
    // numa clínica 08–18 o candidato da madrugada não tem slot e morre sozinho;
    // numa que atende à noite, 21:00 é legítimo. Só pergunta quando os DOIS
    // horários existem de verdade — aí a dúvida é real.
    if (requested.mode === 'candidates') {
      const instants = requested.candidatesIso
        .map((iso) => new Date(iso))
        .sort((a, b) => a.getTime() - b.getTime());
      // Uma única consulta cobre os dois candidatos (12h de distância).
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(instants[0]!.getTime() - HOUR_MS),
        to: new Date(instants[instants.length - 1]!.getTime() + HOUR_MS),
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      const viable = requested.candidatesIso
        .map((iso) => ({
          iso,
          slot: slots.find(
            (s) => Math.abs(new Date(s.startAt).getTime() - new Date(iso).getTime()) < 60_000,
          ),
        }))
        .filter((c) => c.slot);

      if (viable.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário não está disponível para esse atendimento. Informe outra data ou horário.',
        };
      }
      if (viable.length > 1) {
        const opcoes = viable
          .map((c) => appointmentTimeForPatient(c.iso, ctx.clinicTimeZone))
          .join(' ou ');
        return {
          status: 'appointment_information_required' as const,
          patient_message: `Só para confirmar: você prefere ${opcoes}?`,
        };
      }
      scheduledAt = viable[0]!.slot!.startAt;
      doctorId = viable[0]!.slot!.doctorId;
    } else if (requested.mode === 'search') {
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(requested.fromIso),
        to: new Date(requested.toIso),
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      if (slots.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Não há horários livres nesse período para esse atendimento. Informe outra data ou horário.',
        };
      }
      scheduledAt = slots[0]!.startAt;
      doctorId = slots[0]!.doctorId;
    } else if (requested.mode === 'instant') {
      const requestedScheduledAt = requested.atIso;
      const at = new Date(requestedScheduledAt);
      if (at.getTime() < now.getTime()) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário já passou. Informe outra data e horário para o atendimento.',
        };
      }
      const latestAllowedAt = now.getTime() + ctx.maxDaysAhead * 86_400_000;
      if (at.getTime() > latestAllowedAt) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Essa data não está disponível para agendamento. Informe outra data e horário.',
        };
      }
      assertAgentSchedulePolicy({
        scheduledAt: requestedScheduledAt,
        now,
        maxDaysAhead: ctx.maxDaysAhead,
      });
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(at.getTime() - HOUR_MS),
        to: new Date(at.getTime() + HOUR_MS),
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      const match = slots.find(
        (s) => Math.abs(new Date(s.startAt).getTime() - at.getTime()) < 60_000,
      );
      if (!match) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário não está disponível para esse atendimento. Informe outra data ou horário.',
        };
      }
      scheduledAt = match.startAt;
      doctorId = match.doctorId;
    } else {
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: now,
        to: new Date(now.getTime() + ctx.maxDaysAhead * 86_400_000),
        // F-03: sem isto, `slots[0]` no caminho "primeiro horário livre" era o
        // primeiro bloco do DIA (08:00), já vencido às 15:00 — a marcação era
        // preparada no passado e só falhava na confirmação.
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      if (slots.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Não há horários disponíveis para esse atendimento nesse período. Informe outra data ou horário.',
        };
      }
      scheduledAt = slots[0]!.startAt;
      doctorId = slots[0]!.doctorId;
    }

    // 08/10/2026 — o resumo diz, com valores, que o horário só se confirma com o
    // sinal pago pelo link e quanto fica para pagar na clínica. Mesma decisão do
    // `createDepositCharge`, sem efeito; dinheiro nunca tem sinal.
    const basePrice = commercialPrice?.grossAmount ?? procedure!.valorPadrao ?? 0;
    const deposit =
      commercialPrice?.paymentMethod === 'cash'
        ? null
        : await paymentsApiV1.previewDepositForBooking({
            clinicId: ctx.clinicId,
            patientId: ctx.patientId,
            basePrice,
            scheduledAt: new Date(scheduledAt),
          });

    // 3. Prepara (mesma trilha do schedule_appointment: pending action + confirmação).
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'schedule_appointment',
        patientId: ctx.patientId,
        doctorId,
        procedureId: procedure!.id,
        scheduledAt,
        ...(commercialPrice ? { commercialPrice } : {}),
        ...(deposit ? { depositAmount: deposit.amount } : {}),
      },
      summary: `Agendar ${procedure!.descricao} para ${appointmentTimeForPatient(
        scheduledAt,
        ctx.clinicTimeZone,
      )}${commercialPrice ? `; valor total ${moneyForMessage(commercialPrice.grossAmount)} ${commercialPriceLabel(commercialPrice.paymentMethod)}` : ''}${
        deposit
          ? `. Para confirmar o horário, o sinal de ${moneyForMessage(deposit.amount)} é pago pelo link que vamos enviar por aqui (o horário fica reservado por até 24 horas). O restante${
              basePrice > deposit.amount
                ? `, ${moneyForMessage(Math.round((basePrice - deposit.amount) * 100) / 100)},`
                : ''
            } pode ser pago na clínica, inclusive em dinheiro.`
          : ''
      }`,
    });
    return {
      status: 'appointment_prepared' as const,
      pending_action_id: pending.id,
      action: pending.action,
      summary: pending.summary,
      expires_at: pending.expiresAt,
      requires_confirmation: true as const,
    };
  },
});
