import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { assertUnitInClinic } from './tenant-references';

const clinicId = '11111111-1111-1111-1111-111111111111';
const unitId = '22222222-2222-2222-2222-222222222222';

describe('unidade da agenda tenant-scoped', () => {
  it('aceita unidade ativa da própria clínica', async () => {
    const execute = vi.fn().mockResolvedValue([{ ok: 1 }]);
    await expect(
      assertUnitInClinic({ execute } as unknown as Tx, clinicId, unitId),
    ).resolves.toBeUndefined();
  });

  it('rejeita unidade inexistente, inativa ou de outra clínica', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(assertUnitInClinic({ execute } as unknown as Tx, clinicId, unitId)).rejects.toThrow(
      /unidade inválida/,
    );
  });

  it('não consulta o banco quando unidade é opcional e não foi informada', async () => {
    const execute = vi.fn();
    await expect(
      assertUnitInClinic({ execute } as unknown as Tx, clinicId, null),
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
