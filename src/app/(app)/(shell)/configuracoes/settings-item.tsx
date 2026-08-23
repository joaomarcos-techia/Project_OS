import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

import type { SettingsNavGroup, SettingsNavItem } from './settings-navigation';
import type { SettingsStatus } from './settings-status';

/**
 * Linha de configuração do hub — a unidade de leitura da tela.
 *
 * É um `<Link>` inteiro, não um bloco com um link dentro: a área clicável é a
 * linha toda (alvo confortável no toque) e o teclado recebe UM tab-stop por
 * configuração, em vez de um por região decorativa. O chevron é affordance
 * visual, nunca o alvo.
 *
 * `focus-visible:relative z-10` porque as linhas são separadas por `divide-y`
 * dentro de um card com `overflow-hidden`: sem elevar o item focado, o anel de
 * foco ficava recortado pela borda do vizinho.
 */
export function SettingsItem({
  item,
  status,
}: {
  item: SettingsNavItem;
  status: SettingsStatus | undefined;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-(--sp-4) px-(--card-pad) py-3.5',
        'transition-colors duration-(--dur-fast) hover:bg-surface-hover',
        'focus-visible:relative focus-visible:z-10 focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-(--r-md) bg-surface-2 text-fg-subtle transition-colors duration-(--dur-fast) group-hover:text-fg-muted"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-(length:--fs-body) font-medium text-fg">
          {item.label}
        </span>
        <span className="mt-0.5 block text-pretty text-(length:--fs-body-sm) text-fg-muted">
          {item.description}
        </span>
      </span>
      {status ? (
        <Badge tone={status.tone} dot className="shrink-0">
          {status.label}
        </Badge>
      ) : null}
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-fast) group-hover:translate-x-0.5 group-hover:text-fg-muted"
      />
    </Link>
  );
}

/**
 * Seção do hub: título, uma linha de contexto e a lista de configurações.
 *
 * Um card por seção — não um card por configuração. A parede de cards gasta
 * borda e espaço para dizer o que uma lista com divisórias diz melhor, e destrói
 * a varredura vertical que é justamente o que se faz numa tela de ajustes.
 *
 * `tabIndex={-1}` torna a seção alvo programático da navegação por âncora, para
 * o foco acompanhar o scroll em vez de continuar preso na barra de navegação.
 */
export function SettingsSection({
  group,
  statuses,
}: {
  group: SettingsNavGroup;
  statuses: Record<string, SettingsStatus>;
}) {
  const headingId = `settings-${group.id}-title`;
  return (
    <section
      id={group.id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="scroll-mt-(--sp-12) rounded-(--r-lg) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
    >
      <h2
        id={headingId}
        className="text-(length:--fs-section) font-semibold tracking-tight text-balance"
      >
        {group.label}
      </h2>
      <p className="mt-1 text-pretty text-(length:--fs-body-sm) text-fg-muted">
        {group.description}
      </p>
      <Card className="mt-(--sp-3) divide-y divide-border overflow-hidden">
        {group.items.map((item) => (
          <SettingsItem key={item.href} item={item} status={statuses[item.href]} />
        ))}
      </Card>
    </section>
  );
}
