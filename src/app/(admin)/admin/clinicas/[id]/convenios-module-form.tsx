'use client';

import { useActionState, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

import {
  setConveniosModuleAction,
  type ConveniosModuleFormState,
} from '../../actions/convenios-module';

const INITIAL: ConveniosModuleFormState = { error: null };

export interface ConveniosModuleView {
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  commercialDenial: string | null;
}

/**
 * P1.13 — Convênios por clínica: desligado por padrão; ligar exige a disponibilidade comercial da plataforma e
 * assinatura que inclua Convênios; toda mudança pede motivo e o código do autenticador (TOTP).
 */
export function ConveniosModuleForm({
  clinicId,
  view,
}: {
  clinicId: string;
  view: ConveniosModuleView;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(setConveniosModuleAction, INITIAL);
  const enabled =
    state.done === 'enabled' ? true : state.done === 'disabled' ? false : view.enabled;
  const target = !enabled;
  const blockedToEnable = target && (!view.available || view.commercialDenial !== null);

  return (
    <div data-convenios-module className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Convênios (TISS)</span>
        <Badge tone={enabled ? 'green' : 'gray'}>{enabled ? 'Ligado' : 'Desligado'}</Badge>
        {!view.available ? (
          <span className="text-xs text-fg-subtle">
            indisponível comercialmente na plataforma (`convenios.available` desligado)
          </span>
        ) : view.commercialDenial ? (
          <span className="text-xs text-fg-subtle">
            a assinatura desta clínica não inclui Convênios agora
          </span>
        ) : null}
      </div>
      {!open ? (
        <button
          type="button"
          disabled={blockedToEnable}
          onClick={() => setOpen(true)}
          className={buttonVariants({ variant: target ? 'primary' : 'secondary', size: 'sm' })}
        >
          {target ? 'Ligar Convênios' : 'Desligar Convênios'}
        </button>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="clinicId" value={clinicId} />
          <input type="hidden" name="enabled" value={String(target)} />
          <label className="text-sm">
            Motivo (fica na trilha da plataforma e na da clínica)
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={300}
              className="input mt-1 w-full"
              rows={2}
            />
          </label>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Código do autenticador"
            aria-label="Código do autenticador (TOTP)"
            className="input w-44"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              {pending ? 'Verificando…' : target ? 'Confirmar e ligar' : 'Confirmar e desligar'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {state.error ? <span className="text-sm text-danger-600">{state.error}</span> : null}
      {state.done === 'unchanged' ? (
        <span className="text-sm text-fg-subtle">Já estava assim: nada foi gravado.</span>
      ) : null}
    </div>
  );
}
