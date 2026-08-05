'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { ensureUpgradePayment } from '@/contexts/billing/internal/plan-change-payment';
import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import {
  getSubscriptionReactivationContext,
  PlanChangeError,
  reactivateSubscription,
  requestPlanChange,
  requestSubscriptionCancellation,
  revokeSubscriptionCancellation,
} from '@/contexts/billing/internal/plan-changes';

const PlanChangeSchema = z.object({
  targetPlanId: z.string().uuid('Plano inválido.'),
  idempotencyKey: z.string().uuid('Solicitação inválida. Recarregue a página e tente novamente.'),
});

const CancellationSchema = z.object({
  idempotencyKey: z.string().uuid('Solicitação inválida. Recarregue a página e tente novamente.'),
});

export type PlanChangeState = {
  error: string | null;
  success?:
    | 'upgrade_pending_payment'
    | 'downgrade_scheduled'
    | 'cancellation_scheduled'
    | 'cancellation_revoked'
    | 'subscription_reactivated';
  message?: string;
  paymentUrl?: string | null;
};

const INITIAL_ERROR = 'Não foi possível alterar o plano agora. Tente novamente em instantes.';

export async function requestPlanChangeAction(
  _previous: PlanChangeState,
  formData: FormData,
): Promise<PlanChangeState> {
  const parsed = PlanChangeSchema.safeParse({
    targetPlanId: formData.get('targetPlanId'),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const hdrs = await headers();
  const requestContext = buildRequestContext(hdrs);
  const origin = hdrs.get('origin');

  try {
    const change = await idempotentMutation(
      {
        idempotency: {
          key: `billing:plan_change:${parsed.data.idempotencyKey.replace(/-/g, '')}`,
          payload: { targetPlanId: parsed.data.targetPlanId },
          ttlSeconds: 7 * 86_400,
        },
        audit: {
          action: 'subscription.change.requested',
          resourceType: 'subscription_change',
          resourceId: null,
          before: null,
          requestContext,
        },
      },
      (tx) =>
        requestPlanChange(tx, {
          clinicId,
          targetPlanId: parsed.data.targetPlanId,
          requestedBy: user.userId,
          idempotencyKey: parsed.data.idempotencyKey,
          request: { ip: requestContext.ip, origin, requestId: requestContext.requestId },
        }),
    );

    if (change.kind === 'downgrade') {
      revalidatePath('/configuracoes/assinatura');
      return {
        error: null,
        success: 'downgrade_scheduled',
        message: `Downgrade para ${change.targetPlanName} agendado para o fim do ciclo.`,
      };
    }

    try {
      const payment = await ensureUpgradePayment(clinicId, change.id);
      revalidatePath('/configuracoes/assinatura');
      return {
        error: null,
        success: 'upgrade_pending_payment',
        message: 'Cobrança proporcional criada. Confirme o pagamento para liberar o novo plano.',
        paymentUrl: payment.paymentUrl,
      };
    } catch (err) {
      // A solicitação permanece persistida. Novo submit com a mesma chave consulta
      // a externalReference antes de qualquer POST, portanto é seguro retentar.
      if (err instanceof PlanChangeError) return { error: err.message };
      return {
        error: null,
        success: 'upgrade_pending_payment',
        message:
          'Upgrade registrado. A cobrança está sendo conciliada com o Asaas; tente novamente em instantes.',
      };
    }
  } catch (err) {
    if (err instanceof PlanChangeError) return { error: err.message };
    return { error: INITIAL_ERROR };
  }
}

export async function requestSubscriptionCancellationAction(
  _previous: PlanChangeState,
  formData: FormData,
): Promise<PlanChangeState> {
  const parsed = CancellationSchema.safeParse({ idempotencyKey: formData.get('idempotencyKey') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const hdrs = await headers();
  const requestContext = buildRequestContext(hdrs);
  try {
    const cancellation = await idempotentMutation(
      {
        idempotency: {
          key: `billing:cancellation:${parsed.data.idempotencyKey.replace(/-/g, '')}`,
          payload: { action: 'schedule_cancellation' },
          ttlSeconds: 7 * 86_400,
        },
        audit: {
          action: 'subscription.cancellation.requested',
          resourceType: 'subscription_change',
          resourceId: null,
          before: null,
          requestContext,
        },
      },
      (tx) =>
        requestSubscriptionCancellation(tx, {
          clinicId,
          requestedBy: user.userId,
          idempotencyKey: parsed.data.idempotencyKey,
          request: {
            ip: requestContext.ip,
            origin: hdrs.get('origin'),
            requestId: requestContext.requestId,
          },
        }),
    );
    revalidatePath('/configuracoes/assinatura');
    return {
      error: null,
      success: 'cancellation_scheduled',
      message: `Cancelamento agendado para ${new Intl.DateTimeFormat('pt-BR').format(cancellation.effectiveAt)}.`,
    };
  } catch (err) {
    return { error: err instanceof PlanChangeError ? err.message : INITIAL_ERROR };
  }
}

export async function revokeSubscriptionCancellationAction(
  _previous: PlanChangeState,
  formData: FormData,
): Promise<PlanChangeState> {
  const parsed = CancellationSchema.safeParse({ idempotencyKey: formData.get('idempotencyKey') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const hdrs = await headers();
  const requestContext = buildRequestContext(hdrs);
  try {
    await idempotentMutation(
      {
        idempotency: {
          key: `billing:cancellation_revoke:${parsed.data.idempotencyKey.replace(/-/g, '')}`,
          payload: { action: 'revoke_cancellation' },
          ttlSeconds: 7 * 86_400,
        },
        audit: {
          action: 'subscription.cancellation.revoked',
          resourceType: 'subscription_change',
          resourceId: null,
          before: null,
          requestContext,
        },
      },
      (tx) =>
        revokeSubscriptionCancellation(tx, {
          clinicId,
          requestedBy: user.userId,
          idempotencyKey: parsed.data.idempotencyKey,
          request: {
            ip: requestContext.ip,
            origin: hdrs.get('origin'),
            requestId: requestContext.requestId,
          },
        }),
    );
    revalidatePath('/configuracoes/assinatura');
    return {
      error: null,
      success: 'cancellation_revoked',
      message: 'Cancelamento revogado. Sua assinatura seguirá ativa.',
    };
  } catch (err) {
    return { error: err instanceof PlanChangeError ? err.message : INITIAL_ERROR };
  }
}

export async function reactivateSubscriptionAction(
  _previous: PlanChangeState,
  formData: FormData,
): Promise<PlanChangeState> {
  const parsed = CancellationSchema.safeParse({ idempotencyKey: formData.get('idempotencyKey') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const hdrs = await headers();
  const requestContext = buildRequestContext(hdrs);
  const now = new Date();
  try {
    const providerContext = await getSubscriptionReactivationContext(clinicId, now);
    await asaasProvider.updateSubscription(providerContext.asaasSubscriptionId, {
      value: providerContext.value,
      status: 'ACTIVE',
      nextDueDate: providerContext.nextDueDate,
      updatePendingPayments: false,
    });
    await idempotentMutation(
      {
        idempotency: {
          key: `billing:subscription_reactivation:${parsed.data.idempotencyKey.replace(/-/g, '')}`,
          payload: { action: 'reactivate_subscription', nextDueDate: providerContext.nextDueDate },
          ttlSeconds: 7 * 86_400,
        },
        audit: {
          action: 'subscription.reactivated',
          resourceType: 'subscription_reactivation',
          resourceId: null,
          before: null,
          requestContext,
        },
      },
      (tx) => reactivateSubscription(tx, { clinicId, requestedBy: user.userId, now }),
    );
    revalidatePath('/configuracoes/assinatura');
    return {
      error: null,
      success: 'subscription_reactivated',
      message: 'Assinatura reativada. A próxima cobrança foi programada no Asaas.',
    };
  } catch (err) {
    return { error: err instanceof PlanChangeError ? err.message : INITIAL_ERROR };
  }
}
