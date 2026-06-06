'use client';

import { Stethoscope, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';

// Reuso direto do editor de prontuário (C7): autosave 10s, conflito por
// rowVersion e modo read-only quando assinado já estão prontos.
import { ProntuarioEditor } from '../pacientes/[id]/prontuarios/[pid]/prontuario-editor';
import { sexoLong } from './board-logic';
import { loadAtendimento } from './actions';
import { DocumentPanel, PrescriptionPanel, SignPanel } from './atendimento-tools';
import type { AtendimentoDTO } from './board-types';

export function AttendingPanel({
  appointmentId,
  boardStatus,
  busy,
  onComplete,
  onClose,
  onBoardRefresh,
}: {
  appointmentId: string | null;
  /** status atual do appointment segundo o board — dispara reload ao mudar. */
  boardStatus: AppointmentStatusDTO | null;
  busy: boolean;
  onComplete: (id: string) => void;
  /** dispensa a visualização de uma consulta finalizada (volta ao estado vazio). */
  onClose: () => void;
  onBoardRefresh: () => void;
}) {
  const [data, setData] = useState<AtendimentoDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const res = await loadAtendimento(id);
    setLoading(false);
    if (res.ok) setData(res.data);
    else {
      setData(null);
      setError(res.message);
    }
  }, []);

  useEffect(() => {
    if (!appointmentId) {
      setData(null);
      return;
    }
    void load(appointmentId);
    // boardStatus na dep: recarrega quando o appointment transiciona (ex.: encerrar
    // → atendido) mesmo com o id inalterado. (Não recarregamos a cada refetch para
    // não pesar — cada loadAtendimento é uma ida ao banco.)
  }, [appointmentId, boardStatus, load]);

  if (!appointmentId) {
    return (
      <EmptyState
        icon={<Stethoscope />}
        title="Nenhum paciente em atendimento"
        description="Selecione um paciente da Sala de Espera ou faça o check-in acima para começar."
      />
    );
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (error && !data) return <Alert variant="danger">{error}</Alert>;
  if (!data) return null;

  const finalizada = data.status === 'atendido';
  const emAtendimento = data.status === 'em_atendimento';
  const assinado = data.prontuario?.status === 'assinado';

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{data.pacienteNome}</h2>
            {data.idade != null || data.sexo ? (
              <p className="truncate text-xs text-fg-subtle">
                {[data.idade != null ? `${data.idade} anos` : null, sexoLong(data.sexo)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            <p className="truncate text-sm text-fg-muted">{data.motivo}</p>
          </div>
          <AppointmentStatusBadge status={data.status} />
        </div>
        {data.alergias.length > 0 ? (
          <p className="mt-2 flex items-start gap-1 text-sm text-danger-700">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <b>Alergias:</b> {data.alergias.join(', ')}
            </span>
          </p>
        ) : null}
        {emAtendimento ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" loading={busy} onClick={() => onComplete(appointmentId)}>
              Encerrar consulta
            </Button>
          </div>
        ) : null}
        {finalizada ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-fg-subtle">Consulta finalizada — somente leitura.</p>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : null}
      </div>

      {data.prontuario ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ProntuarioEditor key={data.prontuario.id} prontuario={data.prontuario} />
        </div>
      ) : data.patientId ? (
        <Alert variant="info">O prontuário será criado quando o paciente estiver em atendimento.</Alert>
      ) : (
        <Alert variant="info">Atendimento sem paciente cadastrado (walk-in) — sem prontuário.</Alert>
      )}

      {emAtendimento && data.prontuario && data.patientId ? (
        <div className="flex flex-col gap-3">
          {!assinado ? (
            <SignPanel
              prontuarioId={data.prontuario.id}
              onSigned={() => {
                void load(appointmentId);
                onBoardRefresh();
              }}
            />
          ) : null}
          <PrescriptionPanel patientId={data.patientId} prontuarioId={data.prontuario.id} />
          <DocumentPanel patientId={data.patientId} />
        </div>
      ) : null}
    </div>
  );
}
