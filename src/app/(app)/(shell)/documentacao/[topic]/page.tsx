import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { DOC_GROUPS, DOC_TOPICS, findDocTopic } from '../content';
import { DocumentationNavigation } from '../documentation-navigation';
import { MarkDocsVisited } from '../mark-visited';

/** O slug é resolvido contra uma lista fechada; um valor desconhecido retorna 404. */
export async function generateStaticParams() {
  return DOC_TOPICS.map((topic) => ({ topic: topic.slug }));
}

export default async function DocumentacaoTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { topic: slug } = await params;
  const topic = findDocTopic(slug);
  if (!topic) notFound();

  const topicIndex = DOC_TOPICS.findIndex((item) => item.slug === topic.slug);
  const previous = topicIndex > 0 ? DOC_TOPICS[topicIndex - 1] : undefined;
  const next = topicIndex < DOC_TOPICS.length - 1 ? DOC_TOPICS[topicIndex + 1] : undefined;
  const group = DOC_GROUPS.find((item) => item.slugs.includes(topic.slug));

  return (
    <>
      <MarkDocsVisited />
      <Breadcrumbs
        items={[{ label: 'Ajuda', href: '/documentacao' }, { label: topic.title }]}
        className="mb-5"
      />
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <DocumentationNavigation activeSlug={topic.slug} />

        <article className="min-w-0 rounded-(--r-xl) bg-surface px-5 py-7 shadow-[0_1px_2px_oklch(0.3_0.02_250/0.08),0_18px_44px_-34px_oklch(0.3_0.02_250/0.34)] sm:px-8 sm:py-9">
          <header className="border-b border-border pb-7">
            <span className="text-(length:--fs-2xs) font-semibold tracking-[0.1em] text-(--primary-active) uppercase">
              {group?.label ?? 'Guia'}
            </span>
            <h1 className="mt-3 text-balance font-display text-(length:--fs-page) font-semibold tracking-tight text-fg">
              {topic.title}
            </h1>
            <p className="mt-3 max-w-180 text-pretty text-(length:--fs-base) leading-relaxed text-fg-muted">
              {topic.summary}
            </p>
          </header>

          <div className="mt-8 space-y-10">
            {topic.sections.map((section, index) => (
              <section key={section.heading} id={`secao-${index + 1}`} className="scroll-mt-6">
                <h2 className="text-balance font-display text-(length:--fs-h3) font-semibold text-fg">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="max-w-185 text-pretty text-(length:--fs-sm) leading-7 text-fg-muted"
                    >
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul className="ml-5 max-w-180 list-disc space-y-2 marker:text-primary">
                      {section.bullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="pl-1 text-pretty text-(length:--fs-sm) leading-7 text-fg-muted"
                        >
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          <nav
            aria-label="Artigos anterior e seguinte"
            className="mt-10 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
          >
            {previous ? (
              <Link
                href={`/documentacao/${previous.slug}`}
                className="group flex min-h-16 items-center gap-3 rounded-(--r-md) bg-surface-2 px-4 py-3 text-left transition-[background-color,transform] duration-(--dur-fast) hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none active:scale-[0.96]"
              >
                <ArrowLeft
                  aria-hidden="true"
                  className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-fast) group-hover:-translate-x-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-(length:--fs-2xs) text-fg-subtle">Anterior</span>
                  <span className="block text-(length:--fs-sm) font-semibold text-fg">
                    {previous.title}
                  </span>
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/documentacao/${next.slug}`}
                className="group flex min-h-16 items-center justify-end gap-3 rounded-(--r-md) bg-surface-2 px-4 py-3 text-right transition-[background-color,transform] duration-(--dur-fast) hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none active:scale-[0.96]"
              >
                <span className="min-w-0">
                  <span className="block text-(length:--fs-2xs) text-fg-subtle">Próximo</span>
                  <span className="block text-(length:--fs-sm) font-semibold text-fg">
                    {next.title}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                />
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="hidden xl:block">
          <nav aria-label="Nesta página" className="sticky top-6">
            <h2 className="px-2 text-(length:--fs-2xs) font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              Nesta página
            </h2>
            <ul className="mt-2 border-l border-border pl-2">
              {topic.sections.map((section, index) => (
                <li key={section.heading}>
                  <Link
                    href={`#secao-${index + 1}`}
                    className="flex min-h-10 items-center rounded-(--r-sm) px-2 py-2 text-pretty text-(length:--fs-xs) leading-snug text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                  >
                    {section.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </>
  );
}
