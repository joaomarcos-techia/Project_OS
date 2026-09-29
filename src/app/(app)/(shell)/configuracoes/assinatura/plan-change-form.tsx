'use client';

import Link from 'next/link';
import { useActionState, useMemo } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { uuidv4 } from '@/lib/ui/uuid';

import {
  requestPlanChangeAction,
  reactivateSubscriptionAction,
  requestSubscriptionCancellationAction,
  revokeSubscriptionCancellationAction,
  type PlanChangeState,
} from './actions';

type Plan = {
  id: string;
  name: string;
  code: string;
  priceAmount: string;
  limits: { users: number; agendamentos: number; ai_messages: number };
};

const INITIAL: PlanChangeState = { error: null };
const RANK: Record<string, number> = { solo: 1, clinica: 2, pro: 3 };

function formatMoney(amount: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(amount),
  );
}

/**
 * Fim de ciclo, fim de teste e vigência de cancelamento são datas de calendário
 * gravadas como meia-noite UTC — a data do vencimento no Asaas. No fuso do
 * navegador brasileiro elas apareciam um dia antes ("ciclo encerra em 09/10"
 * para vencimento em 10/10).
 */
function formatCycleDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(value);
}

function cycleLabel(cycle: 'monthly' | 'annual'): string {
  return cycle === 'annual' ? 'por ano' : 'por mês';
}

/**
 * O que a pessoa precisa saber ANTES de confirmar — o que acontece com o
 * dinheiro e até quando o acesso dura. Cada estado tem uma resposta diferente
 * para a segunda pergunta, e dizer a errada é prometer o que não vai acontecer.
 */
function cancellationDescription(
  status: 'trial' | 'active' | 'past_due' | 'cancelled',
  periodEnd: string | null,
  trialEnd: string | null,
): string {
  const cobrancas =
    'A recorrência para agora e todas as cobranças em aberto no Asaas são apagadas — nenhuma nova será feita.';
  if (status === 'active') {
    return `${cobrancas} ${periodEnd ? `O acesso continua até ${periodEnd}, o fim do período já pago.` : 'O acesso é encerrado em até um dia.'}`;
  }
  if (status === 'trial') {
    return `${cobrancas} ${trialEnd ? `O acesso continua até ${trialEnd}, o fim do período de teste.` : 'O acesso é encerrado em até um dia.'}`;
  }
  return `${cobrancas} Isso inclui as cobranças vencidas. O acesso é encerrado em até um dia.`;
}

