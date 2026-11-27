/** Memory-only synthetic Resend receiver. No messages are sent or saved. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';

export async function startPilotMail() {
  const token = randomUUID();
  const messages: { to: string; text: string }[] = [];
  const shape = z.object({ to: z.array(z.email()).length(1), text: z.string().max(20000) });
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end('{}');
      return;
    }
    try {
      if (req.method === 'POST' && req.url === '/send') {
        let body = '';
        for await (const chunk of req) {
          body += String(chunk);
          if (body.length > 80000) throw new Error('Synthetic message too large');
        }
        const parsed = shape.parse(JSON.parse(body));
        const to = parsed.to[0];
        assert.ok(to && /^qoro-pilot-[a-f0-9-]+@example\.test$/u.test(to));
        messages.push({ to, text: parsed.text });
        res.end(JSON.stringify({ id: randomUUID() }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/code?')) {
        const email = new URL(req.url, 'http://localhost').searchParams.get('email');
        const match = messages.findLast((m) => m.to === email)?.text.match(/\b([0-9]{8})\b/u);
        res.end(JSON.stringify({ code: match?.[1] ?? null, count: messages.length }));
        return;
      }
      res.writeHead(404).end('{}');
    } catch {
      res.writeHead(400).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    stop: async () => {
      messages.length = 0;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
