'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionCardGroup } from '@/components/ui/option-card-group';
import { Select } from '@/components/ui/select';
import type { ProfessionalPayoutPolicyDTO, ProfessionalPayoutRuleDTO } from '@/contexts/financial';
import type { PaymentPricingPolicyDTO, ProcedurePaymentPriceDTO } from '@/contexts/payments';
import type { ProcedureSummary } from '@/contexts/scheduling';
import { uuidv4 } from '@/lib/ui/uuid';

import {
  removeProcedurePaymentPriceAction,
  removeProfessionalPayoutRuleAction,
  savePaymentPricingPolicyAction,
  saveProcedurePaymentPriceAction,
  saveProfessionalPayoutPolicyAction,
  saveProfessionalPayoutRuleAction,
} from './actions';

interface Props {
  pricingPolicy: PaymentPricingPolicyDTO;
  methodPrices: ProcedurePaymentPriceDTO[];
  payoutPolicy: ProfessionalPayoutPolicyDTO;
  payoutRules: ProfessionalPayoutRuleDTO[];
  professionals: Array<{ id: string; name: string }>;
  procedures: ProcedureSummary[];
}

const money = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const methodLabel = (method: ProcedurePaymentPriceDTO['paymentMethod']): string =>
  ({ pix: 'PIX', cash: 'Dinheiro', credit_card: 'Cartão' })[method];

