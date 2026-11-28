/** Loopback-only infrastructure. No credentials, shared database or hosted Redis. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import { z } from 'zod';

type Reply = number | string | null | Reply[];
class MissingRedisScript extends Error {}
function parse(buffer: Buffer, offset = 0): { value: Reply; next: number } | undefined {
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) return;
  const prefix = buffer.toString('utf8', offset, offset + 1);
  const text = buffer.toString('utf8', offset + 1, end);
  if (prefix === ':') return { value: Number(text), next: end + 2 };
  if (prefix === '+') return { value: text, next: end + 2 };
  if (prefix === '-') {
    if (text.startsWith('NOSCRIPT ')) throw new MissingRedisScript();
    throw new Error('Isolated Redis command rejected');
  }
  if (prefix === '$') {
    const length = Number(text);
    if (length === -1) return { value: null, next: end + 2 };
    if (buffer.length < end + 4 + length) return;
    return { value: buffer.toString('utf8', end + 2, end + 2 + length), next: end + 4 + length };
  }
  if (prefix === '*') {
    const values: Reply[] = [];
    let next = end + 2;
    for (let i = 0; i < Number(text); i++) {
      const entry = parse(buffer, next);
      if (!entry) return;
      values.push(entry.value);
      next = entry.next;
    }
    return { value: values, next };
  }
  throw new Error('Isolated Redis response invalid');
}

const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

export async function startOperationalRedis(options: { rateLimitScripts?: boolean } = {}) {
  const name = `qoro-billing-operational-${randomUUID()}`;
  const label = 'qoro.synthetic=billing-operational';
  const token = randomUUID();
  let paused = false;
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    label,
    '--memory',
    '128m',
    '--cpus',
    '1',
    '--publish',
    '127.0.0.1::6379',
    'redis:7.4-alpine',
  );
  const binding = docker('port', name, '6379/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const port = Number(binding.split(':')[1]);
  const commandSchema = z.array(z.union([z.string(), z.number()])).min(1);
  let commands = 0,
    rejected = 0;
  const command = async (args: (string | number)[]) =>
    new Promise<Reply>((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let buffer = Buffer.alloc(0),
        settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Isolated Redis unavailable'));
        }
        socket.destroy();
      };
      socket.setTimeout(1800, fail);
      socket.on('error', fail);
      socket.on('end', fail);
      socket.once('connect', () =>
        socket.write(
          `*${args.length}\r\n` +
            args
              .map((value) => {
                const text = String(value);
                return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
              })
              .join(''),
        ),
      );
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const reply = parse(buffer);
          if (reply && !settled) {
            settled = true;
            socket.destroy();
            resolve(reply.value);
          }
        } catch (error) {
          if (error instanceof MissingRedisScript && !settled) {
            settled = true;
            socket.destroy();
            reject(error);
          } else fail();
        }
      });
    });
  for (let attempt = 0; ; attempt++) {
    try {
      assert.equal(await command(['PING']), 'PONG');
      break;
    } catch (error) {
      if (attempt >= 5) {
        docker('stop', name);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        assert.ok(size <= 65536);
        chunks.push(Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const pipeline = req.url === '/pipeline';
      const batch = pipeline
        ? z.array(commandSchema).min(1).max(64).parse(body)
        : [commandSchema.parse(body)];
      const replies = await Promise.all(
        batch.map(async (args) => {
          const kind = String(args[0]).toUpperCase();
          assert.ok(kind === 'EVAL' || (options.rateLimitScripts === true && kind === 'EVALSHA'));
          commands++;
          try {
            return { result: await command(args) };
          } catch (error) {
            // Preserve only the standard machine condition needed by the SDK's
            // EVALSHA -> EVAL fallback. Never return keys, Lua or other server messages.
            if (error instanceof MissingRedisScript)
              return { error: 'NOSCRIPT No matching script. Please use EVAL.' };
            throw error;
          }
        }),
      );
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(pipeline ? replies : replies[0]));
    } catch {
      rejected++;
      res
        .writeHead(503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'Isolated Redis unavailable' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    stats: () => ({ commands, rejected }),
    pause() {
      assert.equal(
        docker('inspect', '--format', '{{index .Config.Labels "qoro.synthetic"}}', name),
        'billing-operational',
      );
      docker('pause', name);
      paused = true;
    },
    resume() {
      if (paused) {
        docker('unpause', name);
        paused = false;
      }
    },
    async stop() {
      if (paused) docker('unpause', name);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      docker('stop', name);
    },
  };
}

export async function startOperationalDatabaseProxy(target: string) {
  const url = new URL(target);
  assert.equal(url.hostname, '127.0.0.1');
  const targetPort = Number(url.port);
  let unavailable = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (unavailable) {
      client.destroy();
      return;
    }
    const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort });
    sockets.add(client);
    sockets.add(upstream);
    for (const socket of [client, upstream]) {
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url.port = String(address.port);
  return {
    url: url.toString(),
    pause() {
      unavailable = true;
      for (const socket of sockets) socket.destroy();
    },
    resume() {
      unavailable = false;
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
