import {
  ClipboardCheck,
  Clock,
  CreditCard,
  DoorOpen,
  FileLock,
  Lightbulb,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';

export interface SettingsNavItem {
  label: string;
  /** Uma linha dizendo o que se resolve ali — não repetir o rótulo. */
  description: string;
  href: string;
  icon: LucideIcon;
  /** Verbo do botão do card. Default: "Configurar". */
  cta?: string;
  permission?: Permission;
}

export interface SettingsNavGroup {
  /** Slug da rota da categoria: `/configuracoes/{id}`. */
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  items: SettingsNavItem[];
}

/**
 * Mapa único das configurações.
 *
 * Cada categoria é uma aba no topo e uma página de cards; cada item é um card
 * que leva para a rota que JÁ existe. Três destinos (`/equipe`, `/financeiro`,
 * `/account/security`) vivem fora do namespace de propósito: é onde a
 * funcionalidade mora, e duplicá-las sob `/configuracoes` criaria duas rotas
 * para a mesma coisa.
 *
 * `Perfil da clínica` NÃO está aqui: administrar a identidade da clínica exige
 * `manage:settings`, e uma aba que só o gestor enxerga desequilibra a barra que
 * todo mundo vê. O destino existe e é o mesmo (`/configuracoes/perfil`) — quem
 * pode abri-lo chega por `Perfil da clínica` no menu do rodapé da sidebar.
 */
export const SETTINGS_NAVIGATION: SettingsNavGroup[] = [
  {
    id: 'agenda',
    label: 'Agenda',
    description: 'Disponibilidade e recursos usados nos atendimentos.',
    icon: Clock,
    items: [
      {
        label: 'Horários',
        description:
          'Defina os horários de funcionamento e a disponibilidade de cada profissional.',
        href: '/configuracoes/horarios',
        icon: Clock,
        permission: PERMISSIONS.MANAGE_AVAILABILITY,
      },
      {
        label: 'Procedimentos',
        description: 'Catálogo com código, preço e duração — base da agenda e do faturamento.',
        href: '/configuracoes/procedimentos',
        icon: Stethoscope,
        permission: PERMISSIONS.MANAGE_PROCEDURES,
      },
      {
        label: 'Salas e equipamentos',
        description: 'Recursos que a agenda pode reservar junto com o atendimento.',
        href: '/configuracoes/recursos',
        icon: DoorOpen,
        permission: PERMISSIONS.MANAGE_AVAILABILITY,
      },
    ],
  },
  {
    id: 'canais-ia',
    label: 'Canais e IA',
    description: 'Atendimento digital e automação.',
    icon: MessageCircle,
    items: [
      {
        label: 'WhatsApp',
        description: 'Vincule o número usado no atendimento para ativar o canal da clínica.',
        href: '/configuracoes/whatsapp',
        icon: MessageCircle,
        cta: 'Conectar',
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
      {
        label: 'Agente de IA',
        description: 'Defina o que o agente pode fazer e dizer em nome da clínica.',
        href: '/configuracoes/agente',
        icon: Sparkles,
        permission: PERMISSIONS.MANAGE_AGENT,
      },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    description: 'Pessoas, permissões, finanças e assinatura.',
    icon: Users,
    items: [
      {
        label: 'Equipe e permissões',
        description: 'Membros da equipe e o que cada nível de acesso pode fazer.',
        href: '/equipe',
        icon: Users,
        cta: 'Abrir',
        permission: PERMISSIONS.MANAGE_EMPLOYEES,
      },
      {
        label: 'Financeiro',
        description: 'Lançamentos, recebimentos e a gestão financeira da clínica.',
        href: '/financeiro',
        icon: Wallet,
        cta: 'Abrir',
        permission: PERMISSIONS.VIEW_FINANCIAL,
      },
      {
        label: 'Pagamentos',
        description: 'Conta que recebe o dinheiro do paciente. O valor vai direto para a clínica.',
        href: '/configuracoes/pagamentos',
        icon: Wallet,
        cta: 'Conectar',
        permission: PERMISSIONS.MANAGE_FINANCIAL,
      },
      {
        label: 'Assinatura',
        description: 'Plano, limites de uso e cobrança do Qoro.',
        href: '/configuracoes/assinatura',
        icon: CreditCard,
        cta: 'Gerenciar',
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
    ],
  },
  {
    id: 'seguranca',
    label: 'Conformidade e segurança',
    description: 'Proteção dos dados da clínica e rastreabilidade das ações.',
    icon: ShieldCheck,
    items: [
      {
        label: 'Solicitações LGPD',
        description: 'Pedidos de acesso, exportação e exclusão de dados dos pacientes.',
        href: '/configuracoes/lgpd',
        icon: FileLock,
        cta: 'Acompanhar',
        permission: PERMISSIONS.EXPORT_PATIENT,
      },
      {
        label: 'Auditoria',
        description: 'Atividades e alterações registradas no sistema.',
        href: '/configuracoes/auditoria',
        icon: ClipboardCheck,
        cta: 'Consultar',
        permission: PERMISSIONS.EXPORT_AUDIT,
      },
      {
        label: 'Segurança da conta',
        description: 'Autenticação em duas etapas da sua conta de acesso.',
        href: '/account/security',
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: 'produto',
    label: 'Produto',
    description: 'Ajude a melhorar o Qoro.',
    icon: Lightbulb,
    items: [
      {
        label: 'Sugestões',
        description: 'Envie ideias, melhorias e problemas direto para o time.',
        href: '/configuracoes/sugestoes',
        icon: Lightbulb,
        cta: 'Enviar',
      },
    ],
  },
];

export function visibleSettingsNavigation(
  permissions: readonly string[],
  superBypass: boolean,
): SettingsNavGroup[] {
  return SETTINGS_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permission || superBypass || permissions.includes(item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * Destino de `/configuracoes`: a primeira categoria que a pessoa realmente pode
 * abrir. A rota nunca entrega uma negativa de permissão como tela inicial.
 */
export function firstSettingsHref(groups: readonly SettingsNavGroup[]): string {
  // DESTINO, não categoria: as rotas de categoria deixaram de existir quando o
  // índice virou a lista única. Apontar para `/configuracoes/<grupo>` daria 404
  // justamente para quem já tem o acesso mais estreito.
  const first = groups[0]?.items[0];
  return first ? first.href : '/account/security';
}
