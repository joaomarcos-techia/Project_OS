import { listPatientCards } from '@/contexts/patient/queries';
import { paymentsApiV1 } from '@/contexts/payments';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import {
  getCaixaLancamentos,
  getCaixaPagaveis,
  listOpenCollectionCases,
  listPaymentTransactionsForLancamentos,
  listPaymentMethods,
  listPendenciasAbertas,
} from '@/contexts/financial/queries';
import type {
  CaixaItem,
  LancamentoSummary,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { withQueryDeadline } from '@/lib/db/query-timeout';

import { CaixaView } from './caixa-view';

// Claims do usuário e o estado do caixa mudam por requisição.
export const dynamic = 'force-dynamic';

export default async function CaixaPage() {
  const user = await requireUser();
  await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL) || !user.clinicId) {
    return (
      <>
        <PageHeader title="Caixa" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para o caixa.
        </Alert>
      </>
    );
  }

  const clinicId = user.clinicId;
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);

  // Fan-out do caixa. `withQueryDeadline` (modo FALHA ALTO): financeiro nunca mostra
  // vazio-por-timeout como se fosse a verdade — se estolar, cai no error boundary do
  // shell ("tente de novo"), nunca pendura. Conserto estrutural: pool runtime max:6.
  const [lancs, pagaveis, pendencias, methods, collectionCases] = await withQueryDeadline(
    'caixa.load',
    Promise.all([
      getCaixaLancamentos(clinicId, from, to),
      getCaixaPagaveis(clinicId),
      listPendenciasAbertas(clinicId),
      listPaymentMethods(clinicId),
      listOpenCollectionCases(clinicId),
    ]),
  );
  const excessRefundStatuses = await withQueryDeadline(
    'caixa.excessRefundStatuses',
    paymentsApiV1.listExcessRefundStatuses(
      clinicId,
      pendencias.map((item) => item.appointmentId),
    ),
  );

  // Caixa patient-first: resolve nomes via contexto patient (camada page — sem
  // JOIN cross-context; igual ao consultório).
  const all = [...lancs.pendentes, ...lancs.parciais, ...lancs.pagosHoje, ...pagaveis];
  const paymentTransactions: PaymentTransactionSummary[] = await withQueryDeadline(
    'caixa.paymentTransactions',
    listPaymentTransactionsForLancamentos(
      clinicId,
      all.map((l) => l.id),
    ),
  );
  const patientIds = [...new Set(all.filter((l) => l.patientId).map((l) => l.patientId!))];
  const cards = await withQueryDeadline(
    'caixa.patientCards',
    listPatientCards(clinicId, patientIds),
  );
  const nameById = new Map(cards.map((c) => [c.id, c.nome]));
  const enrich = (l: LancamentoSummary): CaixaItem => ({
    ...l,
    pacienteNome: l.patientId ? (nameById.get(l.patientId) ?? null) : null,
  });

  const canOperate =
    user.permissions.includes(PERMISSIONS.OPERATE_CAIXA) ||
    user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const canRefund = user.permissions.includes(PERMISSIONS.REFUND_FINANCIAL);

  return (
    <CaixaView
      pendentes={lancs.pendentes.map(enrich)}
      parciais={lancs.parciais.map(enrich)}
      pagosHoje={lancs.pagosHoje.map(enrich)}
      aPagar={pagaveis.map(enrich)}
      pendencias={pendencias}
      excessRefundStatuses={excessRefundStatuses}
      collectionCases={collectionCases}
      methods={methods}
      paymentTransactions={paymentTransactions}
      canOperate={canOperate}
      canRefund={canRefund}
    />
  );
}
