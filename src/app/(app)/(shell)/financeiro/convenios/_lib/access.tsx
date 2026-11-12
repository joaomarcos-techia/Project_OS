import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { isInsuranceSchemaInstalled } from '@/contexts/health-insurance/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { ConveniosTabs } from './tabs';

export type ConveniosAccess =
  | { ok: true; clinicId: string; canManage: boolean }
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
  return { ok: true, clinicId: user.clinicId, canManage: user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL) };
}

export function ConveniosHeader({
  title,
  description,
  crumbs = [],
  actions,
}: {
  title: string;
  description?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Convênios', href: '/financeiro/convenios' }, ...crumbs]}
        title={title}
        {...(description ? { description } : {})}
        {...(actions ? { actions } : {})}
      />
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
