'use client';

import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Result = 'success' | 'cancelled' | 'expired';
type Phase = 'checking' | 'waiting' | 'failed';

const POLL_DELAYS_MS = [0, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000, 12_000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function PaymentReturn({ result }: { result: Result }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  const runId = useRef(0);

  const verify = useCallback(async () => {
    const currentRun = ++runId.current;
    setPhase('checking');
    setMessage(null);

    for (const delay of POLL_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (currentRun !== runId.current) return;
      try {
        const response = await fetch('/api/signup/checkout/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        const body = await responseJson(response);
        if (response.ok && isRecord(body) && body.state === 'provisioned') {
          window.location.assign('/auth/session-refresh?next=/dashboard');
          return;
        }
        if (response.status === 202) {
          setPhase('waiting');
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          window.location.assign('/login');
          return;
        }
        if (response.status === 429 || response.status >= 500) {
          setPhase('waiting');
          continue;
        }
        setPhase('failed');
        setMessage(
          'Não conseguimos vincular esta assinatura ao seu cadastro. Fale com o suporte antes de tentar pagar novamente.',
        );
        return;
      } catch {
        setPhase('waiting');
      }
    }

    if (currentRun === runId.current) {
      setPhase('failed');
      setMessage(
        'O Asaas ainda não disponibilizou a assinatura. Aguarde um instante e verifique novamente.',
      );
    }
  }, []);

  useEffect(() => {
    if (result !== 'success') return;
    void verify();
    return () => {
      runId.current += 1;
    };
  }, [result, verify]);

  const abandon = useCallback(async () => {
    setAbandoning(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/checkout/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: result }),
      });
      const body = await responseJson(response);
      if (response.ok && isRecord(body) && body.state === 'reset') {
        window.location.assign('/cadastro/plano');
        return;
      }
      if (response.ok && isRecord(body) && body.state === 'already_completed') {
        window.location.assign('/cadastro/pagamento?resultado=success');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        window.location.assign('/login');
        return;
      }
      setMessage(
        'Não conseguimos encerrar este Checkout com segurança. Tente novamente antes de iniciar outro pagamento.',
      );
    } catch {
      setMessage('Não foi possível falar com o Asaas agora. Tente novamente em instantes.');
    } finally {
      setAbandoning(false);
    }
  }, [result]);

  if (result === 'cancelled' || result === 'expired') {
    return (
      <div className="text-center">
        <XCircle aria-hidden="true" className="mx-auto size-9 text-warning-600" />
        <h1 className="mt-4 text-balance font-display text-2xl font-semibold">
          {result === 'cancelled' ? 'Checkout cancelado' : 'Checkout expirado'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Sua clínica ainda não foi ativada. Volte ao plano para continuar o cadastro.
        </p>
        {message ? (
          <div className="mt-5 text-left">
            <Alert variant="warning">{message}</Alert>
          </div>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          disabled={abandoning}
          onClick={() => void abandon()}
        >
          {abandoning ? 'Encerrando Checkout…' : 'Voltar ao plano'}
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center" aria-live="polite">
      {phase === 'failed' ? (
        <Clock3 aria-hidden="true" className="mx-auto size-9 text-warning-600" />
      ) : (
        <CheckCircle2 aria-hidden="true" className="mx-auto size-9 text-success-600" />
      )}
      <h1 className="mt-4 text-balance font-display text-2xl font-semibold">
        {phase === 'failed' ? 'Aguardando confirmação' : 'Validando sua assinatura'}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-fg-muted">
        {phase === 'checking'
          ? 'Estamos conferindo o Checkout diretamente com o Asaas.'
          : phase === 'waiting'
            ? 'O pagamento foi concluído no navegador. Agora aguardamos a assinatura aparecer no Asaas.'
            : 'A ativação ainda não terminou.'}
      </p>
      {message ? (
        <div className="mt-5 text-left">
          <Alert variant="warning">{message}</Alert>
        </div>
      ) : null}
      {phase === 'failed' ? (
        <Button type="button" variant="secondary" className="mt-5" onClick={() => void verify()}>
          Verificar novamente
        </Button>
      ) : null}
    </div>
  );
}
