'use client';

import { useRef, useState, type FormEvent } from 'react';

import { signupFrame } from '@/components/shared/signup-frame';
import { CAPTCHA_TOKEN_FIELD, TurnstileWidget } from '@/components/shared/turnstile-widget';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui/cn';

import styles from '../cadastro.module.css';

type CheckState =
  | { status: 'ready' | 'checking' }
  | { status: 'passed'; runId: string }
  | { status: 'error'; message: string };

function isProof(value: unknown): value is {
  ok: true;
  runId: string;
  accepted: true;
  replayRejected: true;
  invalidRejected: true;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === true &&
    'runId' in value &&
    typeof value.runId === 'string' &&
    /^[a-f0-9-]{36}$/u.test(value.runId) &&
    'accepted' in value &&
    value.accepted === true &&
    'replayRejected' in value &&
    value.replayRejected === true &&
    'invalidRejected' in value &&
    value.invalidRejected === true
  );
}

export function SignupProtectionCheck() {
  const [state, setState] = useState<CheckState>({ status: 'ready' });
  const [resetSignal, setResetSignal] = useState(0);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current || state.status === 'passed') return;
    const token = new FormData(event.currentTarget).get(CAPTCHA_TOKEN_FIELD);
    if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
      setState({
        status: 'error',
        message: 'Aguarde a verificação do navegador e tente novamente.',
      });
      return;
    }
    inFlight.current = true;
    setState({ status: 'checking' });
    try {
      const response = await fetch('/api/signup/verificacao', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken: token }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json();
      if (response.ok && isProof(body)) {
        setState({ status: 'passed', runId: body.runId });
        return;
      }
      setState({
        status: 'error',
        message:
          response.status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
            : 'Não foi possível confirmar a proteção. O cadastro continua fechado.',
      });
    } catch {
      setState({ status: 'error', message: 'Falha na conexão. Tente novamente em instantes.' });
    } finally {
      inFlight.current = false;
    }
    setResetSignal((value) => value + 1);
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      {state.status !== 'passed' && (
        <TurnstileWidget action="signup-release-check" resetSignal={resetSignal} />
      )}
      <div className={styles.closing}>
        <Button
          type="submit"
          disabled={state.status === 'checking' || state.status === 'passed'}
          className={signupFrame.buttonFull}
        >
          {state.status === 'checking' ? 'Verificando no servidor…' : 'Validar no servidor'}
        </Button>
        <div role="status" aria-live="polite" className={cn(styles.live, signupFrame.text)}>
          {state.status === 'passed' && (
            <>
              <p className="font-semibold">
                Proteção verificada no servidor: 3 de 3 testes aprovados.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Desafio real aceito para este domínio.</li>
                <li>Reutilização do mesmo token recusada.</li>
                <li>Token inválido recusado.</li>
              </ul>
              <p className="mt-3 break-all text-fg-muted">Código da verificação: {state.runId}</p>
              <p className="mt-2">
                Você pode informar esse código à equipe. Nenhuma conta foi criada.
              </p>
            </>
          )}
          {state.status === 'error' && <p>{state.message}</p>}
        </div>
      </div>
    </form>
  );
}
