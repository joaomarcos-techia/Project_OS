import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { CommandOperationJournal } from './command-operation';
import { billingAccountSchema, opaqueBillingId, type BillingAccount } from './contracts';

/** Inject the existing central pool/transaction; this module never opens a pool. */
export interface BillingGatewaySql {
  execute(statement: SQL): PromiseLike<unknown>;
}
export class GatewayPersistenceError extends Error {
  constructor(
    readonly code: 'persistence_unavailable' | 'event_content_conflict' = 'persistence_unavailable',
  ) {
    super(`SaaS gateway persistence: ${code}`);
    this.name = 'GatewayPersistenceError';
  }
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const rowSchema = z.object({
  operation_id: z.uuid(),
  request_hash: hashSchema,
  state: z.enum(['running', 'confirmed', 'unknown']),
  result: z.unknown(),
});
const scopeSchema = z
  .object({
    subscriptionId: z.uuid(),
    clinicId: z.uuid(),
    kind: z.enum(['create_checkout', 'change_plan', 'cancel_subscription', 'proration_checkout']),
    businessKey: z.string().min(1).max(200).regex(/\S/),
  })
  .strict();
const notificationSchema = z
  .object({
    eventId: opaqueBillingId,
    eventType: z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/),
    subscriptionId: opaqueBillingId.nullable(),
    checkoutId: opaqueBillingId.nullable(),
    paymentId: opaqueBillingId.nullable(),
    customerId: opaqueBillingId.nullable(),
  })
  .strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GatewayPersistenceError();
  return parsed.data;
}
function operationId(key: string, account: BillingAccount): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    throw new GatewayPersistenceError();
  }
  const parts = validate(z.tuple([z.string(), z.string(), z.string(), z.uuid()]), parsed);
  if (
    parts[0] !== account.provider ||
    parts[1] !== account.environment ||
    parts[2] !== account.accountId
  ) {
    throw new GatewayPersistenceError();
  }
  return parts[3];
}

/**
 * Candidate repository for SCHEMA-CANDIDATO.sql. No production composition yet.
 * The business-key constraint also catches retries using a newly generated UUID.
 */
