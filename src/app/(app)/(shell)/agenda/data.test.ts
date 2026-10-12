/**
 * EC-32 — o loader da Agenda traz as mensagens automáticas que não chegaram.
 *
 * O que se prova aqui é a fiação, não a regra (essa está em
 * `delivery-failures.test.ts`):
 *  - sem view:agenda, a fila nem é lida (AUTHZ-002: o gate decide a QUERY);
 *  - a consulta de cada falha vem por id, em lote, mesmo fora da faixa exibida;
 *  - a cobrança só é consultada para falhas de link, e só decide o botão;
 *  - o nome do paciente da falha entra na mesma leitura de fichas.
 */
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listRecentProactiveFailures: vi.fn(),
  listAppointments: vi.fn(),
  listPatientChargeEconomics: vi.fn(),
  listPatientCards: vi.fn(),
  withTenant: vi.fn(),
}));

const SINCE = new Date('2026-10-01T12:00:00.000Z');

vi.mock('@/lib/auth/tenant-context', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/contexts/ai-agent/queries', () => ({
  DELIVERY_FAILURE_LIST_LIMIT: 3,
  deliveryFailureWindowStart: () => SINCE,
  listRecentProactiveFailures: mocks.listRecentProactiveFailures,
}));
vi.mock('@/contexts/identity', () => ({
  practitionerSql: () => sql`true`,
  profiles: { role: 'role', crm: 'crm' },
}));
vi.mock('@/contexts/identity/internal/practitioner', () => ({
  getCurrentPractitioner: vi.fn(async () => false),
}));
vi.mock('@/contexts/patient/queries', () => ({ listPatientCards: mocks.listPatientCards }));
vi.mock('@/contexts/payments', () => ({
  paymentsApiV1: { listPatientChargeEconomics: mocks.listPatientChargeEconomics },
}));
vi.mock('@/contexts/payments/pricing-queries', () => ({
  getPaymentPricingPolicy: vi.fn(async () => ({ mode: 'absorb_fees' })),
  listProcedurePaymentPrices: vi.fn(async () => []),
}));
vi.mock('@/contexts/scheduling/queries', () => ({
  listAppointments: mocks.listAppointments,
  listProcedures: vi.fn(async () => []),
  listQueueTimestamps: vi.fn(async () => []),
  listRecurrenceSeriesSummaries: vi.fn(async () => []),
  listSchedulableResources: vi.fn(async () => []),
}));
vi.mock('@/contexts/tenancy/queries', () => ({
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import { getAgendaData } from './data';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const PATIENT = '44444444-4444-4444-8444-444444444444';
const APPOINTMENT = '55555555-5555-4555-8555-555555555555';
const CHARGE = '66666666-6666-4666-8666-666666666666';

function user(permissions: string[]) {
  return { clinicId: CLINIC, userId: 'user-a', isSuperAdmin: false, aal: 'aal1', permissions };
}

function depositFailure(over: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    type: 'deposit_link',
    patientId: PATIENT,
    appointmentId: APPOINTMENT,
    chargeId: CHARGE,
    scheduledAt: null,
    returnDate: null,
    attemptedAt: '2026-10-08T14:01:00.000Z',
    cause: { kind: 'meta_refused', code: '131042' },
    ...over,
  };
}

/** A consulta da falha: fora da faixa exibida, com a vaga segurada no futuro. */
const failureAppointment = {
  id: APPOINTMENT,
  patientId: PATIENT,
  status: 'agendado',
  scheduledAt: '2099-01-10T13:00:00.000Z',
  depositStatus: 'pending',
  holdExpiresAt: '2099-01-09T13:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ execute: vi.fn(async () => []) }),
  );
  mocks.listAppointments.mockImplementation(async (_clinicId: string, opts: { ids?: string[] }) =>
    opts.ids ? (opts.ids.includes(APPOINTMENT) ? [failureAppointment] : []) : [],
  );
  mocks.listPatientChargeEconomics.mockResolvedValue([
    { chargeId: CHARGE, appointmentId: APPOINTMENT, kind: 'deposit', status: 'pending' },
  ]);
  mocks.listPatientCards.mockResolvedValue([
    { id: PATIENT, nome: 'Maria Souza', dataNascimento: null },
  ]);
});

describe('getAgendaData — mensagens automáticas que não chegaram', () => {
  it('sem view:agenda a fila da C14 nem é lida', async () => {
    mocks.requireUser.mockResolvedValue(user([]));

    const data = await getAgendaData({ view: 'day' });

    expect(data.hasAccess).toBe(false);
    expect(data.deliveryFailures).toEqual([]);
    expect(mocks.listRecentProactiveFailures).not.toHaveBeenCalled();
  });

  it('lê a janela, busca consulta e cobrança em lote e resolve o nome', async () => {
    mocks.requireUser.mockResolvedValue(user([PERMISSIONS.VIEW_AGENDA, PERMISSIONS.EDIT_AGENDA]));
    mocks.listRecentProactiveFailures.mockResolvedValue([
      depositFailure(),
      depositFailure({
        jobId: 'job-2',
        type: 'followup',
        appointmentId: null,
        chargeId: null,
        returnDate: '2099-01-20',
      }),
    ]);

    const data = await getAgendaData({ view: 'day', date: '2026-10-08' });

    expect(mocks.listRecentProactiveFailures).toHaveBeenCalledWith(CLINIC, { since: SINCE });
    expect(mocks.listAppointments).toHaveBeenCalledWith(CLINIC, {
      ids: [APPOINTMENT],
      limit: 1,
    });
    // Só a falha de link pede a cobrança.
    expect(mocks.listPatientChargeEconomics).toHaveBeenCalledWith(CLINIC, [APPOINTMENT]);
    expect(mocks.listPatientCards).toHaveBeenCalledWith(CLINIC, [PATIENT]);

    expect(data.deliveryFailures).toEqual([
      expect.objectContaining({
        jobId: 'job-1',
        kind: 'deposit_link',
        pacienteNome: 'Maria Souza',
        vagaSeguradaAte: '2099-01-09T13:00:00.000Z',
        acionavel: true,
        linkCopiavel: true,
      }),
      expect.objectContaining({ jobId: 'job-2', kind: 'followup', acionavel: true }),
    ]);
    expect(data.deliveryFailuresLimited).toBe(false);
  });

  it('sem falhas, os lotes por id não vão ao banco; no teto, a tela é avisada', async () => {
    mocks.requireUser.mockResolvedValue(user([PERMISSIONS.VIEW_AGENDA]));
    mocks.listRecentProactiveFailures.mockResolvedValue([]);

    const empty = await getAgendaData({ view: 'week', date: '2026-10-08' });

    expect(mocks.listAppointments).toHaveBeenCalledWith(CLINIC, { ids: [], limit: 1 });
    expect(mocks.listPatientChargeEconomics).toHaveBeenCalledWith(CLINIC, []);
    expect(empty.deliveryFailures).toEqual([]);
    expect(empty.deliveryFailuresLimited).toBe(false);

    mocks.listRecentProactiveFailures.mockResolvedValue([
      depositFailure({ jobId: 'a' }),
      depositFailure({ jobId: 'b' }),
      depositFailure({ jobId: 'c' }),
    ]);
    const full = await getAgendaData({ view: 'day', date: '2026-10-08' });
    expect(full.deliveryFailuresLimited).toBe(true);
  });
});
