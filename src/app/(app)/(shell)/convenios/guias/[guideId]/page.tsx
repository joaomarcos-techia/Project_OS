import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import {
  answerAppealAction,
  approveGuideAction,
  cancelExtraItemAction,
  cancelGuideAction,
  createAppealAction,
  decideGlossAction,
  exportAppealXmlAction,
  fileAppealAction,
  reconcileGuideAction,
  recordExtraItemAction,
  returnGuideAction,
  reverseAllocationAction,
  reviewGuideAction,
  updateConsultaFieldsAction,
} from '@/contexts/health-insurance/actions';
import {
  getGuideDetail,
  getGuideExtraItems,
  getGuideSubstitution,
  guideEventLabel,
  ISSUE_OWNER_LABELS,
  listConsultaFieldOptions,
} from '@/contexts/health-insurance/queries';

import { brl, brlOrDash, ConveniosHeader, conveniosAccess, shortDate } from '../../_lib/access';
import { AttendanceCopyButton } from '../../_lib/attendance-copy-ui';
import { ActionButton, Actions, AnswerAppealForm, AppealForm, FileAppealForm, TextAction } from '../../_lib/action-ui';
import { ConsultaFieldsPanel } from '../../_lib/consulta-fields-ui';
import { ExtraItemsPanel } from '../../_lib/extra-items-ui';
import { GlossStatusBadge, GuideStatusBadge } from '../../_lib/status';
import { guideLabel } from '../../_lib/guide-label';
import { CANCELLATION_CHANNEL_LABELS, CANCELLATION_STATUS_LABELS, TABLE_46_LABELS } from '../../_lib/constants';
import {
  CancellationReceiptForm,
  CancellationRequestForm,
  CancellationXmlButton,
  CreateSubstituteButton,
} from '../../_lib/substitution-ui';

export const metadata: Metadata = { title: 'Guia de convênio' };

export const dynamic = 'force-dynamic';
/** Ações desta página validam XML no XSD oficial e/ou geram PDF (motor no próprio processo). */
export const maxDuration = 60;

const OPEN_GLOSS = ['informed', 'under_analysis', 'contested'];
/** Etapas em que o conteúdo da guia ainda se edita (0147/0161). */
const EDITABLE = ['pending_data', 'ready_for_review'];
/** P7.5: só a guia já enviada à operadora se cancela lá (antes, reabre; depois do resultado, recurso). */
const AT_OPERATOR = ['exported', 'sent', 'under_review'];
const ISSUED = ['approved', 'in_batch', 'exported', 'sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed', 'replaced'];

