/** Operator-only SELECTs. This script never invokes the migrator or a provider. */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readFrozenRelease, checkReleaseDatabase } from './abacatepay-release-validation';

let stage = 'input';
try {
  const { values } = parseArgs({
    options: {
      release: { type: 'string' },
      ref: { type: 'string' },
      project: { type: 'string' },
      phase: { type: 'string', default: 'before' },
    },
  });
  const phase = z.enum(['before', 'after']).parse(values.phase);
  const project = z
    .string()
    .regex(/^[a-z]{20}$/u)
    .parse(values.project);
  if (project === 'pqhkirrszzpwezdaqrai' || process.env.SUPABASE_PROJECT_ENV !== 'prod')
    throw new Error('Explicit approved production target required');
  const target = z.url().parse(process.env.DATABASE_URL_PROD);
  const url = new URL(target);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.pooler.supabase.com') ||
    url.searchParams.get('sslmode') !== 'require' ||
    decodeURIComponent(url.username).split('.').at(-1) !== project
  )
    throw new Error('Target fingerprint differs');
  const folder = path.join(
    path.resolve(z.string().min(1).parse(values.release)),
    'drizzle/migrations',
  );
  const plan = await readFrozenRelease(folder, z.string().min(1).parse(values.ref));
  stage = 'read_only_catalogs';
  // Keep the repository's single connection origin. The operator must load
  // the approved Production environment; this script never loads a DEV .env.
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: target,
    DATABASE_URL_RUNTIME: target,
  });
  const { dbAdmin } = await import('../src/lib/db');
  const sql = dbAdmin.$client;
  try {
    const proof = await checkReleaseDatabase(sql, plan, phase);
    console.log(
      JSON.stringify({
        status: 'PASS_READ_ONLY_PREFLIGHT',
        financial: plan.financial,
        phase,
        targetFingerprint: createHash('sha256').update(project).digest('hex'),
        ...proof,
        productionWrites: 0,
        providerCalls: 0,
        authorizationToApply: false,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
} catch {
  console.error(
    JSON.stringify({
      status: 'BLOCKED_PREFLIGHT',
      stage,
      detailsSuppressed: true,
      productionWrites: 0,
      providerCalls: 0,
      action:
        'Stop; compare approved Git inputs, target history and critical schema; never repair history to pass',
    }),
  );
  process.exitCode = 1;
}
