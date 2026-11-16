'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { todayYmdIn } from '@/lib/format';
import {
  adjustInsurancePayoutAction,
  authorizeInsurancePayoutAction,
  decidePayoutReviewAction,
  setPayoutReviewPolicyAction,
  setPayoutEligibilityAction,
  settleInsurancePayoutAction,
  syncInsurancePayoutsAction,
  type ActionResult,
} from '@/contexts/health-insurance/actions';
import { uuidv4 } from '@/lib/ui/uuid';

import { toCents } from './batch-ui';
import { ELIGIBILITY_LABELS } from './constants';

const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => todayYmdIn();

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    submit: <T,>(fn: () => Promise<ActionResult<T>>, success: string, after?: () => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(success);
        after?.();
        router.refresh();
      }),
  };
}

export function PayoutPolicyForm({ eligibility, canSync = true }: { eligibility: string; canSync?: boolean }) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [value, setValue] = useState(eligibility);
  return (
    <form
      className="flex flex-wrap items-end gap-(--sp-2)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => setPayoutEligibilityAction({ eligibility: value }),
          'Política de repasse atualizada',
        );
      }}
    >
      <Field
        label="Quando o repasse de convênio fica elegível"
        htmlFor={`${id}-pol`}
        hint="Vale para os repasses criados daqui em diante; os existentes mantêm a política com que nasceram."
      >
        <Select id={`${id}-pol`} value={value} onChange={(e) => setValue(e.target.value)}>
          {Object.entries(ELIGIBILITY_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={pending || value === eligibility}
      >
        {pending ? 'Aguarde…' : 'Salvar política'}
      </Button>
      {canSync ? <PayoutSyncButton /> : null}
    </form>
  );
}

/** Criar os repasses que faltam (faturamento). */
export function PayoutSyncButton() {
  const { pending, submit } = useSubmit();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => submit(() => syncInsurancePayoutsAction(), 'Repasses atualizados')}
    >
      Criar repasses que faltam
    </Button>
  );
}

type Mode = null | 'authorize' | 'settle' | 'adjust';

/** Ações de um repasse: autorizar (até o elegível), registrar o repasse realizado (até o devido) e ajustar com motivo. */
export function PayoutActions({
  payoutId,
  pendingAuthorizationCents,
  dueCents,
  decision,
}: {
  payoutId: string;
  pendingAuthorizationCents: number;
  dueCents: number;
  decision: string | null;
}) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [mode, setMode] = useState<Mode>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [key, setKey] = useState(() => uuidv4());
  const close = () => {
    setMode(null);
    setAmount('');
    setText('');
    setKey(uuidv4());
  };
  if (!mode) {
    return (
      <div className="flex flex-wrap gap-(--sp-1)">
        {pendingAuthorizationCents > 0 && !decision ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setMode('authorize');
              setAmount((pendingAuthorizationCents / 100).toFixed(2).replace('.', ','));
            }}
          >
            Autorizar
          </Button>
        ) : null}
        {dueCents > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setMode('settle');
              setAmount((dueCents / 100).toFixed(2).replace('.', ','));
            }}
          >
            Registrar repasse
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode('adjust')}>
          Ajustar
        </Button>
      </div>
    );
  }
  const cents = toCents(amount);
  return (
    <form
      className="flex w-full min-w-64 flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-2)"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'authorize')
          submit(
            () =>
              authorizeInsurancePayoutAction({ payoutId, amountCents: cents, idempotencyKey: key }),
            'Repasse autorizado',
            close,
          );
        if (mode === 'settle')
          submit(
            () =>
              settleInsurancePayoutAction({
                payoutId,
                amountCents: cents,
                paidOn: date,
                reference: text.trim() || null,
                idempotencyKey: key,
              }),
            'Repasse registrado',
            close,
          );
        if (mode === 'adjust')
          submit(
            () =>
              adjustInsurancePayoutAction({
                payoutId,
                amountCents: cents,
                reason: text,
                idempotencyKey: key,
              }),
            'Ajuste registrado',
            close,
          );
      }}
    >
      <Field
        label={
          mode === 'adjust'
            ? 'Valor do ajuste (negativo para reduzir)'
            : mode === 'settle'
              ? `Valor repassado (devido: ${brl(dueCents)})`
              : `Valor autorizado (elegível pendente: ${brl(pendingAuthorizationCents)})`
        }
        htmlFor={`${id}-v`}
        required
      >
        <Input
          id={`${id}-v`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {mode === 'settle' ? (
        <>
          <Field label="Data do repasse" htmlFor={`${id}-d`} required>
            <Input
              id={`${id}-d`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field
            label="Referência (opcional)"
            htmlFor={`${id}-r`}
            hint="Ex.: comprovante do Pix. O Qoro só registra; não paga ninguém."
          >
            <Input
              id={`${id}-r`}
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        </>
      ) : null}
      {mode === 'adjust' ? (
        <Field
          label="Motivo"
          htmlFor={`${id}-m`}
          hint="Ex.: decisão sobre regra fixa com glosa, compensação de estorno."
          required
        >
          <Textarea
            id={`${id}-m`}
            rows={2}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      ) : null}
      <div className="flex gap-(--sp-2)">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={
            pending ||
            !Number.isFinite(cents) ||
            cents === 0 ||
            (mode === 'adjust' && text.trim().length < 10)
          }
        >
          {pending ? 'Aguarde…' : 'Confirmar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/**
 * Segregação da revisão do repasse (0163; D-2: administração da clínica). Desligada por padrão:
 * clínicas de uma ou duas pessoas não travam. Ligada, ou com o valor em jogo no limite ou acima,
 * quem tirou a guia do atendimento não decide a revisão (o banco confere).
 */
export function PayoutReviewPolicyForm({
  segregation,
  independentAboveCents,
}: {
  segregation: boolean;
  independentAboveCents: number | null;
}) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [seg, setSeg] = useState(segregation);
  const [limit, setLimit] = useState(independentAboveCents === null ? '' : (independentAboveCents / 100).toFixed(2).replace('.', ','));
  const limitCents = limit.trim() === '' ? null : toCents(limit);
  const invalid = limitCents !== null && (!Number.isFinite(limitCents) || limitCents < 0);
  return (
    <form
      className="flex flex-wrap items-end gap-(--sp-2)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => setPayoutReviewPolicyAction({ segregation: seg, independentAboveCents: limitCents }), 'Regra da revisão atualizada');
      }}
    >
      <label className="flex items-center gap-(--sp-2) text-(length:--fs-sm)" htmlFor={`${id}-seg`}>
        <input id={`${id}-seg`} type="checkbox" checked={seg} onChange={(e) => setSeg(e.target.checked)} />
        Quem cancelou a guia não decide a revisão do repasse
      </label>
      <Field
        label="Exigir outra pessoa a partir de (R$, opcional)"
        htmlFor={`${id}-lim`}
        hint="Vale para manter ou reduzir o saldo; vazio = sem limite."
        {...(invalid ? { error: 'Informe um valor em reais, ou deixe vazio.' } : {})}
      >
        <Input id={`${id}-lim`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending || invalid}>
        {pending ? 'Aguarde…' : 'Salvar regra da revisão'}
      </Button>
    </form>
  );
}

