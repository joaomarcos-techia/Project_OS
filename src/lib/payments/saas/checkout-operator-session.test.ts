import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSamePreparation,
  assertFixtureAuthReadiness,
  assertCheckoutDevHistory,
  checkoutUrl,
  checkoutSnapshotSchema,
  expectedAmount,
  guardedDevDatabase,
  previewOrigin,
  readSession,
  readCheckoutRequiredMigrations,
  readReviewedCheckoutMigrations,
  checkoutScenario,
  saveSession,
  sandboxWebhookName,
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
  it('accepts only the reviewed Sandbox webhook identities', () => {
    expect(sandboxWebhookName.parse('[SANDBOX] Qoro trial deferred 20261108')).toBeDefined();
    expect(sandboxWebhookName.parse('[SANDBOX] Qoro PR64 Pix 20261125')).toBeDefined();
    expect(() => sandboxWebhookName.parse('[PRODUCTION] Qoro')).toThrow();
    expect(() => sandboxWebhookName.parse('[SANDBOX] Qoro unknown')).toThrow();
  });
  it('accepts an unused probe for a fresh run and requires the exact Auth marker on resume', () => {
    expect(() => assertFixtureAuthReadiness(null, 404, null)).not.toThrow();
    expect(() => assertFixtureAuthReadiness(sample, 404, null)).not.toThrow();
    expect(() => assertFixtureAuthReadiness(null, 200, {})).toThrow();
    const resumed = { ...sample, userId: 'dc3b7ad9-a829-4821-8cde-9197c8ec0c42' };
    const identity = {
      id: resumed.userId,
      user_metadata: { qoro_fixture_run: resumed.runId },
    };
    expect(() => assertFixtureAuthReadiness(resumed, 200, identity)).not.toThrow();
    expect(() => assertFixtureAuthReadiness(resumed, 404, null)).toThrow();
    expect(() =>
      assertFixtureAuthReadiness(resumed, 200, {
        ...identity,
        user_metadata: { qoro_fixture_run: '07c56fa7-fb2a-4290-9235-b84e81b99950' },
      }),
    ).toThrow();
  });
  const requiredMigrations = Array.from({ length: 7 }, (_, index) => ({
    tag: `0${136 + index}_synthetic`,
    when: 1794000000000 + index,
    hash: (index + 1).toString(16).padStart(64, '0'),
  }));
  const appliedMigrations = requiredMigrations.map((entry) => ({
    hash: entry.hash,
    created_at: String(entry.when),
  }));
  const reviewedTissMigration = {
    hash: '9f9b483aaeff60a9ca4f5b182c3b071408a7d3eec9ecea7cfe8f98bcf602e807',
    created_at: '1794330000000',
  };
  it('keeps the exact financial history valid without a parallel migration', () => {
    expect(assertCheckoutDevHistory(143, appliedMigrations, requiredMigrations)).toEqual({
      migrations: 143,
      parallelMigrations: [],
    });
  });
  it('recognizes only the reviewed additive TISS migration without running it', () => {
    expect(
      assertCheckoutDevHistory(
        144,
        [...appliedMigrations, reviewedTissMigration],
        requiredMigrations,
      ),
    ).toEqual({
      migrations: 144,
      parallelMigrations: ['0143_tiss_catalog'],
    });
  });
  it.each([
    [
      'required financial hash',
      [{ ...appliedMigrations[0], hash: 'f'.repeat(64) }, ...appliedMigrations.slice(1)],
      143,
    ],
    ['missing financial migration', appliedMigrations.slice(1), 143],
    [
      'unknown parallel migration',
      [...appliedMigrations, { hash: 'f'.repeat(64), created_at: '1794330000001' }],
      144,
    ],
    [
      'changed reviewed migration',
      [...appliedMigrations, { ...reviewedTissMigration, hash: 'f'.repeat(64) }],
      144,
    ],
    ['duplicate timestamp', [...appliedMigrations, appliedMigrations[0]], 144],
    ['unexplained count', appliedMigrations, 144],
  ] as const)('rejects %s instead of ignoring shared DEV drift', (_label, applied, count) => {
    expect(() => assertCheckoutDevHistory(count, applied, requiredMigrations)).toThrow();
  });
  it('reads all seven actual trial and billing migration hashes from this checkout', async () => {
    const entries = await readCheckoutRequiredMigrations();
    expect(entries).toHaveLength(7);
    expect(entries[0]?.tag).toBe('0136_trial_resource_limits');
    expect(entries[6]?.tag).toBe('0142_saas_review_replays');
    expect(new Set(entries.map((entry) => entry.hash)).size).toBe(7);
  });
  it('recognizes every exact reviewed migration through 0159, without accepting a partial tail', async () => {
    const reviewed = await readReviewedCheckoutMigrations();
    expect(reviewed).toHaveLength(17);
    expect(reviewed[0]?.tag).toBe('0143_tiss_catalog');
    expect(reviewed.at(-1)?.tag).toBe('0159_saas_period_snapshot');
    const tail = reviewed.map((entry) => ({ hash: entry.hash, created_at: String(entry.when) }));
    expect(
      assertCheckoutDevHistory(160, [...appliedMigrations, ...tail], requiredMigrations, reviewed),
    ).toEqual({ migrations: 160, parallelMigrations: reviewed.map((entry) => entry.tag) });
    expect(() =>
      assertCheckoutDevHistory(
        159,
        [...appliedMigrations, ...tail.slice(0, -1)],
        requiredMigrations,
        reviewed,
      ),
    ).toThrow('Incomplete');
    expect(() =>
      assertCheckoutDevHistory(
        161,
        [...appliedMigrations, ...tail, { hash: 'f'.repeat(64), created_at: '1795036973859' }],
        requiredMigrations,
        reviewed,
      ),
    ).toThrow();
    expect(() =>
      assertCheckoutDevHistory(
        160,
        [...appliedMigrations, ...tail.slice(0, -1), { ...tail.at(-1), hash: 'f'.repeat(64) }],
        requiredMigrations,
        reviewed,
      ),
    ).toThrow();
  });
  it('recognizes the reviewed shared DEV extensions without changing the frozen SaaS list', async () => {
    const reviewed = await readReviewedCheckoutMigrations();
    const frozen = reviewed.map((entry) => ({ hash: entry.hash, created_at: String(entry.when) }));
    const extensions = [
      {
        hash: '718190feffe57a0f0b7ceaf7c28686793209f0c0cb9f4b7bfd6480d4ac1ef306',
        created_at: '1795123373857',
      },
      {
        hash: 'acd23a73e25109c14c1514f6995fbcd81182a51f7338c1bd6c63127f8d0265c5',
        created_at: '1795209773857',
      },
      {
        hash: 'eed2d0dee2b9d59be3b8f707d1c4963541d0b03e3597a73157be8766d481ec68',
        created_at: '1795296173857',
      },
      {
        hash: 'd94b652d1a602167ea0444740f717fce72afada940c703444965a4b7087ce9be',
        created_at: '1795382573857',
      },
      {
        hash: 'da5f8b90fd45b0afe3b307be689f326a25b7719ddcc664f81a714f99341e6ec1',
        created_at: '1795468973857',
      },
      {
        hash: 'a3af4a973f14cc3fb3720423d4c03f71f32330024f028d07191f40f4077c64cb',
        created_at: '1795555373857',
      },
      {
        hash: 'ccf1639b4eccbdd50e5aa5b2f49a0b55d964ff8092dc47c09d77db61487025c6',
        created_at: '1795641773857',
      },
      {
        hash: '7249f069fc5454e74034e1004f3be7d04606c020d7b16244b4014aafc861f3f0',
        created_at: '1795728173857',
      },
      {
        hash: '844cf2f2592edba659bbcc84fa2d9ab3b265b7e688ce60112307db5815be2520',
        created_at: '1795814573857',
      },
    ];
    for (let prefix = 1; prefix <= extensions.length; prefix++) {
      const applied = [...appliedMigrations, ...frozen, ...extensions.slice(0, prefix)];
      expect(
        assertCheckoutDevHistory(160 + prefix, applied, requiredMigrations, reviewed).migrations,
      ).toBe(160 + prefix);
      // The legacy checker cannot use these extensions to skip the frozen release review.
      expect(() => assertCheckoutDevHistory(160 + prefix, applied, requiredMigrations)).toThrow();
    }
    const full = [...appliedMigrations, ...frozen, ...extensions];
    expect(
      assertCheckoutDevHistory(169, full, requiredMigrations, reviewed).parallelMigrations.at(-1),
    ).toBe('0168_saas_pix_replacement_intents');
    for (const extension of extensions) {
      expect(() =>
        assertCheckoutDevHistory(
          169,
          full.map((row) => (row === extension ? { ...row, hash: 'f'.repeat(64) } : row)),
          requiredMigrations,
          reviewed,
        ),
      ).toThrow();
      expect(() =>
        assertCheckoutDevHistory(
          169,
          full.filter((row) => row !== extension),
          requiredMigrations,
          reviewed,
        ),
      ).toThrow();
    }
    // An older contiguous prefix is valid; a hole before a later entry is not.
    for (const extension of extensions.slice(0, -1)) {
      expect(() =>
        assertCheckoutDevHistory(
          168,
          full.filter((row) => row !== extension),
          requiredMigrations,
          reviewed,
        ),
      ).toThrow();
    }
    expect(() =>
      assertCheckoutDevHistory(
        170,
        [
          ...full,
          {
            hash: 'f'.repeat(64),
            created_at: '1795900973857',
          },
        ],
        requiredMigrations,
        reviewed,
      ),
    ).toThrow();
    expect(() =>
      assertCheckoutDevHistory(
        169,
        [{ ...appliedMigrations[0], hash: 'f'.repeat(64) }, ...full.slice(1)],
        requiredMigrations,
        reviewed,
      ),
    ).toThrow();
    expect(await readReviewedCheckoutMigrations()).toEqual(reviewed);
    expect(reviewed).toHaveLength(17);
  });
  it('preserves old expired-trial manifests and pins early-payment scenarios', () => {
    expect(checkoutScenario(sessionSchema.parse(sample))).toBe('expired_trial');
    const staged = sessionSchema.parse({
      ...sample,
      scenario: 'early_payment',
      phase: 'trial_ready',
      userId: sample.planId,
    });
    expect(checkoutScenario(staged)).toBe('early_payment');
    expect(staged.checkoutId).toBeNull();
    expect(() => assertSamePreparation(staged, { ...staged, scenario: 'expired_trial' })).toThrow(
      'scenario',
    );
    expect(sessionSchema.safeParse({ ...sample, scenario: 'invented' }).success).toBe(false);
    expect(
      sessionSchema.safeParse({
        ...staged,
        checkoutId: 'bill_synthetic',
        url: 'https://pay.abacatepay.com/synthetic',
      }).success,
    ).toBe(false);
    expect(sessionSchema.safeParse({ ...staged, scenario: 'expired_trial' }).success).toBe(false);
  });
  const rawSnapshot = {
    subscription_id: sample.planId,
    clinic_id: sample.runId,
    external_checkout_id: 'bill_synthetic',
    external_subscription_id: 'subs_synthetic',
    billing_status: 'active',
    released_at: '2026-11-10 10:00:00+00',
    trial_end: '2026-11-09 10:00:00+00',
    period_start: '2026-11-10 10:00:00+00',
    period_end: '2026-12-10 10:00:00+00',
    url: 'https://pay.abacatepay.com/synthetic',
    paid_invoices: 1,
    invoices: 1,
    attempts: 1,
    receipts: 1,
    applied_events: 1,
    operations: 1,
  };
  it('normalizes timestamp strings from the canonical Drizzle client before payment verification', () => {
    const snapshot = checkoutSnapshotSchema.parse(rawSnapshot);
    expect(snapshot.period_start?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect(snapshot.period_end?.toISOString()).toBe('2026-12-10T10:00:00.000Z');
    expect(snapshot.trial_end.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(snapshot.released_at?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });
  it('accepts Date values from the standalone client and unpaid null fields', () => {
    const snapshot = checkoutSnapshotSchema.parse({
      ...rawSnapshot,
      trial_end: new Date('2026-11-09T10:00:00Z'),
      period_start: null,
      period_end: null,
      released_at: null,
    });
    expect(snapshot.trial_end.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(snapshot.period_end).toBeNull();
    expect(snapshot.released_at).toBeNull();
  });
  it.each([null, 0, '', 'invalid'])(
    'rejects missing or invalid trial timestamps: %j',
    (trialEnd) => {
      expect(
        checkoutSnapshotSchema.safeParse({ ...rawSnapshot, trial_end: trialEnd }).success,
      ).toBe(false);
    },
  );
  it.each([
    ['--preview', 'https://app.qoro.dev'],
    ['--preview', sample.origin, '--session', '../retained'],
    ['--preview', sample.origin, '--webhook-name', '[PRODUCTION] Qoro'],
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
    expect(expectedAmount('clinica_2026_3')).toBe(54400);
    expect(expectedAmount('clinica_2026_4')).toBe(69100);
    expect(expectedAmount('clinica_2026_5')).toBe(83800);
    expect(sessionSchema.safeParse({ ...sample, amountMinor: 100 }).success).toBe(false);
  });
  it.each([
    ['clinica_2026_3', 54400],
    ['clinica_2026_4', 69100],
    ['clinica_2026_5', 83800],
  ])(
    'prepares %s as an initial full-price checkout and rejects the base amount',
    (plan, amountMinor) => {
      expect(sessionSchema.safeParse({ ...sample, plan, amountMinor }).success).toBe(true);
      expect(sessionSchema.safeParse({ ...sample, plan, amountMinor: 39700 }).success).toBe(false);
    },
  );
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
