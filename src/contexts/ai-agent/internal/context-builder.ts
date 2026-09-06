/**
 * Context Builder (C11) — produz DADOS estruturados (PromptContext), nunca
 * prompt (a prompt layer monta o texto). Contexto 100% derivado do tx
 * tenant-scoped — isolamento por construção.
 *
 * Lazy context (review G3): NÃO consulta scheduling (slots/procedures). As
 * tools buscam os próprios dados sob demanda — toda conversa deixava de pagar
 * 2 consultas que talvez nunca fossem usadas. `listSlots` volta na C12 com a
 * tool list_slots.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { MAX_CONTEXT_MESSAGES } from '../limits';
import { truncateInbound } from '../prompts/system';
import { aiClinicConfig } from '../schema';
import type { PatientRegistrationState, PromptContext, StoredCollect } from '../types';
import { getCollectedData, getRecentMessages } from './conversation';

const DEFAULT_TZ = 'America/Sao_Paulo';

const REGISTRATION_FIELDS = ['nome', 'cpf', 'motivo'] as const;

/** Data/hora operacional que ancora "hoje" e "amanhã" no prompt do agente. */
function formatClinicDateTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`could not resolve timezone ${timeZone}`);
    return part;
  };
  return `${value('day')}/${value('month')}/${value('year')} às ${value('hour')}:${value('minute')}`;
}

/**
 * Resume a coleta para o modelo sem inserir PII no prompt de sistema.
 * O modelo recebe apenas o próximo passo; os valores permanecem cifrados na
 * conversa e não atravessam esta fronteira.
 */
export function patientRegistrationState(
  patient: { id: string; nome: string } | null,
  collected: StoredCollect | null,
): PatientRegistrationState {
  if (patient) return { status: 'registered', missingFields: [], nextRequiredField: null };

  // Um contato desconhecido não é, por si só, um cadastro iniciado. A coleta
  // começa apenas depois de prepare_appointment informar que ela é necessária.
  if (!collected) {
    return { status: 'not_started', missingFields: [], nextRequiredField: null };
  }

  const missingFields = REGISTRATION_FIELDS.filter((field) => !collected?.[field]);
  if (missingFields.length > 0) {
    return {
      status: 'collecting',
      missingFields,
      nextRequiredField: missingFields[0]!,
    };
  }
  return { status: 'awaiting_confirmation', missingFields: [], nextRequiredField: null };
}

export async function buildContext(
  tx: Tx,
  args: {
    clinicId: string;
    conversationId: string;
    currentMessage: string;
    patient: { id: string; nome: string } | null;
    /** Turno corrente (eventId) — excluído da janela p/ não duplicar no prompt. */
    excludeEventId?: string;
  },
): Promise<PromptContext> {
  // Clínica: single-table read da fundação tenancy (precedente financial:96-100).
  const clinicRows = await tx.execute<{
    nome: string;
    endereco: string | null;
    timezone: string | null;
  }>(sql`SELECT nome, endereco, timezone FROM clinics WHERE id = ${args.clinicId} LIMIT 1`);
  const clinic = clinicRows[0];
  if (!clinic) throw new Error('[ai-agent] clínica não encontrada no contexto tenant');

  // Config do agente — defaults seguros quando a clínica ainda não configurou.
  const [config] = await tx
    .select()
    .from(aiClinicConfig)
    .where(eq(aiClinicConfig.clinicId, args.clinicId))
    .limit(1);

  const history = await getRecentMessages(
    tx,
    args.clinicId,
    args.conversationId,
    MAX_CONTEXT_MESSAGES,
    args.excludeEventId,
  );
  const collected = await getCollectedData(tx, args.clinicId, args.conversationId);
  const timeZone = clinic.timezone ?? DEFAULT_TZ;

  return {
    clinic: {
      id: args.clinicId,
      nome: clinic.nome,
      endereco: clinic.endereco ?? null,
      timezone: timeZone,
    },
    currentDateTime: formatClinicDateTime(new Date(), timeZone),
    aiConfig: {
      workingHours: config?.workingHours ?? null,
      especialidades: config?.especialidades ?? null,
      convenios: config?.convenios ?? [],
      canScheduleAnonymous: config?.canScheduleAnonymous ?? false,
      maxDaysAhead: config?.maxDaysAhead ?? 30,
      canDisclosePayments: config?.canDisclosePaymentsViaAgent ?? false,
    },
    patient: args.patient,
    patientRegistration: patientRegistrationState(args.patient, collected),
    pendingAppointmentProcedureName:
      args.patient && collected?._pendingProcedureName ? collected._pendingProcedureName : null,
    history,
    currentMessage: truncateInbound(args.currentMessage),
  };
}

export const __testing__ = { patientRegistrationState, formatClinicDateTime };
