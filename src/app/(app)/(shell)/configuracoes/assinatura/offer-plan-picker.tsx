'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

/** Plano da oferta por profissional, como a visão da assinatura o entrega. */
export type OfferPlan = {
  id: string;
  name: string;
  priceAmount: string;
  seats: { professionals: number; staff: number | null };
  direction: -1 | 0 | 1;
  teamFits: boolean;
};

function formatMoney(amount: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(amount),
  );
}

function staffText(staff: number | null): string {
  return staff === null
    ? 'equipe administrativa ilimitada'
    : `até ${staff} usuário${staff === 1 ? '' : 's'} de equipe`;
}

/**
 * Consultório e Clínica (ADR-067). Na Clínica, cada quantidade de profissionais
 * é um plano: incluir profissional é upgrade (cobra hoje a diferença
 * proporcional e só libera a vaga depois que o Asaas confirma o novo valor
 * recorrente); remover é downgrade, no fim do ciclo, se a equipe couber.
 * Direção e encaixe vêm do servidor — a tela não recalcula regra comercial.
 */
export function OfferPlanPicker({
  plans,
  currentPlanId,
  locked,
  submitting,
  formAction,
  keys,
}: {
  plans: OfferPlan[];
  currentPlanId: string;
  /** Assinatura fora de `active` ou com alteração em andamento. */
  locked: boolean;
  submitting: boolean;
  formAction: (formData: FormData) => void;
  keys: Map<string, string>;
}) {
  const consultorio = plans.find((plan) => plan.seats.professionals === 1);
  const clinica = plans
    .filter((plan) => plan.seats.professionals >= 2)
    .sort((a, b) => a.seats.professionals - b.seats.professionals);
  const currentClinica = clinica.find((plan) => plan.id === currentPlanId);
  const [clinicaPlanId, setClinicaPlanId] = useState(currentClinica?.id ?? clinica[0]?.id ?? '');
  const selectedClinica = clinica.find((plan) => plan.id === clinicaPlanId);

  return (
    <div className="grid gap-(--sp-4) lg:grid-cols-2">
      {consultorio ? (
        <PlanCard
          plan={consultorio}
          title="Consultório"
          description={`1 profissional de saúde e ${staffText(consultorio.seats.staff)}.`}
          isCurrent={consultorio.id === currentPlanId}
          locked={locked}
          submitting={submitting}
          formAction={formAction}
          idempotencyKey={keys.get(consultorio.id) ?? ''}
        />
      ) : null}
      {selectedClinica ? (
        <PlanCard
          plan={selectedClinica}
          title="Clínica"
          description={
            selectedClinica.seats.staff === null
              ? 'Equipe administrativa ilimitada: recepção, gestão e financeiro não ocupam vaga paga.'
              : `Profissionais escolhidos abaixo e ${staffText(selectedClinica.seats.staff)}.`
          }
          isCurrent={selectedClinica.id === currentPlanId}
          locked={locked}
          submitting={submitting}
          formAction={formAction}
          idempotencyKey={keys.get(selectedClinica.id) ?? ''}
        >
          <Field
            label="Profissionais de saúde"
            htmlFor="subscription-professionals"
            hint="Conta quem tem agenda própria e atende."
          >
            <Select
              id="subscription-professionals"
              value={clinicaPlanId}
              disabled={submitting}
              onChange={(event) => setClinicaPlanId(event.target.value)}
            >
              {clinica.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.seats.professionals} profissionais — {formatMoney(plan.priceAmount)}/mês
                  {plan.id === currentPlanId ? ' (atual)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </PlanCard>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  title,
  description,
  isCurrent,
  locked,
  submitting,
  formAction,
  idempotencyKey,
  children,
}: {
  plan: OfferPlan;
  title: string;
  description: string;
  isCurrent: boolean;
  locked: boolean;
  submitting: boolean;
  formAction: (formData: FormData) => void;
  idempotencyKey: string;
  children?: ReactNode;
}) {
  const isDowngrade = plan.direction < 0;
  const blockedByTeam = isDowngrade && !plan.teamFits;
  const label = isCurrent
    ? 'Plano atual'
    : blockedByTeam
      ? 'A equipe ativa não cabe neste plano'
      : isDowngrade
        ? 'Agendar para o fim do ciclo'
        : 'Contratar agora';
  return (
    <Card className={isCurrent ? 'border-primary shadow-sm' : undefined}>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-(length:--fs-lg) font-semibold">{title}</h3>
            <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
              {formatMoney(plan.priceAmount)} por mês
            </p>
          </div>
          {isCurrent ? <Badge tone="blue">Atual</Badge> : null}
        </div>
        <p className="text-(length:--fs-sm) text-fg-muted">{description}</p>
        {children}
        <div className="flex-1" />
        <form action={formAction}>
          <input type="hidden" name="targetPlanId" value={plan.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Button
            type="submit"
            className="w-full"
            variant={isDowngrade ? 'secondary' : 'primary'}
            disabled={locked || isCurrent || submitting || blockedByTeam}
            loading={submitting}
          >
            {label}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
