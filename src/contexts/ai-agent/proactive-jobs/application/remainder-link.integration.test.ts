/**
 * Integração controlada da 1.6c: contrato Payments → handler outbox → job C14 →
 * lookup no send-time → builder real → seam Messaging. Só as bordas externas
 * (DB/Meta) são mockadas; routing, policy e template são os módulos reais.
 *
 * Relógio fixo um dia antes do hold da fixture (ADR-065: a validade do job
 * depende do instante do envio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// This controlled integration retains a paid contract; commercial state is tested separately.
vi.mock('@/lib/entitlements', () => ({
  getOperationalModuleAccess: vi.fn(async () => ({ allowed: true })),
}));

import type * as EnvModule from '@/lib/env';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  insertJobTx: vi.fn(),
  claimDue: vi.fn(),
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
  finalizeSent: vi.fn(async () => {}),
  finalizeRetry: vi.fn(async () => {}),
  finalizeFailed: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  getPayableCharge: vi.fn(),
  getProactiveContact: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      META_TEMPLATE_DEPOSIT_LINK_ID: 'sinal_link_pagamento',
      META_TEMPLATE_REMAINDER_LINK_ID: 'restante_link_pagamento',
      META_TEMPLATE_LANG: 'pt_BR',
    },
  };
});
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CHARGE_LINK_READY: 'payments.patient_charge.link_ready' },
  paymentsApiV1: { getPayableCharge: mocks.getPayableCharge },
}));
vi.mock('@/contexts/patient', () => ({
  patientApiV1: { getProactiveContact: mocks.getProactiveContact },
}));
vi.mock('@/contexts/messaging', () => ({
  messagingApiV1: { sendText: mocks.sendText },
  SuppressedRecipientError: class extends Error {},
  NumberNotConnectedError: class extends Error {},
}));
vi.mock('@/contexts/financial', () => ({ financialApiV1: { getLancamento: vi.fn() } }));
vi.mock('@/contexts/clinical', () => ({ clinicalApiV1: { getFollowupState: vi.fn() } }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
    lookupAppointment: vi.fn(async () => ({ status: 'agendado' })),
    lookupWaitlistOffer: vi.fn(),
    hasSubsequentCompletedAppointment: vi.fn(),
  },
}));
vi.mock('../infra/repository', () => ({
  insertJobTx: mocks.insertJobTx,
  claimDue: mocks.claimDue,
  getClinicTimezone: mocks.getClinicTimezone,
  finalizeSent: mocks.finalizeSent,
  finalizeRetry: mocks.finalizeRetry,
  finalizeFailed: mocks.finalizeFailed,
  cancel: mocks.cancel,
}));

import '../internal/handlers/patient-charge-link-ready';

import { processProactiveBatch } from './process';

const CLINIC = '11111111-1111-1111-8111-111111111111';
const PATIENT = '22222222-2222-2222-8222-222222222222';
const APPOINTMENT = '33333333-3333-3333-8333-333333333333';
const CHARGE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-26T17:00:00.000Z');

type EventHandler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = mocks.registerHandler.mock.calls[0]![1] as EventHandler;

function event(kind: 'deposit' | 'remainder'): Record<string, unknown> {
  return {
    chargeId: CHARGE,
    clinicId: CLINIC,
    appointmentId: APPOINTMENT,
    patientId: PATIENT,
    kind,
    amount: kind === 'deposit' ? 150 : 80,
    holdExpiresAt: '2026-08-27T17:00:00.000Z',
  };
}

async function enqueueAndClaim(kind: 'deposit' | 'remainder'): Promise<void> {
  await handler({ tx: 'TX', clinicId: CLINIC, payload: event(kind), eventId: 'evt-1' });
  const queued = mocks.insertJobTx.mock.calls[0]![1] as {
    type: 'deposit_link' | 'remainder_link';
    payload: unknown;
  };
  mocks.claimDue.mockResolvedValue([
    {
      id: `job-${kind}`,
      clinicId: CLINIC,
      type: queued.type,
      payload: queued.payload,
      attempts: 1,
      leaseToken: 'lease-1',
      // Geração 0 (ADR-064): a chave de envio é o próprio id.
      sendKey: `job-${kind}`,
      resend: false,
      failedReason: null,
      createdAt: new Date(),
    },
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
  mocks.getProactiveContact.mockResolvedValue({
    nome: 'Maria Silva',
    phone: '5511999990000',
    deceased: false,
    cobrancaWhatsapp: true,
    agendamentoWhatsapp: true,
    consentRevoked: false,
    suppressedWhatsapp: false,
    suppressedWhatsappPurposes: [],
  });
  mocks.getPayableCharge.mockResolvedValue({
    chargeId: CHARGE,
    appointmentId: APPOINTMENT,
    amount: 80,
    invoiceUrl: 'https://www.asaas.com/i/current-restante',
    holdExpiresAt: null,
  });
  mocks.sendText.mockResolvedValue({
    id: 'out-1',
    status: 'accepted',
    providerMessageId: 'meta-1',
    deduped: false,
  });
});

describe('1.6c — integração link_ready → C14 → send', () => {
  it('entrega remainder pelo template próprio com o link fresco', async () => {
    await enqueueAndClaim('remainder');

    const queued = mocks.insertJobTx.mock.calls[0]![1] as Record<string, unknown>;
    expect(queued).toEqual(
      expect.objectContaining({
        type: 'remainder_link',
        dedupKey: `remainder_link:${CHARGE}`,
      }),
    );
    expect(JSON.stringify(queued)).not.toContain('current-restante');

    const summary = await processProactiveBatch('remainder_link');

    expect(summary.sent).toBe(1);
    expect(mocks.getPayableCharge).toHaveBeenCalledWith(CLINIC, CHARGE);
    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        idempotencyKey: 'job-remainder',
        purpose: 'billing',
        body: {
          kind: 'template',
          templateName: 'restante_link_pagamento',
          languageCode: 'pt_BR',
          variables: ['Maria Silva', '80,00', 'https://www.asaas.com/i/current-restante'],
        },
      }),
    );
  });

  it('não envia se a cobrança deixou de ser pagável antes do worker', async () => {
    await enqueueAndClaim('remainder');
    mocks.getPayableCharge.mockResolvedValue(null);

    const summary = await processProactiveBatch('remainder_link');

    expect(summary.cancelled).toBe(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      CLINIC,
      'job-remainder',
      'lease-1',
      'charge_not_payable',
    );
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it('mantém deposit no template do sinal', async () => {
    await enqueueAndClaim('deposit');

    const summary = await processProactiveBatch('deposit_link');

    expect(summary.sent).toBe(1);
    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job-deposit',
        purpose: 'reminder',
        body: expect.objectContaining({ templateName: 'sinal_link_pagamento' }),
      }),
    );
  });
});
