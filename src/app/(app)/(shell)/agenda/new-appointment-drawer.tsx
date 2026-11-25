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
  DrawerDescription,
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
import { QuickPatientForm } from './quick-patient-form';
import type { AgendaData } from './data';
import { todayYmd } from './range';
import {
  emptyBilling,
  InsuranceBillingFields,
  type BillingValue,
} from './insurance-billing-fields';

type Modo = 'agendar' | 'agora';

type CampoNovoAtendimento =
  | 'paciente'
  | 'procedimento'
  | 'profissional'
  | 'data'
  | 'hora'
  | 'intervalo'
  | 'quantidade';

export type ErrosNovoAtendimento = Partial<Record<CampoNovoAtendimento, string>>;

/** Ordem visual dos campos e o `id` de cada controle (foco no primeiro inválido). */
const CAMPOS: ReadonlyArray<readonly [CampoNovoAtendimento, string]> = [
  ['paciente', 'appointment-patient'],
  ['procedimento', 'appointment-procedure'],
  ['profissional', 'appointment-doctor'],
  ['data', 'appointment-date'],
  ['hora', 'appointment-time'],
  ['intervalo', 'recurrence-interval-weeks'],
  ['quantidade', 'recurrence-occurrences'],
];

/**
 * UX-005 (`docs/otimização_ui_final.md`) — as mesmas checagens de antes, mas todas
 * de uma vez e por campo: a pessoa vê tudo o que falta no primeiro envio, cada
 * aviso ao lado do campo. O servidor continua validando tudo.
 */
export function validarNovoAtendimento(v: {
  modo: Modo;
  temPaciente: boolean;
  procedureId: string;
  doctorId: string;
  date: string;
  time: string;
  recurring: boolean;
  intervalWeeks: string;
  occurrences: string;
}): ErrosNovoAtendimento {
  const erros: ErrosNovoAtendimento = {};
  if (!v.temPaciente) erros.paciente = 'Selecione o paciente.';
  if (!v.procedureId) erros.procedimento = 'Selecione o procedimento.';
  if (!v.doctorId) erros.profissional = 'Selecione o profissional.';
  if (v.modo === 'agendar') {
    if (!v.date) erros.data = 'Informe a data.';
    if (!v.time) erros.hora = 'Informe a hora.';
    if (v.recurring) {
      const interval = Number(v.intervalWeeks);
      const count = Number(v.occurrences);
      if (!Number.isInteger(interval) || interval < 1) {
        erros.intervalo = 'Informe um intervalo semanal válido.';
      }
      if (!Number.isInteger(count) || count < 2) {
        erros.quantidade = 'A recorrência precisa de ao menos duas consultas.';
      }
    }
  }
  return erros;
}

