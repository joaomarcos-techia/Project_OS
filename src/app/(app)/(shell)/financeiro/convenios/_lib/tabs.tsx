'use client';

import { NavTabs } from '@/components/ui/nav-tabs';

const TABS = [
  { label: 'Painel', href: '/financeiro/convenios', exact: true },
  { label: 'Guias', href: '/financeiro/convenios/guias' },
  { label: 'Lotes', href: '/financeiro/convenios/lotes' },
  { label: 'Conciliação', href: '/financeiro/convenios/conciliacao' },
];

export function ConveniosTabs() {
  return <NavTabs tabs={TABS} className="mb-(--sp-4)" />;
}
