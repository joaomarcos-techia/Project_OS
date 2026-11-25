'use client';

/**
 * P8.4-r, exceção do médico (aprovada em 24/11/2026): bloco do CONSULTÓRIO para o profissional
 * registrar o item executado na PRÓPRIA sessão SP/SADT. É uma peça para a tela oficial do
 * consultório (PR #56, `attending-panel.tsx`), não uma tela paralela: o #56 monta este bloco no
 * painel do atendimento (handoff em docs/convenios/handoff-56-p84-consultorio.md).
 *
 * Mostra só o que o profissional precisa: o que já registrou e em que pé está, sem valor, sem
 * decisão de faturamento e sem campo clínico. O servidor confere a posse do atendimento
 * (`recordOwnSessionExtraItemAction`); a tela só esconde.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  loadSessionExtraItemsAction,
  recordOwnSessionExtraItemAction,
  type ActionResult,
} from '@/contexts/health-insurance/actions';

import { RecordExtraItemForm } from './extra-items-ui';

export interface SessionExtraItemsView {
  available: boolean;
  /** P5.2: resumo administrativo da cobertura (sem valor; carteirinha mascarada). */
  summary?: {
    insurerName: string;
    last4: string | null;
    status: string;
    statusLabel: string;
    issue: string | null;
  } | null;
  items: Array<{
    id: string;
    tableCode: string;
    procedureCode: string;
    description: string;
    quantity: number;
    stateLabel: string;
    recordedByMe: boolean;
  }>;
  options: Array<{ id: string; label: string }>;
}

export function SessionExtraItemsSection({
  appointmentId,
  view,
  recordAction,
}: {
  appointmentId: string;
  /** `getAppointmentExtraItems` (null = sessão de outra pessoa ou inexistente: nada aparece). */
  view: SessionExtraItemsView | null;
  recordAction: (input: { appointmentId: string; contractLineId: string; quantity: number }) => Promise<ActionResult<unknown>>;
}) {
  const summary = view?.summary ?? null;
  const extras = view?.available === true && view.options.length > 0;
  if (!summary && !extras) return null;
  return (
    <div className="flex flex-col gap-(--sp-2)">
      {summary ? (
        <p
          role="note"
          aria-label="Convênio do atendimento"
          data-insurance-summary={summary.status}
          className="rounded-(--r-md) border border-border px-(--sp-3) py-(--sp-2) text-(length:--fs-sm)"
        >
          <span className="font-semibold">Convênio:</span> {summary.insurerName}
          {summary.last4 ? <span className="tabular-nums"> ••••{summary.last4}</span> : null} · {summary.statusLabel}
          {summary.issue ? <span className="text-fg-muted"> — {summary.issue}</span> : null}
        </p>
      ) : null}
      {extras ? <ExtraItemsDetails appointmentId={appointmentId} view={view!} recordAction={recordAction} /> : null}
    </div>
  );
}

function ExtraItemsDetails({
  appointmentId,
  view,
  recordAction,
}: {
  appointmentId: string;
  view: SessionExtraItemsView;
  recordAction: (input: { appointmentId: string; contractLineId: string; quantity: number }) => Promise<ActionResult<unknown>>;
}) {
  return (
    <details className="rounded-(--r-md) border border-border p-(--sp-3) text-(length:--fs-sm)">
      <summary className="cursor-pointer font-semibold">Itens executados além do agendado</summary>
      <p className="mt-(--sp-1) text-fg-muted">
        Opcional. Registre só o item do contrato feito nesta sessão; a clínica decide o faturamento.
      </p>
      {view.items.length > 0 ? (
        <ul aria-label="Itens registrados nesta sessão" className="mt-(--sp-2) flex flex-col gap-(--sp-1)">
          {view.items.map((i) => (
            <li key={i.id}>
              <span className="tabular-nums">{i.tableCode} · {i.procedureCode}</span> — {i.description} · qtd.{' '}
              <span className="tabular-nums">{i.quantity}</span> · <span className="text-fg-muted">{i.stateLabel}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <RecordExtraItemForm appointmentId={appointmentId} options={view.options} action={recordAction} />
    </details>
  );
}

/**
 * O bloco pronto para o painel do atendimento do consultório (#56): carrega a leitura da própria
 * sessão e registra pela exceção do médico. O #56 só monta `<ConsultorioExtraItems appointmentId=… />`
 * (patch em docs/convenios/patches/56-consultorio-p84r.patch); sem 0167, sem convênio SP/SADT ou
 * em sessão de outra pessoa, não aparece nada.
 */
export function ConsultorioExtraItems({ appointmentId, refreshKey }: { appointmentId: string; refreshKey?: string }) {
  const [view, setView] = useState<SessionExtraItemsView | null>(null);
  const load = useCallback(async () => {
    const r = await loadSessionExtraItemsAction({ appointmentId });
    setView(r.ok ? r.data : null);
  }, [appointmentId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return (
    <SessionExtraItemsSection
      appointmentId={appointmentId}
      view={view}
      recordAction={async (input) => {
        const r = await recordOwnSessionExtraItemAction(input);
        if (r.ok) void load();
        return r;
      }}
    />
  );
}
