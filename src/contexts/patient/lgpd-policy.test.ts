import { describe, expect, it } from 'vitest';

import {
  LGPD_RESPONSE_SLA_DAYS,
  canNotifyLgpdRequester,
  canProcessLgpdRequest,
  isLgpdRequestOverdue,
} from './lgpd-policy';

describe('LGPD operational policy', () => {
  it('usa o SLA legal de 15 dias para resposta completa', () => {
    expect(LGPD_RESPONSE_SLA_DAYS).toBe(15);
  });

  it('alerta pedido ativo vencido e sem comunicacao ao titular', () => {
    const now = new Date('2026-07-24T12:00:00Z');
    expect(
      isLgpdRequestOverdue({
        status: 'processing',
        dueAt: new Date('2026-07-23T12:00:00Z'),
        requesterNotifiedAt: null,
        now,
      }),
    ).toBe(true);
    expect(
      isLgpdRequestOverdue({
        status: 'processing',
        dueAt: new Date('2026-07-23T12:00:00Z'),
        requesterNotifiedAt: new Date('2026-07-22T12:00:00Z'),
        now,
      }),
    ).toBe(false);
  });

  it('so processa pendente/falha e registra notificacao depois do inicio', () => {
    expect(canProcessLgpdRequest('pending')).toBe(true);
    expect(canProcessLgpdRequest('failed')).toBe(true);
    expect(canProcessLgpdRequest('processing')).toBe(false);
    expect(canNotifyLgpdRequester('pending')).toBe(false);
    expect(canNotifyLgpdRequester('completed')).toBe(true);
  });
});
