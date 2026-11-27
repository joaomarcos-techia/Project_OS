import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const PORT = Number(process.env.SIGNUP_REDIS_FIXTURE_PORT ?? 55449);
const counters = new Map();
let unavailable = false;

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error('Redis fixture body exceeds 64 KiB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function commandResult(value) {
  assert.ok(Array.isArray(value), 'Redis fixture expects a command array');
  assert.equal(String(value[0]).toLowerCase(), 'evalsha');
  const keyCount = Number(value[2]);
  assert.equal(keyCount, 3, 'Redis fixture expects the sliding-window script');
  const currentKey = value[3];
  const previousKey = value[4];
  assert.equal(typeof currentKey, 'string');
  assert.equal(typeof previousKey, 'string');
  const argsAt = 3 + keyCount;
  const limit = Number(value[argsAt]);
  const now = Number(value[argsAt + 1]);
  const windowMs = Number(value[argsAt + 2]);
  const incrementBy = Number(value[argsAt + 3]);
  assert.ok(
    [limit, now, windowMs, incrementBy].every(Number.isFinite),
    'Redis fixture received invalid numeric arguments',
  );
  const current = (counters.get(currentKey) ?? 0) + incrementBy;
  counters.set(currentKey, current);
  const previous = counters.get(previousKey) ?? 0;
  const previousWeighted = Math.floor((1 - (now % windowMs) / windowMs) * previous);
  return { result: [limit - (current + previousWeighted), limit] };
}

function send(message) {
  if (process.connected) process.send(message);
}

const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  try {
    if (unavailable) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'synthetic unavailable' }));
      send({
        type: 'observation',
        commandCount: 0,
        durationMs: Math.round(performance.now() - startedAt),
        path: request.url ?? '',
        status: 503,
      });
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer synthetic-upstash-token');
    const body = await readJsonBody(request);
    const commands = Array.isArray(body) && Array.isArray(body[0]) ? body : null;
    const payload = commands
      ? commands.map((command) => commandResult(command))
      : commandResult(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
    send({
      type: 'observation',
      commandCount: commands?.length ?? 1,
      durationMs: Math.round(performance.now() - startedAt),
      path: request.url ?? '',
      status: 200,
    });
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : 'invalid request';
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid request' }));
    send({
      type: 'observation',
      commandCount: 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: detail,
      path: request.url ?? '',
      status: 400,
    });
  }
});

process.on('message', (message) => {
  if (!message || message.type !== 'control' || typeof message.id !== 'number') return;
  if (message.command === 'clear') counters.clear();
  if (message.command === 'unavailable') unavailable = message.value === true;
  if (message.command === 'stop') {
    server.close((error) => {
      process.exitCode = error ? 1 : 0;
      if (process.connected)
        process.send({ type: 'ack', id: message.id, error: error?.message }, () =>
          process.disconnect(),
        );
    });
    return;
  }
  send({ type: 'ack', id: message.id });
});

server.once('error', (error) => {
  send({ type: 'fatal', error: error instanceof Error ? error.message : 'fixture failed' });
  process.exitCode = 1;
});
server.listen(PORT, '127.0.0.1', () => send({ type: 'ready', port: server.address().port }));
