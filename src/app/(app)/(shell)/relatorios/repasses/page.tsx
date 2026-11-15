import type { Metadata } from 'next';
import Link from 'next/link';

import { billingApiV1 } from '@/contexts/billing/api';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { listMonthlyPayoutSnapshots } from '@/contexts/financial/payout-queries';
import { listCompletedAppointmentsForMonth } from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePageUser } from '@/lib/auth/page-guard';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { withQueryDeadline } from '@/lib/db/query-timeout';
import { formatBRL } from '@/lib/format';

import { adjacentMonth, buildMonthlyPayoutReport, resolveReportMonth } from './report';

export const metadata: Metadata = { title: 'Repasses por mês' };

export const dynamic = 'force-dynamic';

export default async function RepassesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const user = await requirePageUser();
  const clinicId = await requireClinicId();
  const canManagePayouts = user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const ownOnly = !canManagePayouts && (await getCurrentPractitioner());
  if (!canManagePayouts && !ownOnly) {
    return (
      <>
        <PageHeader title="Repasses por mês" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem acesso a este relatório.
        </Alert>
      </>
    );
  }

  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) {
    return (
      <>
        <PageHeader title="Repasses por mês" />
        <Alert variant="warning" title="Disponível no plano Clínica">
          O relatório de repasses faz parte do plano Clínica. O Consultório mantém seus relatórios
          gerais e o financeiro, sem repasses por médico.
        </Alert>
      </>
    );
  }

  const timezone = await withQueryDeadline('payout-report.timezone', getClinicTimezone(clinicId));
  const month = resolveReportMonth((await searchParams).mes, timezone);
  const completed = await withQueryDeadline(
    'payout-report.completions',
    listCompletedAppointmentsForMonth(clinicId, month, timezone),
  );
  const payouts = await withQueryDeadline(
    'payout-report.payouts',
    listMonthlyPayoutSnapshots(
      clinicId,
      completed.map((item) => item.appointmentId),
      ownOnly ? user.userId : undefined,
    ),
  );
  const report = buildMonthlyPayoutReport(completed, payouts);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: timezone }).format(
      new Date(value),
    );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Relatórios', href: '/relatorios' }]}
        title="Repasses por mês"
        description={
          ownOnly ? 'Seus atendimentos concluídos' : 'Atendimentos concluídos da clínica'
        }
      />
      <nav aria-label="Mês de competência" className="mb-6 flex items-center gap-4">
        <Link href={`/relatorios/repasses?mes=${adjacentMonth(month, -1)}`}>Mês anterior</Link>
        <strong className="font-mono tabular-nums">{month}</strong>
        <Link href={`/relatorios/repasses?mes=${adjacentMonth(month, 1)}`}>Próximo mês</Link>
      </nav>
      <p className="mb-4 text-sm text-fg-muted">
        A competência é o mês em que a consulta foi concluída no fuso {timezone}. Os valores são
        cálculos de repasse, não comprovantes de transferência ao profissional.
      </p>
      <div className="mb-5 flex flex-wrap gap-4" aria-label="Resumo dos repasses">
        <span>Consultas com regra: {report.lines.length}</span>
        <span>Valor bruto: {formatBRL(report.grossTotal)}</span>
        <span>Repasse calculado/revisado: {formatBRL(report.effectiveTotal)}</span>
        <span>Suspensos: {report.suspendedCount}</span>
        <span>Aguardando dados: {report.pendingCount}</span>
      </div>
      {report.lines.length === 0 ? (
        <p>Nenhum repasse com consulta concluída neste mês.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conclusão</TableHead>
              {!ownOnly ? <TableHead>Profissional</TableHead> : null}
              <TableHead>Valor bruto</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Repasse</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.lines.map((line) => (
              <TableRow key={line.appointmentId}>
                <TableCell>{formatDate(line.completedAt)}</TableCell>
                {!ownOnly ? <TableCell>{line.professionalName}</TableCell> : null}
                <TableCell>{formatBRL(line.grossAmount)}</TableCell>
                <TableCell>{line.calculationBasis === 'gross' ? 'Bruta' : 'Líquida'}</TableCell>
                <TableCell>
                  {line.effectivePayout === null
                    ? 'Aguardando dados'
                    : formatBRL(line.effectivePayout)}
                </TableCell>
                <TableCell>
                  {line.status === 'cancelled'
                    ? `Suspenso${line.reviewVersion ? ` · revisão anterior v${line.reviewVersion}` : ''}`
                    : line.status === 'reviewed'
                      ? `Revisado · versão ${line.reviewVersion ?? '—'}`
                      : line.status === 'pending_economics'
                        ? 'Aguardando conciliação'
                        : 'Calculado'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
