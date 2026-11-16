import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { getConveniosCommercialDenial, isInsuranceSchemaInstalled, type GuideView } from '@/contexts/health-insurance/queries';
import {
  allows,
  conveniosRights,
  guideScopeFor,
  type ConveniosRights,
  type ConveniosRule,
  type GuideScope,
} from '@/contexts/health-insurance/rights';
import { getCurrentUser, requireClinicId } from '@/lib/auth/tenant-context';
import { premiumDenialMessage, type PremiumDenial } from '@/lib/premium-access';

import { ConveniosTabs } from './tabs';

export type ConveniosAccess =
  | {
      ok: true;
      clinicId: string;
      userId: string;
      /** Direitos da matriz I.2 (rights.ts). A tela só esconde; as actions decidem de novo no servidor. */
      rights: ConveniosRights;
      /** Clínica inteira ou só as próprias guias (posse por executante/solicitante). */
      scope: GuideScope;
      /** O que as consultas de guia devolvem: escopo e valores (D-4). */
      guideView: GuideView;
      commercial: PremiumDenial | null;
    }
  | { ok: false; view: ReactNode };

/** O que a página exige para abrir: entrar no módulo, visão ampla da clínica ou uma regra da matriz. */
export type ConveniosPageNeed = ConveniosRule | 'broad';

/**
 * Entrada em Convênios pela matriz I.2 (P1.12-b): `view:convenios` abre o módulo; cada página pode
 * exigir mais (lotes, conciliação e repasses: valores; autorizações: visão ampla). Sem visão ampla,
 * a pessoa vê só as próprias guias e solicitações, sem valores.
 */
export async function conveniosAccess(title: string, need: ConveniosPageNeed = 'view'): Promise<ConveniosAccess> {
  // Sessão expirada, revogada ou acesso desativado é estado esperado: vai para o login (mesmo
  // padrão do dashboard). Com `requireUser()`, o AuthError da página vencia a corrida com o
  // redirect do layout e a tela mostrava "Algo deu errado" — achado no Preview em 15/11, ao salvar
  // os dados da consulta com a sessão expirada (a resposta da action renderiza a página de novo).
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  await requireClinicId();
  const rights = conveniosRights(user.permissions);
  const enough = need === 'broad' ? rights.broad : allows(user.permissions, need);
  if (!user.clinicId || !rights.view || !enough) {
    return {
      ok: false,
      view: (
        <>
          <PageHeader title={title} />
          <Alert variant="warning" title="Sem acesso">
            Seu perfil não tem permissão para esta área de convênios.
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
  const scope = guideScopeFor(rights, user.userId);
  return {
    ok: true,
    clinicId: user.clinicId,
    userId: user.userId,
    rights,
    scope,
    guideView: { scope, values: rights.seeValues },
    // D24: a mesma decisão do banco que barra as ações, para a tela avisar antes.
    commercial: await getConveniosCommercialDenial(user.clinicId),
  };
}

/** Valor em R$ ou travessão quando a pessoa não tem visão de faturamento (o servidor devolve nulo). */
export function brlOrDash(cents: number | null): string {
  return cents === null ? '—' : brl(cents);
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
