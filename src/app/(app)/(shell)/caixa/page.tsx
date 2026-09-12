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
  const [tz, pagaveis, pendencias, methods, collectionCases, failedCharges] =
    await withQueryDeadline(
      'caixa.load',
      Promise.all([
        getClinicTimezone(clinicId),
        getCaixaPagaveis(clinicId),
        listPendenciasAbertas(clinicId),
        listPaymentMethods(clinicId),
        listOpenCollectionCases(clinicId),
        paymentsApiV1.listFailedCharges(clinicId),
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
    ]),
  ];

  // Rodada 3: transações e fichas saem dos lançamentos, mas não uma da outra.
  const [paymentTransactions, cards] = await withQueryDeadline(
    'caixa.enrich',
    Promise.all([
      listPaymentTransactionsForLancamentos(
        clinicId,
        all.map((l) => l.id),
      ) as Promise<PaymentTransactionSummary[]>,
      listPatientCards(clinicId, patientIds),
    ]),
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
      excessRefundStatuses={excessRefundStatuses}
      collectionCases={collectionCases}
      methods={methods}
      paymentTransactions={paymentTransactions}
      canOperate={canOperate}
      canRefund={canRefund}
    />
  );
}
