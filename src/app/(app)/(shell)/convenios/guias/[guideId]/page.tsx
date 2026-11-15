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
  cancelGuideAction,
  createAppealAction,
  decideGlossAction,
  exportAppealXmlAction,
  fileAppealAction,
  reconcileGuideAction,
  returnGuideAction,
  reverseAllocationAction,
  reviewGuideAction,
} from '@/contexts/health-insurance/actions';
import { getGuideDetail, GUIDE_STATUS_LABELS, ISSUE_OWNER_LABELS } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../../_lib/access';
import { ActionButton, Actions, AnswerAppealForm, AppealForm, FileAppealForm, TextAction } from '../../_lib/action-ui';
import { GlossStatusBadge, GuideStatusBadge } from '../../_lib/status';
import { guideLabel } from '../../_lib/guide-label';

export const metadata: Metadata = { title: 'Guia de convênio' };

export const dynamic = 'force-dynamic';
/** Ações desta página validam XML no XSD oficial e/ou geram PDF (motor no próprio processo). */
export const maxDuration = 60;

const OPEN_GLOSS = ['informed', 'under_analysis', 'contested'];
const ISSUED = ['approved', 'in_batch', 'exported', 'sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed', 'replaced'];

export default async function GuiaPage({ params }: { params: Promise<{ guideId: string }> }) {
  const access = await conveniosAccess('Guia');
  if (!access.ok) return access.view;
  const { guideId } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(guideId)) notFound();
  const g = await getGuideDetail(access.clinicId, guideId);
  if (!g) notFound();
  const m = access.canManage;
  const ref = { guideId: g.id, version: g.version };
  const label = guideLabel(g.guideType, g.number);
  const openGlosses = g.glosses.filter((x) => OPEN_GLOSS.includes(x.status) && !g.appeals.some((a) => ['draft', 'filed'].includes(a.status) && a.glossIds.includes(x.id)));

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title={label}
        description={`${g.insurerName}${g.patientName ? ` · ${g.patientName}` : ''}`}
        crumbs={[{ label: 'Guias', href: '/convenios/guias' }, { label }]}
        actions={
          ISSUED.includes(g.status) ? (
            <a href={`/financeiro/convenios/guias/${g.id}/pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Ver PDF da guia
            </a>
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
            <div>
              <dt className="text-fg-muted">Valor</dt>
              <dd className="font-semibold tabular-nums">{brl(g.totalValueCents)}</dd>
            </div>
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
          {m ? (
            <div className="mt-(--sp-3)">
              <Actions>
                {g.status === 'ready_for_review' && g.issues.length === 0 ? (
                  <ActionButton label="Marcar como conferida" success="Guia conferida" variant="primary" action={reviewGuideAction.bind(null, ref)} />
                ) : null}
                {g.status === 'reviewed' ? (
                  <ActionButton label="Aprovar e emitir" success="Guia aprovada e emitida" variant="primary" action={approveGuideAction.bind(null, { guideId: g.id })} />
                ) : null}
                {['reviewed', 'approved'].includes(g.status) ? (
                  <TextAction label="Devolver para correção" success="Guia devolvida para correção" action={returnGuideAction} base={ref} field="note" fieldLabel="O que precisa ser corrigido" />
                ) : null}
                {['pending_data', 'ready_for_review', 'reviewed', 'approved'].includes(g.status) ? (
                  <TextAction label="Cancelar guia" success="Guia cancelada" variant="danger" action={cancelGuideAction} base={ref} field="note" fieldLabel="Motivo do cancelamento" hint="O cancelamento é final; o atendimento fica livre para uma guia nova." />
                ) : null}
                {g.account && g.account.pendingCents === 0 && g.status !== 'closed' && openGlosses.length === 0 ? (
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
                <TableHead className="text-right">Valor</TableHead>
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
                  <TableCell className="text-right tabular-nums">{brl(it.totalValueCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </PanelCard>

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
                  {m && OPEN_GLOSS.includes(x.status) ? (
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
          {m ? (
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
                    {m && a.status === 'draft' && !a.xmlFileId ? (
                      <ActionButton label="Gerar XML do recurso (TISS)" success="XML do recurso gerado e validado no XSD" action={exportAppealXmlAction.bind(null, { appealId: a.id })} />
                    ) : null}
                    {a.xmlFileId ? (
                      <a href={`/financeiro/convenios/arquivos/${a.xmlFileId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        Baixar XML do recurso
                      </a>
                    ) : null}
                  </Actions>
                  {m && a.status === 'draft' ? <FileAppealForm appealId={a.id} version={a.version} action={fileAppealAction} /> : null}
                  {m && a.status === 'filed' ? (
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
                  {m && a.kind === 'allocation' && !a.reversed ? (
                    <TextAction label="Estornar" success="Pagamento estornado (lançamento compensatório)" variant="ghost" action={reverseAllocationAction} base={{ allocationId: a.id }} field="reason" fieldLabel="Motivo do estorno" />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
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
                {e.fromStatus ? `${GUIDE_STATUS_LABELS[e.fromStatus] ?? e.fromStatus} → ` : ''}
                {e.toStatus ? GUIDE_STATUS_LABELS[e.toStatus] ?? e.toStatus : 'alteração'}
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
