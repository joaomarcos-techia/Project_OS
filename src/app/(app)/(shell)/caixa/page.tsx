import { listPatientCards } from '@/contexts/patient/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import {
  getCaixaLancamentos,
  getClinicTimezone,
  listPaymentMethods,
  listPendenciasAbertas,
} from '@/contexts/financial/queries';
import type { CaixaItem, LancamentoSummary } from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

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

  const [lancs, pendencias, methods] = await Promise.all([
    getCaixaLancamentos(clinicId, from, to),
    listPendenciasAbertas(clinicId),
    listPaymentMethods(clinicId),
  ]);

  // Caixa patient-first: resolve nomes via contexto patient (camada page — sem
  // JOIN cross-context; igual ao consultório).
  const all = [...lancs.pendentes, ...lancs.parciais, ...lancs.pagosHoje];
  const patientIds = [...new Set(all.filter((l) => l.patientId).map((l) => l.patientId!))];
  const cards = await listPatientCards(clinicId, patientIds);
  const nameById = new Map(cards.map((c) => [c.id, c.nome]));
  const enrich = (l: LancamentoSummary): CaixaItem => ({
    ...l,
    pacienteNome: l.patientId ? (nameById.get(l.patientId) ?? null) : null,
  });

  const canOperate =
    user.permissions.includes(PERMISSIONS.OPERATE_CAIXA) ||
    user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const canManage = user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);

  return (
    <CaixaView
      pendentes={lancs.pendentes.map(enrich)}
      parciais={lancs.parciais.map(enrich)}
      pagosHoje={lancs.pagosHoje.map(enrich)}
      pendencias={pendencias}
      methods={methods}
      canOperate={canOperate}
      canManage={canManage}
    />
  );
}
