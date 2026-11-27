/** Incident readback only. There is deliberately no deploy/delete/env-run path. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const AUXILIARY_ID = 'prj_htYpK9lthoj7LG78fVa8JsH3VzRn';
const AUXILIARY_NAME = 'run-scale-preview-redis';
const TEAM_ID = 'team_ml9fFeF262JqUMwFB6Vy61Cj';
const QORO_ID = 'prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ';
const cli = z
  .string()
  .refine(
    (value) => isAbsolute(value) && /[/\\]vercel[/\\]dist[/\\]vc\.js$/.test(value),
    'Pass the absolute installed official Vercel CLI file',
  )
  .parse(process.argv[2]);
const paths = [
  `/v9/projects/${AUXILIARY_ID}?teamId=${TEAM_ID}`,
  `/v9/projects/${AUXILIARY_ID}/domains?teamId=${TEAM_ID}&limit=100`,
  `/v9/projects/${QORO_ID}?teamId=${TEAM_ID}`,
];
function command(args: string[]): unknown {
  // Fixed read-only command families. Unknown syntax is never sent to the CLI
  // (its default command can create a deployment).
  assert.ok(
    (args[0] === 'api' &&
      paths.includes(args[1] ?? '') &&
      args[2] === '--method' &&
      args[3] === 'GET') ||
      JSON.stringify(args) ===
        JSON.stringify([
          'integration',
          'list',
          AUXILIARY_NAME,
          '--scope',
          'clinic-os-v2-s-projects',
          '--json',
        ]),
  );
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
    }),
  );
}
const aux = z
  .object({
    id: z.literal(AUXILIARY_ID),
    name: z.literal(AUXILIARY_NAME),
    accountId: z.literal(TEAM_ID),
    env: z.array(z.object({ key: z.string() })).optional(),
    link: z.unknown().optional(),
  })
  .parse(command(['api', paths[0] ?? '', '--method', 'GET', '--raw']));
const domains = z
  .object({
    domains: z.array(z.object({ name: z.string(), projectId: z.literal(AUXILIARY_ID) })),
    pagination: z.object({ next: z.number().nullable() }).optional(),
  })
  .parse(command(['api', paths[1] ?? '', '--method', 'GET', '--raw']));
assert.ok(domains.pagination?.next == null, 'Incomplete domain pagination');
const qoro = z
  .object({
    id: z.literal(QORO_ID),
    targets: z.object({
      production: z.object({ id: z.string(), meta: z.object({ githubCommitSha: z.string() }) }),
    }),
  })
  .parse(command(['api', paths[2] ?? '', '--method', 'GET', '--raw']));
let integrationResources: unknown;
try {
  integrationResources = command([
    'integration',
    'list',
    AUXILIARY_NAME,
    '--scope',
    'clinic-os-v2-s-projects',
    '--json',
  ]);
} catch {
  integrationResources = null;
}
// Only a verified empty list is proof of no linked Marketplace resource. Never
// print an unknown response that might contain configuration or credentials.
const resources = z
  .union([z.array(z.unknown()), z.object({ resources: z.array(z.unknown()) })])
  .safeParse(integrationResources);
const emptyResources =
  resources.success &&
  (Array.isArray(resources.data) ? resources.data : resources.data.resources).length === 0;
const result = {
  observedAt: new Date().toISOString(),
  mutations: 0,
  auxiliary: {
    id: aux.id,
    name: aux.name,
    teamId: aux.accountId,
    envNames: aux.env?.map((v) => v.key) ?? [],
    gitLinked: aux.link != null,
    domains: domains.domains.map((v) => v.name),
    customDomains: domains.domains
      .filter((v) => !v.name.endsWith('.vercel.app'))
      .map((v) => v.name),
    marketplaceResourceCheck: emptyResources ? 'PASS_EMPTY' : 'NOT_PROVEN_RESPONSE_SUPPRESSED',
    resourceResponseShape:
      integrationResources === null
        ? 'unavailable'
        : Array.isArray(integrationResources)
          ? 'array'
          : typeof integrationResources,
  },
  qoroProduction: {
    projectId: qoro.id,
    deploymentId: qoro.targets.production.id,
    sha: qoro.targets.production.meta.githubCommitSha,
  },
  deletion: 'NOT_AUTHORIZED_NOT_EXECUTED',
  otherAgentUse: 'No Git link; independent owner confirmation still required before deletion',
  cost: 'Not measured; no zero-cost claim',
};
await mkdir('dist', { recursive: true });
await writeFile('dist/vercel-auxiliary-preflight.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
