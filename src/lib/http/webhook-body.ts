import 'server-only';

/** Caps actual bytes while reading; Content-Length alone is not trustworthy. */
export async function readWebhookBodyCapped(req: Request, cap: number): Promise<string | null> {
  const bytes = await readWebhookBytesCapped(req, cap);
  return bytes === null ? null : Buffer.from(bytes).toString('utf8');
}

/** Preserve exact bytes for HMAC verification before any text decoding. */
export async function readWebhookBytesCapped(
  req: Request,
  cap: number,
): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
