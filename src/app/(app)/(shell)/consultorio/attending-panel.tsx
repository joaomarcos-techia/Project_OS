'use client';

import { Clock3, Stethoscope, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';

// Reuso direto do editor de prontuário (C7): autosave 10s (com indicador
// salvando/salvo/erro próprio), conflito por rowVersion e read-only assinado.
import { ProntuarioEditor } from '../pacientes/[id]/prontuarios/[pid]/prontuario-editor';
import { sexoLong } from './board-logic';
import { loadAtendimento } from './actions';
import type { AtendimentoDTO } from './board-types';
import { DocumentDrawer } from './document-drawer';
import { PrescriptionDrawer } from './prescription-drawer';
import { SignDialog } from './sign-dialog';

/** Tempo desde o check-in — o médico vê há quanto tempo o paciente está na casa. */
function ElapsedChip({ since }: { since: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
  const label =
    mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-1 font-mono text-(length:--fs-2xs) text-fg-muted">
      <Clock3 aria-hidden="true" className="size-3" />
      na clínica há {label}
    </span>
  );
}

export function AttendingPanel({
  appointmentId,
  boardStatus,
  checkInAt,
  busy,
  onComplete,
  onClose,
  onBoardRefresh,
  timeZone,
}: {
  appointmentId: string | null;
  /** status atual do appointment segundo o board — dispara reload ao mudar. */
  boardStatus: AppointmentStatusDTO | null;
  /** check-in do card selecionado (base do tempo decorrido na sessão). */
  checkInAt: string | null;
  busy: boolean;
  onComplete: (id: string) => void;
  /** dispensa a visualização de uma consulta finalizada (volta ao estado vazio). */
  onClose: () => void;
  onBoardRefresh: () => void;
  timeZone: string;
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
  const podeEmitir = emAtendimento && data.prontuario && data.patientId;

  return (
    <div data-slot="attending-panel" className="flex flex-col gap-4">
      {/* Cartão de sessão — identidade + tempo + ações no mesmo lugar */}
      <div className="rounded-(--r-lg) border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
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
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <AppointmentStatusBadge status={data.status} />
            {emAtendimento && checkInAt ? <ElapsedChip since={checkInAt} /> : null}
          </div>
        </div>

        {data.alergias.length > 0 ? (
          <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-(--r-md) bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-[color-mix(in_oklch,var(--danger-500)_14%,transparent)] dark:text-danger-200">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <b>Alergias:</b> {data.alergias.join(', ')}
            </span>
          </p>
        ) : null}

        {emAtendimento ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-3">
            {podeEmitir ? (
              <>
                <span className="mr-1 font-mono text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
                  Emitir
                </span>
                <PrescriptionDrawer
                  patientId={data.patientId!}
                  prontuarioId={data.prontuario!.id}
                />
                <DocumentDrawer patientId={data.patientId!} />
              </>
            ) : null}
            <span className="flex-1" />
            {podeEmitir && !assinado ? (
              <SignDialog
                prontuarioId={data.prontuario!.id}
                onSigned={() => {
                  void load(appointmentId);
                  onBoardRefresh();
                }}
              />
            ) : null}
            {/* AUTHZ-008 — encerrar é ato clínico. O botão era renderizado para
                todo usuário da página; agora deriva da mesma regra do servidor.
                Perfil não clínico segue vendo a fila e o painel, sem a ação. */}
            {data.canComplete ? (
              <Button
                size="sm"
                variant="danger"
                loading={busy}
                onClick={() => onComplete(appointmentId)}
              >
                Encerrar consulta
              </Button>
            ) : (
              <span className="text-xs text-fg-subtle">
                O encerramento é feito pelo profissional responsável.
              </span>
            )}
          </div>
        ) : null}

        {finalizada ? (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-4 py-3">
            <p className="text-sm text-fg-subtle">Consulta finalizada — somente leitura.</p>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : null}
      </div>

      {data.prontuario ? (
        <div className="rounded-(--r-lg) border border-border bg-surface p-4 shadow-sm">
          <ProntuarioEditor
            key={data.prontuario.id}
            prontuario={data.prontuario}
            canEdit={data.canEditProntuario}
            timeZone={timeZone}
          />
        </div>
      ) : data.patientId ? (
        <Alert variant="info">
          O prontuário será criado quando o paciente estiver em atendimento.
        </Alert>
      ) : (
        <Alert variant="info">
          Atendimento sem paciente cadastrado (walk-in) — sem prontuário.
        </Alert>
      )}
    </div>
  );
}