export function PlanChangeForm({
  current,
  plans,
  activeUsers,
  pending,
}: {
  current: {
    planId: string;
    planName: string;
    planCode: string;
    priceAmount: string;
    billingCycle: 'monthly' | 'annual';
    billingStatus: 'trial' | 'active' | 'past_due' | 'cancelled';
    periodEnd: string | null;
    trialEndsAt?: string | null;
  };
  plans: Plan[];
  activeUsers: number;
  pending: { kind: string; status: string; effectiveAt: string; paymentUrl: string | null } | null;
}) {
  const [state, formAction, submitting] = useActionState(requestPlanChangeAction, INITIAL);
  const [cancellationState, cancellationAction, cancelling] = useActionState(
    requestSubscriptionCancellationAction,
    INITIAL,
  );
  const [revocationState, revocationAction, revoking] = useActionState(
    revokeSubscriptionCancellationAction,
    INITIAL,
  );
  const [reactivationState, reactivationAction, reactivating] = useActionState(
    reactivateSubscriptionAction,
    INITIAL,
  );
  const keys = useMemo(() => new Map(plans.map((plan) => [plan.id, uuidv4()])), [plans]);
  const cancellationKey = useMemo(() => uuidv4(), []);
  const revocationKey = useMemo(() => uuidv4(), []);
  const reactivationKey = useMemo(() => uuidv4(), []);
  const currentRank = RANK[current.planCode] ?? 0;
  const end = current.periodEnd ? formatCycleDate(new Date(current.periodEnd)) : null;
  const trialEnd = current.trialEndsAt ? formatCycleDate(new Date(current.trialEndsAt)) : null;

  return (
    <div className="flex flex-col gap-(--sp-5)">
      {pending ? (
        <Alert
          variant={pending.status === 'pending_payment' ? 'warning' : 'info'}
          title="Alteração em andamento"
        >
          {pending.status === 'pending_payment'
            ? 'Seu upgrade aguarda a confirmação do pagamento proporcional.'
            : pending.kind === 'cancellation'
              ? `Assinatura cancelada: nenhuma nova cobrança será feita. O acesso segue até ${formatCycleDate(new Date(pending.effectiveAt))}.`
              : `Seu downgrade está agendado para ${formatCycleDate(new Date(pending.effectiveAt))}.`}
          {pending.paymentUrl ? (
            <Link
              className="ml-1 font-semibold underline"
              href={pending.paymentUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir cobrança
            </Link>
          ) : null}
        </Alert>
      ) : null}
      {state.error ||
      cancellationState.error ||
      revocationState.error ||
      reactivationState.error ? (
        <Alert variant="danger">
          {state.error ??
            cancellationState.error ??
            revocationState.error ??
            reactivationState.error}
        </Alert>
      ) : null}
      {state.success ||
      cancellationState.success ||
      revocationState.success ||
      reactivationState.success ? (
        <Alert variant="success">
          {state.message ??
            cancellationState.message ??
            revocationState.message ??
            reactivationState.message}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-(length:--fs-xs) font-medium uppercase tracking-wide text-fg-subtle">
              Plano atual
            </p>
            <h2 className="mt-1 text-(length:--fs-xl) font-semibold">{current.planName}</h2>
            <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
              {formatMoney(current.priceAmount)} {cycleLabel(current.billingCycle)}
              {end ? ` · ciclo encerra em ${end}` : ''}
            </p>
          </div>
          <Badge tone="blue">
            {activeUsers} usuário{activeUsers === 1 ? '' : 's'} ativo{activeUsers === 1 ? '' : 's'}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-(--sp-4) lg:grid-cols-3">
        {plans.map((plan) => {
          const direction = (RANK[plan.code] ?? 0) - currentRank;
          const isCurrent = plan.id === current.planId;
          const isDowngrade = direction < 0;
          const disabled =
            current.billingStatus !== 'active' ||
            isCurrent ||
            Boolean(pending) ||
            submitting ||
            (isDowngrade && activeUsers !== 1);
          const actionLabel = isCurrent
            ? 'Plano atual'
            : isDowngrade
              ? activeUsers === 1
                ? 'Agendar downgrade'
                : 'Requer 1 usuário ativo'
              : 'Fazer upgrade';
          return (
            <Card key={plan.id} className={isCurrent ? 'border-primary shadow-sm' : undefined}>
              <CardContent className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-(length:--fs-lg) font-semibold">{plan.name}</h3>
                    <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
                      {formatMoney(plan.priceAmount)} {cycleLabel(current.billingCycle)}
                    </p>
                  </div>
                  {isCurrent ? <Badge tone="blue">Atual</Badge> : null}
                </div>
                <ul className="flex flex-1 flex-col gap-2 text-(length:--fs-sm) text-fg-muted">
                  <li>
                    {plan.limits.users} usuário{plan.limits.users === 1 ? '' : 's'}
                  </li>
                  <li>{plan.limits.agendamentos} agendamentos/mês monitorados</li>
                  <li>{plan.limits.ai_messages} mensagens IA/mês monitoradas</li>
                </ul>
                <form action={formAction}>
                  <input type="hidden" name="targetPlanId" value={plan.id} />
                  <input type="hidden" name="idempotencyKey" value={keys.get(plan.id) ?? ''} />
                  <Button
                    type="submit"
                    className="w-full"
                    variant={isDowngrade ? 'secondary' : 'primary'}
                    disabled={disabled}
                    loading={submitting}
                  >
                    {actionLabel}
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {current.billingStatus === 'cancelled' ? (
        <form action={reactivationAction}>
          <input type="hidden" name="idempotencyKey" value={reactivationKey} />
          <Button type="submit" variant="primary" loading={reactivating}>
            Reativar assinatura
          </Button>
        </form>
      ) : pending?.kind === 'cancellation' ? (
        <form action={revocationAction}>
          <input type="hidden" name="idempotencyKey" value={revocationKey} />
          <Button type="submit" variant="secondary" loading={revoking}>
            Manter assinatura
          </Button>
        </form>
      ) : (
        /* Cancelar tem de ser SEMPRE possível — em teste, ativa ou inadimplente, e
           mesmo com um upgrade/downgrade pendente (o cancelamento o supera). Antes
           o botão só existia em `active`: quem estava no teste lia que "não há
           assinatura para cancelar" enquanto o Asaas já tinha a primeira cobrança
           marcada para o fim do teste. */
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" loading={cancelling}>
              Cancelar assinatura
            </Button>
          }
          title="Cancelar assinatura"
          description={cancellationDescription(current.billingStatus, end, trialEnd)}
          confirmLabel="Cancelar assinatura"
          cancelLabel="Manter assinatura"
          tone="danger"
          action={cancellationAction}
          loading={cancelling}
          formFields={<input type="hidden" name="idempotencyKey" value={cancellationKey} />}
        />
      )}
      <p className="text-(length:--fs-xs) text-fg-subtle">
        Mensagens de IA, agendamentos e pacientes nunca são removidos nem bloqueiam esta alteração.
        Apenas o limite de usuários é aplicado.
      </p>
    </div>
  );
}
