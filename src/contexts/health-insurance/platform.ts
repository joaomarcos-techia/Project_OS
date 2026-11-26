import 'server-only';

/**
 * P1.13 — contrato de PLATAFORMA do módulo de Convênios (consumido pelo console do super admin,
 * frente do PR #57; este módulo não cria tela nem rota administrativa).
 *
 *   - Disponibilidade comercial: flag global `convenios.available` em `platform_settings`, desligada
 *     por padrão (D8: sem plano fixo). Sem ela, nenhuma clínica é ligada pela plataforma.
 *   - Interruptor por clínica: `hi_clinic_settings.enabled` (nasce false; 0144). Ligar e desligar
 *     só pelo super admin com AAL2 (`superAdminAction`, registro em `super_admin_actions`) e com a
 *     trilha da PRÓPRIA clínica (`audit_events`), com o motivo. Ligar exige assinatura que inclua
 *     Convênios (D24): o serviço confere e o gatilho `hi_aa_premium_settings` (0151) confere de novo.
 *   - Desligado: a classe A é recusada no serviço e no banco (0164); o agendamento fica só
 *     particular (0148). Ligar uma clínica não toca outra.
 *
 * Leitura mínima: id, nome e situação da clínica, estado do módulo e o motivo comercial (código),
 * nada de paciente, guia, valor ou credencial. As transações privilegiadas são as do
 * `superAdminAction` (auditoria das leituras privilegiadas, §5).
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAudit } from '@/lib/audit/log';
import { superAdminAction } from '@/lib/audit/super-admin';
import type { RequestContext } from '@/lib/audit/types';
import { requireSuperAdmin, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { getPlatformSetting } from '@/lib/platform-settings';

/** Chave da disponibilidade comercial (o console a acrescenta à lista de flags dele, como booleano). */
export const CONVENIOS_AVAILABILITY_KEY = 'convenios.available';

export type ConveniosPlatformErrorCode = 'unavailable' | 'commercial' | 'not_found' | 'invalid';
export class ConveniosPlatformError extends Error {
  constructor(
    message: string,
    readonly code: ConveniosPlatformErrorCode,
  ) {
    super(message);
    this.name = 'ConveniosPlatformError';
  }
}

/** Só `true` literal libera: ausência, erro de leitura ou valor estranho mantêm desligado. */
export async function isConveniosAvailableOnPlatform(): Promise<boolean> {
  return (await getPlatformSetting<unknown>(CONVENIOS_AVAILABILITY_KEY, false)) === true;
}

export interface ConveniosModuleState {
  clinicId: string;
  clinicName: string;
  clinicStatus: string;
  /** A clínica já tem a configuração de Convênios (ligada ou não). */
  installed: boolean;
  enabled: boolean;
  enabledAt: string | null;
  /** Motivo comercial (D24) que impede ligar ou operar; null = assinatura inclui Convênios. */
  commercialDenial: string | null;
}

const ListInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  afterClinicId: z.string().uuid().nullable().default(null),
});

/** Página da lista (ordem por id da clínica; `afterClinicId` continua de onde parou). */
export async function listConveniosModuleStatesTx(
  tx: Tx,
  input: z.input<typeof ListInput>,
): Promise<ConveniosModuleState[]> {
  const d = ListInput.parse(input);
  const rows = (await tx.execute(sql`
    SELECT c.id::text AS id, c.nome, c.status::text AS status,
           s.clinic_id IS NOT NULL AS installed, coalesce(s.enabled, false) AS enabled,
           s.enabled_at::text AS enabled_at,
           public.qoro_premium_denial_for(c.id, 'health_insurance') AS denial
      FROM public.clinics c
      LEFT JOIN public.hi_clinic_settings s ON s.clinic_id = c.id
     WHERE (${d.afterClinicId}::uuid IS NULL OR c.id > ${d.afterClinicId}::uuid)
     ORDER BY c.id
     LIMIT ${d.limit}`)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    clinicId: String(r.id),
    clinicName: String(r.nome ?? ''),
    clinicStatus: String(r.status ?? ''),
    installed: Boolean(r.installed),
    enabled: Boolean(r.enabled),
    enabledAt: r.enabled_at ? String(r.enabled_at) : null,
    commercialDenial: r.denial ? String(r.denial) : null,
  }));
}

const SetInput = z.object({
  clinicId: z.string().uuid(),
  enabled: z.boolean(),
  reason: z.string().trim().min(5, 'Informe o motivo (5 caracteres ou mais).').max(300),
});
export type SetConveniosModuleInput = z.input<typeof SetInput>;
export interface SetConveniosModuleResult {
  clinicId: string;
  enabled: boolean;
  /** false = já estava assim (nada gravado, nenhuma trilha nova). */
  changed: boolean;
}

/**
 * Liga ou desliga o módulo de UMA clínica, na transação do chamador (privilegiada). Idempotente:
 * pedir o estado atual não grava nada. A disponibilidade comercial é conferida pelo chamador
 * (`setConveniosModuleForClinic`), porque a flag é lida fora da transação.
 */
