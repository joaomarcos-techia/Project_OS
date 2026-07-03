'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import { buscarPacientes, criarAtendimento, type CriarAtendimentoInput } from './actions';
import type { AgendaData } from './data';

type Modo = 'agora' | 'agendar';

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
/** YYYY-MM-DD de hoje (local do browser) para o `min` do input de data. */
function hojeISODate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AgendaView({ data }: { data: AgendaData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [modo, setModo] = useState<Modo>('agora');
  const [paciente, setPaciente] = useState<ComboboxItem | null>(null);
  const [procedureId, setProcedureId] = useState('');
  const [doctorId, setDoctorId] = useState(data.selfDoctorId ?? '');
  const [date, setDate] = useState(hojeISODate());
  const [time, setTime] = useState('09:00');
  const [urgencia, setUrgencia] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [salvando, startSalvar] = useTransition();

  const semProcedimentos = data.procedures.length === 0;

  function reset() {
    setModo('agora');
    setPaciente(null);
    setProcedureId('');
    setDoctorId(data.selfDoctorId ?? '');
    setDate(hojeISODate());
    setTime('09:00');
    setUrgencia(false);
    setObservacoes('');
    setError(null);
  }

  function submit() {
    setError(null);
    if (!paciente) return setError('Selecione o paciente.');
    if (!procedureId) return setError('Selecione o procedimento.');
    const docId = data.isDoctor ? (data.selfDoctorId ?? '') : doctorId;
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
    };
    const input: CriarAtendimentoInput =
      modo === 'agendar' ? { ...base, modo: 'agendar', date, time } : { ...base, modo: 'agora' };

    startSalvar(async () => {
      const res = await criarAtendimento(input);
      if (res.ok) {
        toast.success(
          res.modo === 'agora' ? 'Encaixe criado' : 'Atendimento agendado',
          res.modo === 'agora'
            ? `${paciente.label} já está na fila do Consultório.`
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
    <div className="flex max-w-205 flex-col gap-(--sp-4)">
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-muted">Atendimentos de hoje</span>
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
            <DrawerHeader>
              <DrawerTitle>Novo atendimento</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Tipo">
                <Segmented
                  aria-label="Tipo de atendimento"
                  options={[
                    { value: 'agora', label: 'Encaixe (agora)' },
                    { value: 'agendar', label: 'Agendar (dia e hora)' },
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
                <Field label="Procedimento">
                  <Select value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {data.procedures.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.descricao}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {!data.isDoctor ? (
                <Field label="Profissional">
                  <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Data">
                    <Input
                      type="date"
                      min={hojeISODate()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Hora">
                    <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                </div>
              ) : null}

              <label className="flex cursor-pointer items-center gap-2.5 text-(length:--fs-sm)">
                <Checkbox checked={urgencia} onCheckedChange={(v) => setUrgencia(v === true)} />
                Urgência
              </label>

              <Field label="Observações (opcional)">
                <Textarea
                  rows={2}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              </Field>
            </DrawerBody>
            <DrawerFooter>
              <Button loading={salvando} disabled={semProcedimentos} onClick={submit}>
                {modo === 'agora' ? 'Criar encaixe' : 'Agendar'}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>

      {data.appointments.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento hoje"
          description="Clique em “Novo atendimento” quando um paciente chegar ou para agendar."
        />
      ) : (
        <Card>
          <ul className="flex flex-col">
            {data.appointments.map((a) => {
              const noConsultorio = a.status === 'chegou' || a.status === 'em_atendimento';
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
                >
                  <span className="font-mono text-sm">{hora(a.horario)}</span>
                  <span className="min-w-0 truncate font-medium">{a.pacienteNome}</span>
                  <span className="text-xs text-fg-subtle">{a.medicoNome}</span>
                  <AppointmentStatusBadge status={a.status} />
                  <span className="flex-1" />
                  {noConsultorio ? (
                    <Link
                      href="/consultorio"
                      className="text-(length:--fs-sm) font-medium text-link hover:underline"
                    >
                      Abrir no Consultório
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
