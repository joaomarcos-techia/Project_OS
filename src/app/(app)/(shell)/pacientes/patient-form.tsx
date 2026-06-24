'use client';

/**
 * Shared create/edit patient form (useActionState). Generates a stable
 * idempotency key on mount so a double-submit dedups (5.6.11). CPF/telefone are
 * sent in plaintext over the (TLS) action call and encrypted server-side — the
 * UI never sees ciphertext.
 */
import { useActionState, useMemo } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import type { PatientFormState } from './actions';

const INITIAL: PatientFormState = { error: null };

interface Props {
  mode: 'create' | 'edit';
  action: (prev: PatientFormState, fd: FormData) => Promise<PatientFormState>;
  initial?: {
    id: string;
    nome: string;
    cpf?: string;
    telefone?: string | null;
    email?: string | null; // C12: paciente do agente pode não ter e-mail
    dataNascimento?: string | null;
    sexo?: 'M' | 'F' | 'O' | 'N' | null;
  };
}

export function PatientForm({ mode, action, initial }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <Field label="Nome">
        <Input
          name="nome"
          required
          maxLength={120}
          defaultValue={initial?.nome}
          disabled={pending}
        />
      </Field>

      <Field label={`CPF${mode === 'edit' ? ' (deixe em branco para manter)' : ''}`}>
        <Input
          name="cpf"
          required={mode === 'create'}
          inputMode="numeric"
          maxLength={14}
          pattern="[\d.\-\s]+"
          placeholder="000.000.000-00"
          defaultValue={initial?.cpf}
          disabled={pending}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Telefone">
          <Input
            name="telefone"
            type="tel"
            inputMode="tel"
            maxLength={20}
            pattern="[\d()\-\s+]+"
            placeholder="(11) 99999-9999"
            defaultValue={initial?.telefone ?? ''}
            disabled={pending}
          />
        </Field>

        <Field label="E-mail">
          <Input
            name="email"
            type="email"
            required={mode === 'create'}
            maxLength={120}
            defaultValue={initial?.email ?? ''}
            disabled={pending}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Data de nascimento">
          <DateField
            name="dataNascimento"
            defaultValue={initial?.dataNascimento ?? ''}
            disabled={pending}
          />
        </Field>

        <Field label="Sexo">
          <Select name="sexo" defaultValue={initial?.sexo ?? ''} disabled={pending}>
            <option value="">—</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
            <option value="O">Outro</option>
            <option value="N">Não informado</option>
          </Select>
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {mode === 'create' ? 'Criar paciente' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
