import 'server-only';

import { createHash } from 'node:crypto';
import stringify from 'safe-stable-stringify';
import { z } from 'zod';

import { billingAccountSchema, type BillingAccount } from './contracts';

export type CommandOperationState = 'running' | 'confirmed' | 'unknown';
export interface StoredCommandOperation {
  fingerprint: string;
  state: CommandOperationState;
  result: unknown;
}

/** reserve must be durable and atomic. An expired worker must never acquire it again. */
export interface CommandOperationJournal {
  reserve(
    key: string,
    fingerprint: string,
  ): Promise<{ claimed: true } | { claimed: false; operation: StoredCommandOperation }>;
  confirm(key: string, result: unknown): Promise<void>;
  markUnknown(key: string): Promise<void>;
}

export type CommandOperationErrorCode =
  | 'invalid_input'
  | 'operation_conflict'
  | 'operation_in_progress'
  | 'operation_unknown'
  | 'journal_unavailable';

export class CommandOperationError extends Error {
  constructor(readonly code: CommandOperationErrorCode) {
    super(`SaaS billing operation: ${code}`);
    this.name = 'CommandOperationError';
  }
}

/**
 * At-most-one attempt per account/operation ID, NOT a uniqueness constraint for
 * the underlying business obligation. The caller must reuse its persisted ID.
 * No automatic retry/failover exists after an unknown result or a crashed worker.
 */
export async function executeCommandOnce<T>(input: {
  account: BillingAccount;
  operationId: string;
  kind: string;
  parameters: unknown;
  resultSchema: z.ZodType<T>;
  journal: CommandOperationJournal;
  execute: () => Promise<T>;
}): Promise<T> {
  const account = billingAccountSchema.safeParse(input.account);
  const operationId = z.uuid().safeParse(input.operationId);
  if (!account.success || !operationId.success || !/^[a-z_]{1,64}$/.test(input.kind)) {
    throw new CommandOperationError('invalid_input');
  }
  let serialized: string | undefined;
  try {
    serialized = stringify({ kind: input.kind, parameters: input.parameters });
  } catch {
    throw new CommandOperationError('invalid_input');
  }
  if (!serialized) throw new CommandOperationError('invalid_input');
  const key = JSON.stringify([
    account.data.provider,
    account.data.environment,
    account.data.accountId,
    operationId.data,
  ]);
  const fingerprint = createHash('sha256').update(serialized).digest('hex');
  let reservation: Awaited<ReturnType<CommandOperationJournal['reserve']>>;
  try {
    reservation = await input.journal.reserve(key, fingerprint);
  } catch {
    throw new CommandOperationError('journal_unavailable');
  }
  if (!reservation.claimed) {
    const operation = reservation.operation;
    if (operation.fingerprint !== fingerprint)
      throw new CommandOperationError('operation_conflict');
    if (operation.state === 'running') throw new CommandOperationError('operation_in_progress');
    if (operation.state !== 'confirmed') throw new CommandOperationError('operation_unknown');
    const cached = input.resultSchema.safeParse(operation.result);
    if (!cached.success) throw new CommandOperationError('operation_unknown');
    return cached.data;
  }

  let result: T;
  try {
    const executed = await input.execute();
    const parsed = input.resultSchema.safeParse(executed);
    if (!parsed.success) throw new CommandOperationError('operation_unknown');
    result = parsed.data;
  } catch {
    try {
      await input.journal.markUnknown(key);
    } catch {
      // The durable running reservation must remain. Never retry the command.
      throw new CommandOperationError('journal_unavailable');
    }
    throw new CommandOperationError('operation_unknown');
  }
  try {
    await input.journal.confirm(key, result);
  } catch {
    // The provider may already have committed. A subsequent call sees running.
    throw new CommandOperationError('journal_unavailable');
  }
  return result;
}
