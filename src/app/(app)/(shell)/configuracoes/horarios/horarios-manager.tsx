'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  createHoliday,
  removeHoliday,
  removeDoctorAvailability,
  setDoctorAvailability,
} from '@/contexts/scheduling/config-actions';
import type { DoctorAvailabilityDTO, HolidayDTO } from '@/contexts/scheduling/queries';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Ordem de exibição: semana útil primeiro. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (t: string) => t.slice(0, 5);

interface Doctor {
  id: string;
  nome: string;
}

export function HorariosManager({
  doctors,
  availability,
  holidays,
}: {
  doctors: Doctor[];
  availability: DoctorAvailabilityDTO[];
  holidays: HolidayDTO[];
}) {
  const router = useRouter();
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [weekday, setWeekday] = useState('1');
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('12:00');
  // Pausa de almoço: cria DUAS janelas (manhã + tarde) de uma vez.
  const [comPausa, setComPausa] = useState(true);
  const [tardeStart, setTardeStart] = useState('13:30');
  const [tardeEnd, setTardeEnd] = useState('18:00');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayReason, setHolidayReason] = useState('');
  const [busy, start_] = useTransition();

  /** Janelas do médico selecionado agrupadas por dia (ordenadas por hora). */
  const byDay = useMemo(() => {
    const map = new Map<number, DoctorAvailabilityDTO[]>();
    for (const a of availability) {
      if (a.doctorId !== doctorId) continue;
      const list = map.get(a.weekday) ?? [];
      list.push(a);
      map.set(a.weekday, list);
    }
    for (const list of map.values()) list.sort((x, y) => x.startTime.localeCompare(y.startTime));
    return map;
  }, [availability, doctorId]);

  function run(fn: () => Promise<unknown>, okText?: string) {
    start_(async () => {
      try {
        await fn();
        if (okText) toast.success(okText);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro.');
      }
    });
  }

  function addExpediente() {
    if (!doctorId) return toast.error('Selecione o profissional.');
    if (hhmm(end) <= hhmm(start)) return toast.error('Fim da manhã deve ser depois do início.');
    if (comPausa) {
      if (hhmm(tardeStart) <= hhmm(end))
        return toast.error('A tarde deve começar depois do fim da manhã (pausa).');
      if (hhmm(tardeEnd) <= hhmm(tardeStart))
        return toast.error('Fim da tarde deve ser depois do início da tarde.');
    }
    const wd = Number(weekday);
    run(async () => {
      await setDoctorAvailability(
        { doctorId, weekday: wd, startTime: start, endTime: end },
        crypto.randomUUID(),
      );
      if (comPausa) {
        await setDoctorAvailability(
          { doctorId, weekday: wd, startTime: tardeStart, endTime: tardeEnd },
          crypto.randomUUID(),
        );
      }
    }, comPausa ? 'Expediente com pausa de almoço adicionado.' : 'Janela adicionada.');
  }

  function addHoliday() {
    if (!holidayDate) return toast.error('Informe a data.');
    run(
      () =>
        createHoliday(
          { date: holidayDate, ...(holidayReason.trim() ? { reason: holidayReason.trim() } : {}) },
          crypto.randomUUID(),
        ),
      'Feriado adicionado.',
    );
  }

  if (doctors.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Cadastre um médico (em Equipe) para definir horários de atendimento.
      </p>
    );
  }

  return (
    <div className="flex max-w-190 flex-col gap-(--sp-4)">
      {/* Disponibilidade por profissional — visão semanal */}
      <Card className="flex flex-col gap-3 p-(--card-pad)">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Disponibilidade semanal</h4>
          {doctors.length > 1 ? (
            <Select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="max-w-60"
              aria-label="Profissional"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm text-fg-muted">{doctors[0]!.nome}</p>
          )}
        </div>

        <ul className="flex flex-col">
          {WEEK_ORDER.map((wd) => {
            const windows = byDay.get(wd) ?? [];
            return (
              <li
                key={wd}
                className="flex flex-wrap items-center gap-2 border-b border-border py-2.5 last:border-b-0"
              >
                <span className="w-24 shrink-0 text-(length:--fs-sm) font-medium">
                  {WEEKDAYS[wd]}
                </span>
                {windows.length === 0 ? (
                  <span className="text-(length:--fs-sm) text-fg-subtle">—</span>
                ) : (
                  windows.map((w) => (
                    <span
                      key={w.id}
                      className="inline-flex items-center gap-1.5 rounded-(--r-md) border border-border bg-surface-inset py-1 pr-1 pl-2.5 font-mono text-(length:--fs-xs)"
                    >
                      {hhmm(w.startTime)}–{hhmm(w.endTime)}
                      <button
                        type="button"
                        aria-label={`Remover ${WEEKDAYS[w.weekday]} ${hhmm(w.startTime)}`}
                        disabled={busy}
                        onClick={() => run(() => removeDoctorAvailability(w.id, crypto.randomUUID()))}
                        className="grid size-5 place-items-center rounded-(--r-xs) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-danger-600"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))
                )}
                {windows.length === 2 ? (
                  <span className="text-(length:--fs-2xs) text-fg-subtle">
                    (pausa {hhmm(windows[0]!.endTime)}–{hhmm(windows[1]!.startTime)})
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {/* Adicionar expediente (com pausa de almoço em 1 clique) */}
        <div className="flex flex-col gap-3 border-t border-border pt-3.5">
          <div className="flex flex-wrap items-end gap-2.5">
            <Field label="Dia">
              <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {WEEK_ORDER.map((i) => (
                  <option key={i} value={i}>
                    {WEEKDAYS[i]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={comPausa ? 'Manhã — início' : 'Início'}>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={comPausa ? 'Manhã — fim' : 'Fim'}>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            {comPausa ? (
              <>
                <Field label="Tarde — início">
                  <Input
                    type="time"
                    value={tardeStart}
                    onChange={(e) => setTardeStart(e.target.value)}
                  />
                </Field>
                <Field label="Tarde — fim">
                  <Input
                    type="time"
                    value={tardeEnd}
                    onChange={(e) => setTardeEnd(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-(length:--fs-sm)">
              <Checkbox checked={comPausa} onCheckedChange={(v) => setComPausa(v === true)} />
              Com pausa de almoço (cria manhã + tarde)
            </label>
            <Button type="button" size="sm" loading={busy} onClick={addExpediente}>
              <Plus className="size-3.5" />
              {comPausa ? 'Adicionar expediente' : 'Adicionar janela'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Feriados / bloqueios de dia inteiro */}
      <Card className="flex flex-col gap-3 p-(--card-pad)">
        <h4 className="text-sm font-semibold">Feriados (dia inteiro)</h4>
        {holidays.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhum feriado cadastrado.</p>
        ) : (
          <ul className="flex flex-col">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-(length:--fs-sm) font-medium">
                    {new Date(`${h.date}T00:00:00`).toLocaleDateString('pt-BR')}
                  </span>
                  {h.reason ? (
                    <span className="ml-2 text-(length:--fs-xs) text-fg-subtle">{h.reason}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => removeHoliday(h.id, crypto.randomUUID()))}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2.5 border-t border-border pt-3.5">
          <Field label="Data">
            <Input
              type="date"
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
            />
          </Field>
          <Field label="Motivo (opcional)" className="min-w-45 flex-1">
            <Input
              value={holidayReason}
              onChange={(e) => setHolidayReason(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Button type="button" size="sm" loading={busy} onClick={addHoliday}>
            Adicionar feriado
          </Button>
        </div>
      </Card>
    </div>
  );
}
