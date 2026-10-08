'use client';

/**
 * Política de sinal da clínica (ADR-049 1.2).
 *
 * Duas decisões de UI que são, na verdade, decisões de produto:
 *
 *  1. **Ligar o sinal sem conta conectada é avisado, não bloqueado.** A clínica
 *     pode querer deixar a regra pronta antes de conectar o Asaas. Mas ligar e
 *     achar que está cobrando, sem conta, seria a pior falha silenciosa possível —
 *     então o aviso é explícito e permanente enquanto durar o estado.
 *  2. **O texto mostra o efeito em dinheiro**, não só o percentual: "50% de uma
 *     consulta de R$ 300 = R$ 150". Percentual isolado é abstrato; quem configura
 *     precisa enxergar o que o paciente vai ver no link.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { DepositPolicyDTO } from '@/contexts/payments';

import { saveDepositPolicyAction } from './actions';

interface Props {
  policy: DepositPolicyDTO;
  /** Sem conta conectada a política não consegue cobrar ninguém. */
  hasAccount: boolean;
}

/** Exemplo concreto para o operador enxergar o efeito do percentual. */
const EXEMPLO_CONSULTA = 300;

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function DepositPolicyForm({ policy, hasAccount }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [percent, setPercent] = useState(String(policy.percent));
  const [windowHours, setWindowHours] = useState(String(policy.cancellationWindowHours));
  const [firstVisit, setFirstVisit] = useState(policy.appliesToFirstVisit);
  const [isReturn, setIsReturn] = useState(policy.appliesToReturn);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const percentNumber = Number(percent);
  const exemplo =
    Number.isFinite(percentNumber) && percentNumber > 0
      ? (EXEMPLO_CONSULTA * Math.min(percentNumber, 100)) / 100
      : 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveDepositPolicyAction({
        enabled,
        percent: Number(percent),
        cancellationWindowHours: Number(windowHours),
        appliesToFirstVisit: firstVisit,
        appliesToReturn: isReturn,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(
        result.data.enabled
          ? 'Política salva. O sinal passa a valer para os próximos agendamentos.'
          : 'Política salva. O sinal está desligado.',
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sinal do agendamento</CardTitle>
        <CardDescription>
          Cobrar uma parte do valor no momento de agendar. Quem paga, comparece — e se faltar, o
          valor já está no caixa da clínica.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        {enabled && !hasAccount ? (
          <Alert variant="warning" title="Falta conectar a conta Asaas">
            Com o sinal ligado e sem conta conectada, nenhuma cobrança é gerada. Conecte a conta
            acima para a regra valer de verdade.
          </Alert>
        ) : null}

        {/* 08/10/2026 — o modelo de pagamento, dito uma vez e no lugar da decisão. */}
        <div className="rounded-(--r-md) border border-border bg-surface-2 p-3 text-(length:--fs-sm) text-fg-muted">
          <p className="font-medium text-fg">Como o paciente paga</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            <li>
              Com o sinal ligado, o horário só é confirmado depois que o paciente paga o sinal pelo
              link de pagamento que chega no WhatsApp. Sem o pagamento no prazo (até 24 horas), o
              horário é liberado.
            </li>
            <li>
              O restante pode ser pago na clínica, inclusive em dinheiro. No Caixa, use “Pagou o
              restante em dinheiro”: se o link do restante já tiver sido enviado, ele deixa de valer.
            </li>
            <li>
              Com o sinal desligado, o agendamento não exige pagamento antecipado. No Caixa, use
              “Pagou em dinheiro” quando o paciente pagar na recepção.
            </li>
          </ul>
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <label className="flex items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="font-medium">Cobrar sinal ao agendar</span>
              <span className="text-(length:--fs-sm) text-fg-muted">
                Desligado, nada muda: o agendamento segue como hoje.
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={pending} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Percentual do sinal"
              htmlFor="deposit-percent"
              hint={
                exemplo > 0
                  ? `Consulta de ${formatBRL(EXEMPLO_CONSULTA)} → sinal de ${formatBRL(exemplo)}.`
                  : 'Entre 1% e 100% do valor do procedimento.'
              }
            >
              <Input
                id="deposit-percent"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={percent}
                disabled={pending || !enabled}
                onChange={(e) => setPercent(e.target.value)}
              />
            </Field>

            <Field
              label="Antecedência para estorno (horas)"
              htmlFor="deposit-window"
              hint="Cancelou com essa antecedência, o sinal volta. Depois disso, fica com a clínica."
            >
              <Input
                id="deposit-window"
                type="number"
                inputMode="numeric"
                min={0}
                max={720}
                value={windowHours}
                disabled={pending || !enabled}
                onChange={(e) => setWindowHours(e.target.value)}
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={pending || !enabled}>
            <legend className="mb-1 font-medium">Quando cobrar</legend>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={firstVisit}
                onCheckedChange={(v) => setFirstVisit(v === true)}
                disabled={pending || !enabled}
              />
              <span>Primeira consulta</span>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={isReturn}
                onCheckedChange={(v) => setIsReturn(v === true)}
                disabled={pending || !enabled}
              />
              <span>Retorno</span>
            </label>
          </fieldset>

          <div>
            <Button type="submit" disabled={pending}>
              Salvar política
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
