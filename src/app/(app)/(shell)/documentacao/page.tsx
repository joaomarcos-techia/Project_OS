import { Compass } from 'lucide-react';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/tenant-context';

import { currentOnboardingProgress } from '../_painel/onboarding-progress';

import { DocumentationDirectory } from './documentation-directory';
import { DocumentationNavigation } from './documentation-navigation';
import { MarkDocsVisited } from './mark-visited';
import { RestartTour } from './restart-tour';

/** Central autenticada com conteúdo estático, igual para todas as clínicas. */
export const metadata = { title: 'Ajuda' };

export default async function DocumentacaoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const onboarding = await currentOnboardingProgress();

  return (
    <>
      <MarkDocsVisited />
      <div className="grid items-start gap-6 max-nav:mt-12 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <DocumentationNavigation />
        <main className="min-w-0">
          <DocumentationDirectory />

          {onboarding && onboarding.tourState !== 'in_progress' ? (
            <section className="mt-9 flex flex-col gap-4 rounded-(--r-lg) bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-(--r-sm) bg-(--primary-soft) text-(--primary-active)">
                  <Compass aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 className="text-balance font-semibold text-fg">
                    Prefere conhecer pelas telas?
                  </h2>
                  <p className="mt-1 text-pretty text-(length:--fs-sm) text-fg-muted">
                    Inicie um tour curto quando quiser. Ele não abre sozinho no primeiro acesso.
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <RestartTour state={onboarding.tourState} />
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </>
  );
}
