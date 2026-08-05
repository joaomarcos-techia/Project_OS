import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registered, selectResults, updates, sendTransactionalEmail, createSignedExportUrl, emit } =
  vi.hoisted(() => ({
    registered: new Map<
      string,
      (context: { tx: unknown; clinicId: string; payload: unknown }) => Promise<void>
    >(),
    selectResults: [] as unknown[][],
    updates: [] as unknown[],
    sendTransactionalEmail: vi.fn(),
    createSignedExportUrl: vi.fn(),
    emit: vi.fn(),
  }));

vi.mock('@/lib/outbox/registry', () => ({
  registerHandler: (
    eventType: string,
    handler: (context: { tx: unknown; clinicId: string; payload: unknown }) => Promise<void>,
  ) => {
    registered.set(eventType, handler);
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/storage/exports', () => ({
  uploadLgpdExport: vi.fn().mockResolvedValue(undefined),
  createSignedExportUrl,
}));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail }));
vi.mock('../export/pdf', () => ({
  renderExportPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
}));
vi.mock('../export/provider', () => ({ getExportCollectors: () => [] }));

import { PATIENT_EVENTS } from '../../events';
import './lgpd-export-requested';

function createTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectResults.shift() ?? [] }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
}

async function runHandler() {
  const handler = registered.get(PATIENT_EVENTS.LGPD_EXPORT_REQUESTED);
  if (!handler) throw new Error('LGPD export handler was not registered');
  await handler({
    tx: createTx(),
    clinicId: '00000000-0000-0000-0000-000000000001',
    payload: {
      requestId: '00000000-0000-0000-0000-000000000002',
      patientId: '00000000-0000-0000-0000-000000000003',
      clinicId: '00000000-0000-0000-0000-000000000001',
    },
  });
}

beforeEach(() => {
  selectResults.length = 0;
  updates.length = 0;
  vi.clearAllMocks();
  sendTransactionalEmail.mockResolvedValue({ providerMessageId: 'email_1' });
  createSignedExportUrl.mockImplementation((path: string) =>
    Promise.resolve(`https://storage.test/${path}`),
  );
});

describe('LGPD export delivery', () => {
  it('marca falha operacional sem tentar entrega quando o titular não tem e-mail', async () => {
    selectResults.push([{ status: 'pending' }], []);

    await runHandler();

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual({
      status: 'failed',
      statusReason: 'export_recipient_email_missing',
    });
    expect(emit).toHaveBeenCalledWith(
      'patient.lgpd.export.failed',
      expect.objectContaining({ reason: 'recipient_email_missing' }),
    );
  });

  it('envia link com chave idempotente e só então conclui a solicitação', async () => {
    selectResults.push([{ status: 'pending' }], [{ email: 'titular@example.com' }]);

    await runHandler();

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'titular@example.com',
        idempotencyKey: 'lgpd-export/00000000-0000-0000-0000-000000000002',
        html: expect.stringContaining('Baixar arquivo JSON'),
      }),
    );
    expect(createSignedExportUrl).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-000000000002.json',
      86_400,
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: 'completed',
        statusReason: 'export_ready_email_sent',
        requesterNotificationChannel: 'email',
      }),
    );
  });
});
