/**
 * Saúde de ENVIO — orquestração. Seam, cripto e Graph mockados: o que se prova
 * aqui é QUANDO se lê, o que se grava e que nada disso derruba quem chamou.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  listDue: vi.fn(),
  record: vi.fn(),
  decrypt: vi.fn(),
  read: vi.fn(),
  emit: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('@/lib/messaging', () => ({
  loadConnectionForMessagingHealth: mocks.load,
  listConnectionsDueForMessagingHealth: mocks.listDue,
  recordMessagingHealth: mocks.record,
}));
vi.mock('@/lib/crypto', () => ({ decryptForTenant: mocks.decrypt }));
vi.mock('./meta-onboarding', () => ({ readMessagingHealth: mocks.read }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: mocks.capture }));

import {
  DAILY_RECHECK_MS,
  DELIVERY_FAILURE_RECHECK_MS,
  checkClinicMessagingHealth,
  recheckMessagingHealthAfterDeliveryFailure,
  sweepMessagingHealth,
} from './messaging-health-check';

const ctx = { ip: null, userAgent: null, requestId: 'req-1', correlationId: 'req-1' };
const NOW = new Date('2026-10-08T12:00:00.000Z');

function connection(clinicId: string, checkedAt: Date | null = null) {
  return {
    id: `conn-${clinicId}`,
    clinicId,
    metaPhoneId: `phone-${clinicId}`,
    tokenCiphertext: `enc-${clinicId}`,
    messagingHealthCheckedAt: checkedAt,
  };
}

const BLOCKED = { ok: true, health: { state: 'blocked', codes: [141006, 141010] } };

function emitted(event: string) {
  return mocks.emit.mock.calls.filter(([name]) => name === event).map(([, fields]) => fields);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockImplementation(async (_clinicId: string, ciphertext: string) =>
    ciphertext.replace('enc-', 'token-'),
  );
  mocks.read.mockResolvedValue(BLOCKED);
  mocks.record.mockResolvedValue({ recorded: true, changed: true, previous: 'available' });
});

describe('checkClinicMessagingHealth', () => {
  it('lê o número com o token da clínica e grava estado e códigos', async () => {
    mocks.load.mockResolvedValue(connection('clinic-a'));

    const result = await checkClinicMessagingHealth('clinic-a', {
      trigger: 'settings',
      requestContext: ctx,
      userId: 'user-1',
    });

    expect(result).toEqual({
      outcome: 'checked',
      health: { state: 'blocked', codes: [141006, 141010] },
      changed: true,
    });
    expect(mocks.decrypt).toHaveBeenCalledWith('clinic-a', 'enc-clinic-a');
    expect(mocks.read).toHaveBeenCalledWith({
      token: 'token-clinic-a',
      phoneNumberId: 'phone-clinic-a',
    });
    expect(mocks.record).toHaveBeenCalledWith({
      clinicId: 'clinic-a',
      connectionId: 'conn-clinic-a',
      state: 'blocked',
      codes: [141006, 141010],
      requestContext: ctx,
      userId: 'user-1',
    });
    expect(emitted('messaging.whatsapp.messaging_health_changed')).toEqual([
      {
        clinicId: 'clinic-a',
        trigger: 'settings',
        from: 'available',
        to: 'blocked',
        codes: '141006,141010',
      },
    ]);
  });

  it('sem mudança: grava a leitura, sem métrica de mudança', async () => {
    mocks.load.mockResolvedValue(connection('clinic-a'));
    mocks.record.mockResolvedValue({ recorded: true, changed: false, previous: 'blocked' });

    const result = await checkClinicMessagingHealth('clinic-a', {
      trigger: 'connect',
      requestContext: ctx,
      userId: 'user-1',
    });
    expect(result.changed).toBe(false);
    expect(emitted('messaging.whatsapp.messaging_health_changed')).toEqual([]);
  });

  it('sem conexão ativa: nada a ler', async () => {
    mocks.load.mockResolvedValue(null);

    const result = await checkClinicMessagingHealth('clinic-a', {
      trigger: 'settings',
      requestContext: ctx,
      userId: 'user-1',
    });
    expect(result).toEqual({ outcome: 'no_connection', health: null, changed: false });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('Graph indisponível: não grava nada, preserva a última leitura', async () => {
    mocks.load.mockResolvedValue(connection('clinic-a'));
    mocks.read.mockResolvedValue({ ok: false, reason: 'rate_limited' });

    const result = await checkClinicMessagingHealth('clinic-a', {
      trigger: 'settings',
      requestContext: ctx,
      userId: 'user-1',
    });
    expect(result).toEqual({ outcome: 'unavailable', health: null, changed: false });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(emitted('messaging.whatsapp.messaging_health_unavailable')).toEqual([
      { clinicId: 'clinic-a', trigger: 'settings', reason: 'rate_limited' },
    ]);
  });

  it('credencial indecifrável: não chama a Meta nem grava', async () => {
    mocks.load.mockResolvedValue(connection('clinic-a'));
    mocks.decrypt.mockRejectedValue(new Error('bad key'));

    const result = await checkClinicMessagingHealth('clinic-a', {
      trigger: 'connect',
      requestContext: ctx,
      userId: 'user-1',
    });
    expect(result.outcome).toBe('unavailable');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(emitted('messaging.whatsapp.messaging_health_unavailable')[0]).toMatchObject({
      reason: 'credential',
    });
  });

  it('banco falhando na carga ou na gravação: nunca lança, vai para o Sentry', async () => {
    mocks.load.mockRejectedValueOnce(new Error('db down'));
    await expect(
      checkClinicMessagingHealth('clinic-a', {
        trigger: 'settings',
        requestContext: ctx,
        userId: null,
      }),
    ).resolves.toMatchObject({ outcome: 'unavailable' });

    mocks.load.mockResolvedValue(connection('clinic-a'));
    mocks.record.mockRejectedValueOnce(new Error('db down'));
    await expect(
      checkClinicMessagingHealth('clinic-a', {
        trigger: 'settings',
        requestContext: ctx,
        userId: null,
      }),
    ).resolves.toMatchObject({ outcome: 'unavailable' });
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });
});

describe('recheckMessagingHealthAfterDeliveryFailure', () => {
  it('relê cada clínica uma vez, como sistema, com o gatilho da recusa', async () => {
    mocks.load.mockImplementation(async (clinicId: string) => connection(clinicId));

    await recheckMessagingHealthAfterDeliveryFailure(
      ['clinic-a', 'clinic-b', 'clinic-a'],
      ctx,
      NOW,
    );

    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.record.mock.calls.map(([input]) => [input.clinicId, input.userId])).toEqual([
      ['clinic-a', null],
      ['clinic-b', null],
    ]);
    expect(emitted('messaging.whatsapp.messaging_health_changed')[0]).toMatchObject({
      trigger: 'delivery_failure',
    });
  });

  it('a rajada de recusas não vira rajada de leituras: menos de 10 min, pula', async () => {
    const recent = new Date(NOW.getTime() - DELIVERY_FAILURE_RECHECK_MS + 1_000);
    const stale = new Date(NOW.getTime() - DELIVERY_FAILURE_RECHECK_MS - 1_000);
    mocks.load.mockImplementation(async (clinicId: string) =>
      connection(clinicId, clinicId === 'clinic-a' ? recent : stale),
    );

    await recheckMessagingHealthAfterDeliveryFailure(['clinic-a', 'clinic-b'], ctx, NOW);

    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.record.mock.calls[0]![0].clinicId).toBe('clinic-b');
    expect(emitted('messaging.whatsapp.messaging_health_recheck_skipped')).toEqual([
      { clinicId: 'clinic-a' },
    ]);
  });

  it('clínica sem conexão ou com banco falhando não interrompe as outras', async () => {
    mocks.load
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connection('clinic-c'));

    await expect(
      recheckMessagingHealthAfterDeliveryFailure(['clinic-a', 'clinic-b', 'clinic-c'], ctx, NOW),
    ).resolves.toBeUndefined();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});

describe('sweepMessagingHealth', () => {
  it('lê só quem não foi lido em 20 h e conta os vereditos', async () => {
    mocks.listDue.mockResolvedValue([
      connection('clinic-a'),
      connection('clinic-b'),
      connection('clinic-c'),
      connection('clinic-d'),
    ]);
    mocks.read
      .mockResolvedValueOnce(BLOCKED)
      .mockResolvedValueOnce({ ok: true, health: { state: 'limited', codes: [141010] } })
      .mockResolvedValueOnce({ ok: false, reason: 'indeterminate' })
      .mockResolvedValueOnce({ ok: true, health: { state: 'available', codes: [] } });
    mocks.record
      .mockResolvedValueOnce({ recorded: true, changed: true, previous: null })
      .mockResolvedValueOnce({ recorded: true, changed: false, previous: 'limited' })
      .mockResolvedValueOnce({ recorded: true, changed: false, previous: 'available' });

    const summary = await sweepMessagingHealth(100, ctx, NOW);

    expect(mocks.listDue).toHaveBeenCalledWith(100, new Date(NOW.getTime() - DAILY_RECHECK_MS));
    expect(summary).toEqual({
      scanned: 4,
      available: 1,
      limited: 1,
      blocked: 1,
      unavailable: 1,
      changed: 1,
    });
    // Varredura do sistema: sem usuário, gatilho diário.
    expect(mocks.record.mock.calls.every(([input]) => input.userId === null)).toBe(true);
    expect(emitted('messaging.whatsapp.messaging_health_changed')[0]).toMatchObject({
      trigger: 'daily',
      from: 'unknown',
    });
  });
});
