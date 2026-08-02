import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { __testing__, getHandler, registerDetachedHandler, registerHandler } from './registry';

const workerSource = readFileSync(resolve(process.cwd(), 'src/lib/outbox/worker.ts'), 'utf8');
const inboundSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/ai-agent/internal/handlers/inbound-received.ts'),
  'utf8',
);

afterEach(() => __testing__.reset());

describe('contrato de handler destacado do outbox', () => {
  it('preserva o modo de execução de cada handler', () => {
    registerHandler('test.transactional', async () => {});
    registerDetachedHandler('test.detached', async () => {});

    expect(getHandler('test.transactional')?.execution).toBe('transactional');
    expect(getHandler('test.detached')?.execution).toBe('detached');
  });

  it('executa a saga inbound da IA sem transação externa longa', () => {
    expect(workerSource).toContain("handler.execution === 'detached'");
    expect(inboundSource).toContain('registerDetachedHandler<InboundReceivedPayload>');
    expect(inboundSource).toContain('const inbound = await phase(clinicId, (tx) =>');
  });
});
