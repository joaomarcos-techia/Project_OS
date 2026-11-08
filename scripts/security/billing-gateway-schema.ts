/** Real PostgreSQL + existing migrations + candidate DDL; synthetic data, loopback only. */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { executeCommandOnce } from '../../src/lib/payments/saas/command-operation';
import { createAbacatePayWebhookHandler } from '../../src/lib/payments/abacatepay/webhook-handler';
import {
  createPostgresGatewayInbox,
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '../../src/lib/payments/saas/postgres-store';

import { readMigrations, startScratchSchema, type ScratchCluster } from './scratch-schema';

type Sql = ScratchCluster['sql'];
const PORT = 55490;
const POSTGRES_TEXT_OID = 25;
let checks = 0;
async function fixture(sql: Sql, founder = false) {
  const clinicId = randomUUID(),
    ownerId = randomUUID();
  const [catalog] = await sql<{ plan_id: string; price_id: string }[]>`
    select p.id as plan_id,pr.id as price_id from public.plans p join public.prices pr on pr.plan_id=p.id
    where p.code=${founder ? 'clinica' : 'clinica_2026_2'} and pr.billing_cycle='monthly'
      and pr.active_until is null and ((${founder} and pr.campaign_code='fundador')
        or (not ${founder} and pr.campaign_code is null)) limit 1`;
  assert.ok(catalog, 'Missing synthetic catalog');
  await sql`insert into auth.users(id,email) values(${ownerId}::uuid,${`${ownerId}@example.invalid`})`;
  await sql`insert into public.clinics(id,slug,nome,status)
    values(${clinicId}::uuid,${`gateway-${clinicId.slice(0, 8)}`},'Synthetic billing fixture','active')`;
  await sql`insert into public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
    values(${ownerId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true,now())`;
  const [subscription] = await sql<{ id: string }[]>`insert into public.subscriptions
    (clinic_id,plan_id,price_id,billing_status,trial_ends_at,asaas_subscription_id,billing_provider)
    values(${clinicId}::uuid,${catalog.plan_id}::uuid,${catalog.price_id}::uuid,'active',now()+interval '14 days',
      ${founder ? 'sub_synthetic_legacy' : null},${founder ? 'asaas' : 'abacatepay'}) returning id::text`;
  assert.ok(subscription);
  return { clinicId, subscriptionId: subscription.id };
}
async function reject(operation: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error && 'code' in error && error.code === code);
    return true;
  });
  checks++;
}
async function snapshot(sql: Sql): Promise<string> {
  const [row] = await sql<{ digest: string }[]>`
    select md5(coalesce(string_agg(row_to_json(s)::text,'' order by s.id),'')) as digest from public.subscriptions s`;
  assert.ok(row);
  return row.digest;
}