/** `2026-11-14` → `14/11/2026`, sem passar por `Date` (é data civil da clínica). */
function dataCurta(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

/** Novo atendimento em Drawer — default AGENDAR (decisão do founder); Enter submete. */
export function NewAppointmentDrawer({ data }: { data: AgendaData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Hoje no fuso da CLÍNICA, que é como o servidor lê a data e a hora
  // digitadas. O dia do navegador divergia depois das 21h e para quem atende
  // de outro fuso.
  const hojeISODate = () => todayYmd(data.tz);

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
  // Erros de campo (validação da tela) separados do erro do servidor (UX-005).
  const [fieldErrors, setFieldErrors] = useState<ErrosNovoAtendimento>({});
  const [formError, setFormError] = useState<string | null>(null);
  // UX-006: cadastro rápido aberto dentro da gaveta (nada do agendamento se perde).
  const [cadastrandoPaciente, setCadastrandoPaciente] = useState(false);
  // Anúncio da seleção feita pelo cadastro rápido (região `status` sempre montada).
  const [avisoPaciente, setAvisoPaciente] = useState('');
  const [billing, setBilling] = useState<BillingValue>(emptyBilling);
  const [salvando, startSalvar] = useTransition();

  const semProcedimentos = data.procedures.length === 0;

  function limparErro(campo: CampoNovoAtendimento) {
    setFieldErrors((atual) => {
      if (!atual[campo]) return atual;
      const { [campo]: _removido, ...resto } = atual;
      return resto;
    });
  }

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
    setFieldErrors({});
    setFormError(null);
    setCadastrandoPaciente(false);
    setAvisoPaciente('');
    setBilling(emptyBilling());
  }

  function submit() {
    setFormError(null);
    const docId = data.isPractitioner ? (data.selfDoctorId ?? '') : doctorId;
    const erros = validarNovoAtendimento({
      modo,
      temPaciente: paciente !== null,
      procedureId,
      doctorId: docId,
      date,
      time,
      recurring,
      intervalWeeks,
      occurrences,
    });
    // Médico agendando para si não vê o campo "Profissional": o aviso não pode
    // ficar preso a um campo escondido.
    if (erros.profissional && data.isPractitioner) {
      setFormError(erros.profissional);
      delete erros.profissional;
    }
    setFieldErrors(erros);
    const primeiro = CAMPOS.find(([campo]) => erros[campo]);
    if (primeiro) {
      // Depois do render, para o campo já estar com o erro ligado.
      requestAnimationFrame(() => document.getElementById(primeiro[1])?.focus());
      return;
    }
    if (!paciente || !docId) return;
    if (billing.mode === 'convenio' && !billing.insurerId) {
      setFormError('Escolha a operadora do convênio.');
      return;
    }
    const base = {
      patientId: paciente.id,
      procedureId,
      doctorId: docId,
      urgencia,
      observacoes,
      resourceIds,
      ...(billing.mode === 'convenio'
        ? {
            convenio: {
              insurerId: billing.insurerId,
              planId: billing.planId || null,
              membershipId: billing.membershipId || null,
              guideType: billing.guideType,
            },
          }
        : {}),
    };
    const interval = Number(intervalWeeks);
    const count = Number(occurrences);
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
      if (res.ok && res.coverage && (res.coverage.error || res.coverage.issues.length > 0)) {
        // Convênio criado, mas a cobertura tem pendência: a recepção vê na hora o que falta.
        toast.info(
          'Atendimento de convênio criado com pendência',
          res.coverage.error ?? res.coverage.issues[0],
          8000,
          '/convenios',
        );
        setOpen(false);
        reset();
        router.refresh();
      } else if (res.ok) {
        toast.success(
          res.modo === 'agora' ? 'Encaixe criado' : 'Atendimento agendado',
          res.modo === 'agora'
            ? `${paciente.label} já está na fila do Consultório.`
            : res.createdCount > 1
              ? `${res.createdCount} consultas semanais criadas para ${paciente.label}.`
              : `${paciente.label} em ${dataCurta(date)} às ${time}.`,
        );
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setFormError(res.message);
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
        <Button className="min-h-(--hit-target)">
          <Plus className="size-4" />
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
            <DrawerDescription>
              Escolha o tipo, o paciente, o horário e o procedimento.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-4">
            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <Field label="Tipo" group>
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

            <div className="flex flex-col gap-1">
              <Field label="Paciente" htmlFor="appointment-patient" error={fieldErrors.paciente}>
                <Combobox
                  id="appointment-patient"
                  value={paciente}
                  onSelect={(item) => {
                    setPaciente(item);
                    setBilling((b) => ({ ...b, membershipId: '' }));
                    if (item) limparErro('paciente');
                  }}
                  onSearch={async (term) =>
                    (await buscarPacientes(term)).map((p) => ({ id: p.id, label: p.nome }))
                  }
                  placeholder="Buscar por nome (mín. 2 letras)"
                  emptyLabel="Nenhum paciente encontrado."
                />
              </Field>
              {/* UX-006: antes era um link para /pacientes que descartava tudo o que já
                  estava preenchido aqui. Só aparece para quem pode cadastrar paciente. */}
              {!paciente && !cadastrandoPaciente && data.canCreatePatient ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setCadastrandoPaciente(true)}
                >
                  Cadastrar novo paciente
                </Button>
              ) : null}
              <p role="status" className="sr-only">
                {avisoPaciente}
              </p>
            </div>

            {cadastrandoPaciente ? (
              <QuickPatientForm
                onCreated={(novo) => {
                  setPaciente(novo);
                  setBilling((b) => ({ ...b, membershipId: '' }));
                  setCadastrandoPaciente(false);
                  limparErro('paciente');
                  // Concorda com "cadastro", não com a pessoa: o gênero dela
                  // não é dado do formulário.
                  setAvisoPaciente(
                    `Cadastro de ${novo.label} concluído e já selecionado neste atendimento.`,
                  );
                  // O formulário rápido some com o foco dentro dele: sem isto o
                  // foco cai no corpo da página. Segue para o próximo campo do
                  // agendamento (Profissional, se o catálogo estiver vazio).
                  requestAnimationFrame(() =>
                    (
                      document.getElementById('appointment-procedure') ??
                      document.getElementById('appointment-doctor')
                    )?.focus(),
                  );
                }}
                onCancel={() => {
                  setCadastrandoPaciente(false);
                  // Devolve o foco à busca de paciente, de onde a pessoa saiu.
                  requestAnimationFrame(() =>
                    document.getElementById('appointment-patient')?.focus(),
                  );
                }}
              />
            ) : null}

            {semProcedimentos ? (
              <Alert variant="warning">
                Nenhum procedimento cadastrado. Para agendar, a clínica precisa de ao menos um.{' '}
                {data.canManageProcedures ? (
                  <Link href="/configuracoes/procedimentos" className="text-link underline">
                    Cadastrar procedimento
                  </Link>
                ) : (
                  'Peça a quem administra a clínica para cadastrar os procedimentos.'
                )}
              </Alert>
            ) : (
              <Field
                label="Procedimento"
                htmlFor="appointment-procedure"
                error={fieldErrors.procedimento}
              >
                <Select
                  id="appointment-procedure"
                  value={procedureId}
                  invalid={Boolean(fieldErrors.procedimento)}
                  onChange={(e) => {
                    setProcedureId(e.target.value);
                    if (e.target.value) limparErro('procedimento');
                  }}
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
              <Field
                label="Profissional"
                htmlFor="appointment-doctor"
                error={fieldErrors.profissional}
              >
                <Select
                  id="appointment-doctor"
                  value={doctorId}
                  invalid={Boolean(fieldErrors.profissional)}
                  onChange={(e) => {
                    setDoctorId(e.target.value);
                    if (e.target.value) limparErro('profissional');
                  }}
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
                  <Field label="Data" htmlFor="appointment-date" error={fieldErrors.data}>
                    <Input
                      id="appointment-date"
                      type="date"
                      min={hojeISODate()}
                      value={date}
                      invalid={Boolean(fieldErrors.data)}
                      onChange={(e) => {
                        setDate(e.target.value);
                        if (e.target.value) limparErro('data');
                      }}
                    />
                  </Field>
                  <Field label="Hora" htmlFor="appointment-time" error={fieldErrors.hora}>
                    <Input
                      id="appointment-time"
                      type="time"
                      value={time}
                      invalid={Boolean(fieldErrors.hora)}
                      onChange={(e) => {
                        setTime(e.target.value);
                        if (e.target.value) limparErro('hora');
                      }}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2.5 text-sm">
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
                    <Field
                      label="Intervalo (semanas)"
                      htmlFor="recurrence-interval-weeks"
                      error={fieldErrors.intervalo}
                    >
                      <Input
                        id="recurrence-interval-weeks"
                        type="number"
                        min={1}
                        max={52}
                        value={intervalWeeks}
                        invalid={Boolean(fieldErrors.intervalo)}
                        onChange={(event) => {
                          setIntervalWeeks(event.target.value);
                          limparErro('intervalo');
                        }}
                      />
                    </Field>
                    <Field
                      label="Quantidade de consultas"
                      htmlFor="recurrence-occurrences"
                      error={fieldErrors.quantidade}
                    >
                      <Input
                        id="recurrence-occurrences"
                        type="number"
                        min={2}
                        max={104}
                        value={occurrences}
                        invalid={Boolean(fieldErrors.quantidade)}
                        onChange={(event) => {
                          setOccurrences(event.target.value);
                          limparErro('quantidade');
                        }}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            {data.resources.length > 0 ? (
              <Field label="Salas e equipamentos (opcional)" group>
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

            <InsuranceBillingFields
              options={data.insurance}
              patientId={paciente?.id ?? null}
              value={billing}
              onChange={setBilling}
            />

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
