'use client';

import Link from 'next/link';
import { ChevronRight, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SearchField } from '@/components/ui/filter-bar';

import type { DocTopic } from './content';
import styles from './help.module.css';

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
    <div className={styles.index}>
      <Card className={styles.searchCard ?? ''}>
        <label htmlFor="help-search" className={styles.searchLabel}>
          Qual é a sua dúvida?
        </label>
        <div className={styles.searchRow}>
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
        <div className={styles.searchFoot}>
          <p id="help-results" role="status">
            {filtered.length === 1 ? '1 guia encontrado' : `${filtered.length} guias encontrados`}
          </p>
          <p>
            As opções dependem do seu plano e das permissões da sua conta. Precisa de acesso? Fale
            com o responsável pela clínica.
          </p>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-5">
          <h2 className="font-semibold">Nenhum guia encontrado</h2>
          <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
            Tente outra palavra ou limpe a busca para ver todos os assuntos.
          </p>
        </Card>
      ) : (
        <div className={styles.groups}>
          {categories.map((category) => {
            const items = filtered.filter((topic) => topic.category === category);
            if (!items.length) return null;
            return (
              <section key={category} aria-label={category} className={styles.group}>
                <div className={styles.groupHead}>
                  <h2>{category}</h2>
                  <span>{items.length === 1 ? '1 guia' : `${items.length} guias`}</span>
                </div>
                <ul data-testid="doc-topics">
                  {items.map((topic) => (
                    <li key={topic.slug}>
                      <Link href={`/documentação/${topic.slug}`} className={styles.guide}>
                        <span className={styles.guideCopy}>
                          <b>{topic.title}</b>
                          <span>{topic.summary}</span>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