async function main(): Promise<void> {
  const existingMigrations = (await readMigrations()).length;
  const cluster = await startScratchSchema({ port: PORT });
  const { sql } = cluster;
  const [directory] = await sql<{ data_directory: string }[]>`show data_directory`;
  assert.ok(directory);
  const normalizedData = path.resolve(directory.data_directory);
  assert.ok(path.basename(path.dirname(normalizedData)).startsWith('qoro-scratch-schema-'));
  let cleanup = 'NOT RUN';
  try {
    assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
    assert.equal(new URL(cluster.url).port, String(PORT));
    const legacy = await fixture(sql, true),
      first = await fixture(sql),
      other = await fixture(sql),
      repositoryContract = await fixture(sql),
      interruptedContract = await fixture(sql);
    const before = await snapshot(sql);
    const [installed] = await sql<
      { ready: boolean }[]
    >`SELECT to_regclass('billing_gateway.bindings') IS NOT NULL ready`;
    assert.equal(installed?.ready, true, '0138 must be installed by the real migration sequence');
    assert.equal(await snapshot(sql), before);
    checks++;
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    await sql`insert into billing_gateway.accounts(id,provider,environment,external_account_id) values
      (${a}::uuid,'abacatepay','sandbox','same_external_id'),
      (${b}::uuid,'asaas','sandbox','same_external_id'),
      (${c}::uuid,'abacatepay','production','same_external_id')`;
    checks++;
    await reject(
      () => sql`update billing_gateway.accounts set environment='production' where id=${a}::uuid`,
      '23514',
    );
    await sql`insert into billing_gateway.bindings(subscription_id,clinic_id,account_id)
      values(${first.subscriptionId}::uuid,${first.clinicId}::uuid,${a}::uuid)`;
    await reject(
      () => sql`insert into billing_gateway.bindings(subscription_id,clinic_id,account_id)
      values(${other.subscriptionId}::uuid,${first.clinicId}::uuid,${a}::uuid)`,
      '23503',
    );
    await reject(
      () => sql`update billing_gateway.bindings set account_id=${b}::uuid
      where subscription_id=${first.subscriptionId}::uuid`,
      '23514',
    );
    await sql`update billing_gateway.bindings set external_customer_id='cust_fixture',external_subscription_id='subs_fixture'
      where subscription_id=${first.subscriptionId}::uuid`;
    await reject(
      () => sql`update billing_gateway.bindings set external_customer_id='cust_other'
      where subscription_id=${first.subscriptionId}::uuid`,
      '23514',
    );
    await reject(
      () => sql`insert into billing_gateway.bindings
      (subscription_id,clinic_id,account_id,external_customer_id,external_subscription_id)
      values(${other.subscriptionId}::uuid,${other.clinicId}::uuid,${a}::uuid,'cust_other','subs_fixture')`,
      '23505',
    );
    await reject(
      () => sql`insert into billing_gateway.operations
      (account_id,operation_id,subscription_id,clinic_id,kind,business_key,request_hash,state)
      values(${b}::uuid,${randomUUID()}::uuid,${first.subscriptionId}::uuid,${first.clinicId}::uuid,
        'create_checkout','wrong_account',${'a'.repeat(64)},'running')`,
      '23503',
    );
    const reservations = await Promise.all(
      Array.from(
        { length: 12 },
        () => sql<{ operation_id: string }[]>`
      insert into billing_gateway.operations(account_id,operation_id,subscription_id,clinic_id,kind,business_key,request_hash,state)
      values(${a}::uuid,${randomUUID()}::uuid,${first.subscriptionId}::uuid,${first.clinicId}::uuid,
        'create_checkout','one_obligation',${'a'.repeat(64)},'running') on conflict do nothing returning operation_id::text`,
      ),
    );
    assert.equal(reservations.flat().length, 1);
    checks++;
    const op = reservations.flat()[0];
    assert.ok(op);
    await reject(
      () => sql`update billing_gateway.operations set request_hash=${'b'.repeat(64)}
      where operation_id=${op.operation_id}::uuid`,
      '23514',
    );
    await sql`update billing_gateway.operations set state='unknown' where operation_id=${op.operation_id}::uuid`;
    await reject(
      () => sql`update billing_gateway.operations set state='running'
      where operation_id=${op.operation_id}::uuid`,
      '23514',
    );
    await sql`update billing_gateway.operations set state='confirmed',result='{"id":"bill_fixture"}'::jsonb
      where operation_id=${op.operation_id}::uuid`;
    checks++;
    await reject(
      () => sql`update billing_gateway.operations set result='{"id":"bill_other"}'::jsonb
      where operation_id=${op.operation_id}::uuid`,
      '23514',
    );
    const events = await Promise.all(
      Array.from(
        { length: 12 },
        () => sql<{ event_id: string }[]>`
      insert into billing_gateway.event_inbox(account_id,event_id,event_type,payload_hash)
      values(${a}::uuid,'log_fixture','subscription.completed',${'c'.repeat(64)})
      on conflict do nothing returning event_id`,
      ),
    );
    assert.equal(events.flat().length, 1);
    checks++;
    await reject(
      () => sql`update billing_gateway.event_inbox set payload_hash=${'d'.repeat(64)}
      where account_id=${a}::uuid and event_id='log_fixture'`,
      '23514',
    );
    await reject(
      () => sql`update billing_gateway.event_inbox
      set subscription_id=${first.subscriptionId}::uuid,clinic_id=${other.clinicId}::uuid
      where account_id=${a}::uuid and event_id='log_fixture'`,
      '23503',
    );
    await sql`update billing_gateway.event_inbox set subscription_id=${first.subscriptionId}::uuid,clinic_id=${first.clinicId}::uuid
      where account_id=${a}::uuid and event_id='log_fixture'`;
    checks++;
    for (const role of ['anon', 'authenticated'] as const) {
      await reject(
        () =>
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx`select * from billing_gateway.event_inbox`;
          }),
        '42501',
      );
    }
    await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      const rows = await tx`select event_id from billing_gateway.event_inbox`;
      assert.equal(rows.length, 1);
    });
    checks++;

    // Compile Drizzle SQL onto the helper's existing, guarded loopback connection.
    // Do not create another connection origin or widen the architecture allowlist.
    const dialect = new PgDialect();
    const database: BillingGatewaySql = {
      execute(statement) {
        const query = dialect.sqlToQuery(statement);
        const parameters = z.array(z.string().nullable()).parse(query.params);
        // Drizzle supplies serialized JSON strings. Bind them as text so the
        // driver does not JSON.stringify them again for a ::jsonb parameter.
        return sql.unsafe(
          query.sql,
          parameters.map((value) => sql.typed(value, POSTGRES_TEXT_OID)),
        );
      },
    };
    const account = {
      provider: 'abacatepay',
      environment: 'sandbox',
      accountId: 'same_external_id',
    } as const;
    const scope = {
      subscriptionId: repositoryContract.subscriptionId,
      clinicId: repositoryContract.clinicId,
      kind: 'create_checkout' as const,
      businessKey: 'repo_obligation',
    };
    await sql`insert into billing_gateway.bindings(subscription_id,clinic_id,account_id) values
      (${repositoryContract.subscriptionId}::uuid,${repositoryContract.clinicId}::uuid,${a}::uuid),
      (${interruptedContract.subscriptionId}::uuid,${interruptedContract.clinicId}::uuid,${a}::uuid)`;
    let commands = 0;
    const execute = async () => {
      commands++;
      return { id: 'bill_repo' as const };
    };
    const resultSchema = z.object({ id: z.literal('bill_repo') });
    const run = (operationId: string, reference = 'same_request') =>
      executeCommandOnce({
        account,
        operationId,
        kind: 'create_checkout',
        parameters: { reference },
        resultSchema,
        execute,
        journal: createPostgresGatewayOperationJournal(account, scope, database),
      });
    const repoRace = await Promise.allSettled(Array.from({ length: 12 }, () => run(randomUUID())));
    assert.ok(repoRace.some((entry) => entry.status === 'fulfilled'));
    assert.equal(commands, 1);
    checks++;
    assert.deepEqual(await run(randomUUID()), { id: 'bill_repo' });
    assert.equal(commands, 1);
    checks++;
    await reject(() => run(randomUUID(), 'different_request'), 'operation_conflict');
    const interruptedScope = {
      ...scope,
      subscriptionId: interruptedContract.subscriptionId,
      clinicId: interruptedContract.clinicId,
      businessKey: 'repo_unknown',
    };
    let interruptedCommands = 0;
    const interrupted = () =>
      executeCommandOnce({
        account,
        operationId: randomUUID(),
        kind: 'create_checkout',
        parameters: {},
        resultSchema,
        journal: createPostgresGatewayOperationJournal(account, interruptedScope, database),
        execute: async () => {
          interruptedCommands++;
          throw new Error('Synthetic provider interruption');
        },
      });
    await reject(interrupted, 'operation_unknown');
    await reject(interrupted, 'operation_unknown');
    assert.equal(interruptedCommands, 1);
    checks++;
    const inbox = createPostgresGatewayInbox(account, database);
    const notification = {
      eventId: 'log_repository',
      eventType: 'subscription.completed',
      subscriptionId: 'subs_fixture',
      checkoutId: 'bill_repo',
      customerId: 'cust_fixture',
      paymentId: null,
    };
    const accepted = await Promise.all(
      Array.from({ length: 12 }, () => inbox.accept(notification, 'e'.repeat(64))),
    );
    assert.equal(accepted.filter((state) => state === 'accepted').length, 1);
    assert.equal(accepted.filter((state) => state === 'duplicate').length, 11);
    checks++;
    assert.equal(
      await createPostgresGatewayInbox(account, database).accept(notification, 'e'.repeat(64)),
      'duplicate',
    );
    checks++;
    await reject(() => inbox.accept(notification, 'f'.repeat(64)), 'event_content_conflict');
    const [originalHash] = await sql<
      { payload_hash: string }[]
    >`select payload_hash from billing_gateway.event_inbox
      where account_id=${a}::uuid and event_id='log_repository'`;
    assert.equal(originalHash?.payload_hash, 'e'.repeat(64));
    checks++;
    await reject(
      () =>
        createPostgresGatewayInbox({ ...account, accountId: 'missing_store' }, database).accept(
          notification,
          'e'.repeat(64),
        ),
      'persistence_unavailable',
    );
    assert.equal(
      await createPostgresGatewayInbox({ ...account, environment: 'production' }, database).accept(
        notification,
        'e'.repeat(64),
      ),
      'accepted',
    );
    checks++;
    const receiverSecret = 'synthetic-local-receiver-secret-32-characters';
    const publicIntegrityKey =
      't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
    const failures: string[] = [];
    const receiver = createAbacatePayWebhookHandler({
      account,
      expectedSecret: receiverSecret,
      inbox,
      onFailure: (reason) => {
        failures.push(reason);
      },
    });
    const request = (eventId: string, suppliedSecret = receiverSecret) => {
      const body = JSON.stringify({
        id: eventId,
        event: 'subscription.completed',
        apiVersion: 2,
        devMode: true,
        data: {
          subscription: { id: 'subs_fixture', status: 'ACTIVE', amount: 100 },
          customer: { id: 'cust_fixture', email: 'private@example.invalid' },
        },
      });
      return new Request(`http://127.0.0.1/webhook?webhookSecret=${suppliedSecret}`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': createHmac('sha256', publicIntegrityKey)
            .update(body)
            .digest('base64'),
        },
      });
    };
    assert.equal((await receiver(request('log_http_proof'))).status, 202);
    checks++;
    assert.equal((await receiver(request('log_http_proof'))).status, 200);
    checks++;
    assert.equal((await receiver(request('log_forbidden_proof', 'wrong-secret'))).status, 401);
    assert.deepEqual(failures, ['authentication_failed']);
    checks++;
    const rows = await sql<
      { stored: string }[]
    >`select to_jsonb(i)::text as stored from billing_gateway.event_inbox i
      where account_id=${a}::uuid and event_id in ('log_http_proof','log_forbidden_proof')`;
    assert.equal(rows.length, 1);
    assert.ok(!rows[0]?.stored.includes('private@example.invalid'));
    assert.ok(!rows[0]?.stored.includes(receiverSecret));
    checks++;
    const [unboundLegacy] = await sql<{ n: number }[]>`select count(*)::int as n
      from billing_gateway.bindings where subscription_id=${legacy.subscriptionId}::uuid`;
    assert.equal(unboundLegacy?.n, 0);
    checks++;
    assert.equal(await snapshot(sql), before);
    checks++;
  } finally {
    await cluster.stop();
    try {
      await access(normalizedData);
      cleanup = 'PRESERVED_SYNTHETIC_DIRECTORY';
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      cleanup = 'PASS';
    }
  }
  const evidence = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    checks,
    environment: 'disposable_postgres_loopback',
    existingMigrations,
    candidateMigrationRegistered: true,
    remoteWrites: 0,
    providerCalls: 0,
    syntheticCleanup: cleanup,
  };
  await writeFile('dist/billing-gateway-schema.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      checks,
      code:
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'local_candidate_schema_check_failed',
      remoteWrites: 0,
      providerCalls: 0,
    }),
  );
  process.exitCode = 1;
});
