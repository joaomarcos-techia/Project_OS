import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { expect, it } from 'vitest';

it('não expõe stack trace em resposta HTTP inválida do fixture Redis', async () => {
  const child = fork(path.resolve('scripts/security/signup-redis-fixture.mjs'), [], {
    env: { ...process.env, SIGNUP_REDIS_FIXTURE_PORT: '0' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });

  try {
    const [ready]: unknown[] = await once(child, 'message');
    if (
      typeof ready !== 'object' ||
      ready === null ||
      !('type' in ready) ||
      ready.type !== 'ready' ||
      !('port' in ready) ||
      typeof ready.port !== 'number'
    ) {
      throw new Error('Redis fixture não informou a porta de teste');
    }
    const response = await fetch(`http://127.0.0.1:${ready.port}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-upstash-token' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid request' });
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
