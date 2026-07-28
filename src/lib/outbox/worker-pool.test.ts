import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const dbSource = readFileSync(resolve(process.cwd(), 'src/lib/db/index.ts'), 'utf8');
const workerSource = readFileSync(resolve(process.cwd(), 'src/lib/outbox/worker.ts'), 'utf8');

describe('outbox worker pool contract', () => {
  it('decide o advisory lock pelo tamanho real do pool', () => {
    expect(dbSource).toContain('export const DB_WORKER_POOL_SIZE = 2;');
    expect(dbSource).toContain('max: DB_WORKER_POOL_SIZE');
    expect(workerSource).toContain('DB_WORKER_POOL_SIZE, dbWorker');
    expect(workerSource).toContain('if (DB_WORKER_POOL_SIZE < 2)');
    expect(workerSource).not.toContain('if (env.OUTBOX_DB_POOL_SIZE < 2)');
  });
});
