/** Read-only release checks. Never repairs history or executes migration SQL. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { composeFrozenSaasJournal } from './abacatepay-checkout-session';

type Sql = (typeof import('../src/lib/db'))['dbAdmin']['$client'];

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z.object({
  idx: z.number().int().nonnegative(),
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
  when: z.number().int().positive(),
});
export type ReleaseMigration = z.infer<typeof entry> & { hash: string; acceptedHashes: string[] };
export interface ReleasePlan {
  financial: string;
  migrations: ReleaseMigration[];
  folder: string;
}

export async function readFrozenRelease(
  folder: string,
  financialInput: string,
): Promise<ReleasePlan> {
  const financial = sha.parse(financialInput);
  const gitFile = (ref: string, file: string) =>
    execFileSync('git', ['show', `${ref}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 16 << 20,
      windowsHide: true,
    });
  const manifestPath = 'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json';
  const manifest = z
    .object({
      tissHead: sha,
      financialEntry: entry.extend({ version: z.literal('7'), breakpoints: z.boolean() }),
      financialSql: z.object({ file: z.string(), sha256: checksum }),
    })
    .parse(JSON.parse(gitFile(financial, manifestPath)));
  if (
    manifest.financialSql.file !==
    'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql'
  )
    throw new Error('Unexpected financial SQL path');
  const expected = composeFrozenSaasJournal(
    JSON.parse(gitFile(financial, 'drizzle/migrations/meta/_journal.json')),
    JSON.parse(gitFile(manifest.tissHead, 'drizzle/migrations/meta/_journal.json')),
    manifest.financialEntry,
  );
  const actual = JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Release journal differs from approved Git inputs');
  const files = (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort();
  if (
    JSON.stringify(files) !==
    JSON.stringify(expected.entries.map((item) => item.tag + '.sql').sort())
  )
    throw new Error('Release has missing or unjournaled SQL files');
  const history = z
    .object({
      scalabilityFollowup: z.object({
        sharedDevFinal: z.object({
          historicalDifferenceDetails: z
            .array(z.object({ tag: entry.shape.tag, when: z.string(), appliedHash: checksum }))
            .length(6),
        }),
      }),
    })
    .parse(
      JSON.parse(
        gitFile(
          financial,
          'docs/decoupling/asaas-to-abacatepay/evidencias/recuperacao-financeira-20261111.json',
        ),
      ),
    ).scalabilityFollowup.sharedDevFinal.historicalDifferenceDetails;
  const migrations: ReleaseMigration[] = [];
  for (const item of expected.entries) {
    const relative =
      item.idx === 159 ? manifest.financialSql.file : `drizzle/migrations/${item.tag}.sql`;
    const source = gitFile(
      item.idx >= 143 && item.idx < 159 ? manifest.tissHead : financial,
      relative,
    ).replaceAll('\r\n', '\n');
    const body = (await readFile(path.join(folder, `${item.tag}.sql`), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    if (body !== source || (item.idx === 159 && hash(body) !== manifest.financialSql.sha256))
      throw new Error('Release SQL differs: ' + item.tag);
    const previous = history.find((old) => old.tag === item.tag && old.when === String(item.when));
    migrations.push({
      ...item,
      hash: hash(source),
      acceptedHashes: [
        ...new Set([
          hash(source),
          hash(source.replaceAll('\n', '\r\n')),
          ...(previous ? [previous.appliedHash] : []),
        ]),
      ],
    });
  }
  return { financial, migrations, folder };
}

export function assertReleaseHistory(plan: ReleasePlan, input: unknown, phase: 'before' | 'after') {
  const rows = z
    .array(
      z.object({
        id: z.number().int().positive(),
        hash: checksum,
        created_at: z.string().regex(/^\d+$/u),
      }),
    )
    .parse(input);
  const expectedCount = phase === 'before' ? 136 : 160;
  if (
    plan.migrations.length !== 160 ||
    plan.migrations.some(
      (item, index) =>
        item.idx !== index || (index > 0 && item.when <= plan.migrations[index - 1]!.when),
    )
  )
    throw new Error('Invalid release sequence');
  if (rows.length !== expectedCount) throw new Error('Unexpected applied history length');
  for (const [index, row] of rows.entries()) {
    const item = plan.migrations[index]!;
    if (
      (index > 0 && row.id <= rows[index - 1]!.id) ||
      row.created_at !== String(item.when) ||
      !item.acceptedHashes.includes(row.hash)
    )
      throw new Error('Applied history differs: ' + item.tag);
  }
  return {
    applied: rows.length,
    pending: plan.migrations
      .slice(rows.length)
      .map(({ idx, tag, when, hash: checksumValue }) => ({ idx, tag, when, hash: checksumValue })),
    fingerprint: hash(JSON.stringify(rows)),
  };
}

const coreTables = [
  'public.subscriptions',
  'public.invoices',
  'public.profiles',
  'public.patient_charges',
];
const gatewayTables = [
  'accounts',
  'bindings',
  'cancellations',
  'checkout_intents',
  'event_inbox',
  'operations',
  'paid_checkouts',
  'plan_changes',
  'recontracts',
  'recurring_access_periods',
  'recurring_payment_observations',
  'renewal_api_readbacks',
  'review_replays',
  'statement_scan_items',
  'statement_scans',
  'trial_claims',
].map((name) => 'billing_gateway.' + name);
const schemaFacts = z.object({
  tables: z.array(z.object({ name: z.string(), secured: z.boolean() })),
  billingProviderColumn: z.boolean(),
  futureTables: z.number().int().nonnegative(),
  periodColumns: z.number().int().nonnegative(),
  originTriggers: z.number().int().nonnegative(),
  periodConstraint: z.boolean(),
  invalidGatewayIndexes: z.number().int().nonnegative(),
});
export function assertReleaseSchema(input: unknown, phase: 'before' | 'after') {
  const facts = schemaFacts.parse(input);
  const required =
    phase === 'before'
      ? coreTables
      : [
          ...coreTables,
          ...gatewayTables,
          'public.trial_access_policies',
          'public.trial_resource_usage',
        ];
  for (const name of required)
    if (!facts.tables.some((table) => table.name === name && table.secured))
      throw new Error('Missing or insecure release relation: ' + name);
  if (phase === 'before') {
    if (facts.futureTables !== 0 || facts.billingProviderColumn)
      throw new Error('Future schema exists without its history');
  } else if (
    !facts.billingProviderColumn ||
    facts.periodColumns !== 3 ||
    facts.originTriggers !== 2 ||
    !facts.periodConstraint ||
    facts.invalidGatewayIndexes !== 0
  )
    throw new Error('Incomplete financial schema');
  return {
    requiredSecuredRelations: required.length,
    scope: 'Critical release objects only; not a full schema equivalence certification',
  };
}

/** All statements are catalog/history SELECTs in a mandatory read-only transaction. */
export async function checkReleaseDatabase(sql: Sql, plan: ReleasePlan, phase: 'before' | 'after') {
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL statement_timeout='10s'`;
    await tx`SET LOCAL lock_timeout='2s'`;
    const [mode] = await tx`SELECT current_setting('transaction_read_only') read_only`;
    if (mode?.read_only !== 'on') throw new Error('Read-only transaction required');
    const history = assertReleaseHistory(
      plan,
      Array.from(
        await tx`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`,
      ),
      phase,
    );
    const tables = Array.from(
      await tx`SELECT n.nspname||'.'||c.relname name,c.relrowsecurity AND c.relforcerowsecurity secured FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND (n.nspname='billing_gateway' OR (n.nspname='public' AND c.relname IN ('subscriptions','invoices','profiles','patient_charges','trial_access_policies','trial_resource_usage')))`,
    );
    const [facts] = await tx`SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='billing_provider') AS "billingProviderColumn",
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND (n.nspname='billing_gateway' OR (n.nspname='public' AND c.relname IN ('trial_access_policies','trial_resource_usage')))) AS "futureTables",
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='billing_gateway' AND table_name='recurring_payment_observations' AND column_name IN ('provider_period_start','provider_period_end','source_readback_id')) AS "periodColumns",
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A') AND tgname IN ('subscription_check_gateway_origin','binding_check_subscription_origin')) AS "originTriggers",
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('billing_gateway.recurring_payment_observations') AND conname='recurring_period_snapshot_required' AND convalidated) AS "periodConstraint",
      (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway' AND NOT i.indisvalid) AS "invalidGatewayIndexes"`;
    return {
      history,
      schema: assertReleaseSchema({ ...facts, tables }, phase),
      transaction: 'REPEATABLE READ READ ONLY',
      databaseWrites: 0,
    };
  });
}
