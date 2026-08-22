import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';

export interface SettingsNavItem {
  label: string;
  href: string;
  permission?: Permission;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAVIGATION: SettingsNavGroup[] = [
  {
    label: 'Clínica',
    items: [
      {
        label: 'Perfil da clínica',
        href: '/configuracoes/perfil',
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
    ],
  },
  {
    label: 'Agenda',
    items: [
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
    ],
  },
  {
    label: 'Canais e IA',
    items: [
      {
        label: 'WhatsApp',
        href: '/configuracoes/whatsapp',
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
      {
        label: 'Agente de IA',
        href: '/configuracoes/agente',
        permission: PERMISSIONS.MANAGE_AGENT,
      },
    ],
  },
  {
    label: 'Gestão',
    items: [
      {
        label: 'Equipe e permissões',
        href: '/equipe',
        permission: PERMISSIONS.MANAGE_EMPLOYEES,
      },
      {
        label: 'Financeiro',
        href: '/financeiro',
        permission: PERMISSIONS.VIEW_FINANCIAL,
      },
      {
        label: 'Assinatura',
        href: '/configuracoes/assinatura',
        permission: PERMISSIONS.MANAGE_SETTINGS,
      },
    ],
  },
  {
    label: 'Conformidade e segurança',
    items: [
      {
        label: 'Solicitações LGPD',
        href: '/configuracoes/lgpd',
        permission: PERMISSIONS.EXPORT_PATIENT,
      },
      {
        label: 'Auditoria',
        href: '/configuracoes/auditoria',
        permission: PERMISSIONS.EXPORT_AUDIT,
      },
      { label: 'Segurança da conta', href: '/account/security' },
    ],
  },
  {
    label: 'Produto',
    items: [{ label: 'Sugestões', href: '/configuracoes/sugestoes' }],
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

export function firstSettingsHref(groups: readonly SettingsNavGroup[]): string {
  return groups[0]?.items[0]?.href ?? '/account/security';
}
