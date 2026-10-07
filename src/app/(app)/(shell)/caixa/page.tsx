import { listPatientCards } from '@/contexts/patient/queries';
import { billingApiV1 } from '@/contexts/billing/api';
import { paymentsApiV1 } from '@/contexts/payments';
import { listAppointmentCommercialPaymentMethods } from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import {
  getCaixaLancamentos,
  getCaixaPagaveis,
  listAppointmentFinancialEconomics,
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
  // TRÊS RODADAS, não cinco. Cada consulta é um `withTenant` próprio — um round
  // trip completo — então esperar o fuso para só então disparar o que não
  // depende dele custava uma ida inteira à toa. Medido no Preview: esta rota
  // streamava o documento por ~2,8 s com TTFB de 70 ms; o tempo estava aqui.
  //
  // `withQueryDeadline` (modo FALHA ALTO): financeiro nunca mostra
  // vazio-por-timeout como se fosse a verdade — se estolar, cai no error
  // boundary do shell ("tente de novo"), nunca pendura. Conserto estrutural:
  // pool runtime max:6.
  //
  // Rodada 1: tudo que não depende de nada — inclusive o fuso e as cobranças
  // falhas, que antes esperavam sem precisar.
  const [
    tz,
    pagaveis,
    pendencias,
    methods,
    collectionCases,
    failedCharges,
    manualRefundTasks,
    advancedPoliciesEnabled,
  ] = await withQueryDeadline(
    'caixa.load',
    Promise.all([
      getClinicTimezone(clinicId),
      getCaixaPagaveis(clinicId),
      listPendenciasAbertas(clinicId),
      listPaymentMethods(clinicId),
      listOpenCollectionCases(clinicId),
      paymentsApiV1.listFailedCharges(clinicId),
      paymentsApiV1.listManualRefundTasks(clinicId),
      billingApiV1.hasAdvancedFinancialPolicies(clinicId),
    ]),
  );

  const { from, to } = clinicDayBounds(tz);

  // Rodada 2: lançamentos do dia precisam da janela; os estornos em excesso
  // precisam das pendências. Um não depende do outro.
  const [lancs, excessRefundStatuses] = await withQueryDeadline(
    'caixa.day',
    Promise.all([
      getCaixaLancamentos(clinicId, from, to),
      paymentsApiV1.listExcessRefundStatuses(
        clinicId,
        pendencias.map((item) => item.appointmentId),
      ),
    ]),
  );

  // Caixa patient-first: resolve nomes via contexto patient (camada page — sem
  // JOIN cross-context; igual ao consultório).
  const all = [...lancs.pendentes, ...lancs.parciais, ...lancs.pagosHoje, ...pagaveis];
  const patientIds = [
    ...new Set([
      ...all.filter((l) => l.patientId).map((l) => l.patientId!),
      ...failedCharges.filter((c) => c.patientId).map((c) => c.patientId!),
      ...manualRefundTasks.filter((task) => task.patientId).map((task) => task.patientId!),
    ]),
  ];

  const appointmentIds = [
    ...new Set(all.flatMap((item) => (item.appointmentId ? [item.appointmentId] : []))),
  ];

  // Rodada 3: transações, fichas e economia financeira saem dos lançamentos,
  // mas nenhuma dessas leituras depende do resultado das outras.
  const [paymentTransactions, cards, economics, commercialMethods, chargeEconomics] =
    await withQueryDeadline(
      'caixa.enrich',
      Promise.all([
        listPaymentTransactionsForLancamentos(
          clinicId,
          all.map((l) => l.id),
        ) as Promise<PaymentTransactionSummary[]>,
        listPatientCards(clinicId, patientIds),
        listAppointmentFinancialEconomics(clinicId, appointmentIds),
        listAppointmentCommercialPaymentMethods(clinicId, appointmentIds),
        paymentsApiV1.listPatientChargeEconomics(clinicId, appointmentIds),
      ]),
    );
  const nameById = new Map(cards.map((c) => [c.id, c.nome]));
  const commercialMethodByAppointment = new Map(
    commercialMethods.map((item) => [item.appointmentId, item.commercialPaymentMethod]),
  );
  const economicsByAppointment = new Map(
    economics.map((item) => [
      item.appointmentId,
      advancedPoliciesEnabled ? item : { ...item, earlySettlementFeeAmount: null, payout: null },
    ]),
  );
  const chargesByAppointment = new Map<string, typeof chargeEconomics>();
  for (const charge of chargeEconomics) {
    const current = chargesByAppointment.get(charge.appointmentId) ?? [];
    current.push(charge);
    chargesByAppointment.set(charge.appointmentId, current);
  }
  const enrich = (l: LancamentoSummary): CaixaItem => ({
    ...l,
    pacienteNome: l.patientId ? (nameById.get(l.patientId) ?? null) : null,
    paymentEconomics: l.appointmentId
      ? (economicsByAppointment.get(l.appointmentId) ?? null)
      : null,
    chargeEconomics: l.appointmentId ? (chargesByAppointment.get(l.appointmentId) ?? []) : [],
    commercialPaymentMethod: l.appointmentId
      ? (commercialMethodByAppointment.get(l.appointmentId) ?? null)
      : null,
  });

  const canOperate =
    user.permissions.includes(PERMISSIONS.OPERATE_CAIXA) ||
    user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const canRefund = user.permissions.includes(PERMISSIONS.REFUND_FINANCIAL);
  // A action revalida permissão, plano, teto e estado; isto só decide exibir o formulário.
  const canReviewPayout =
    advancedPoliciesEnabled && user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);

  return (
    <CaixaView
      // Data e relógio vêm do SERVIDOR no fuso da clínica: calcular no cliente
      // daria fuso do navegador e divergência de hidratação no primeiro render.
      hoje={new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        day: 'numeric',
        month: 'long',
      }).format(new Date())}
      atualizadoEm={new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())}
      pendentes={lancs.pendentes.map(enrich)}
      parciais={lancs.parciais.map(enrich)}
      pagosHoje={lancs.pagosHoje.map(enrich)}
      aPagar={pagaveis.map(enrich)}
      pendencias={pendencias}
      failedCharges={failedCharges.map((charge) => ({
        ...charge,
        pacienteNome: charge.patientId ? (nameById.get(charge.patientId) ?? null) : null,
      }))}
      manualRefundTasks={manualRefundTasks.map((task) => ({
        ...task,
        pacienteNome: task.patientId ? (nameById.get(task.patientId) ?? null) : null,
      }))}
      excessRefundStatuses={excessRefundStatuses}
      collectionCases={collectionCases}
      methods={methods}
      paymentTransactions={paymentTransactions}
      showAdvancedFinancialDetails={advancedPoliciesEnabled}
      canOperate={canOperate}
      canRefund={canRefund}
      canReviewPayout={canReviewPayout}
    />
  );
}
