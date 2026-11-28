'use client';

/**
 * Conferir, confirmar e dispensar a coparticipação (P5.3). O valor sugerido é o
 * calculado na conclusão; quem confere pode corrigi-lo (fica registrado), e quem
 * confirma decide o que é cobrável (nunca acima do confirmado). Só aqui nasce o valor
 * que o paciente paga — nunca o valor do atendimento.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import type { CopayToReview } from '@/contexts/health-insurance/config-queries';

import { toCents } from './batch-ui';
import { checkCopayReviewAction, confirmCopayReviewAction, waiveCopayReviewAction } from './copay-review-actions';

const brlInput = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

export function CopayReview({ copay, canCheck, canConfirm }: { copay: CopayToReview; canCheck: boolean; canConfirm: boolean }) {
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState(brlInput(copay.checkedCents ?? copay.calculatedCents ?? copay.expectedCents));
  const [chargeable, setChargeable] = useState(brlInput(copay.checkedCents));
  const [reason, setReason] = useState('');
  const [waiving, setWaiving] = useState(false);
  const go = (fn: () => Promise<{ ok: true; data: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.data);
        router.refresh();
      } else toast.error(r.error);
    });
  const value = (v: string) => {
    const c = toCents(v);
    return c === null || Number.isNaN(c) ? null : c;
  };

  return (
    <div className="flex flex-col gap-(--sp-2)" data-testid="copay-review" data-status={copay.status}>
      {copay.status === 'calculated' && canCheck ? (
        <form
          className="flex flex-wrap items-end gap-(--sp-2)"
          onSubmit={(e) => {
            e.preventDefault();
            const c = value(checked);
            if (c === null) return toast.error('Informe o valor conferido (R$).');
            go(() => checkCopayReviewAction({ copaymentId: copay.id, checkedCents: c }));
          }}
        >
          <Field label="Valor conferido (R$)" htmlFor={`${id}-checked`}>
            <Input id={`${id}-checked`} value={checked} inputMode="decimal" onChange={(e) => setChecked(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Aguarde…' : 'Conferir'}
          </Button>
        </form>
      ) : null}
      {copay.status === 'checked' && canConfirm ? (
        <form
          className="flex flex-wrap items-end gap-(--sp-2)"
          onSubmit={(e) => {
            e.preventDefault();
            const conf = copay.checkedCents ?? 0;
            const ch = value(chargeable);
            if (ch === null) return toast.error('Informe quanto cobrar do paciente (R$).');
            go(() => confirmCopayReviewAction({ copaymentId: copay.id, confirmedCents: conf, chargeableCents: ch }));
          }}
        >
          <Field label="A cobrar do paciente (R$)" htmlFor={`${id}-charge`} hint={`Até ${brlInput(copay.checkedCents)} (o conferido).`}>
            <Input id={`${id}-charge`} value={chargeable} inputMode="decimal" onChange={(e) => setChargeable(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Aguarde…' : 'Confirmar coparticipação'}
          </Button>
        </form>
      ) : null}
      {canConfirm ? (
        waiving ? (
          <form
            className="flex flex-col gap-(--sp-2)"
            onSubmit={(e) => {
              e.preventDefault();
              go(() => waiveCopayReviewAction({ copaymentId: copay.id, reason }));
            }}
          >
            <Field label="Motivo da dispensa" htmlFor={`${id}-reason`} required>
              <Textarea id={`${id}-reason`} value={reason} rows={2} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-(--sp-2)">
              <Button type="submit" size="sm" variant="danger" disabled={pending || reason.trim().length < 10}>
                Dispensar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(false)}>
                Voltar
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(true)}>
            Dispensar coparticipação
          </Button>
        )
      ) : null}
    </div>
  );
}
