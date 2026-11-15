import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import {
  cancelBatchAction,
  exportBatchAction,
  markBatchSentAction,
  markBatchUnderReviewAction,
} from '@/contexts/health-insurance/actions';
import { getBatchExportJob } from '@/contexts/health-insurance/config-queries';
import { getBatchDetail } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../../_lib/access';
import { ActionButton, Actions, TextAction } from '../../_lib/action-ui';
import { requestBatchExportAction } from '../../_lib/batch-export-actions';
import { GlossForm, PaymentForm, ProtocolForm } from '../../_lib/batch-ui';
import { BatchStatusBadge, GuideStatusBadge } from '../../_lib/status';

export const metadata: Metadata = { title: 'Lote de guias' };

export const dynamic = 'force-dynamic';
/** Ações desta página validam XML no XSD oficial e/ou geram PDF (motor no próprio processo). */
export const maxDuration = 60;

/** Estado do XML pedido em segundo plano (R45); o motivo vem por código, nunca o erro técnico. */
const EXPORT_JOB: Record<string, string> = {
  pending: 'na fila',
  processing: 'gerando',
  processed: 'concluído',
  failed: 'falhou',
};
const EXPORT_ERROR: Record<string, string> = {
  access_permission_revoked: 'quem pediu não tem mais permissão para o faturamento',
  premium_denied: 'assinatura inativa',
  export_structure: 'pendência na estrutura do padrão TISS',
  export_terminology: 'código fora da terminologia TISS vigente',
  export_xsd: 'o XML não passou no XSD oficial',
  export_hash: 'o hash do arquivo não confere',
  export_encoding: 'caractere fora da codificação do padrão',
  export_content: 'o conteúdo das guias mudou; monte o lote de novo',
  export_state: 'o lote mudou de etapa',
  export_integrity: 'conteúdo emitido não confere com o registrado',
  export_internal: 'cadastro da operadora incompleto',
  integrity: 'conteúdo emitido não confere com o registrado',
};

const RETURN_LABELS: Record<string, string> = {
  protocol_receipt: 'Recibo do protocolo',
  analysis_statement: 'Demonstrativo de análise',
  payment_statement: 'Demonstrativo de pagamento',
  administrative_conference: 'Conferência administrativa',
};