export function createPostgresGatewayOperationJournal(
  accountInput: BillingAccount,
  scopeInput: z.input<typeof scopeSchema>,
  database: BillingGatewaySql,
): CommandOperationJournal {
  const account = validate(billingAccountSchema, accountInput);
  const scope = validate(scopeSchema, scopeInput);
  async function transition(
    key: string,
    state: 'confirmed' | 'unknown',
    result: unknown,
  ): Promise<void> {
    const id = operationId(key, account);
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      throw new GatewayPersistenceError();
    }
    if (!serialized || Buffer.byteLength(serialized) > 16_384) throw new GatewayPersistenceError();
    try {
      const rows = validate(
        z.array(z.object({ operation_id: z.uuid() })).length(1),
        await database.execute(sql`
        update billing_gateway.operations o set state=${state},result=${state === 'unknown' ? sql`NULL` : sql`${serialized}::jsonb`}
        from billing_gateway.accounts a
        where a.id=o.account_id and a.provider=${account.provider} and a.environment=${account.environment}
          and a.external_account_id=${account.accountId} and o.operation_id=${id}::uuid
          and o.subscription_id=${scope.subscriptionId}::uuid and o.clinic_id=${scope.clinicId}::uuid
          and o.kind=${scope.kind} and o.business_key=${scope.businessKey} and o.state='running'
        returning o.operation_id::text`),
      );
      if (rows.length !== 1) throw new GatewayPersistenceError();
    } catch {
      throw new GatewayPersistenceError();
    }
  }
  return {
    async reserve(key, fingerprint) {
      const id = operationId(key, account);
      validate(hashSchema, fingerprint);
      try {
        const inserted = validate(
          z.array(rowSchema).max(1),
          await database.execute(sql`
          insert into billing_gateway.operations(account_id,operation_id,subscription_id,clinic_id,kind,business_key,request_hash,state)
          select a.id,${id}::uuid,${scope.subscriptionId}::uuid,${scope.clinicId}::uuid,
            ${scope.kind},${scope.businessKey},${fingerprint},'running'
          from billing_gateway.accounts a where a.provider=${account.provider}
            and a.environment=${account.environment} and a.external_account_id=${account.accountId}
          on conflict do nothing returning operation_id::text,request_hash,state,result`),
        );
        if (inserted.length === 1) return { claimed: true };
        const existing = validate(
          z
            .array(
              rowSchema.extend({
                subscription_id: z.uuid(),
                clinic_id: z.uuid(),
                kind: z.string(),
                business_key: z.string(),
              }),
            )
            .length(1),
          await database.execute(sql`
          select o.operation_id::text,o.request_hash,o.state,o.result,o.subscription_id::text,o.clinic_id::text,o.kind,o.business_key
          from billing_gateway.operations o
          join billing_gateway.accounts a on a.id=o.account_id
          where a.provider=${account.provider} and a.environment=${account.environment} and a.external_account_id=${account.accountId}
            and (o.operation_id=${id}::uuid or (o.subscription_id=${scope.subscriptionId}::uuid
              and o.clinic_id=${scope.clinicId}::uuid and o.kind=${scope.kind} and o.business_key=${scope.businessKey}))`),
        );
        const record = existing[0];
        if (
          !record ||
          record.subscription_id !== scope.subscriptionId ||
          record.clinic_id !== scope.clinicId ||
          record.kind !== scope.kind ||
          record.business_key !== scope.businessKey
        )
          throw new GatewayPersistenceError();
        return {
          claimed: false,
          operation: {
            fingerprint: record.request_hash,
            state: record.state,
            result: record.result,
          },
        };
      } catch {
        throw new GatewayPersistenceError();
      }
    },
    confirm(key, result) {
      return transition(key, 'confirmed', result);
    },
    markUnknown(key) {
      return transition(key, 'unknown', null);
    },
  };
}

/** Persist only verified IDs/hash; no raw webhook/customer/payment payload. No domain effect. */
export function createPostgresGatewayInbox(
  accountInput: BillingAccount,
  database: BillingGatewaySql,
) {
  const account = validate(billingAccountSchema, accountInput);
  return {
    account,
    async accept(
      input: z.input<typeof notificationSchema>,
      rawBodyHash: string,
    ): Promise<'accepted' | 'duplicate'> {
      const event = validate(notificationSchema, input);
      const hash = validate(hashSchema, rawBodyHash);
      try {
        const inserted = validate(
          z.array(z.object({ event_id: opaqueBillingId })).max(1),
          await database.execute(sql`
          insert into billing_gateway.event_inbox(account_id,event_id,event_type,payload_hash,
            external_subscription_id,external_checkout_id,external_payment_id,external_customer_id)
          select a.id,${event.eventId},${event.eventType},${hash},${event.subscriptionId},${event.checkoutId},${event.paymentId},${event.customerId}
          from billing_gateway.accounts a where a.provider=${account.provider}
            and a.environment=${account.environment} and a.external_account_id=${account.accountId}
          on conflict do nothing returning event_id`),
        );
        if (inserted.length === 1) return 'accepted';
        const existing = validate(
          z.array(z.object({ payload_hash: hashSchema })).length(1),
          await database.execute(sql`
          select i.payload_hash from billing_gateway.event_inbox i join billing_gateway.accounts a on a.id=i.account_id
          where a.provider=${account.provider} and a.environment=${account.environment} and a.external_account_id=${account.accountId}
            and i.event_id=${event.eventId}`),
        );
        if (existing[0]?.payload_hash !== hash)
          throw new GatewayPersistenceError('event_content_conflict');
        return 'duplicate';
      } catch (error) {
        if (error instanceof GatewayPersistenceError) throw error;
        throw new GatewayPersistenceError();
      }
    },
  };
}
