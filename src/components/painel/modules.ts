/**
 * Estrutura de navegação do Painel (porte de `ORDER`/`GROUPS` + módulos do
 * design bundle). Módulos já desenvolvidos linkam para a rota real; os demais
 * aparecem com "em breve" (decisão do founder: não simular o que não existe).
 */
export const GROUPS = ['Operação', 'Clínico', 'Gestão', 'Administração'] as const;
export type Group = (typeof GROUPS)[number];

export interface NavModule {
  id: string;
  icon: string;
  label: string;
  group: Group;
  /** rota real quando a tela existe; ausente = "em breve". */
  href?: string;
  badge?: string;
  soon?: boolean;
}

export const MODULES: NavModule[] = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard', group: 'Operação', href: '/dashboard' },
  { id: 'agenda', icon: 'calendar', label: 'Agenda', group: 'Operação', href: '/agenda' },
  { id: 'consultorio', icon: 'stethoscope', label: 'Consultório', group: 'Operação', href: '/consultorio' },
  { id: 'pacientes', icon: 'users', label: 'Pacientes', group: 'Clínico', href: '/pacientes' },
  { id: 'documentos', icon: 'docs', label: 'Documentos', group: 'Clínico', href: '/documentos' },
  { id: 'financeiro', icon: 'wallet', label: 'Financeiro', group: 'Gestão', href: '/financeiro' },
  { id: 'caixa', icon: 'cash', label: 'Caixa', group: 'Gestão', href: '/caixa' },
  { id: 'conversas', icon: 'chat', label: 'Conversas IA', group: 'Gestão', soon: true, badge: '4' },
  { id: 'relatorios', icon: 'chart', label: 'Relatórios', group: 'Gestão', href: '/relatorios' },
  { id: 'equipe', icon: 'shield', label: 'Equipe & Permissões', group: 'Administração', href: '/equipe' },
  { id: 'config', icon: 'gear', label: 'Configurações', group: 'Administração', href: '/configuracoes' },
];
