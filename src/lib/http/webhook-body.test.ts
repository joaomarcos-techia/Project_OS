import { describe, expect, it, vi } from 'vitest';

import { readWebhookBodyCapped, readWebhookBytesCapped } from './webhook-body';

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

describe('readWebhookBytesCapped', () => {
  it('preserves invalid UTF-8 and all bytes unchanged for signature verification', async () => {
    const bytes = Uint8Array.from([0xff, 0x00, 0xc3, 0x28]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const actual = await readWebhookBytesCapped(streamRequest(stream), 4);
    expect(actual).toBeInstanceOf(Uint8Array);
    expect(actual?.byteLength).toBe(bytes.byteLength);
    expect(Array.from(actual ?? [])).toEqual(Array.from(bytes));
  });
  it('returns zero bytes for an empty request', async () => {
    expect(await readWebhookBytesCapped(new Request('http://localhost/webhook'), 4)).toEqual(
      new Uint8Array(),
    );
  });
  it('caps raw bytes without trusting Content-Length', async () => {
    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      body: '12345',
      headers: { 'Content-Length': '1' },
    });
    expect(await readWebhookBytesCapped(request, 4)).toBeNull();
  });
});
