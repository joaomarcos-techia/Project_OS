import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { DOC_TOPICS, findDocTopic } from '../content';

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

/**
 * Página de um tópico da central de ajuda.
 *
 * O slug é resolvido contra uma LISTA FECHADA. Um slug desconhecido vira 404 —
 * a página nunca tenta montar conteúdo a partir do que veio na URL, então não há
 * caminho entre o parâmetro e nenhuma leitura.
 */
export async function generateStaticParams() {
  return DOC_TOPICS.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const topic = findDocTopic((await params).topic);
  return topic
    ? { title: `${topic.title} · Ajuda`, description: topic.summary }
    : { title: 'Guia não encontrado' };
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

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Ajuda', href: '/documentação' }, { label: topic.title }]}
        title={topic.title}
        description={topic.summary}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        {topic.sections.map((section, index) => (
          <section key={section.heading} aria-labelledby={`help-section-${index}`}>
            <Card className="p-5">
              <h2 id={`help-section-${index}`} className="text-(length:--fs-h4) font-semibold">
                {section.heading}
              </h2>
              <div className="mt-3 flex flex-col gap-3">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-pretty text-(length:--fs-base) leading-relaxed text-fg-muted"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.steps ? (
                  <ol className="ml-5 flex list-decimal flex-col gap-3">
                    {section.steps.map((step) => (
                      <li
                        key={step}
                        className="pl-1 text-pretty text-(length:--fs-base) leading-relaxed text-fg-muted"
                      >
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {section.bullets ? (
                  <ul className="ml-4 flex list-disc flex-col gap-1.5">
                    {section.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="text-pretty text-(length:--fs-base) leading-relaxed text-fg-muted"
                      >
                        {bullet}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
