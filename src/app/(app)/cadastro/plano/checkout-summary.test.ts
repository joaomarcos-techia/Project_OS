import { describe, expect, it } from 'vitest';

import type { SignupPlan } from '@/contexts/onboarding';

import { clinicaPlanFor, offerCatalog, summaryLines as linhasCruas } from './checkout-summary';

// O Intl separa "R$" do valor com espaço não separável; as comparações usam espaço comum.
const summaryLines = (...args: Parameters<typeof linhasCruas>) =>
  linhasCruas(...args).map((linha) => ({
    label: linha.label.replace(/\s/gu, ' '),
    value: linha.value.replace(/\s/gu, ' '),
  }));

const plano = (
  code: string,
  priceCents: number,
  cycle: 'monthly' | 'annual' = 'monthly',
): SignupPlan => ({
  id: `${code}-${cycle}`,
  code,
  name: code,
  priceCents,
  cycle,
});

const OFERTA = [
  plano('consultorio_2026', 19_700),
  plano('clinica_2026_2', 39_700),
  plano('clinica_2026_3', 54_400),
  plano('clinica_2026_4', 69_100),
  plano('clinica_2026_5', 83_800),
];

describe('resumo do checkout (desenho aprovado)', () => {
  it('monta o catálogo por família, só com planos da oferta do ciclo', () => {
    const catalogo = offerCatalog(
      [...OFERTA, plano('clinica_2026_2', 397_000, 'annual')],
      'monthly',
    );
    expect(catalogo?.consultorio?.code).toBe('consultorio_2026');
    expect(catalogo?.clinica.map((item) => item.doctors)).toEqual([2, 3, 4, 5]);
  });

  it('com plano legado no ciclo, não monta o catálogo (a tela mantém a lista)', () => {
    expect(offerCatalog([...OFERTA, plano('essencial', 14_900)], 'monthly')).toBeNull();
    expect(offerCatalog([], 'monthly')).toBeNull();
  });

  it('as linhas explicam o preço do servidor: base de 2 médicos mais os extras', () => {
    const catalogo = offerCatalog(OFERTA, 'monthly')!;
    expect(summaryLines(OFERTA[4]!, catalogo)).toEqual([
      { label: 'Plano Clínica com 2 médicos', value: 'R$ 397,00' },
      { label: '3 médicos extras × R$ 147,00', value: 'R$ 441,00' },
      { label: 'Até 3 acessos administrativos', value: 'Incluído' },
      { label: 'Pessoas no total', value: 'Até 8' },
    ]);
    expect(summaryLines(OFERTA[0]!, catalogo)).toEqual([
      { label: 'Plano Consultório com 1 médico', value: 'R$ 197,00' },
      { label: 'Até 3 acessos administrativos', value: 'Incluído' },
      { label: 'Pessoas no total', value: 'Até 4' },
    ]);
  });

  it('sem a base de 2 médicos no catálogo, uma linha só, com o preço do servidor', () => {
    const semBase = [OFERTA[0]!, OFERTA[2]!];
    expect(summaryLines(OFERTA[2]!, offerCatalog(semBase, 'monthly')!)[0]).toEqual({
      label: 'Plano Clínica com 3 médicos',
      value: 'R$ 544,00',
    });
  });

  it('se o servidor cobrar diferente da tabela, as linhas seguem o servidor (sem inventar unidade)', () => {
    const torto = [plano('clinica_2026_2', 39_700), plano('clinica_2026_4', 70_000)];
    const linhas = summaryLines(torto[1]!, offerCatalog(torto, 'monthly')!);
    expect(linhas[1]).toEqual({ label: '2 médicos extras × R$ 151,50', value: 'R$ 303,00' });
    const naoInteiro = [plano('clinica_2026_2', 39_700), plano('clinica_2026_5', 84_000)];
    expect(summaryLines(naoInteiro[1]!, offerCatalog(naoInteiro, 'monthly')!)[1]).toEqual({
      label: '3 médicos extras',
      value: 'R$ 443,00',
    });
  });

  it('o seletor cai no plano disponível mais próximo', () => {
    const catalogo = offerCatalog([OFERTA[1]!, OFERTA[3]!], 'monthly')!;
    expect(clinicaPlanFor(catalogo, 3)?.code).toBe('clinica_2026_2');
    expect(clinicaPlanFor(catalogo, 4)?.code).toBe('clinica_2026_4');
  });
});
