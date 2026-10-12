/**
 * EC-32 — faixa da Agenda com as mensagens automáticas que não chegaram ao
 * paciente e ainda pedem ação da recepção.
 *
 * É a mesma peça `qoro-alert-row` do Caixa e do Painel: a faixa é o resumo, e o
 * detalhe (quem, qual mensagem, o que fazer, por quê) fica no `<details>`
 * nativo. Server component; só o "Copiar link" é ilha cliente.
 *
 * Não repete o aviso da CONTA do WhatsApp (pagamento da WABA, número
 * bloqueado): esse é da faixa de saúde do WhatsApp. Aqui cada item é um
 * paciente a quem alguém precisa recorrer.
 */
import { ChevronRight, CircleAlert, CircleX } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { CopyChargeLinkButton } from './copy-charge-link-button';
import {
  BADGE_LABEL,
  COPY_LINK_LABEL,
  KIND_LABEL,
  LIMITE_DA_LISTA,
  NAO_SERA_REENVIADA,
  actionCopy,
  badgeTitle,
  causeCopy,
  contextCopy,
  summaryCopy,
} from './delivery-failure-copy';
import type { AgendaDeliveryFailure } from './delivery-failures';

/**
 * Selo da linha da consulta, ao lado do "Sinal pendente". O motivo vai no
 * `title`; o detalhe e a ação ficam na faixa. Entrega sem confirmação não é
 * dita como recusa.
 */
export function DeliveryFailureBadge({ failure }: { failure: AgendaDeliveryFailure }) {
  const unconfirmed = failure.causa.kind === 'unconfirmed';
  return (
    <span title={badgeTitle(failure.causa)}>
      <Badge tone={unconfirmed ? 'amber' : 'red'}>
        {unconfirmed ? (
          <CircleAlert aria-hidden="true" className="size-3" />
        ) : (
          <CircleX aria-hidden="true" className="size-3" />
        )}
        {unconfirmed ? 'Entrega não confirmada' : BADGE_LABEL[failure.kind]}
      </Badge>
    </span>
  );
}

export function DeliveryFailureStrip({
  failures,
  limited,
  tz,
  canCopyLink,
  now = new Date(),
}: {
  failures: readonly AgendaDeliveryFailure[];
  /** A leitura bateu no teto: pode haver mais falhas no período. */
  limited: boolean;
  tz: string;
  /** edit:agenda — a action revalida; isto só decide mostrar o botão. */
  canCopyLink: boolean;
  now?: Date;
}) {
  const items = failures.filter((item) => item.acionavel);
  if (items.length === 0) return null;

  return (
    <details className="group mb-4" data-delivery-failures={items.length}>
      <summary
        data-tone="danger"
        className="qoro-alert-row cursor-pointer list-none [&::-webkit-details-marker]:hidden"
      >
        <CircleX aria-hidden="true" />
        <span className="qoro-alert-row-text">{summaryCopy(items, tz, now)}</span>
        <span className="qoro-alert-row-cta">Ver detalhes</span>
        <ChevronRight aria-hidden="true" className="transition-transform group-open:rotate-90" />
      </summary>

      <div className="mt-2 rounded-(--r-md) border border-border bg-surface p-3">
        <ul
          aria-label="Mensagens automáticas que não chegaram aos pacientes"
          className="max-h-[28rem] divide-y divide-border overflow-y-auto"
        >
          {items.map((item) => {
            const causa = causeCopy(item.causa);
            const contexto = contextCopy(item, tz);
            const copyLabel = COPY_LINK_LABEL[item.kind];
            return (
              <li key={item.jobId} className="grid gap-1.5 py-2.5 first:pt-0 last:pb-0">
                <p className="text-pretty text-(length:--fs-sm)">
                  <span className="font-semibold">{item.pacienteNome ?? 'Paciente'}</span>
                  {' · '}
                  {KIND_LABEL[item.kind]}
                  {contexto ? ` · ${contexto}` : null}
                </p>
                <p className="text-pretty text-(length:--fs-sm) font-medium">
                  {actionCopy(item, tz, now)}
                </p>
                {canCopyLink && item.linkCopiavel && copyLabel ? (
                  <CopyChargeLinkButton jobId={item.jobId} label={copyLabel} />
                ) : null}
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-(length:--fs-xs) text-fg-muted">
                  <span className="text-pretty">
                    {causa.motivo}
                    {causa.correcao ? ` ${causa.correcao}` : null}
                  </span>
                  {causa.codigo ? (
                    <span className="font-mono text-(length:--fs-2xs) tabular-nums">
                      {causa.codigo}
                    </span>
                  ) : null}
                </p>
                <p className="text-(length:--fs-xs) text-fg-subtle">{NAO_SERA_REENVIADA}</p>
              </li>
            );
          })}
        </ul>
        {limited ? (
          <p className="mt-2 text-pretty text-(length:--fs-xs) text-fg-muted">{LIMITE_DA_LISTA}</p>
        ) : null}
      </div>
    </details>
  );
}
