'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { PublicBlock, PublicHeading, signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SignupEmailDelivery } from '@/contexts/onboarding/signup-email-feedback';
import { cn } from '@/lib/ui/cn';

import styles from './cadastro.module.css';
import {
  forgetSignupDestination,
  recallSignupDestination,
  rememberSignupDestination,
} from './signup-destination-memory';

type Props = {
  rowVersion: number;
  email?: string | undefined;
  deliveryStatus?: SignupEmailDelivery | undefined;
  onEmailCorrected?: ((rowVersion: number, email: string) => void) | undefined;
  onUpdated: (rowVersion: number) => void;
  onReconcile: (reason: 'conflict' | 'uncertain') => Promise<void>;
  onGone: () => void;
};

export function SignupCodeConfirmation({
  rowVersion,
  email,
  deliveryStatus,
  onEmailCorrected,
  onUpdated,
  onReconcile,
  onGone,
}: Props) {
  const [address, setAddress] = useState(email ?? '');
  const [destination, setDestination] = useState(email);
  const [destinationLoading, setDestinationLoading] = useState(!email);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'resend' | 'correct' | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [correctedEmail, setCorrectedEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // O endereço vem de quem acabou de digitá-lo, ou da memória desta aba. Nunca
  // do servidor: a resposta dele mudava quando o e-mail já tinha conta.
  useEffect(() => {
    if (email) {
      rememberSignupDestination(email);
      return;
    }
    const remembered = recallSignupDestination();
    if (remembered) {
      setDestination(remembered);
      setAddress(remembered);
    }
    setDestinationLoading(false);
  }, [email]);

  const leave = () => {
    forgetSignupDestination();
    onGone();
  };

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
          forgetSignupDestination();
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
        leave();
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

  async function correctEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !onEmailCorrected) return;
    inFlight.current = true;
    setBusy('correct');
    setMessage(null);
    setSuccess(false);
    try {
      const response = await fetch('/api/signup/sessions/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowVersion, currentEmail: address, email: correctedEmail.trim() }),
      });
      const body: unknown = await response.json();
      if (
        response.ok &&
        typeof body === 'object' &&
        body !== null &&
        'rowVersion' in body &&
        typeof body.rowVersion === 'number' &&
        Number.isInteger(body.rowVersion) &&
        body.rowVersion > rowVersion
      ) {
        onEmailCorrected(body.rowVersion, correctedEmail.trim());
      } else if (response.status === 410) leave();
      else if (response.status === 409 || response.status === 503)
        await onReconcile(response.status === 409 ? 'conflict' : 'uncertain');
      else if (response.status === 429)
        setMessage('Aguarde antes de corrigir o endereço novamente.');
      else setMessage('Confira o novo e-mail. Ele deve ser diferente do endereço atual.');
    } catch {
      await onReconcile('uncertain');
      setMessage('Não confirmamos a alteração. Confira o cadastro antes de tentar novamente.');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
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
                Se houver uma etapa de confirmação para{' '}
                <strong className="break-all font-medium text-fg">{destination}</strong>, você
                receberá as instruções.
              </>
            ) : destinationLoading ? (
              'Recuperando o e-mail do seu cadastro…'
            ) : (
              'Informe o e-mail que você usou no cadastro para continuar com o código recebido.'
            )}{' '}
            Se já tem conta, entre para continuar. O código vale por 10 minutos. Você pode colar os
            8 números de uma vez.
          </>
        }
      />
      <PublicBlock narrow>
        <div className={styles.closing}>
          {deliveryStatus === 'failed' ? (
            <Alert variant="warning" title="Não conseguimos entregar o código">
              O serviço de e-mail não concluiu a entrega. Confira o endereço acima e corrija-o se
              necessário. Se estiver correto, tente um reenvio ou fale com o suporte. Não é preciso
              repetir seu nome, clínica ou respostas.
            </Alert>
          ) : deliveryStatus === 'delayed' ? (
            <Alert variant="warning" title="A entrega está demorando">
              O servidor de e-mail está adiando a entrega. Aguarde e confira Spam e Promoções. Se o
              código expirar, solicite outro.
            </Alert>
          ) : null}
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
              disabled={busy !== null || destinationLoading || editingEmail}
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
          {onEmailCorrected && !destinationLoading ? (
            editingEmail ? (
              <form onSubmit={(event) => void correctEmail(event)} className={styles.form}>
                <p className={signupFrame.note}>
                  Seu nome, clínica e respostas serão mantidos. O código anterior será invalidado.
                  Para o endereço corrigido, você informará a senha novamente; nenhuma conta
                  existente terá o e-mail alterado.
                </p>
                <div className={signupFrame.field}>
                  <Label htmlFor="signup-corrected-email">Novo e-mail</Label>
                  <Input
                    id="signup-corrected-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={160}
                    value={correctedEmail}
                    onChange={(event) => setCorrectedEmail(event.target.value)}
                    disabled={busy !== null}
                  />
                </div>
                <div className={signupFrame.actions}>
                  <Button type="submit" loading={busy === 'correct'} disabled={busy !== null}>
                    Salvar endereço corrigido
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setEditingEmail(false)}
                  >
                    Voltar ao código
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  setCorrectedEmail(address);
                  setEditingEmail(true);
                }}
              >
                Corrigir endereço de e-mail
              </Button>
            )
          ) : null}
          <div aria-live="polite" className={styles.live}>
            {message ? <Alert variant={success ? 'success' : 'warning'}>{message}</Alert> : null}
          </div>
        </div>
        <p className={signupFrame.fine}>
          Não encontrou a mensagem? Confira Spam e Promoções. Seu cadastro continua salvo com
          segurança. Não compartilhe o código ou sua senha com outras pessoas.
        </p>
        <p className={signupFrame.fine}>
          Começou em outro navegador ou aparelho?{' '}
          <a href="/cadastro/retomar" className={signupFrame.inlineLink}>
            Retomar cadastro com segurança
          </a>
        </p>
      </PublicBlock>
    </section>
  );
}
