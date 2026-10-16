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
        staffLogins: 0,
        includedStaffLogins: count === 1 ? 1 : 2,
        additionalStaffLogins: 0,
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

  it('cobra somente logins de equipe acima da cota incluída, sem alterar o preço-base', () => {
    expect(quoteProposedOffer(1, 1)?.monthly).toBe(197);
    expect(quoteProposedOffer(1, 2)).toMatchObject({
      plan: 'consultorio',
      includedStaffLogins: 1,
      additionalStaffLogins: 1,
      monthly: 276,
      annual: 2760,
    });
    expect(quoteProposedOffer(2, 2)?.monthly).toBe(397);
    expect(quoteProposedOffer(2, 3)).toMatchObject({
      plan: 'clinica',
      includedStaffLogins: 2,
      additionalStaffLogins: 1,
      monthly: 476,
      annual: 4760,
    });
  });

  it.each([-1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY])(
    'recusa quantidade inválida de logins de equipe %s',
    (count) => expect(quoteProposedOffer(2, count)).toBeNull(),
  );
});
