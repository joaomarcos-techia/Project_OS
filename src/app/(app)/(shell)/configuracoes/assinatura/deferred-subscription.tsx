'use client';

import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Props {
  planName: string;
  amountMinor: number;
  trialEndsAt: string;
  trialActive: boolean;
  paid: boolean;
  billingStatus: 'trial' | 'active' | 'past_due' | 'cancelled';
  paidPeriodActive: boolean;
  activationPending?: boolean;
  checkoutAvailable?: boolean;
  managementAvailable?: boolean;
  contractId?: string | null;
  accessUntil?: string | null;
  cancellationState?: 'none' | 'requested' | 'confirmed';
  canRecontract?: boolean;
  recontractOptions?: { id: string; name: string; code: string; amountMinor: number }[];
  recontractPendingPlanId?: string | null;
  planChanges?: {
    amountChangeBlocked?: boolean;
    options: { id: string; name: string; code: string; amountMinor: number }[];
    pending: { planId: string; confirmed: boolean; effectiveNotBefore: string } | null;
  } | null;
}

export function DeferredSubscription(props: Props) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState('');
  const recontractPlan = props.recontractPendingPlanId ?? targetPlan;
  const cancelled = props.cancellationState === 'confirmed';
  async function schedulePlan() {
    if (busy.current || !targetPlan || !props.contractId) return;
    busy.current = true;
    setLoading(true);
    setMessage(null);
    try {
      const result = await fetch('/api/billing/plan-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: props.contractId, targetPlanId: targetPlan }),
      });
      const body: unknown = await result.json();
      if (
        result.ok &&
        typeof body === 'object' &&
        body !== null &&
        'state' in body &&
        body.state === 'scheduled'
      ) {
        window.location.reload();
        return;
      }
      const code = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
      setMessage(
        code === 'downgrade_capacity_exceeded'
          ? 'A equipe ativa excede o plano escolhido. Ajuste os médicos e administrativos antes de solicitar a redução.'
          : 'A alteração ainda não foi confirmada. Atualize esta página antes de tentar novamente; a solicitação anterior será preservada.',
      );
    } catch {
      setMessage(
        'A conexão foi interrompida. Atualize a página antes de tentar novamente; não há cobrança proporcional nesta alteração.',
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  const accessUntil = props.accessUntil
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(props.accessUntil))
    : null;
  async function cancelRenewal() {
    if (busy.current || !props.contractId) return;
    busy.current = true;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/billing/cancellation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: props.contractId }),
      });
      const body: unknown = await response.json();
      if (
        response.ok &&
        typeof body === 'object' &&
        body !== null &&
        'state' in body &&
        body.state === 'renewal_cancelled'
      ) {
        window.location.reload();
        return;
      }
      setMessage(
        'Ainda não foi possível confirmar o cancelamento da renovação. Verifique novamente nesta página antes de considerar a cobrança encerrada.',
      );
    } catch {
      setMessage(
        'A conexão foi interrompida. Verifique o cancelamento nesta página; a solicitação anterior será preservada.',
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  async function checkout(targetPlanId?: string) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetPlanId ? { targetPlanId } : {}),
      });
      const body: unknown = await response.json();
      if (
        response.ok &&
        typeof body === 'object' &&
        body !== null &&
        'state' in body &&
        body.state === 'checkout_pending' &&
        'checkoutUrl' in body &&
        typeof body.checkoutUrl === 'string'
      ) {
        const url = new URL(body.checkoutUrl);
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          ['app.abacatepay.com', 'pay.abacatepay.com'].includes(url.hostname)
        ) {
          window.location.assign(url.toString());
          return;
        }
      }
      const code = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
      if (code === 'already_paid') {
        window.location.reload();
        return;
      }
      setMessage(
        code === 'reconcile_required'
          ? 'Já existe uma tentativa em confirmação. Não crie outra cobrança; atualize esta página em alguns minutos.'
          : 'Não foi possível abrir a contratação agora. Nenhuma liberação foi aplicada. Tente novamente em instantes.',
      );
    } catch {
      setMessage(
        'A conexão foi interrompida. Atualize a página antes de tentar novamente; a tentativa anterior será preservada.',
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Assinatura e avaliação">
      <h2 className="text-lg font-semibold">{props.planName}</h2>
      <p>
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
          props.amountMinor / 100,
        )}
        /mês
      </p>
      {cancelled ? (
        <Alert
          variant="info"
          title={props.canRecontract ? 'Assinatura encerrada' : 'Renovação cancelada'}
        >
          {props.canRecontract
            ? 'O período pago terminou. Seus dados foram preservados. Para retomar o uso, faça uma nova contratação e aguarde a confirmação do pagamento. Não haverá uma nova avaliação gratuita.'
            : `Seu acesso permanece até ${accessUntil} (Brasília). O cancelamento da renovação é definitivo. Uma nova contratação ficará disponível após esse prazo, sem estorno automático.`}
        </Alert>
      ) : props.cancellationState === 'requested' ? (
        <Alert variant="warning" title="Cancelamento em verificação">
          Sua solicitação foi registrada, mas a interrupção da renovação ainda não foi confirmada.
          Verifique novamente abaixo.
        </Alert>
      ) : props.paid && props.paidPeriodActive ? (
        <Alert variant="success" title="Pagamento confirmado">
          As restrições temporárias da avaliação foram removidas. Os limites do seu plano continuam
          valendo. Cada módulo depende das permissões e da sua disponibilidade operacional.
        </Alert>
      ) : props.paid ? (
        <Alert variant="warning" title="Renovação em verificação">
          O período pago terminou. Estamos verificando a renovação; não faça outra assinatura. Se a
          situação persistir, fale com o suporte.
        </Alert>
      ) : props.activationPending ? (
        <Alert variant="info" title="Pagamento em verificação">
          Recebemos uma notificação do provedor e estamos conferindo o pagamento para liberar seu
          plano. Não pague novamente. Você pode atualizar a confirmação abaixo; se a situação
          persistir, fale com o suporte.
        </Alert>
      ) : (
        <Alert
          variant="info"
          title={props.trialActive ? 'Avaliação sem cartão' : 'Contratação pendente'}
        >
          A avaliação termina em{' '}
          {new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(props.trialEndsAt))}{' '}
          (Brasília).{' '}
          {props.trialActive
            ? 'Você pode conhecer o sistema sem cartão ou contratar agora. Cobranças de pacientes, convênios e agentes de IA exigem pagamento confirmado, plano e módulo disponíveis. Ao contratar, o período pago começa na contratação confirmada, sem aguardar o fim da avaliação.'
            : 'Após concluir o checkout, aguarde a confirmação do pagamento. Se já pagou, não faça outra assinatura. A escrita e as integrações serão liberadas após essa confirmação.'}
        </Alert>
      )}
      {props.activationPending && !props.paid ? (
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          Atualizar confirmação
        </Button>
      ) : null}
      {!props.paid && !props.activationPending && props.checkoutAvailable === false ? (
        <Alert variant="info" title="Contratação temporariamente indisponível">
          Novas contratações estão pausadas. Seus dados e tentativas anteriores foram preservados.
        </Alert>
      ) : null}
      {!props.paid &&
      !props.activationPending &&
      props.checkoutAvailable !== false &&
      props.billingStatus !== 'cancelled' ? (
        <Button type="button" loading={loading} onClick={() => void checkout()}>
          Contratar assinatura
        </Button>
      ) : null}
      {props.canRecontract && props.checkoutAvailable !== false ? (
        props.recontractOptions?.length ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h3 className="font-semibold">
              {props.recontractPendingPlanId
                ? 'Contratação em andamento'
                : 'Escolha seu próximo plano'}
            </h3>
            <p className="text-sm text-fg-muted">
              {props.recontractPendingPlanId
                ? 'Já existe um checkout para este plano. Continue o mesmo pagamento; não inicie outra contratação.'
                : 'A renovação anterior foi encerrada. A nova mensalidade começa quando o pagamento deste checkout for confirmado. Seu plano e suas cotas só mudam após essa confirmação.'}
            </p>
            <label htmlFor="recontract-plan" className="block text-sm font-medium">
              Plano da nova assinatura
            </label>
            <select
              id="recontract-plan"
              value={recontractPlan}
              onChange={(event) => setTargetPlan(event.target.value)}
              disabled={loading || Boolean(props.recontractPendingPlanId)}
              className="w-full rounded-md border border-border bg-surface p-2 text-fg"
            >
              <option value="">Selecione um plano</option>
              {props.recontractOptions.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} —{' '}
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    plan.amountMinor / 100,
                  )}
                  /mês
                </option>
              ))}
            </select>
            <Button
              type="button"
              loading={loading}
              disabled={!recontractPlan}
              onClick={() => void checkout(recontractPlan)}
            >
              {props.recontractPendingPlanId ? 'Retomar checkout' : 'Continuar para pagamento'}
            </Button>
          </div>
        ) : (
          <Button type="button" loading={loading} onClick={() => void checkout()}>
            Contratar novamente
          </Button>
        )
      ) : null}
      {props.canRecontract && props.checkoutAvailable === false ? (
        <Alert variant="info" title="Nova contratação temporariamente indisponível">
          A renovação anterior terminou, mas novos checkouts estão pausados. Seus dados foram
          preservados; volte a esta página quando a contratação for liberada.
        </Alert>
      ) : null}
      {props.managementAvailable && props.contractId && !cancelled ? (
        props.cancellationState === 'requested' ? (
          <Button type="button" loading={loading} onClick={() => void cancelRenewal()}>
            Verificar cancelamento
          </Button>
        ) : (
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            trigger={
              <Button type="button" variant="secondary" disabled={loading}>
                Cancelar renovação
              </Button>
            }
            title="Cancelar a renovação?"
            description={`O acesso permanece até ${accessUntil} (Brasília). Esta ação é definitiva e não gera estorno automático. Você poderá contratar novamente apenas depois do período pago.`}
            confirmLabel="Confirmar cancelamento"
            cancelLabel="Voltar"
            tone="danger"
            loading={loading}
            onConfirm={cancelRenewal}
          >
            {message ? <Alert variant="warning">{message}</Alert> : null}
          </ConfirmDialog>
        )
      ) : null}
      {message ? <Alert variant="warning">{message}</Alert> : null}
      {props.planChanges?.amountChangeBlocked ? (
        <Alert variant="info" title="Pagamento por Pix Automático">
          O banco não permite alterar o valor desta autorização.{' '}
          {props.checkoutAvailable === false
            ? 'A troca está temporariamente indisponível. Não cancele a renovação apenas para tentar mudar de plano enquanto novos checkouts estiverem pausados.'
            : 'A troca para outro valor ainda não está disponível. Sua assinatura e seus limites atuais continuam válidos. Não cancele a renovação apenas para tentar mudar de plano; uma nova autorização Pix exige outra contratação e pagamento.'}
          {props.planChanges.options.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {props.planChanges.options.map((plan) => (
                <li key={plan.id}>
                  {plan.name}:{' '}
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    plan.amountMinor / 100,
                  )}
                  /mês
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : props.planChanges ? (
        <div className="space-y-3">
          <h3 className="font-semibold">Plano e médicos adicionais</h3>
          <p className="text-sm text-fg-muted">
            A mudança vale somente após a próxima renovação paga no novo valor. Não há cobrança
            proporcional nem liberação antecipada de médicos. Os 3 acessos administrativos continuam
            incluídos; não há compra de um quarto acesso.
          </p>
          {props.planChanges.pending ? (
            <Alert
              variant="info"
              title={
                props.planChanges.pending.confirmed
                  ? 'Alteração agendada'
                  : 'Alteração em verificação'
              }
            >
              O plano atual e seus limites permanecem até confirmarmos a renovação no novo valor.
              Não envie outro pedido. Uma redução reserva desde já a capacidade do plano escolhido.
            </Alert>
          ) : (
            <>
              <label htmlFor="next-billing-plan" className="block text-sm font-medium">
                Plano para a próxima renovação
              </label>
              <select
                id="next-billing-plan"
                value={targetPlan}
                onChange={(event) => setTargetPlan(event.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-border bg-surface p-2 text-fg"
              >
                <option value="">Selecione um plano</option>
                {props.planChanges.options.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} —{' '}
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                      plan.amountMinor / 100,
                    )}
                    /mês
                  </option>
                ))}
              </select>
              <Button
                type="button"
                disabled={!targetPlan}
                loading={loading}
                onClick={() => void schedulePlan()}
              >
                Agendar mudança para a próxima renovação
              </Button>
            </>
          )}
        </div>
      ) : !cancelled ? (
        <p className="text-sm text-fg-muted">
          Alterações de plano e médicos adicionais não estão disponíveis para esta assinatura agora.
        </p>
      ) : null}
    </section>
  );
}
