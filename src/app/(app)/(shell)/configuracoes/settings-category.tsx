import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

import type { SettingsNavGroup, SettingsNavItem } from './settings-navigation';
import type { SettingsStatus } from './settings-status';
import styles from './settings.module.css';

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
  meta,
}: {
  item: SettingsNavItem;
  status: SettingsStatus | undefined;
  meta: string | undefined;
}) {
  const Icon = item.icon;
  return (
    <Card
      className={cn(
        styles.item,
        'group relative',
        'transition-colors duration-(--dur-fast) hover:border-border-2',
        'focus-within:shadow-(--focus-ring)',
      )}
    >
      <div className={styles.identity ?? ''}>
        {/* Ícone SOLTO, sem ladrilho: a referência não emoldura nenhum dos nove.
            O quadradinho cinza dobrava o peso visual de um glifo que só serve
            para reconhecer a linha de relance. */}
        <Icon aria-hidden="true" className="size-4.5 shrink-0 text-fg-subtle" />
      </div>
      <div className={styles.copy ?? ''}>
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
      </div>
      {status ? (
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      ) : null}
      {/* O número em mono, à direita, antes do chevron: é o que transforma a
          lista em inventário. "Procedimentos" diz que a tela existe; "38 ativos
          · 4 inativos" diz se vale abrir. */}
      {meta ? <span className={styles.meta ?? ''}>{meta}</span> : null}
      {/* Sem CTA textual. A linha INTEIRA é o link (o `after:inset-0` acima), e
          o chevron já diz isso. Nove linhas com nove verbos diferentes
          ("Configurar", "Abrir", "Conectar", "Gerenciar", "Acompanhar") faziam
          o olho ler a coluna de ações em vez da lista de assuntos — e todos
          levam ao mesmo lugar: a página daquela configuração. */}
      <ChevronRight aria-hidden="true" className={styles.action ?? ''} />
    </Card>
  );
}

/**
 * Uma categoria como SEÇÃO — o bloco que a referência empilha no índice.
 *
 * Reusa o mesmo `SettingsCard` das páginas de categoria: se o cartão divergisse
 * entre o índice e a categoria, a mesma configuração teria duas aparências.
 */
export function SettingsGroupSection({
  group,
  statuses = {},
  metas = {},
}: {
  group: SettingsNavGroup;
  statuses?: Record<string, SettingsStatus>;
  metas?: Record<string, string>;
}) {
  return (
    <section className={styles.groupSection ?? ''} aria-labelledby={`settings-group-${group.id}`}>
      <div className={styles.groupHeader ?? ''}>
        <h2 id={`settings-group-${group.id}`}>{group.label}</h2>
        <p>{group.description}</p>
      </div>
      <div className={styles.list ?? ''}>
        {group.items.map((item) => (
          <SettingsCard
            key={item.href}
            item={item}
            status={statuses[item.href]}
            meta={metas[item.href]}
          />
        ))}
      </div>
    </section>
  );
}
