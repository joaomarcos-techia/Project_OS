'use client';

import { Link2, ShieldCheck, Users } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';

import type { PatientRelationshipDTO } from '@/contexts/patient/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

import {
  linkPatientRelationshipForm,
  buscarPacientesRelacionamento,
  mergePatientsForm,
  type PatientFormState,
  unlinkPatientRelationshipForm,
} from '../actions';

const INITIAL: PatientFormState = { error: null };
const RELATIONSHIP_LABELS: Record<PatientRelationshipDTO['relationshipType'], string> = {
  mae: 'Mãe',
  pai: 'Pai',
  tutor_legal: 'Tutor legal',
  responsavel: 'Responsável',
  outro: 'Outro',
};

function RelationshipRow({
  currentPatientId,
  relationship,
}: {
  currentPatientId: string;
  relationship: PatientRelationshipDTO;
}) {
  const [state, action, pending] = useActionState(unlinkPatientRelationshipForm, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);
  const currentIsDependent = relationship.dependentPatientId === currentPatientId;
  const counterpart = currentIsDependent
    ? relationship.responsibleName
    : relationship.dependentName;

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="grid size-8 place-items-center rounded-(--r-sm) bg-surface-inset text-fg-muted">
        {currentIsDependent ? <ShieldCheck className="size-4" /> : <Users className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{counterpart}</p>
        <p className="text-xs text-fg-subtle">
          {currentIsDependent ? 'Responsável' : 'Dependente'} ·{' '}
          {RELATIONSHIP_LABELS[relationship.relationshipType]}
          {relationship.legalGuardian ? ' · legal' : ''}
          {relationship.financialResponsible ? ' · financeiro' : ''}
          {relationship.canManageAppointments ? ' · agenda' : ''}
        </p>
        {state.error ? <p className="mt-1 text-xs text-danger-600">{state.error}</p> : null}
      </div>
      <form action={action}>
        <input type="hidden" name="relationshipId" value={relationship.id} />
        <input type="hidden" name="patientId" value={currentPatientId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <Button type="submit" variant="ghost" size="sm" loading={pending}>
          Remover
        </Button>
      </form>
    </li>
  );
}

export function PatientRelationshipsCard({
  patientId,
  relationships,
}: {
  patientId: string;
  relationships: PatientRelationshipDTO[];
}) {
  const [linkState, linkAction, linking] = useActionState(linkPatientRelationshipForm, INITIAL);
  const [mergeState, mergeAction, merging] = useActionState(mergePatientsForm, INITIAL);
  const linkKey = useMemo(() => uuidv4(), []);
  const mergeKey = useMemo(() => uuidv4(), []);
  const [responsible, setResponsible] = useState<ComboboxItem | null>(null);
  const [mergeTarget, setMergeTarget] = useState<ComboboxItem | null>(null);
  const searchCandidates = (term: string) => buscarPacientesRelacionamento(term, patientId);

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-(--card-pad) py-3.5">
        <Link2 className="size-4 text-fg-muted" />
        <h4 className="text-(length:--fs-sm) font-semibold">Responsáveis e dependentes</h4>
      </div>
      <div className="grid gap-6 p-(--card-pad) lg:grid-cols-2">
        <div>
          <h5 className="text-sm font-medium">Vínculos cadastrados</h5>
          {relationships.length === 0 ? (
            <p className="mt-2 text-sm text-fg-subtle">Nenhum vínculo cadastrado.</p>
          ) : (
            <ul className="mt-1">
              {relationships.map((relationship) => (
                <RelationshipRow
                  key={relationship.id}
                  currentPatientId={patientId}
                  relationship={relationship}
                />
              ))}
            </ul>
          )}
        </div>

        <form action={linkAction} className="flex flex-col gap-3.5">
          <input type="hidden" name="dependentPatientId" value={patientId} />
          <input type="hidden" name="idempotencyKey" value={linkKey} />
          <h5 className="text-sm font-medium">Adicionar responsável</h5>
          {linkState.error ? <Alert variant="danger">{linkState.error}</Alert> : null}
          <Field label="Paciente responsável" required>
            <input type="hidden" name="responsiblePatientId" value={responsible?.id ?? ''} />
            <Combobox
              value={responsible}
              onSelect={setResponsible}
              onSearch={searchCandidates}
              placeholder="Buscar paciente por nome…"
              emptyLabel="Nenhum paciente encontrado."
              disabled={linking}
            />
          </Field>
          <Field label="Vínculo" required>
            <Select name="relationshipType" defaultValue="responsavel" disabled={linking}>
              <option value="mae">Mãe</option>
              <option value="pai">Pai</option>
              <option value="tutor_legal">Tutor legal</option>
              <option value="responsavel">Responsável</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
            <label className="flex items-center gap-2">
              <Checkbox name="legalGuardian" defaultChecked /> Legal
            </label>
            <label className="flex items-center gap-2">
              <Checkbox name="financialResponsible" /> Financeiro
            </label>
            <label className="flex items-center gap-2">
              <Checkbox name="canManageAppointments" defaultChecked /> Agenda
            </label>
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={linking}
            disabled={!responsible}
            className="self-start"
          >
            Adicionar vínculo
          </Button>
        </form>
      </div>

      <div className="border-t border-danger-200 bg-danger-50/50 p-(--card-pad)">
        <form
          action={mergeAction}
          className="grid gap-3.5 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end"
        >
          <input type="hidden" name="sourcePatientId" value={patientId} />
          <input type="hidden" name="idempotencyKey" value={mergeKey} />
          <Field
            label="Mesclar este cadastro em"
            hint="Este cadastro será arquivado; o destino será mantido."
          >
            <input type="hidden" name="targetPatientId" value={mergeTarget?.id ?? ''} />
            <Combobox
              value={mergeTarget}
              onSelect={setMergeTarget}
              onSearch={searchCandidates}
              placeholder="Buscar cadastro correto…"
              emptyLabel="Nenhum paciente encontrado."
              disabled={merging}
            />
          </Field>
          <Field label="Justificativa" required>
            <Textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={2}
              placeholder="Ex.: cadastro duplicado confirmado por CPF e data de nascimento"
              disabled={merging}
            />
          </Field>
          <Button type="submit" variant="danger" loading={merging} disabled={!mergeTarget}>
            Mesclar cadastro
          </Button>
          {mergeState.error ? (
            <Alert variant="danger" className="lg:col-span-3">
              {mergeState.error}
            </Alert>
          ) : null}
        </form>
      </div>
    </Card>
  );
}
