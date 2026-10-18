import { describe, expect, it } from 'vitest';

import {
  calculateUpgradeProration,
  changeIdFromExternalReference,
  comparePlans,
  nextPeriodEnd,
  pickPriceForCampaign,
  planChangeExternalReference,
} from './plan-changes';

describe('plan changes', () => {
  it('ordena os três planos suportados', () => {
    expect(comparePlans('solo', 'clinica')).toBe(1);
    expect(comparePlans('pro', 'clinica')).toBe(-1);
    expect(comparePlans('clinica', 'clinica')).toBe(0);
  });

  it('calcula o rateio do upgrade apenas para a fração restante do ciclo', () => {
    const start = new Date('2026-08-01T00:00:00.000Z');
    const end = new Date('2026-08-31T00:00:00.000Z');
    const halfway = new Date('2026-08-16T00:00:00.000Z');

    expect(calculateUpgradeProration('100.00', '160.00', start, end, halfway)).toBe(3000);
    expect(calculateUpgradeProration('100.00', '160.00', start, end, end)).toBe(0);
  });

  it('aceita apenas referências de alteração de plano com UUID válido', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    expect(changeIdFromExternalReference(planChangeExternalReference(id))).toBe(id);
    expect(changeIdFromExternalReference('other:00000000-0000-0000-0000-000000000001')).toBeNull();
  });

  it('calcula o término da reativação sem ultrapassar o último dia do mês', () => {
    expect(nextPeriodEnd(new Date('2026-01-31T12:00:00.000Z'), 'monthly').toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(nextPeriodEnd(new Date('2026-02-28T12:00:00.000Z'), 'annual').toISOString()).toBe(
      '2027-02-28T12:00:00.000Z',
    );
  });
});

/**
 * Preço de fundador na TROCA de plano.
 *
 * O risco é silencioso: a clínica que entrou pelo link trocaria de plano por um
 * caminho que nem menciona promoção e sairia dele pagando o preço de tabela —
 * perdendo um desconto vitalício sem nunca ter pedido isso.
 */
describe('pickPriceForCampaign', () => {
  const tabela = { priceId: 'p-tabela', priceAmount: '699.00', campaignCode: null };
  const fundador = { priceId: 'p-fundador', priceAmount: '594.15', campaignCode: 'fundador' };

  it('preserva a campanha ao trocar de plano', () => {
    expect(pickPriceForCampaign([tabela, fundador], 'fundador')).toBe(fundador);
  });

  it('não depende da ordem em que os preços vêm do banco', () => {
    expect(pickPriceForCampaign([fundador, tabela], 'fundador')).toBe(fundador);
  });

  it('cliente sem campanha nunca cai no preço promocional', () => {
    // O contrário do bug: quem entrar pela landing page não pode herdar o
    // desconto só porque a linha existe no banco.
    expect(pickPriceForCampaign([tabela, fundador], null)).toBe(tabela);
  });

  it('recusa preço de tabela quando o plano de destino não tem a campanha vitalícia', () => {
    expect(pickPriceForCampaign([tabela], 'fundador')).toBeUndefined();
  });

  it('ignora campanha de outro código', () => {
    const outra = { priceId: 'p-outra', priceAmount: '500.00', campaignCode: 'black-friday' };
    expect(pickPriceForCampaign([tabela, outra], 'fundador')).toBeUndefined();
  });

  it('devolve undefined quando não há preço vigente algum', () => {
    expect(pickPriceForCampaign([], 'fundador')).toBeUndefined();
    expect(pickPriceForCampaign([], null)).toBeUndefined();
  });

  it('sem preço de tabela e sem campanha correspondente, não inventa preço', () => {
    const outra = { priceId: 'p-outra', priceAmount: '500.00', campaignCode: 'black-friday' };
    expect(pickPriceForCampaign([outra], 'fundador')).toBeUndefined();
  });

  it('o rateio do upgrade usa o preço promocional, não o de tabela', () => {
    // Encadeia a escolha com o cálculo: se a escolha errar, a clínica é
    // cobrada por uma diferença que não corresponde ao que ela paga.
    const atual = { priceId: 'p-clinica-f', priceAmount: '296.65', campaignCode: 'fundador' };
    const destino = pickPriceForCampaign([tabela, fundador], 'fundador');
    const start = new Date('2026-08-01T00:00:00.000Z');
    const end = new Date('2026-08-31T00:00:00.000Z');
    const meio = new Date('2026-08-16T00:00:00.000Z');

    const rateioFundador = calculateUpgradeProration(
      atual.priceAmount,
      destino!.priceAmount,
      start,
      end,
      meio,
    );
    const rateioTabela = calculateUpgradeProration(
      atual.priceAmount,
      tabela.priceAmount,
      start,
      end,
      meio,
    );
    expect(rateioFundador).toBeLessThan(rateioTabela);
  });
});
