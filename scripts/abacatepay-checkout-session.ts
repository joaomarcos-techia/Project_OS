/** Local operator state, separate from the application's financial journal. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { PROPOSED_OFFER } from '../src/contexts/billing/proposed-offer';

export const DEV_REF = 'pqhkirrszzpwezdaqrai';
export const BILLING_BRANCH = 'feat/billing-abacatepay-20261107';
export const entryPlan = z.enum(['consultorio_2026', 'clinica_2026_2']);
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
  return (
    100 *
    (plan === 'consultorio_2026'
      ? PROPOSED_OFFER.consultorioMonthly
      : PROPOSED_OFFER.clinicaMonthlyForTwo)
  );
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
