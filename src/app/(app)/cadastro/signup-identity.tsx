'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { PublicBlock, PublicHeading, signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';
import { SIGNUP_PASSWORD_RULES, signupPasswordMessage } from '@/lib/auth/signup-password';
import { suggestEmailDomain } from '@/lib/auth/email-domain-suggestion';
import { cn } from '@/lib/ui/cn';

import styles from './cadastro.module.css';

type Props = {
  rowVersion: number;
  saved: boolean;
  initialEmail?: string | undefined;
  /**
   * O e-mail vai junto porque a tela de espera precisa dele para reenviar, e
   * NINGUÉM mais tem: o servidor guarda só o HMAC. Passá-lo em memória, entre
   * dois componentes da mesma aba, é o que torna o reenvio um clique — sem
   * inventar um armazenamento que a ADR-062 proibiu de propósito.
   */
  onCredentialsPrepared: (email: string) => void;
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
  initialEmail,
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
  const [emailAddress, setEmailAddress] = useState(initialEmail ?? '');
  const [acknowledgedEmail, setAcknowledgedEmail] = useState<string | null>(null);
  const suggestion = suggestEmailDomain(emailAddress);
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
    if (invalid || (editing && !accepted)) {
      (invalid ?? form.querySelector<HTMLButtonElement>('[role="checkbox"]'))?.focus();
      setMessage('Preencha seus dados, a senha e confirme o aceite para continuar.');
      return;
    }

    const email = String(fields.get('email')).trim();
    if (suggestion && acknowledgedEmail !== email.toLowerCase()) {
      setMessage('Confira o domínio do e-mail abaixo antes de continuar.');
      form.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
      return;
    }
    const password = String(fields.get('password') ?? '');
    const passwordProblem = signupPasswordMessage(password);
    if (passwordProblem) {
      setMessage(passwordProblem);
      form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      return;
    }
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
      if (editing) {
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

        const identityVersion = readRowVersion(
          await identityResponse.json(),
          currentVersion.current,
        );
        if (identityVersion === null) {
          setMessage('Não foi possível confirmar o salvamento. Tente novamente.');
          return;
        }
        currentVersion.current = identityVersion;
      }
      onCredentialsPrepared(email);

      let authResponse: Response;
      try {
        authResponse = await fetch('/api/signup/sessions/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rowVersion: currentVersion.current,
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
        const authVersion = readRowVersion(authBody, currentVersion.current);
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
        // Compatibilidade com respostas de uma versão anterior durante o
        // rollout: reconcilia a versão antes de um novo envio explícito.
        let retryBody: unknown;
        try {
          retryBody = await authResponse.json();
        } catch {
          await onReconcile('uncertain');
          return;
        }
        const retryVersion = readRowVersion(retryBody, currentVersion.current);
        if (retryVersion === null) {
          await onReconcile('uncertain');
          return;
        }
        currentVersion.current = retryVersion;
        onCredentialsCleared();
        setMessage('Esta senha foi encontrada em vazamentos. Escolha outra senha para continuar.');
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
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="signup-identity-title" className={styles.stack}>
      <PublicHeading
        id="signup-identity-title"
        title="Seus dados e o nome da clínica"
        lead={
          editing
            ? 'Defina sua senha uma única vez. Depois, confirme seu e-mail com o código recebido, sem sair desta jornada.'
            : 'Seu nome, clínica e respostas estão salvos. Confira o e-mail e informe a senha para este endereço. Se você corrigiu o endereço, a senha será definida para a conta corrigida.'
        }
      />
      <PublicBlock>
        <form method="post" ref={formRef} onSubmit={submit} noValidate className={styles.form}>
          <fieldset disabled={saving} className={cn(signupFrame.fields, signupFrame.fieldsTwo)}>
            {editing ? (
              <>
                <div className={signupFrame.field}>
                  <Label htmlFor="signup-owner">Seu nome</Label>
                  <Input
                    id="signup-owner"
                    name="ownerName"
                    autoComplete="name"
                    required
                    maxLength={SIGNUP_INPUT_LIMITS.personName}
                  />
                </div>
                <div className={signupFrame.field}>
                  <Label htmlFor="signup-clinic">Nome da clínica</Label>
                  <Input
                    id="signup-clinic"
                    name="clinicName"
                    autoComplete="organization"
                    required
                    maxLength={SIGNUP_INPUT_LIMITS.clinicName}
                  />
                </div>
              </>
            ) : null}
            <div className={signupFrame.field}>
              <Label htmlFor="signup-email">E-mail</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={SIGNUP_INPUT_LIMITS.email}
                value={emailAddress}
                onChange={(event) => {
                  setEmailAddress(event.target.value);
                  setAcknowledgedEmail(null);
                }}
              />
              {suggestion && acknowledgedEmail !== emailAddress.trim().toLowerCase() ? (
                <Alert variant="warning">
                  <p>
                    Você quis dizer <strong className="break-all">{suggestion}</strong>?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEmailAddress(suggestion);
                        setAcknowledgedEmail(null);
                      }}
                    >
                      Usar endereço sugerido
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAcknowledgedEmail(emailAddress.trim().toLowerCase())}
                    >
                      Manter como digitei
                    </Button>
                  </div>
                </Alert>
              ) : null}
            </div>
            <div className={signupFrame.field}>
              <Label htmlFor="signup-password">Crie sua senha</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                aria-describedby="signup-password-rules"
              />
              <p id="signup-password-rules" className={signupFrame.hint}>
                {SIGNUP_PASSWORD_RULES}
              </p>
            </div>
            {editing ? (
              <div className={cn(signupFrame.check, signupFrame.fieldFull)}>
                <Checkbox
                  id="signup-accepted"
                  checked={accepted}
                  onCheckedChange={(value) => setAccepted(value === true)}
                  disabled={saving}
                  className="mt-0.5"
                />
                <Label htmlFor="signup-accepted" className="text-pretty font-normal">
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
            ) : null}
          </fieldset>
          <div className={styles.closing}>
            <div aria-live="polite" className={styles.live}>
              {message ? <Alert variant="warning">{message}</Alert> : null}
            </div>
            <div className={cn(signupFrame.actions, signupFrame.actionsEnd)}>
              {!editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setEditing(true)}
                >
                  Alterar nome ou clínica
                </Button>
              ) : null}
              <Button type="submit" loading={saving}>
                Enviar confirmação por e-mail
              </Button>
            </div>
          </div>
        </form>
      </PublicBlock>
    </section>
  );
}
