import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { assertFinancialReferencesInClinic } from './tenant-references';

const clinicId = '11111111-1111-1111-1111-111111111111';

describe('referências financeiras tenant-scoped', () => {
  it('aceita somente quando todas as referências existem na clínica', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockResolvedValueOnce([{ ok: 1 }]);
    await expect(
      assertFinancialReferencesInClinic({ execute } as unknown as Tx, clinicId, {
        patientId: '22222222-2222-2222-2222-222222222222',
        supplierId: '33333333-3333-3333-3333-333333333333',
        unitId: '44444444-4444-4444-4444-444444444444',
      }),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['paciente', { patientId: '22222222-2222-2222-2222-222222222222' }],
    ['fornecedor', { supplierId: '33333333-3333-3333-3333-333333333333' }],
    ['unidade', { unitId: '44444444-4444-4444-4444-444444444444' }],
  ] as const)('rejeita %s inexistente ou de outra clínica', async (label, refs) => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(
      assertFinancialReferencesInClinic({ execute } as unknown as Tx, clinicId, refs),
    ).rejects.toThrow(new RegExp(label));
  });
});
