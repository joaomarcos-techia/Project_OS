import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { importStatementAction, requestCopayChargeAction, syncCopayChargeAction } from '@/contexts/health-insurance/actions';
import { listCopaysToReview } from '@/contexts/health-insurance/config-queries';
import { listCopayCharges, listInsurerPayments, listInsurers, listOpenGuidesForAllocation } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { ActionButton } from '../_lib/action-ui';
import { AllocateForm, StatementImportForm } from '../_lib/batch-ui';
import { CopayReview } from '../_lib/copay-ui';

export const metadata: Metadata = { title: 'Conciliação de convênios' };

export const dynamic = 'force-dynamic';

export default async function ConciliacaoPage() {
  const access = await conveniosAccess('Conciliação', 'broad');
  if (!access.ok) return access.view;
  const [payments, guides, insurers, copays, toReview] = await Promise.all([
    // Pagamentos da operadora são faturamento (matriz 4.3): sem visão de valores, nem a consulta roda.
    access.rights.seeValues ? listInsurerPayments(access.clinicId) : Promise.resolve([]),
    access.rights.bill ? listOpenGuidesForAllocation(access.clinicId) : Promise.resolve([]),
    access.rights.bill ? listInsurers(access.clinicId) : Promise.resolve([]),
    listCopayCharges(access.clinicId),
    listCopaysToReview(access.clinicId),
  ]);
  const pending = payments.filter((p) => p.unreconciledCents > 0);

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title="Conciliação"
        description="Dinheiro recebido das operadoras e a guia de cada parte. Só entra no financeiro da clínica o que estiver alocado a uma guia."
        crumbs={[{ label: 'Conciliação' }]}
      />
      {access.rights.bill ? (
        <PanelCard title="Importar demonstrativo da operadora" regionLabel="Importar demonstrativo" className="mb-(--sp-4)">
          <StatementImportForm insurers={insurers} action={importStatementAction} />
        </PanelCard>
      ) : null}
      {access.rights.seeValues ? (
      <>
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
                {access.rights.bill ? (
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
      ) : null}

      <PanelCard title="Coparticipações a conferir" regionLabel="Coparticipações a conferir" className="mt-(--sp-4)">
        <p className="mb-(--sp-2) text-(length:--fs-sm) text-fg-muted">
          Calculadas na conclusão do atendimento pelo contrato. Nada é cobrado antes de conferir e confirmar; o paciente paga só a coparticipação, nunca o valor da consulta.
        </p>
        {toReview.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma coparticipação aguardando conferência.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-(length:--fs-sm)">
            {toReview.map((c) => (
              <li key={c.id} className="flex flex-col gap-(--sp-2) py-(--sp-2)">
                <div className="flex flex-wrap gap-(--sp-2)">
                  <span className="font-medium">{c.patientName ?? 'Paciente'}</span>
                  <span className="text-fg-muted">{shortDate(c.scheduledAt)} · {c.procedureName ?? ''}</span>
                  <span className="tabular-nums">previsto {brl(c.expectedCents)}</span>
                  {c.calculatedCents !== null ? <span className="tabular-nums">calculado {brl(c.calculatedCents)}</span> : null}
                  {c.checkedCents !== null ? <span className="tabular-nums">conferido {brl(c.checkedCents)}</span> : null}
                </div>
                <CopayReview copay={c} canCheck={access.rights.operate} canConfirm={access.rights.patientCharge} />
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard title="Coparticipações do paciente" regionLabel="Coparticipações" className="mt-(--sp-4)">
        <p className="mb-(--sp-2) text-(length:--fs-sm) text-fg-muted">
          Só a coparticipação confirmada é cobrada do paciente, nunca o valor do atendimento. Sem conta Asaas ativa, receba no Caixa.
        </p>
        {copays.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma coparticipação confirmada.</p>
        ) : (
          <ul className="flex flex-col gap-(--sp-2) text-(length:--fs-sm)">
            {copays.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-(--sp-2)">
                <span>{c.patientName}</span>
                <span className="text-fg-muted">{shortDate(c.scheduledAt)}</span>
                <span className="tabular-nums">{brl(c.chargeableCents)}</span>
                <span>{{"confirmed":"confirmada, a cobrar","charged":"cobrança enviada","paid":"paga","refunded":"estornada"}[c.status as 'confirmed'] ?? c.status}</span>
                {access.rights.patientCharge && c.status === 'confirmed' ? (
                  <ActionButton describe label="Gerar link de cobrança" success="Pedido de cobrança processado" action={requestCopayChargeAction.bind(null, { copaymentId: c.id })} />
                ) : null}
                {access.rights.patientCharge && c.status === 'charged' ? (
                  <ActionButton describe label="Atualizar situação" success="Situação atualizada" variant="ghost" action={syncCopayChargeAction.bind(null, { copaymentId: c.id })} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </>
  );
}
