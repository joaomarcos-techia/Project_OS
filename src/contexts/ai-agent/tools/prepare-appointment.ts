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
 *
 * P11 (28/11/2026) — convênio: com `insurer_name`, o servidor resolve a operadora
 * ATIVA da clínica pelo nome dito (nunca por id do modelo), o plano, a carteirinha
 * que a recepção já cadastrou (só o id; o número nunca vem da conversa), o tipo de
 * guia e a autorização pelos contratos vigentes, e confere a escolha como a agenda
 * da recepção (`checkSchedulingChoice`). Convênio não tem sinal nem link de
 * pagamento; o resumo só avisa que a recepção confere a carteirinha (e o aval da
 * operadora, quando o contrato exige). Clínica sem o módulo: "é com a recepção".
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14), mesma exceção das outras tools de agenda. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */
/* eslint-disable-next-line boundaries/element-types -- política de sinal usa a API pública de Payments. */
import { paymentsApiV1 } from '@/contexts/payments';
/* eslint-disable boundaries/element-types -- superfície pública do Convênios (P11), mesma exceção das APIs acima. */
import {
  AGENT_INSURANCE_TEXT,
  agentChoiceVerdict,
  agentInsuranceOptions,
  checkSchedulingChoice,
  getSchedulingInsuranceOptions,
  insurerNotRecognizedReply,
  insurerOrPrivateReply,
  listPatientCardsForScheduling,
  patientInsuranceIntent,
  pickAgentMembership,
  planNotRecognizedReply,
  plansSaidByPatient,
  resolveInsurerFromPatientText,
  resolvePlanFromPatientText,
  schedulingTermsForProcedure,
  type SchedulingInsuranceChoice,
} from '@/contexts/health-insurance';
/* eslint-enable boundaries/element-types */
import { metrics } from '@/lib/observability/metrics';

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
import { registerTool, type ToolContext } from './registry';

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
  insurer_name: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Só quando o paciente quiser marcar PELO CONVÊNIO: o nome da operadora que ele disse (ex.: "Unimed"). Omita para particular. Nunca peça o número da carteirinha.',
    ),
  plan_name: z
    .string()
    .max(120)
    .optional()
    .describe('Plano do convênio, se o paciente disser. Omita se ele não souber.'),
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

/** De onde veio cada parte da escolha (gravado na ação preparada e na métrica do agendamento). */
type InsuranceSource = {
  insurer: 'patient_text';
  plan: 'patient_text' | 'single_active' | 'card' | 'none';
};

/** Falas do paciente, em ordem, terminando no turno. */
const patientTexts = (ctx: Pick<ToolContext, 'currentMessage' | 'recentPatientTexts'>) => [
  ...(ctx.recentPatientTexts ?? []),
  ctx.currentMessage,
];

type AgentInsurance =
  | {
      ok: true;
      choice: SchedulingInsuranceChoice;
      insurerName: string;
      planName: string | null;
      notices: string[];
      source: InsuranceSource;
    }
  | {
      ok: false;
      output:
        | { status: 'appointment_unavailable'; patient_message: string }
        | { status: 'appointment_information_required'; patient_message: string };
    };

/**
 * P11 — resolve e confere a escolha de convênio no servidor. Leituras pela superfície
 * pública do Convênios (transações próprias, por clínica); falha ao consultar =
 * fail-closed com a frase segura, sem criar nada.
 */
