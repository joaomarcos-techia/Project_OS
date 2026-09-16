'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { TurnstileWidget } from '@/components/shared/turnstile-widget';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signupPasswordSchema } from '@/lib/auth/signup-password';

type Props = {
  rowVersion: number;
  saved: boolean;
  onEmailPending: (rowVersion: number) => void;
  onReconcile: (reason: 'conflict' | 'uncertain') => Promise<void>;
  onGone: () => void;
};

function readRowVersion(value: unknown, minimum: number): number | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('rowVersion' in value) ||
    typeof value.rowVersion !== 'number' ||
    !Number.isInteger(value.rowVersion) ||
    value.rowVersion <= minimum
  ) {
    return null;
  }
  return value.rowVersion;
}

export function SignupIdentity({ rowVersion, saved, onEmailPending, onReconcile, onGone }: Props) {
  const [editing, setEditing] = useState(!saved);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const currentVersion = useRef(rowVersion);
  const submitting = useRef(false);

  useEffect(() => {
    if (editing)
      formRef.current?.querySelector<HTMLInputElement>('input[name="ownerName"]')?.focus();
  }, [editing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const invalid = Array.from(
      form.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])'),
    ).find((input) => !input.validity.valid || (input.type !== 'checkbox' && !input.value.trim()));
    if (invalid || !accepted) {
      (invalid ?? form.querySelector<HTMLButtonElement>('[role="checkbox"]'))?.focus();
      setMessage('Preencha os quatro campos e confirme o aceite para continuar.');
      return;
    }

    const password = String(fields.get('password') ?? '');
    if (!signupPasswordSchema.safeParse(password).success) {
      form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      setMessage(
        'Use de 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula, número e caractere especial.',
      );
      return;
    }

    const email = String(fields.get('email')).trim();
    const identity = {
      rowVersion: currentVersion.current,
      ownerName: String(fields.get('ownerName')).trim(),
      clinicName: String(fields.get('clinicName')).trim(),
      email,
      accepted: true,
    } as const;
    const captchaToken = String(fields.get('captchaToken') ?? '').trim() || undefined;

    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const identityResponse = await fetch('/api/signup/sessions/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(identity),
      });
      if (identityResponse.status === 409) {
        form.reset();
        setAccepted(false);
        await onReconcile('conflict');
        return;
      }
      if (identityResponse.status === 410) {
        onGone();
        return;
      }
      if (!identityResponse.ok) {
        setMessage(
          identityResponse.status === 429
            ? 'Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente.'
            : identityResponse.status === 503
              ? 'O salvamento está temporariamente indisponível. Tente novamente mais tarde.'
              : 'Não foi possível salvar. Confira os campos e tente novamente.',
        );
        return;
      }

      const identityVersion = readRowVersion(await identityResponse.json(), currentVersion.current);
      if (identityVersion === null) {
        setMessage('Não foi possível confirmar o salvamento. Tente novamente.');
        return;
      }
      currentVersion.current = identityVersion;

      let authResponse: Response;
      try {
        authResponse = await fetch('/api/signup/sessions/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rowVersion: identityVersion,
            email,
            password,
            accepted: true,
            ...(captchaToken ? { captchaToken } : {}),
          }),
        });
      } catch {
        await onReconcile('uncertain');
        return;
      }

      if (authResponse.ok) {
        let authBody: unknown;
        try {
          authBody = await authResponse.json();
        } catch {
          await onReconcile('uncertain');
          return;
        }
        const authVersion = readRowVersion(authBody, identityVersion);
        if (authVersion !== null) {
          onEmailPending(authVersion);
          return;
        }
        await onReconcile('uncertain');
        return;
      }
      if (authResponse.status === 410) {
        onGone();
      } else if (authResponse.status === 409 || authResponse.status === 503) {
        await onReconcile(authResponse.status === 409 ? 'conflict' : 'uncertain');
      } else {
        setMessage(
          authResponse.status === 429
            ? 'Muitas tentativas em pouco tempo. Aguarde antes de solicitar a conta.'
            : 'Não foi possível solicitar a conta. Confira os dados e tente novamente.',
        );
      }
    } catch {
      setMessage('A conexão falhou antes da confirmação. Seus dados continuam somente nesta tela.');
    } finally {
      const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]');
      if (passwordInput) passwordInput.value = '';
      setChallengeAttempt((attempt) => attempt + 1);
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="signup-identity-title"
      className="mt-8 rounded-(--r-2xl) bg-surface-raised p-5 shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_8px_28px_oklch(0_0_0/0.07)] sm:p-7"
    >
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        Etapa 2 · dados e conta
      </p>
      <h2
        id="signup-identity-title"
        className="mt-3 text-balance font-display text-2xl font-semibold"
      >
        Seus dados e o nome da clínica
      </h2>
      {saved && !editing ? (
        <>
          <p role="status" className="mt-3 text-pretty text-sm leading-relaxed text-fg-muted">
            Seus dados foram salvos, mas a solicitação da conta ainda não foi confirmada. Por
            segurança, preencha os campos novamente para continuar.
          </p>
          <Button
            type="button"
            variant="subtle"
            className="mt-5 active:scale-[0.96]"
            onClick={() => setEditing(true)}
          >
            Retomar criação da conta
          </Button>
        </>
      ) : (
        <form ref={formRef} onSubmit={submit} noValidate className="mt-5">
          <p className="mb-5 text-pretty text-sm leading-relaxed text-fg-muted">
            Preencha os dados, crie sua senha e confirme o aceite. A senha é enviada somente na
            tentativa de criar a conta e não é salva neste cadastro temporário.
          </p>
          <fieldset disabled={saving} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-owner">Seu nome</Label>
              <Input
                id="signup-owner"
                name="ownerName"
                autoComplete="name"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-clinic">Nome da clínica</Label>
              <Input
                id="signup-clinic"
                name="clinicName"
                autoComplete="organization"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">E-mail</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={160}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Senha</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                maxLength={72}
                aria-describedby="signup-password-help"
              />
              <p id="signup-password-help" className="text-xs leading-relaxed text-fg-subtle">
                De 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula, número e
                caractere especial.
              </p>
            </div>
            <div className="flex min-h-10 items-start gap-3 pt-2">
              <Checkbox
                id="signup-accepted"
                checked={accepted}
                onCheckedChange={(value) => setAccepted(value === true)}
                disabled={saving}
                className="mt-0.5"
              />
              <Label htmlFor="signup-accepted" className="text-pretty text-sm leading-relaxed">
                Li e aceito os{' '}
                <a
                  href="https://qoro.dev/termos-de-uso"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a
                  href="https://qoro.dev/politica-de-privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Política de Privacidade
                </a>
                .
              </Label>
            </div>
            <TurnstileWidget action="signup_auth" resetSignal={challengeAttempt} />
          </fieldset>
          <div aria-live="polite" className="mt-5">
            {message ? <Alert variant="warning">{message}</Alert> : null}
          </div>
          <Button type="submit" loading={saving} className="mt-5 active:scale-[0.96]">
            Criar conta e continuar
          </Button>
        </form>
      )}
    </section>
  );
}
