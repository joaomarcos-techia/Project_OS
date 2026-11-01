'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';
import { SIGNUP_PASSWORD_RULES, signupPasswordMessage } from '@/lib/auth/signup-password';

export function SignupPasswordForm({ reconcile = false }: { reconcile?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
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
          window.location.assign('/cadastro/plano');
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
    <form onSubmit={submit} noValidate className="mt-6 space-y-5 text-left">
      <p className="text-sm leading-relaxed text-fg-muted">
        {reconcile
          ? 'Seu e-mail foi confirmado, mas a última tentativa não terminou. Digite a mesma senha que criou para verificar o resultado e continuar. Sua senha não será alterada.'
          : 'Seu e-mail já foi confirmado. Crie agora sua senha de acesso para escolher o plano e continuar.'}
      </p>
      <div className="space-y-2">
        <Label htmlFor="confirmed-signup-password">
          {reconcile ? 'Sua senha' : 'Crie sua senha'}
        </Label>
        <div className="relative">
          <Input
            id="confirmed-signup-password"
            name="password"
            type={visible ? 'text' : 'password'}
            autoComplete={reconcile ? 'current-password' : 'new-password'}
            required
            maxLength={SIGNUP_INPUT_LIMITS.password}
            disabled={saving || expired}
            aria-describedby="confirmed-signup-password-help"
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            disabled={saving || expired}
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visible}
            className="absolute right-0 top-0 flex size-(--control-h) min-h-(--hit-target) items-center justify-center rounded-(--field-radius) text-fg-subtle focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            {visible ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
        <p id="confirmed-signup-password-help" className="text-xs leading-relaxed text-fg-subtle">
          {SIGNUP_PASSWORD_RULES}
        </p>
      </div>
      <div aria-live="polite">{message ? <Alert variant="warning">{message}</Alert> : null}</div>
      {loginNeeded ? (
        <p className="text-sm text-fg-muted">
          Se a tentativa anterior não terminar,{' '}
          <a href="/login" className="font-medium text-primary underline">
            entre ou recupere sua senha
          </a>{' '}
          para continuar com segurança.
        </p>
      ) : null}
      {expired ? (
        <a href="/cadastro" className="text-sm font-medium text-primary underline">
          Iniciar novo cadastro
        </a>
      ) : (
        <Button type="submit" loading={saving} className="w-full">
          {reconcile ? 'Confirmar senha e continuar' : 'Criar senha e escolher plano'}
        </Button>
      )}
    </form>
  );
}
