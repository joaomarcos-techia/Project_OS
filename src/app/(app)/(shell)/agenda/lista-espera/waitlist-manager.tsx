'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { cancelWaitlistEntry } from '@/contexts/scheduling/actions';
import type { WaitlistEntryDTO } from '@/contexts/scheduling/types';
import { uuidv4 } from '@/lib/ui/uuid';

import { buscarPacientes } from '../actions';
import { createWaitlistFromUi } from './actions';

interface NamedOption {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<WaitlistEntryDTO['status'], string> = {
  waiting: 'Aguardando',
  offered: 'Oferta enviada',
  booked: 'Agendado',
  cancelled: 'Cancelado',
};

export function WaitlistManager({
  initial,
  patients,
  procedures,
  doctors,
}: {
  initial: WaitlistEntryDTO[];
  patients: NamedOption[];
  procedures: NamedOption[];
  doctors: NamedOption[];
}) {
  const router = useRouter();
  const [patient, setPatient] = useState<ComboboxItem | null>(null);
  const [procedureId, setProcedureId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'normal'>('normal');
  const [preferredFromDate, setPreferredFromDate] = useState('');
  const [preferredUntilDate, setPreferredUntilDate] = useState('');
  const [notes, setNotes] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [busy, startTransition] = useTransition();
  const patientName = useMemo(() => new Map(patients.map((item) => [item.id, item.name])), [patients]);
  const procedureName = useMemo(() => new Map(procedures.map((item) => [item.id, item.name])), [procedures]);
  const doctorName = useMemo(() => new Map(doctors.map((item) => [item.id, item.name])), [doctors]);
  const visible = initial.filter(
    (entry) => showClosed || entry.status === 'waiting' || entry.status === 'offered',
  );

  function create() {
    if (!patient || !procedureId) {
      toast.error('Selecione o paciente e o procedimento.');
      return;
    }
    startTransition(async () => {
      try {
        await createWaitlistFromUi(
          {
            patientId: patient.id,
            procedureId,
            doctorId: doctorId || null,
            priority,
            ...(preferredFromDate ? { preferredFromDate } : {}),
            ...(preferredUntilDate ? { preferredUntilDate } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
          uuidv4(),
        );
        setPatient(null);
        setNotes('');
        toast.success('Paciente adicionado à lista de espera.');
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Erro ao adicionar à lista.');
      }
    });
  }

  function cancel(id: string) {
    startTransition(async () => {
      try {
        await cancelWaitlistEntry(id, uuidv4());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Erro ao cancelar entrada.');
      }
    });
  }

  return (
    <div className="stack">
      <div className="cardblock wrap-pad grid gap-3 lg:grid-cols-3">
        <Field label="Paciente">
          <Combobox
            value={patient}
            onSelect={setPatient}
            onSearch={async (term) =>
              (await buscarPacientes(term)).map((item) => ({ id: item.id, label: item.nome }))
            }
            placeholder="Buscar paciente"
          />
        </Field>
        <Field label="Procedimento">
          <Select value={procedureId} onChange={(event) => setProcedureId(event.target.value)}>
            <option value="">Selecione…</option>
            {procedures.map((procedure) => (
              <option key={procedure.id} value={procedure.id}>{procedure.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Profissional (opcional)">
          <Select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
            <option value="">Qualquer profissional</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Preferência a partir de">
          <Input type="date" value={preferredFromDate} onChange={(event) => setPreferredFromDate(event.target.value)} />
        </Field>
        <Field label="Preferência até">
          <Input type="date" value={preferredUntilDate} onChange={(event) => setPreferredUntilDate(event.target.value)} />
        </Field>
        <Field label="Prioridade">
          <Select value={priority} onChange={(event) => setPriority(event.target.value as 'urgent' | 'normal')}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgente</option>
          </Select>
        </Field>
        <div className="lg:col-span-2">
          <Field label="Observações">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
        <div className="flex items-end">
          <Button type="button" loading={busy} onClick={create}>Adicionar à lista</Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />
        Mostrar encerrados
      </label>
      <div className="cardblock">
        <div className="listrows">
          {visible.map((entry) => (
            <div key={entry.id} className="listrow">
              <div className="lr-main">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{patientName.get(entry.patientId) ?? 'Paciente'}</span>
                  <span className="text-sm text-fg-muted">{procedureName.get(entry.procedureId) ?? 'Procedimento'}</span>
                  {entry.doctorId ? <span className="text-xs text-fg-subtle">{doctorName.get(entry.doctorId) ?? 'Profissional'}</span> : null}
                  {entry.priority === 'urgent' ? <Badge tone="red">Urgente</Badge> : null}
                  <Badge tone="gray">{STATUS_LABEL[entry.status]}</Badge>
                </div>
              </div>
              <div className="lr-end">
                {entry.status === 'waiting' || entry.status === 'offered' ? (
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => cancel(entry.id)}>Cancelar</Button>
                ) : null}
              </div>
            </div>
          ))}
          {visible.length === 0 ? <p className="p-4 text-sm text-fg-muted">Lista de espera vazia.</p> : null}
        </div>
      </div>
    </div>
  );
}
