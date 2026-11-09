'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { uuidv4 } from '@/lib/ui/uuid';

import { grantConsentForm, revokeConsentForm, type LgpdFormState } from '../actions';

const INITIAL: LgpdFormState = { error: null, message: null };

/**
 * LGPD-005 — estado atual do consentimento + conceder/revogar.
 *
 * O relatório encontrou o domínio completo (append-only, auditado, idempotente,
 * integrado à suppression list) e ZERO callers: não havia página, action, rota
 * ou ferramenta que o invocasse. A clínica não conseguia operar
 * conceder → consultar → revogar, nem mostrar ao titular qual é a decisão
 * vigente. Este card é a entrada que faltava.
 *
 * O que ele NÃO faz, de propósito: editar decisão antiga. Cada clique escreve
 * uma linha nova com versão incrementada — o histórico é a prova, e reescrevê-lo
 * destruiria exatamente o que dá valor jurídico ao registro.
 */
export interface ConsentPurposeView {
  purpose: string;
  label: string;
  description: string;
  granted: boolean;
  version: number;
  recordedAt: string | null;
}

export function ConsentCard({
  patientId,
  purposes,
  canEdit,
  timeZone,
}: {
  patientId: string;
  purposes: ConsentPurposeView[];
  /** `edit:patient` — a mesma permissão que as actions de domínio exigem. */
  canEdit: boolean;
  timeZone: string;
}) {
  const [grantState, grant, granting] = useActionState(grantConsentForm, INITIAL);
  const [revokeState, revoke, revoking] = useActionState(revokeConsentForm, INITIAL);
  const state = grantState.error || grantState.message ? grantState : revokeState;
  const busy = granting || revoking;

  return (
    <Card className="p-(--card-pad)">
      <h2 className="mb-1 text-balance text-(length:--fs-h4) font-semibold">
        Consentimentos (LGPD)
      </h2>
      <p className="mb-4 text-pretty text-(length:--fs-xs) text-fg-muted">
        Decisão vigente por finalidade. Cada alteração cria uma nova versão — o histórico é
        preservado. Ter o telefone cadastrado não autoriza nem dispara mensagens por WhatsApp.
      </p>

      {state.error ? (
        <Alert variant="danger" className="mb-3">
          {state.error}
        </Alert>
      ) : null}
      {state.message ? (
        <Alert variant="success" className="mb-3">
          {state.message}
        </Alert>
      ) : null}

      <ul className="flex flex-col">
        {purposes.map((p) => (
          <li
            key={p.purpose}
            className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-(length:--fs-sm) font-medium">{p.label}</span>
                <Badge tone={p.granted ? 'green' : 'gray'}>
                  {p.granted ? 'Concedido' : 'Não concedido'}
                </Badge>
              </div>
              <p className="text-pretty text-(length:--fs-xs) text-fg-muted">{p.description}</p>
              {p.recordedAt ? (
                <p className="text-(length:--fs-2xs) text-fg-subtle tabular-nums">
                  versão {p.version} ·{' '}
                  {new Date(p.recordedAt).toLocaleString('pt-BR', { timeZone })}
                </p>
              ) : (
                <p className="text-(length:--fs-2xs) text-fg-subtle">Sem decisão registrada.</p>
              )}
            </div>

            {canEdit ? (
              <form action={p.granted ? revoke : grant} className="shrink-0">
                <input type="hidden" name="id" value={patientId} />
                <input type="hidden" name="purpose" value={p.purpose} />
                <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                {!p.granted &&
                (p.purpose === 'agendamento_whatsapp' || p.purpose === 'cobranca_whatsapp') ? (
                  <label className="mb-2 flex max-w-64 items-start gap-2 text-(length:--fs-xs) text-fg-muted">
                    <input type="checkbox" name="optInConfirmed" required className="mt-0.5" />
                    Confirmo que o paciente autorizou esta finalidade pelo WhatsApp.
                  </label>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant={p.granted ? 'ghost' : 'secondary'}
                  className="min-h-(--hit-target)"
                  disabled={busy}
                >
                  {p.granted ? 'Revogar' : 'Conceder'}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
