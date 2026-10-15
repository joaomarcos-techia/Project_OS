import { describe, expect, it } from 'vitest';

import { quoteProposedOffer } from './proposed-offer';

describe('proposta de preços — não ativa no checkout', () => {
  it.each([
    [1, 'consultorio', 197, 1970, 500],
    [2, 'clinica', 397, 3970, 1000],
    [3, 'clinica', 544, 5440, 1500],
    [5, 'clinica', 838, 8380, 2500],
    [10, 'clinica', 1573, 15730, 5000],
  ] as const)(
    'calcula %i profissionais sem arredondamento oculto',
    (count, plan, monthly, annual, conversations) => {
      expect(quoteProposedOffer(count)).toEqual({
        plan,
        professionals: count,
        monthly,
        annual,
        conversationsIncluded: conversations,
      });
    },
  );

  it.each([0, -1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY])(
    'não apresenta preço de checkout para contagem inválida %s',
    (count) => expect(quoteProposedOffer(count)).toBeNull(),
  );
});
