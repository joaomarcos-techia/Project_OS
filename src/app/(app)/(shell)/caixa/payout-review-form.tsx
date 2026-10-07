'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatBRL } from '@/lib/format';
import { uuidv4 } from '@/lib/ui/uuid';

import { reviewProfessionalPayoutAction } from './actions';

/**
 * Revisão humana do repasse suspenso após estorno ou perda. O teto é o cálculo
 * original; a proporção é só referência e nunca é aplicada sozinha. O servidor
 * revalida teto, estado e permissão; cada envio vira uma versão imutável.
 */
export function PayoutReviewForm({
  payoutId,
  ceilingAmount,
  referenceAmount,
  nextVersion,
}: {
  payoutId: string;
  ceilingAmount: number;
  referenceAmount: number | null;
  nextVersion: number;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = Number(amount.trim().replace(',', '.'));
  const cents = Math.round(parsed * 100);
  const amountValid =
    amount.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    Math.abs(parsed * 100 - cents) < 1e-6 &&
    cents <= Math.round(ceilingAmount * 100);
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500;

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-2 min-h-(--hit-target)"
        onClick={() => setOpen(true)}
      >
        {nextVersion === 1 ? 'Revisar repasse' : 'Registrar nova revisão'}
      </Button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await reviewProfessionalPayoutAction(
        { payoutId, amount: cents / 100, reason: reason.trim() },
        uuidv4(),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setAmount('');
      setReason('');
      router.refresh();
    });
  };

  return (
    <div className="mt-2 grid gap-2 rounded-(--r-md) border border-border bg-surface p-3">
      <p className="text-(length:--fs-xs) font-semibold text-fg">
        Revisão do repasse — versão {nextVersion}
      </p>
      <p className="text-pretty text-(length:--fs-2xs) text-fg-muted">
        Teto: {formatBRL(ceilingAmount)}, o cálculo original.
        {referenceAmount === null
          ? ' Sem referência proporcional disponível.'
          : ` Referência proporcional ao valor que ficou com a clínica: ${formatBRL(referenceAmount)} (não é aplicada sozinha).`}
      </p>
      <Field
        label="Valor devido ao profissional"
        htmlFor={`${id}-amount`}
        hint={`Entre ${formatBRL(0)} e ${formatBRL(ceilingAmount)}`}
        error={amount.trim() !== '' && !amountValid ? 'Valor fora do limite permitido.' : undefined}
      >
        <Input
          id={`${id}-amount`}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field
        label="Motivo da decisão"
        htmlFor={`${id}-reason`}
        hint="Fica registrado nesta versão. Para corrigir, registre outra versão."
      >
        <Textarea
          id={`${id}-reason`}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-(length:--fs-xs) font-medium text-danger-600">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-(--hit-target)"
          loading={pending}
          disabled={!amountValid || !reasonValid || pending}
          onClick={submit}
        >
          Registrar versão {nextVersion}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-(--hit-target)"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
