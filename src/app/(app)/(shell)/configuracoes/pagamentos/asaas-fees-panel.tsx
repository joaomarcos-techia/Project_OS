'use client';

import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AsaasAccountFees } from '@/contexts/payments';

import { getPaymentAccountFeesAction } from './actions';

const money = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function formatFee(value: number | null, suffix: string): string {
  return value === null ? 'Não informada pelo Asaas' : `${money(value)} ${suffix}`;
}

function percent(value: number | null): string {
  return value === null ? 'não informado' : `${value.toLocaleString('pt-BR')}%`;
}

function expiration(value: string | null): string {
  const date = value?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return '';
  const [year, month, day] = date.split('-');
  return ` (validade informada: ${day}/${month}/${year})`;
}

export function AsaasFeesPanel({ hasApiKey }: { hasApiKey: boolean }) {
  const [fees, setFees] = useState<AsaasAccountFees | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPaymentAccountFeesAction();
      if (result.ok) setFees(result.data);
      else setError(result.message);
    } catch {
      setError('Não foi possível consultar as tarifas agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasApiKey) void refresh();
  }, [hasApiKey, refresh]);

  if (!hasApiKey) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarifas da sua conta Asaas</CardTitle>
        <CardDescription>
          Consultadas automaticamente na conta conectada. Valores promocionais e condições
          comerciais podem mudar. O custo efetivo de cada cobrança é conciliado após o pagamento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {fees ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-(--r-md) border border-border p-4">
              <p className="font-medium">PIX</p>
              <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
                Tarifa padrão: {formatFee(fees.pix.regular, 'por recebimento')}.
              </p>
              {fees.pix.discounted !== null ? (
                <p className="text-(length:--fs-sm) text-fg-muted">
                  Condição reduzida informada: {money(fees.pix.discounted)}
                  {expiration(fees.pix.discountExpiration)}.
                </p>
              ) : null}
            </div>
            <div className="rounded-(--r-md) border border-border p-4">
              <p className="font-medium">Cartão de crédito à vista</p>
              <p className="mt-1 text-(length:--fs-sm) text-fg-muted">
                Percentual: {percent(fees.creditCard.oneInstallmentPercentage)}; operação:{' '}
                {formatFee(fees.creditCard.operationValue, 'por cobrança')}.
              </p>
              {fees.creditCard.hasValidDiscount &&
              fees.creditCard.discountedOneInstallmentPercentage !== null ? (
                <p className="text-(length:--fs-sm) text-fg-muted">
                  Percentual promocional informado:{' '}
                  {percent(fees.creditCard.discountedOneInstallmentPercentage)}
                  {expiration(fees.creditCard.discountExpiration)}.
                </p>
              ) : null}
            </div>
          </div>
        ) : loading ? (
          <p>Consultando tarifas no Asaas…</p>
        ) : !error ? (
          <p>As tarifas desta conta ainda não estão disponíveis. Atualize para tentar novamente.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Consultando…' : 'Atualizar tarifas'}
          </Button>
        </div>
        <p className="text-(length:--fs-sm) text-fg-muted">
          Essas tarifas são custo da clínica. O preço ao paciente não muda automaticamente e o
          repasse segue a base configurada abaixo.
        </p>
      </CardContent>
    </Card>
  );
}
