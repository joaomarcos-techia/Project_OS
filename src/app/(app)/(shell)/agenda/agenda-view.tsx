'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';

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
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<Array<{ id: string; nome: string }>>([]);
  const [paciente, setPaciente] = useState<{ id: string; nome: string } | null>(null);
  const [procedureId, setProcedureId] = useState('');
  const [doctorId, setDoctorId] = useState(data.selfDoctorId ?? '');
  const [date, setDate] = useState(hojeISODate());
  const [time, setTime] = useState('09:00');
  const [urgencia, setUrgencia] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [buscando, startBusca] = useTransition();
  const [salvando, startSalvar] = useTransition();

  const semProcedimentos = data.procedures.length === 0;

  // Busca de paciente com debounce (≥2 letras). Não busca quando já há um selecionado.
  useEffect(() => {
    if (paciente) return;
    const term = busca.trim();
    if (term.length < 2) {
      setResultados([]);
      return;
    }
    const handle = setTimeout(() => {
      startBusca(async () => setResultados(await buscarPacientes(term)));
    }, 300);
    return () => clearTimeout(handle);
  }, [busca, paciente]);

  function reset() {
    setModo('agora');
    setBusca('');
    setResultados([]);
    setPaciente(null);
    setProcedureId('');
    setDoctorId(data.selfDoctorId ?? '');
    setDate(hojeISODate());
    setTime('09:00');
    setUrgencia(false);
    setObservacoes('');
  }

  function submit() {
    setMsg(null);
    if (!paciente) return setMsg({ ok: false, text: 'Selecione o paciente.' });
    if (!procedureId) return setMsg({ ok: false, text: 'Selecione o procedimento.' });
    const docId = data.isDoctor ? (data.selfDoctorId ?? '') : doctorId;
    if (!docId) return setMsg({ ok: false, text: 'Selecione o profissional.' });
    if (modo === 'agendar' && (!date || !time)) {
      return setMsg({ ok: false, text: 'Informe data e hora.' });
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
        setMsg({
          ok: true,
          text:
            res.modo === 'agora'
              ? `Encaixe criado para ${paciente.nome}. Já está na fila do Consultório.`
              : `Atendimento agendado para ${paciente.nome} em ${date} ${time}.`,
        });
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.message });
      }
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-muted">Atendimentos de hoje</span>
        <Button type="button" size="sm" onClick={() => setOpen((v) => !v)}>
          Novo atendimento
        </Button>
      </div>

      {msg ? <Alert variant={msg.ok ? 'success' : 'danger'}>{msg.text}</Alert> : null}

      {open ? (
        <div className="cardblock wrap-pad flex flex-col gap-3">
          <h4 className="text-sm font-semibold">Novo atendimento</h4>

          {/* modo: encaixe agora vs agendar dia/hora */}
          <div className="inline-flex w-fit overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setModo('agora')}
              aria-pressed={modo === 'agora'}
              className={`px-3 py-1.5 text-sm ${modo === 'agora' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'}`}
            >
              Encaixe (agora)
            </button>
            <button
              type="button"
              onClick={() => setModo('agendar')}
              aria-pressed={modo === 'agendar'}
              className={`px-3 py-1.5 text-sm ${modo === 'agendar' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'}`}
            >
              Agendar (dia e hora)
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            {modo === 'agora'
              ? 'Paciente chegou agora — entra direto na fila do Consultório.'
              : 'Agende para uma data/hora futura. O horário é o da clínica.'}
          </p>

          {/* paciente */}
          {paciente ? (
            <div className="flex items-center gap-2 text-sm">
              <span>
                Paciente: <b>{paciente.nome}</b>
              </span>
              <button type="button" className="text-xs text-primary-600 underline" onClick={() => setPaciente(null)}>
                trocar
              </button>
            </div>
          ) : (
            <Field label="Paciente">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome (mín. 2 letras)"
              />
              {buscando ? <p className="mt-1 text-xs text-fg-subtle">buscando…</p> : null}
              {resultados.length > 0 ? (
                <div className="mt-1 flex flex-col rounded border border-border">
                  {resultados.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPaciente(p);
                        setResultados([]);
                        setBusca('');
                      }}
                      className="px-3 py-1.5 text-left text-sm hover:bg-surface-subtle"
                    >
                      {p.nome}
                    </button>
                  ))}
                </div>
              ) : null}
              <Link href="/pacientes/novo" className="mt-1 inline-block text-xs text-primary-600 underline">
                Cadastrar novo paciente
              </Link>
            </Field>
          )}

          {/* procedimento */}
          {semProcedimentos ? (
            <Alert variant="warning">
              Nenhum procedimento cadastrado. Cadastre ao menos um (catálogo de procedimentos) para
              criar atendimentos.
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

          {/* profissional */}
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

          {/* data/hora (só no modo agendar) */}
          {modo === 'agendar' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Data">
                <Input type="date" min={hojeISODate()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Hora">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={urgencia} onChange={(e) => setUrgencia(e.target.checked)} className="size-4" />
            Urgência
          </label>

          <Field label="Observações (opcional)">
            <Textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </Field>

          <div className="flex gap-2">
            <Button type="button" size="sm" loading={salvando} disabled={semProcedimentos} onClick={submit}>
              {modo === 'agora' ? 'Criar encaixe' : 'Agendar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {data.appointments.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento hoje"
          description="Clique em “Novo atendimento” quando um paciente chegar ou para agendar."
        />
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {data.appointments.map((a) => {
              const noConsultorio = a.status === 'chegou' || a.status === 'em_atendimento';
              return (
                <div key={a.id} className="listrow">
                  <div className="lr-main">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{hora(a.horario)}</span>
                      <span className="font-medium">{a.pacienteNome}</span>
                      <span className="text-xs text-fg-subtle">{a.medicoNome}</span>
                      <AppointmentStatusBadge status={a.status} />
                    </div>
                  </div>
                  {noConsultorio ? (
                    <div className="lr-end">
                      <Link href="/consultorio" className="text-sm text-primary-600 underline">
                        Abrir no Consultório
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
