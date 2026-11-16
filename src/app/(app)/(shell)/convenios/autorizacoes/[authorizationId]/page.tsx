import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { getAuthorization } from '@/contexts/health-insurance/queries';

import { ConveniosHeader, conveniosAccess, shortDate } from '../../_lib/access';
import { ConsultaAuthorizationResponseForm } from '../../_lib/authorization-ui';
import { AUTHORIZATION_STATUS, AuthorizationStatusBadge } from '../../_lib/status';

export const metadata: Metadata = { title: 'Autorização da operadora' };

export const dynamic = 'force-dynamic';

const WAITING = ['requested', 'pending_operator'];
const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const stateLabel = (s: string | null) => (s ? (AUTHORIZATION_STATUS[s]?.label ?? s) : '—');

/** P6.3 — uma autorização: itens e saldo, resposta da operadora, comprovantes e histórico. */
export default async function AutorizacaoPage({ params }: { params: Promise<{ authorizationId: string }> }) {
  const access = await conveniosAccess('Autorização da operadora');
  if (!access.ok) return access.view;
  const { authorizationId } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(authorizationId)) notFound();
  const detail = await getAuthorization(access.clinicId, authorizationId);
  if (!detail) notFound();
  const { row: r, events, receipts } = detail;
  const waiting = WAITING.includes(r.status);
  const canRespond = waiting && r.guideType === 'consulta' && access.canManage && !access.commercial;
  const title = `Autorização · ${r.guideType === 'sp_sadt' ? 'SP/SADT' : 'Consulta'}`;

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title={title}
        description={`${r.patientName || 'Paciente'} · ${r.insurerName}${r.requestedOn ? ` · pedida em ${shortDate(r.requestedOn)}` : ''}`}
        crumbs={[{ label: 'Autorizações', href: '/convenios/autorizacoes' }, { label: title }]}
      />

      <PanelCard title="Situação" regionLabel="Situação da autorização" className="mb-(--sp-4)">
        <dl className="grid grid-cols-2 gap-(--sp-2) text-(length:--fs-sm) md:grid-cols-4">
          <div>
            <dt className="text-fg-muted">Situação</dt>
            <dd>
              <AuthorizationStatusBadge status={r.shownState} />
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Respondida em</dt>
            <dd>{shortDate(r.authorizedOn)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Número na operadora</dt>
            <dd>{r.operatorGuideNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Protocolo</dt>
            <dd>{r.operatorProtocol ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Senha</dt>
            <dd>{r.hasPassword ? 'registrada (guardada cifrada)' : '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Validade da senha</dt>
            <dd>{r.passwordValidUntil ? shortDate(r.passwordValidUntil) : '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Saldo</dt>
            <dd className="tabular-nums">
              {r.remaining} de {r.authorizedTotal}
            </dd>
          </div>
          {r.denialReason ? (
            <div className="col-span-2">
              <dt className="text-fg-muted">Motivo da negativa</dt>
              <dd>{r.denialReason}</dd>
            </div>
          ) : null}
        </dl>
        {waiting && r.guideType === 'sp_sadt' && r.sadtRequestId ? (
          <Alert variant="info" className="mt-(--sp-3)">
            A resposta da SP/SADT é registrada na{' '}
            <Link href={`/convenios/solicitacoes/${r.sadtRequestId}`} className="underline">
              solicitação {r.sadtRequestNumber ?? ''}
            </Link>
            , para a solicitação e a autorização não divergirem.
          </Alert>
        ) : null}
        {canRespond ? (
          <div className="mt-(--sp-3)">
            <ConsultaAuthorizationResponseForm
              authorizationId={r.id}
              version={r.version}
              requestedOn={r.requestedOn}
              items={r.items.map((i) => ({ id: i.id, label: `${i.tableCode} · ${i.procedureCode}`, requested: i.quantityRequested }))}
            />
          </div>
        ) : null}
      </PanelCard>

      <PanelCard title="Procedimentos" regionLabel="Procedimentos da autorização" className="mb-(--sp-4)">
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Procedimento</TableHead>
                <TableHead className="text-right">Pedido</TableHead>
                <TableHead className="text-right">Autorizado</TableHead>
                <TableHead className="text-right">Usado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.tableCode} · {i.procedureCode}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantityRequested}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantityAuthorized}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantityConsumed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </PanelCard>

      <PanelCard title="Comprovantes da operadora" regionLabel="Comprovantes da autorização" className="mb-(--sp-4)">
        {receipts.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhum comprovante anexado.</p>
        ) : (
          <ul className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
            {receipts.map((x) => (
              <li key={x.id}>
                {x.mediaType === 'application/pdf' ? 'PDF' : 'Imagem'} · {size(x.sizeBytes)} · enviado em {dateTime(x.createdAt)}
                {x.uploadedByName ? ` por ${x.uploadedByName}` : ''}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard title="Histórico" regionLabel="Histórico da autorização">
        <ol className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)">
          {events.map((e, i) => (
            <li key={`${e.toStatus}-${i}`}>
              {dateTime(e.createdAt)} · {e.fromStatus ? `${stateLabel(e.fromStatus)} → ` : ''}
              {stateLabel(e.toStatus)}
              {e.actorName ? ` · ${e.actorName}` : e.fromStatus ? ' · rotina do sistema' : ''}
              {e.note ? ` · ${e.note}` : ''}
            </li>
          ))}
        </ol>
      </PanelCard>
    </>
  );
}
