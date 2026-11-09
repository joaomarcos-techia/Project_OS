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
  managementAvailable?: boolean;
  contractId?: string | null;
  accessUntil?: string | null;
  cancellationState?: 'none' | 'requested' | 'confirmed';
  canRecontract?: boolean;
}

export function DeferredSubscription(props: Props) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelled = props.cancellationState === 'confirmed';
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
  async function checkout() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
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
        code === 'trial_active'
          ? 'Sua avaliação ainda está em andamento. A contratação fica disponível ao final do prazo.'
          : code === 'reconcile_required'
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
          valendo.
        </Alert>
      ) : props.paid ? (
        <Alert variant="warning" title="Renovação em verificação">
          O período pago terminou. Estamos verificando a renovação; não faça outra assinatura. Se a
          situação persistir, fale com o suporte.
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
            ? 'Nenhuma cobrança é criada durante a avaliação. A contratação fica disponível ao final do prazo.'
            : 'Após concluir o checkout, aguarde a confirmação do pagamento. Se já pagou, não faça outra assinatura. A escrita e as integrações serão liberadas após essa confirmação.'}
        </Alert>
      )}
      {!props.paid && !props.trialActive && props.billingStatus !== 'cancelled' ? (
        <Button type="button" loading={loading} onClick={() => void checkout()}>
          Contratar assinatura
        </Button>
      ) : null}
      {props.canRecontract ? (
        <Button type="button" loading={loading} onClick={() => void checkout()}>
          Contratar novamente
        </Button>
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
      <p className="text-sm text-fg-muted">
        Alterações de plano e médicos adicionais ainda não estão disponíveis nesta integração em
        validação.
      </p>
    </section>
  );
}
