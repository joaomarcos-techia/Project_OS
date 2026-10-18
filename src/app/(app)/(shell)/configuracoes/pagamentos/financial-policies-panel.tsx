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
import type { ProcedureSummary } from '@/contexts/scheduling';
import { uuidv4 } from '@/lib/ui/uuid';

import {
  removeProfessionalPayoutRuleAction,
  saveProfessionalPayoutPolicyAction,
  saveProfessionalPayoutRuleAction,
} from './actions';

interface Props {
  payoutPolicy: ProfessionalPayoutPolicyDTO;
  payoutRules: ProfessionalPayoutRuleDTO[];
  professionals: Array<{ id: string; name: string }>;
  procedures: ProcedureSummary[];
}

const money = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function FinancialPoliciesPanel(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payoutBasis, setPayoutBasis] = useState(props.payoutPolicy.basis);
  const [professionalId, setProfessionalId] = useState(props.professionals[0]?.id ?? '');
  const [payoutProcedureId, setPayoutProcedureId] = useState('');
  const [ruleKind, setRuleKind] = useState<'percentage' | 'fixed'>('percentage');
  const [ruleValue, setRuleValue] = useState('50');
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
          <CardTitle>Como configurar preços, taxas e repasse</CardTitle>
          <CardDescription>
            O preço cobrado, a tarifa do Asaas e o valor devido ao profissional são três valores
            diferentes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-(--r-md) border border-border p-4">
            <p className="font-medium">1. Defina o preço ao paciente</p>
            <p className="mt-2 text-(length:--fs-sm) text-fg-muted">
              Cadastre o preço em{' '}
              <a href="/configuracoes/procedimentos" className="font-medium text-primary underline">
                Configurações → Procedimentos
              </a>
              . Esse é o valor cobrado do paciente, independentemente de ele escolher Pix ou cartão
              no Checkout.
            </p>
          </div>
          <div className="rounded-(--r-md) border border-border p-4">
            <p className="font-medium">2. Confira a tarifa real</p>
            <p className="mt-2 text-(length:--fs-sm) text-fg-muted">
              A tarifa não é cadastrada aqui nem somada automaticamente ao preço. Após o pagamento,
              o Asaas informa o valor líquido; o Qoro registra a diferença como despesa da clínica.
              Antes desse retorno, a tarifa fica pendente.
            </p>
          </div>
          <div className="rounded-(--r-md) border border-border p-4">
            <p className="font-medium">3. Escolha o repasse</p>
            <p className="mt-2 text-(length:--fs-sm) text-fg-muted">
              Selecione a base bruta ou líquida e cadastre uma regra para o médico. Sem regra, não
              há repasse automático. A base líquida aguarda o valor real do Asaas.
            </p>
          </div>
          <p className="text-(length:--fs-sm) text-fg-muted md:col-span-3">
            Exemplo: consulta de <span className="tabular-nums">R$ 150,00</span>, tarifa real de{' '}
            <span className="tabular-nums">R$ 5,00</span> e regra de 50%. O paciente paga{' '}
            <span className="tabular-nums">R$ 150,00</span>; o repasse é{' '}
            <span className="tabular-nums">R$ 75,00</span> sobre o bruto ou{' '}
            <span className="tabular-nums">R$ 72,50</span> sobre o líquido. Os valores de tarifa
            neste exemplo são ilustrativos.
          </p>
        </CardContent>
      </Card>
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

          <section>
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

          <p className="text-(length:--fs-sm) text-fg-muted">
            O preço de um agendamento já criado não muda. A base e a regra de repasse são
            selecionadas pela data agendada do atendimento e ficam registradas quando o repasse é
            calculado.
          </p>

          <Alert variant="info">
            A antecipação é uma despesa financeira da clínica e não é descontada automaticamente do
            paciente ou do profissional.
          </Alert>
        </CardContent>
      </Card>

      <Card id="regras-de-repasse">
        <CardHeader>
          <CardTitle>Regras por profissional</CardTitle>
          <CardDescription>
            Sem uma regra, nenhum repasse é criado. Proprietários não aparecem nesta lista. Regras
            novas ou encerradas não recalculam atendimentos anteriores.
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
    </>
  );
}
