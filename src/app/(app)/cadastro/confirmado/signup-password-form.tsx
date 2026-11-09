'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';
import { SIGNUP_PASSWORD_RULES, signupPasswordMessage } from '@/lib/auth/signup-password';
import { cn } from '@/lib/ui/cn';

import styles from '../cadastro.module.css';

export function SignupPasswordForm({ reconcile = false }: { reconcile?: boolean }) {
  const [interactive, setInteractive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    setInteractive(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!interactive || submitting.current) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') ?? '');
    const problem = signupPasswordMessage(password);
    if (problem) {
      setMessage(problem);
      form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === true) {
          form.reset();
          const next = 'next' in result ? result.next : '/cadastro/plano';
          if (
            next === '/cadastro/plano' ||
            next === '/cadastro/continuar' ||
            next === '/cadastro/pagamento?resultado=pending'
          ) {
            window.location.assign(next);
            return;
          }
          setMessage(
            'Não foi possível confirmar a próxima etapa. Atualize a página para continuar.',
          );
          return;
        }
      }
      if (response.status === 410) {
        setExpired(true);
        setMessage(
          'O prazo deste cadastro terminou. Inicie novamente para continuar com segurança.',
        );
      } else if (response.status === 422) {
        form.reset();
        setMessage(
          'Essa senha não pode ser usada. Escolha uma senha que não tenha usado em outros sites.',
        );
      } else if (response.status === 401 || response.status === 403) {
        setLoginNeeded(true);
        setMessage(
          'Não foi possível validar a sessão. Abra novamente o link do e-mail. Se já criou sua senha, entre pelo login.',
        );
      } else if (response.status === 429) {
        setMessage('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
      } else if (response.status === 409) {
        setLoginNeeded(true);
        setMessage('Outra tentativa está em andamento. Aguarde e tente novamente nesta página.');
      } else {
        setMessage('Não foi possível concluir agora. Nenhuma cobrança foi feita. Tente novamente.');
      }
    } catch {
      setMessage(
        'A conexão falhou antes da confirmação. Tente novamente com a mesma senha para verificar o resultado.',
      );
    } finally {
      submitting.current = false;
      setSaving(false);
      setVisible(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={submit}
      noValidate
      aria-busy={!interactive || saving}
      className={styles.form}
    >
      <p className={signupFrame.text}>
        {reconcile
          ? 'Seu e-mail foi confirmado, mas a última tentativa não terminou. Digite a mesma senha que criou para verificar o resultado e continuar. Sua senha não será alterada.'
          : 'Seu e-mail já foi confirmado. Crie agora sua senha de acesso para escolher o plano e continuar.'}
      </p>
      <div className={signupFrame.field}>
        <Label htmlFor="confirmed-signup-password">
          {reconcile ? 'Sua senha' : 'Crie sua senha'}
        </Label>
        <div className={signupFrame.passwordField}>
          <Input
            id="confirmed-signup-password"
            name="password"
            type={visible ? 'text' : 'password'}
            autoComplete={reconcile ? 'current-password' : 'new-password'}
            required
            maxLength={SIGNUP_INPUT_LIMITS.password}
            disabled={!interactive || saving || expired}
            aria-describedby="confirmed-signup-password-help"
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            disabled={!interactive || saving || expired}
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visible}
            className={signupFrame.passwordToggle}
          >
            {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        <p id="confirmed-signup-password-help" className={signupFrame.hint}>
          {SIGNUP_PASSWORD_RULES}
        </p>
      </div>
      <div className={styles.closing}>
        <div aria-live="polite" className={styles.live}>
          {message ? <Alert variant="warning">{message}</Alert> : null}
        </div>
        <div className={styles.form}>
          {loginNeeded ? (
            <p className={signupFrame.note}>
              Se a tentativa anterior não terminar,{' '}
              <a href="/login" className={cn(signupFrame.inlineLink, 'underline')}>
                entre ou recupere sua senha
              </a>{' '}
              para continuar com segurança.
            </p>
          ) : null}
          {expired ? (
            <a href="/cadastro" className={signupFrame.inlineLink}>
              Iniciar novo cadastro
            </a>
          ) : (
            <Button
              type="submit"
              disabled={!interactive}
              loading={!interactive || saving}
              className={signupFrame.buttonFull}
            >
              {reconcile ? 'Confirmar senha e continuar' : 'Criar senha e escolher plano'}
            </Button>
          )}
          <noscript>Ative o JavaScript para criar sua senha com segurança.</noscript>
        </div>
      </div>
    </form>
  );
}
