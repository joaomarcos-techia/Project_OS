import { notFound, redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { DOC_TOPICS, findDocTopic } from '../content';

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
        crumbs={[{ label: 'Ajuda', href: '/documentacao' }, { label: topic.title }]}
        title={topic.title}
        description={topic.summary}
      />
      {topic.sections.map((section) => (
        <PanelCard key={section.heading} title={section.heading} regionLabel={section.heading}>
          <div className="flex flex-col gap-2.5 px-4 py-3">
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-pretty text-(length:--fs-sm) text-fg-muted">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="ml-4 flex list-disc flex-col gap-1.5">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="text-pretty text-(length:--fs-sm) text-fg-muted">
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </PanelCard>
      ))}
    </>
  );
}
