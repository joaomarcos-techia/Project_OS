'use client';

/**
 * Modal "+ Nova Clínica" (F1) — admin gera um convite mágico. Não cria tenant: cria
 * a INTENÇÃO. Em sucesso, mostra o link cru UMA vez (copiar) — o banco só guarda o HMAC.
 *
 * O form vive num filho keyed por `nonce`: "Criar outro convite" / fechar incrementam
 * o nonce → o filho remonta → `useActionState` zera → o form volta limpo (sem isso o
 * mesmo link reaparecia e exigia reload da página).
 */
import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/painel/icons';

import { createClinicInviteAction, type InviteCreateState } from '../actions/onboarding-invites';
import type { PlanOption } from '../_lib/repositories/invites.repo';

const INITIAL: InviteCreateState = { error: null };

export function NewClinicModal({ plans }: { plans: PlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  const close = () => {
    setOpen(false);
    setNonce((n) => n + 1); // próxima abertura começa no form limpo
    router.refresh(); // atualiza a lista "Convites" sem bloquear o submit
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
        <Icon name="plus" size={16} />
        Nova Clínica
      </button>

      {open ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-fg">Nova clínica · convite</h3>
              <button type="button" onClick={close} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label="Fechar">
                <Icon name="x" size={16} />
              </button>
            </div>

            <InviteFlow
              key={nonce}
              plans={plans}
              onReset={() => setNonce((n) => n + 1)}
              onClose={close}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function InviteFlow({
  plans,
  onReset,
  onClose,
}: {
  plans: PlanOption[];
  onReset: () => void;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createClinicInviteAction, INITIAL);
  const [copied, setCopied] = useState(false);

  const fullLink = state.link
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}${state.link}`
    : '';

  if (state.link) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">
          Convite criado · expira em 24h. Envie o link ao gestor (mostrado só agora):
        </p>
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <p className="break-all font-mono text-xs text-fg">{fullLink}</p>
        </div>
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(fullLink).then(() => setCopied(true)).catch(() => {});
            }}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {copied ? 'Copiado!' : 'Copiar link'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onReset} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Criar outro
            </button>
            <button type="button" onClick={onClose} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="text-xs text-fg-muted">
        E-mail do gestor (opcional)
        <input name="email" type="email" placeholder="gestor@clinica.com" className="input mt-1" />
      </label>
      <label className="text-xs text-fg-muted">
        Plano inicial sugerido
        <select name="planId" defaultValue="" className="select mt-1">
          <option value="">Sem sugestão</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-fg-muted">
        Observação interna (opcional)
        <input name="note" maxLength={280} placeholder="ex.: indicação do Dr. Silva" className="input mt-1" />
      </label>
      {state.error ? <span className="text-sm text-danger-600">{state.error}</span> : null}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Cancelar
        </button>
        <button type="submit" disabled={pending} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
          {pending ? 'Criando…' : 'Criar convite'}
        </button>
      </div>
    </form>
  );
}