type ReviewChoice = 'maintain' | 'reduce' | 'acknowledge';

/**
 * Decisão da revisão aberta (a guia saiu do atendimento). Com saldo autorizado não pago: manter
 * (libera o pagamento até o autorizado) ou reduzir (o ajuste vai no mesmo ato). Sem saldo: ciência
 * do repasse já pago — nada é compensado nem estornado pelo sistema.
 */
export function PayoutReviewForm({ reviewId, dueCents }: { reviewId: string; dueCents: number }) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const choices: Array<[ReviewChoice, string]> =
    dueCents > 0
      ? [['maintain', `Manter a obrigação (libera o pagamento de até ${brl(dueCents)})`], ['reduce', 'Reduzir a obrigação']]
      : [['acknowledge', 'Registrar ciência do repasse já pago']];
  const [choice, setChoice] = useState<ReviewChoice>(choices[0]![0]);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const cents = toCents(amount);
  const reduceInvalid = choice === 'reduce' && (!Number.isFinite(cents) || cents < 1 || cents > dueCents);
  return (
    <form
      className="flex w-full min-w-64 flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-2)"
      aria-label="Decidir a revisão do repasse"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () =>
            decidePayoutReviewAction({
              reviewId,
              decision: choice,
              reason,
              ...(choice === 'reduce' ? { reduceCents: cents } : {}),
            }),
          'Revisão decidida',
        );
      }}
    >
      <fieldset className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
        <legend className="font-medium">Decisão</legend>
        {choices.map(([value, label]) => (
          <label key={value} className="flex items-center gap-(--sp-2)">
            <input type="radio" name={`${id}-d`} value={value} checked={choice === value} onChange={() => setChoice(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      {choice === 'reduce' ? (
        <Field label={`Reduzir quanto (até ${brl(dueCents)})`} htmlFor={`${id}-v`} required>
          <Input id={`${id}-v`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Motivo" htmlFor={`${id}-m`} hint="10 a 500 caracteres; fica no histórico da revisão." required>
        <Textarea id={`${id}-m`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="primary" disabled={pending || reason.trim().length < 10 || reduceInvalid}>
        {pending ? 'Aguarde…' : 'Confirmar decisão'}
      </Button>
    </form>
  );
}
