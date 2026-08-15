import type { ReactNode } from 'react';

import { NavTabs } from '@/components/ui/nav-tabs';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/tenant-context';

/**
 * Hub de Configurações — nav-tabs entre as SUBROTAS (mantidas: cada uma segue
 * RSC com o próprio fetch; ADR-031). "Segurança" aponta p/ /account/security
 * (rota fora do matcher do middleware — não muda de lugar).
 *
 * AUTHZ-006 — as tabs eram fixas e ofereciam TODA subrota a qualquer sessão.
 * Cada subrota nega server-side (é lá que a autorização mora), mas uma tab que
 * só leva a "Sem acesso" é ruído e promete uma capacidade inexistente. O filtro
 * aqui é UX; não é — e não deve ser lido como — a barreira de segurança.
 */
const TABS: Array<{ label: string; href: string; exact?: boolean; permission?: Permission }> = [
  {
    label: 'Assinatura',
    href: '/configuracoes/assinatura',
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
  { label: 'Sugestões', href: '/configuracoes/sugestoes' },
  { label: 'Visão geral', href: '/configuracoes', exact: true },
  {
    label: 'Perfil da clínica',
    href: '/configuracoes/perfil',
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    label: 'Horários',
    href: '/configuracoes/horarios',
    permission: PERMISSIONS.MANAGE_AVAILABILITY,
  },
  {
    label: 'Procedimentos',
    href: '/configuracoes/procedimentos',
    permission: PERMISSIONS.MANAGE_PROCEDURES,
  },
  {
    label: 'Salas e equipamentos',
    href: '/configuracoes/recursos',
    permission: PERMISSIONS.MANAGE_AVAILABILITY,
  },
  { label: 'LGPD', href: '/configuracoes/lgpd', permission: PERMISSIONS.EXPORT_PATIENT },
  { label: 'WhatsApp', href: '/configuracoes/whatsapp', permission: PERMISSIONS.MANAGE_SETTINGS },
  { label: 'Segurança da conta', href: '/account/security' },
];

export default async function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const superBypass = user.isSuperAdmin && user.aal === 'aal2';
  const tabs = TABS.filter(
    (t) => !t.permission || superBypass || user.permissions.includes(t.permission),
  ).map(({ permission: _permission, ...tab }) => tab);

  return (
    <>
      <NavTabs className="mb-(--sp-5)" tabs={tabs} />
      {children}
    </>
  );
}
