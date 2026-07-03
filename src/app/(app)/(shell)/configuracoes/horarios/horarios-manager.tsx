'use client';

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
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
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
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayReason, setHolidayReason] = useState('');
  const [busy, start_] = useTransition();

  const windows = useMemo(
    () =>
      availability
        .filter((a) => a.doctorId === doctorId)
        .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
    [availability, doctorId],
  );

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

  function addWindow() {
    if (!doctorId) return toast.error('Selecione o profissional.');
    if (hhmm(end) <= hhmm(start)) return toast.error('Fim deve ser depois do início.');
    run(
      () =>
        setDoctorAvailability(
          { doctorId, weekday: Number(weekday), startTime: start, endTime: end },
          crypto.randomUUID(),
        ),
      'Janela adicionada.',
    );
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
    <div className="stack" style={{ maxWidth: 760 }}>

      {/* Disponibilidade por profissional */}
      <div className="cardblock wrap-pad flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Disponibilidade semanal</h4>
        {doctors.length > 1 ? (
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="max-w-xs">
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm text-fg-muted">{doctors[0]!.nome}</p>
        )}

        {windows.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhuma janela definida para este profissional.</p>
        ) : (
          <div className="listrows">
            {windows.map((w) => (
              <div key={w.id} className="listrow">
                <div className="lr-main">
                  <span className="font-medium">{WEEKDAYS[w.weekday]}</span>
                  <span className="lr-sub">
                    {hhmm(w.startTime)} – {hhmm(w.endTime)}
                  </span>
                </div>
                <div className="lr-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => removeDoctorAvailability(w.id, crypto.randomUUID()))}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">Dia</span>
            <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">Início</span>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">Fim</span>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <Button type="button" size="sm" loading={busy} onClick={addWindow}>
            Adicionar janela
          </Button>
        </div>
      </div>

      {/* Feriados / bloqueios de dia inteiro */}
      <div className="cardblock wrap-pad flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Feriados (dia inteiro)</h4>
        {holidays.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhum feriado cadastrado.</p>
        ) : (
          <div className="listrows">
            {holidays.map((h) => (
              <div key={h.id} className="listrow">
                <div className="lr-main">
                  <span className="font-medium">
                    {new Date(`${h.date}T00:00:00`).toLocaleDateString('pt-BR')}
                  </span>
                  {h.reason ? <span className="lr-sub">{h.reason}</span> : null}
                </div>
                <div className="lr-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => removeHoliday(h.id, crypto.randomUUID()))}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">Data</span>
            <Input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm" style={{ minWidth: 180 }}>
            <span className="text-fg-muted">Motivo (opcional)</span>
            <Input value={holidayReason} onChange={(e) => setHolidayReason(e.target.value)} maxLength={200} />
          </label>
          <Button type="button" size="sm" loading={busy} onClick={addHoliday}>
            Adicionar feriado
          </Button>
        </div>
      </div>
    </div>
  );
}
