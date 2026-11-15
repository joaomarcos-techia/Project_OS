'use server';

/**
 * Coparticipação na interface (P5.3; ADR-072 §3): CONFERIR (recepção), CONFIRMAR (quem
 * gerencia o financeiro) e DISPENSAR (com motivo). Só a confirmada com valor cobrável
 * vira recebível do paciente — pelo cobrável, nunca pelo valor do atendimento; o banco
 * recusa qualquer recebível de convênio acima dele.
 *
 * A confirmação publica `health_insurance.copay.confirmed` na mesma transação (outbox);
 * logo depois da resposta o evento é processado (o cron é a reserva), para o recebível e
 * o botão "Gerar link de cobrança" aparecerem sem esperar.
 */
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { HEALTH_INSURANCE_EVENTS } from '@/contexts/health-insurance';
import { CopayStateError, checkCopay, confirmCopay, waiveCopay } from '@/contexts/health-insurance/internal/copay-service';
import { ConveniosModuleDisabledError } from '@/contexts/health-insurance/internal/module-guard';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { AuthError, requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { premiumAccessErrorFrom, premiumDenialMessage } from '@/lib/premium-access';

import { processOutboxSoon } from './outbox-now';

type Result = { ok: true; data: string } | { ok: false; error: string };
const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(9_999_999_999);

function messageOf(error: unknown): string {
  if (error instanceof AuthError) {
    return error.code === 'unauthenticated' ? 'Sua sessão terminou. Entre de novo para continuar.' : 'Seu perfil não tem permissão para esta etapa da coparticipação.';
  }
  const premium = premiumAccessErrorFrom(error);
  if (premium) return premiumDenialMessage(premium.feature, premium.reason);
  if (error instanceof ConveniosModuleDisabledError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Dados inválidos.';
  if (error instanceof CopayStateError) return error.message.charAt(0).toUpperCase() + error.message.slice(1);
  const e = error as { code?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  if (code && ['55000', '23514'].includes(code) && e.cause?.message) return e.cause.message;
  return 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.';
}

async function write(permission: Permission, action: string, copaymentId: string, fn: (tx: Tx, ctx: { clinicId: string; userId: string }) => Promise<Record<string, unknown>>) {
  const user = await requireUser();
  await requireCachedPermission(permission);
  const clinicId = await requireClinicId();
  const rc = await requestContext();
  await withTenant(
    clinicId,
    async (tx) => {
      const after = await fn(tx, { clinicId, userId: user.userId });
      await logAudit(tx, { clinicId, userId: user.userId, action, resourceType: 'hi_copayment', resourceId: copaymentId, before: null, after, requestContext: rc });
    },
    user.userId,
  );
}

export async function checkCopayReviewAction(input: { copaymentId: string; checkedCents: number }): Promise<Result> {
  try {
    const d = z.object({ copaymentId: uuid, checkedCents: cents }).parse(input);
    await write(PERMISSIONS.EDIT_PATIENT, 'health_insurance.copay.checked', d.copaymentId, async (tx, ctx) => {
      await checkCopay(tx, { clinicId: ctx.clinicId, copaymentId: d.copaymentId, checkedCents: d.checkedCents, actorUserId: ctx.userId });
      return { checkedCents: d.checkedCents };
    });
    revalidatePath('/convenios', 'layout');
    return { ok: true, data: 'Coparticipação conferida.' };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function confirmCopayReviewAction(input: { copaymentId: string; confirmedCents: number; chargeableCents: number }): Promise<Result> {
  try {
    const d = z
      .object({ copaymentId: uuid, confirmedCents: cents, chargeableCents: cents })
      .refine((v) => v.chargeableCents <= v.confirmedCents, { message: 'O valor a cobrar não passa do confirmado.' })
      .parse(input);
    let published = false;
    await write(PERMISSIONS.MANAGE_FINANCIAL, 'health_insurance.copay.confirmed', d.copaymentId, async (tx, ctx) => {
      const [ap] = (await tx.execute(
        sql`SELECT coalesce(a.snapshot_procedure_name, 'Atendimento') AS name FROM public.hi_copayments c
              JOIN public.appointments a ON a.id = c.appointment_id AND a.clinic_id = c.clinic_id
             WHERE c.clinic_id = ${ctx.clinicId}::uuid AND c.id = ${d.copaymentId}::uuid`,
      )) as unknown as Array<{ name: string }>;
      const out = await confirmCopay(tx, {
        clinicId: ctx.clinicId,
        copaymentId: d.copaymentId,
        confirmedCents: d.confirmedCents,
        chargeableCents: d.chargeableCents,
        actorUserId: ctx.userId,
        procedureName: ap?.name ?? 'Atendimento',
      });
      published = out.published;
      return { confirmedCents: d.confirmedCents, chargeableCents: d.chargeableCents, receivable: out.published };
    });
    if (published) {
      processOutboxSoon('copay_confirmed', [{ eventType: HEALTH_INSURANCE_EVENTS.COPAY_CONFIRMED, idempotencyKeys: [`copay-confirmed:${d.copaymentId}`] }]);
    }
    revalidatePath('/convenios', 'layout');
    return { ok: true, data: published ? 'Coparticipação confirmada; o valor a cobrar do paciente foi lançado.' : 'Coparticipação confirmada sem valor a cobrar.' };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function waiveCopayReviewAction(input: { copaymentId: string; reason: string }): Promise<Result> {
  try {
    const d = z.object({ copaymentId: uuid, reason: z.string().trim().min(10, 'Informe o motivo (10 a 500 caracteres).').max(500) }).parse(input);
    await write(PERMISSIONS.MANAGE_FINANCIAL, 'health_insurance.copay.waived', d.copaymentId, async (tx, ctx) => {
      // Só antes da confirmação: confirmada já virou (ou vai virar) recebível do paciente.
      const [row] = (await tx.execute(
        sql`SELECT status FROM public.hi_copayments WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.copaymentId}::uuid`,
      )) as unknown as Array<{ status: string }>;
      if (!row) throw new CopayStateError('coparticipação inexistente nesta clínica');
      if (!['estimated', 'calculated', 'checked'].includes(row.status)) {
        throw new CopayStateError(`só se dispensa coparticipação antes da confirmação (estado: ${row.status})`);
      }
      await waiveCopay(tx, { clinicId: ctx.clinicId, copaymentId: d.copaymentId, reason: d.reason });
      return { reason: d.reason };
    });
    revalidatePath('/convenios', 'layout');
    return { ok: true, data: 'Coparticipação dispensada.' };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}
