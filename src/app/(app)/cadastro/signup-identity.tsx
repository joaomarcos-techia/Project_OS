'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';
import { signupPasswordSchema } from '@/lib/auth/signup-password';

type Props = {
  rowVersion: number;
  saved: boolean;
  /**
   * O e-mail vai junto porque a tela de espera precisa dele para reenviar, e
   * NINGUÉM mais tem: o servidor guarda só o HMAC. Passá-lo em memória, entre
   * dois componentes da mesma aba, é o que torna o reenvio um clique — sem
   * inventar um armazenamento que a ADR-062 proibiu de propósito.
   */
  onCredentialsPrepared: (email: string, password: string) => void;
  onCredentialsCleared: () => void;
  onEmailPending: (rowVersion: number, email: string) => void;
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

export function SignupIdentity({
  rowVersion,
  saved,
  onCredentialsPrepared,
  onCredentialsCleared,
  onEmailPending,
  onReconcile,
  onGone,
}: Props) {
  const [editing, setEditing] = useState(!saved);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Uma senha que a pessoa não consegue conferir é uma senha que ela vai digitar
  // errado e só descobrir no login, depois de já ter confirmado o e-mail. A
  // regra desta tela (maiúscula, minúscula, número) torna o erro de digitação
  // mais provável, não menos — por isso o olho existe aqui como existe no login.
  const [senhaVisivel, setSenhaVisivel] = useState(false);
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
      setMessage('Use de 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula e número.');
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
      // A senha fica somente na memória desta aba. Depois da confirmação, ela
      // só segue junto do código que veio no corpo do e-mail; nunca é persistida
      // pelo browser enquanto a conta está pendente.
      onCredentialsPrepared(email, password);

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
          onEmailPending(authVersion, email);
          return;
        }
        await onReconcile('uncertain');
        return;
      }
      if (authResponse.status === 410) {
        onCredentialsCleared();
        onGone();
      } else if (authResponse.status === 422) {
        // A senha foi recusada pelo provedor e a tentativa foi devolvida: dá
        // para escolher outra agora, sem esperar cooldown nenhum.
        let retryBody: unknown;
        try {
          retryBody = await authResponse.json();
        } catch {
          await onReconcile('uncertain');
          return;
        }
        const retryVersion = readRowVersion(retryBody, identityVersion);
        if (retryVersion === null) {
          await onReconcile('uncertain');
          return;
        }
        currentVersion.current = retryVersion;
        form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
        onCredentialsCleared();
        setMessage(
          'Essa senha aparece em vazamentos conhecidos e foi recusada. Escolha outra e tente novamente.',
        );
      } else if (authResponse.status === 409 || authResponse.status === 503) {
        await onReconcile(authResponse.status === 409 ? 'conflict' : 'uncertain');
      } else {
        onCredentialsCleared();
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
      // O campo é limpo aqui; deixar o olho aberto exibiria a PRÓXIMA digitação
      // sem que ninguém tivesse pedido.
      setSenhaVisivel(false);
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
                maxLength={SIGNUP_INPUT_LIMITS.personName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-clinic">Nome da clínica</Label>
              <Input
                id="signup-clinic"
                name="clinicName"
                autoComplete="organization"
                required
                maxLength={SIGNUP_INPUT_LIMITS.clinicName}
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
                maxLength={SIGNUP_INPUT_LIMITS.email}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Senha</Label>
              <div className="relative">
                <Input
                  id="signup-password"
                  name="password"
                  type={senhaVisivel ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  maxLength={SIGNUP_INPUT_LIMITS.password}
                  aria-describedby="signup-password-help"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setSenhaVisivel((visivel) => !visivel)}
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
              <p id="signup-password-help" className="text-xs leading-relaxed text-fg-subtle">
                De 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula e número. Símbolos
                são opcionais.
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
