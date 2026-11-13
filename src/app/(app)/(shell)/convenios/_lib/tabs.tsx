'use client';

import { NavTabs } from '@/components/ui/nav-tabs';

const TABS = [
  { label: 'Painel', href: '/convenios', exact: true },
  { label: 'Atendimentos', href: '/convenios/atendimentos' },
  { label: 'Solicitações', href: '/convenios/solicitacoes' },
  { label: 'Guias', href: '/convenios/guias' },
  { label: 'Lotes', href: '/convenios/lotes' },
  { label: 'Conciliação', href: '/convenios/conciliacao' },
  { label: 'Repasses', href: '/convenios/repasses' },
  { label: 'Carteirinhas', href: '/convenios/carteirinhas' },
  { label: 'Configuração', href: '/convenios/configuracao' },
];

export function ConveniosTabs() {
  return <NavTabs tabs={TABS} className="mb-(--sp-4)" />;
}
