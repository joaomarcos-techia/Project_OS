/** Local operator state, separate from the application's financial journal. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { OFFER_2026_PLAN_CODES, quoteProposedOffer } from '../src/contexts/billing/proposed-offer';

export const DEV_REF = 'pqhkirrszzpwezdaqrai';
export const BILLING_BRANCH = 'feat/billing-abacatepay-20261107';
const CHECKOUT_BASELINE_MIGRATIONS = 143;
const CRITICAL_MIGRATION_FIRST_INDEX = 136;
const CRITICAL_MIGRATION_LAST_INDEX = 142;
// Reviewed read-only in the parallel TISS branch. This recognizes its exact
// additive catalog migration in shared DEV; it never runs or copies that module.
const REVIEWED_PARALLEL_DEV_MIGRATION = {
  tag: '0143_tiss_catalog',
  when: 1794330000000,
  hash: '9f9b483aaeff60a9ca4f5b182c3b071408a7d3eec9ecea7cfe8f98bcf602e807',
} as const;
const migrationHash = z.string().regex(/^[a-f0-9]{64}$/);
const migrationEntry = z.object({
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  when: z.number().int().positive(),
  hash: migrationHash,
});
export type CheckoutRequiredMigration = z.infer<typeof migrationEntry>;

export async function readCheckoutRequiredMigrations(): Promise<CheckoutRequiredMigration[]> {
  const journal = z
    .object({
      entries: z.array(
        z.object({
          idx: z.number().int().nonnegative(),
          when: z.number().int().positive(),
          tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
        }),
      ),
    })
    .parse(JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')));
  const entries = journal.entries.filter(
    (entry) =>
      entry.idx >= CRITICAL_MIGRATION_FIRST_INDEX && entry.idx <= CRITICAL_MIGRATION_LAST_INDEX,
  );
  if (entries.length !== CRITICAL_MIGRATION_LAST_INDEX - CRITICAL_MIGRATION_FIRST_INDEX + 1)
    throw new Error('Missing required checkout migration files');
  return Promise.all(
    entries.map(async (entry) => ({
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256')
        .update(await readFile(path.join('drizzle/migrations', `${entry.tag}.sql`)))
        .digest('hex'),
    })),
  );
}

/** Preserve the required financial prefix; reject unreviewed shared-DEV drift. */
export function assertCheckoutDevHistory(
  historyCount: number,
  rows: unknown,
  requiredInput: CheckoutRequiredMigration[],
): { migrations: number; parallelMigrations: string[] } {
  const required = z
    .array(migrationEntry)
    .length(CRITICAL_MIGRATION_LAST_INDEX - CRITICAL_MIGRATION_FIRST_INDEX + 1)
    .parse(requiredInput);
  const applied = z
    .array(z.object({ hash: migrationHash, created_at: z.string().regex(/^\d+$/) }))
    .parse(rows);
  if (new Set(applied.map((row) => row.created_at)).size !== applied.length)
    throw new Error('Duplicate checkout migration timestamp');
  const requiredTimes = new Set(required.map((entry) => String(entry.when)));
  if (requiredTimes.size !== required.length)
    throw new Error('Duplicate required migration timestamp');
  for (const entry of required) {
    const actual = applied.find((row) => row.created_at === String(entry.when));
    if (actual?.hash !== entry.hash) throw new Error('Required checkout migration differs');
  }
  const extras = applied.filter((row) => !requiredTimes.has(row.created_at));
  if (
    extras.some(
      (row) =>
        row.created_at !== String(REVIEWED_PARALLEL_DEV_MIGRATION.when) ||
        row.hash !== REVIEWED_PARALLEL_DEV_MIGRATION.hash,
    )
  )
    throw new Error('Unreviewed parallel DEV migration');
  if (historyCount !== CHECKOUT_BASELINE_MIGRATIONS + extras.length)
    throw new Error('Unexpected DEV migration count');
  return {
    migrations: historyCount,
    parallelMigrations: extras.map(() => REVIEWED_PARALLEL_DEV_MIGRATION.tag),
  };
}
export const entryPlan = z.enum(OFFER_2026_PLAN_CODES);
export const previewOrigin = z
  .url()
  .refine((raw) => {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      /^project-[a-z0-9-]+-clinic-os-v2-s-projects\.vercel\.app$/.test(url.hostname)
    );
  })
  .transform((value) => new URL(value).origin);
