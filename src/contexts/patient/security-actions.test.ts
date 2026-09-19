import { describe, expect, it, vi } from 'vitest';

// Somente o provedor de identidade é substituído. O guard e todas as ações são reais.
const { dbAccess } = vi.hoisted(() => ({
  dbAccess: vi.fn(() => {
    throw new Error('DB reached without session');
  }),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  }),
}));
vi.mock('@/lib/db', () => ({
  db: { transaction: dbAccess },
  dbAdmin: { transaction: dbAccess, select: dbAccess, update: dbAccess },
  dbWorker: { transaction: dbAccess },
}));

import * as actions from './actions';
import { CreatePatientSchema, UpdatePatientSchema } from './types';

describe('Server Actions de paciente: sessão antes do payload e do banco', () => {
  for (const [name, action] of Object.entries(actions)) {
    it(`${name} nega sem sessão, mesmo recebendo payload inválido`, async () => {
      // Invocação direta da exportação: middleware não participa deste teste.
      await expect(
        Reflect.apply(action, undefined, [undefined, undefined, undefined]),
      ).rejects.toMatchObject({
        name: 'AuthError',
        reason: 'TOKEN_INVALID',
        httpStatus: 401,
      });
      expect(dbAccess).not.toHaveBeenCalled();
    });
  }
  it('schemas descartam clínica, papel e valores de cobrança injetados', () => {
    const injected = { clinicId: 'foreign-clinic', role: 'super_admin', amountCents: 999900 };
    const created = CreatePatientSchema.parse({
      nome: 'Paciente sintético',
      cpf: '52998224725',
      ...injected,
    });
    const updated = UpdatePatientSchema.parse({ nome: 'Paciente sintético', ...injected });
    for (const parsed of [created, updated]) {
      expect(parsed).not.toHaveProperty('clinicId');
      expect(parsed).not.toHaveProperty('role');
      expect(parsed).not.toHaveProperty('amountCents');
    }
  });
});