async function resolveAgentInsurance(
  ctx: Pick<ToolContext, 'clinicId' | 'aiRequestId' | 'currentMessage' | 'recentPatientTexts'>,
  patientId: string,
  procedureId: string,
  insurerName: string,
  planName: string | undefined,
): Promise<AgentInsurance> {
  const unavailable = (patient_message: string): AgentInsurance => ({
    ok: false,
    output: { status: 'appointment_unavailable', patient_message },
  });
  const ask = (patient_message: string): AgentInsurance => ({
    ok: false,
    output: { status: 'appointment_information_required', patient_message },
  });
  try {
    const options = agentInsuranceOptions(await getSchedulingInsuranceOptions(ctx.clinicId));
    if (options.kind === 'not_available') return unavailable(options.reply);
    const insurer = resolveInsurerFromPatientText(options, insurerName);
    if (insurer.kind !== 'match') {
      return ask(insurerNotRecognizedReply(options, insurer.kind === 'ambiguous'));
    }
    // A operadora precisa ter sido dita pelo PACIENTE (no turno ou nas últimas falas dele), e por último: o nome que
    // só o modelo propôs, ou um "particular" dito depois, não vira convênio. Nada é preparado; o agente pergunta.
    const texts = patientTexts(ctx);
    const intent = patientInsuranceIntent(options, texts);
    if (intent.kind !== 'insurer' || !intent.insurers.some((i) => i.id === insurer.insurer.id)) {
      metrics.emit('ai_agent.insurance.not_declared', {
        clinicId: ctx.clinicId,
        aiRequestId: ctx.aiRequestId,
        intent: intent.kind,
      });
      return ask(
        intent.kind === 'insurer' || intent.kind === 'unclear'
          ? insurerOrPrivateReply(intent.insurers)
          : AGENT_INSURANCE_TEXT.insurerNotDeclared,
      );
    }
    const fromArg = resolvePlanFromPatientText(options, insurer.insurer.id, planName);
    if (fromArg === undefined) return ask(planNotRecognizedReply(options, insurer.insurer.id));
    // Plano proposto pelo modelo e não escrito pelo paciente não vale: fica o único ativo, ou a carteirinha/recepção.
    const planSaid =
      fromArg !== null &&
      plansSaidByPatient(options, insurer.insurer.id, texts).some((p) => p.id === fromArg.id);
    const plan =
      planName?.trim() && !planSaid
        ? resolvePlanFromPatientText(options, insurer.insurer.id, undefined)
        : fromArg;
    const card = pickAgentMembership(
      await listPatientCardsForScheduling(ctx.clinicId, patientId),
      insurer.insurer.id,
      plan?.id ?? null,
    );
    const planId = plan?.id ?? card?.planId ?? null;
    const source: InsuranceSource = {
      insurer: 'patient_text',
      plan: plan
        ? planName?.trim() && planSaid
          ? 'patient_text'
          : 'single_active'
        : card?.planId
          ? 'card'
          : 'none',
    };
    const terms = await schedulingTermsForProcedure(ctx.clinicId, {
      insurerId: insurer.insurer.id,
      planId,
      procedureId,
    });
    const choice: SchedulingInsuranceChoice = {
      insurerId: insurer.insurer.id,
      planId,
      membershipId: card?.membershipId ?? null,
      guideType: terms.guideType,
    };
    const verdict = agentChoiceVerdict({
      refusal: await checkSchedulingChoice(ctx.clinicId, patientId, choice),
      requiresAuthorization: terms.requiresAuthorization,
    });
    if (!verdict.allowed) {
      // O motivo técnico é da recepção (métrica), nunca do paciente.
      metrics.emit('ai_agent.insurance.refused', {
        clinicId: ctx.clinicId,
        aiRequestId: ctx.aiRequestId,
        reason: verdict.internalReason,
      });
      return unavailable(verdict.reply);
    }
    const planLabel =
      planId === null
        ? null
        : (options.insurers
            .find((i) => i.id === insurer.insurer.id)
            ?.plans.find((p) => p.id === planId)?.name ?? null);
    return {
      ok: true,
      choice,
      insurerName: insurer.insurer.name,
      planName: planLabel,
      notices: verdict.notices,
      source,
    };
  } catch {
    metrics.emit('ai_agent.insurance.check_failed', {
      clinicId: ctx.clinicId,
      aiRequestId: ctx.aiRequestId,
      tool: 'prepare_appointment',
    });
    return unavailable(AGENT_INSURANCE_TEXT.unavailable);
  }
}

/**
 * P11 — o inverso: a marcação veio SEM convênio, mas o paciente citou por último uma operadora ativa da clínica (sem
 * "particular" depois). Pergunta antes (nada preparado), para o "SIM" não confirmar um particular com sinal que ele
 * não pediu. Com o módulo ligado, o resumo do particular diz "como particular". Só com as falas do turno real
 * (`recentPatientTexts`): numa chamada direta da ferramenta, o particular segue exatamente como antes. Falha ao
 * consultar = o particular segue como antes (a guarda não derruba o fluxo que já existia).
 */
