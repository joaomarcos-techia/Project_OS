'use client';

import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  planName: string;
  amountMinor: number;
  trialEndsAt: string;
  trialActive: boolean;
  paid: boolean;
  billingStatus: 'trial' | 'active' | 'past_due' | 'cancelled';
  paidPeriodActive: boolean;
}

export function DeferredSubscription(props: Props) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      {props.paid && props.paidPeriodActive ? (
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
      {message ? <Alert variant="warning">{message}</Alert> : null}
      <p className="text-sm text-fg-muted">
        Alterações de plano e médicos adicionais ainda não estão disponíveis nesta integração em
        validação.
      </p>
    </section>
  );
}
