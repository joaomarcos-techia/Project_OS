import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { getConveniosCommercialDenial, isInsuranceSchemaInstalled } from '@/contexts/health-insurance/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { premiumDenialMessage, type PremiumDenial } from '@/lib/premium-access';

import { ConveniosTabs } from './tabs';

export type ConveniosAccess =
  | { ok: true; clinicId: string; canManage: boolean; commercial: PremiumDenial | null }
  | { ok: false; view: ReactNode };

/**
 * Ver Convênios = ver o financeiro; agir (conferir, aprovar, lote, glosa, pagamento) =
 * gerenciar o financeiro. O médico não precisa entrar aqui: a guia nasce do atendimento.
 */
export async function conveniosAccess(title: string): Promise<ConveniosAccess> {
  const user = await requireUser();
  await requireClinicId();
  if (!user.clinicId || !user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL)) {
    return {
      ok: false,
      view: (
        <>
          <PageHeader title={title} />
          <Alert variant="warning" title="Sem acesso">
            Seu perfil não tem permissão para o faturamento de convênios.
          </Alert>
        </>
      ),
    };
  }
  if (!(await isInsuranceSchemaInstalled(user.clinicId))) {
    return {
      ok: false,
      view: (
        <>
          <PageHeader title={title} />
          <Alert variant="info" title="Convênios ainda não está instalado neste ambiente">
            As tabelas do faturamento TISS ainda não foram aplicadas neste banco. Nada foi alterado.
          </Alert>
        </>
      ),
    };
  }
  return {
    ok: true,
    clinicId: user.clinicId,
    canManage: user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL),
    // D24: a mesma decisão do banco que barra as ações, para a tela avisar antes.
    commercial: await getConveniosCommercialDenial(user.clinicId),
  };
}

/** Avaliação ou sem plano: recurso contratável; nada é operado. */
const CONTRACTABLE: readonly PremiumDenial[] = ['trial', 'trial_expired', 'no_subscription', 'clinic_unknown', 'plan_excludes'];

/**
 * Aviso comercial (D24) na tela: a mesma decisão do banco que barra as ações. No trial, o
 * recurso aparece como contratável; com a assinatura parada, os registros continuam
 * disponíveis para consulta e só as operações novas ficam bloqueadas.
 */
function CommercialNotice({ denial }: { denial: PremiumDenial | null | undefined }) {
  if (!denial) return null;
  const contractable = CONTRACTABLE.includes(denial);
  return (
    <Alert
      variant={contractable ? 'info' : 'warning'}
      title={contractable ? 'Convênios faz parte das assinaturas ativas' : 'Convênios em modo de consulta'}
      className="mb-(--sp-4)"
    >
      <span data-testid="convenios-commercial-notice" data-denial={denial}>
        {premiumDenialMessage('health_insurance', denial)}
      </span>
    </Alert>
  );
}

export function ConveniosHeader({
  title,
  description,
  crumbs = [],
  actions,
  commercial,
}: {
  title: string;
  description?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
  /** Estado comercial de `conveniosAccess` (D24): aviso de recurso contratável ou de consulta. */
  commercial?: PremiumDenial | null;
}) {
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Convênios', href: '/convenios' }, ...crumbs]}
        title={title}
        {...(description ? { description } : {})}
        {...(actions ? { actions } : {})}
      />
      <CommercialNotice denial={commercial} />
      <ConveniosTabs />
    </>
  );
}

/** Centavos → R$. */
export function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function shortDate(value: string | null): string {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
