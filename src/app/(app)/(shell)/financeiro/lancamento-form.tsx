'use client';

import { useActionState, useMemo, useState } from 'react';

import type { PaymentMethodDTO, SupplierSummary } from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { createLancamentoFormAction, type FormState } from './lancamento-actions';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: FormState = { error: null };

export function LancamentoForm({
  suppliers,
  methods,
}: {
  suppliers: SupplierSummary[];
  methods: PaymentMethodDTO[];
}) {
  const [state, formAction, pending] = useActionState(createLancamentoFormAction, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);
  const [tipo, setTipo] = useState<'receber' | 'pagar'>('receber');

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <Field label="Tipo" htmlFor="lancamento-type">
        <Select
          id="lancamento-type"
          name="tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as 'receber' | 'pagar')}
        >
          <option value="receber">A receber</option>
          <option value="pagar">A pagar</option>
        </Select>
      </Field>

      <Field label="Descrição" htmlFor="lancamento-description">
        <Input
          id="lancamento-description"
          name="descricao"
          required
          maxLength={200}
          placeholder="Ex.: Mensalidade, material…"
          disabled={pending}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor (R$)" htmlFor="lancamento-value">
          <Input
            id="lancamento-value"
            name="valor"
            required
            inputMode="decimal"
            placeholder="0,00"
            disabled={pending}
          />
        </Field>
        <Field label="Vencimento" htmlFor="lancamento-due-date" hint="Opcional">
          <DateField id="lancamento-due-date" name="dueDate" disabled={pending} />
        </Field>
      </div>

      {tipo === 'pagar' ? (
        <Field label="Fornecedor" htmlFor="lancamento-supplier" hint="Opcional">
          <Select id="lancamento-supplier" name="supplierId" defaultValue="" disabled={pending}>
            <option value="">—</option>
            {suppliers
              .filter((s) => s.ativo)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.razaoSocial}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}

      <Field
        label="Forma de pagamento"
        htmlFor="lancamento-payment-method"
        hint="Opcional (pode ser definida na hora do pagamento)"
      >
        <Select
          id="lancamento-payment-method"
          name="paymentMethod"
          defaultValue=""
          disabled={pending}
        >
          <option value="">—</option>
          {methods.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Criar lançamento
        </Button>
      </div>
    </form>
  );
}
