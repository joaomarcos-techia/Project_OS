'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { PublicBlock, PublicHeading, signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/ui/cn';

import styles from './cadastro.module.css';

type Props = {
  rowVersion: number;
  email?: string | undefined;
  onUpdated: (rowVersion: number) => void;
  onReconcile: (reason: 'conflict' | 'uncertain') => Promise<void>;
  onGone: () => void;
};
const DESTINATION_TIMEOUT_MS = 10_000;

export function SignupCodeConfirmation({
  rowVersion,
  email,
  onUpdated,
  onReconcile,
  onGone,
}: Props) {
  const [address, setAddress] = useState(email ?? '');
  const [destination, setDestination] = useState(email);
  const [destinationLoading, setDestinationLoading] = useState(!email);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'resend' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (email) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setDestinationLoading(false);
      setMessage(
        'A consulta do endereço demorou mais que o esperado. Informe o e-mail usado no cadastro para continuar; os demais dados foram preservados.',
      );
    }, DESTINATION_TIMEOUT_MS);
    void fetch('/api/signup/sessions/destination', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('destination_unavailable');
        const body: unknown = await response.json();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('email' in body) ||
          typeof body.email !== 'string'
        ) {
          throw new Error('destination_invalid');
        }
        if (!controller.signal.aborted) {
          setDestination(body.email);
          setAddress(body.email);
          setDestinationLoading(false);
          clearTimeout(timeout);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDestinationLoading(false);
          clearTimeout(timeout);
          setMessage(
            'Não conseguimos recuperar o endereço agora. Informe o mesmo e-mail usado no cadastro; os demais dados não precisam ser repetidos.',
          );
        }
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [email]);

  async function request(action: 'confirm' | 'resend') {
    if (inFlight.current || destinationLoading) return;
    if (!address.trim()) {
      setMessage('Informe o e-mail usado no cadastro.');
      return;
    }
    if (action === 'confirm' && !/^\d{8}$/u.test(code)) {
      setMessage('Digite os 8 números do código que enviamos.');
      inputRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(action);
    setMessage(null);
    setSuccess(false);
    try {
      const response = await fetch(
        `/api/signup/sessions/${action === 'confirm' ? 'verify' : 'resend'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            action === 'confirm' ? { email: address, code } : { email: address, rowVersion },
          ),
        },
      );
      const body: unknown = await response.json();
      const result = typeof body === 'object' && body !== null ? body : {};
      if (response.ok) {
        if (
          action === 'confirm' &&
          'next' in result &&
          typeof result.next === 'string' &&
          [
            '/cadastro/plano',
            '/cadastro/confirmado',
            '/cadastro/continuar',
            '/cadastro/pagamento?resultado=pending',
          ].includes(result.next)
        ) {
          setSuccess(true);
          setMessage('E-mail confirmado. Continuando seu cadastro…');
          window.location.assign(result.next);
          return;
        }
        if (
          action === 'resend' &&
          'rowVersion' in result &&
          typeof result.rowVersion === 'number' &&
          Number.isInteger(result.rowVersion)
        ) {
          onUpdated(result.rowVersion);
          setCode('');
          setSuccess(true);
          setMessage(
            'Se este endereço puder continuar, enviaremos um novo código. Use apenas o mais recente.',
          );
          inputRef.current?.focus();
          return;
        }
        await onReconcile('uncertain');
        return;
      }
      if (response.status === 410) {
        onGone();
        return;
      }
      const error = 'error' in result ? result.error : null;
      if (error === 'expired')
        setMessage('O código expirou. Clique em “Reenviar código” para receber outro.');
      else if (error === 'locked')
        setMessage('O limite de tentativas deste código foi atingido. Solicite um novo código.');
      else if (response.status === 429) {
        const wait = Number(response.headers.get('Retry-After'));
        setMessage(
          Number.isInteger(wait) && wait > 0
            ? `Aguarde ${wait} segundos antes de tentar novamente.`
            : 'Aguarde um pouco antes de tentar novamente.',
        );
      } else if (response.status === 409) {
        await onReconcile('conflict');
        setMessage(
          'Outra solicitação está em andamento. Confira o estado do cadastro antes de tentar novamente.',
        );
      } else if (response.status === 503) {
        setMessage(
          'Não foi possível concluir a verificação agora. Seus dados foram preservados. Tente novamente em instantes.',
        );
      } else setMessage('O código não confere. Confira os 8 números e tente novamente.');
    } catch {
      setMessage(
        'A conexão falhou. Não confirmamos o resultado; confira sua conexão antes de tentar novamente.',
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request('confirm');
  }

  return (
    <section
      aria-labelledby="signup-code-title"
      data-slot="signup-code-confirmation"
      className={styles.stack}
    >
      <PublicHeading
        id="signup-code-title"
        title="Confirme seu e-mail aqui"
        lead={
          <>
            {destination ? (
              <>
                Confira a mensagem enviada para{' '}
                <strong className="break-all font-medium text-fg">{destination}</strong>.
              </>
            ) : destinationLoading ? (
              'Recuperando o e-mail do seu cadastro…'
            ) : (
              'Informe o e-mail que você usou no cadastro para continuar com o código recebido.'
            )}{' '}
            O código vale por 10 minutos. Você pode colar os 8 números de uma vez.
          </>
        }
      />
      <PublicBlock narrow>
        <div className={styles.closing}>
          <form onSubmit={submit} className={styles.form}>
            {!destination && !destinationLoading ? (
              <div className={signupFrame.field}>
                <Label htmlFor="signup-code-email">E-mail usado no cadastro</Label>
                <Input
                  id="signup-code-email"
                  type="email"
                  autoComplete="email"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                  maxLength={160}
                  disabled={busy !== null}
                />
              </div>
            ) : null}
            <div className={signupFrame.field}>
              <Label htmlFor="signup-email-code">Código de confirmação</Label>
              <Input
                ref={inputRef}
                id="signup-email-code"
                name="verificationCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{8}"
                maxLength={8}
                value={code}
                disabled={busy !== null}
                required
                onChange={(event) =>
                  setCode(event.target.value.replace(/[^0-9]/gu, '').slice(0, 8))
                }
                onPaste={(event) => {
                  event.preventDefault();
                  setCode(
                    event.clipboardData
                      .getData('text')
                      .replace(/[^0-9]/gu, '')
                      .slice(0, 8),
                  );
                }}
                className={cn('text-center tabular-nums', styles.codeInput)}
              />
            </div>
            <Button
              type="submit"
              loading={busy === 'confirm'}
              disabled={busy !== null || destinationLoading}
              className={signupFrame.buttonFull}
            >
              Confirmar e-mail
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={busy === 'resend'}
              disabled={busy !== null || destinationLoading}
              onClick={() => void request('resend')}
            >
              Reenviar código
            </Button>
          </form>
          <div aria-live="polite" className={styles.live}>
            {message ? <Alert variant={success ? 'success' : 'warning'}>{message}</Alert> : null}
          </div>
        </div>
        <p className={signupFrame.fine}>
          Não encontrou a mensagem? Confira Spam e Promoções. Seu cadastro continua salvo com
          segurança. Não compartilhe o código ou sua senha com outras pessoas.
        </p>
      </PublicBlock>
    </section>
  );
}
