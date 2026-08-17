import { describe, expect, it } from 'vitest';

import { FOUNDER_CAMPAIGN, resolveDisplayPrice } from './invites';

/**
 * O risco coberto aqui é de comunicação, não de cálculo: um "de R$ X" que nunca
 * foi praticado é propaganda enganosa pelo CDC. A regra vive numa função pura
 * justamente para ser afirmada sem banco.
 */
describe('resolveDisplayPrice', () => {
  it('risca a tabela e cobra o preço de fundador', () => {
    expect(resolveDisplayPrice(34_900, 29_665)).toEqual({
      priceCents: 29_665,
      listPriceCents: 34_900,
    });
  });

  it('sem campanha, cobra a tabela e não risca nada', () => {
    // É o caso da futura criação de conta pela landing page.
    expect(resolveDisplayPrice(34_900, null)).toEqual({
      priceCents: 34_900,
      listPriceCents: null,
    });
  });

  it('não risca quando os dois valores são iguais', () => {
    // Guarda contra uma campanha criada com desconto zero por engano: exibir
    // "de R$ 349 por R$ 349" destrói a credibilidade que a promoção busca.
    expect(resolveDisplayPrice(34_900, 34_900)).toEqual({
      priceCents: 34_900,
      listPriceCents: null,
    });
  });

  it('nunca inventa preço quando o plano não tem tabela', () => {
    expect(resolveDisplayPrice(null, null)).toEqual({
      priceCents: null,
      listPriceCents: null,
    });
  });

  it('campanha sem tabela cobra a campanha, mas não risca', () => {
    // Sem referência não há "de" honesto a exibir.
    expect(resolveDisplayPrice(null, 29_665)).toEqual({
      priceCents: 29_665,
      listPriceCents: null,
    });
  });

  it('o desconto de fundador é exatamente 15% do preço de tabela', () => {
    // Trava o número prometido na tela contra as linhas criadas na migration.
    const casos: Array<[number, number]> = [
      [14_900, 12_665],
      [34_900, 29_665],
      [69_900, 59_415],
      [151_980, 129_183],
      [355_980, 302_583],
      [712_980, 606_033],
    ];
    for (const [tabela, fundador] of casos) {
      expect(Math.round(tabela * 0.85), `tabela ${tabela}`).toBe(fundador);
      expect(resolveDisplayPrice(tabela, fundador).priceCents).toBe(fundador);
    }
  });

  it('o código da campanha é estável', () => {
    // A migration grava esta string; divergência silenciaria o desconto.
    expect(FOUNDER_CAMPAIGN).toBe('fundador');
  });
});
