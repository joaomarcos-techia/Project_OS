/**
 * recordHeartbeat — M2: o swallow silencioso vira sinal.
 *
 * POR QUE importa: o heartbeat É o sinal de liveness do SLO nº6 (todo cron
 * dentro de 2× o intervalo). Se a escrita falha em silêncio, o painel mostra um
 * cron "atrasado" que na verdade rodou — ou, pior, um cron travado passando por
 * saudável. O mecanismo criado para detectar falha silenciosa falhava em
 * silêncio.
 *
 * A escrita continua BEST-EFFORT (heartbeat nunca derruba o cron); o que muda é
 * que agora deixa rastro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emit, insert } = vi.hoisted(() => ({ emit: vi.fn(), insert: vi.fn() }));

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/db', () => ({ dbAdmin: { insert } }));

import { recordHeartbeat } from './index';

function chainThatRejects(err: unknown) {
  return {
    values: () => ({ onConflictDoUpdate: () => Promise.reject(err) }),
  };
}
function chainThatResolves() {
  return {
    values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordHeartbeat', () => {
  it('sucesso: não emite ruído', async () => {
    insert.mockReturnValue(chainThatResolves());
    await recordHeartbeat('outbox', 'success', { processed: 3 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('falha de escrita: emite sinal em vez de engolir (M2)', async () => {
    insert.mockReturnValue(chainThatRejects(new Error('connection refused')));
    await recordHeartbeat('outbox', 'success', { processed: 3 });

    expect(emit).toHaveBeenCalledWith(
      'cron.heartbeat.write_failed',
      expect.objectContaining({ job: 'outbox' }),
    );
  });

  it('falha de escrita continua BEST-EFFORT: não lança', async () => {
    insert.mockReturnValue(chainThatRejects(new Error('connection refused')));
    await expect(recordHeartbeat('outbox', 'error', {})).resolves.toBeUndefined();
  });
});
