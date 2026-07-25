import { describe, expect, it } from 'vitest';

import { CreateEstornoSchema } from './types';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('CreateEstornoSchema', () => {
  it('exige pagamento original, valor, metodo e motivo', () => {
    expect(
      CreateEstornoSchema.safeParse({
        lancamentoId: U1,
        paymentId: U2,
        valor: 100,
        paymentMethod: 'pix',
        motivo: 'Pagamento duplicado',
      }).success,
    ).toBe(true);

    expect(CreateEstornoSchema.safeParse({ lancamentoId: U1, motivo: 'duplicado' }).success).toBe(
      false,
    );
  });
});
