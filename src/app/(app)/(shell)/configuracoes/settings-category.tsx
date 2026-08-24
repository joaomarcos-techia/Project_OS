import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/tenant-context';
import { cn } from '@/lib/ui/cn';

import type { SettingsNavItem } from './settings-navigation';
import { visibleSettingsNavigation } from './settings-navigation';
import type { SettingsStatus } from './settings-status';

/**
 * Card de uma configuração. É a unidade de leitura da categoria: ícone pequeno,
 * nome, uma linha do que se resolve ali, e a ação.
 *
 * O card inteiro é o link — a área clicável é o cartão todo, e o teclado recebe
 * UM tab-stop por configuração em vez de um por região decorativa. O botão é
 * affordance visual, nunca o alvo; por isso ele não é um `<button>` aninhado.
 */
function SettingsCard({
  item,
  status,
}: {
  item: SettingsNavItem;
  status: SettingsStatus | undefined;
}) {
  const Icon = item.icon;
  return (
    <Card
      className={cn(
        'group relative flex flex-col gap-2 p-(--card-pad)',
        'transition-colors duration-(--dur-fast) hover:border-border-2',
        'focus-within:shadow-(--focus-ring)',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-(--r-md) bg-surface-2 text-fg-muted"
        >
          <Icon className="size-4.5" />
        </span>
        {status ? (
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-1 text-(length:--fs-subsection) font-semibold">
        {/* `after:absolute inset-0` estende o alvo do link ao card inteiro sem
            aninhar elementos interativos — o link continua sendo um só. */}
        <Link
          href={item.href}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {item.label}
        </Link>
      </h3>
      <p className="text-pretty text-(length:--fs-body-sm) text-fg-muted">{item.description}</p>

      <span
        aria-hidden="true"
        className="mt-2 inline-flex items-center gap-1.5 self-start rounded-(--r-md) border border-border px-3 py-1.5 text-(length:--fs-body-sm) font-medium text-primary transition-colors duration-(--dur-fast) group-hover:bg-(--primary-soft)"
      >
        {item.cta ?? 'Configurar'}
        <ArrowRight className="size-3.5" />
      </span>
    </Card>
  );
}

/**
 * Página de uma categoria. As cinco rotas de categoria são cascas finas em cima
 * disto: quem decide o que aparece é o mesmo mapa que desenha as abas, e o gate
 * real continua em cada rota de destino.
 */
export async function SettingsCategoryPage({
  id,
  statuses = {},
}: {
  id: string;
  statuses?: Record<string, SettingsStatus>;
}) {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );
  const group = groups.find((candidate) => candidate.id === id);
  // Sem NENHUM destino visível a categoria não existe para esta pessoa — e a
  // aba correspondente também não foi desenhada. 404 é a resposta honesta.
  if (!group) notFound();

  return (
    <>
      <PageHeader title={group.label} description={group.description} />
      <div className="grid gap-(--sp-4) sm:grid-cols-2 xl:grid-cols-3">
        {group.items.map((item) => (
          <SettingsCard key={item.href} item={item} status={statuses[item.href]} />
        ))}
      </div>
    </>
  );
}
