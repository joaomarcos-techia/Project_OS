import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ResendModule from './resend';
const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./resend', async (original) => ({
  ...(await original<typeof ResendModule>()),
  sendTransactionalEmail: m.send,
}));
import { TransactionalEmailError } from './resend';
import { sendTransactionalEmailRetried } from './retry';

const input = {
  to: 'synthetic@example.test',
  subject: 'Code',
  html: '<p>code</p>',
  text: 'code',
  idempotencyKey: 'synthetic-key',
};
beforeEach(() => {
  m.send.mockReset();
  vi.restoreAllMocks();
});
describe('bounded transactional retry', () => {
  it('does not retry success', async () => {
    m.send.mockResolvedValue({ providerMessageId: 'synthetic' });
    await expect(sendTransactionalEmailRetried(input)).resolves.toEqual({
      providerMessageId: 'synthetic',
    });
    expect(m.send).toHaveBeenCalledOnce();
  });
  it.each([null, 429, 502, 503])(
    'retries quick temporary failure %s with identical idempotency and payload',
    async (status) => {
      m.send
        .mockRejectedValueOnce(new TransactionalEmailError('temporary', status))
        .mockResolvedValueOnce({ providerMessageId: 'same' });
      await expect(sendTransactionalEmailRetried(input)).resolves.toEqual({
        providerMessageId: 'same',
      });
      expect(m.send).toHaveBeenCalledTimes(2);
      expect(m.send.mock.calls[0]).toEqual(m.send.mock.calls[1]);
    },
  );
  it.each([400, 401, 403, 422])('never retries permanent HTTP %s', async (status) => {
    m.send.mockRejectedValue(new TransactionalEmailError('permanent', status));
    await expect(sendTransactionalEmailRetried(input)).rejects.toMatchObject({ status });
    expect(m.send).toHaveBeenCalledOnce();
  });
  it('does not retry a full timeout after spending the short retry budget', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(20_000);
    m.send.mockRejectedValue(new TransactionalEmailError('timeout', null));
    await expect(sendTransactionalEmailRetried(input)).rejects.toMatchObject({ status: null });
    expect(m.send).toHaveBeenCalledOnce();
  });
  it('propagates a second transient failure instead of looping', async () => {
    m.send.mockRejectedValue(new TransactionalEmailError('temporary', 503));
    await expect(sendTransactionalEmailRetried(input)).rejects.toMatchObject({ status: 503 });
    expect(m.send).toHaveBeenCalledTimes(2);
  });
});
