import type { ReactNode } from 'react';

import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * Hub de Configurações — nav-tabs entre as SUBROTAS (mantidas: cada uma segue
 * RSC com o próprio fetch; ADR-031). "Segurança" aponta p/ /account/security
 * (rota fora do matcher do middleware — não muda de lugar).
 */
export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavTabs
        className="mb-(--sp-5)"
        tabs={[
          { label: 'Visão geral', href: '/configuracoes', exact: true },
          { label: 'Perfil da clínica', href: '/configuracoes/perfil' },
          { label: 'Horários', href: '/configuracoes/horarios' },
          { label: 'Procedimentos', href: '/configuracoes/procedimentos' },
          { label: 'WhatsApp', href: '/configuracoes/whatsapp' },
          { label: 'Segurança da conta', href: '/account/security' },
        ]}
      />
      {children}
    </>
  );
}
