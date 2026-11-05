'use client';

import Link from 'next/link';
import { ChevronRight, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SearchField } from '@/components/ui/filter-bar';

import type { DocTopic } from './content';

function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

export function HelpIndex({ topics }: { topics: readonly DocTopic[] }) {
  const [query, setQuery] = useState('');
  const terms = searchable(query.trim()).split(/\s+/u).filter(Boolean);
  const filtered = topics.filter((topic) => {
    const text = searchable(
      [
        topic.title,
        topic.summary,
        topic.category,
        ...topic.sections.flatMap((section) => [
          section.heading,
          ...section.paragraphs,
          ...(section.steps ?? []),
          ...(section.bullets ?? []),
        ]),
      ].join(' '),
    );
    return terms.every((term) => text.includes(term));
  });
  const categories = [...new Set(topics.map((topic) => topic.category))];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label htmlFor="help-search" className="mb-2 block text-(length:--fs-sm) font-medium">
          Qual é a sua dúvida?
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SearchField
            id="help-search"
            className="min-w-0"
            placeholder="Busque por agenda, sinal, WhatsApp…"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="help-results"
          />
          {query ? (
            <Button variant="subtle" onClick={() => setQuery('')}>
              <X aria-hidden="true" className="size-4" />
              Limpar busca
            </Button>
          ) : null}
        </div>
        <p id="help-results" role="status" className="mt-2 text-(length:--fs-xs) text-fg-muted">
          {filtered.length === 1 ? '1 guia encontrado' : `${filtered.length} guias encontrados`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-5">
          <h2 className="font-semibold">Nenhum guia encontrado</h2>
          <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
            Tente outra palavra ou limpe a busca para ver todos os assuntos.
          </p>
        </Card>
      ) : (
        categories.map((category) => {
          const items = filtered.filter((topic) => topic.category === category);
          if (!items.length) return null;
          return (
            <section key={category} aria-label={category}>
              <h2 className="mb-3 text-(length:--fs-h4) font-semibold">{category}</h2>
              <ul className="grid gap-3 md:grid-cols-2" data-testid="doc-topics">
                {items.map((topic) => (
                  <li key={topic.slug}>
                    <Card className="h-full overflow-hidden">
                      <Link
                        href={`/documentação/${topic.slug}`}
                        className="flex h-full min-h-20 items-center gap-3 p-4 transition-colors hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-(length:--fs-sm) font-semibold">
                            {topic.title}
                          </span>
                          <span className="mt-1 block text-pretty text-(length:--fs-xs) text-fg-muted">
                            {topic.summary}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-fg-subtle"
                        />
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
