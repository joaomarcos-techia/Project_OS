import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PanelCard } from '@/components/ui/panel-card';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { getInsuranceOverview, ISSUE_OWNER_LABELS } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess } from './_lib/access';

export const dynamic = 'force-dynamic';

/**
 * Painel de Convênios: o gestor vê faturado, recebido, glosado e a receber por operadora;
 * a recepção vê, por responsável, o que falta para faturar.
 */
export default async function ConveniosPage() {
  const access = await conveniosAccess('Convênios');
  if (!access.ok) return access.view;
  const o = await getInsuranceOverview(access.clinicId);
  const s = o.guidesByStatus;
  const pendingByOwner = new Map<string, number>();
  for (const [owner, n] of [...Object.entries(o.guideIssuesByOwner), ...Object.entries(o.openGapsByOwner)]) {
    pendingByOwner.set(owner, (pendingByOwner.get(owner) ?? 0) + n);
  }
  const steps = [
    { label: 'Guias com pendência de dado', n: (s.pending_data ?? 0), href: '/financeiro/convenios/guias?status=pending_data' },
    { label: 'Guias para conferir', n: s.ready_for_review ?? 0, href: '/financeiro/convenios/guias?status=ready_for_review' },
    { label: 'Conferidas, aguardando aprovação', n: s.reviewed ?? 0, href: '/financeiro/convenios/guias?status=conferidas' },
    { label: 'Aprovadas, prontas para lote', n: s.approved ?? 0, href: '/financeiro/convenios/lotes' },
    { label: 'Em lote, aguardando envio', n: (s.in_batch ?? 0) + (s.exported ?? 0), href: '/financeiro/convenios/lotes?status=exported' },
    { label: 'Na operadora (enviadas ou em análise)', n: (s.sent ?? 0) + (s.under_review ?? 0), href: '/financeiro/convenios/guias?status=faturadas' },
    { label: 'Com glosa ou pagamento parcial', n: (s.partially_glossed ?? 0) + (s.fully_glossed ?? 0) + (s.partially_paid ?? 0), href: '/financeiro/convenios/guias?status=desfecho' },
  ];

  return (
    <>
      <ConveniosHeader title="Convênios" description="Faturamento TISS: do atendimento ao recebimento da operadora." />
      {!o.enabled ? (
        <Alert variant="info" title="Convênios não está habilitado nesta clínica" className="mb-(--sp-4)">
          A habilitação é controlada pelo Qoro durante a liberação do módulo. Os registros já existentes continuam disponíveis
          para consulta.
        </Alert>
      ) : null}
      {o.ledgerDrift > 0 ? (
        <Alert variant="danger" title="O financeiro não bate com a conta das guias" className="mb-(--sp-4)">
          {o.ledgerDrift} guia(s) com diferença entre a conta do convênio e o livro financeiro. Nada foi alterado
          automaticamente; o suporte do Qoro foi avisado pela conferência.
        </Alert>
      ) : null}

      <MetricStrip className="mb-(--sp-4)">
        <StatCard label="Faturado" value={brl(o.totals.billedCents)} hint={`${o.totals.guides} guias enviadas`} />
        <StatCard label="Recebido" value={brl(o.totals.paidCents)} />
        <StatCard label="Glosa em aberto" value={brl(o.totals.glossOpenCents)} hint="Ainda pode ser revertida" />
        <StatCard label="Glosa definitiva" value={brl(o.totals.glossDefinitiveCents)} />
        <StatCard label="A receber" value={brl(o.totals.pendingCents)} />
        <StatCard label="Recebido sem conciliar" value={brl(o.totals.unreconciledCents)} hint="Alocar às guias em Conciliação" />
      </MetricStrip>

      <div className="grid gap-(--sp-4) lg:grid-cols-2">
        <PanelCard title="O que falta para faturar" regionLabel="O que falta para faturar">
          <ul className="flex flex-col divide-y divide-border">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center justify-between py-2 text-(length:--fs-sm)">
                <Link href={step.href} className="text-fg hover:underline">
                  {step.label}
                </Link>
                <span className="font-semibold tabular-nums">{step.n}</span>
              </li>
            ))}
          </ul>
        </PanelCard>
        <PanelCard title="Pendências por responsável" regionLabel="Pendências por responsável">
          {pendingByOwner.size === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma pendência aberta.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {[...pendingByOwner.entries()].map(([owner, n]) => (
                <li key={owner} className="flex items-center justify-between py-2 text-(length:--fs-sm)">
                  <Link href={`/financeiro/convenios/guias?owner=${owner}`} className="text-fg hover:underline">
                    {ISSUE_OWNER_LABELS[owner] ?? owner}
                  </Link>
                  <span className="font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>

      <PanelCard title="Por operadora" regionLabel="Valores por operadora" className="mt-(--sp-4)">
        {o.insurers.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma guia enviada a operadoras ainda.</p>
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operadora</TableHead>
                  <TableHead className="text-right">Guias</TableHead>
                  <TableHead className="text-right">Faturado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Glosa em aberto</TableHead>
                  <TableHead className="text-right">Glosa definitiva</TableHead>
                  <TableHead className="text-right">A receber</TableHead>
                  <TableHead className="text-right">Sem conciliar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.insurers.map((i) => (
                  <TableRow key={i.insurerId}>
                    <TableCell>
                      <Link href={`/financeiro/convenios/guias?insurerId=${i.insurerId}`} className="hover:underline">
                        {i.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.guides}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(i.billedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(i.paidCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(i.glossOpenCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(i.glossDefinitiveCents)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{brl(i.pendingCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(i.unreconciledCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </PanelCard>
    </>
  );
}
