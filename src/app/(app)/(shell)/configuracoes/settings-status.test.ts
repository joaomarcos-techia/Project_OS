import { describe, expect, it } from 'vitest';

import { accountSecurityStatus, channelStatus, subscriptionStatus } from './settings-status';

describe('status do hub de configurações', () => {
  it('separa canal conectado, canal quebrado e ausência de canal', () => {
    expect(channelStatus({ connected: true, degraded: false, hasActiveNumber: true })).toEqual({
      tone: 'green',
      label: 'Conectado',
    });
    // META-001: número ativo que não entrega NÃO pode aparecer como conectado.
    expect(channelStatus({ connected: false, degraded: true, hasActiveNumber: true })).toEqual({
      tone: 'red',
      label: 'Não está recebendo',
    });
    expect(channelStatus({ connected: false, degraded: false, hasActiveNumber: false })).toEqual({
      tone: 'gray',
      label: 'Não conectado',
    });
  });

  it('cobre os quatro estados do enum de cobrança e omite o que não existe', () => {
    expect(subscriptionStatus('active')?.tone).toBe('green');
    expect(subscriptionStatus('trial')?.label).toBe('Em teste');
    expect(subscriptionStatus('past_due')?.tone).toBe('amber');
    expect(subscriptionStatus('cancelled')?.tone).toBe('gray');
    expect(subscriptionStatus(null)).toBeNull();
  });

  it('distingue 2FA ativo, recomendado e simplesmente desligado', () => {
    expect(accountSecurityStatus({ enrolled: true, recommended: true }).label).toBe('2FA ativo');
    expect(accountSecurityStatus({ enrolled: false, recommended: true })).toEqual({
      tone: 'amber',
      label: '2FA recomendado',
    });
    expect(accountSecurityStatus({ enrolled: false, recommended: false })).toEqual({
      tone: 'gray',
      label: '2FA inativo',
    });
  });
});
