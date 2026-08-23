import {
  Building2,
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
  permission?: Permission;
}

export interface SettingsNavGroup {
  /** Âncora da seção no hub: `/configuracoes#agenda`. */
  id: string;
  label: string;
  description: string;
  items: SettingsNavItem[];
}

/**
 * Mapa único das configurações — consumido pelo hub `/configuracoes` (seções +
 * navegação contextual). Cada item aponta para a rota que JÁ existe; o hub é
 * porta de entrada, nunca uma segunda implementação da tela.
 *
 * Três destinos (`/equipe`, `/financeiro`, `/account/security`) vivem fora do
 * namespace de propósito: é onde a funcionalidade mora. Duplicá-los sob
 * `/configuracoes` criaria duas rotas para a mesma coisa.
 */
export const SETTINGS_NAVIGATION: SettingsNavGroup[] = [
  {
    id: 'clinica',
    label: 'Clínica',
    description: 'Informações básicas e identidade da clínica.',
    items: [
      {
        label: 'Perfil da clínica',
        description: 'Nome, endereço, contatos e dados que saem nos documentos.',
        href: '/configuracoes/perfil',
        icon: Building2,
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
    ],
  },
  {
    id: 'agenda',
    label: 'Agenda',
    description: 'Disponibilidade e recursos usados nos atendimentos.',
    items: [
      {
        label: 'Horários',
        description: 'Defina os horários de funcionamento e a disponibilidade.',
        href: '/configuracoes/horarios',
        icon: Clock,
        permission: PERMISSIONS.MANAGE_AVAILABILITY,
      },
      {
        label: 'Procedimentos',
        description: 'Gerencie procedimentos, duração e valores de atendimento.',
        href: '/configuracoes/procedimentos',
        icon: Stethoscope,
        permission: PERMISSIONS.MANAGE_PROCEDURES,
      },
      {
        label: 'Salas e equipamentos',
        description: 'Configure os recursos que a agenda pode reservar.',
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
    items: [
      {
        label: 'WhatsApp',
        description: 'Conecte e acompanhe o número de atendimento da clínica.',
        href: '/configuracoes/whatsapp',
        icon: MessageCircle,
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
    items: [
      {
        label: 'Equipe e permissões',
        description: 'Gerencie membros da equipe e níveis de acesso.',
        href: '/equipe',
        icon: Users,
        permission: PERMISSIONS.MANAGE_EMPLOYEES,
      },
      {
        label: 'Financeiro',
        description: 'Acesse lançamentos, recebimentos e a gestão financeira.',
        href: '/financeiro',
        icon: Wallet,
        permission: PERMISSIONS.VIEW_FINANCIAL,
      },
      {
        label: 'Assinatura',
        description: 'Gerencie plano, limites e cobrança do Qoro.',
        href: '/configuracoes/assinatura',
        icon: CreditCard,
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
    ],
  },
  {
    id: 'seguranca',
    label: 'Conformidade e segurança',
    description: 'Proteção dos dados da clínica e rastreabilidade das ações.',
    items: [
      {
        label: 'Solicitações LGPD',
        description: 'Acompanhe pedidos de acesso, exportação e exclusão de dados.',
        href: '/configuracoes/lgpd',
        icon: FileLock,
        permission: PERMISSIONS.EXPORT_PATIENT,
      },
      {
        label: 'Auditoria',
        description: 'Consulte as atividades e alterações registradas no sistema.',
        href: '/configuracoes/auditoria',
        icon: ClipboardCheck,
        permission: PERMISSIONS.EXPORT_AUDIT,
      },
      {
        label: 'Segurança da conta',
        description: 'Gerencie a autenticação em duas etapas da sua conta.',
        href: '/account/security',
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: 'produto',
    label: 'Produto',
    description: 'Ajude a melhorar o Qoro.',
    items: [
      {
        label: 'Sugestões',
        description: 'Envie ideias, melhorias e problemas direto para o time.',
        href: '/configuracoes/sugestoes',
        icon: Lightbulb,
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
