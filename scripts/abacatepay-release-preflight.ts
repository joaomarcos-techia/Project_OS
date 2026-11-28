/** Operator-only SELECTs. This script never invokes the migrator or a provider. */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readFrozenRelease, assertReleaseCatalog } from './abacatepay-release-validation';
import {
  approvedPreflightEnvironment,
  readPreflightCatalog,
} from './abacatepay-preflight-transport';

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
  const context = process.env.SUPABASE_PROJECT_ENV;
  const target = z.url().parse(process.env.DATABASE_URL_PROD);
  const connection = approvedPreflightEnvironment(target, project, {
    ...process.env,
    SUPABASE_PROJECT_ENV: context,
  });
  const folder = path.join(
    path.resolve(z.string().min(1).parse(values.release)),
    'drizzle/migrations',
  );
  const plan = await readFrozenRelease(folder, z.string().min(1).parse(values.ref));
  stage = 'read_only_catalogs';
  // libpq verifies CA and hostname; the runtime pool deliberately isn't imported.
  // No environment file is loaded and credentials never become argv or output.
  const proof = assertReleaseCatalog(plan, readPreflightCatalog(connection), phase);
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
