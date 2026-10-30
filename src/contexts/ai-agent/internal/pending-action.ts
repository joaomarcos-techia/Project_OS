import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
/* eslint-disable boundaries/element-types -- schedulingApiV1 e a política de sinal são as APIs públicas entre contextos. */
import { getDepositPolicy } from '@/contexts/payments';
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { aiPendingActions } from '../schema';
import type { ToolContext } from '../tools/registry';

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;

const PendingActionPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schedule_appointment'),
    patientId: z.string().uuid().nullable(),
    doctorId: z.string().uuid(),
    procedureId: z.string().uuid(),
    scheduledAt: z.string().datetime({ offset: true }),
    commercialPrice: z
      .object({
        paymentMethod: z.enum(['pix', 'credit_card', 'cash']),
        installmentCount: z.number().int().min(1).max(12).nullable(),
        priceId: z.string().uuid(),
        grossAmount: z.number().finite().positive(),
      })
      .strict()
      .refine(
        (price) =>
          price.paymentMethod === 'credit_card'
            ? price.installmentCount === 1
            : price.installmentCount === null,
        { message: 'condição de pagamento inválida para o link disponível' },
      )
      .optional(),
    /**
     * Sinal previsto no resumo (08/10/2026). Só informa a resposta da
     * confirmação; quem decide e cobra continua sendo o Payments, depois.
     */
    depositAmount: z.number().finite().positive().optional(),
  }),
  z.object({
    type: z.literal('confirm_appointment'),
    appointmentId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('cancel_appointment'),
    appointmentId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('reschedule_appointment'),
    appointmentId: z.string().uuid(),
    newScheduledAt: z.string().datetime({ offset: true }),
  }),
]);

export type PendingActionPayload = z.infer<typeof PendingActionPayloadSchema>;
export type PendingActionName = PendingActionPayload['type'];

// Afirma\u00e7\u00e3o forte: a palavra sozinha J\u00c1 \u00e9 consentimento.
const STRONG_AFFIRM = new Set([
  'sim',
  's',
  'ss',
  'confirmo',
  'confirmado',
  'confirmada',
  'confirmar',
  'confirma',
  'autorizo',
  'autorizado',
  'positivo',
  'isso',
  'exato',
  'exatamente',
  'fechado',
  'combinado',
  'pode',
  'podem',
]);

/**
 * Verbos de DESEJO/PEDIDO no início da mensagem. "Quero confirmar minha
 * consulta" é o pedido de INICIAR a confirmação, não o consentimento a um
 * resumo já apresentado — executar aqui pula a etapa que o paciente ainda vai
 * ler. O infinitivo depois do verbo de desejo é o que separa "quero confirmar"
 * de "confirmo".
 */
const REQUEST_PREFIXES = [
  'quero',
  'queria',
  'gostaria',
  'posso',
  'poderia',
  'preciso',
  'pode me',
  'consigo',
];

// Concord\u00e2ncia fraca: confirma s\u00f3 quando a mensagem \u00e9 CURTA e n\u00e3o \u00e9 despedida.
// "blz" responde a um resumo; "ok obrigado" costuma ser encerramento.
const WEAK_AFFIRM = new Set([
  'ok',
  'okay',
  'okey',
  'blz',
  'beleza',
  'certo',
  'ta',
  'claro',
  'entendi',
  'aham',
  'uhum',
  'perfeito',
  'otimo',
  'show',
  'bora',
  'vamos',
  'bom',
]);

// Ru\u00eddo que n\u00e3o muda o sentido.
const FILLER = new Set([
  'o',
  'a',
  'os',
  'as',
  'esse',
  'essa',
  'este',
  'esta',
  'mesmo',
  'mesma',
  'tudo',
  'entao',
  'ai',
  'por',
  'favor',
  'pf',
  'ja',
  'la',
  'pra',
  'para',
  'e',
  'de',
  'do',
  'da',
  'com',
  'meu',
  'minha',
  'quero',
  'consulta',
  'atendimento',
  'horario',
  'presenca',
]);

// Despedidas: sozinhas (ou com concord\u00e2ncia fraca) N\u00c3O s\u00e3o consentimento.
const CLOSING = new Set(['obrigado', 'obrigada', 'obg', 'brigado', 'valeu', 'vlw', 'grato']);

