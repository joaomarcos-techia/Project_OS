import { CircleQuestionMark } from 'lucide-react';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { currentOnboardingProgress } from '../_painel/onboarding-progress';

import { DOC_TOPICS } from './content';
import { HelpIndex } from './help-index';
import { MarkDocsVisited } from './mark-visited';
import { RestartTour } from './restart-tour';

/**
 * O-7 — central de documentação DO PRODUTO (`/documentação`).
 *
 * Autenticada como qualquer tela do shell. O guard aqui é o mesmo backstop do
 * dashboard: o layout também redireciona, mas segmentos renderizam
 * concorrentemente e um `AuthError` esperado não deve virar 500 antes de o
 * redirect do layout ganhar a corrida.
 *
 * O conteúdo é igual para todas as clínicas. Sessão e progresso de apresentação
 * continuam usando os controles existentes da conta.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Central de ajuda',
  description:
    'Passo a passo para usar agenda, pacientes, WhatsApp, cobranças e gestão da sua clínica.',
};

export default async function DocumentacaoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const onboarding = await currentOnboardingProgress();

  return (
    <>
      <MarkDocsVisited />
      <PageHeader
        crumbs={[
          {
            label: (
              <>
                <CircleQuestionMark aria-hidden="true" />
                Ajuda
              </>
            ),
          },
        ]}
        title="Central de ajuda"
        description="Respostas curtas para as dúvidas mais comuns"
        {...(onboarding ? { actions: <RestartTour state={onboarding.tourState} /> } : {})}
      />
      <HelpIndex topics={DOC_TOPICS} />
    </>
  );
}
