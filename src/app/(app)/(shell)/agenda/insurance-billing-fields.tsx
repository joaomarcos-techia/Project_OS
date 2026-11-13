'use client';

/**
 * Forma de atendimento no "Novo atendimento" (ADR-072, P4.4; R44): particular ou
 * convênio, com operadora, plano, carteirinha e tipo de guia. Só aparece quando o Qoro
 * habilitou Convênios na clínica; sem isso o formulário fica exatamente como era.
 *
 * A escolha é só de ids: o servidor confere tudo de novo (operadora ativa, plano da
 * operadora, carteirinha do paciente) antes de criar, e o banco recusa convênio sem o
 * módulo habilitado ou sem assinatura ativa. A carteirinha aparece mascarada.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { listSchedulingCardsAction } from '@/contexts/health-insurance/config-actions';
import type { SchedulingCard, SchedulingInsuranceOptions } from '@/contexts/health-insurance/config-queries';

export interface BillingValue {
  mode: 'particular' | 'convenio';
  insurerId: string;
  planId: string;
  /** '' = sem carteirinha (fica pendente para a recepção, nunca vira cobrança). */
  membershipId: string;
  guideType: 'consulta' | 'sp_sadt';
}

export function emptyBilling(): BillingValue {
  return { mode: 'particular', insurerId: '', planId: '', membershipId: '', guideType: 'consulta' };
}

export function InsuranceBillingFields({
  options,
  patientId,
  value,
  onChange,
}: {
  options: SchedulingInsuranceOptions | null | undefined;
  patientId: string | null;
  value: BillingValue;
  onChange: (next: BillingValue) => void;
}) {
  const [cards, setCards] = useState<SchedulingCard[]>([]);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const isConvenio = value.mode === 'convenio';

  useEffect(() => {
    let alive = true;
    if (!isConvenio || !patientId) {
      setCards([]);
      return;
    }
    void listSchedulingCardsAction({ patientId }).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setCards(r.data);
        setCardsError(null);
      } else {
        setCards([]);
        setCardsError(r.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [isConvenio, patientId]);

  if (!options?.enabled) return null;
  const insurer = options.insurers.find((i) => i.id === value.insurerId) ?? null;
  const insurerCards = cards.filter((c) => c.insurerId === value.insurerId);

  const pickInsurer = (insurerId: string) => {
    const preferred = cards.find((c) => c.insurerId === insurerId && c.preferred) ?? cards.find((c) => c.insurerId === insurerId);
    onChange({ ...value, insurerId, planId: preferred?.planId ?? '', membershipId: preferred?.id ?? '' });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="appointment-billing">
      <Field label="Forma de atendimento" group>
        <Segmented
          aria-label="Forma de atendimento"
          options={[
            { value: 'particular', label: 'Particular' },
            { value: 'convenio', label: 'Convênio' },
          ]}
          value={value.mode}
          onValueChange={(mode) => onChange(mode === 'particular' ? emptyBilling() : { ...value, mode })}
        />
      </Field>
      {isConvenio ? (
        options.insurers.length === 0 ? (
          <Alert variant="warning">
            Nenhuma operadora ativa. Cadastre e ative a operadora em{' '}
            <Link href="/convenios/configuracao" className="underline">
              Convênios › Configuração
            </Link>
            .
          </Alert>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Operadora" htmlFor="appointment-insurer" required>
                <Select id="appointment-insurer" value={value.insurerId} onChange={(e) => pickInsurer(e.target.value)}>
                  <option value="">Selecione…</option>
                  {options.insurers.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Plano (opcional)" htmlFor="appointment-plan">
                <Select
                  id="appointment-plan"
                  value={value.planId}
                  disabled={!insurer || insurer.plans.length === 0}
                  onChange={(e) => onChange({ ...value, planId: e.target.value })}
                >
                  <option value="">{insurer && insurer.plans.length === 0 ? 'Operadora sem planos cadastrados' : 'Sem plano específico'}</option>
                  {(insurer?.plans ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Carteirinha"
                htmlFor="appointment-card"
                hint={!patientId ? 'Escolha o paciente para ver as carteirinhas.' : insurer && insurerCards.length === 0 ? 'O paciente não tem carteirinha ativa desta operadora.' : undefined}
              >
                <Select
                  id="appointment-card"
                  value={value.membershipId}
                  disabled={!insurer || !patientId}
                  onChange={(e) => onChange({ ...value, membershipId: e.target.value })}
                >
                  <option value="">Informar depois (fica pendente)</option>
                  {insurerCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`final ${c.last4}${c.validUntil ? ` · válida até ${c.validUntil.split('-').reverse().join('/')}` : ''}${c.preferred ? ' · preferencial' : ''}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipo de guia" htmlFor="appointment-guide-type">
                <Select
                  id="appointment-guide-type"
                  value={value.guideType}
                  onChange={(e) => onChange({ ...value, guideType: e.target.value === 'sp_sadt' ? 'sp_sadt' : 'consulta' })}
                >
                  <option value="consulta">Consulta</option>
                  <option value="sp_sadt">SP/SADT (sessões, terapias, exames)</option>
                </Select>
              </Field>
            </div>
            {cardsError ? <Alert variant="warning">{cardsError}</Alert> : null}
            <p className="-mt-1 text-(length:--fs-xs) text-fg-muted">
              Atendimento de convênio: a operadora paga pela guia. O paciente não recebe cobrança da consulta; só a
              coparticipação prevista no contrato, depois de conferida e confirmada.
              {patientId ? (
                <>
                  {' '}
                  <Link href={`/convenios/carteirinhas?paciente=${patientId}`} className="text-link underline">
                    Cadastrar carteirinha
                  </Link>
                </>
              ) : null}
            </p>
          </>
        )
      ) : null}
    </div>
  );
}
