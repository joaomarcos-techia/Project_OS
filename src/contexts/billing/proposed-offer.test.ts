import { describe, expect, it } from 'vitest';

import { quoteProposedOffer } from './proposed-offer';

describe('proposta de preços do PDF — não ativa no checkout', () => {
  it.each([
    [1, 'consultorio', 197, 1970, 500],
    [2, 'clinica', 397, 3970, 1000],
    [3, 'clinica', 544, 5440, 1500],
    [5, 'clinica', 838, 8380, 2500],
  ] as const)(
    'calcula %i profissionais sem arredondamento oculto',
    (count, plan, monthly, annual, conversations) => {
      expect(quoteProposedOffer(count)).toEqual({
        plan,
        professionals: count,
        staffLogins: 0,
        monthly,
        annual,
        conversationsIncluded: conversations,
      });
    },
  );

  it.each([0, -1, 1.5, 6, 10, Number.NaN, Number.POSITIVE_INFINITY])(
    'não apresenta preço para profissional inválido %s',
    (count) => expect(quoteProposedOffer(count)).toBeNull(),
  );

  it('inclui até três logins de equipe no Consultório, sem cobrar por login', () => {
    expect(quoteProposedOffer(1, 0)?.monthly).toBe(197);
    expect(quoteProposedOffer(1, 3)?.monthly).toBe(197);
    expect(quoteProposedOffer(1, 4)).toBeNull();
  });

  it('inclui até três logins de equipe na Clínica, sem cobrar por login', () => {
    expect(quoteProposedOffer(2, 0)?.monthly).toBe(397);
    expect(quoteProposedOffer(2, 3)?.monthly).toBe(397);
    expect(quoteProposedOffer(2, 4)).toBeNull();
    expect(quoteProposedOffer(3, 3)?.monthly).toBe(544);
    expect(quoteProposedOffer(3, 4)).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'recusa quantidade inválida de logins de equipe %s',
    (count) => expect(quoteProposedOffer(2, count)).toBeNull(),
  );
});
