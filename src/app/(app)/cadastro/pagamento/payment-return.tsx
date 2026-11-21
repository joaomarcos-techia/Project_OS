'use client';

import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PublicBlock, PublicHeading, signupFrame } from '@/components/shared/signup-frame';

import styles from '../plano/plano.module.css';

type Result = 'success' | 'pending' | 'cancelled' | 'expired';
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
        if (response.status === 401) {
          // Outra aba pode ter provisionado a clínica depois que este JWT pré-tenant
          // foi emitido. Renovar as claims antes de concluir que a sessão acabou.
          window.location.assign('/auth/session-refresh?next=/dashboard');
          return;
        }
        if (response.status === 403) {
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
    if (result !== 'success' && result !== 'pending') return;
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
      <>
        <PublicHeading
          title={result === 'cancelled' ? 'Checkout cancelado' : 'Checkout expirado'}
        />
        <PublicBlock narrow>
          <div className={signupFrame.center}>
            <XCircle aria-hidden="true" className="size-9 text-warning-600" />
            <p className={signupFrame.text}>
              Sua clínica ainda não foi ativada. Volte ao plano para continuar o cadastro.
            </p>
          </div>
          {message ? <Alert variant="warning">{message}</Alert> : null}
          <div className={signupFrame.actions}>
            <Button
              type="button"
              variant="secondary"
              className={signupFrame.buttonFull}
              disabled={abandoning}
              onClick={() => void abandon()}
            >
              {abandoning ? 'Encerrando Checkout…' : 'Voltar ao plano'}
            </Button>
          </div>
        </PublicBlock>
      </>
    );
  }

  return (
    <div className={styles.liveStack} aria-live="polite">
      <PublicHeading
        title={phase === 'failed' ? 'Aguardando confirmação' : 'Validando sua assinatura'}
      />
      <PublicBlock narrow>
        <div className={signupFrame.center}>
          {phase === 'failed' ? (
            <Clock3 aria-hidden="true" className="size-9 text-warning-600" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-9 text-success-600" />
          )}
          <p className={signupFrame.text}>
            {phase === 'checking'
              ? 'Estamos conferindo o Checkout diretamente com o Asaas.'
              : phase === 'waiting'
                ? result === 'success'
                  ? 'O Checkout terminou no navegador. Agora aguardamos a confirmação da assinatura pelo Asaas.'
                  : 'A assinatura ainda não foi confirmada pelo Asaas. Estamos verificando novamente.'
                : 'A ativação ainda não terminou.'}
          </p>
        </div>
        {message ? <Alert variant="warning">{message}</Alert> : null}
        {phase === 'failed' ? (
          <div className={signupFrame.actions}>
            <Button
              type="button"
              variant="secondary"
              className={signupFrame.buttonFull}
              onClick={() => void verify()}
            >
              Verificar novamente
            </Button>
          </div>
        ) : null}
      </PublicBlock>
    </div>
  );
}