export const checkoutUrl = z.url().refine((raw) => {
  const url = new URL(raw);
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    ['app.abacatepay.com', 'pay.abacatepay.com'].includes(url.hostname)
  );
});
const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`));
// Drizzle's canonical postgres client returns timestamps as strings, while a
// standalone postgres client can return Date. Normalize both before comparing.
const databaseDate = z.union([z.date(), z.string().min(1)]).pipe(z.coerce.date());
const count = z.number().int().nonnegative();
export const checkoutSnapshotSchema = z.object({
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  external_checkout_id: prefixed('bill').nullable(),
  external_subscription_id: prefixed('subs').nullable(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  released_at: databaseDate.nullable(),
  trial_end: databaseDate,
  period_start: databaseDate.nullable(),
  period_end: databaseDate.nullable(),
  url: checkoutUrl.nullable(),
  paid_invoices: count,
  invoices: count,
  attempts: count,
  receipts: count,
  applied_events: count,
  operations: count,
});
export type CheckoutSnapshot = z.infer<typeof checkoutSnapshotSchema>;
export const sessionSchema = z
  .object({
    version: z.literal(1),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    origin: previewOrigin,
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    storeHash: z.string().regex(/^[a-f0-9]{64}$/),
    plan: entryPlan,
    planId: z.uuid(),
    productId: prefixed('prod'),
    amountMinor: z.number().int().positive(),
    phase: z.enum([
      'prepared',
      'auth_started',
      'auth_ready',
      'checkout_started',
      'awaiting_payment',
      'verified',
    ]),
    userId: z.uuid().nullable(),
    checkoutId: prefixed('bill').nullable(),
    url: checkoutUrl.nullable(),
    // This is a draft token HASH, never a login/session token.
    draftTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    retention: z.literal('retain_until_reconciled_no_automatic_cleanup'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amountMinor !== expectedAmount(value.plan))
      context.addIssue({ code: 'custom', message: 'Unexpected fixture amount' });
    if (value.phase !== 'prepared' && value.phase !== 'auth_started' && !value.userId)
      context.addIssue({ code: 'custom', message: 'Missing fixture identity' });
    if (
      (value.phase === 'awaiting_payment' || value.phase === 'verified') &&
      (!value.checkoutId || !value.url)
    )
      context.addIssue({ code: 'custom', message: 'Missing checkout correlation' });
  });
export type CheckoutSession = z.infer<typeof sessionSchema>;
export function expectedAmount(plan: z.infer<typeof entryPlan>): number {
  const quote = quoteProposedOffer(OFFER_2026_PLAN_CODES.indexOf(plan) + 1);
  if (!quote) throw new Error('Unsupported checkout plan');
  return quote.monthly * 100;
}
export function guardedDevDatabase(raw: string): string {
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    decodeURIComponent(url.username) !== `postgres.${DEV_REF}` ||
    !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
  )
    throw new Error('Expected the identified DEV database');
  if (url.port === '6543') url.port = '5432';
  return url.toString();
}
export function assertSamePreparation(
  saved: CheckoutSession,
  current: Pick<
    CheckoutSession,
    'origin' | 'sha' | 'storeHash' | 'plan' | 'planId' | 'productId' | 'amountMinor'
  >,
): void {
  for (const key of [
    'origin',
    'sha',
    'storeHash',
    'plan',
    'planId',
    'productId',
    'amountMinor',
  ] as const)
    if (saved[key] !== current[key])
      throw new Error('Prepared fixture/environment changed; reconcile before continuing');
}

/** Exclusive filesystem lock. Crashes leave the lock for an operator to investigate. */
export async function withSessionLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  if (!path.isAbsolute(directory)) throw new Error('Absolute operator directory required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid operator directory');
  const lockPath = path.join(directory, 'operator.lock');
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.sync();
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}
export async function readSession(directory: string): Promise<CheckoutSession | null> {
  const file = path.join(directory, 'session.json');
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384)
    throw new Error('Invalid operator manifest');
  return sessionSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}
export async function saveSession(directory: string, session: CheckoutSession): Promise<void> {
  const data = JSON.stringify(sessionSchema.parse(session), null, 2);
  const temporary = path.join(directory, `${randomUUID()}.pending`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path.join(directory, 'session.json'));
}
