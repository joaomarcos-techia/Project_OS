/** DEV/Preview/Sandbox only. `prepare` never creates an Auth user or a checkout. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { z } from 'zod';

import { createAbacatePayReadClient } from '../src/lib/payments/abacatepay/reader';
import { GatewayReadError } from '../src/lib/payments/saas/contracts';
import { initialAbacatePayAccessPeriod } from '../src/contexts/billing/internal/abacatepay-period';
import {
  assertSamePreparation,
  BILLING_BRANCH,
  checkoutUrl,
  checkoutSnapshotSchema,
  DEV_REF,
  entryPlan,
  expectedAmount,
  guardedDevDatabase,
  previewOrigin,
  readSession,
  saveSession,
  withSessionLock,
  type CheckoutSession,
  type CheckoutSnapshot,
} from './abacatepay-checkout-session';

const PROJECT = 'prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ';
const TEAM = 'team_ml9fFeF262JqUMwFB6Vy61Cj';
const PROBE = 'prod_yFBfdSA5twXU3hLREy1YkJtW';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const rows = z.array(z.object({ id: z.uuid(), plan_id: z.uuid(), amount: z.string() })).length(1);
const deploymentSchema = z.object({
  readyState: z.literal('READY'),
  target: z.string().nullable().optional(),
  projectId: z.literal(PROJECT),
  meta: z.object({
    githubCommitRef: z.literal(BILLING_BRANCH),
    githubCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
  }),
});
let stage = 'arguments';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: 'string', default: 'preflight' },
      preview: { type: 'string' },
      'vercel-cli': { type: 'string' },
      'settings-file': { type: 'string', default: 'C:/dev/ClinicaOS_V2/.env.local' },
      session: { type: 'string', default: 'next-checkout-20261110' },
      plan: { type: 'string', default: 'clinica_2026_2' },
    },
    strict: true,
  });
  const action = z.enum(['preflight', 'prepare', 'create', 'verify']).parse(values.action);
  const origin = previewOrigin.parse(values.preview);
  const plan = entryPlan.parse(values.plan);
  const slot = z
    .string()
    .regex(/^next-checkout-[a-z0-9-]{1,50}$/)
    .parse(values.session);
  const cli = z.string().min(1).parse(values['vercel-cli']);
  assert.ok(path.isAbsolute(cli));
  assert.equal(process.platform, 'win32', 'This operator protects credentials with Windows DPAPI');
  const localAppData = z.string().min(1).parse(process.env.LOCALAPPDATA);
  assert.ok(path.isAbsolute(localAppData));
  const directory = path.join(localAppData, 'Qoro', 'SandboxBilling', slot);
  const catalogDirectory = path.join(
    localAppData,
    'Qoro',
    'SandboxBilling',
    'qoro-trial-deferred-20261108',
  );
  const settings = parse(await readFile(values['settings-file'], 'utf8'));
  const apiKey = z.string().min(1).parse(settings.ABACATEPAY_API_KEY);
  const databaseUrl = guardedDevDatabase(z.string().min(1).parse(settings.DATABASE_URL_DEV));
  const magic = z
    .string()
    .min(32)
    .parse(settings.MAGIC_TOKEN_SECRET_DEV ?? settings.MAGIC_TOKEN_SECRET);
  function vercel(endpoint: string): unknown {
    return JSON.parse(
      execFileSync(process.execPath, [cli, 'api', endpoint, '--raw'], {
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
        maxBuffer: 4_194_304,
      }),
    );
  }
  stage = 'deployment_and_project';
  const deployment = deploymentSchema.parse(
    vercel(`/v13/deployments/${new URL(origin).hostname}?teamId=${TEAM}`),
  );
  assert.notEqual(deployment.target, 'production');
  const metadata = z
    .object({
      id: z.literal(PROJECT),
      accountId: z.literal(TEAM),
      protectionBypass: z.record(z.string(), z.object({ scope: z.string() })),
    })
    .parse(vercel(`/v9/projects/${PROJECT}?teamId=${TEAM}`));
  const bypasses = Object.entries(metadata.protectionBypass).filter(
    ([, value]) => value.scope === 'automation-bypass',
  );
  assert.equal(bypasses.length, 1);
  const bypass = z.string().min(1).parse(bypasses[0]?.[0]);
  async function runtimeProof(base: string): Promise<void> {
    const timestamp = Date.now(),
      nonce = randomBytes(32).toString('base64url');
    const signature = createHmac('sha256', magic)
      .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
      .digest('hex');
    const response = await fetch(new URL('/api/signup/runtime-fingerprint', base), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
      headers: {
        'content-type': 'application/json',
        'x-vercel-protection-bypass': bypass,
        'x-qoro-e2e-signature': signature,
      },
      body: JSON.stringify({ timestamp, nonce }),
    });
    assert.equal(response.status, 200);
    z.object({
      environment: z.literal('preview'),
      authProjectRef: z.literal(DEV_REF),
      databaseProjectRef: z.literal(DEV_REF),
    }).parse(await response.json());
  }
  stage = 'signed_dev_runtime';
  await runtimeProof(origin);
  stage = 'dev_auth_admin_readiness';
  const authSecret = z
    .string()
    .min(1)
    .parse(settings.SUPABASE_SECRET_KEY_DEV ?? settings.SECRET_KEY_DEV);
  z.string()
    .min(1)
    .parse(settings.LOGIN_HASH_PEPPER_DEV ?? settings.LOGIN_HASH_PEPPER);
  const retainedIdentity = z
    .object({ userId: z.uuid(), runId: z.uuid() })
    .parse(JSON.parse(await readFile(path.join(catalogDirectory, 'ui-expired.json'), 'utf8')));
  // Read only an already identified synthetic user; never enumerate real accounts.
  const adminProbe = await fetch(
    `https://${DEV_REF}.supabase.co/auth/v1/admin/users/${retainedIdentity.userId}`,
    {
      redirect: 'error',
      headers: { apikey: authSecret, authorization: `Bearer ${authSecret}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert.equal(adminProbe.status, 200);
  const adminUser = z
    .object({ id: z.uuid(), user_metadata: z.object({ qoro_fixture_run: z.uuid() }) })
    .parse(await adminProbe.json());
  assert.equal(adminUser.id, retainedIdentity.userId);
  assert.equal(adminUser.user_metadata.qoro_fixture_run, retainedIdentity.runId);
  const reader = createAbacatePayReadClient({ apiKey, environment: 'sandbox', timeoutMs: 30_000 });
  stage = 'sandbox_store';
  const store = await reader.readStore();
  const catalog = z
    .object({ runId: z.literal('qoro-trial-deferred-20261108'), storeIdSha256: z.string() })
    .parse(JSON.parse(await readFile(path.join(catalogDirectory, 'manifest.json'), 'utf8')));
  assert.equal(hash(store.id), catalog.storeIdSha256);
  stage = 'sandbox_probe';
  await reader.readProduct(PROBE);
  const products = z
    .object({ products: z.object({ consultorio_2026: z.string(), clinica_2026_2: z.string() }) })
    .parse(
      JSON.parse(await readFile(path.join(catalogDirectory, 'products.json'), 'utf8')),
    ).products;
  for (const code of entryPlan.options) {
    stage = `sandbox_product_${code}`;
    const product = await reader.readProduct(products[code]);
    assert.equal(product.price, expectedAmount(code));
    assert.equal(product.currency, 'BRL');
    assert.equal(product.externalId, `qoro-trial-deferred-20261108-${code}`);
    assert.equal(product.cycle, 'MONTHLY');
    assert.equal(product.trialDays ?? null, null);
  }
  stage = 'webhook_target';
  const hooks = await fetch('https://api.abacatepay.com/v2/webhooks/list?limit=100', {
    redirect: 'error',
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(hooks.status, 200);
  const webhooks = z
    .object({
      success: z.literal(true),
      data: z.array(
        z.object({
          id: z.string().startsWith('webh_'),
          name: z.string(),
          endpoint: z.url(),
          devMode: z.boolean(),
          v2: z.boolean(),
          events: z.array(z.string()),
        }),
      ),
      pagination: z.object({ hasMore: z.literal(false) }),
    })
    .parse(await hooks.json());
  const [hook] = webhooks.data.filter(
    (item) => item.name === '[SANDBOX] Qoro trial deferred 20261108',
  );
  assert.equal(
    webhooks.data.filter((item) => item.name === '[SANDBOX] Qoro trial deferred 20261108').length,
    1,
  );
  assert.ok(hook?.devMode && hook.v2 && hook.events.includes('subscription.completed'));
  const target = new URL(hook.endpoint);
  previewOrigin.parse(target.origin);
  assert.equal(target.pathname, '/api/webhooks/abacatepay');
  assert.equal(
    target.searchParams.get('x-vercel-protection-bypass'),
    bypass,
    'Webhook protection credential is stale',
  );
  const targetDeployment = deploymentSchema.parse(
    vercel(`/v13/deployments/${target.hostname}?teamId=${TEAM}`),
  );
  assert.notEqual(targetDeployment.target, 'production');
  assert.equal(
    targetDeployment.meta.githubCommitSha,
    deployment.meta.githubCommitSha,
    'Webhook points to a different release',
  );
  await runtimeProof(target.origin);
  const denied = await fetch(
    new URL('/api/webhooks/abacatepay?webhookSecret=invalid-readiness-probe', origin),
    {
      method: 'POST',
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
      headers: { 'content-type': 'application/json', 'x-vercel-protection-bypass': bypass },
    },
  );
  assert.equal(denied.status, 401);
  // One-shot process only. Bind the canonical pool before its first import;
  // never introduce a new driver origin or inherit a production connection.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DATABASE_URL_RUNTIME: databaseUrl,
    SUPABASE_PROJECT_ENV: 'dev',
    NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_operator_import_only',
  });
  delete process.env.DATABASE_URL_PROD;
  const { dbAdmin } = await import('../src/lib/db');
  const sql = dbAdmin.$client;
  try {
    stage = 'dev_schema_and_catalog';
    const price = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout='15s'`;
      const [schema] =
        await tx`SELECT to_regclass('billing_gateway.review_replays') IS NOT NULL ready`;
      stage = 'dev_history_count';
      const [journal] = await tx`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
      assert.equal(journal?.n, 143);
      assert.equal(schema?.ready, true);
      stage = 'dev_history_latest_hash';
      const [latest] =
        await tx`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC,id DESC LIMIT 1`;
      assert.equal(
        latest?.hash,
        hash(await readFile('drizzle/migrations/0142_saas_review_replays.sql', 'utf8')),
      );
      stage = 'dev_sandbox_account';
      const [account] = await tx`SELECT count(*)::int n FROM billing_gateway.accounts
        WHERE provider='abacatepay' AND environment='sandbox' AND external_account_id=${store.id}`;
      assert.equal(account?.n, 1);
      stage = 'dev_price';
      return rows.parse(
        await tx`SELECT pr.id::text,pr.plan_id::text,pr.amount::text
        FROM public.prices pr JOIN public.plans p ON p.id=pr.plan_id
        WHERE p.code=${plan} AND p.ativo AND pr.billing_cycle='monthly' AND pr.currency='BRL'
          AND pr.active_from<=now() AND pr.active_until IS NULL AND pr.campaign_code IS NULL`,
      )[0];
    });
    assert.ok(price);
    assert.equal(Number(price.amount) * 100, expectedAmount(plan));
    const preparation = {
      origin,
      sha: deployment.meta.githubCommitSha,
      storeHash: hash(store.id),
      plan,
      planId: price.plan_id,
      productId: products[plan],
      amountMinor: expectedAmount(plan),
    };
    const preflight = {
      status: 'PASS',
      stage: 'preflight',
      observedAt: new Date().toISOString(),
      sha: preparation.sha,
      preview: origin,
      plan,
      amountMinor: preparation.amountMinor,
      signedDevRuntime: true,
      devAuthAdminReadiness: true,
      sandboxProducts: 2,
      webhookTargetSameRelease: true,
      invalidWebhookHttp: denied.status,
      databaseHistoryCount: 143,
      newAuthUsers: 0,
      newCheckouts: 0,
      payments: 0,
      productionWrites: 0,
    };
    if (action === 'preflight') {
      console.log(JSON.stringify(preflight));
      return;
    }
    stage = 'local_manifest';
    await withSessionLock(directory, async () => {
      stage = 'local_private_acl';
      // Restrict Windows inheritance as POSIX modes do not establish Windows ACLs.
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference="Stop"; $p=$env:QORO_OPERATOR_DIRECTORY; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw "Unexpected owner" }; if (!$acl.AreAccessRulesProtected) { $acl.SetAccessRuleProtection($true,$false); foreach ($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { $acl.RemoveAccessRuleAll($r) }; $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($p,$acl) }; $verified=Get-Acl -LiteralPath $p; $rules=$verified.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); if (!$verified.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne "Allow" -or ($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw "Private ACL not verified" }',
        ],
        {
          env: { ...process.env, QORO_OPERATOR_DIRECTORY: directory },
          windowsHide: true,
          stdio: 'pipe',
        },
      );
      stage = 'local_manifest_read';
      let saved = await readSession(directory);
      if (!saved) {
        assert.equal(action, 'prepare', 'Prepare a durable fixture before creating a checkout');
        saved = {
          version: 1,
          runId: randomUUID(),
          createdAt: new Date().toISOString(),
          ...preparation,
          phase: 'prepared',
          userId: null,
          checkoutId: null,
          url: null,
          draftTokenHash: randomBytes(32).toString('hex'),
          retention: 'retain_until_reconciled_no_automatic_cleanup',
        };
        await saveSession(directory, saved);
      }
      const session: CheckoutSession = saved;
      stage = 'immutable_preparation';
      assertSamePreparation(session, preparation);
      await writeFile(path.join(directory, 'preflight.json'), JSON.stringify(preflight, null, 2), {
        mode: 0o600,
      });
      const email = `abaca-${session.runId}@example.invalid`;
      const passwordPath = path.join(directory, 'password.dpapi');
      function password(clear?: string): string {
        const command =
          clear === undefined
            ? '$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:QORO_OPERATOR_SECRET),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); try { [Console]::Write([Text.Encoding]::UTF8.GetString($b)) } finally { [Array]::Clear($b,0,$b.Length) }'
            : '$b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); try { $c=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $f=[IO.File]::Open($env:QORO_OPERATOR_SECRET,[IO.FileMode]::CreateNew); try { $f.Write($c,0,$c.Length); $f.Flush($true) } finally { $f.Dispose() } } finally { [Array]::Clear($b,0,$b.Length) }';
        return execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Add-Type -AssemblyName System.Security; $ErrorActionPreference="Stop"; ${command}`,
          ],
          {
            env: { ...process.env, QORO_OPERATOR_SECRET: passwordPath },
            ...(clear === undefined ? {} : { input: clear }),
            windowsHide: true,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
      }
      if (action === 'prepare') {
        stage = 'protected_local_credentials';
        try {
          const stat = await lstat(passwordPath);
          assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 4096);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
            throw error;
          assert.equal(session.phase, 'prepared');
          password(`Qoro!${randomBytes(30).toString('base64url')}`);
        }
        assert.ok(password().length >= 32);
        console.log(
          JSON.stringify({
            ...preflight,
            stage: 'prepared',
            runId: session.runId,
            phase: session.phase,
            retention: session.retention,
            credentials: 'DPAPI_CurrentUser_private_ACL_roundtrip_verified',
            manifest: path.join(directory, 'session.json'),
          }),
        );
        return;
      }
      if (action === 'create' && !session.userId) {
        stage = 'fixture_identity';
        const found =
          await sql`SELECT id::text,raw_user_meta_data->>'qoro_fixture_run' marker FROM auth.users WHERE email=${email}`;
        assert.ok(found.length <= 1);
        if (found[0]) {
          assert.equal(found[0].marker, session.runId);
          session.userId = z.uuid().parse(found[0].id);
        } else {
          assert.equal(
            session.phase,
            'prepared',
            'Auth outcome unknown: do not create another identity',
          );
          assert.ok(password().length >= 32);
          session.phase = 'auth_started';
          await saveSession(directory, session);
          const auth = await fetch(`https://${DEV_REF}.supabase.co/auth/v1/admin/users`, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            headers: {
              apikey: authSecret,
              authorization: `Bearer ${authSecret}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              email,
              password: password(),
              email_confirm: true,
              user_metadata: {
                qoro_fixture_run: session.runId,
                name: 'Titular sintético AbacatePay',
              },
            }),
          });
          assert.equal(auth.status, 200);
          session.userId = z.object({ id: z.uuid() }).parse(await auth.json()).id;
        }
        session.phase = 'auth_ready';
        await saveSession(directory, session);
      }
      assert.ok(session.userId, 'No fixture identity: request creation first');
      const userId = session.userId;
      const [identity] =
        await sql`SELECT email,email_confirmed_at,raw_user_meta_data->>'qoro_fixture_run' marker FROM auth.users WHERE id=${userId}::uuid`;
      assert.equal(identity?.email, email);
      assert.equal(identity?.marker, session.runId);
      assert.ok(identity?.email_confirmed_at);
      if (action === 'create' && session.phase === 'auth_ready') {
        stage = 'synthetic_draft';
        const pepper = z
          .string()
          .min(1)
          .parse(settings.LOGIN_HASH_PEPPER_DEV ?? settings.LOGIN_HASH_PEPPER);
        await sql.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout='15s'`;
          await tx`SELECT id FROM auth.users WHERE id=${userId}::uuid FOR UPDATE`;
          const profile = await tx`SELECT id FROM public.profiles WHERE id=${userId}::uuid`;
          assert.equal(profile.length, 0, 'Never move the clock on a provisioned account');
          // Only this identified synthetic identity, before provisioning, simulates an expired trial.
          await tx`UPDATE auth.users SET created_at=${new Date(Date.parse(session.createdAt) - 15 * 86_400_000).toISOString()}::timestamptz
            WHERE id=${userId}::uuid AND email=${email} AND raw_user_meta_data->>'qoro_fixture_run'=${session.runId}`;
          await tx`INSERT INTO public.signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,consumed_at,auth_user_id,
            owner_name,clinic_name,email_hash,accepted_at,answered_at,professionals_band,weekly_appointments_band,current_tooling,discovery_source,selected_plan_id)
            VALUES(${session.draftTokenHash},'email_verified',now()+interval '50 minutes',now()+interval '60 minutes',now(),${userId}::uuid,
              'Titular sintético AbacatePay',${`Sandbox Abaca ${session.runId.slice(0, 8)}`},${createHmac('sha256', pepper).update(email).digest('hex')},
              now(),now(),'2_5','21_50','outro_sistema','indicacao_colega',${session.planId}::uuid) ON CONFLICT(auth_user_id) DO NOTHING`;
          const [draft] =
            await tx`SELECT token_hash,selected_plan_id::text FROM public.signup_sessions WHERE auth_user_id=${userId}::uuid`;
          assert.equal(draft?.token_hash, session.draftTokenHash);
          assert.equal(draft?.selected_plan_id, session.planId);
        });
        session.phase = 'checkout_started';
        await saveSession(directory, session);
      }
      async function browser(paid: boolean): Promise<void> {
        const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
        for (const key of [
          'PATH',
          'Path',
          'SystemRoot',
          'WINDIR',
          'TEMP',
          'TMP',
          'USERPROFILE',
          'LOCALAPPDATA',
          'APPDATA',
          'COMSPEC',
          'PATHEXT',
          'NODE_OPTIONS',
        ])
          if (process.env[key]) childEnv[key] = process.env[key];
        Object.assign(childEnv, {
          E2E_BASE_URL: origin,
          DATABASE_URL_DEV: databaseUrl,
          MAGIC_TOKEN_SECRET_DEV: magic,
          VERCEL_AUTOMATION_BYPASS_SECRET: bypass,
          E2E_ARTIFACTS: '0',
          E2E_ABACATEPAY_FIXTURE: 'ALLOW_DEV_ONLY',
          E2E_ABACATEPAY_RUN_ID: session.runId,
          E2E_ABACATEPAY_USER_ID: userId,
          E2E_ABACATEPAY_EMAIL: email,
          E2E_ABACATEPAY_PASSWORD: password(),
          E2E_ABACATEPAY_PLAN: plan,
          E2E_ABACATEPAY_EXPIRED: 'true',
          E2E_ABACATEPAY_EXPECT_PAID: String(paid),
        });
        const result = spawnSync(
          process.execPath,
          [
            'node_modules/@playwright/test/cli.js',
            'test',
            'e2e/abacatepay-trial-preview.spec.ts',
            '--project=chromium',
            '--workers=1',
          ],
          {
            env: childEnv,
            windowsHide: true,
            encoding: 'utf8',
            timeout: 420_000,
            maxBuffer: 4_194_304,
          },
        );
        // Raw Playwright output can contain form values: never persist/print it.
        assert.equal(
          result.status,
          0,
          'Browser journey failed; preserve fixture and inspect sanitized evidence',
        );
      }
      async function snapshot(): Promise<CheckoutSnapshot | null> {
        const result = z
          .array(checkoutSnapshotSchema)
          .max(1)
          .parse(
            await sql`SELECT s.id::text subscription_id,s.clinic_id::text,b.external_checkout_id,b.external_subscription_id,
          s.billing_status,t.released_at,s.trial_ends_at trial_end,s.current_period_start period_start,s.current_period_end period_end,
          (SELECT result->>'checkoutUrl' FROM billing_gateway.operations WHERE subscription_id=s.id AND kind='create_checkout' AND state='confirmed') url,
          (SELECT count(*)::int FROM public.invoices WHERE subscription_id=s.id AND status='paid' AND total_amount=${session.amountMinor / 100}) paid_invoices,
          (SELECT count(*)::int FROM public.invoices WHERE subscription_id=s.id) invoices,
          (SELECT count(*)::int FROM public.payment_attempts a JOIN public.invoices i ON i.id=a.invoice_id WHERE i.subscription_id=s.id AND a.provider='abacatepay' AND a.status='confirmed') attempts,
          (SELECT count(*)::int FROM billing_gateway.paid_checkouts WHERE subscription_id=s.id) receipts,
          (SELECT count(*)::int FROM billing_gateway.event_inbox WHERE subscription_id=s.id AND event_type='subscription.completed' AND state='applied') applied_events,
          (SELECT count(*)::int FROM billing_gateway.operations WHERE subscription_id=s.id AND kind='create_checkout') operations
          FROM public.profiles p JOIN public.subscriptions s ON s.clinic_id=p.clinic_id
          JOIN billing_gateway.bindings b ON b.subscription_id=s.id JOIN public.trial_access_policies t ON t.subscription_id=s.id
          JOIN billing_gateway.accounts a ON a.id=b.account_id
          WHERE p.id=${userId}::uuid AND p.role='owner' AND p.ativo AND s.billing_provider='abacatepay'
            AND a.environment='sandbox' AND a.external_account_id=${store.id}`,
          );
        return result[0] ?? null;
      }
      stage = 'checkout_or_verification';
      let local = await snapshot();
      if (action === 'create' && !local?.external_checkout_id) {
        await browser(false);
        local = await snapshot();
      }
      assert.ok(local?.external_checkout_id && local.url);
      if (session.checkoutId) assert.equal(local.external_checkout_id, session.checkoutId);
      session.checkoutId = local.external_checkout_id;
      session.url = checkoutUrl.parse(local.url);
      const financial = await reader.readSubscriptionCheckoutFinancials(session.checkoutId);
      assert.equal(financial.amount, session.amountMinor);
      assert.equal(financial.items.length, 1);
      assert.equal(financial.items[0]?.id, session.productId);
      assert.equal(financial.items[0]?.quantity, 1);
      assert.equal(local.operations, 1);
      const subscriptions = await reader.listSubscriptionsForCheckout(session.checkoutId);
      if (
        financial.status === 'PENDING' &&
        (financial.paidAmount === null || financial.paidAmount === 0)
      ) {
        assert.equal(subscriptions.length, 0);
        assert.equal(local.paid_invoices, 0);
        assert.equal(local.invoices, 0);
        assert.equal(local.released_at, null);
        session.phase = 'awaiting_payment';
        await saveSession(directory, session);
        console.log(
          JSON.stringify({
            status: 'PARTIAL',
            stage: 'awaiting_human_sandbox_payment',
            runId: session.runId,
            amountMinor: session.amountMinor,
            checkoutId: session.checkoutId,
            ...(action === 'create' ? { checkoutUrl: session.url } : {}),
            newPaymentExecuted: false,
            retention: session.retention,
          }),
        );
        return;
      }
      assert.equal(financial.status, 'PAID');
      assert.equal(financial.paidAmount, session.amountMinor);
      assert.equal(subscriptions.length, 1);
      const remote = subscriptions[0];
      assert.ok(remote);
      assert.equal(remote.amount, session.amountMinor);
      assert.equal(remote.method, 'CARD');
      assert.equal(remote.trialEndsAt, null);
      assert.equal(remote.customerId, financial.customerId);
      // A paid provider page alone does not prove webhook delivery or local entitlement.
      if (local.applied_events < 1 || !local.released_at) {
        await saveSession(directory, session);
        console.log(
          JSON.stringify({
            status: 'PARTIAL',
            stage: 'paid_awaiting_webhook_reconciliation',
            runId: session.runId,
            checkoutId: session.checkoutId,
            paidAmountMinor: financial.paidAmount,
            newCheckoutAllowed: false,
          }),
        );
        return;
      }
      assert.equal(remote.id, local.external_subscription_id);
      assert.equal(remote.status, 'ACTIVE');
      assert.equal(local.billing_status, 'active');
      assert.ok(local.period_end && local.period_end.getTime() > Date.now());
      const expectedPeriod = initialAbacatePayAccessPeriod({
        subscriptionCreatedAt: remote.createdAt ?? null,
        trialEndsAt: local.trial_end,
        now: new Date(),
      });
      assert.ok(expectedPeriod);
      assert.equal(local.period_start?.toISOString(), expectedPeriod.start.toISOString());
      assert.equal(local.period_end.toISOString(), expectedPeriod.end.toISOString());
      assert.equal(local.paid_invoices, 1);
      assert.equal(local.invoices, 1);
      assert.equal(local.attempts, 1);
      assert.equal(local.receipts, 1);
      await browser(true);
      session.phase = 'verified';
      await saveSession(directory, session);
      const evidence = {
        status: 'PASS',
        stage: 'paid_webhook_database_and_ui',
        observedAt: new Date().toISOString(),
        runId: session.runId,
        sha: session.sha,
        plan,
        amountMinor: session.amountMinor,
        checkoutId: session.checkoutId,
        clinicId: local.clinic_id,
        subscriptionId: local.subscription_id,
        providerSubscriptionId: remote.id,
        paidInvoices: local.paid_invoices,
        confirmedAttempts: local.attempts,
        paidReceipts: local.receipts,
        appliedCompletedEvents: local.applied_events,
        currentPeriodEnd: local.period_end.toISOString(),
        desktopMobile: [1440, 390],
        automaticCleanup: false,
        productionWrites: 0,
      };
      await writeFile(path.join(directory, 'verified.json'), JSON.stringify(evidence, null, 2), {
        mode: 0o600,
      });
      console.log(JSON.stringify(evidence));
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'BLOCKED',
      stage,
      code:
        error instanceof GatewayReadError
          ? error.code
          : error instanceof Error &&
              'code' in error &&
              typeof error.code === 'string' &&
              /^[A-Z0-9_]{1,40}$/.test(error.code)
            ? error.code
            : 'operator_precondition_failed',
      sensitiveDetailsSuppressed: true,
      action: 'preserve_manifest_and_reconcile_do_not_create_another_fixture',
      productionWrites: 0,
    }),
  );
  process.exitCode = 1;
});
