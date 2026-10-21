import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PROPOSED_OFFER } from '@/contexts/billing/proposed-offer';

import { ProposalCalculator } from './proposal-calculator';

export const metadata: Metadata = {
  title: 'Prévia da proposta de preços · Qoro',
  robots: { index: false, follow: false },
};

export default function OfertaPreviewPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-fg">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">Prévia comercial</p>
      <h1 className="font-display text-3xl font-semibold">Proposta de planos em validação</h1>
      <p className="text-fg-muted">
        Esta página permite revisar a nova tabela. Consultório e Clínica com dois médicos estão
        habilitados para cadastro no ambiente DEV; a contratação completa pelo checkout ainda está
        em validação no Sandbox. Os demais valores abaixo são simulações e não podem ser
        contratados.
      </p>
      <ProposalCalculator />
      <p className="text-fg-muted">
        Na proposta, o papel médico ocupa vaga médica mesmo antes de cadastrar CRM; titular ou
        gestor com CRM também ocupa vaga médica e, sem CRM, ocupa vaga de equipe. Recepção e
        financeiro são logins de equipe. Consultório inclui um médico e até{' '}
        {PROPOSED_OFFER.consultorioIncludedStaffLogins} logins de equipe. Clínica começa com dois
        médicos, inclui até {PROPOSED_OFFER.clinicaIncludedStaffLogins} logins de equipe e propõe R${' '}
        {PROPOSED_OFFER.additionalProfessionalMonthly}
        {'/mês por médico adicional, até cinco médicos no total.'} A compra de médicos adicionais
        ainda não está disponível no cadastro.
      </p>
      <p className="text-fg-muted">
        Nos dois planos habilitados no DEV, o teste dura {PROPOSED_OFFER.proposedTrialDays} dias
        desde a criação da conta, sem reiniciar após o checkout. A opção anual e a franquia mensal
        de conversas de IA ainda não estão disponíveis para contratação.
      </p>
    </main>
  );
}
