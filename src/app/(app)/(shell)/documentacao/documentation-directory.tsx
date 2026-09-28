'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  CircleHelp,
  CreditCard,
  FileHeart,
  LockKeyhole,
  MessageCircle,
  Search,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/ui/cn';

import { DOC_GROUPS, DOC_TOPICS, type DocTopic } from './content';

const TOPIC_ICONS: Record<string, LucideIcon> = {
  'primeiros-passos': BookOpenCheck,
  'fluxos-por-papel': UsersRound,
  'prontuario-e-documentos': FileHeart,
  financeiro: WalletCards,
  asaas: CreditCard,
  whatsapp: MessageCircle,
  ia: Bot,
  seguranca: LockKeyhole,
  troubleshooting: CircleHelp,
};

function TopicLink({ topic, featured = false }: { topic: DocTopic; featured?: boolean }) {
  const Icon = TOPIC_ICONS[topic.slug] ?? BookOpenCheck;
  return (
    <Link
      href={`/documentacao/${topic.slug}`}
      className={cn(
        'group flex min-h-20 gap-3 rounded-(--r-md) bg-surface p-4 text-left',
        'shadow-[0_1px_2px_oklch(0.3_0.02_250/0.08),0_14px_32px_-28px_oklch(0.3_0.02_250/0.34)]',
        'transition-[background-color,box-shadow,transform] duration-(--dur-fast) hover:bg-surface-hover hover:shadow-(--elev-raised)',
        'focus-visible:shadow-(--focus-ring) focus-visible:outline-none active:scale-[0.96]',
        featured && 'min-h-32 flex-col',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-(--r-sm) bg-(--primary-soft) text-(--primary-active)',
          featured && 'size-10',
        )}
      >
        <Icon aria-hidden="true" className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-(length:--fs-sm) font-semibold text-fg">
          <span className="min-w-0 flex-1">{topic.title}</span>
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-1 block text-pretty text-(length:--fs-xs) leading-relaxed text-fg-muted">
          {topic.summary}
        </span>
      </span>
    </Link>
  );
}

export function DocumentationDirectory() {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = useMemo(
    () =>
      normalized
        ? DOC_TOPICS.filter((topic) =>
            `${topic.title} ${topic.summary}`.toLocaleLowerCase('pt-BR').includes(normalized),
          )
        : DOC_TOPICS,
    [normalized],
  );

  return (
    <>
      <section className="overflow-hidden rounded-(--r-xl) bg-[linear-gradient(135deg,var(--primary-soft),var(--surface)_72%)] px-5 py-8 shadow-[0_1px_2px_oklch(0.3_0.02_250/0.08),0_20px_50px_-38px_oklch(0.3_0.05_250/0.38)] sm:px-8 sm:py-10">
        <div className="mx-auto max-w-185 text-center">
          <span className="text-(length:--fs-2xs) font-semibold tracking-[0.12em] text-(--primary-active) uppercase">
            Ajuda Qoro
          </span>
          <h1 className="mt-3 text-balance font-display text-(length:--fs-page) font-semibold tracking-tight text-fg">
            Como podemos ajudar?
          </h1>
          <p className="mx-auto mt-2 max-w-150 text-pretty text-(length:--fs-base) text-fg-muted">
            Encontre orientações diretas para configurar a clínica e conduzir a operação diária.
          </p>
          <label className="relative mx-auto mt-6 block max-w-150 text-left">
            <span className="sr-only">Buscar na central de ajuda</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Busque por agenda, financeiro, WhatsApp..."
              className="min-h-12 w-full rounded-(--r-md) border border-(--field-border) bg-surface pr-4 pl-12 text-(length:--fs-sm) text-fg shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle focus:border-primary focus:shadow-(--focus-ring)"
            />
          </label>
        </div>
      </section>

      {normalized ? (
        <section className="mt-7" aria-live="polite">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-balance font-display text-(length:--fs-h3) font-semibold">
              Resultados
            </h2>
            <span className="text-(length:--fs-xs) text-fg-subtle tabular-nums">
              {filtered.length} {filtered.length === 1 ? 'tópico' : 'tópicos'}
            </span>
          </div>
          {filtered.length ? (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="doc-topics">
              {filtered.map((topic) => (
                <TopicLink key={topic.slug} topic={topic} />
              ))}
            </div>
          ) : (
            <div className="rounded-(--r-lg) bg-surface px-5 py-8 text-center shadow-sm">
              <CircleHelp aria-hidden="true" className="mx-auto size-7 text-fg-subtle" />
              <p className="mt-3 font-semibold text-fg">Nenhum tópico encontrado</p>
              <p className="mt-1 text-pretty text-(length:--fs-sm) text-fg-muted">
                Tente uma palavra mais ampla ou limpe a busca para navegar pelas categorias.
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="mt-7">
          <h2 className="text-balance font-display text-(length:--fs-h3) font-semibold">
            Comece por aqui
          </h2>
          <p className="mt-1 text-pretty text-(length:--fs-sm) text-fg-muted">
            Os guias mais úteis para colocar a clínica em funcionamento.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {DOC_TOPICS.slice(0, 3).map((topic) => (
              <TopicLink key={topic.slug} topic={topic} featured />
            ))}
          </div>
        </section>
      )}

      {!normalized ? (
        <div className="mt-9 space-y-8" data-testid="doc-topics">
          {DOC_GROUPS.map((group) => {
            const topics = group.slugs
              .map((slug) => DOC_TOPICS.find((topic) => topic.slug === slug))
              .filter((topic): topic is DocTopic => Boolean(topic));
            return (
              <section key={group.label}>
                <h2 className="text-balance font-display text-(length:--fs-h4) font-semibold">
                  {group.label}
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {topics.map((topic) => (
                    <TopicLink key={topic.slug} topic={topic} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
