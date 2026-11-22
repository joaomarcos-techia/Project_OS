'use client';

/**
 * P8.4 — itens executados adicionais da guia SP/SADT, na conferência: a recepção completa os itens
 * de contrato executados na sessão além do agendado (o médico não é obrigado). Só item de contrato,
 * nenhum campo clínico. O faturamento desses itens é a decisão P8.4-r: enquanto ela não vier, o
 * item fica registrado e a tela diz que ele ainda não é faturado.
 */
import { useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionResult } from '@/contexts/health-insurance/actions';

import { TextAction, useRunner } from './action-ui';

export interface ExtraItemsPanelItem {
  id: string;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
  /** Para itens ativos: faturável ou não, e por quê (mensagem para o usuário). */
  billing: { bill: true } | { bill: false; message: string | null; blocksApproval: boolean } | null;
}

export interface ExtraItemsPanelSession {
  appointmentId: string;
  /** `AAAA-MM-DD`. */
  executedOn: string;
  items: ExtraItemsPanelItem[];
}

const shortDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : ymd;
};

function RecordForm({
  appointmentId,
  options,
  action,
}: {
  appointmentId: string;
  options: Array<{ id: string; label: string }>;
  action: (input: { appointmentId: string; contractLineId: string; quantity: number }) => Promise<ActionResult<unknown>>;
}) {
  const id = useId();
  const { pending, runAction } = useRunner();
  const [lineId, setLineId] = useState(options[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  if (options.length === 0) {
    return <p className="text-(length:--fs-sm) text-fg-muted">Não há linha de contrato SP/SADT desta operadora para escolher.</p>;
  }
  return (
    <form
      aria-label="Registrar item executado"
      className="mt-(--sp-2) grid gap-(--sp-2) md:grid-cols-[1fr_8rem_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const q = Number(quantity);
        if (!Number.isInteger(q) || q < 1 || q > 999) {
          setError('A quantidade precisa ser um número inteiro de 1 a 999.');
          return;
        }
        runAction(
          () => action({ appointmentId, contractLineId: lineId, quantity: q }),
          'Item executado registrado',
          () => setQuantity('1'),
          false,
          setError,
        );
      }}
    >
      <Field label="Item do contrato" htmlFor={`${id}-line`} required>
        <Select id={`${id}-line`} value={lineId} onChange={(e) => setLineId(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quantidade" htmlFor={`${id}-qty`} required>
        <Input
          id={`${id}-qty`}
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Aguarde…' : 'Registrar item'}
      </Button>
      {error ? (
        <p
          role="alert"
          className="rounded-(--r-md) border border-danger-600 p-(--sp-2) text-(length:--fs-sm) text-danger-700 md:col-span-3"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ExtraItemsPanel({
  sessions,
  options,
  editable,
  recordAction,
  cancelAction,
}: {
  sessions: ExtraItemsPanelSession[];
  options: Array<{ id: string; label: string }>;
  /** Guia em edição (dados pendentes ou para conferir) e perfil que confere. */
  editable: boolean;
  recordAction: (input: { appointmentId: string; contractLineId: string; quantity: number }) => Promise<ActionResult<unknown>>;
  cancelAction: (input: { itemId: string; reason: string }) => Promise<ActionResult<unknown>>;
}) {
  if (sessions.length === 0) {
    return <p className="text-(length:--fs-sm) text-fg-muted">Esta guia ainda não tem sessão registrada.</p>;
  }
  return (
    <div className="flex flex-col gap-(--sp-4)">
      <p className="text-(length:--fs-sm) text-fg-muted">
        Itens do contrato feitos na sessão além do agendado. Só o que está no contrato; nada clínico.
      </p>
      {sessions.map((s) => {
        const active = s.items.filter((i) => i.status === 'active');
        const cancelled = s.items.filter((i) => i.status === 'cancelled');
        return (
          <section key={s.appointmentId} aria-label={`Sessão de ${shortDay(s.executedOn)}`}>
            <h3 className="text-(length:--fs-sm) font-semibold">Sessão de {shortDay(s.executedOn)}</h3>
            {active.length === 0 ? (
              <p className="text-(length:--fs-sm) text-fg-muted">Nenhum item adicional registrado.</p>
            ) : (
              <ul className="mt-(--sp-1) flex flex-col gap-(--sp-2)">
                {active.map((i) => (
                  <li key={i.id} className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
                    <span>
                      <span className="tabular-nums">{i.tableCode} · {i.procedureCode}</span> — {i.description} ·{' '}
                      <span className="tabular-nums">qtd. {i.quantity}</span>
                    </span>
                    {i.billing && !i.billing.bill ? (
                      <span>
                        <Badge tone="amber">Não faturado</Badge>{' '}
                        {i.billing.message ?? 'Fica no atendimento, sem cobrança.'}
                      </span>
                    ) : i.billing?.bill ? (
                      <span>
                        <Badge tone="green">Faturável</Badge>
                      </span>
                    ) : null}
                    {editable ? (
                      <div>
                        <TextAction
                          label="Cancelar item"
                          success="Item cancelado"
                          action={cancelAction}
                          base={{ itemId: i.id }}
                          field="reason"
                          fieldLabel="Motivo do cancelamento"
                          minLength={3}
                          variant="danger"
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {cancelled.length > 0 ? (
              <details className="mt-(--sp-1) text-(length:--fs-sm)">
                <summary>Cancelados ({cancelled.length})</summary>
                <ul className="mt-(--sp-1) flex flex-col gap-(--sp-1) text-fg-muted">
                  {cancelled.map((i) => (
                    <li key={i.id}>
                      {i.tableCode} · {i.procedureCode} — {i.description} · motivo: {i.cancelReason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {editable ? (
              <RecordForm appointmentId={s.appointmentId} options={options} action={recordAction} />
            ) : (
              <p className="mt-(--sp-1) text-(length:--fs-sm) text-fg-muted">
                A guia não está em conferência: para mudar os itens, devolva a guia para correção.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
