'use client';

import { MailCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  rowVersion: number;
  /**
   * O endereço vive só na memória da aba que iniciou o cadastro. Depois de um
   * refresh, a pessoa o digita novamente porque o servidor guarda apenas HMAC.
   */
  email?: string | undefined;
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

/**
 * Espera da confirmação. O caminho principal é abrir a mensagem recebida; o
 * reenvio fica discreto e revela somente o e-mail quando a aba foi recarregada.
 */
export function SignupEmailPending({ rowVersion, email, onUpdated, onReconcile, onGone }: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pedindoEmail, setPedindoEmail] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  const conheceEmail = typeof email === 'string' && email.trim().length > 0;

  useEffect(() => {
    if (pedindoEmail)
      formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  }, [pedindoEmail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;

    if (!conheceEmail && !pedindoEmail) {
      setPedindoEmail(true);
      setMessage(null);
      return;
    }

    const fields = new FormData(form);
    const digitado = String(fields.get('email') ?? '').trim();
    const alvo = conheceEmail ? email.trim() : digitado;
    const campo = form.querySelector<HTMLInputElement>('input[name="email"]');
    if (!alvo || (campo && !campo.validity.valid)) {
      campo?.focus();
      setMessage('Digite novamente o e-mail usado no cadastro.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/sessions/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowVersion, email: alvo }),
      });
      if (response.ok) {
        const nextVersion = readRowVersion(await response.json(), rowVersion);
        if (nextVersion !== null) {
          onUpdated(nextVersion);
          setPedindoEmail(false);
          setMessage(
            'Pronto. Se o endereço puder continuar, um novo e-mail está a caminho — use o link mais recente.',
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
      submitting.current = false;
      setSaving(false);
    }
  }

  const rotuloBotao =
    !conheceEmail && !pedindoEmail
      ? 'Não recebeu? Reenviar o e-mail'
      : saving
        ? 'Reenviando…'
        : 'Reenviar o e-mail';

  return (
    <section
      aria-labelledby="signup-email-title"
      data-slot="signup-email-pending"
      className="mt-8 rounded-(--r-2xl) bg-surface-raised p-6 text-center shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_8px_28px_oklch(0_0_0/0.07)] sm:p-8"
    >
      <MailCheck aria-hidden="true" className="mx-auto size-8 text-primary" />
      <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        Etapa 3 · confirmação
      </p>
      <h2 id="signup-email-title" className="mt-3 text-balance font-display text-2xl font-semibold">
        Aguardando a confirmação do e-mail
      </h2>
      <p className="mx-auto mt-3 max-w-[46ch] text-pretty text-sm leading-relaxed text-fg-muted">
        Se o endereço puder continuar, enviaremos um link e um código de 8 dígitos. Abra o link;
        esta tela reconhecerá a confirmação e pedirá o código para continuar.
      </p>

      <form ref={formRef} onSubmit={submit} noValidate className="mt-6">
        {pedindoEmail ? (
          <div className="mx-auto max-w-sm space-y-2 text-left">
            <Label htmlFor="signup-resend-email">E-mail usado no cadastro</Label>
            <Input
              id="signup-resend-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={160}
              disabled={saving}
            />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          aria-expanded={conheceEmail ? undefined : pedindoEmail}
          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-(--r-md) px-3 text-sm font-medium text-fg-subtle underline underline-offset-4 transition-colors hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rotuloBotao}
        </button>
      </form>

      <div aria-live="polite" className="mt-4 text-left">
        {message ? <Alert variant="warning">{message}</Alert> : null}
      </div>
    </section>
  );
}
