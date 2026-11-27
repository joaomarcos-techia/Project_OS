import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { TestCommandJournal } from '../../test/command-journal';
import { executeCommandOnce } from './command-operation';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const operationId = 'e449c942-cdd8-4ce2-95a7-0328d02d7a4c';
const resultSchema = z.object({ id: z.literal('bill_test') });
function setup() {
  const journal = new TestCommandJournal();
  const execute = vi.fn(async () => ({ id: 'bill_test' as const }));
  return {
    journal,
    execute,
    input: {
      account,
      operationId,
      kind: 'create_checkout',
      parameters: { price: 100, reference: 'fixture' },
      resultSchema,
      journal,
      execute,
    },
  };
}

describe('durable-command orchestration contract (unit journal double)', () => {
  it('reserves before the external command and replays a confirmed result', async () => {
    const { input, execute, journal } = setup();
    execute.mockImplementation(async () => {
      expect([...journal.records.values()][0]?.state).toBe('running');
      return { id: 'bill_test' };
    });
    expect(await executeCommandOnce(input)).toEqual({ id: 'bill_test' });
    expect(await executeCommandOnce(input)).toEqual({ id: 'bill_test' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('blocks simultaneous attempts instead of sending two commands', async () => {
    const { input, execute } = setup();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => executeCommandOnce(input)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(19);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('uses canonical parameters, independent of property order', async () => {
    const { input, execute } = setup();
    await executeCommandOnce(input);
    await executeCommandOnce({ ...input, parameters: { reference: 'fixture', price: 100 } });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([{ parameters: { price: 101 } }, { kind: 'cancel_subscription' }])(
    'refuses reuse with a different request',
    async (change) => {
      const { input, execute } = setup();
      await executeCommandOnce(input);
      await expect(executeCommandOnce({ ...input, ...change })).rejects.toMatchObject({
        code: 'operation_conflict',
      });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps unknown outcomes blocked on retry without leaking the provider exception', async () => {
    const { input, execute, journal } = setup();
    execute.mockRejectedValue(new Error('secret-key and patient@example.invalid'));
    const error: unknown = await executeCommandOnce(input).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'operation_unknown',
      message: 'SaaS billing operation: operation_unknown',
    });
    expect(error).not.toHaveProperty('cause');
    expect([...journal.records.values()][0]?.state).toBe('unknown');
    await expect(executeCommandOnce(input)).rejects.toMatchObject({ code: 'operation_unknown' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not send a command if reservation persistence fails', async () => {
    const { input, execute, journal } = setup();
    vi.spyOn(journal, 'reserve').mockRejectedValue(new Error('private storage path'));
    await expect(executeCommandOnce(input)).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not resend after the provider committed but confirmation persistence failed', async () => {
    const { input, execute, journal } = setup();
    vi.spyOn(journal, 'confirm').mockRejectedValue(new Error('private storage error'));
    await expect(executeCommandOnce(input)).rejects.toMatchObject({ code: 'journal_unavailable' });
    await expect(executeCommandOnce(input)).rejects.toMatchObject({
      code: 'operation_in_progress',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('keeps the reservation when marking an unknown outcome also fails', async () => {
    const { input, execute, journal } = setup();
    execute.mockRejectedValue(new Error('provider fixture'));
    vi.spyOn(journal, 'markUnknown').mockRejectedValue(new Error('storage fixture'));
    await expect(executeCommandOnce(input)).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect([...journal.records.values()][0]?.state).toBe('running');
  });
  it('rejects corrupted persisted results without resubmission', async () => {
    const { input, execute, journal } = setup();
    await executeCommandOnce(input);
    for (const record of journal.records.values()) record.result = { id: 'other_bill' };
    await expect(executeCommandOnce(input)).rejects.toMatchObject({ code: 'operation_unknown' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each(['invalid-id', '', '../external'])('rejects invalid operation ID %j', async (id) => {
    const { input, execute, journal } = setup();
    await expect(executeCommandOnce({ ...input, operationId: id })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(journal.records.size).toBe(0);
  });
  it('namespaces the same operation ID by provider/account/environment', async () => {
    const { input, execute } = setup();
    await executeCommandOnce(input);
    await executeCommandOnce({ ...input, account: { ...account, accountId: 'store_other' } });
    await executeCommandOnce({ ...input, account: { ...account, environment: 'production' } });
    await executeCommandOnce({ ...input, account: { ...account, provider: 'asaas' } });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
