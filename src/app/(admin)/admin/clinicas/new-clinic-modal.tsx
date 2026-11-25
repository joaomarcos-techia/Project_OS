'use client';

/**
 * Modal "+ Nova Clínica" (F1) — admin gera um convite mágico. Não cria tenant: cria
 * a INTENÇÃO. Em sucesso, mostra o link cru UMA vez (copiar) — o banco só guarda o HMAC.
 *
 * O form vive num filho keyed por `nonce`: "Criar outro convite" / fechar incrementam
 * o nonce → o filho remonta → `useActionState` zera → o form volta limpo (sem isso o
 * mesmo link reaparecia e exigia reload da página).
 */
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import type { PlanOption } from '../_lib/repositories/invites.repo';
import { createClinicInviteAction, type InviteCreateState } from '../actions/onboarding-invites';

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
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="size-4" />
          Nova Clínica
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova clínica · convite</DialogTitle>
          <DialogDescription>Convite para o gestor criar a conta da clínica.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <InviteFlow
            key={nonce}
            plans={plans}
            onReset={() => setNonce((n) => n + 1)}
            onClose={close}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
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
          {state.emailDelivery === 'sent'
            ? 'Convite criado e enviado por e-mail. O link expira em 24h e permanece disponível abaixo como contingência:'
            : state.emailDelivery === 'failed'
              ? 'Convite criado, mas não foi possível enviar o e-mail. Envie este link ao gestor; ele expira em 24h:'
              : 'Convite criado · expira em 24h. Envie o link ao gestor (mostrado só agora):'}
        </p>
        <div className="rounded-(--r-md) border border-border bg-surface-2 p-3">
          <p className="font-mono text-xs break-all text-fg">{fullLink}</p>
        </div>
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard
                ?.writeText(fullLink)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
          >
            {copied ? 'Copiado!' : 'Copiar link'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              Criar outro
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="E-mail do gestor"
        htmlFor="clinic-invite-manager-email"
        hint="Opcional. Quando preenchido, o convite é enviado automaticamente; o link também fica disponível como contingência."
      >
        <Input
          id="clinic-invite-manager-email"
          name="email"
          type="email"
          placeholder="gestor@clinica.com"
        />
      </Field>
      <Field label="Plano inicial sugerido" htmlFor="clinic-invite-plan">
        <Select id="clinic-invite-plan" name="planId" defaultValue="">
          <option value="">Sem sugestão</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação interna" htmlFor="clinic-invite-note" hint="Opcional.">
        <Input
          id="clinic-invite-note"
          name="note"
          maxLength={280}
          placeholder="ex.: indicação do Dr. Silva"
        />
      </Field>
      {state.error ? <span className="text-sm text-danger-600">{state.error}</span> : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          {pending ? 'Criando…' : 'Criar convite'}
        </Button>
      </div>
    </form>
  );
}
