/**
 * /configuracoes — visão geral do hub. As seções são as SUBROTAS reais (nada de
 * link morto / mock — ADR-018); navegação principal fica nas tabs do layout.
 */
import {
  Bot,
  Boxes,
  Building2,
  Clock3,
  FileLock2,
  Lightbulb,
  MessageCircle,
  Pill,
  ReceiptText,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';

import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/tenant-context';

export const dynamic = 'force-dynamic';

interface Section {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  /**
   * AUTHZ-006 — permissão que a SUBROTA exige. O hub oferecia todas as seções a
   * qualquer sessão; cada subrota nega server-side, mas prometer uma ação que o
   * usuário não pode concluir é o defeito. `undefined` = seção deliberadamente
   * aberta (Sugestões é privada por autor; Segurança é da própria conta).
   */
  permission?: Permission;
}

const SECTIONS: Section[] = [
  {
    icon: Lightbulb,
    title: 'Sugestões',
    description: 'Envie ideias, melhorias e relatos de bugs para o produto.',
    href: '/configuracoes/sugestoes',
  },
  {
    icon: ReceiptText,
    title: 'Assinatura',
    description: 'Plano atual, limites e alterações de assinatura da clínica.',
    href: '/configuracoes/assinatura',
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    icon: Building2,
    title: 'Perfil da clínica',
    description:
      'Dados da clínica para os documentos (nome, endereço, telefone) + logo do receituário.',
    href: '/configuracoes/perfil',
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    icon: Clock3,
    title: 'Horários de atendimento',
    description: 'Disponibilidade dos profissionais e feriados da clínica.',
    href: '/configuracoes/horarios',
    permission: PERMISSIONS.MANAGE_AVAILABILITY,
  },
  {
    icon: FileLock2,
    title: 'Solicitacoes LGPD',
    description: 'Fila com responsavel, prazo, historico e comunicacao ao titular.',
    href: '/configuracoes/lgpd',
    permission: PERMISSIONS.EXPORT_PATIENT,
  },
  {
    icon: Pill,
    title: 'Procedimentos',
    description: 'Catálogo com preço e duração — base da Agenda e do faturamento.',
    href: '/configuracoes/procedimentos',
    permission: PERMISSIONS.MANAGE_PROCEDURES,
  },
  {
    icon: Boxes,
    title: 'Salas e equipamentos',
    description: 'Recursos compartilhados que não podem ser reservados em horários sobrepostos.',
    href: '/configuracoes/recursos',
    permission: PERMISSIONS.MANAGE_AVAILABILITY,
  },
  {
    icon: MessageCircle,
    title: 'Conexão do WhatsApp',
    description: 'Conecte o número da clínica (Meta) para o agente atender.',
    href: '/configuracoes/whatsapp',
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    // RBAC-001 — `manage:agent` passa a controlar uma capacidade real e
    // SEPARADA de `manage:settings`: a conexão do WhatsApp é integração; isto
    // é o comportamento do agente em nome da clínica.
    icon: Bot,
    title: 'Agente de IA',
    description: 'O que o agente pode fazer e dizer ao atender pelo WhatsApp.',
    href: '/configuracoes/agente',
    permission: PERMISSIONS.MANAGE_AGENT,
  },
  {
    // RBAC-001 — export da trilha da PRÓPRIA clínica. Distinto do export de
    // plataforma (super-admin, cross-tenant), que esta tela não alcança.
    icon: ScrollText,
    title: 'Auditoria',
    description: 'Exporte a trilha de ações da clínica para conformidade.',
    href: '/configuracoes/auditoria',
    permission: PERMISSIONS.EXPORT_AUDIT,
  },
  {
    icon: ShieldCheck,
    title: 'Segurança da conta',
    description: 'Autenticação em dois fatores (MFA) do seu login.',
    href: '/account/security',
  },
];

export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const superBypass = user.isSuperAdmin && user.aal === 'aal2';
  const sections = SECTIONS.filter(
    (s) => !s.permission || superBypass || user.permissions.includes(s.permission),
  );

  return (
    <>
      <PageHeader title="Configurações" description="Ajustes da sua clínica." />

      <div className="grid gap-(--sp-4) md:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.title} href={s.href} className="group">
            <Card className="flex h-full flex-col gap-2 p-(--card-pad) transition-colors group-hover:border-border-strong group-hover:bg-surface-2">
              <span className="grid size-9 place-items-center rounded-(--r-md) bg-primary-soft text-primary dark:text-primary-300">
                <s.icon className="size-4.5" />
              </span>
              <span className="text-(length:--fs-sm) font-semibold">{s.title}</span>
              <span className="text-(length:--fs-xs) leading-normal text-fg-muted">
                {s.description}
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
