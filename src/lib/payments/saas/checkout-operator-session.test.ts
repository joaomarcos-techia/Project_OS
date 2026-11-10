import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSamePreparation,
  checkoutUrl,
  expectedAmount,
  guardedDevDatabase,
  previewOrigin,
  readSession,
  saveSession,
  sessionSchema,
  withSessionLock,
  type CheckoutSession,
} from '../../../../scripts/abacatepay-checkout-session';

const sample: CheckoutSession = {
  version: 1,
  runId: '257202ee-4b35-4d21-9063-8c53174a7a90',
  createdAt: '2026-11-10T10:00:00.000Z',
  origin: 'https://project-synthetic-clinic-os-v2-s-projects.vercel.app',
  sha: 'a'.repeat(40),
  storeHash: 'b'.repeat(64),
  plan: 'clinica_2026_2',
  planId: '60918b83-e6d7-47b2-924f-eecde59e5512',
  productId: 'prod_synthetic',
  amountMinor: 39700,
  phase: 'prepared',
  userId: null,
  checkoutId: null,
  url: null,
  draftTokenHash: 'c'.repeat(64),
  retention: 'retain_until_reconciled_no_automatic_cleanup',
};
const directories: string[] = [];
async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'qoro-checkout-operator-unit-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve(tmpdir()) ||
      !path.basename(resolved).startsWith('qoro-checkout-operator-unit-')
    )
      throw new Error('Cleanup outside identified synthetic scratch');
    for (const file of await readdir(resolved)) await unlink(path.join(resolved, file));
    await rmdir(resolved);
  }
});

describe('checkout operator environment and immutable preparation', () => {
  it.each([
    ['--preview', 'https://app.qoro.dev'],
    ['--preview', sample.origin, '--session', '../retained'],
  ])('rejects unsafe CLI arguments before reading settings or calling services: %j', (...args) => {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/abacatepay-checkout-operator.ts',
        '--action',
        'create',
        '--settings-file',
        '/qoro-synthetic-must-not-read.env',
        '--vercel-cli',
        '/qoro-synthetic-must-not-execute.js',
        ...args,
      ],
      {
        env: { ...process.env, NODE_OPTIONS: '--conditions=react-server' },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim())).toMatchObject({
      status: 'BLOCKED',
      stage: 'arguments',
      sensitiveDetailsSuppressed: true,
      productionWrites: 0,
    });
    expect(result.stdout).toBe('');
  });
  it.each([
    'https://app.qoro.dev',
    'http://project-x-clinic-os-v2-s-projects.vercel.app',
    'https://project-x-clinic-os-v2-s-projects.vercel.app.evil.invalid',
    'https://user:secret@project-x-clinic-os-v2-s-projects.vercel.app',
    'https://project-x-clinic-os-v2-s-projects.vercel.app?token=secret',
  ])('refuses unsafe Preview origin %s', (origin) => {
    expect(previewOrigin.safeParse(origin).success).toBe(false);
  });
  it('normalizes a valid origin without silently accepting a path', () => {
    expect(previewOrigin.parse(`${sample.origin}/`)).toBe(sample.origin);
    expect(previewOrigin.safeParse(`${sample.origin}/login`).success).toBe(false);
  });
  it.each([
    'postgresql://postgres.shlcbxawrxuaebazuiue:synthetic@aws-0.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.pqhkirrszzpwezdaqrai:synthetic@evil.invalid:5432/postgres',
    'https://postgres.pqhkirrszzpwezdaqrai:synthetic@aws-0.pooler.supabase.com/postgres',
  ])('refuses a database outside exact DEV binding', (url) => {
    expect(() => guardedDevDatabase(url)).toThrow();
  });
  it('selects the session port while retaining the identified DEV database', () => {
    const url = new URL(
      guardedDevDatabase(
        'postgresql://postgres.pqhkirrszzpwezdaqrai:synthetic@aws-0.pooler.supabase.com:6543/postgres?sslmode=require',
      ),
    );
    expect(url.port).toBe('5432');
    expect(url.searchParams.get('sslmode')).toBe('require');
  });
  it('uses approved entry prices for both plans', () => {
    expect(expectedAmount('consultorio_2026')).toBe(19700);
    expect(expectedAmount('clinica_2026_2')).toBe(39700);
    expect(sessionSchema.safeParse({ ...sample, amountMinor: 100 }).success).toBe(false);
  });
  it.each(['origin', 'sha', 'storeHash', 'plan', 'planId', 'productId', 'amountMinor'] as const)(
    'refuses a changed %s instead of replacing a retained fixture',
    (key) => {
      expect(() => assertSamePreparation(sample, { ...sample, [key]: 'changed' })).toThrow();
    },
  );
  it('accepts an unchanged fixture without allocating a new run', () => {
    expect(() => assertSamePreparation(sample, sample)).not.toThrow();
  });
  it.each([
    'https://evil.invalid/pay',
    'http://pay.abacatepay.com/bill',
    'https://pay.abacatepay.com.evil.invalid/bill',
    'https://user:secret@app.abacatepay.com/bill',
  ])('rejects unsafe hosted checkout %s', (url) => {
    expect(checkoutUrl.safeParse(url).success).toBe(false);
  });
  it('requires identity and correlation for a payment-ready or verified fixture', () => {
    expect(sessionSchema.safeParse({ ...sample, phase: 'awaiting_payment' }).success).toBe(false);
    expect(
      sessionSchema.safeParse({ ...sample, phase: 'verified', userId: sample.runId }).success,
    ).toBe(false);
    expect(
      sessionSchema.parse({
        ...sample,
        phase: 'awaiting_payment',
        userId: sample.runId,
        checkoutId: 'bill_synthetic',
        url: 'https://pay.abacatepay.com/synthetic',
      }).phase,
    ).toBe('awaiting_payment');
  });
  it('rejects accidental credentials or an automatic cleanup policy in the manifest', () => {
    expect(sessionSchema.safeParse({ ...sample, password: 'synthetic' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...sample, retention: 'delete_after_timeout' }).success).toBe(
      false,
    );
  });
});

