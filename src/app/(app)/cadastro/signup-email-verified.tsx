'use client';

import { CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';
import { signupPasswordSchema } from '@/lib/auth/signup-password';

type PreparedCredentials = {
  email: string;
  password: string;
};

type Props = {
  rowVersion: number;
  preparedCredentials?: PreparedCredentials | null;
  onCredentialsCleared: () => void;
  onReconcile: (reason: 'conflict' | 'uncertain') => Promise<void>;
  onGone: () => void;
  onCompleted: () => void;
};

/**
 * Handoff explícito entre a confirmação do e-mail e a instalação da senha.
 *
 * O link prova controle da caixa postal, mas não autoriza sozinho a aba anônima
 * que iniciou o cadastro. O código que está no corpo do e-mail liga as duas
 * pontas sem colocar essa prova na URL. E-mail e senha podem continuar apenas
 * na memória da aba original; depois de um refresh, a pessoa os digita de novo.
 */
export function SignupEmailVerified({
  rowVersion,
  preparedCredentials,
  onCredentialsCleared,
  onReconcile,
  onGone,
  onCompleted,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<'danger' | 'warning'>('warning');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [pedirNovaSenha, setPedirNovaSenha] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  const usarEmailPreparado =
    typeof preparedCredentials?.email === 'string' && preparedCredentials.email.length > 0;
  const usarSenhaPreparada =
    !pedirNovaSenha &&
    typeof preparedCredentials?.password === 'string' &&
    preparedCredentials.password.length > 0;

  function focus(name: 'email' | 'password' | 'verificationCode'): void {
    formRef.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = usarEmailPreparado
      ? preparedCredentials.email.trim()
      : String(fields.get('email') ?? '').trim();
    const password = usarSenhaPreparada
      ? preparedCredentials.password
      : String(fields.get('password') ?? '');
    const verificationCode = String(fields.get('verificationCode') ?? '');

    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]');
    if (!email || (emailInput && !emailInput.validity.valid)) {
      focus('email');
      setMessageKind('warning');
      setMessage('Digite o mesmo e-mail usado no início do cadastro.');
      return;
    }
    if (!signupPasswordSchema.safeParse(password).success) {
      focus('password');
      setMessageKind('warning');
      setMessage(
        'Crie uma senha de 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula e número.',
      );
      return;
    }
    if (!/^\d{8}$/u.test(verificationCode)) {
      focus('verificationCode');
      setMessageKind('warning');
      setMessage('Digite os 8 dígitos mostrados no e-mail de confirmação.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/sessions/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowVersion, email, password, verificationCode }),
      });

      if (response.ok) {
        onCredentialsCleared();
        onCompleted();
        return;
      }
      if (response.status === 410) {
        onCredentialsCleared();
        onGone();
        return;
      }
      if (response.status === 409) {
        await onReconcile('conflict');
        setMessageKind('warning');
        setMessage('Este cadastro mudou em outra aba. Confira os dados e tente novamente.');
        return;
      }
      if (response.status === 422) {
        const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]');
        if (passwordInput) passwordInput.value = '';
        onCredentialsCleared();
        setPedirNovaSenha(true);
        setSenhaVisivel(false);
        setMessageKind('warning');
        setMessage(
          'Essa senha não pode ser usada. Crie outra com letra maiúscula, minúscula e número.',
        );
        window.setTimeout(() => focus('password'), 0);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setMessageKind('warning');
        setMessage(
          'Não foi possível validar o código e os dados. Confira o e-mail e tente novamente.',
        );
        focus('verificationCode');
        return;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        setMessageKind('warning');
        setMessage(
          Number.isInteger(retryAfter) && retryAfter > 0
            ? `Aguarde ${retryAfter} segundos antes de tentar novamente.`
            : 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
        );
        return;
      }

      setMessageKind('danger');
      setMessage('Não foi possível continuar agora. Nenhuma cobrança foi feita; tente novamente.');
    } catch {
      await onReconcile('uncertain');
      setMessageKind('danger');
      setMessage('A conexão falhou e a continuação não pôde ser confirmada. Tente novamente.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="signup-email-verified-title"
      data-slot="signup-email-verified"
      className="rounded-(--r-2xl) bg-surface-raised p-6 text-left shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_8px_28px_oklch(0_0_0/0.07)] sm:p-8"
    >
      <div className="text-center">
        <CheckCircle2 aria-hidden="true" className="mx-auto size-9 text-success-600" />
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Etapa 3 · confirmação
        </p>
        <h1
          id="signup-email-verified-title"
          className="mt-3 text-balance font-display text-3xl font-semibold tracking-[-0.03em]"
        >
          E-mail confirmado
        </h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-pretty text-sm leading-relaxed text-fg-muted">
          Digite o código de 8 dígitos mostrado no e-mail para concluir a conta e escolher seu
          plano.
        </p>
      </div>

      <form ref={formRef} onSubmit={submit} noValidate className="mx-auto mt-7 max-w-sm space-y-5">
        {!usarEmailPreparado ? (
          <div className="space-y-2">
            <Label htmlFor="signup-continue-email">E-mail usado no cadastro</Label>
            <Input
              id="signup-continue-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={SIGNUP_INPUT_LIMITS.email}
              disabled={saving}
            />
          </div>
        ) : null}
        {!usarSenhaPreparada ? (
          <div className="space-y-2">
            <Label htmlFor="signup-continue-password">Crie sua senha</Label>
            <div className="relative">
              <Input
                id="signup-continue-password"
                name="password"
                type={senhaVisivel ? 'text' : 'password'}
                autoComplete="new-password"
                required
                maxLength={SIGNUP_INPUT_LIMITS.password}
                disabled={saving}
                aria-describedby="signup-continue-password-help"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setSenhaVisivel((visible) => !visible)}
                aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={senhaVisivel}
                className="absolute right-0 top-0 flex size-(--control-h) min-h-(--hit-target) items-center justify-center rounded-(--field-radius) text-fg-subtle transition-colors hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
              >
                {senhaVisivel ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
              </button>
            </div>
            <p
              id="signup-continue-password-help"
              className="text-pretty text-xs leading-relaxed text-fg-subtle"
            >
              De 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula e número. Símbolos
              são opcionais.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="signup-verification-code">Código do e-mail</Label>
          <div className="relative w-full max-w-[13rem]">
            <KeyRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              id="signup-verification-code"
              name="verificationCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{8}"
              minLength={SIGNUP_INPUT_LIMITS.verificationCode}
              maxLength={SIGNUP_INPUT_LIMITS.verificationCode}
              size={SIGNUP_INPUT_LIMITS.verificationCode}
              required
              disabled={saving}
              aria-describedby="signup-verification-code-help"
              className="px-10 text-center font-mono text-base tracking-[0.18em] tabular-nums"
              onInput={(event) => {
                event.currentTarget.value = event.currentTarget.value
                  .replace(/\D/gu, '')
                  .slice(0, SIGNUP_INPUT_LIMITS.verificationCode);
              }}
            />
          </div>
          <p
            id="signup-verification-code-help"
            className="text-pretty text-xs leading-relaxed text-fg-subtle"
          >
            O código fica no corpo da mensagem e não aparece no endereço do link.
          </p>
        </div>

        <div aria-live="polite">
          {message ? <Alert variant={messageKind}>{message}</Alert> : null}
        </div>

        <Button type="submit" loading={saving} className="w-full active:scale-[0.96]">
          Continuar
        </Button>
      </form>
    </section>
  );
}
