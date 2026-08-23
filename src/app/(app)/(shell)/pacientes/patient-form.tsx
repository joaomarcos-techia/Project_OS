'use client';

/**
 * Shared create/edit patient form (useActionState). Generates a stable
 * idempotency key on mount so a double-submit dedups (5.6.11). CPF/telefone are
 * sent in plaintext over the (TLS) action call and encrypted server-side — the
 * UI never sees ciphertext.
 */
import { useActionState, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { FormSection } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import type { PatientFormState } from './actions';
import { maskCpf, maskPhoneBR } from '@/lib/masks';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: PatientFormState = { error: null };

interface Props {
  mode: 'create' | 'edit';
  action: (prev: PatientFormState, fd: FormData) => Promise<PatientFormState>;
  /** true = botão de submit em barra sticky (uso dentro de Drawer). */
  stickyAction?: boolean;
  guardianCandidates?: Array<{ id: string; nome: string }>;
  initial?: {
    /** DATA-002 — versão lida na abertura; volta no submit para o compare-and-swap. */
    updatedAt?: string;
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

type PatientFormDraft = {
  nome: string;
  email: string;
  sexo: string;
  endLogradouro: string;
  endComplemento: string;
  endCidade: string;
  endEstado: string;
  endCep: string;
  guardianPatientId: string;
  guardianRelationshipType: string;
  guardianLegal: boolean;
  guardianFinancial: boolean;
  guardianScheduling: boolean;
};

function initialDraft(initial: Props['initial']): PatientFormDraft {
  return {
    nome: initial?.nome ?? '',
    email: initial?.email ?? '',
    sexo: initial?.sexo ?? '',
    endLogradouro: initial?.endereco?.logradouro ?? '',
    endComplemento: initial?.endereco?.complemento ?? '',
    endCidade: initial?.endereco?.cidade ?? '',
    endEstado: initial?.endereco?.estado ?? '',
    endCep: initial?.endereco?.cep ?? '',
    guardianPatientId: '',
    guardianRelationshipType: 'responsavel',
    guardianLegal: true,
    guardianFinancial: false,
    guardianScheduling: true,
  };
}

export function PatientForm({
  mode,
  action,
  initial,
  stickyAction = false,
  guardianCandidates = [],
}: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);
  // Server Actions re-renderizam o form quando devolvem erro. Todo campo que
  // não era controlado perdia o que o usuário digitou nesse round-trip; o
  // rascunho local mantém o formulário íntegro para correção e reenvio.
  const [draft, setDraft] = useState<PatientFormDraft>(() => initialDraft(initial));
  // Máscaras UX (o servidor re-normaliza no submit — @/lib/masks docstring).
  const [cpf, setCpf] = useState(() => maskCpf(initial?.cpf ?? ''));
  const [telefone, setTelefone] = useState(() => maskPhoneBR(initial?.telefone ?? ''));
  const setDraftField = <K extends keyof PatientFormDraft>(key: K, value: PatientFormDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3.5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {/* DATA-002 — a versão que ESTA tela leu. O backend só grava se o banco
          ainda estiver nela; quem partiu de estado velho recebe conflito em vez
          de sobrescrever em silêncio. */}
      {initial?.updatedAt ? (
        <input type="hidden" name="expectedUpdatedAt" value={initial.updatedAt} />
      ) : null}

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <FormSection label="Identificação">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Nome" htmlFor="patient-name">
            <Input
              id="patient-name"
              name="nome"
              required
              maxLength={120}
              value={draft.nome}
              onChange={(event) => setDraftField('nome', event.target.value)}
              disabled={pending}
            />
          </Field>

          <Field
            label={`CPF${mode === 'edit' ? ' (em branco = manter)' : ''}`}
            htmlFor="patient-cpf"
          >
            <Input
              id="patient-cpf"
              name="cpf"
              required={mode === 'create'}
              inputMode="numeric"
              maxLength={14}
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              disabled={pending}
            />
          </Field>
        </div>
      </FormSection>

      {mode === 'create' ? (
        <fieldset className="grid gap-3.5 rounded-(--r-md) border border-border p-4">
          <legend className="px-1 text-sm font-medium text-fg-muted">
            Responsável do menor{' '}
            <span className="font-normal text-fg-subtle">(quando aplicável)</span>
          </legend>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field
              label="Paciente responsável"
              htmlFor="patient-guardian"
              hint="Obrigatório quando a data de nascimento indicar menos de 18 anos."
            >
              <Select
                id="patient-guardian"
                name="guardianPatientId"
                value={draft.guardianPatientId}
                onChange={(event) => setDraftField('guardianPatientId', event.target.value)}
                disabled={pending}
              >
                <option value="">Selecione…</option>
                {guardianCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vínculo" htmlFor="patient-guardian-relationship">
              <Select
                id="patient-guardian-relationship"
                name="guardianRelationshipType"
                value={draft.guardianRelationshipType}
                onChange={(event) => setDraftField('guardianRelationshipType', event.target.value)}
                disabled={pending}
              >
                <option value="mae">Mãe</option>
                <option value="pai">Pai</option>
                <option value="tutor_legal">Tutor legal</option>
                <option value="responsavel">Responsável</option>
                <option value="outro">Outro</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
            <label className="flex items-center gap-2">
              <Checkbox
                name="guardianLegal"
                checked={draft.guardianLegal}
                onCheckedChange={(value) => setDraftField('guardianLegal', value === true)}
              />{' '}
              Responsável legal
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                name="guardianFinancial"
                checked={draft.guardianFinancial}
                onCheckedChange={(value) => setDraftField('guardianFinancial', value === true)}
              />{' '}
              Responsável financeiro
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                name="guardianScheduling"
                checked={draft.guardianScheduling}
                onCheckedChange={(value) => setDraftField('guardianScheduling', value === true)}
              />{' '}
              Pode gerir agendamentos
            </label>
          </div>
        </fieldset>
      ) : null}

      <FormSection label="Contato">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Telefone" htmlFor="patient-phone">
            <Input
              id="patient-phone"
              name="telefone"
              type="tel"
              inputMode="tel"
              maxLength={16}
              placeholder="(11) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(maskPhoneBR(e.target.value))}
              disabled={pending}
            />
          </Field>

          <Field label="E-mail" htmlFor="patient-email">
            <Input
              id="patient-email"
              name="email"
              type="email"
              required={mode === 'create'}
              maxLength={120}
              value={draft.email}
              onChange={(event) => setDraftField('email', event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection label="Dados pessoais">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Data de nascimento" htmlFor="patient-birth-date">
            <DateField
              id="patient-birth-date"
              name="dataNascimento"
              defaultValue={initial?.dataNascimento ?? ''}
              disabled={pending}
            />
          </Field>

          <Field label="Sexo" htmlFor="patient-sex">
            <Select
              id="patient-sex"
              name="sexo"
              value={draft.sexo}
              onChange={(event) => setDraftField('sexo', event.target.value)}
              disabled={pending}
            >
              <option value="">—</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
              <option value="O">Outro</option>
              <option value="N">Não informado</option>
            </Select>
          </Field>
        </div>
      </FormSection>

      <fieldset className="grid gap-3.5 rounded-(--r-md) border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-fg-muted">
          Endereço{' '}
          <span className="font-normal text-fg-subtle">
            (necessário para receituário de controle especial)
          </span>
        </legend>

        <Field label="Logradouro (rua, número)" htmlFor="patient-address-street">
          <Input
            id="patient-address-street"
            name="endLogradouro"
            maxLength={300}
            placeholder="Rua das Flores, 50"
            value={draft.endLogradouro}
            onChange={(event) => setDraftField('endLogradouro', event.target.value)}
            disabled={pending}
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Complemento" htmlFor="patient-address-complement">
            <Input
              id="patient-address-complement"
              name="endComplemento"
              maxLength={120}
              placeholder="Apto 12 (opcional)"
              value={draft.endComplemento}
              onChange={(event) => setDraftField('endComplemento', event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label="CEP" htmlFor="patient-address-postal-code">
            <Input
              id="patient-address-postal-code"
              name="endCep"
              maxLength={20}
              inputMode="numeric"
              placeholder="01000-000"
              value={draft.endCep}
              onChange={(event) => setDraftField('endCep', event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
          <Field label="Cidade" htmlFor="patient-address-city">
            <Input
              id="patient-address-city"
              name="endCidade"
              maxLength={120}
              placeholder="São Paulo"
              value={draft.endCidade}
              onChange={(event) => setDraftField('endCidade', event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label="UF" htmlFor="patient-address-state">
            <Input
              id="patient-address-state"
              name="endEstado"
              maxLength={2}
              placeholder="SP"
              value={draft.endEstado}
              onChange={(event) => setDraftField('endEstado', event.target.value)}
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
