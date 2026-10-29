'use client';

import { useState } from 'react';

import { PROPOSED_OFFER, quoteProposedOffer } from '@/contexts/billing/proposed-offer';

const money = (amount: number) =>
  amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ProposalCalculator() {
  const [count, setCount] = useState('2');
  const [staffCount, setStaffCount] = useState('1');
  const quote =
    count.trim() && staffCount.trim()
      ? quoteProposedOffer(Number(count), Number(staffCount))
      : null;

  return (
    <div className="space-y-5 rounded-(--r-lg) border border-border bg-surface p-6">
      <label htmlFor="proposed-professionals" className="block font-medium">
        Médicos que atendem em agenda clínica
      </label>
      <input
        id="proposed-professionals"
        type="number"
        min="1"
        max={PROPOSED_OFFER.maxSelfServiceProfessionals}
        step="1"
        value={count}
        onChange={(event) => setCount(event.currentTarget.value)}
        className="input w-28"
      />
      <label htmlFor="proposed-staff" className="block font-medium">
        Logins de equipe: recepção, gestão e financeiro
      </label>
      <input
        id="proposed-staff"
        type="number"
        min="0"
        step="1"
        value={staffCount}
        onChange={(event) => setStaffCount(event.currentTarget.value)}
        className="input w-28"
      />
      {quote ? (
        <div aria-live="polite" className="space-y-2">
          <p className="font-display text-2xl font-semibold">
            {quote.plan === 'consultorio' ? 'Consultório' : 'Clínica'} · {money(quote.monthly)}/mês
          </p>
          <p>Contratação mensal no cartão. A modalidade anual não está disponível nesta etapa.</p>
          <p>
            {quote.plan === 'consultorio'
              ? `Até ${PROPOSED_OFFER.consultorioIncludedStaffLogins} logins de equipe incluídos.`
              : `Até ${PROPOSED_OFFER.clinicaIncludedStaffLogins} logins de equipe incluídos.`}
          </p>
          <p>Franquia proposta: {quote.conversationsIncluded} conversas de IA por mês.</p>
        </div>
      ) : (
        <p role="alert">
          Informe de 1 a {PROPOSED_OFFER.maxSelfServiceProfessionals} médicos e uma quantidade
          inteira não negativa de logins de equipe. Consultório e Clínica incluem até{' '}
          {PROPOSED_OFFER.clinicaIncludedStaffLogins} logins de equipe; fora desses limites a
          proposta não apresenta uma cotação automática.
        </p>
      )}
    </div>
  );
}
