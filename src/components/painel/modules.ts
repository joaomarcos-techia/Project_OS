import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';

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
  /**
   * Nome mais curto só para o menu, quando o inteiro não cabe na pílula aberta
   * (168 px). O link continua anunciado com `label`.
   */
  navLabel?: string;
  group: Group;
  /** rota real quando a tela existe; ausente = "em breve". */
  href?: string;
  badge?: string;
  soon?: boolean;
  /**
   * A mesma permissão que a página exige para abrir. Sem ela, o item some do
   * menu em vez de levar a uma tela de "Sem acesso". Não substitui o gate da
   * página: só espelha. `modules.test.ts` confere que cada página ainda pede
   * esta permissão.
   */
  requires?: Permission;
}

export const MODULES: NavModule[] = [
  { id: 'dashboard', icon: 'home', label: 'Dashboard', group: 'Operação', href: '/dashboard' },
  {
    id: 'agenda',
    icon: 'calendar',
    label: 'Agenda',
    group: 'Operação',
    href: '/agenda',
    requires: PERMISSIONS.VIEW_AGENDA,
  },
  {
    id: 'consultorio',
    icon: 'stethoscope',
    label: 'Consultório',
    group: 'Operação',
    href: '/consultorio',
    requires: PERMISSIONS.VIEW_CONSULTORIO,
  },
  {
    id: 'pacientes',
    icon: 'users',
    label: 'Pacientes',
    group: 'Clínico',
    href: '/pacientes',
    requires: PERMISSIONS.VIEW_PATIENT,
  },
  {
    id: 'documentos',
    icon: 'record',
    label: 'Documentos',
    group: 'Clínico',
    href: '/documentos',
    requires: PERMISSIONS.VIEW_PRESCRIPTION,
  },
  {
    id: 'financeiro',
    icon: 'wallet',
    label: 'Financeiro',
    group: 'Gestão',
    href: '/financeiro',
    requires: PERMISSIONS.VIEW_FINANCIAL,
  },
  {
    id: 'caixa',
    icon: 'cash',
    label: 'Caixa',
    group: 'Gestão',
    href: '/caixa',
    requires: PERMISSIONS.VIEW_FINANCIAL,
  },
  {
    id: 'conversas',
    icon: 'chat',
    label: 'Conversas IA',
    group: 'Gestão',
    href: '/conversas',
    requires: PERMISSIONS.VIEW_CONVERSATIONS,
  },
  { id: 'relatorios', icon: 'chart', label: 'Relatórios', group: 'Gestão', href: '/relatorios' },
  {
    id: 'equipe',
    icon: 'shield',
    label: 'Equipe & Permissões',
    navLabel: 'Equipe',
    group: 'Administração',
    href: '/equipe',
    requires: PERMISSIONS.MANAGE_EMPLOYEES,
  },
  // Configurações não tem `requires`: o layout já resolve o destino pelas
  // categorias visíveis, e a página de sugestões é aberta a todos.
  {
    id: 'config',
    icon: 'gear',
    label: 'Configurações',
    group: 'Administração',
    href: '/configuracoes',
  },
  // O-7. `documentacao` (ajuda do produto) e `documentos` (documentos clínicos do
  // paciente) são coisas diferentes com nomes parecidos — daí o rótulo "Ajuda" e
  // o ícone próprio, para que ninguém escolha um querendo o outro.
  {
    id: 'ajuda',
    icon: 'help',
    label: 'Ajuda',
    group: 'Administração',
    href: '/documentação',
  },
];

/**
 * Ids dos módulos que a pessoa consegue abrir. O super_admin com AAL2 passa em
 * qualquer tela (mesma regra de `pageGate`), então vê o menu inteiro.
 */
export function visibleModuleIds(
  permissions: readonly string[],
  superAdminBypass: boolean,
): string[] {
  return MODULES.filter(
    (m) => !m.soon && (superAdminBypass || !m.requires || permissions.includes(m.requires)),
  ).map((m) => m.id);
}
