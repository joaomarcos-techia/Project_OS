/**
 * P6.6 — alertas puros da autorização: senha vencendo (antes do vencimento, na data da clínica) e
 * sessões autorizadas acabando. A entrega (cron da P12.6) não é testada aqui; a chave do alerta é.
 */
import { describe, expect, it } from 'vitest';

import {
  alertKey,
  authorizationAlerts,
  DEFAULT_AUTHORIZATION_ALERT_POLICY,
  type AuthorizationAlertInput,
} from './authorization-alerts';

const TODAY = '2026-11-16';
const auth = (over: Partial<AuthorizationAlertInput> = {}): AuthorizationAlertInput => ({
  id: 'a1',
  status: 'authorized',
  passwordValidUntil: null,
  items: [{ quantityAuthorized: 10, quantityConsumed: 0 }],
  ...over,
});

describe('senha vencendo', () => {
  it('avisa do dia do vencimento até o limite da política, com os dias que faltam', () => {
    const rows = [
      auth({ id: 'hoje', passwordValidUntil: '2026-11-16' }),
      auth({ id: 'amanha', passwordValidUntil: '2026-11-17' }),
      auth({ id: 'tres', passwordValidUntil: '2026-11-19' }),
      auth({ id: 'quatro', passwordValidUntil: '2026-11-20' }),
    ];
    const alerts = authorizationAlerts(rows, TODAY);
    expect(alerts).toEqual([
      { kind: 'password_expiring', authorizationId: 'hoje', validUntil: '2026-11-16', daysLeft: 0 },
      { kind: 'password_expiring', authorizationId: 'amanha', validUntil: '2026-11-17', daysLeft: 1 },
      { kind: 'password_expiring', authorizationId: 'tres', validUntil: '2026-11-19', daysLeft: 3 },
    ]);
  });

  it('senha já vencida não é alerta (é estado "vencida"); sem validade informada também não', () => {
    expect(authorizationAlerts([auth({ passwordValidUntil: '2026-11-15' }), auth({ id: 'sem' })], TODAY)).toEqual([]);
  });

  it('atravessa o fim do mês e do ano pela data, não por texto', () => {
    expect(authorizationAlerts([auth({ passwordValidUntil: '2027-01-01' })], '2026-12-30')).toEqual([
      { kind: 'password_expiring', authorizationId: 'a1', validUntil: '2027-01-01', daysLeft: 2 },
    ]);
  });

  it('a política muda a janela; janela zero avisa só no dia', () => {
    const rows = [auth({ id: 'hoje', passwordValidUntil: TODAY }), auth({ id: 'amanha', passwordValidUntil: '2026-11-17' })];
    expect(authorizationAlerts(rows, TODAY, { ...DEFAULT_AUTHORIZATION_ALERT_POLICY, passwordDaysAhead: 0 }).map((a) => a.authorizationId)).toEqual(['hoje']);
  });
});

describe('sessões acabando', () => {
  it('avisa quando a autorização já usada fica com o saldo da política', () => {
    const alerts = authorizationAlerts([auth({ items: [{ quantityAuthorized: 10, quantityConsumed: 9 }] })], TODAY);
    expect(alerts).toEqual([{ kind: 'sessions_ending', authorizationId: 'a1', remaining: 1, authorized: 10 }]);
  });

  it('soma os itens concedidos e ignora o item negado (autorizado 0)', () => {
    const items = [
      { quantityAuthorized: 4, quantityConsumed: 4 },
      { quantityAuthorized: 2, quantityConsumed: 1 },
      { quantityAuthorized: 0, quantityConsumed: 0 },
    ];
    expect(authorizationAlerts([auth({ status: 'partially_authorized', items })], TODAY)).toEqual([
      { kind: 'sessions_ending', authorizationId: 'a1', remaining: 1, authorized: 6 },
    ]);
  });

  it('sessão única ainda não usada, saldo acima da política ou tudo consumido: sem alerta', () => {
    const rows = [
      auth({ id: 'unica', items: [{ quantityAuthorized: 1, quantityConsumed: 0 }] }),
      auth({ id: 'folga', items: [{ quantityAuthorized: 10, quantityConsumed: 5 }] }),
      auth({ id: 'consumida', items: [{ quantityAuthorized: 3, quantityConsumed: 3 }] }),
    ];
    expect(authorizationAlerts(rows, TODAY)).toEqual([]);
  });

  it('consumo acima do autorizado (exceção aprovada) não gera saldo negativo nem alerta', () => {
    expect(authorizationAlerts([auth({ items: [{ quantityAuthorized: 2, quantityConsumed: 3 }] })], TODAY)).toEqual([]);
  });
});

describe('o que não é concedido não alerta', () => {
  it.each(['draft', 'requested', 'pending_operator', 'denied', 'expired', 'cancelled'] as const)('%s', (status) => {
    expect(
      authorizationAlerts([auth({ status, passwordValidUntil: TODAY, items: [{ quantityAuthorized: 10, quantityConsumed: 9 }] })], TODAY),
    ).toEqual([]);
  });
});

describe('ordem, chave e política', () => {
  it('ordena pelo mais urgente e uma autorização pode ter os dois alertas', () => {
    const rows = [
      auth({ id: 'b', passwordValidUntil: '2026-11-19' }),
      auth({ id: 'a', passwordValidUntil: '2026-11-17', items: [{ quantityAuthorized: 5, quantityConsumed: 4 }] }),
    ];
    expect(authorizationAlerts(rows, TODAY).map((x) => `${x.authorizationId}:${x.kind}`)).toEqual([
      'a:sessions_ending',
      'a:password_expiring',
      'b:password_expiring',
    ]);
  });

  it('a chave é estável para o mesmo fato e muda quando a validade ou o saldo muda; não leva dado pessoal', () => {
    const one = authorizationAlerts([auth({ passwordValidUntil: '2026-11-17' })], TODAY)[0]!;
    const same = authorizationAlerts([auth({ passwordValidUntil: '2026-11-17' })], '2026-11-17')[0]!;
    const moved = authorizationAlerts([auth({ passwordValidUntil: '2026-11-18' })], TODAY)[0]!;
    expect(alertKey(one)).toBe('authorization:a1:password:2026-11-17');
    expect(alertKey(same)).toBe(alertKey(one));
    expect(alertKey(moved)).not.toBe(alertKey(one));
    const ending = authorizationAlerts([auth({ items: [{ quantityAuthorized: 10, quantityConsumed: 9 }] })], TODAY)[0]!;
    expect(alertKey(ending)).toBe('authorization:a1:remaining:1');
  });

  it('recusa política fora dos limites e data inválida', () => {
    expect(() => authorizationAlerts([], TODAY, { passwordDaysAhead: -1, sessionsRemainingAtMost: 1 })).toThrow(RangeError);
    expect(() => authorizationAlerts([], TODAY, { passwordDaysAhead: 61, sessionsRemainingAtMost: 1 })).toThrow(RangeError);
    expect(() => authorizationAlerts([], TODAY, { passwordDaysAhead: 3, sessionsRemainingAtMost: 0 })).toThrow(RangeError);
    expect(() => authorizationAlerts([], '2026-02-30')).toThrow(RangeError);
    expect(() => authorizationAlerts([auth({ passwordValidUntil: '16/11/2026' })], TODAY)).toThrow(RangeError);
  });
});
