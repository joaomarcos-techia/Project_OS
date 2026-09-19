import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { currentOnboardingProgress } from '../_painel/onboarding-progress';

import { DOC_TOPICS } from './content';
import { MarkDocsVisited } from './mark-visited';
import { RestartTour } from './restart-tour';

/**
 * O-7 — central de documentação DO PRODUTO (`/documentacao`).
 *
 * Autenticada como qualquer tela do shell. O guard aqui é o mesmo backstop do
 * dashboard: o layout também redireciona, mas segmentos renderizam
 * concorrentemente e um `AuthError` esperado não deve virar 500 antes de o
 * redirect do layout ganhar a corrida.
 *
 * Nenhuma leitura de tenant acontece nesta página — o texto é igual para todas
 * as clínicas. É o que a torna tenant-safe por construção.
 */
export const metadata = { title: 'Ajuda' };

export default async function DocumentacaoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const onboarding = await currentOnboardingProgress();

  return (
    <>
      <MarkDocsVisited />
      <PageHeader
        crumbs={[{ label: 'Ajuda' }]}
        title="Central de ajuda"
        description="Como cada parte do Qoro funciona, por escrito."
        {...(onboarding ? { actions: <RestartTour state={onboarding.tourState} /> } : {})}
      />
      <ul className="flex flex-col gap-2.5" data-testid="doc-topics">
        {DOC_TOPICS.map((topic) => (
          <li key={topic.slug}>
            <Card className="overflow-hidden">
              <Link
                href={`/documentacao/${topic.slug}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-(length:--fs-sm) font-semibold">{topic.title}</span>
                  <span className="block text-pretty text-(length:--fs-xs) text-fg-muted">
                    {topic.summary}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
