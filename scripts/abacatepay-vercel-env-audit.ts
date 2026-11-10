/** Read-only metadata audit. Never requests decrypted values or writes Vercel configuration. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { z } from 'zod';

import { BILLING_BRANCH, previewOrigin } from './abacatepay-checkout-session';

const PROJECT = 'prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ';
const TEAM = 'team_ml9fFeF262JqUMwFB6Vy61Cj';
const relatedNames = new Set([
  'SAAS_SIGNUP_PROVIDER',
  'SIGNUP_ENABLED',
  'SIGNUP_AUTH_ENABLED',
  'SIGNUP_IDENTITY_ENABLED',
  'SIGNUP_CHECKOUT_ENABLED',
  'OFFER_2026_ANNUAL_NEW_SALES_ENABLED',
  'APP_BASE_URL',
  'DATABASE_URL',
  'DATABASE_URL_RUNTIME',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PROJECT_ENV',
  'MAGIC_TOKEN_SECRET',
  'LOGIN_HASH_PEPPER',
  'CRON_SECRET',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'TURNSTILE_SECRET_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'RESEND_WEBHOOK_SECRET',
  'CRON_SECRET_DESTRUCTIVE',
  'LOGTAIL_SOURCE_TOKEN',
  'LOGTAIL_URL',
  'NEXT_PUBLIC_SENTRY_DSN',
]);
export function billingEnvironmentName(name: string): boolean {
  return (
    /ABACATEPAY|^ASAAS_|^PAYMENTS_|^BILLING_|^CRYPTO_|^GCP_|^UPSTASH_|^SENTRY_/.test(name) ||
    relatedNames.has(name)
  );
}
const variableSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  target: z.array(z.string()).optional().default([]),
  gitBranch: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export function sanitizedVercelVariables(input: unknown) {
  const parsed = z.object({ envs: z.array(variableSchema).max(2000) }).parse(input);
  return parsed.envs
    .map((row) => ({ ...row }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
}
export function effectiveVercelVariable(
  rows: ReturnType<typeof sanitizedVercelVariables>,
  name: string,
  target: 'preview' | 'production' | 'development',
  branch: string,
) {
  const matching = rows.filter((row) => row.key === name && row.target.includes(target));
  const specific = target === 'preview' ? matching.filter((row) => row.gitBranch === branch) : [];
  const chosen = specific.length ? specific : matching.filter((row) => row.gitBranch === null);
  return {
    status: chosen.length === 0 ? 'absent' : chosen.length === 1 ? 'configured' : 'ambiguous',
    scope: specific.length ? 'branch' : 'general',
    ids: chosen.map((row) => row.id),
    updatedAt: chosen.length === 1 ? (chosen[0]?.updatedAt ?? null) : null,
  };
}

async function sourceConsumers(directory: string): Promise<Record<string, string[]>> {
  const found = new Map<string, Set<string>>();
  async function scan(file: string): Promise<void> {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        (node.expression.getText(source) === 'env' ||
          node.expression.getText(source) === 'process.env') &&
        billingEnvironmentName(node.name.text)
      ) {
        const refs = found.get(node.name.text) ?? new Set<string>();
        refs.add(
          `${path.relative(process.cwd(), file).replaceAll('\\', '/')}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
        found.set(node.name.text, refs);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
        continue;
      await scan(file);
    }
  }
  await walk(directory);
  for (const file of ['next.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) {
    await scan(path.resolve(file));
  }
  return Object.fromEntries(
    [...found.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, refs]) => [name, [...refs].sort()]),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { preview: { type: 'string' }, 'vercel-cli': { type: 'string' } },
    strict: true,
  });
  const origin = previewOrigin.parse(values.preview);
  const cli = z.string().min(1).parse(values['vercel-cli']);
  assert.ok(path.isAbsolute(cli));
  function readApi(endpoint: string): unknown {
    assert.ok(endpoint.startsWith('/v10/projects/') || endpoint.startsWith('/v13/deployments/'));
    return JSON.parse(
      execFileSync(process.execPath, [cli, 'api', endpoint, '--raw'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
        maxBuffer: 8_388_608,
      }),
    );
  }
  const rows = sanitizedVercelVariables(
    readApi(`/v10/projects/${PROJECT}/env?teamId=${TEAM}&decrypt=false`),
  );
  const deployment = z
    .object({
      projectId: z.literal(PROJECT),
      readyState: z.literal('READY'),
      target: z.string().nullable().optional(),
      createdAt: z.number(),
      meta: z.object({
        githubCommitRef: z.literal(BILLING_BRANCH),
        githubCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
      }),
    })
    .parse(readApi(`/v13/deployments/${new URL(origin).hostname}?teamId=${TEAM}`));
  assert.notEqual(deployment.target, 'production');
  const consumers = await sourceConsumers(path.resolve('src'));
  const names = [
    ...new Set([
      ...Object.keys(consumers),
      ...rows.map((row) => row.key).filter(billingEnvironmentName),
    ]),
  ].sort();
  const result = {
    observedAt: new Date().toISOString(),
    projectId: PROJECT,
    branch: BILLING_BRANCH,
    mode: 'metadata_only_decrypt_false_no_values_requested_or_persisted',
    deployment: { origin, sha: deployment.meta.githubCommitSha, createdAt: deployment.createdAt },
    variables: names.map((name) => {
      const preview = effectiveVercelVariable(rows, name, 'preview', BILLING_BRANCH);
      return {
        name,
        consumers: consumers[name] ?? [],
        declarations: rows.filter((row) => row.key === name),
        development: effectiveVercelVariable(rows, name, 'development', BILLING_BRANCH),
        preview,
        production: effectiveVercelVariable(rows, name, 'production', BILLING_BRANCH),
        previewMetadataUpdatedAfterDeployment:
          preview.updatedAt !== null && preview.updatedAt > deployment.createdAt,
      };
    }),
    unrelatedVariableNames: [
      ...new Set(rows.map((row) => row.key).filter((name) => !billingEnvironmentName(name))),
    ].sort(),
    valuesExposed: false,
    configurationChanges: 0,
    productionWrites: 0,
  };
  await writeFile(
    'dist/abacatepay-vercel-env-audit-20261110.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      variables: names.length,
      preview: origin,
      sha: deployment.meta.githubCommitSha,
      apiKey: result.variables.find((row) => row.name === 'ABACATEPAY_API_KEY'),
      valuesExposed: false,
      configurationChanges: 0,
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      JSON.stringify({
        status: 'BLOCKED',
        sensitiveDetailsSuppressed: true,
        configurationChanges: 0,
        productionWrites: 0,
      }),
    );
    process.exitCode = 1;
  });
}