export default async function GuiaPage({ params }: { params: Promise<{ guideId: string }> }) {
  const access = await conveniosAccess('Guia');
  if (!access.ok) return access.view;
  const { guideId } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(guideId)) notFound();
  // Sem visão ampla, guia de outra pessoa é "não encontrada" (o servidor filtra por posse).
  const g = await getGuideDetail(access.clinicId, guideId, access.guideView);
  if (!g) notFound();
  // Matriz I.2: conferir, devolver e corrigir = recepção ou faturamento; aprovar, cancelar, glosa,
  // recurso e conciliação = faturamento. As actions conferem de novo no servidor.
  const review = access.rights.operate || access.rights.bill;
  const bill = access.rights.bill;
  // D24 (P0.3 de 15/11): em trial ou com a assinatura parada, a tela não oferece o que o
  // servidor recusa (ajustar, conferir, aprovar, devolver). Cancelar, conciliar e o que é da
  // conta com a operadora (preservação) seguem com o servidor decidindo.
  const operable = review && !access.commercial;
  const operableBill = bill && !access.commercial;
  const ref = { guideId: g.id, version: g.version };
  const label = guideLabel(g.guideType, g.number);
  // D11 (P4.6): opções da terminologia da própria guia, vigentes na data do atendimento.
  const consultaOptions =
    g.guideType === 'consulta' && g.terminologyVersion
      ? await listConsultaFieldOptions(access.clinicId, g.terminologyVersion, g.items[0]?.executedOn ?? null)
      : null;
  // P7.5 (0165): pedido, recibo da operadora e substituta — faturamento (o servidor confere de novo).
  const substitution = access.rights.seeValues ? await getGuideSubstitution(access.clinicId, g.id) : null;
  const activeCancellation = substitution?.cancellations.find((c) => c.status === 'awaiting_receipt' || c.status === 'confirmed') ?? null;
  const showSubstitution =
    substitution !== null &&
    (AT_OPERATOR.includes(g.status) || g.status === 'replaced' || substitution.replaces !== null || substitution.cancellations.length > 0);
  // P8.4 (candidata 0167): itens executados adicionais da SP/SADT; sem a tabela, o painel não aparece.
  const extraItems = g.guideType === 'sp_sadt' ? await getGuideExtraItems(access.clinicId, g.id) : null;
  const openGlosses = g.glosses.filter((x) => OPEN_GLOSS.includes(x.status) && !g.appeals.some((a) => ['draft', 'filed'].includes(a.status) && a.glossIds.includes(x.id)));

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title={label}
        description={`${g.insurerName}${g.patientName ? ` · ${g.patientName}` : ''}`}
        crumbs={[{ label: 'Guias', href: '/convenios/guias' }, { label }]}
        actions={
          ISSUED.includes(g.status) ? (
            <>
              {/* D-5: a via de atendimento (sem valores, carteirinha mascarada) é o documento da recepção e da médica. */}
              {access.rights.attendanceCopy ? <AttendanceCopyButton guideId={g.id} /> : null}
              {access.rights.emittedDocuments ? (
                <a href={`/financeiro/convenios/guias/${g.id}/pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  Ver PDF da guia
                </a>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-(--sp-4) lg:grid-cols-3">
        <PanelCard title="Situação" regionLabel="Situação da guia" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-4">
            <div>
              <dt className="text-fg-muted">Etapa</dt>
              <dd><GuideStatusBadge status={g.status} /></dd>
            </div>
            {access.rights.seeValues ? (
              <div>
                <dt className="text-fg-muted">Valor</dt>
                <dd className="font-semibold tabular-nums">{brlOrDash(g.totalValueCents)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-fg-muted">Lote</dt>
              <dd>{g.batchId ? <Link href={`/convenios/lotes/${g.batchId}`} className="hover:underline">{g.batchNumber}</Link> : '—'}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Revisão</dt>
              <dd>{g.revision}</dd>
            </div>
          </dl>
          {g.cancelReason ? <p className="mt-(--sp-2) text-(length:--fs-sm)">Motivo do cancelamento: {g.cancelReason}</p> : null}
          {review || bill ? (
            <div className="mt-(--sp-3)">
              <Actions>
                {operable && g.status === 'ready_for_review' && g.issues.length === 0 ? (
                  <ActionButton label="Marcar como conferida" success="Guia conferida" variant="primary" action={reviewGuideAction.bind(null, ref)} />
                ) : null}
                {operableBill && g.status === 'reviewed' ? (
                  <ActionButton label="Aprovar e emitir" success="Guia aprovada e emitida" variant="primary" action={approveGuideAction.bind(null, { guideId: g.id })} />
                ) : null}
                {operable && ['reviewed', 'approved'].includes(g.status) ? (
                  <TextAction label="Devolver para correção" success="Guia devolvida para correção" action={returnGuideAction} base={ref} field="note" fieldLabel="O que precisa ser corrigido" />
                ) : null}
                {bill && ['pending_data', 'ready_for_review', 'reviewed', 'approved'].includes(g.status) ? (
                  <TextAction label="Cancelar guia" success="Guia cancelada" variant="danger" action={cancelGuideAction} base={ref} field="note" fieldLabel="Motivo do cancelamento" hint="O cancelamento é final; o atendimento fica livre para uma guia nova. Se houver repasse autorizado ou pago, ele fica em revisão humana (pagamento bloqueado até a decisão); nada é estornado." />
                ) : null}
                {bill && g.account && g.account.pendingCents === 0 && g.status !== 'closed' && openGlosses.length === 0 ? (
                  <ActionButton label="Conciliar e encerrar" success="Guia conciliada" variant="primary" action={reconcileGuideAction.bind(null, ref)} />
                ) : null}
              </Actions>
            </div>
          ) : null}
        </PanelCard>

        <PanelCard title="Pendências" regionLabel="Pendências da guia">
          {g.issues.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma pendência de dado.</p>
          ) : (
            <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              {g.issues.map((i) => (
                <li key={`${i.code}-${i.field}`}>
                  <Badge tone="amber">{ISSUE_OWNER_LABELS[i.owner] ?? i.owner}</Badge> <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>

      {g.guideType === 'consulta' ? (
        <PanelCard title="Dados da consulta" regionLabel="Dados da consulta" className="mt-(--sp-4)">
          <ConsultaFieldsPanel
            guideId={g.id}
            version={g.version}
            overrides={g.consultaOverrides}
            options={consultaOptions}
            editable={operable && EDITABLE.includes(g.status)}
            issued={ISSUED.includes(g.status)}
            action={updateConsultaFieldsAction}
          />
        </PanelCard>
      ) : null}

      <PanelCard title="Procedimentos" regionLabel="Procedimentos da guia" className="mt-(--sp-4)">
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                {access.rights.seeValues ? <TableHead className="text-right">Valor</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.sequence}</TableCell>
                  <TableCell>{shortDate(it.executedOn)}</TableCell>
                  <TableCell className="tabular-nums">{it.tableCode} · {it.procedureCode}</TableCell>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                  {access.rights.seeValues ? <TableCell className="text-right tabular-nums">{brlOrDash(it.totalValueCents)}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </PanelCard>

      {extraItems?.available ? (
        <PanelCard title="Itens executados adicionais" regionLabel="Itens executados adicionais" className="mt-(--sp-4)">
          <ExtraItemsPanel
            sessions={extraItems.sessions.map((s) => ({
              appointmentId: s.appointmentId,
              executedOn: s.executedOn,
              items: s.items.map((i) => ({
                id: i.id,
                tableCode: i.tableCode,
                procedureCode: i.procedureCode,
                description: i.description,
                quantity: i.quantity,
                status: i.status,
                cancelReason: i.cancelReason,
                billing: i.billing
                  ? i.billing.bill
                    ? { bill: true as const }
                    : { bill: false as const, message: i.billing.issue?.message ?? null, blocksApproval: i.billing.blocksApproval }
                  : null,
              })),
            }))}
            options={extraItems.options}
            editable={operable && EDITABLE.includes(g.status)}
            recordAction={recordExtraItemAction}
            cancelAction={cancelExtraItemAction}
          />
        </PanelCard>
      ) : null}

      {g.account ? (
        <PanelCard title="Conta com a operadora" regionLabel="Conta da guia" className="mt-(--sp-4)">
          <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-5">
            <div><dt className="text-fg-muted">Faturado</dt><dd className="tabular-nums">{brl(g.account.billedCents)}</dd></div>
            <div><dt className="text-fg-muted">Recebido</dt><dd className="tabular-nums">{brl(g.account.paidCents)}</dd></div>
            <div><dt className="text-fg-muted">Glosa em aberto</dt><dd className="tabular-nums">{brl(g.account.glossOpenCents)}</dd></div>
            <div><dt className="text-fg-muted">Glosa definitiva</dt><dd className="tabular-nums">{brl(g.account.glossDefinitiveCents)}</dd></div>
            <div><dt className="text-fg-muted">A receber</dt><dd className="font-semibold tabular-nums">{brl(g.account.pendingCents)}</dd></div>
          </dl>
          {g.receivable ? (
            <p className="mt-(--sp-2) text-(length:--fs-xs) text-fg-muted">
              No financeiro da clínica: recebível da operadora ({g.receivable.status}), {brl(g.receivable.valorPagoCents)} recebidos
              {g.receivable.valorGlosadoCents > 0 ? `, ${brl(g.receivable.valorGlosadoCents)} baixados por glosa definitiva` : ''}.
            </p>
          ) : null}

          <h3 className="mt-(--sp-4) mb-(--sp-2) text-(length:--fs-sm) font-semibold">Glosas</h3>
          {g.glosses.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma glosa.</p>
          ) : (
            <ul className="flex flex-col gap-(--sp-3)">
              {g.glosses.map((x) => (
                <li key={x.id} className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)">
                  <div className="flex flex-wrap items-center gap-(--sp-2) text-(length:--fs-sm)">
                    <GlossStatusBadge status={x.status} />
                    <span>Código {x.code}</span>
                    <span className="font-semibold tabular-nums">{brl(x.amountCents)}</span>
                    {x.definitiveCents > 0 ? <span className="text-fg-muted">definitiva {brl(x.definitiveCents)}</span> : null}
                    {x.reversedCents > 0 ? <span className="text-fg-muted">revertida {brl(x.reversedCents)}</span> : null}
                    <span className="text-fg-muted">{x.source === 'statement' ? 'do demonstrativo' : 'registro manual'} · {shortDate(x.createdAt)}</span>
                  </div>
                  {bill && OPEN_GLOSS.includes(x.status) ? (
                    <Actions>
                      {x.status === 'informed' ? (
                        <ActionButton label="Analisar" success="Glosa em análise" action={decideGlossAction.bind(null, { glossId: x.id, version: x.version, to: 'under_analysis' })} />
                      ) : null}
                      {x.status !== 'contested' ? (
                        <ActionButton label="Contestar" success="Glosa contestada" action={decideGlossAction.bind(null, { glossId: x.id, version: x.version, to: 'contested' })} />
                      ) : null}
                      <TextAction
                        label="Aceitar como definitiva"
                        success="Glosa aceita como definitiva"
                        variant="danger"
                        action={decideGlossAction}
                        base={{ glossId: x.id, version: x.version, to: 'definitive' }}
                        field="reason"
                        fieldLabel="Por que a clínica aceita a glosa"
                        hint="A decisão é final e baixa o valor do que a operadora deve."
                      />
                    </Actions>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-(--sp-4) mb-(--sp-2) text-(length:--fs-sm) font-semibold">Recursos</h3>
          {bill ? (
            <AppealForm
              guideId={g.id}
              glosses={openGlosses.map((x) => ({ id: x.id, label: `Código ${x.code} · ${brl(x.amountCents)}` }))}
              action={createAppealAction}
            />
          ) : null}
          {g.appeals.length === 0 ? (
            <p className="mt-(--sp-2) text-(length:--fs-sm) text-fg-muted">Nenhum recurso.</p>
          ) : (
            <ul className="mt-(--sp-2) flex flex-col gap-(--sp-3)">
              {g.appeals.map((a) => (
                <li key={a.id} className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3) text-(length:--fs-sm)">
                  <div className="flex flex-wrap gap-(--sp-2)">
                    <Badge tone={a.status === 'answered' ? 'green' : a.status === 'cancelled' ? 'gray' : 'violet'}>
                      {{ draft: 'Em preparo', filed: 'Enviado', answered: 'Respondido', cancelled: 'Cancelado' }[a.status] ?? a.status}
                    </Badge>
                    {a.protocol ? <span>Protocolo {a.protocol}</span> : null}
                    {a.filedOn ? <span className="text-fg-muted">enviado em {shortDate(a.filedOn)}</span> : null}
                    {a.answeredOn ? <span className="text-fg-muted">respondido em {shortDate(a.answeredOn)}</span> : null}
                  </div>
                  <Actions>
                    {bill && a.status === 'draft' && !a.xmlFileId ? (
                      <ActionButton label="Gerar XML do recurso (TISS)" success="XML do recurso gerado e validado no XSD" action={exportAppealXmlAction.bind(null, { appealId: a.id })} />
                    ) : null}
                    {a.xmlFileId ? (
                      <a href={`/financeiro/convenios/arquivos/${a.xmlFileId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        Baixar XML do recurso
                      </a>
                    ) : null}
                  </Actions>
                  {bill && a.status === 'draft' ? <FileAppealForm appealId={a.id} version={a.version} action={fileAppealAction} /> : null}
                  {bill && a.status === 'filed' ? (
                    <AnswerAppealForm
                      appealId={a.id}
                      version={a.version}
                      glosses={g.glosses.filter((x) => a.glossIds.includes(x.id)).map((x) => ({ id: x.id, label: `código ${x.code} (${brl(x.amountCents)})`, amountCents: x.amountCents }))}
                      action={answerAppealAction}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-(--sp-4) mb-(--sp-2) text-(length:--fs-sm) font-semibold">Pagamentos recebidos</h3>
          {g.allocations.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhum pagamento alocado a esta guia.</p>
          ) : (
            <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              {g.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-(--sp-2)">
                  <Badge tone={a.kind === 'reversal' ? 'red' : 'green'}>{a.kind === 'reversal' ? 'Estorno' : 'Pagamento'}</Badge>
                  <span className="tabular-nums">{brl(a.amountCents)}</span>
                  <span className="text-fg-muted">pago em {shortDate(a.paidOn)}</span>
                  {a.reason ? <span className="text-fg-muted">— {a.reason}</span> : null}
                  {bill && a.kind === 'allocation' && !a.reversed ? (
                    <TextAction label="Estornar" success="Pagamento estornado (lançamento compensatório)" variant="ghost" action={reverseAllocationAction} base={{ allocationId: a.id }} field="reason" fieldLabel="Motivo do estorno" />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      ) : null}

      {showSubstitution && substitution ? (
        <PanelCard title="Cancelamento na operadora e substituição" regionLabel="Cancelamento na operadora e substituição" className="mt-(--sp-4)">
          {substitution.replaces ? (
            <p className="mb-(--sp-2) text-(length:--fs-sm)">
              Esta guia substitui a{' '}
              <Link href={`/convenios/guias/${substitution.replaces.id}`} className="underline">
                guia nº {substitution.replaces.number}
              </Link>
              . A aprovação só passa com o cancelamento da original confirmado pela operadora (Tabela 46 = 1).
            </p>
          ) : null}
          {substitution.cancellations.length === 0 && !substitution.replaces ? (
            <p className="mb-(--sp-2) text-(length:--fs-sm) text-fg-muted">
              Para substituir uma guia já enviada, peça o cancelamento à operadora e registre o recibo. O Qoro gera o XML
              do pedido, mas não o transmite.
            </p>
          ) : null}
          {substitution.cancellations.length > 0 ? (
            <ul className="mb-(--sp-3) flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              {substitution.cancellations.map((c) => (
                <li key={c.id} className="rounded-(--r-md) border border-border p-(--sp-2)">
                  <div className="flex flex-wrap items-center gap-(--sp-2)">
                    <Badge tone={c.status === 'confirmed' ? 'green' : c.status === 'awaiting_receipt' ? 'amber' : 'red'}>
                      {CANCELLATION_STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
                    <span>
                      pedido em {shortDate(c.requestedOn)} · {CANCELLATION_CHANNEL_LABELS[c.channel] ?? c.channel}
                    </span>
                  </div>
                  <p className="mt-(--sp-1) text-fg-muted">{c.reason}</p>
                  {c.receipts.length > 0 ? (
                    <ul className="mt-(--sp-1)">
                      {c.receipts.map((r, i) => (
                        <li key={`${c.id}-${i}`}>
                          Recibo de {shortDate(r.receivedOn)}: {TABLE_46_LABELS[r.statusCode] ?? r.statusCode}
                          {r.operatorProtocol ? ` · protocolo ${r.operatorProtocol}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {bill ? (
                    <div className="mt-(--sp-2) flex flex-wrap gap-(--sp-2)">
                      {c.hasXml ? <CancellationXmlButton cancellationId={c.id} /> : null}
                      {c.status === 'awaiting_receipt' ? <CancellationReceiptForm cancellationId={c.id} /> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {bill && AT_OPERATOR.includes(g.status) && !activeCancellation ? <CancellationRequestForm guideId={g.id} /> : null}
          {substitution.substitute ? (
            <p className="text-(length:--fs-sm)">
              Substituta:{' '}
              <Link href={`/convenios/guias/${substitution.substitute.id}`} className="underline">
                guia nº {substitution.substitute.number}
              </Link>{' '}
              <GuideStatusBadge status={substitution.substitute.status} />
            </p>
          ) : bill && !access.commercial && AT_OPERATOR.includes(g.status) && activeCancellation?.status === 'confirmed' ? (
            <CreateSubstituteButton originalGuideId={g.id} />
          ) : null}
        </PanelCard>
      ) : null}

      <PanelCard title="Histórico" regionLabel="Histórico da guia" className="mt-(--sp-4)">
        {g.events.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Sem eventos.</p>
        ) : (
          <ol className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
            {g.events.map((e, idx) => (
              <li key={`${e.createdAt}-${idx}`}>
                <span className="text-fg-muted">{shortDate(e.createdAt)} · </span>
                {guideEventLabel(e)}
                <span className="text-fg-muted"> · {e.actorName ?? (e.actorKind === 'system' ? 'Qoro (automático)' : 'usuário')}</span>
                {e.note ? <span> — {e.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </PanelCard>
    </>
  );
}