// Nega\u00e7\u00e3o, hesita\u00e7\u00e3o ou contraste \u2014 vetam mesmo junto de um "sim".
const REJECT_WORDS = new Set([
  'nao',
  'n',
  'nunca',
  'mas',
  'porem',
  'contudo',
  'talvez',
  'acho',
  'quase',
  'depois',
  'espera',
  'aguarde',
  'aguarda',
  'pera',
  'se',
  'caso',
  'prefiro',
  'outro',
  'outra',
  'antes',
  'ainda',
  'nem',
]);

/** Frases curtas que s\u00f3 significam algo inteiras. */
const AFFIRM_PHRASES = new Set([
  'ta bom',
  'ta certo',
  'tudo bem',
  'tudo certo',
  'pode ser',
  'isso mesmo',
  'esse mesmo',
  'por mim ok',
  'ta otimo',
  'pode sim',
  'sim pode',
]);

/**
 * Verbos/substantivos de A\u00c7\u00c3O e a a\u00e7\u00e3o pendente com que combinam. Serve para o
 * caso "pode cancelar" respondido a um resumo de AGENDAMENTO: \u00e9 afirmativo na
 * forma, mas pede outra coisa \u2014 executar seria confirmar o que o paciente n\u00e3o leu.
 */
const ACTION_WORDS: ReadonlyArray<{ words: readonly string[]; action: PendingActionName }> = [
  {
    words: ['agendar', 'agende', 'agendamento', 'marcar', 'marque', 'marca', 'marcacao'],
    action: 'schedule_appointment',
  },
  {
    words: ['cancelar', 'cancele', 'cancela', 'cancelamento', 'desmarcar', 'desmarque'],
    action: 'cancel_appointment',
  },
  {
    words: ['reagendar', 'remarcar', 'reagendamento', 'remarcacao', 'mudar', 'trocar'],
    action: 'reschedule_appointment',
  },
];

function normalizeConfirmation(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1') // simmm \u2192 sim, blzzz \u2192 blz
    .trim();
}

export type ConfirmationVerdict = {
  confirmed: boolean;
  /** Motivo can\u00f4nico \u2014 vai para m\u00e9trica e permite ajustar o l\u00e9xico com dados. */
  reason:
    | 'strong'
    | 'weak_short'
    | 'phrase'
    | 'question'
    | 'empty'
    | 'hedge'
    | 'request_not_consent'
    | 'not_affirmation_only'
    | 'weak_too_long'
    | 'closing'
    | 'contradicting_verb';
};

/**
 * Confirma\u00e7\u00e3o expl\u00edcita server-side \u2014 o gate anti-execu\u00e7\u00e3o-sem-consentimento.
 *
 * REGRA (F-07, auditoria 2026-08-14): a mensagem tem de ser **s\u00f3 afirma\u00e7\u00e3o**.
 * Todo token precisa ser afirma\u00e7\u00e3o, a\u00e7\u00e3o compat\u00edvel ou ru\u00eddo; qualquer palavra
 * fora disso derruba a confirma\u00e7\u00e3o.
 *
 * O gate anterior bastava encontrar UMA palavra afirmativa em qualquer lugar, e
 * errava nos dois sentidos:
 *   - confirmava "ok e qual o endere\u00e7o" e "ok vou ver e te falo" (o paciente
 *     estava adiando, e a consulta era criada);
 *   - recusava "blz", "ss", "ta bom", "beleza", "fechado" \u2014 as respostas mais
 *     comuns do WhatsApp brasileiro, deixando o paciente sem conseguir confirmar.
 *
 * `expected` liga a checagem de verbo contradit\u00f3rio: "pode cancelar" n\u00e3o confirma
 * um agendamento preparado. Sem `expected`, qualquer verbo de a\u00e7\u00e3o \u00e9 aceito.
 */
