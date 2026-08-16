'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import { buscarPacientes, criarAtendimento, type CriarAtendimentoInput } from './actions';
import type { AgendaData } from './data';

type Modo = 'agendar' | 'agora';

/** YYYY-MM-DD de hoje (local do browser) para o `min` do input de data. */
function hojeISODate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Novo atendimento em Drawer — default AGENDAR (decisão do founder); Enter submete. */
export function NewAppointmentDrawer({ data }: { data: AgendaData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [modo, setModo] = useState<Modo>('agendar');
  const [paciente, setPaciente] = useState<ComboboxItem | null>(null);
  const [procedureId, setProcedureId] = useState('');
  const [doctorId, setDoctorId] = useState(data.selfDoctorId ?? '');
  const [date, setDate] = useState(hojeISODate());
  const [time, setTime] = useState('09:00');
  const [urgencia, setUrgencia] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [intervalWeeks, setIntervalWeeks] = useState('1');
  const [occurrences, setOccurrences] = useState('4');
  const [error, setError] = useState<string | null>(null);
  const [salvando, startSalvar] = useTransition();

  const semProcedimentos = data.procedures.length === 0;

  function reset() {
    setModo('agendar');
    setPaciente(null);
    setProcedureId('');
    setDoctorId(data.selfDoctorId ?? '');
    setDate(hojeISODate());
    setTime('09:00');
    setUrgencia(false);
    setObservacoes('');
    setResourceIds([]);
    setRecurring(false);
    setIntervalWeeks('1');
    setOccurrences('4');
    setError(null);
  }

  function submit() {
    setError(null);
    if (!paciente) return setError('Selecione o paciente.');
    if (!procedureId) return setError('Selecione o procedimento.');
    const docId = data.isPractitioner ? (data.selfDoctorId ?? '') : doctorId;
    if (!docId) return setError('Selecione o profissional.');
    if (modo === 'agendar' && (!date || !time)) {
      return setError('Informe data e hora.');
    }

    const base = {
      patientId: paciente.id,
      procedureId,
      doctorId: docId,
      urgencia,
      observacoes,
      resourceIds,
    };
    const interval = Number(intervalWeeks);
    const count = Number(occurrences);
    if (modo === 'agendar' && recurring && (!Number.isInteger(interval) || interval < 1)) {
      return setError('Informe um intervalo semanal válido.');
    }
    if (modo === 'agendar' && recurring && (!Number.isInteger(count) || count < 2)) {
      return setError('A recorrência precisa de ao menos duas consultas.');
    }
    const input: CriarAtendimentoInput =
      modo === 'agendar'
        ? {
            ...base,
            modo: 'agendar',
            date,
            time,
            ...(recurring ? { recurrence: { intervalWeeks: interval, occurrences: count } } : {}),
          }
        : { ...base, modo: 'agora' };

    startSalvar(async () => {
      const res = await criarAtendimento(input);
      if (res.ok) {
        toast.success(
          res.modo === 'agora' ? 'Encaixe criado' : 'Atendimento agendado',
          res.modo === 'agora'
            ? `${paciente.label} já está na fila do Consultório.`
            : res.createdCount > 1
              ? `${res.createdCount} consultas semanais criadas para ${paciente.label}.`
              : `${paciente.label} em ${date} às ${time}.`,
        );
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DrawerTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" />
          Novo atendimento
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        {/* form real: Enter em qualquer campo submete (o Combobox intercepta o
            Enter só enquanto a lista de resultados está aberta) */}
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DrawerHeader>
            <DrawerTitle>Novo atendimento</DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-4">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <Field label="Tipo">
              <Segmented
                aria-label="Tipo de atendimento"
                options={[
                  { value: 'agendar', label: 'Agendar (dia e hora)' },
                  { value: 'agora', label: 'Encaixe (agora)' },
                ]}
                value={modo}
                onValueChange={setModo}
              />
            </Field>
            <p className="-mt-2 text-(length:--fs-xs) text-fg-muted">
              {modo === 'agora'
                ? 'Paciente chegou agora — entra direto na fila do Consultório.'
                : 'Agende para uma data/hora futura. O horário é o da clínica.'}
            </p>

            <Field label="Paciente">
              <Combobox
                value={paciente}
                onSelect={setPaciente}
                onSearch={async (term) =>
                  (await buscarPacientes(term)).map((p) => ({ id: p.id, label: p.nome }))
                }
                placeholder="Buscar por nome (mín. 2 letras)"
                emptyLabel="Nenhum paciente encontrado."
              />
              {!paciente ? (
                <Link
                  href="/pacientes?novo=1"
                  className="mt-1 inline-block text-(length:--fs-xs) text-link underline"
                >
                  Cadastrar novo paciente
                </Link>
              ) : null}
            </Field>

            {semProcedimentos ? (
              <Alert variant="warning">
                Nenhum procedimento cadastrado. Cadastre ao menos um (catálogo de procedimentos)
                para criar atendimentos.
              </Alert>
            ) : (
              <Field label="Procedimento" htmlFor="appointment-procedure">
                <Select
                  id="appointment-procedure"
                  value={procedureId}
                  onChange={(e) => setProcedureId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {data.procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.descricao}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {!data.isPractitioner ? (
              <Field label="Profissional" htmlFor="appointment-doctor">
                <Select
                  id="appointment-doctor"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {data.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {modo === 'agendar' ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Data" htmlFor="appointment-date">
                    <Input
                      id="appointment-date"
                      type="date"
                      min={hojeISODate()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Hora" htmlFor="appointment-time">
                    <Input
                      id="appointment-time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Field>
                </div>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={recurring}
                    onCheckedChange={(value) => setRecurring(value === true)}
                  />
                  Repetir semanalmente
                </label>
                {recurring ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* A11Y-002 — estes dois números decidem a criação de até
                        104 consultas e não tinham nome acessível: rótulo visual
                        sem `htmlFor`, input sem `id`. Um leitor de tela não
                        distinguia "intervalo" de "quantidade". */}
                    <Field label="Intervalo (semanas)" htmlFor="recurrence-interval-weeks">
                      <Input
                        id="recurrence-interval-weeks"
                        type="number"
                        min={1}
                        max={52}
                        value={intervalWeeks}
                        onChange={(event) => setIntervalWeeks(event.target.value)}
                      />
                    </Field>
                    <Field label="Quantidade de consultas" htmlFor="recurrence-occurrences">
                      <Input
                        id="recurrence-occurrences"
                        type="number"
                        min={2}
                        max={104}
                        value={occurrences}
                        onChange={(event) => setOccurrences(event.target.value)}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            {data.resources.length > 0 ? (
              <Field label="Salas e equipamentos (opcional)">
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.resources.map((resource) => (
                    <label key={resource.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={resourceIds.includes(resource.id)}
                        onCheckedChange={(checked) =>
                          setResourceIds((current) =>
                            checked === true
                              ? [...new Set([...current, resource.id])]
                              : current.filter((id) => id !== resource.id),
                          )
                        }
                      />
                      {resource.name}
                    </label>
                  ))}
                </div>
              </Field>
            ) : null}

            <label className="flex cursor-pointer items-center gap-2.5 text-(length:--fs-sm)">
              <Checkbox checked={urgencia} onCheckedChange={(v) => setUrgencia(v === true)} />
              Urgência
            </label>

            <Field label="Observações (opcional)" htmlFor="appointment-observacoes">
              <Textarea
                id="appointment-observacoes"
                rows={2}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </Field>
          </DrawerBody>
          <DrawerFooter>
            <Button type="submit" loading={salvando} disabled={semProcedimentos}>
              {modo === 'agora' ? 'Criar encaixe' : 'Agendar'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
