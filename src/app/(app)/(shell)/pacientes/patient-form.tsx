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
  /** true = botão de submit em barra sticky (uso dentro de Drawer). */
  stickyAction?: boolean;
  initial?: {
    id: string;
    nome: string;
    cpf?: string;
    telefone?: string | null;
    email?: string | null; // C12: paciente do agente pode não ter e-mail
    dataNascimento?: string | null;
    sexo?: 'M' | 'F' | 'O' | 'N' | null;
    endereco?: {
      logradouro: string;
      complemento?: string | null;
      cidade: string;
      estado: string;
      cep: string;
    } | null;
  };
}

export function PatientForm({ mode, action, initial, stickyAction = false }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3.5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Nome">
          <Input
            name="nome"
            required
            maxLength={120}
            defaultValue={initial?.nome}
            disabled={pending}
          />
        </Field>

        <Field label={`CPF${mode === 'edit' ? ' (em branco = manter)' : ''}`}>
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
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Telefone">
          <Input
            name="telefone"
            type="tel"
            inputMode="tel"
            maxLength={20}
            pattern="[\d\(\)\-\s+]+"
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

      <div className="grid gap-3.5 sm:grid-cols-2">
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

      <fieldset className="grid gap-3.5 rounded-(--r-md) border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-fg-muted">
          Endereço{' '}
          <span className="font-normal text-fg-subtle">
            (necessário para receituário de controle especial)
          </span>
        </legend>

        <Field label="Logradouro (rua, número)">
          <Input
            name="endLogradouro"
            maxLength={300}
            placeholder="Rua das Flores, 50"
            defaultValue={initial?.endereco?.logradouro ?? ''}
            disabled={pending}
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Complemento">
            <Input
              name="endComplemento"
              maxLength={120}
              placeholder="Apto 12 (opcional)"
              defaultValue={initial?.endereco?.complemento ?? ''}
              disabled={pending}
            />
          </Field>
          <Field label="CEP">
            <Input
              name="endCep"
              maxLength={20}
              inputMode="numeric"
              placeholder="01000-000"
              defaultValue={initial?.endereco?.cep ?? ''}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
          <Field label="Cidade">
            <Input
              name="endCidade"
              maxLength={120}
              placeholder="São Paulo"
              defaultValue={initial?.endereco?.cidade ?? ''}
              disabled={pending}
            />
          </Field>
          <Field label="UF">
            <Input
              name="endEstado"
              maxLength={2}
              placeholder="SP"
              defaultValue={initial?.endereco?.estado ?? ''}
              disabled={pending}
            />
          </Field>
        </div>
      </fieldset>

      <div
        className={
          stickyAction
            ? 'sticky bottom-0 -mx-(--sp-6) -mb-(--sp-6) mt-1 flex gap-2 border-t border-border bg-surface px-(--sp-6) py-3.5'
            : 'flex gap-2'
        }
      >
        <Button type="submit" loading={pending}>
          {mode === 'create' ? 'Criar paciente' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
