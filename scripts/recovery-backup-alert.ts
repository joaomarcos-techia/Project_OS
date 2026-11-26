/** Sanitized systemd failure notification; never imports the application or dotenv. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function sendRecoveryAlert(
  dsn: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  const parsed = new URL(dsn);
  assert.ok(
    parsed.protocol === 'https:' &&
      /^o\d+\.ingest(?:\.[a-z]+)?\.sentry\.io$/u.test(parsed.hostname),
  );
  assert.ok(!parsed.password && !parsed.port && !parsed.search && !parsed.hash);
  assert.match(parsed.username, /^[a-f0-9]{32}$/u);
  assert.match(parsed.pathname, /^\/\d+$/u);
  const eventId = randomUUID().replaceAll('-', '');
  const endpoint = `https://${parsed.hostname}/api${parsed.pathname}/envelope/`;
  const event = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: 'production',
    message: 'Qoro recovery backup requires attention',
    fingerprint: ['qoro-recovery-continuity'],
    tags: { flow: 'recovery.scheduled', data_scope: 'no_patient_data' },
  });
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
    JSON.stringify({ type: 'event', length: Buffer.byteLength(event) }),
    event,
    '',
  ].join('\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await transport(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope,
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return eventId; // Ingestion only; channel receipt is a separate human proof.
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      /* Bounded retry; a final failure is propagated and logged without credentials. */
    }
  }
  throw new Error('Recovery alert ingestion failed; verify the configured channel');
}
async function main() {
  assert.equal(process.platform, 'linux');
  const credentials = process.env.CREDENTIALS_DIRECTORY;
  assert.ok(credentials, 'Systemd encrypted credential required');
  const dsn = (await readFile(path.join(credentials, 'sentry-dsn'), 'utf8')).trim();
  const eventId = await sendRecoveryAlert(dsn);
  console.info(JSON.stringify({ status: 'INGESTED_NOT_CHANNEL_CONFIRMED', eventId }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Recovery alert failed; sensitive details suppressed');
    process.exitCode = 1;
  });
}
