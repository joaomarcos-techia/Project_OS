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
        Adicionais propostos: R$ {PROPOSED_OFFER.additionalProfessionalMonthly}/mês por profissional
        com agenda e R$ {PROPOSED_OFFER.additionalStaffMonthly}/mês por login de equipe. A proposta
        inclui {PROPOSED_OFFER.consultorioIncludedStaffLogins} login de equipe no Consultório e{' '}
        {PROPOSED_OFFER.clinicaIncludedStaffLogins} na Clínica. A compra de logins ainda não está
        disponível.
      </p>
      <p className="text-fg-muted">
        A proposta inclui teste de {PROPOSED_OFFER.proposedTrialDays} dias a partir da conexão do
        WhatsApp ou do primeiro agendamento pela IA. Essa regra ainda não está implementada no
        cadastro atual.
      </p>
    </main>
  );
}
