import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import {
  cancelSadtRequestAction,
  cancelSadtRequestItemAction,
  completeSadtRequestAction,
  denySadtRequestAction,
  exportSadtRequestDocumentAction,
} from '@/contexts/health-insurance/actions';
import { getSadtRequestDetail } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../../_lib/access';
import { ActionButton, Actions, TextAction } from '../../_lib/action-ui';
import { CARE_TYPES } from '../../_lib/constants';
import { AuthorizationForm, CheckRequestButton, IndicationForm, LinkSessionForm } from '../../_lib/sadt-ui';
import { GuideStatusBadge, SADT_STATUS, SadtStatusBadge } from '../../_lib/status';

export const dynamic = 'force-dynamic';
/** Ações desta página validam XML no XSD oficial e/ou geram PDF (motor no próprio processo). */
export const maxDuration = 60;

const OPEN = ['draft', 'checked', 'awaiting_authorization', 'ready'];
const ACCEPTS_SESSIONS = ['awaiting_authorization', 'authorized', 'partially_authorized', 'ready'];
/** Estados em que o pedido à operadora pode ganhar o documento oficial (mesma lista do serviço). */
const DOCUMENT_STATES = ['awaiting_authorization', 'authorized', 'partially_authorized', 'denied'];
const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';

export default async function SolicitacaoPage({ params }: { params: Promise<{ requestId: string }> }) {
  const access = await conveniosAccess('Solicitação SP/SADT');
  if (!access.ok) return access.view;
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(requestId)) notFound();
  const r = await getSadtRequestDetail(access.clinicId, requestId);
  if (!r) notFound();
  const m = access.canManage;
  const ref = { requestId: r.id, version: r.version };
  const activeItems = r.itemRows.filter((i) => i.status === 'active');
  const careLabel = CARE_TYPES.find(([code]) => code === r.careType)?.[1] ?? r.careType ?? '—';

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title={`Solicitação ${r.requestNumber ?? '(rascunho)'}`}
        description={`${r.patientName} · ${r.insurerName} · solicitada em ${shortDate(r.requestedOn)}`}
        crumbs={[{ label: 'Solicitações', href: '/convenios/solicitacoes' }, { label: r.requestNumber ?? 'rascunho' }]}
      />

      <PanelCard title="Situação" regionLabel="Situação da solicitação">
        <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-4">
          <div><dt className="text-fg-muted">Etapa</dt><dd><SadtStatusBadge status={r.status} /></dd></div>
          <div><dt className="text-fg-muted">Solicitante</dt><dd>{r.requesterName}{r.requesterKind === 'external' ? ' (externo)' : ''}</dd></div>
          <div><dt className="text-fg-muted">Caráter e tipo</dt><dd>{r.careCharacter === '2' ? 'Urgência' : 'Eletivo'} · {careLabel}</dd></div>
          <div><dt className="text-fg-muted">Indicação clínica</dt><dd>{r.hasClinicalIndication ? 'informada (cifrada)' : 'não informada'}</dd></div>
          <div><dt className="text-fg-muted">Autorização</dt><dd>{r.authorizationRequirement === 'required' ? 'exigida pelo contrato' : r.authorizationRequirement === 'not_required' ? 'não exigida' : 'a conferir'}</dd></div>
          <div><dt className="text-fg-muted">Sessões executadas</dt><dd className="tabular-nums">{r.executed} de {r.requested}</dd></div>
        </dl>
        {r.issues.length > 0 ? (
          <Alert variant="warning" className="mt-(--sp-3)">
            <ul className="list-disc pl-(--sp-4)">
              {r.issues.map((i) => (
                <li key={`${i.code}-${i.field}`}>{i.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {r.status === 'awaiting_authorization' ? (
          <Alert variant="info" className="mt-(--sp-3)">
            Envie o pedido pelo canal da operadora e registre aqui a resposta. Sessões concluídas antes disso ficam pendentes, sem guia; a guia sai sozinha quando a autorização é registrada.
          </Alert>
        ) : null}
        {r.cancelReason ? <p className="mt-(--sp-2) text-(length:--fs-sm)">Cancelada: {r.cancelReason}</p> : null}
        <div className="mt-(--sp-3)">
          <Actions>
            {!r.hasClinicalIndication && ['draft', 'checked', 'awaiting_authorization', 'ready'].includes(r.status) ? (
              <IndicationForm requestId={r.id} version={r.version} external={r.requesterKind === 'external'} />
            ) : null}
            {m && r.status === 'draft' ? <CheckRequestButton requestId={r.id} version={r.version} careType={r.careType} /> : null}
            {m && r.status === 'awaiting_authorization' ? (
              <AuthorizationForm
                requestId={r.id}
                version={r.version}
                items={activeItems.map((i) => ({ id: i.id, label: `${i.procedureCode} — ${i.description}`, requested: i.quantityRequested }))}
              />
            ) : null}
            {m && r.status === 'awaiting_authorization' ? (
              <TextAction
                label="Registrar negativa"
                success="Negativa registrada"
                variant="danger"
                action={denySadtRequestAction}
                base={ref}
                field="denialReason"
                fieldLabel="Motivo informado pela operadora"
                minLength={3}
              />
            ) : null}
            {m && ['authorized', 'partially_authorized', 'ready', 'denied'].includes(r.status) ? (
              <TextAction
                label="Encerrar solicitação"
                success="Solicitação encerrada"
                action={completeSadtRequestAction}
                base={ref}
                field="note"
                fieldLabel="Motivo do encerramento (o saldo não executado deixa de valer)"
              />
            ) : null}
            {m && OPEN.includes(r.status) && r.executed === 0 ? (
              <TextAction
                label="Cancelar solicitação"
                success="Solicitação cancelada"
                variant="danger"
                action={cancelSadtRequestAction}
                base={ref}
                field="reason"
                fieldLabel="Motivo do cancelamento"
              />
            ) : null}
          </Actions>
        </div>
      </PanelCard>

      {r.authorization ? (
        <PanelCard title="Resposta da operadora" regionLabel="Resposta da operadora" className="mt-(--sp-4)">
          <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-4">
            <div><dt className="text-fg-muted">Situação</dt><dd><SadtStatusBadge status={r.authorization.status === 'requested' ? 'awaiting_authorization' : r.authorization.status} /></dd></div>
            <div><dt className="text-fg-muted">Guia na operadora</dt><dd>{r.authorization.operatorGuideNumber ?? '—'}</dd></div>
            <div><dt className="text-fg-muted">Protocolo</dt><dd>{r.authorization.operatorProtocol ?? '—'}</dd></div>
            <div><dt className="text-fg-muted">Senha</dt><dd>{r.authorization.hasPassword ? `registrada${r.authorization.passwordValidUntil ? `, válida até ${shortDate(r.authorization.passwordValidUntil)}` : ''}` : '—'}</dd></div>
            <div><dt className="text-fg-muted">Autorizada em</dt><dd>{shortDate(r.authorization.authorizedOn)}</dd></div>
            {r.authorization.denialReason ? <div className="col-span-2"><dt className="text-fg-muted">Motivo da negativa</dt><dd>{r.authorization.denialReason}</dd></div> : null}
          </dl>
        </PanelCard>
      ) : null}

      {r.document ? (
        <PanelCard title="Documento oficial do pedido" regionLabel="Documento oficial do pedido à operadora" className="mt-(--sp-4)">
          {r.document.pdfFileId ? (
            <div className="flex flex-wrap items-center gap-(--sp-2) text-(length:--fs-sm)">
              <span className="text-fg-muted">
                Gerado em {dateTime(r.document.generatedAt)}: XML validado no XSD da ANS e PDF no modelo oficial, guardados como foram gerados.
              </span>
              <a href={`/financeiro/convenios/solicitacoes/${r.id}/pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Abrir PDF
              </a>
              {m && r.document.xmlFileId ? (
                <a href={`/financeiro/convenios/arquivos/${r.document.xmlFileId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Baixar XML (TISS)
                </a>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              <p className="text-fg-muted">
                O documento oficial ainda não foi gerado. Ele sai da solicitação conferida, com a carteirinha lida para a autorização, e fica guardado como foi gerado.
              </p>
              {m && DOCUMENT_STATES.includes(r.status) ? (
                <Actions>
                  <ActionButton label="Gerar documento oficial" success="Documento gerado e validado no XSD" variant="primary" action={exportSadtRequestDocumentAction.bind(null, { requestId: r.id })} />
                  <ActionButton label="Gerar (recém-nascido na carteirinha do responsável)" success="Documento gerado e validado no XSD" action={exportSadtRequestDocumentAction.bind(null, { requestId: r.id, newborn: true })} />
                </Actions>
              ) : null}
            </div>
          )}
        </PanelCard>
      ) : null}

      <PanelCard title="Procedimentos" regionLabel="Procedimentos solicitados" className="mt-(--sp-4)">
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Pedido</TableHead>
                <TableHead className="text-right">Autorizado</TableHead>
                <TableHead className="text-right">Executado</TableHead>
                <TableHead>Situação</TableHead>
                {m ? <TableHead aria-label="Ações" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.itemRows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="tabular-nums">{i.tableCode}/{i.procedureCode}</TableCell>
                  <TableCell>{i.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantityRequested}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantityAuthorized ?? (r.authorizationRequirement === 'not_required' ? 'não exige' : '—')}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.executed}</TableCell>
                  <TableCell>{i.status === 'active' ? 'ativo' : `cancelado: ${i.cancelReason ?? ''}`}</TableCell>
                  {m ? (
                    <TableCell>
                      {i.status === 'active' && i.executed === 0 && !['completed', 'cancelled', 'expired'].includes(r.status) ? (
                        <TextAction
                          label="Cancelar item"
                          success="Procedimento cancelado"
                          variant="ghost"
                          action={cancelSadtRequestItemAction}
                          base={{ requestId: r.id, itemId: i.id }}
                          field="reason"
                          fieldLabel="Motivo"
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
        {m && ACCEPTS_SESSIONS.includes(r.status) ? (
          <div className="mt-(--sp-3)">
            <h3 className="mb-(--sp-2) text-(length:--fs-sm) font-medium">Ligar sessão agendada</h3>
            <LinkSessionForm
              requestId={r.id}
              items={activeItems.map((i) => ({ id: i.id, label: `${i.procedureCode} — ${i.description}` }))}
              appointments={r.linkableAppointments.map((a) => ({ id: a.id, label: `${dateTime(a.scheduledAt)} (${a.status})` }))}
            />
          </div>
        ) : null}
      </PanelCard>

      <PanelCard title="Guias geradas pelas sessões" regionLabel="Guias da solicitação" className="mt-(--sp-4)">
        {r.guides.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma sessão executada ainda. A guia SP/SADT nasce quando o atendimento ligado é concluído.</p>
        ) : (
          <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
            {r.guides.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-(--sp-2)">
                <Link href={`/convenios/guias/${g.id}`} className="font-medium hover:underline">Guia {g.number}</Link>
                <GuideStatusBadge status={g.status} />
                <span className="tabular-nums">{g.sessions} sessão(ões) · {brl(g.totalValueCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard title="Histórico" regionLabel="Histórico da solicitação" className="mt-(--sp-4)">
        <ol className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
          {r.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="tabular-nums text-fg-muted">{dateTime(e.at)}</span> ·{' '}
              {e.from === e.to ? (SADT_STATUS[e.to]?.label ?? e.to) : `${e.from ? (SADT_STATUS[e.from]?.label ?? e.from) : 'criada'} → ${SADT_STATUS[e.to]?.label ?? e.to}`}
              {e.note ? ` — ${e.note}` : ''}
              {e.via === 'automation' ? ' (automático)' : ''}
            </li>
          ))}
        </ol>
      </PanelCard>
    </>
  );
}
