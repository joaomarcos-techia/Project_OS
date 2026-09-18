'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { TurnstileWidget } from '@/components/shared/turnstile-widget';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  rowVersion: number;
  onUpdated: (rowVersion: number) => void;
  onReconcile: (reason: 'conflict' | 'uncertain') => Promise<void>;
  onGone: () => void;
};

function readRowVersion(value: unknown, minimum: number): number | null {
  return typeof value === 'object' &&
    value !== null &&
    'rowVersion' in value &&
    typeof value.rowVersion === 'number' &&
    Number.isInteger(value.rowVersion) &&
    value.rowVersion > minimum
    ? value.rowVersion
    : null;
}

export function SignupEmailPending({ rowVersion, onUpdated, onReconcile, onGone }: Props) {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = form.elements.namedItem('email');
    if (!(email instanceof HTMLInputElement) || !email.validity.valid || !email.value.trim()) {
      if (email instanceof HTMLInputElement) email.focus();
      setMessage('Digite novamente o e-mail usado no cadastro.');
      return;
    }
    if (!accepted) {
      form.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus();
      setMessage('Confirme novamente o aceite para solicitar o reenvio.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const captchaToken = String(fields.get('captchaToken') ?? '').trim() || undefined;
      const response = await fetch('/api/signup/sessions/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rowVersion,
          email: email.value.trim(),
          accepted: true,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      });
      if (response.ok) {
        const nextVersion = readRowVersion(await response.json(), rowVersion);
        if (nextVersion !== null) {
          onUpdated(nextVersion);
          setMessage(
            'A nova solicitação foi concluída. Se o endereço puder continuar, você receberá as instruções.',
          );
        } else {
          await onReconcile('uncertain');
        }
      } else if (response.status === 410) {
        onGone();
      } else if (response.status === 409 || response.status === 503) {
        await onReconcile(response.status === 409 ? 'conflict' : 'uncertain');
        setMessage('Não foi possível confirmar o reenvio. Nenhuma nova tentativa foi feita.');
      } else if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        setMessage(
          Number.isInteger(retryAfter) && retryAfter > 0
            ? `Aguarde ${retryAfter} segundos antes de solicitar outro envio.`
            : 'Aguarde um pouco antes de solicitar outro envio.',
        );
      } else {
        setMessage('Não foi possível solicitar o reenvio. Confira o e-mail e tente novamente.');
      }
    } catch {
      await onReconcile('uncertain');
      setMessage('A conexão falhou e o resultado do reenvio não pôde ser confirmado.');
    } finally {
      form.reset();
      setAccepted(false);
      setChallengeAttempt((attempt) => attempt + 1);
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="signup-email-title"
      className="mt-8 rounded-(--r-2xl) bg-surface-raised p-5 shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_8px_28px_oklch(0_0_0/0.07)] sm:p-7"
    >
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        Etapa 3 · confirmação
      </p>
      <h2 id="signup-email-title" className="mt-3 font-display text-2xl font-semibold">
        Aguardando a confirmação do e-mail
      </h2>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-fg-muted">
        Se o endereço puder continuar, você receberá uma mensagem com o link de confirmação. Abra o
        link neste ou em outro aparelho: esta tela reconhece a confirmação sozinha. Se já confirmou
        e nada mudou aqui, recarregue a página ou entre novamente.
      </p>
      <a
        href="/login"
        className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-5' })}
      >
        Entrar novamente
      </a>

      <form onSubmit={submit} noValidate className="mt-7 border-t border-border pt-6">
        <h3 className="font-semibold">Não recebeu as instruções?</h3>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-fg-muted">
          O reenvio é uma ação separada. Digite novamente o e-mail e confirme o aceite; a senha não
          é solicitada de novo.
        </p>
        <fieldset disabled={saving} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signup-resend-email">E-mail usado no cadastro</Label>
            <Input
              id="signup-resend-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={160}
            />
          </div>
          <div className="flex min-h-10 items-start gap-3">
            <Checkbox
              id="signup-resend-accepted"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              disabled={saving}
              className="mt-0.5"
            />
            <Label htmlFor="signup-resend-accepted" className="text-pretty text-sm leading-relaxed">
              Confirmo novamente o aceite dos Termos de Uso e da Política de Privacidade.
            </Label>
          </div>
          <TurnstileWidget action="signup_resend" resetSignal={challengeAttempt} />
        </fieldset>
        <div aria-live="polite" className="mt-4">
          {message ? <Alert variant="warning">{message}</Alert> : null}
        </div>
        <Button type="submit" variant="subtle" loading={saving} className="mt-4">
          Reenviar instruções
        </Button>
      </form>
    </section>
  );
}
