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

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function paymentOptionValue(method: 'pix' | 'cash' | 'credit_card', installments: number | null) {
  return `${method}:${installments ?? 0}`;
}

function paymentOptionLabel(method: 'pix' | 'cash' | 'credit_card', installments: number | null) {
  if (method === 'pix') return 'PIX';
  if (method === 'cash') return 'Dinheiro';
  const maxInstallments = installments ?? 1;
  return maxInstallments === 1
    ? 'Cartão de crédito · à vista'
    : `Cartão de crédito · até ${maxInstallments}x`;
}

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
  const [paymentOption, setPaymentOption] = useState('');
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
    setPaymentOption('');
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
    if (data.paymentPricingMode === 'payment_method_pricing' && !paymentOption) {
      return setError('Selecione a forma de pagamento e o preço.');
    }
    const docId = data.isPractitioner ? (data.selfDoctorId ?? '') : doctorId;
    if (!docId) return setError('Selecione o profissional.');
    if (modo === 'agendar' && (!date || !time)) {
      return setError('Informe data e hora.');
    }
    if (modo === 'agendar' && recurring && data.paymentPricingMode === 'payment_method_pricing') {
      return setError(
        'A recorrência com preço por meio de pagamento ainda não está disponível. Agende cada atendimento separadamente.',
      );
    }

    const selectedPrice = data.paymentPrices.find(
      (price) =>
        price.procedureId === procedureId &&
        paymentOptionValue(price.paymentMethod, price.installmentCount) === paymentOption,
    );
    if (data.paymentPricingMode === 'payment_method_pricing' && !selectedPrice) {
      return setError('A condição de pagamento escolhida não está mais disponível.');
    }
    const base = {
      patientId: paciente.id,
      procedureId,
      doctorId: docId,
      urgencia,
      observacoes,
      resourceIds,
      ...(selectedPrice
        ? {
            paymentMethod: selectedPrice.paymentMethod,
            ...(selectedPrice.installmentCount
              ? { installmentCount: selectedPrice.installmentCount }
              : {}),
          }
        : {}),
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
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-4">
            {error ? <Alert variant="danger">{error}</Alert> : null}

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

            <Field label="Paciente" htmlFor="appointment-patient">
              <Combobox
                id="appointment-patient"
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
                  onChange={(e) => {
                    setProcedureId(e.target.value);
                    setPaymentOption('');
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

            {data.paymentPricingMode === 'payment_method_pricing' && procedureId ? (
              data.paymentPrices.some((price) => price.procedureId === procedureId) ? (
                <Field label="Forma de pagamento e preço" htmlFor="appointment-payment-price">
                  <Select
                    id="appointment-payment-price"
                    value={paymentOption}
                    onChange={(event) => setPaymentOption(event.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {data.paymentPrices
                      .filter((price) => price.procedureId === procedureId)
                      .map((price) => (
                        <option
                          key={price.id}
                          value={paymentOptionValue(price.paymentMethod, price.installmentCount)}
                          disabled={
                            price.paymentMethod === 'credit_card' && price.installmentCount !== 1
                          }
                        >
                          {paymentOptionLabel(price.paymentMethod, price.installmentCount)} —{' '}
                          {money.format(price.grossAmount)}
                          {price.paymentMethod === 'credit_card' && price.installmentCount !== 1
                            ? ' · link parcelado indisponível'
                            : ''}
                        </option>
                      ))}
                  </Select>
                  <p className="mt-1 text-(length:--fs-xs) text-fg-muted">
                    Este é o valor bruto do atendimento. Taxas do Asaas serão registradas
                    separadamente.
                  </p>
                </Field>
              ) : (
                <Alert variant="warning">
                  Este procedimento não possui preço por forma de pagamento. Configure-o em
                  Configurações → Pagamentos antes de agendar.
                </Alert>
              )
            ) : null}

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
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={recurring}
                    disabled={data.paymentPricingMode === 'payment_method_pricing'}
                    onCheckedChange={(value) => setRecurring(value === true)}
                  />
                  Repetir semanalmente
                </label>
                {data.paymentPricingMode === 'payment_method_pricing' ? (
                  <p className="text-(length:--fs-xs) text-fg-muted">
                    Com preço por meio de pagamento, agende cada atendimento separadamente.
                  </p>
                ) : null}
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