export function classifyConfirmation(
  message: string,
  expected?: PendingActionName,
): ConfirmationVerdict {
  if (/\?\s*$/.test(message.trim())) return { confirmed: false, reason: 'question' };
  const normalized = normalizeConfirmation(message);
  if (normalized.length === 0) return { confirmed: false, reason: 'empty' };

  const words = normalized.split(' ').filter(Boolean);
  if (words.some((w) => REJECT_WORDS.has(w))) return { confirmed: false, reason: 'hedge' };
  if (REQUEST_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p} `))) {
    return { confirmed: false, reason: 'request_not_consent' };
  }

  if (AFFIRM_PHRASES.has(normalized)) return { confirmed: true, reason: 'phrase' };

  // Verbo de a\u00e7\u00e3o que contradiz o que est\u00e1 preparado.
  if (expected) {
    for (const { words: group, action } of ACTION_WORDS) {
      if (action !== expected && group.some((w) => words.includes(w))) {
        return { confirmed: false, reason: 'contradicting_verb' };
      }
    }
  }

  const actionWords = new Set(ACTION_WORDS.flatMap((g) => g.words));
  let strong = 0;
  let weak = 0;
  let closing = 0;
  for (const w of words) {
    if (STRONG_AFFIRM.has(w)) strong += 1;
    else if (WEAK_AFFIRM.has(w)) weak += 1;
    else if (CLOSING.has(w)) closing += 1;
    else if (!FILLER.has(w) && !actionWords.has(w)) {
      // Uma palavra desconhecida significa que a mensagem diz OUTRA coisa al\u00e9m
      // de concordar \u2014 \u00e9 exatamente o caso "ok e qual o endere\u00e7o".
      return { confirmed: false, reason: 'not_affirmation_only' };
    }
  }

  if (strong > 0) return { confirmed: true, reason: 'strong' };
  if (weak === 0) return { confirmed: false, reason: 'not_affirmation_only' };
  if (closing > 0) return { confirmed: false, reason: 'closing' };
  if (words.length > 2) return { confirmed: false, reason: 'weak_too_long' };
  return { confirmed: true, reason: 'weak_short' };
}

export function isExplicitConfirmation(message: string, expected?: PendingActionName): boolean {
  return classifyConfirmation(message, expected).confirmed;
}

export function assertAgentSchedulePolicy(args: {
  scheduledAt: string;
  now: Date;
  maxDaysAhead: number;
}): void {
  const scheduledAt = new Date(args.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('data de agendamento inválida');
  const latest = args.now.getTime() + args.maxDaysAhead * 86_400_000;
  if (scheduledAt.getTime() > latest) {
    throw new Error(`agendamento excede o limite de ${args.maxDaysAhead} dias da clínica`);
  }
}

export function assertAgentSchedulingIdentity(args: {
  patientId: string | null;
  identityAmbiguous: boolean;
  canScheduleAnonymous: boolean;
}): void {
  if (args.identityAmbiguous) {
    throw new Error('telefone associado a mais de um paciente; requer desambiguação humana');
  }
  if (!args.patientId && !args.canScheduleAnonymous) {
    throw new Error('paciente não identificado: cadastre/identifique antes de agendar');
  }
}

/**
 * O agente pode marcar para um contato SEM cadastro?
 *
 * Só quando a clínica permite E o sinal está desligado ("com o sinal ligado
 * exige o cadastro", decisão de 08/10/2026). O sinal é cobrado de um paciente
 * com CPF; com a política ligada, a marcação anônima virava consulta sem sinal,
 * em silêncio — a falha que a política existe para evitar. Lida no instante da
 * decisão (preparar e confirmar), porque a clínica pode ligar o sinal no meio
 * da conversa.
 */
export async function anonymousSchedulingAllowed(
  ctx: Pick<ToolContext, 'clinicId' | 'canScheduleAnonymous'>,
): Promise<boolean> {
  if (!ctx.canScheduleAnonymous) return false;
  const deposit = await getDepositPolicy(ctx.clinicId);
  return !deposit.enabled;
}

/**
 * A confirmação vale para QUEM preparou e para o estado de AGORA.
 *
 * O resumo foi preparado num turno anterior; entre ele e o "SIM" o telefone pode
 * ter passado a casar com outro cadastro (ou com nenhum), a consulta pode ter
 * mudado de paciente e a política de sinal pode ter sido ligada. O servidor
 * re-checa tudo isso aqui, sem depender do que o modelo decidiu.
 */
async function assertPendingActionStillValid(
  ctx: ToolContext,
  payload: PendingActionPayload,
): Promise<void> {
  if (ctx.identityAmbiguous) {
    throw new Error('telefone associado a mais de um paciente; requer desambiguação humana');
  }
  if (payload.type === 'schedule_appointment') {
    if (payload.patientId !== ctx.patientId) {
      throw new Error('a identidade do contato mudou desde a preparação; prepare novamente');
    }
    if (!payload.patientId && !(await anonymousSchedulingAllowed(ctx))) {
      throw new Error('paciente não identificado: cadastre/identifique antes de agendar');
    }
    return;
  }
  const appointment = await schedulingApiV1.lookupAppointment(ctx.clinicId, payload.appointmentId);
  if (!appointment || !ctx.patientId || appointment.patientId !== ctx.patientId) {
    throw new Error('consulta não pertence ao paciente verificado');
  }
}

export function parsePendingActionPayload(value: unknown): PendingActionPayload {
  return PendingActionPayloadSchema.parse(value);
}

/**
 * R1 (emenda F-05 — auditoria 2026-08-14) — chave de idempotência da EXECUÇÃO:
 * conversa + LINHA de ação pendente + tipo + args.
 *
 * A versão original era só por CONTEÚDO, deliberadamente ignorando o
 * `pendingActionId`, para que "preparar→confirmar duas vezes com os mesmos
 * argumentos" colapsasse numa consulta só. O efeito colateral era grave: com TTL
 * de 7 dias em `idempotency_keys`, episódios DIFERENTES colidiam. Agendar 15/08
 * 09:00 → cancelar → pedir o MESMO horário devolvia a resposta CACHEADA (a
 * consulta já cancelada) sem criar nada, e o agente anunciava sucesso de uma
 * consulta que não existe.
 *
 * Incluir a linha pendente separa episódios sem perder nenhuma proteção — as
 * outras quatro camadas já cobriam duplicidade e continuam valendo:
 *   1. retry do MESMO turno reusa a MESMA linha → mesma chave → colapsa;
 *   2. duplo "SIM" → `SELECT … FOR UPDATE` + `UPDATE … WHERE status='pending'`
 *      (consumo atômico) + índice parcial `ai_pending_actions_conversation_pending_uniq`;
 *   3. reentrega de webhook → replay da row 'out' (nem chega às tools);
 *   4. mesmo slot por duas preparações distintas → `appointments_doctor_slot_uniq`
 *      + `appointments_patient_slot_uniq` (0053) + `appointments_no_overlap` (0015).
 */
export function pendingActionIdemKey(
  conversationId: string,
  pendingActionId: string,
  payload: PendingActionPayload,
): string {
  return agentIdemKey(conversationId, payload.type, { pendingActionId, ...payload });
}

export async function proposePendingAction<T extends PendingActionPayload>(
  tx: Tx,
  args: {
    clinicId: string;
    conversationId: string;
    eventId: string;
    payload: T;
    summary: string;
    now?: Date;
  },
): Promise<{ id: string; action: T['type']; summary: string; expiresAt: string }> {
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS);
  const payloadEncrypted = await encryptForTenant(args.clinicId, JSON.stringify(args.payload));

  await tx
    .update(aiPendingActions)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(aiPendingActions.clinicId, args.clinicId),
        eq(aiPendingActions.conversationId, args.conversationId),
        eq(aiPendingActions.status, 'pending'),
      ),
    );

  const [row] = await tx
    .insert(aiPendingActions)
    .values({
      clinicId: args.clinicId,
      conversationId: args.conversationId,
      actionName: args.payload.type,
      payloadEncrypted,
      summary: args.summary,
      sourceEventId: args.eventId,
      expiresAt,
    })
    .returning({ id: aiPendingActions.id });
  if (!row) throw new Error('não foi possível preparar a ação para confirmação');

  return {
    id: row.id,
    action: args.payload.type,
    summary: args.summary,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Ação preparada e ainda não confirmada nesta conversa (F-11).
 *
 * Existe para que `confirm_appointment` não "roube" um SIM: se há um resumo de
 * agendamento na tela do paciente, a resposta afirmativa pertence a ELE, não a
 * uma confirmação de presença em outra consulta.
 */
export async function findPendingActionSummary(
  tx: Tx,
  clinicId: string,
  conversationId: string,
): Promise<{ id: string; actionName: PendingActionName; summary: string } | null> {
  const [row] = await tx
    .select({
      id: aiPendingActions.id,
      actionName: aiPendingActions.actionName,
      summary: aiPendingActions.summary,
      expiresAt: aiPendingActions.expiresAt,
    })
    .from(aiPendingActions)
    .where(
      and(
        eq(aiPendingActions.clinicId, clinicId),
        eq(aiPendingActions.conversationId, conversationId),
        eq(aiPendingActions.status, 'pending'),
      ),
    )
    .orderBy(desc(aiPendingActions.createdAt))
    .limit(1);
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return {
    id: row.id,
    actionName: row.actionName as PendingActionName,
    summary: row.summary,
  };
}

export interface PendingActionExecutionResult {
  pendingActionId: string;
  action: PendingActionName;
  appointmentId: string;
  status: string;
  scheduledAt?: string;
  /** Sinal previsto quando o agendamento foi preparado (só `schedule_appointment`). */
  depositAmount?: number;
}

export async function executePendingAction(
  ctx: ToolContext,
): Promise<PendingActionExecutionResult> {
  const [row] = await ctx.tx
    .select()
    .from(aiPendingActions)
    .where(
      and(
        eq(aiPendingActions.clinicId, ctx.clinicId),
        eq(aiPendingActions.conversationId, ctx.conversationId),
        eq(aiPendingActions.status, 'pending'),
      ),
    )
    .orderBy(desc(aiPendingActions.createdAt))
    .limit(1)
    .for('update');

  if (!row) throw new Error('não há ação pendente para confirmar');
  // F-07: a checagem de consentimento roda DEPOIS da leitura sob lock, porque
  // agora ela depende de QUAL ação está preparada — "pode cancelar" não confirma
  // um agendamento. A ordem também melhora a mensagem de erro: quando não há
  // pendência, o motivo é a ausência dela, não a forma da resposta.
  const verdict = classifyConfirmation(ctx.currentMessage, row.actionName as PendingActionName);
  if (!verdict.confirmed) {
    metrics.emit('ai_agent.confirmation.rejected', {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      aiRequestId: ctx.aiRequestId,
      action: row.actionName,
      reason: verdict.reason,
    });
    throw new Error('a mensagem do paciente não é uma confirmação explícita');
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await ctx.tx
      .update(aiPendingActions)
      .set({ status: 'expired' })
      .where(and(eq(aiPendingActions.id, row.id), eq(aiPendingActions.clinicId, ctx.clinicId)));
    throw new Error('a confirmação expirou; peça um novo resumo da ação');
  }

  const payload = parsePendingActionPayload(
    JSON.parse(await decryptForTenant(ctx.clinicId, row.payloadEncrypted)) as unknown,
  );
  if (payload.type !== row.actionName) throw new Error('ação pendente inconsistente');
  // Pendências criadas antes da retirada da política não podem cobrar um preço
  // que já não é oferecido. O paciente deve receber um novo resumo.
  if (payload.type === 'schedule_appointment' && payload.commercialPrice) {
    throw new Error('a condição comercial anterior foi encerrada; peça um novo agendamento');
  }
  await assertPendingActionStillValid(ctx, payload);

  const actor = {
    clinicId: ctx.clinicId,
    eventId: ctx.eventId,
    aiRequestId: ctx.aiRequestId,
  };
  // Ancorada na LINHA pendente (F-05): retry do mesmo turno colapsa; um episódio
  // novo com os mesmos argumentos NÃO colide com a resposta cacheada do anterior.
  const idempotencyKey = pendingActionIdemKey(ctx.conversationId, row.id, payload);

  let appointment: Awaited<ReturnType<typeof schedulingApiV1.lookupAppointment>>;
  if (payload.type === 'schedule_appointment') {
    appointment = await schedulingApiV1.scheduleAsAgent(
      actor,
      {
        doctorId: payload.doctorId,
        procedureId: payload.procedureId,
        patientId: payload.patientId,
        scheduledAt: payload.scheduledAt,
      },
      idempotencyKey,
    );
  } else if (payload.type === 'confirm_appointment') {
    appointment = await schedulingApiV1.confirmAsAgent(
      actor,
      payload.appointmentId,
      idempotencyKey,
    );
  } else if (payload.type === 'cancel_appointment') {
    appointment = await schedulingApiV1.cancelAsAgent(
      actor,
      payload.appointmentId,
      idempotencyKey,
      payload.reason,
    );
  } else {
    appointment = await schedulingApiV1.rescheduleAsAgent(
      actor,
      payload.appointmentId,
      { newScheduledAt: payload.newScheduledAt },
      idempotencyKey,
    );
  }
  if (!appointment) throw new Error('ação confirmada sem consulta resultante');

  await ctx.tx
    .update(aiPendingActions)
    .set({
      status: 'executed',
      confirmationEventId: ctx.eventId,
      executedAt: sql`now()`,
    })
    .where(
      and(
        eq(aiPendingActions.id, row.id),
        eq(aiPendingActions.clinicId, ctx.clinicId),
        eq(aiPendingActions.status, 'pending'),
      ),
    );

  return {
    pendingActionId: row.id,
    action: payload.type,
    appointmentId: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    ...(payload.type === 'schedule_appointment' && payload.depositAmount
      ? { depositAmount: payload.depositAmount }
      : {}),
  };
}
