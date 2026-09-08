/**
 * `pnpm wa:send-template` — envia UM template proativo real p/ testar a
 * integração Meta (C14). Reusa o MESMO buildProactiveTemplate do processor, então
 * prova: nome do template resolvido do ENV + ordem das variáveis + a Meta aceitar.
 *
 * Pré: template APROVADO na Meta + META_TEMPLATE_*_ID no .env.local + número da
 * clínica conectado (`pnpm wa:connect`). Envia via messagingApiV1 (suppression +
 * dedup aplicam). NÃO toca ai_proactive_jobs — é um envio isolado de smoke.
 *
 *   pnpm wa:send-template --clinic <uuid> --to <e164> --type reminder|dunning|followup|no_show_followup
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { messagingApiV1 } from '@/contexts/messaging';

import type {
  DunningPayload,
  FollowupPayload,
  NoShowFollowupPayload,
  ReminderPayload,
} from '@/contexts/ai-agent/proactive-jobs/domain/types';
import { getClinicTimezone } from '@/contexts/ai-agent/proactive-jobs/infra/repository';
import { buildProactiveTemplate } from '@/contexts/ai-agent/proactive-jobs/infra/templates';

type SmokeTemplateType = 'reminder' | 'dunning' | 'followup' | 'no_show_followup';
const SMOKE_TEMPLATE_TYPES: readonly SmokeTemplateType[] = [
  'reminder',
  'dunning',
  'followup',
  'no_show_followup',
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function samplePayload(
  type: SmokeTemplateType,
): ReminderPayload | DunningPayload | FollowupPayload | NoShowFollowupPayload {
  const today = new Date().toISOString().slice(0, 10);
  if (type === 'reminder') {
    return {
      patientId: randomUUID(),
      appointmentId: randomUUID(),
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      doctorNome: 'Dra. Ana',
    };
  }
  if (type === 'dunning') {
    return {
      patientId: randomUUID(),
      lancamentoId: randomUUID(),
      stage: 3,
      valor: 200,
      dueDate: today,
      procedureNome: 'Consulta',
    };
  }
  if (type === 'no_show_followup') {
    return {
      patientId: randomUUID(),
      appointmentId: randomUUID(),
      noShowAt: new Date().toISOString(),
    };
  }
  return {
    patientId: randomUUID(),
    prontuarioId: randomUUID(),
    doctorNome: 'Dra. Ana',
    returnDate: today,
  };
}

async function main(): Promise<void> {
  assertDevContext();
  const clinicId = arg('clinic');
  const to = arg('to');
  const requestedType = arg('type') ?? 'reminder';

  if (!clinicId || !to || !SMOKE_TEMPLATE_TYPES.includes(requestedType as SmokeTemplateType)) {
    console.error(
      'uso: pnpm wa:send-template --clinic <uuid> --to <e164> --type reminder|dunning|followup|no_show_followup',
    );
    process.exit(1);
  }
  const type = requestedType as SmokeTemplateType;

  const tz = await getClinicTimezone(clinicId);
  const t = buildProactiveTemplate(type, samplePayload(type), 'João Teste', tz);
  console.log(
    `[wa:send-template] template="${t.templateName}" lang=${t.languageCode} vars=${JSON.stringify(t.variables)}`,
  );

  const res = await messagingApiV1.sendText({
    clinicId,
    toNumber: to,
    idempotencyKey: randomUUID(),
    body: {
      kind: 'template',
      templateName: t.templateName,
      languageCode: t.languageCode,
      variables: t.variables,
    },
  });
  console.log(
    `[wa:send-template] status=${res.status} providerMessageId=${res.providerMessageId ?? '-'} deduped=${res.deduped}`,
  );
  process.exit(res.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('[wa:send-template] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
