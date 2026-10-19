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
        Esta página permite revisar a nova tabela. O cadastro e o checkout ainda cobram os planos
        vigentes; nenhum valor abaixo está ativo para contratação.
      </p>
      <ProposalCalculator />
      <p className="text-fg-muted">
        Na proposta, o papel médico ocupa vaga médica mesmo antes de cadastrar CRM; titular ou
        gestor com CRM também ocupa vaga médica e, sem CRM, ocupa vaga de equipe. Recepção e
        financeiro são logins de equipe. Consultório inclui um médico e até{' '}
        {PROPOSED_OFFER.consultorioIncludedStaffLogins} logins de equipe. Clínica começa com dois
        médicos, inclui até {PROPOSED_OFFER.clinicaIncludedStaffLogins} logins de equipe e propõe R${' '}
        {PROPOSED_OFFER.additionalProfessionalMonthly}
        {'/mês por médico adicional, até cinco médicos no total.'} O cadastro atual ainda limita
        todos os logins juntos. A contratação dessa oferta ainda não está disponível.
      </p>
      <p className="text-fg-muted">
        A proposta inclui teste de {PROPOSED_OFFER.proposedTrialDays} dias a partir da conexão do
        WhatsApp ou do primeiro agendamento pela IA. Essa regra ainda não está implementada no
        cadastro atual.
      </p>
    </main>
  );
}
