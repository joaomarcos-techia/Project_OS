import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isOrphanRecoveryEpochConsumed,
  markOrphanRecoveryEpochConsumed,
} from './recovery-consumption';

describe('consumo de recovery órfão', () => {
  it('marca e reconhece exatamente o epoch consumido sem apagar metadata', () => {
    const marked = markOrphanRecoveryEpochConsumed({ existing: 'kept' }, 1_795_000_000_000);

    expect(marked).toEqual({
      existing: 'kept',
      qoro_password_recovery_epoch: 1_795_000_000_000,
    });
    expect(isOrphanRecoveryEpochConsumed(marked, 1_795_000_000_000)).toBe(true);
    expect(isOrphanRecoveryEpochConsumed(marked, 1_795_000_000_001)).toBe(false);
    expect(isOrphanRecoveryEpochConsumed(null, 1_795_000_000_000)).toBe(false);
  });
});
