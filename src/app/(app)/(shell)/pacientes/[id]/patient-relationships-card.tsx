'use client';

import { Link2, ShieldCheck, Users } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';

import type { PatientRelationshipDTO } from '@/contexts/patient/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui/cn';
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
  canRemove,
}: {
  currentPatientId: string;
  relationship: PatientRelationshipDTO;
  canRemove: boolean;
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
      {canRemove ? (
        <form action={action}>
          <input type="hidden" name="relationshipId" value={relationship.id} />
          <input type="hidden" name="patientId" value={currentPatientId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="min-h-(--hit-target)"
            loading={pending}
          >
            Remover
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function PatientRelationshipsCard({
  patientId,
  relationships,
  canEdit,
  className,
}: {
  patientId: string;
  relationships: PatientRelationshipDTO[];
  canEdit: boolean;
  className?: string;
}) {
  const [linkState, linkAction, linking] = useActionState(linkPatientRelationshipForm, INITIAL);
  const [mergeState, mergeAction, merging] = useActionState(mergePatientsForm, INITIAL);
  const linkKey = useMemo(() => uuidv4(), []);
  const mergeKey = useMemo(() => uuidv4(), []);
  const [responsible, setResponsible] = useState<ComboboxItem | null>(null);
  const [mergeTarget, setMergeTarget] = useState<ComboboxItem | null>(null);
  const [managing, setManaging] = useState(false);
  const searchCandidates = (term: string) => buscarPacientesRelacionamento(term, patientId);

  return (
    <Card data-patient-section="relationships" className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-(--card-pad) py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          <h2 className="text-balance text-(length:--fs-h4) font-semibold">
            Responsáveis e dependentes
          </h2>
          <Badge tone="gray" className="tabular-nums">
            {relationships.length}
          </Badge>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant={managing ? 'ghost' : 'secondary'}
            size="sm"
            className="min-h-(--hit-target)"
            aria-expanded={managing}
            aria-controls="patient-relationships-manager"
            onClick={() => setManaging((current) => !current)}
          >
            {managing ? 'Concluir' : 'Gerenciar vínculos'}
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border px-(--card-pad) py-3">
        {relationships.length === 0 ? (
          <p className="text-pretty text-sm text-fg-subtle">Nenhum vínculo cadastrado.</p>
        ) : (
          <ul>
            {relationships.map((relationship) => (
              <RelationshipRow
                key={relationship.id}
                currentPatientId={patientId}
                relationship={relationship}
                canRemove={canEdit && managing}
              />
            ))}
          </ul>
        )}
      </div>

      {canEdit && managing ? (
        <div
          id="patient-relationships-manager"
          className="grid gap-6 border-t border-border p-(--card-pad) lg:grid-cols-2"
        >
          <form action={linkAction} className="flex flex-col gap-3.5">
            <input type="hidden" name="dependentPatientId" value={patientId} />
            <input type="hidden" name="idempotencyKey" value={linkKey} />
            <h5 className="text-sm font-medium">Adicionar responsável</h5>
            {linkState.error ? <Alert variant="danger">{linkState.error}</Alert> : null}
            <Field label="Paciente responsável" htmlFor="relationship-responsible-patient" required>
              <input type="hidden" name="responsiblePatientId" value={responsible?.id ?? ''} />
              <Combobox
                id="relationship-responsible-patient"
                value={responsible}
                onSelect={setResponsible}
                onSearch={searchCandidates}
                placeholder="Buscar paciente por nome…"
                emptyLabel="Nenhum paciente encontrado."
                disabled={linking}
              />
            </Field>
            <Field label="Vínculo" htmlFor="relationship-type" required>
              <Select
                id="relationship-type"
                name="relationshipType"
                defaultValue="responsavel"
                disabled={linking}
              >
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
              className="min-h-(--hit-target) self-start"
            >
              Adicionar vínculo
            </Button>
          </form>

          <form action={mergeAction} className="flex flex-col gap-3.5">
            <input type="hidden" name="sourcePatientId" value={patientId} />
            <input type="hidden" name="idempotencyKey" value={mergeKey} />
            <h5 className="text-sm font-medium text-danger-700">Mesclar cadastro duplicado</h5>
            <Field
              label="Mesclar este cadastro em"
              htmlFor="relationship-merge-target"
              hint="Este cadastro será arquivado; o destino será mantido."
            >
              <input type="hidden" name="targetPatientId" value={mergeTarget?.id ?? ''} />
              <Combobox
                id="relationship-merge-target"
                value={mergeTarget}
                onSelect={setMergeTarget}
                onSearch={searchCandidates}
                placeholder="Buscar cadastro correto…"
                emptyLabel="Nenhum paciente encontrado."
                disabled={merging}
              />
            </Field>
            <Field label="Justificativa" htmlFor="relationship-merge-reason" required>
              <Textarea
                id="relationship-merge-reason"
                name="reason"
                required
                minLength={10}
                maxLength={500}
                rows={2}
                placeholder="Ex.: cadastro duplicado confirmado por CPF e data de nascimento"
                disabled={merging}
              />
            </Field>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              className="min-h-(--hit-target) self-start"
              loading={merging}
              disabled={!mergeTarget}
            >
              Mesclar cadastro
            </Button>
            {mergeState.error ? <Alert variant="danger">{mergeState.error}</Alert> : null}
          </form>
        </div>
      ) : null}
    </Card>
  );
}