describe('operator persistence on real filesystem with synthetic data', () => {
  it('reopens the exact pending checkout without losing its identifiers', async () => {
    const directory = await scratch();
    await withSessionLock(directory, () => saveSession(directory, sample));
    const pending: CheckoutSession = {
      ...sample,
      phase: 'awaiting_payment',
      userId: sample.runId,
      checkoutId: 'bill_synthetic',
      url: 'https://pay.abacatepay.com/synthetic',
    };
    await withSessionLock(directory, () => saveSession(directory, pending));
    expect(await readSession(directory)).toEqual(pending);
    expect(await readdir(directory)).toEqual(['session.json']);
  });
  it('allows a single simultaneous operator and refuses the second before its action', async () => {
    const directory = await scratch();
    let release = () => {};
    let entered = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withSessionLock(directory, async () => {
      entered();
      await hold;
    });
    await ready;
    try {
      await expect(
        withSessionLock(directory, async () => {
          throw new Error('must not run');
        }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      release();
      await first;
    }
    await expect(withSessionLock(directory, async () => 'reopened')).resolves.toBe('reopened');
  });
  it('preserves a process-crash lock, never removing it to make progress', async () => {
    const directory = await scratch();
    await writeFile(path.join(directory, 'operator.lock'), 'synthetic-interrupted-process');
    await expect(withSessionLock(directory, async () => {})).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(path.join(directory, 'operator.lock'), 'utf8')).toBe(
      'synthetic-interrupted-process',
    );
  });
  it('retains a valid manifest even when a later phase fails', async () => {
    const directory = await scratch();
    await expect(
      withSessionLock(directory, async () => {
        await saveSession(directory, { ...sample, phase: 'auth_started' });
        throw new Error('simulated transport timeout');
      }),
    ).rejects.toThrow('simulated transport timeout');
    expect((await readSession(directory))?.phase).toBe('auth_started');
    expect(await readdir(directory)).toEqual(['session.json']);
  });
  it('does not reinterpret malformed or oversized manifests as an absent fixture', async () => {
    const directory = await scratch();
    expect(await readSession(directory)).toBeNull();
    await writeFile(path.join(directory, 'session.json'), '{');
    await expect(readSession(directory)).rejects.toThrow();
    await writeFile(path.join(directory, 'session.json'), ' '.repeat(16385));
    await expect(readSession(directory)).rejects.toThrow('Invalid operator manifest');
  });
});
