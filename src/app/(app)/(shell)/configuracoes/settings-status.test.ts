import { describe, expect, it } from 'vitest';

import { channelStatus, subscriptionStatus } from './settings-status';

describe('status dos cards de configuração', () => {
  it('separa canal conectado, canal quebrado e ausência de canal', () => {
    expect(channelStatus({ connected: true, degraded: false })).toEqual({
      tone: 'green',
      label: 'Conectado',
    });
    // META-001: número ativo que não entrega NÃO pode aparecer como conectado.
    expect(channelStatus({ connected: false, degraded: true })).toEqual({
      tone: 'red',
      label: 'Não está recebendo',
    });
    expect(channelStatus({ connected: false, degraded: false })).toEqual({
      tone: 'gray',
      label: 'Não conectado',
    });
  });

  it('cobre os quatro estados de cobrança e omite o que não existe', () => {
    expect(subscriptionStatus('active')).toEqual({ tone: 'green', label: 'Ativa' });
    expect(subscriptionStatus('trial')?.label).toBe('Em teste');
    // past_due é atenção (âmbar), não falha (vermelho): o dunning ainda corre.
    expect(subscriptionStatus('past_due')).toEqual({ tone: 'amber', label: 'Pagamento pendente' });
    expect(subscriptionStatus('cancelled')).toEqual({ tone: 'gray', label: 'Cancelada' });
    // Clínica sem assinatura provisionada — sem selo, sem estado inventado.
    expect(subscriptionStatus(null)).toBeNull();
  });
});
