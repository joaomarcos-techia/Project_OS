'use server';

/**
 * RBAC-001 — capacidade REAL de `manage:agent`.
 *
 * O code existia no catálogo e no diálogo de permissões, mas nenhuma página ou
 * action o consumia. Ao mesmo tempo, `ai_clinic_config` já governa o
 * COMPORTAMENTO do agente — a tool `provide_clinic_info` e o context-builder o
 * leem a cada turno — e era escrito uma única vez pela saga de onboarding, com
 * defaults, sem nenhuma forma de a clínica ajustá-lo.
 *
 * Por que NÃO é `manage:settings`: aquela permissão governa a identidade e as
 * integrações da clínica (perfil, CNPJ, conexão WhatsApp). Esta governa o que o
 * agente pode FAZER e DIZER em nome da clínica — inclusive
 * `canDisclosePaymentsViaAgent`, que é decisão de privacidade (ADR-023: telefone
 * é fator, não prova de identidade). São capacidades distintas e a delegação de
 * uma não implica a outra. Aliasar seria justamente o que o achado proíbe.
 */
import { eq, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { withTenant } from '@/lib/db/tenant';

import {
  AGENT_CONFIG_DEFAULTS,
  EMPTY_OPERATIONAL_INFO,
  AgentConfigSchema,
  type AgentConfigDTO,
  type AgentConfigInput,
  type AgentConfigResult,
} from './config-types';
import { aiClinicConfig } from './schema';

/**
 * Leitura da configuração do agente. Gateada em `manage:agent` (cached): quem
 * não administra o agente não precisa ver como ele está configurado.
 */
export async function getAgentConfig(): Promise<AgentConfigDTO> {
  await requireUser();
  const clinicId = await requireClinicId();
  const [row] = await withTenant(clinicId, (tx) =>
    tx.select().from(aiClinicConfig).where(eq(aiClinicConfig.clinicId, clinicId)).limit(1),
  );
  if (!row) return { ...AGENT_CONFIG_DEFAULTS, updatedAt: null };
  return {
    canScheduleAnonymous: row.canScheduleAnonymous,
    maxDaysAhead: row.maxDaysAhead,
    canDisclosePaymentsViaAgent: row.canDisclosePaymentsViaAgent,
    especialidades: row.especialidades ?? [],
    convenios: row.convenios,
    operationalInfo: { ...EMPTY_OPERATIONAL_INFO, ...row.operationalInfo },
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

/**
 * Grava a configuração do agente.
 *
 * `requireFreshPermission` (não cached) de propósito: mudar o que o agente pode
 * divulgar sobre cobranças é ação sensível, e um JWT antigo não pode continuar
 * autorizando depois de a permissão ser revogada.
 *
 * `clinicId` vem do request. O upsert é por `clinic_id` (PK) — não há como
 * escrever a configuração de outro tenant nem criar linha órfã.
 */
export async function updateAgentConfig(input: AgentConfigInput): Promise<AgentConfigResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AGENT);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const parsed = AgentConfigSchema.safeParse(input);
  if (!parsed.success) {
    // OBS-002 — entrada inválida é resultado controlado, não 500.
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }
  const data = parsed.data;

  const saved = await withTenant(clinicId, async (tx) => {
    const [before] = await tx
      .select()
      .from(aiClinicConfig)
      .where(eq(aiClinicConfig.clinicId, clinicId))
      .limit(1);

    const operationalInfo =
      data.operationalInfo ?? before?.operationalInfo ?? EMPTY_OPERATIONAL_INFO;

    const [row] = await tx
      .insert(aiClinicConfig)
      .values({
        clinicId,
        canScheduleAnonymous: data.canScheduleAnonymous,
        maxDaysAhead: data.maxDaysAhead,
        canDisclosePaymentsViaAgent: data.canDisclosePaymentsViaAgent,
        especialidades: data.especialidades,
        convenios: data.convenios,
        operationalInfo,
      })
      .onConflictDoUpdate({
        target: aiClinicConfig.clinicId,
        set: {
          canScheduleAnonymous: data.canScheduleAnonymous,
          maxDaysAhead: data.maxDaysAhead,
          canDisclosePaymentsViaAgent: data.canDisclosePaymentsViaAgent,
          especialidades: data.especialidades,
          convenios: data.convenios,
          operationalInfo,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // Mudança de comportamento do agente é decisão administrativa: fica na
    // trilha, com o estado anterior, na MESMA transação ("no audit, no op").
    await logAudit(tx, {
      clinicId,
      userId: user.userId,
      action: 'ai_agent.config.updated',
      resourceType: 'ai_clinic_config',
      resourceId: clinicId,
      before: before
        ? {
            canScheduleAnonymous: before.canScheduleAnonymous,
            maxDaysAhead: before.maxDaysAhead,
            canDisclosePaymentsViaAgent: before.canDisclosePaymentsViaAgent,
            especialidades: before.especialidades ?? [],
            convenios: before.convenios,
            operationalInfo: before.operationalInfo,
          }
        : null,
      after: { ...data, operationalInfo },
      requestContext: ctx,
    });
    return row!;
  });

  return {
    ok: true,
    data: {
      canScheduleAnonymous: saved.canScheduleAnonymous,
      maxDaysAhead: saved.maxDaysAhead,
      canDisclosePaymentsViaAgent: saved.canDisclosePaymentsViaAgent,
      especialidades: saved.especialidades ?? [],
      convenios: saved.convenios,
      operationalInfo: { ...EMPTY_OPERATIONAL_INFO, ...saved.operationalInfo },
      updatedAt: saved.updatedAt?.toISOString() ?? null,
    },
  };
}
