import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { importStatementAction } from '@/contexts/health-insurance/actions';
import { listInsurerPayments, listInsurers, listOpenGuidesForAllocation } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { AllocateForm, StatementImportForm } from '../_lib/batch-ui';

export const dynamic = 'force-dynamic';

export default async function ConciliacaoPage() {
  const access = await conveniosAccess('Conciliação');
  if (!access.ok) return access.view;
  const [payments, guides, insurers] = await Promise.all([
    listInsurerPayments(access.clinicId),
    access.canManage ? listOpenGuidesForAllocation(access.clinicId) : Promise.resolve([]),
    access.canManage ? listInsurers(access.clinicId) : Promise.resolve([]),
  ]);
  const pending = payments.filter((p) => p.unreconciledCents > 0);

  return (
    <>
      <ConveniosHeader
        title="Conciliação"
        description="Dinheiro recebido das operadoras e a guia de cada parte. Só entra no financeiro da clínica o que estiver alocado a uma guia."
        crumbs={[{ label: 'Conciliação' }]}
      />
      {access.canManage ? (
        <PanelCard title="Importar demonstrativo da operadora" regionLabel="Importar demonstrativo" className="mb-(--sp-4)">
          <StatementImportForm insurers={insurers} action={importStatementAction} />
        </PanelCard>
      ) : null}
      <PanelCard title="Recebido sem conciliar" regionLabel="Pagamentos sem conciliar">
        {pending.length === 0 ? (
          <EmptyState variant="compact" title="Nada para conciliar" description="Todo pagamento registrado está alocado às guias." />
        ) : (
          <ul className="flex flex-col gap-(--sp-3)">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3) text-(length:--fs-sm)">
                <div className="flex flex-wrap gap-(--sp-2)">
                  <span className="font-semibold">{p.insurerName}</span>
                  <span>pago em {shortDate(p.paidOn)}</span>
                  <span className="tabular-nums">{brl(p.amountCents)}</span>
                  <span className="tabular-nums text-warning-700">{brl(p.unreconciledCents)} sem guia</span>
                  {p.statementRef ? <span className="text-fg-muted">demonstrativo {p.statementRef}</span> : null}
                  {p.batchNumber ? <span className="text-fg-muted">lote {p.batchNumber}</span> : null}
                </div>
                {access.canManage ? (
                  <AllocateForm paymentId={p.id} unreconciledCents={p.unreconciledCents} guides={guides.filter((g) => g.insurerId === p.insurerId)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
      <PanelCard title="Todos os pagamentos" regionLabel="Todos os pagamentos" className="mt-(--sp-4)">
        {payments.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhum pagamento de operadora registrado.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-(length:--fs-sm)">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-(--sp-2) py-2">
                <span>{shortDate(p.paidOn)}</span>
                <span className="font-medium">{p.insurerName}</span>
                <span className="tabular-nums">{brl(p.amountCents)}</span>
                <span className="text-fg-muted">alocado {brl(p.allocatedCents)}</span>
                {p.batchNumber ? (
                  <Link href={`/convenios/lotes?status=`} className="text-fg-muted hover:underline">
                    lote {p.batchNumber}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </>
  );
}
