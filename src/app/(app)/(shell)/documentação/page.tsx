import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { getCurrentUser } from '@/lib/auth/tenant-context';

import { currentOnboardingProgress } from '../_painel/onboarding-progress';

import { DOC_TOPICS } from '../documentacao/content';
import { HelpIndex } from '../documentacao/help-index';
import { MarkDocsVisited } from '../documentacao/mark-visited';
import { RestartTour } from '../documentacao/restart-tour';

/**
 * O-7 — central de documentação DO PRODUTO (`/documentação`).
 *
 * Autenticada como qualquer tela do shell. O guard aqui é o mesmo backstop do
 * dashboard: o layout também redireciona, mas segmentos renderizam
 * concorrentemente e um `AuthError` esperado não deve virar 500 antes de o
 * redirect do layout ganhar a corrida.
 *
 * Nenhuma leitura de tenant acontece nesta página — o texto é igual para todas
 * as clínicas. É o que a torna tenant-safe por construção.
 */
export const metadata = {
  title: 'Central de ajuda | Qoro',
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
        crumbs={[{ label: 'Ajuda' }]}
        title="Central de ajuda"
        description="Encontre instruções simples para usar a Qoro no dia a dia da sua clínica."
        {...(onboarding ? { actions: <RestartTour state={onboarding.tourState} /> } : {})}
      />
      <p className="mb-5 text-pretty text-(length:--fs-sm) text-fg-muted">
        As opções disponíveis dependem do seu plano e das permissões da sua conta. Se precisar de
        acesso a uma função, fale com o responsável pela clínica.
      </p>
      <HelpIndex topics={DOC_TOPICS} />
    </>
  );
}