async function privateBookingCheck(
  ctx: Pick<ToolContext, 'clinicId' | 'aiRequestId' | 'currentMessage' | 'recentPatientTexts'>,
): Promise<{ kind: 'unchanged' } | { kind: 'private_label' } | { kind: 'ask'; reply: string }> {
  if (!ctx.recentPatientTexts) return { kind: 'unchanged' };
  try {
    const options = agentInsuranceOptions(await getSchedulingInsuranceOptions(ctx.clinicId));
    if (options.kind !== 'options') return { kind: 'unchanged' };
    const intent = patientInsuranceIntent(options, patientTexts(ctx));
    if (intent.kind === 'insurer' || intent.kind === 'unclear') {
      metrics.emit('ai_agent.insurance.dropped_by_model', {
        clinicId: ctx.clinicId,
        aiRequestId: ctx.aiRequestId,
        intent: intent.kind,
      });
      return { kind: 'ask', reply: insurerOrPrivateReply(intent.insurers) };
    }
    return { kind: 'private_label' };
  } catch {
    metrics.emit('ai_agent.insurance.check_failed', {
      clinicId: ctx.clinicId,
      aiRequestId: ctx.aiRequestId,
      tool: 'prepare_appointment',
      stage: 'private',
    });
    return { kind: 'unchanged' };
  }
}

const HOUR_MS = 60 * 60 * 1000;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moneyForMessage = (value: number): string => money.format(value).replace(/\u00a0/g, ' ');

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
    'Prepara uma marcação de atendimento novo de uma vez: resolve o serviço ou procedimento, profissional e horário. Passe procedure_name (omita se a clínica só tiver um) e scheduled_at (omita para o primeiro horário livre). Para marcar pelo convênio, passe insurer_name com o nome que o PACIENTE disse (e plan_name, se ele disser); nunca sugira convênio nem plano. Só PREPARA — o atendimento é criado depois com confirm_pending_action. Se retornar status="patient_registration_required", peça o nome completo para iniciar o cadastro; não encaminhe para humano nem tente agendar neste turno.',
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

    // P11 — convênio é do PACIENTE cadastrado (a cobertura e a carteirinha são dele):
    // sem cadastro, o cadastro vem antes, mesmo que a clínica marque particular sem ele.
    const insurerName = input.insurer_name?.trim() || null;
    if (insurerName && !ctx.patientId) {
      return {
        status: 'patient_registration_required' as const,
        required_fields: REGISTRATION_REQUIRED_FIELDS,
      };
    }

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

    // P11 — a escolha de convênio é conferida antes de procurar horário (falha cedo,
    // sem resumo): operadora inativa, de outra clínica ou módulo desligado = nada preparado.
    let insurance: Extract<AgentInsurance, { ok: true }> | null = null;
    if (insurerName && ctx.patientId) {
      const resolved = await resolveAgentInsurance(
        ctx,
        ctx.patientId,
        procedure!.id,
        insurerName,
        input.plan_name,
      );
      if (!resolved.ok) return resolved.output;
      insurance = resolved;
    }
    let privateLabel = false;
    if (!insurance && ctx.patientId) {
      const check = await privateBookingCheck(ctx);
      if (check.kind === 'ask') {
        return {
          status: 'appointment_information_required' as const,
          patient_message: check.reply,
        };
      }
      privateLabel = check.kind === 'private_label';
    }

    // Retorno = o paciente já tem outro agendamento (mesma leitura do Payments ao
    // cobrar). Só é consultado se a política de sinal estiver ligada, e uma vez.
    let returnVisit: Promise<boolean> | undefined;
    const isReturnVisit = (): Promise<boolean> =>
      (returnVisit ??= ctx.patientId
        ? schedulingApiV1
            .listPatientAppointments(ctx.clinicId, ctx.patientId, 1)
            .then((appointments) => appointments.length > 0)
        : Promise.resolve(false));

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
    const basePrice = procedure!.valorPadrao ?? 0;
    // P11 — convênio não tem sinal nem link de pagamento (o banco também recusa
    // recebível de convênio além da coparticipação confirmada).
    const deposit = insurance
      ? null
      : await paymentsApiV1.previewDepositForBooking({
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
          basePrice,
          isReturnVisit,
          scheduledAt: new Date(scheduledAt),
        });
    const when = appointmentTimeForPatient(scheduledAt, ctx.clinicTimeZone);

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
        ...(deposit ? { depositAmount: deposit.amount } : {}),
        ...(insurance ? { insurance: insurance.choice, insuranceSource: insurance.source } : {}),
      },
      summary: insurance
        ? `Agendar ${procedure!.descricao} para ${when} pelo convênio ${insurance.insurerName}${
            insurance.planName ? ` (plano ${insurance.planName})` : ''
          }. ${insurance.notices.join(' ')}`
        : `Agendar ${procedure!.descricao} para ${when}${privateLabel ? ' como particular' : ''}${
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
