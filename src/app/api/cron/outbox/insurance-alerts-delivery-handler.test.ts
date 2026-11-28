import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  recipients: vi.fn(),
  send: vi.fn(),
  read: vi.fn(),
  record: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerDetachedHandler: mocks.register }));
vi.mock('@/contexts/identity/queries', () => ({ listActiveMemberEmails: mocks.recipients }));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: mocks.send }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/health-insurance/alerts', () => ({
  HEALTH_INSURANCE_EVENTS: { AUTHORIZATION_ALERTS_DELIVERY_REQUESTED: 'health_insurance.authorization_alerts.delivery_requested' },
  OPERATE_CONVENIOS_ROLES: ['owner', 'gestor', 'attendant'],
  readAlertDeliveryBatch: mocks.read,
  recordAlertDeliveryOutcome: mocks.record,
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import { deliverInsuranceAlerts, insuranceAlertContent } from './insurance-alerts-delivery-handler';

// O registro acontece ao carregar o módulo, antes de qualquer limpeza de mocks.
const registeredEvent = mocks.register.mock.calls[0]?.[0] as string | undefined;

const CLINIC = '11111111-1111-4111-8111-111111111111';
const BATCH = 'a'.repeat(32);
const payload = { clinicId: CLINIC, batch: BATCH, count: 3 };
const counts = { password_expiring: 2, password_expired: 1, sessions_ending: 0, operator_overdue: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ operable: true, counts, total: 3 });
  mocks.recipients.mockResolvedValue(['recepcao@example.test', 'gestao@example.test']);
  mocks.send.mockResolvedValue({ providerMessageId: 'email-1' });
  mocks.record.mockResolvedValue(3);
});

describe('entrega dos avisos de autorização de convênio (P6.6)', () => {
  it('registra o handler do evento de entrega', () => {
    expect(registeredEvent).toBe('health_insurance.authorization_alerts.delivery_requested');
  });

  it('envia a quem opera Convênios, só com contagens, e carimba o lote como entregue', async () => {
    expect(await deliverInsuranceAlerts({ clinicId: CLINIC, payload })).toBe('delivered');
    expect(mocks.recipients).toHaveBeenCalledWith(CLINIC, { roles: ['owner', 'gestor', 'attendant'], permission: 'operate:convenios' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const first = mocks.send.mock.calls[0]![0] as { to: string; subject: string; text: string; html: string; idempotencyKey: string };
    expect(first.to).toBe('recepcao@example.test');
    expect(first.subject).toBe('Qoro: 3 avisos de autorização de convênio');
    expect(first.text).toContain('- 1 autorização com a senha vencida');
    expect(first.text).toContain('- 2 autorizações com a senha vencendo');
    expect(first.text).toContain('não traz dados de pacientes');
    // Chave estável por clínica, lote e destinatário, sem o e-mail em claro.
    expect(first.idempotencyKey).toMatch(new RegExp(`^hi-alerts/${CLINIC}/${BATCH}/[0-9a-f]{24}$`, 'u'));
    expect(first.idempotencyKey).not.toContain('recepcao');
    expect(mocks.record).toHaveBeenCalledWith(CLINIC, BATCH, { delivered: true });
    expect(mocks.emit).toHaveBeenCalledWith('insurance.alerts.delivered', { alerts: 3, recipients: 2, failedRecipients: 0 });
    // Nenhum identificador na métrica.
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toMatch(new RegExp(`${CLINIC}|${BATCH}|example\\.test`, 'u'));
  });

  it('o conteúdo nunca leva identificador: só os tipos com contagem maior que zero', () => {
    const c = insuranceAlertContent({ password_expiring: 0, password_expired: 0, sessions_ending: 1, operator_overdue: 2 });
    expect(c.subject).toBe('Qoro: 3 avisos de autorização de convênio');
    expect(c.text).toContain('- 1 autorização com as sessões acabando');
    expect(c.text).toContain('- 2 pedidos parados na operadora há mais de 3 dias');
    expect(c.text).not.toContain('senha');
    expect(`${c.text}${c.html}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
    expect(insuranceAlertContent({ ...counts, password_expiring: 0 }).subject).toBe('Qoro: 1 aviso de autorização de convênio');
  });

  it('nova tentativa usa a MESMA chave por destinatário (o provedor não duplica o e-mail)', async () => {
    await deliverInsuranceAlerts({ clinicId: CLINIC, payload });
    await deliverInsuranceAlerts({ clinicId: CLINIC, payload });
    const keys = mocks.send.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('lote obsoleto (tudo encerrado ou já visto): nenhum e-mail e nenhuma gravação', async () => {
    mocks.read.mockResolvedValueOnce({ operable: false, counts: { ...counts, password_expiring: 0, password_expired: 0 }, total: 0 });
    expect(await deliverInsuranceAlerts({ clinicId: CLINIC, payload })).toBe('obsolete');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('clínica que não opera (módulo desligado, avaliação ou assinatura parada): sem e-mail, motivo registrado', async () => {
    mocks.read.mockResolvedValueOnce({ operable: false, counts, total: 3 });
    expect(await deliverInsuranceAlerts({ clinicId: CLINIC, payload })).toBe('not_operable');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(CLINIC, BATCH, { delivered: false, error: 'not_operable' });
  });

  it('sem destinatário ativo (todos desativados ou sem operar): sem e-mail, sem nova tentativa', async () => {
    mocks.recipients.mockResolvedValueOnce([]);
    expect(await deliverInsuranceAlerts({ clinicId: CLINIC, payload })).toBe('no_recipient');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(CLINIC, BATCH, { delivered: false, error: 'no_recipient' });
  });

  it('falha de um destinatário não impede o outro: o lote fica entregue', async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('provedor recusou'), { name: 'TransactionalEmailError' }));
    expect(await deliverInsuranceAlerts({ clinicId: CLINIC, payload })).toBe('delivered');
    expect(mocks.record).toHaveBeenCalledWith(CLINIC, BATCH, { delivered: true });
    expect(mocks.emit).toHaveBeenCalledWith('insurance.alerts.delivered', { alerts: 3, recipients: 1, failedRecipients: 1 });
  });

  it('falha de todos: registra a tentativa só com o tipo do erro e relança (o outbox tenta de novo)', async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error('rede fora: recepcao@example.test'), { name: 'TransactionalEmailError' }));
    await expect(deliverInsuranceAlerts({ clinicId: CLINIC, payload })).rejects.toThrow('rede fora');
    expect(mocks.record).toHaveBeenCalledWith(CLINIC, BATCH, { delivered: false, error: 'TransactionalEmailError' });
    expect(mocks.record).not.toHaveBeenCalledWith(CLINIC, BATCH, { delivered: true });
    expect(mocks.emit).toHaveBeenCalledWith('insurance.alerts.delivery_failed', { error: 'TransactionalEmailError', recipients: 2 });
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('example.test');
  });

  it('payload de outra clínica: recusado sem nova tentativa, sem ler nem enviar', async () => {
    await expect(deliverInsuranceAlerts({ clinicId: '22222222-2222-4222-8222-222222222222', payload })).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
