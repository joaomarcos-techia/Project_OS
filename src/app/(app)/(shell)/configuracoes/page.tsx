/**
 * /configuracoes — índice das configurações da clínica. Lista as seções que já
 * existem como rota real (Procedimentos, WhatsApp); seções ainda sem tela
 * aparecem como "em breve" SEM link (ADR-018: nada de link morto / mock).
 */
import Link from 'next/link';

import { Icon, type IconName } from '@/components/painel/icons';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/tenant-context';

export const dynamic = 'force-dynamic';

interface Section {
  icon: IconName;
  title: string;
  description: string;
  href?: string;
}

const SECTIONS: Section[] = [
  {
    icon: 'pill',
    title: 'Procedimentos',
    description: 'Catálogo com preço e duração — base da Agenda e do faturamento.',
    href: '/configuracoes/procedimentos',
  },
  {
    icon: 'chat',
    title: 'Conexão do WhatsApp',
    description: 'Conecte o número da clínica (Meta) para o agente atender.',
    href: '/configuracoes/whatsapp',
  },
  {
    icon: 'building',
    title: 'Perfil da clínica',
    description: 'Dados da clínica para os documentos (nome, endereço, telefone) + logo do receituário.',
    href: '/configuracoes/perfil',
  },
  {
    icon: 'clock',
    title: 'Horários de atendimento',
    description: 'Disponibilidade dos profissionais e feriados da clínica.',
    href: '/configuracoes/horarios',
  },
];

export default async function ConfiguracoesPage() {
  await requireUser();

  return (
    <div className="screen">
      <PageHeader
        title="Configurações"
        description="Ajustes da sua clínica."
      />

      <div className="cardblock">
        <div className="listrows">
          {SECTIONS.map((s) => {
            const inner = (
              <>
                <div className="lr-main">
                  <div className="flex items-center gap-2">
                    <Icon name={s.icon} size={18} className="text-fg-subtle" />
                    <span className="font-medium">{s.title}</span>
                    {!s.href ? <Badge tone="gray">em breve</Badge> : null}
                  </div>
                  <span className="lr-sub">{s.description}</span>
                </div>
                {s.href ? (
                  <span className="lr-end">
                    <Icon name="chevR" size={16} className="text-fg-subtle" />
                  </span>
                ) : null}
              </>
            );
            return s.href ? (
              <Link key={s.title} href={s.href} className="listrow">
                {inner}
              </Link>
            ) : (
              <div key={s.title} className="listrow" style={{ opacity: 0.6 }}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
