'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { removeSubscriptionCharges } from '@/contexts/billing/internal/cancellation-charges';
import { reopenClinicAfterReactivation } from '@/contexts/billing/internal/clinic-status';
import { ensureUpgradePayment } from '@/contexts/billing/internal/plan-change-payment';
import { asaasProvider } from '@/lib/payments/asaas';
import { metrics } from '@/lib/observability/metrics';
import {
  getSubscriptionCancellationContext,
  getSubscriptionReactivationContext,
  getSubscriptionRevocationContext,
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

/**
 * Mensagens de quando o lado Asaas não terminou. Nas duas, NADA foi gravado no
 * Qoro, e repetir é seguro: pausar e apagar são idempotentes no Asaas.
 */
const CANCELLATION_INCOMPLETE = {
  in_flight:
    'Há um pagamento com cartão sendo analisado agora e ele não pode ser apagado. Tente cancelar de novo em alguns minutos.',
  provider_unavailable:
    'Não foi possível confirmar no Asaas que todas as cobranças foram apagadas. Tente cancelar de novo em instantes.',
} as const;

/**
 * Datas de ciclo são datas de calendário gravadas como meia-noite UTC — a mesma
 * data do vencimento no Asaas. Formatar no fuso local mostra o dia ANTERIOR no
 * Brasil ("acesso até 09/10" para um ciclo que vai até 10/10).
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

/**
 * Cancelar = parar de cobrar AGORA, e perder o acesso só quando ele acabaria.
 *
 * A ordem é a do resto da saga de billing: remoto antes do local. Primeiro a
 * recorrência é pausada e toda cobrança ainda não paga é apagada no Asaas — com
 * releitura provando que não sobrou nada. Só então o cancelamento é registrado.
 * Se o Asaas falhar no meio, nada é gravado aqui, e a próxima tentativa termina
 * o trabalho do lado de lá.
 *
 * Antes deste desenho, o botão só agendava no banco e o cron pausava a
 * recorrência no dia do vencimento, sem apagar a cobrança já gerada — que era
 * cobrada no mesmo dia.
 */
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
    const context = await getSubscriptionCancellationContext(clinicId);
    const removal = await removeSubscriptionCharges(asaasProvider, {
      asaasSubscriptionId: context.asaasSubscriptionId,
      extraPaymentIds: context.extraPaymentIds,
    });
    if (!removal.ok) return { error: CANCELLATION_INCOMPLETE[removal.reason] };

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
          removedPaymentIds: removal.removedPaymentIds,
          paidPaymentIds: removal.paidPaymentIds,
        }),
    );
    revalidatePath('/configuracoes/assinatura');
    const effectiveAt = new Date(cancellation.effectiveAt);
    const acesso =
      effectiveAt.getTime() > Date.now()
        ? `O acesso continua até ${formatDate(effectiveAt)}.`
        : 'O acesso é encerrado em até um dia.';
    return {
      error: null,
      success: 'cancellation_scheduled',
      message: `Assinatura cancelada. Nenhuma nova cobrança será feita e as cobranças em aberto foram apagadas no Asaas. ${acesso}`,
    };
  } catch (err) {
    return { error: err instanceof PlanChangeError ? err.message : INITIAL_ERROR };
  }
}

/**
 * "Manter assinatura" desfaz um cancelamento que ainda não entrou em vigor.
 *
 * O cancelamento já pausou a recorrência no Asaas. Revogar só no banco deixaria
 * a clínica ativa e o provedor parado — serviço sem cobrança, para sempre. Por
 * isso a recorrência é religada ANTES, com vencimento na data em que o
 * cancelamento valeria; se o Asaas falhar, o cancelamento continua de pé.
 */
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
    const providerContext = await getSubscriptionRevocationContext(clinicId);
    if (providerContext.asaasSubscriptionId) {
      await asaasProvider.updateSubscription(providerContext.asaasSubscriptionId, {
        value: providerContext.value,
        status: 'ACTIVE',
        nextDueDate: providerContext.nextDueDate,
        updatePendingPayments: false,
      });
    }
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
      message: `Cancelamento revogado. A assinatura segue ativa, com a próxima cobrança em ${formatDate(new Date(`${providerContext.nextDueDate}T12:00:00Z`))}.`,
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
    // `clinics` não aceita UPDATE do tenant (RLS casa zero linhas), então o
    // `setClinicAccess` dentro da transação acima não reabre nada. Se esta
    // etapa falhar, o cron diário reabre — a cobrança já foi religada e a
    // clínica não pode ficar paga e bloqueada.
    try {
      await reopenClinicAfterReactivation(clinicId);
    } catch (error) {
      metrics.emit('billing.reactivation.reopen_failed', { clinicId, error });
    }
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