export default async function LotePage({ params }: { params: Promise<{ batchId: string }> }) {
  const access = await conveniosAccess('Lote');
  if (!access.ok) return access.view;
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(batchId)) notFound();
  const b = await getBatchDetail(access.clinicId, batchId);
  const job = b && b.status === 'prepared' ? await getBatchExportJob(access.clinicId, b.id, b.version) : null;
  if (!b) notFound();
  const m = access.canManage;
  const ref = { batchId: b.id, version: b.version };
  const atOperator = ['sent', 'received', 'under_review', 'processed'].includes(b.status);
  const guideOptions = b.guides.map((g) => ({ id: g.id, number: g.number, pendingCents: g.pendingCents, guideType: b.guideType }));
  const xsd = (b.validation?.xsd as string | undefined) ?? null;

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title={`Lote ${b.number}`}
        description={`${b.insurerName} · ${b.guideCount} guia(s) · ${brl(b.totalValueCents)}`}
        crumbs={[{ label: 'Lotes', href: '/convenios/lotes' }, { label: b.number }]}
        actions={
          b.fileId ? (
            <a href={`/financeiro/convenios/arquivos/${b.fileId}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Baixar XML
            </a>
          ) : null
        }
      />

      <PanelCard title="Situação" regionLabel="Situação do lote">
        <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-4">
          <div><dt className="text-fg-muted">Etapa</dt><dd><BatchStatusBadge status={b.status} /></dd></div>
          <div><dt className="text-fg-muted">XML</dt><dd data-testid="batch-export-job" data-job={job?.status ?? 'none'}>{job && !b.fileId ? (EXPORT_JOB[job.status] ?? job.status) + (job.errorCode ? ' — ' + (EXPORT_ERROR[job.errorCode] ?? job.errorCode) : '') + ' · ' : null}{b.fileId ? `validado no XSD oficial${xsd ? ` (${xsd})` : ''}` : 'ainda não gerado'}</dd></div>
          <div><dt className="text-fg-muted">Envio</dt><dd>{b.sentOn ? `${shortDate(b.sentOn)}${b.sendEvidence ? ` — ${b.sendEvidence}` : ''}` : '—'}</dd></div>
          <div><dt className="text-fg-muted">Protocolo</dt><dd>{b.protocolNumber ? `${b.protocolNumber} (${shortDate(b.receivedOn)})` : '—'}</dd></div>
        </dl>
        {b.cancelReason ? <p className="mt-(--sp-2) text-(length:--fs-sm)">Cancelado: {b.cancelReason}</p> : null}
        {b.status === 'sent' ? (
          <Alert variant="info" className="mt-(--sp-3)">
            Enviar não é receber: o valor fica a receber da operadora até o pagamento ou a glosa.
          </Alert>
        ) : null}
        {m ? (
          <div className="mt-(--sp-3)">
            <Actions>
              {b.status === 'prepared' ? (
                <ActionButton label="Gerar e validar XML" success="XML gerado e validado" variant="primary" action={exportBatchAction.bind(null, { batchId: b.id })} />
              ) : null}
              {b.status === 'prepared' && (!job || job.status === 'failed') ? (
                <ActionButton label="Gerar XML em segundo plano" success="XML do lote na fila" action={requestBatchExportAction.bind(null, { batchId: b.id, version: b.version })} />
              ) : null}
              {b.status === 'exported' ? (
                <TextAction
                  label="Marcar como enviado"
                  success="Envio registrado"
                  variant="primary"
                  action={markBatchSentAction}
                  base={ref}
                  field="evidence"
                  fieldLabel="Como o lote foi enviado"
                  hint="Ex.: upload no portal da operadora em 12/11 às 14h, número do envio no portal."
                  extra={{ field: 'sentOn', label: 'Data do envio', type: 'date' }}
                />
              ) : null}
              {b.status === 'sent' ? <ProtocolForm batchId={b.id} version={b.version} /> : null}
              {b.status === 'received' ? (
                <ActionButton label="Operadora iniciou a análise" success="Lote em análise" action={markBatchUnderReviewAction.bind(null, ref)} />
              ) : null}
              {['prepared', 'exported'].includes(b.status) ? (
                <TextAction label="Cancelar lote" success="Lote cancelado" variant="danger" action={cancelBatchAction} base={ref} field="reason" fieldLabel="Motivo do cancelamento" hint="As guias voltam a ficar aprovadas, prontas para outro lote." />
              ) : null}
              {atOperator ? <PaymentForm insurerId={b.insurerId} batchId={b.id} guides={guideOptions} /> : null}
              {atOperator ? <GlossForm batchId={b.id} guides={guideOptions} /> : null}
            </Actions>
          </div>
        ) : null}
      </PanelCard>

      <PanelCard title="Guias do lote" regionLabel="Guias do lote" className="mt-(--sp-4)">
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guia</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Glosa aberta</TableHead>
                <TableHead className="text-right">Glosa definitiva</TableHead>
                <TableHead className="text-right">A receber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.guides.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link href={`/convenios/guias/${g.id}`} className="hover:underline">
                      {g.number}
                    </Link>
                  </TableCell>
                  <TableCell>{g.patientName ?? '—'}</TableCell>
                  <TableCell><GuideStatusBadge status={g.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{brl(g.totalValueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(g.paidCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(g.glossOpenCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(g.glossDefinitiveCents)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{brl(g.pendingCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </PanelCard>

      <div className="mt-(--sp-4) grid gap-(--sp-4) lg:grid-cols-2">
        <PanelCard title="Pagamentos da operadora" regionLabel="Pagamentos do lote">
          {b.payments.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhum pagamento registrado.</p>
          ) : (
            <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              {b.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-(--sp-2)">
                  <span className="tabular-nums font-semibold">{brl(p.amountCents)}</span>
                  <span className="text-fg-muted">em {shortDate(p.paidOn)}</span>
                  {p.statementRef ? <span>demonstrativo {p.statementRef}</span> : null}
                  {p.unreconciledCents > 0 ? (
                    <Link href="/convenios/conciliacao" className="text-warning-700 hover:underline">
                      {brl(p.unreconciledCents)} sem conciliar
                    </Link>
                  ) : (
                    <span className="text-success-700">conciliado</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
        <PanelCard title="Retornos da operadora" regionLabel="Retornos do lote">
          {b.returns.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhum retorno registrado.</p>
          ) : (
            <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
              {b.returns.map((r) => (
                <li key={r.id}>
                  {RETURN_LABELS[r.kind] ?? r.kind} · recebido em {shortDate(r.receivedOn)}
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </>
  );
}
