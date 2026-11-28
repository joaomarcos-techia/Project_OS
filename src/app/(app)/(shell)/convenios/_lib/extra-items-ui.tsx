'use client';

/**
 * P8.4 — itens executados adicionais da guia SP/SADT, na conferência, com a política P8.4-r
 * aprovada em 24/11/2026: o item fica sempre registrado; nada entra na guia sozinho; a recepção
 * liga a autorização concedida (quando o contrato exige); o faturamento inclui na guia ou registra
 * que não será faturado, com motivo; a guia com item pendente não é aprovada em silêncio.
 *
 * A tela só mostra o que a política diz (`decision`, calculada no servidor) e oferece o que o
 * papel permite; o servidor confere tudo de novo. Nenhum valor aparece aqui, nem dado clínico.
 */
import { useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionResult } from '@/contexts/health-insurance/actions';

import { ActionButton, TextAction, useRunner } from './action-ui';

export type ExtraItemPanelStatus = 'recorded' | 'regularized' | 'included' | 'excluded' | 'cancelled';
export type ExtraItemPanelStage =
  | 'awaiting_authorization'
  | 'authorization_available'
  | 'ready_to_include'
  | 'authorization_invalid'
  | 'insurer_forbids'
  | 'included'
  | 'included_in_dead_guide'
  | 'not_billed'
  | 'cancelled';

export interface ExtraItemsPanelItem {
  id: string;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  status: ExtraItemPanelStatus;
  exclusionReason: string | null;
  cancelReason: string | null;
  decision: {
    stage: ExtraItemPanelStage;
    pending: boolean;
    canRegularize: boolean;
    canInclude: boolean;
    canExclude: boolean;
    canCancel: boolean;
    includeNeedsInsurerConfirmation: boolean;
    message: string;
  };
}

export interface ExtraItemsPanelSession {
  appointmentId: string;
  /** `AAAA-MM-DD`. */
  executedOn: string;
  items: ExtraItemsPanelItem[];
}

type Act<T> = (input: T) => Promise<ActionResult<unknown>>;

export interface ExtraItemsPanelActions {
  record: Act<{ appointmentId: string; contractLineId: string; quantity: number }>;
  cancel: Act<{ itemId: string; reason: string }>;
  regularize: Act<{ itemId: string }>;
  include: Act<{ itemId: string; insurerRuleConfirmed: boolean }>;
  exclude: Act<{ itemId: string; reason: string }>;
}

const STAGE: Record<ExtraItemPanelStage, { label: string; tone: 'amber' | 'green' | 'gray' | 'red' | 'blue' }> = {
  awaiting_authorization: { label: 'Aguardando autorização', tone: 'amber' },
  authorization_available: { label: 'Autorização disponível', tone: 'amber' },
  ready_to_include: { label: 'Aguardando decisão do faturamento', tone: 'blue' },
  authorization_invalid: { label: 'Autorização não serve mais', tone: 'red' },
  insurer_forbids: { label: 'Operadora não aceita', tone: 'red' },
  included: { label: 'Incluído na guia', tone: 'green' },
  included_in_dead_guide: { label: 'Guia anterior cancelada', tone: 'amber' },
  not_billed: { label: 'Não faturado por decisão', tone: 'gray' },
  cancelled: { label: 'Registro cancelado', tone: 'gray' },
};

const shortDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : ymd;
};