export async function setConveniosModuleTx(
  tx: Tx,
  input: SetConveniosModuleInput & { actorUserId: string; requestContext: RequestContext },
): Promise<SetConveniosModuleResult> {
  const d = SetInput.parse(input);
  const [clinic] = (await tx.execute(
    sql`SELECT id FROM public.clinics WHERE id = ${d.clinicId}::uuid FOR UPDATE`,
  )) as unknown as unknown[];
  if (!clinic) throw new ConveniosPlatformError('Clínica não encontrada.', 'not_found');
  const [current] = (await tx.execute(sql`
    SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${d.clinicId}::uuid FOR UPDATE`)) as unknown as Array<{
    enabled: boolean;
  }>;
  const before = Boolean(current?.enabled);
  if (before === d.enabled) return { clinicId: d.clinicId, enabled: before, changed: false };
  if (d.enabled) {
    const [denial] = (await tx.execute(sql`
      SELECT public.qoro_premium_denial_for(${d.clinicId}::uuid, 'health_insurance') AS reason`)) as unknown as Array<{
      reason: string | null;
    }>;
    if (denial?.reason) {
      throw new ConveniosPlatformError(
        'A assinatura desta clínica não inclui Convênios agora (avaliação, assinatura parada ou cancelada).',
        'commercial',
      );
    }
    await tx.execute(sql`
      INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by)
      VALUES (${d.clinicId}::uuid, true, now(), ${input.actorUserId}::uuid)
      ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, enabled_at = now(), enabled_by = EXCLUDED.enabled_by`);
  } else {
    await tx.execute(
      sql`UPDATE public.hi_clinic_settings SET enabled = false WHERE clinic_id = ${d.clinicId}::uuid`,
    );
  }
  // Trilha da própria clínica (o dono e a gestão veem quem ligou ou desligou, quando e por quê).
  await logAudit(tx, {
    clinicId: d.clinicId,
    userId: input.actorUserId,
    action: d.enabled
      ? 'health_insurance.module.enabled_by_platform'
      : 'health_insurance.module.disabled_by_platform',
    resourceType: 'hi_clinic_settings',
    resourceId: d.clinicId,
    before: { enabled: before },
    after: { enabled: d.enabled, reason: d.reason },
    requestContext: input.requestContext,
  });
  return { clinicId: d.clinicId, enabled: d.enabled, changed: true };
}

/**
 * Ponto de entrada do console: super admin com AAL2, disponibilidade comercial para LIGAR, registro
 * em `super_admin_actions` e trilha da clínica, tudo numa transação. Erros conhecidos saem como
 * `ConveniosPlatformError` (mensagem para a tela, sem detalhe interno).
 */
export async function setConveniosModuleForClinic(
  input: SetConveniosModuleInput,
  requestContext: RequestContext,
): Promise<SetConveniosModuleResult> {
  await requireSuperAdmin();
  const parsed = SetInput.safeParse(input);
  if (!parsed.success)
    throw new ConveniosPlatformError(
      parsed.error.issues[0]?.message ?? 'Dados inválidos.',
      'invalid',
    );
  const d = parsed.data;
  if (d.enabled && !(await isConveniosAvailableOnPlatform())) {
    throw new ConveniosPlatformError(
      'Convênios ainda não está disponível comercialmente na plataforma.',
      'unavailable',
    );
  }
  const user = await requireUser();
  return superAdminAction(
    {
      action: d.enabled ? 'health_insurance.module.enable' : 'health_insurance.module.disable',
      targetClinicId: d.clinicId,
      payload: { enabled: d.enabled, reason: d.reason },
      requestContext,
    },
    (tx) => setConveniosModuleTx(tx, { ...d, actorUserId: user.userId, requestContext }),
  );
}

/** Estado de UMA clínica (detalhe no console). `null` = clínica inexistente. */
export async function readConveniosModuleStateTx(
  tx: Tx,
  clinicId: string,
): Promise<ConveniosModuleState | null> {
  const id = z.string().uuid().parse(clinicId);
  const [r] = (await tx.execute(sql`
    SELECT c.id::text AS id, c.nome, c.status::text AS status,
           s.clinic_id IS NOT NULL AS installed, coalesce(s.enabled, false) AS enabled,
           s.enabled_at::text AS enabled_at,
           public.qoro_premium_denial_for(c.id, 'health_insurance') AS denial
      FROM public.clinics c
      LEFT JOIN public.hi_clinic_settings s ON s.clinic_id = c.id
     WHERE c.id = ${id}::uuid`)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;
  return {
    clinicId: String(r.id),
    clinicName: String(r.nome ?? ''),
    clinicStatus: String(r.status ?? ''),
    installed: Boolean(r.installed),
    enabled: Boolean(r.enabled),
    enabledAt: r.enabled_at ? String(r.enabled_at) : null,
    commercialDenial: r.denial ? String(r.denial) : null,
  };
}

/** P1.13 — detalhe da clínica no console (super admin com AAL2; a leitura fica em `super_admin_actions`). */
export async function readConveniosModuleState(
  clinicId: string,
  requestContext: RequestContext,
): Promise<{ available: boolean; clinic: ConveniosModuleState | null }> {
  await requireSuperAdmin();
  const available = await isConveniosAvailableOnPlatform();
  const clinic = await superAdminAction(
    {
      action: 'health_insurance.module.state_read',
      targetClinicId: clinicId,
      payload: { clinicId },
      requestContext,
    },
    (tx) => readConveniosModuleStateTx(tx, clinicId),
  );
  return { available, clinic };
}

/** Lista para o console (super admin com AAL2; a leitura também fica em `super_admin_actions`). */
export async function listConveniosModuleStates(
  input: z.input<typeof ListInput>,
  requestContext: RequestContext,
): Promise<{ available: boolean; clinics: ConveniosModuleState[] }> {
  await requireSuperAdmin();
  const available = await isConveniosAvailableOnPlatform();
  const clinics = await superAdminAction(
    {
      action: 'health_insurance.module.states_read',
      targetClinicId: null,
      payload: ListInput.parse(input),
      requestContext,
    },
    (tx) => listConveniosModuleStatesTx(tx, input),
  );
  return { available, clinics };
}