export function FinancialPoliciesPanel(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payoutBasis, setPayoutBasis] = useState(props.payoutPolicy.basis);
  const [pricingMode, setPricingMode] = useState(props.pricingPolicy.mode);
  const [professionalId, setProfessionalId] = useState(props.professionals[0]?.id ?? '');
  const [payoutProcedureId, setPayoutProcedureId] = useState('');
  const [ruleKind, setRuleKind] = useState<'percentage' | 'fixed'>('percentage');
  const [ruleValue, setRuleValue] = useState('50');
  const [priceProcedureId, setPriceProcedureId] = useState(props.procedures[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | 'credit_card'>('pix');
  const [installments, setInstallments] = useState('1');
  const [grossAmount, setGrossAmount] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'danger'; text: string } | null>(
    null,
  );

  const professionalNames = useMemo(
    () => new Map(props.professionals.map((item) => [item.id, item.name])),
    [props.professionals],
  );
  const procedureNames = useMemo(
    () => new Map(props.procedures.map((item) => [item.id, item.descricao])),
    [props.procedures],
  );

  function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setFeedback({ kind: 'danger', text: result.message ?? 'Não foi possível salvar.' });
        return;
      }
      setFeedback({ kind: 'success', text: success });
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Política financeira</CardTitle>
          <CardDescription>
            Separe o preço do atendimento, o custo do meio de pagamento e a regra de repasse.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {feedback ? <Alert variant={feedback.kind}>{feedback.text}</Alert> : null}
          <Alert variant="info">
            Taxas do meio de pagamento são despesas financeiras da clínica. Elas não alteram
            automaticamente o valor do atendimento nem o repasse do profissional.
          </Alert>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="font-medium">Política de preço</h3>
                <p className="text-(length:--fs-sm) text-fg-muted">
                  Um preço diferente é uma decisão comercial explícita, nunca uma tarifa oculta.
                </p>
              </div>
              <OptionCardGroup
                name="pricing-policy"
                value={pricingMode}
                onValueChange={setPricingMode}
                disabled={pending}
                options={[
                  {
                    value: 'absorb_fees',
                    label: 'Absorver taxas',
                    description: 'Mantém o valor padrão do procedimento em todos os meios.',
                  },
                  {
                    value: 'payment_method_pricing',
                    label: 'Preço por meio de pagamento',
                    description: 'Usa somente os preços explícitos cadastrados abaixo.',
                  },
                ]}
              />
              <Button
                type="button"
                disabled={pending || pricingMode === props.pricingPolicy.mode}
                onClick={() =>
                  run(
                    () => savePaymentPricingPolicyAction({ mode: pricingMode }, uuidv4()),
                    'Política de preço salva.',
                  )
                }
              >
                Salvar política de preço
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <h3 className="font-medium">Base do repasse</h3>
                <p className="text-(length:--fs-sm) text-fg-muted">
                  Escolha se o repasse será calculado sobre o valor bruto da consulta ou sobre o
                  valor líquido recebido após as taxas do meio de pagamento.
                </p>
              </div>
              <OptionCardGroup
                name="payout-basis"
                value={payoutBasis}
                onValueChange={setPayoutBasis}
                disabled={pending}
                options={[
                  {
                    value: 'gross',
                    label: 'Valor bruto',
                    description: 'Padrão: a taxa da clínica não reduz o repasse.',
                  },
                  {
                    value: 'net',
                    label: 'Valor líquido',
                    description: 'Espera o valor real do Asaas antes de calcular.',
                  },
                ]}
              />
              <Button
                type="button"
                disabled={pending || payoutBasis === props.payoutPolicy.basis}
                onClick={() =>
                  run(
                    () => saveProfessionalPayoutPolicyAction({ basis: payoutBasis }, uuidv4()),
                    'Base de repasse salva para os próximos atendimentos.',
                  )
                }
              >
                Salvar base de repasse
              </Button>
            </div>
          </section>

          <Alert variant="info">
            A antecipação é uma despesa financeira da clínica e não é descontada automaticamente do
            paciente ou do profissional.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regras por profissional</CardTitle>
          <CardDescription>
            Sem uma regra, nenhum repasse é criado. Proprietários não aparecem nesta lista.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {props.professionals.length === 0 ? (
            <Alert variant="info">Não há profissionais repassáveis ativos nesta clínica.</Alert>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Profissional" htmlFor="payout-professional">
                <Select
                  id="payout-professional"
                  value={professionalId}
                  disabled={pending}
                  onChange={(event) => setProfessionalId(event.target.value)}
                >
                  {props.professionals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Procedimento"
                htmlFor="payout-procedure"
                hint="Opcional: vazio vale para todos."
              >
                <Select
                  id="payout-procedure"
                  value={payoutProcedureId}
                  disabled={pending}
                  onChange={(event) => setPayoutProcedureId(event.target.value)}
                >
                  <option value="">Todos os procedimentos</option>
                  {props.procedures.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.descricao}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Regra" htmlFor="payout-kind">
                <Select
                  id="payout-kind"
                  value={ruleKind}
                  disabled={pending}
                  onChange={(event) => setRuleKind(event.target.value as 'percentage' | 'fixed')}
                >
                  <option value="percentage">Percentual</option>
                  <option value="fixed">Valor fixo</option>
                </Select>
              </Field>
              <Field
                label={ruleKind === 'percentage' ? 'Percentual (%)' : 'Valor fixo (R$)'}
                htmlFor="payout-value"
              >
                <Input
                  id="payout-value"
                  type="number"
                  min={ruleKind === 'percentage' ? 0.0001 : 0}
                  max={ruleKind === 'percentage' ? 100 : 99_999_999.99}
                  step={ruleKind === 'percentage' ? 0.0001 : 0.01}
                  value={ruleValue}
                  disabled={pending}
                  onChange={(event) => setRuleValue(event.target.value)}
                />
              </Field>
            </div>
          )}
          {props.professionals.length > 0 ? (
            <Button
              type="button"
              className="self-start"
              disabled={pending || !professionalId || !ruleValue}
              onClick={() =>
                run(
                  () =>
                    saveProfessionalPayoutRuleAction(
                      {
                        professionalId,
                        procedureId: payoutProcedureId || null,
                        kind: ruleKind,
                        percentage: ruleKind === 'percentage' ? Number(ruleValue) : null,
                        fixedAmount: ruleKind === 'fixed' ? Number(ruleValue) : null,
                      },
                      uuidv4(),
                    ),
                  'Regra de repasse salva.',
                )
              }
            >
              Salvar regra
            </Button>
          ) : null}

          <div className="flex flex-col gap-2">
            {props.payoutRules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-wrap items-center gap-2 rounded-(--r-md) border border-border p-3"
              >
                <span className="font-medium">
                  {professionalNames.get(rule.professionalId) ?? 'Profissional'}
                </span>
                <Badge tone="gray">
                  {rule.procedureId
                    ? (procedureNames.get(rule.procedureId) ?? 'Procedimento')
                    : 'Todos os procedimentos'}
                </Badge>
                <span className="text-(length:--fs-sm) text-fg-muted tabular-nums">
                  {rule.kind === 'percentage'
                    ? `${rule.percentage}% da base`
                    : `${money(rule.fixedAmount ?? 0)} fixos`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => removeProfessionalPayoutRuleAction(rule.id, uuidv4()),
                      'Regra encerrada; históricos foram preservados.',
                    )
                  }
                >
                  Encerrar
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preços por meio de pagamento</CardTitle>
          <CardDescription>
            Cadastre o preço bruto que será apresentado ao paciente. O valor não é calculado a
            partir da tarifa do Asaas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Procedimento" htmlFor="price-procedure">
              <Select
                id="price-procedure"
                value={priceProcedureId}
                disabled={pending}
                onChange={(event) => setPriceProcedureId(event.target.value)}
              >
                {props.procedures.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.descricao}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Meio" htmlFor="price-method">
              <Select
                id="price-method"
                value={paymentMethod}
                disabled={pending}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as 'pix' | 'cash' | 'credit_card')
                }
              >
                <option value="pix">PIX</option>
                <option value="cash">Dinheiro</option>
                <option value="credit_card">Cartão</option>
              </Select>
            </Field>
            <Field label="Parcelas" htmlFor="price-installments">
              <Input
                id="price-installments"
                type="number"
                min={1}
                max={1}
                value={installments}
                disabled
                onChange={(event) => setInstallments(event.target.value)}
              />
              {paymentMethod === 'credit_card' ? (
                <p className="mt-1 text-(length:--fs-xs) text-fg-muted">
                  Checkout disponível somente para pagamento em 1x.
                </p>
              ) : null}
            </Field>
            <Field label="Preço bruto (R$)" htmlFor="price-gross">
              <Input
                id="price-gross"
                type="number"
                min={0.01}
                step={0.01}
                value={grossAmount}
                disabled={pending}
                onChange={(event) => setGrossAmount(event.target.value)}
              />
            </Field>
          </div>
          <Button
            type="button"
            className="self-start"
            disabled={pending || !priceProcedureId || !grossAmount}
            onClick={() =>
              run(
                () =>
                  saveProcedurePaymentPriceAction(
                    {
                      procedureId: priceProcedureId,
                      paymentMethod,
                      installmentCount:
                        paymentMethod === 'credit_card' ? Number(installments) : null,
                      grossAmount: Number(grossAmount),
                    },
                    uuidv4(),
                  ),
                'Preço por método salvo.',
              )
            }
          >
            Salvar preço
          </Button>

          <div className="flex flex-col gap-2">
            {props.methodPrices.map((price) => (
              <div
                key={price.id}
                className="flex flex-wrap items-center gap-2 rounded-(--r-md) border border-border p-3"
              >
                <span className="font-medium">
                  {procedureNames.get(price.procedureId) ?? 'Procedimento'}
                </span>
                <Badge tone="gray">
                  {methodLabel(price.paymentMethod)}
                  {price.installmentCount ? ` · ${price.installmentCount}x` : ''}
                </Badge>
                <span className="text-(length:--fs-sm) text-fg-muted tabular-nums">
                  {money(price.grossAmount)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => removeProcedurePaymentPriceAction(price.id, uuidv4()),
                      'Preço removido.',
                    )
                  }
                >
                  Remover
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
