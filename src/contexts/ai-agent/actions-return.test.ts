import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  idempotentMutation: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
  returnToAgent: vi.fn(),
}));

vi.mock('@/contexts/messaging', () => ({ messagingApiV1: {} }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: mocks.requireClinicId,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/crypto', () => ({ decryptForTenant: vi.fn() }));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: vi.fn() }));
vi.mock('./internal/action-helpers', () => ({
  idemKey: (_operation: string, key: string) => key,
  jsonSafe: (value: unknown) => value,
  requestContext: vi.fn().mockResolvedValue({}),
}));
vi.mock('./internal/conversation', () => ({
  appendManualMessage: vi.fn(),
  escalateToHuman: vi.fn(),
  returnToAgent: mocks.returnToAgent,
}));

import { devolverAoAgente } from './actions';
import { ConversationAssignmentRequiredError } from './errors';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const COLLEAGUE = '44444444-4444-4444-8444-444444444444';

/**
 * Cada `await` de query consome a próxima resposta da fila, na ordem em que a
 * action consulta: conversa (lock) e depois o handoff aberto.
 */
function fakeTx(...results: unknown[][]) {
  const queue = [...results];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              Promise.resolve(queue.shift() ?? []).then(resolve, reject)
          : () => chain,
    },
  );
  return chain;
}

function withHandoff(handoff: { assignedTo: string | null } | null) {
  const tx = fakeTx(
    [{ status: 'handoff', startedAt: new Date() }],
    handoff === null ? [] : [handoff],
  );
  mocks.idempotentMutation.mockImplementation((_opts, fn: (tx: unknown) => unknown) => fn(tx));
}

describe('devolverAoAgente — quem pode devolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ userId: ME });
    mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
    mocks.returnToAgent.mockResolvedValue(true);
  });

  it('devolve um handoff que ninguém assumiu (resposta pelo app WhatsApp Business)', async () => {
    withHandoff({ assignedTo: null });
    await devolverAoAgente(CONVERSATION_ID, 'k1');
    expect(mocks.returnToAgent).toHaveBeenCalledWith(expect.anything(), CLINIC_ID, CONVERSATION_ID);
  });

  it('devolve o handoff assumido por quem clicou', async () => {
    withHandoff({ assignedTo: ME });
    await devolverAoAgente(CONVERSATION_ID, 'k2');
    expect(mocks.returnToAgent).toHaveBeenCalledOnce();
  });

  it('recusa quando OUTRA pessoa assumiu — a IA atropelaria o atendimento dela', async () => {
    withHandoff({ assignedTo: COLLEAGUE });
    await expect(devolverAoAgente(CONVERSATION_ID, 'k3')).rejects.toBeInstanceOf(
      ConversationAssignmentRequiredError,
    );
    expect(mocks.returnToAgent).not.toHaveBeenCalled();
  });

  it('recusa quando não há handoff aberto', async () => {
    withHandoff(null);
    await expect(devolverAoAgente(CONVERSATION_ID, 'k4')).rejects.toBeInstanceOf(
      ConversationAssignmentRequiredError,
    );
    expect(mocks.returnToAgent).not.toHaveBeenCalled();
  });
});
