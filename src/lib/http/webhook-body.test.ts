import { describe, expect, it, vi } from 'vitest';

import { readWebhookBodyCapped } from './webhook-body';

function streamRequest(stream: ReadableStream<Uint8Array>): Request {
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: stream, duplex: 'half' };
  return new Request('http://localhost/webhook', init);
}

describe('readWebhookBodyCapped', () => {
  it('accepts an empty request body', async () => {
    expect(await readWebhookBodyCapped(new Request('http://localhost/webhook'), 4)).toBe('');
  });

  it('preserves UTF-8 bytes split across chunks at the exact limit', async () => {
    const bytes = new TextEncoder().encode('olá');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    expect(await readWebhookBodyCapped(streamRequest(stream), 4)).toBe('olá');
    expect(stream.locked).toBe(false);
  });

  it('counts bytes instead of characters', async () => {
    const req = new Request('http://localhost/webhook', { method: 'POST', body: 'éé' });
    expect(await readWebhookBodyCapped(req, 3)).toBeNull();
  });

  it('cancels immediately beyond the cap without draining subsequent chunks', async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(3));
      if (++chunks === 4) controller.close();
    });
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    expect(await readWebhookBodyCapped(streamRequest(stream), 4)).toBeNull();
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('propagates stream failures and releases the reader', async () => {
    const failure = new Error('interrupted request');
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    await expect(readWebhookBodyCapped(streamRequest(stream), 4)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
});
