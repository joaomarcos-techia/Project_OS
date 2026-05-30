'use client';

/**
 * Shared create/edit patient form (useActionState). Generates a stable
 * idempotency key on mount so a double-submit dedups (5.6.11). CPF/telefone are
 * sent in plaintext over the (TLS) action call and encrypted server-side — the
 * UI never sees ciphertext.
 */
import { useActionState, useMemo } from 'react';

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
    email: string;
    dataNascimento?: string | null;
    sexo?: 'M' | 'F' | 'O' | 'N' | null;
  };
}

export function PatientForm({ mode, action, initial }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <label className="flex flex-col gap-1 text-sm">
        <span>Nome</span>
        <input
          name="nome"
          required
          maxLength={120}
          defaultValue={initial?.nome}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>CPF{mode === 'edit' ? ' (deixe em branco para manter)' : ''}</span>
        <input
          name="cpf"
          required={mode === 'create'}
          inputMode="numeric"
          maxLength={14}
          pattern="[\d.\-\s]+"
          placeholder="000.000.000-00"
          defaultValue={initial?.cpf}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Telefone</span>
        <input
          name="telefone"
          type="tel"
          inputMode="tel"
          maxLength={20}
          pattern="[\d()\-\s+]+"
          placeholder="(11) 99999-9999"
          defaultValue={initial?.telefone ?? ''}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>E-mail</span>
        <input
          name="email"
          type="email"
          required={mode === 'create'}
          maxLength={120}
          defaultValue={initial?.email}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Data de nascimento</span>
        <input
          name="dataNascimento"
          type="date"
          defaultValue={initial?.dataNascimento ?? ''}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Sexo</span>
        <select
          name="sexo"
          defaultValue={initial?.sexo ?? ''}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2"
        >
          <option value="">—</option>
          <option value="M">Masculino</option>
          <option value="F">Feminino</option>
          <option value="O">Outro</option>
          <option value="N">Não informado</option>
        </select>
      </label>

      {state.error ? (
        <p className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Salvando…' : mode === 'create' ? 'Criar paciente' : 'Salvar alterações'}
      </button>
    </form>
  );
}
