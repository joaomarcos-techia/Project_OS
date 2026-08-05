/**
 * /configuracoes — visão geral do hub. As seções são as SUBROTAS reais (nada de
 * link morto / mock — ADR-018); navegação principal fica nas tabs do layout.
 */
import {
  Boxes,
  Building2,
  Clock3,
  FileLock2,
  Lightbulb,
  MessageCircle,
  Pill,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';

import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/tenant-context';

export const dynamic = 'force-dynamic';

interface Section {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
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
  },
  {
    icon: Building2,
    title: 'Perfil da clínica',
    description:
      'Dados da clínica para os documentos (nome, endereço, telefone) + logo do receituário.',
    href: '/configuracoes/perfil',
  },
  {
    icon: Clock3,
    title: 'Horários de atendimento',
    description: 'Disponibilidade dos profissionais e feriados da clínica.',
    href: '/configuracoes/horarios',
  },
  {
    icon: FileLock2,
    title: 'Solicitacoes LGPD',
    description: 'Fila com responsavel, prazo, historico e comunicacao ao titular.',
    href: '/configuracoes/lgpd',
  },
  {
    icon: Pill,
    title: 'Procedimentos',
    description: 'Catálogo com preço e duração — base da Agenda e do faturamento.',
    href: '/configuracoes/procedimentos',
  },
  {
    icon: Boxes,
    title: 'Salas e equipamentos',
    description: 'Recursos compartilhados que não podem ser reservados em horários sobrepostos.',
    href: '/configuracoes/recursos',
  },
  {
    icon: MessageCircle,
    title: 'Conexão do WhatsApp',
    description: 'Conecte o número da clínica (Meta) para o agente atender.',
    href: '/configuracoes/whatsapp',
  },
  {
    icon: ShieldCheck,
    title: 'Segurança da conta',
    description: 'Autenticação em dois fatores (MFA) do seu login.',
    href: '/account/security',
  },
];

export default async function ConfiguracoesPage() {
  await requireUser();

  return (
    <>
      <PageHeader title="Configurações" description="Ajustes da sua clínica." />

      <div className="grid gap-(--sp-4) md:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((s) => (
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