/** Formulário de registro: só linha do contrato e quantidade (nenhum campo clínico, nenhum valor). */
export function RecordExtraItemForm({
  appointmentId,
  options,
  action,
}: {
  appointmentId: string;
  options: Array<{ id: string; label: string }>;
  action: ExtraItemsPanelActions['record'];
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

/** "Incluir na guia": com a regra da operadora desconhecida, pede a confirmação do contrato. */
function IncludeAction({ item, action }: { item: ExtraItemsPanelItem; action: ExtraItemsPanelActions['include'] }) {
  const { pending, runAction } = useRunner();
  const [confirmed, setConfirmed] = useState(false);
  const needs = item.decision.includeNeedsInsurerConfirmation;
  return (
    <div className="flex flex-col gap-(--sp-1)">
      {needs ? (
        <label className="flex items-start gap-(--sp-2) text-(length:--fs-sm)">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            aria-label="Confirmo que o contrato desta operadora aceita este item"
          />
          A regra desta operadora não está registrada: confirmo que o contrato aceita item executado além do solicitado.
        </label>
      ) : null}
      <div>
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={pending || (needs && !confirmed)}
          onClick={() => runAction(() => action({ itemId: item.id, insurerRuleConfirmed: needs ? confirmed : false }), 'Item incluído na guia')}
        >
          {pending ? 'Aguarde…' : 'Incluir na guia'}
        </Button>
      </div>
    </div>
  );
}

export function ExtraItemsPanel({
  sessions,
  options,
  editable,
  canRegularize,
  canBill,
  actions,
}: {
  sessions: ExtraItemsPanelSession[];
  options: Array<{ id: string; label: string }>;
  /** Guia em edição e perfil que confere (recepção ou faturamento): registrar e cancelar registro. */
  editable: boolean;
  /** Recepção ou faturamento: ligar a autorização concedida. */
  canRegularize: boolean;
  /** Faturamento: incluir na guia e registrar que não será faturado. */
  canBill: boolean;
  actions: ExtraItemsPanelActions;
}) {
  if (sessions.length === 0) {
    return <p className="text-(length:--fs-sm) text-fg-muted">Esta guia ainda não tem sessão registrada.</p>;
  }
  return (
    <div className="flex flex-col gap-(--sp-4)">
      <p className="text-(length:--fs-sm) text-fg-muted">
        Itens do contrato feitos na sessão além do agendado. Só o que está no contrato; nada clínico. Nenhum item entra
        na guia sem a decisão do faturamento.
      </p>
      {sessions.map((s) => {
        const current = s.items.filter((i) => i.status !== 'excluded' && i.status !== 'cancelled');
        const history = s.items.filter((i) => i.status === 'excluded' || i.status === 'cancelled');
        return (
          <section key={s.appointmentId} aria-label={`Sessão de ${shortDay(s.executedOn)}`}>
            <h3 className="text-(length:--fs-sm) font-semibold">Sessão de {shortDay(s.executedOn)}</h3>
            {current.length === 0 ? (
              <p className="text-(length:--fs-sm) text-fg-muted">Nenhum item adicional em aberto.</p>
            ) : (
              <ul className="mt-(--sp-1) flex flex-col gap-(--sp-3)">
                {current.map((i) => {
                  const st = STAGE[i.decision.stage];
                  return (
                    <li key={i.id} data-item={i.id} data-stage={i.decision.stage} className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
                      <span>
                        <span className="tabular-nums">{i.tableCode} · {i.procedureCode}</span> — {i.description} ·{' '}
                        <span className="tabular-nums">qtd. {i.quantity}</span>
                      </span>
                      <span>
                        <Badge tone={st.tone}>{st.label}</Badge> {i.decision.message}
                      </span>
                      <div className="flex flex-wrap items-start gap-(--sp-2)">
                        {canRegularize && i.decision.canRegularize ? (
                          <ActionButton
                            label="Ligar a autorização"
                            success="Autorização ligada ao item"
                            action={() => actions.regularize({ itemId: i.id })}
                          />
                        ) : null}
                        {canBill && i.decision.canInclude ? <IncludeAction item={i} action={actions.include} /> : null}
                        {canBill && i.decision.canExclude ? (
                          <TextAction
                            label="Não faturar"
                            success="Registrado como não faturado"
                            action={actions.exclude}
                            base={{ itemId: i.id }}
                            field="reason"
                            fieldLabel="Por que este item não será faturado"
                            hint="Obrigatório (10 a 300 caracteres). O registro do atendimento fica; nada vai à guia nem ao recebível."
                            minLength={10}
                          />
                        ) : null}
                        {editable && i.decision.canCancel ? (
                          <TextAction
                            label="Cancelar registro"
                            success="Registro cancelado"
                            action={actions.cancel}
                            base={{ itemId: i.id }}
                            field="reason"
                            fieldLabel="Motivo do cancelamento (registro errado)"
                            minLength={3}
                            variant="danger"
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {history.length > 0 ? (
              <details className="mt-(--sp-1) text-(length:--fs-sm)">
                <summary>Não faturados e cancelados ({history.length})</summary>
                <ul className="mt-(--sp-1) flex flex-col gap-(--sp-1) text-fg-muted">
                  {history.map((i) => (
                    <li key={i.id} data-item={i.id} data-stage={i.decision.stage}>
                      {i.tableCode} · {i.procedureCode} — {i.description} · qtd. {i.quantity} ·{' '}
                      {i.status === 'excluded' ? `não faturado: ${i.exclusionReason}` : `cancelado: ${i.cancelReason}`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {editable ? (
              <RecordExtraItemForm appointmentId={s.appointmentId} options={options} action={actions.record} />
            ) : (
              <p className="mt-(--sp-1) text-(length:--fs-sm) text-fg-muted">
                A guia não está em edição: para registrar ou incluir itens, devolva a guia para correção.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Regra 5 da P8.4-r: com item pendente, "Aprovar e emitir" não aparece; o faturamento resolve os
 * itens (incluir ou não faturar) ou aprova sem eles, com motivo, numa ação só (o servidor exclui e
 * aprova na mesma transação, ou nada acontece).
 */
export function PendingExtraItemsApproval({
  count,
  guideId,
  canBill,
  approveWithoutAction,
}: {
  count: number;
  guideId: string;
  canBill: boolean;
  approveWithoutAction: Act<{ guideId: string; reason: string }>;
}) {
  if (count === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-warning-500 p-(--sp-3) text-(length:--fs-sm)">
      <p>
        <Badge tone="amber">Itens adicionais pendentes</Badge>{' '}
        {count === 1
          ? 'Há 1 item executado adicional sem decisão nesta guia.'
          : `Há ${count} itens executados adicionais sem decisão nesta guia.`}{' '}
        A guia só é aprovada depois de incluir os itens ou de aprová-la sem eles, com o motivo.
      </p>
      {canBill ? (
        <div>
          <TextAction
            label="Aprovar sem os itens pendentes"
            success="Guia aprovada e emitida; itens registrados como não faturados"
            action={approveWithoutAction}
            base={{ guideId }}
            field="reason"
            fieldLabel="Por que os itens pendentes não serão faturados"
            hint="Obrigatório (10 a 300 caracteres). Os itens ficam no atendimento como não faturados por decisão."
            minLength={10}
          />
        </div>
      ) : null}
    </div>
  );
}
