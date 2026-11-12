'use client';

import { NavTabs } from '@/components/ui/nav-tabs';

const TABS = [
  { label: 'Painel', href: '/convenios', exact: true },
  { label: 'Solicitações', href: '/convenios/solicitacoes' },
  { label: 'Guias', href: '/convenios/guias' },
  { label: 'Lotes', href: '/convenios/lotes' },
  { label: 'Conciliação', href: '/convenios/conciliacao' },
  { label: 'Repasses', href: '/convenios/repasses' },
];

export function ConveniosTabs() {
  return <NavTabs tabs={TABS} className="mb-(--sp-4)" />;
}
