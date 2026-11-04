// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEPOSIT_POLICY_OFF } from '@/contexts/payments/policy';
import { EMPTY_PAYMENT_ACCOUNT } from '@/contexts/payments/types';
import { PaymentReadiness } from './payment-readiness';

afterEach(cleanup);

describe('prontidão da cobrança automática', () => {
  it('distingue pendências de configuração de uma falha do gateway', () => {
    render(
      <PaymentReadiness
        account={EMPTY_PAYMENT_ACCOUNT}
        policy={{ ...DEPOSIT_POLICY_OFF, updatedAt: null }}
      />,
    );
    expect(screen.getAllByText('Pendente')).toHaveLength(4);
    expect(
      screen.getByText(/A passagem do horário da consulta não a conclui automaticamente/),
    ).toBeTruthy();
    expect(screen.getByText(/Cadastr(ar|ar um) paciente não concede/)).toBeTruthy();
  });

  it('não promete envio só porque a conta e a política estão configuradas', () => {
    render(
      <PaymentReadiness
        account={{
          ...EMPTY_PAYMENT_ACCOUNT,
          hasApiKey: true,
          acceptNewCharges: true,
          webhookConfigured: true,
        }}
        policy={{ ...DEPOSIT_POLICY_OFF, enabled: true, updatedAt: null }}
      />,
    );
    expect(screen.getAllByText('Configurado')).toHaveLength(4);
    expect(screen.getByText(/consentimento específico/)).toBeTruthy();
    expect(screen.getByText(/política de sinal também habilita a cobrança do saldo/)).toBeTruthy();
  });
});
