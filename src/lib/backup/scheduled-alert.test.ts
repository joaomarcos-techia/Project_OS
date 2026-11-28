import { describe, expect, it, vi } from 'vitest';
import { sendRecoveryAlert } from '../../../scripts/recovery-backup-alert';

const dsn = 'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/123';
describe('scheduled recovery notification boundaries', () => {
  it('uses the official envelope endpoint and a sanitized event with no patient information', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status: 202 }));
    const id = await sendRecoveryAlert(dsn, transport);
    expect(id).toMatch(/^[a-f0-9]{32}$/u);
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('https://o123.ingest.us.sentry.io/api/123/envelope/');
    const lines = String(init?.body).trim().split('\n');
    const event = JSON.parse(lines[2]!);
    expect(event.tags.data_scope).toBe('no_patient_data');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('request');
    expect(init?.redirect).toBe('error');
  });
  it('does not send credentials to arbitrary destinations or follow redirects', async () => {
    const transport = vi.fn<typeof fetch>();
    for (const invalid of [
      dsn.replace('https:', 'http:'),
      dsn.replace('sentry.io', 'example.invalid'),
      dsn + '?forward=other',
    ])
      await expect(sendRecoveryAlert(invalid, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('bounded retries reuse the event ID and eventually propagate failure', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    await expect(sendRecoveryAlert(dsn, transport)).rejects.toThrow('ingestion failed');
    expect(transport).toHaveBeenCalledTimes(3);
    expect(
      new Set(
        transport.mock.calls.map(
          ([, init]) => JSON.parse(String(init?.body).split('\n')[0]!).event_id,
        ),
      ).size,
    ).toBe(1);
  });
  it('does not retry a permanent rejection', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status: 403 }));
    await expect(sendRecoveryAlert(dsn, transport)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
