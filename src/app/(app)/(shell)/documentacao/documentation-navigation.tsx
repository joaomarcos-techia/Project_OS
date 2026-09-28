import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/ui/cn';

import { DOC_GROUPS, findDocTopic } from './content';

function TopicLinks({ activeSlug }: { activeSlug: string | undefined }) {
  return DOC_GROUPS.map((group) => (
    <section key={group.label} className="mb-5 last:mb-0">
      <h2 className="mb-1.5 px-3 text-(length:--fs-2xs) font-semibold tracking-[0.08em] text-fg-subtle uppercase">
        {group.label}
      </h2>
      <ul className="space-y-0.5">
        {group.slugs.map((slug) => {
          const topic = findDocTopic(slug);
          if (!topic) return null;
          const active = activeSlug === topic.slug;
          return (
            <li key={topic.slug}>
              <Link
                href={`/documentacao/${topic.slug}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-(--r-sm) px-3 py-2 text-(length:--fs-sm) font-medium',
                  'transition-[background-color,color] duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none active:scale-[0.96]',
                  active
                    ? 'bg-(--primary-soft) text-(--primary-active)'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                <span className="min-w-0 flex-1">{topic.title}</span>
                {active ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}

export function DocumentationNavigation({ activeSlug }: { activeSlug?: string }) {
  return (
    <>
      <details className="rounded-(--r-lg) border border-border bg-surface shadow-sm lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-(length:--fs-sm) font-semibold focus-visible:shadow-(--focus-ring) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          Navegar pela ajuda
          <ChevronRight aria-hidden="true" className="size-4 rotate-90 text-fg-subtle" />
        </summary>
        <nav aria-label="Tópicos da ajuda" className="border-t border-border px-2 py-3">
          <TopicLinks activeSlug={activeSlug} />
        </nav>
      </details>

      <aside className="hidden lg:block">
        <nav
          aria-label="Tópicos da ajuda"
          className="sticky top-6 rounded-(--r-lg) bg-surface p-3 shadow-[0_1px_2px_oklch(0.3_0.02_250/0.08),0_12px_30px_-24px_oklch(0.3_0.02_250/0.32)]"
        >
          <Link
            href="/documentacao"
            className="mb-5 flex min-h-10 items-center rounded-(--r-sm) px-3 text-(length:--fs-sm) font-semibold text-fg transition-colors hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none active:scale-[0.96]"
          >
            Central de ajuda
          </Link>
          <TopicLinks activeSlug={activeSlug} />
        </nav>
      </aside>
    </>
  );
}
