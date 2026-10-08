/**
 * Handler `payments.patient_charge.link_ready` → enfileira a entrega do link.
 *
 * O que se prova aqui é a fiação e, principalmente, o que **não** viaja: o
 * payload do job não pode carregar o link de pagamento. Ele é resolvido no
 * send-time — uma URL de cobrança em repouso numa fila que operador e worker
 * leem é uma URL de cobrança vazada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  insertJobTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CHARGE_LINK_READY: 'payments.patient_charge.link_ready' },
}));
vi.mock('../../infra/repository', () => ({ insertJobTx: mocks.insertJobTx }));

import { metrics } from '@/lib/observability/metrics';

import { REMAINDER_LINK_DELAY_MS } from './patient-charge-link-ready';

// Capturado no LOAD: `clearAllMocks` apagaria o registro.
const registration = mocks.registerHandler.mock.calls[0]!;
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const payload = (over: Record<string, unknown> = {}) => ({
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  patientId: 'pac-1',
  kind: 'deposit',
  amount: 150,
  holdExpiresAt: '2026-08-26T17:00:00.000Z',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  handler({ tx: 'TX', clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

const inserted = () => mocks.insertJobTx.mock.calls[0]![1] as Record<string, unknown>;

beforeEach(() => {
  mocks.insertJobTx.mockClear();
  vi.mocked(metrics.emit).mockClear();
});

describe('handler dos links de pagamento', () => {
  it('registra-se no evento público do Payments', () => {
    expect(registration[0]).toBe('payments.patient_charge.link_ready');
  });

  it('enfileira na fila C14 em vez de abrir caminho paralelo de envio', async () => {
    await run();

    expect(mocks.insertJobTx).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({
        clinicId: 'clinic-1',
        type: 'deposit_link',
      }),
    );
  });

  it('NÃO carrega o link no payload — só o id da cobrança', async () => {
    await run();

    const job = inserted().payload as Record<string, unknown>;
    expect(job).toEqual({
      patientId: 'pac-1',
      chargeId: 'charge-1',
      appointmentId: 'apt-1',
      amount: 150,
      holdExpiresAt: '2026-08-26T17:00:00.000Z',
    });
    // A trava explícita: nada parecido com URL em lugar nenhum do job.
    expect(JSON.stringify(inserted())).not.toMatch(/https?:\/\//);
  });

  it('a chave de dedup é a COBRANÇA — um link se avisa uma vez', async () => {
    await run();

    expect(inserted().dedupKey).toBe('deposit_link:charge-1');
  });

  it('envia agora: cada hora sem o link é uma hora a menos do hold', async () => {
    const before = Date.now();
    await run();

    expect((inserted().scheduledFor as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('o link do restante espera 2 h: a recepção registra o dinheiro antes do envio (08/10/2026)', async () => {
    const before = Date.now();
    await run({ kind: 'remainder' });

    const scheduledFor = (inserted().scheduledFor as Date).getTime();
    expect(scheduledFor).toBeGreaterThanOrEqual(before + REMAINDER_LINK_DELAY_MS);
    expect(scheduledFor).toBeLessThan(before + REMAINDER_LINK_DELAY_MS + 60_000);
    expect(REMAINDER_LINK_DELAY_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('remainder vira remainder_link sem URL nem prazo de hold', async () => {
    await run({ kind: 'remainder' });

    expect(inserted()).toEqual(
      expect.objectContaining({
        clinicId: 'clinic-1',
        type: 'remainder_link',
        dedupKey: 'remainder_link:charge-1',
        payload: {
          patientId: 'pac-1',
          chargeId: 'charge-1',
          appointmentId: 'apt-1',
          amount: 150,
        },
      }),
    );
    expect(JSON.stringify(inserted())).not.toMatch(/https?:\/\/|holdExpiresAt/);
  });

  it('kind desconhecido não é tratado como restante e mantém skipped_kind observável', async () => {
    await run({ kind: 'legacy_unknown' });

    expect(mocks.insertJobTx).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(metrics.emit)
        .mock.calls.some((c) => c[0] === 'proactive.deposit_link.skipped_kind'),
    ).toBe(true);
  });

  it('usa o clinicId do worker (contexto RLS), não o do payload', async () => {
    await run({ clinicId: 'clinic-INTRUSA' });

    expect(inserted().clinicId).toBe('clinic-1');
  });
});
