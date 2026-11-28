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

// O texto da tela precisa dizer a mesma data que o servidor manda ao provedor.
import { resolveSignupTrialTerms } from '@/contexts/onboarding/internal/signup-trial';

import { firstChargeFor, formatIsoDate } from './checkout-summary';

describe('primeira mensalidade (mesma regra do servidor)', () => {
  const criada = new Date('2026-11-18T03:00:00.000Z');
  const fim = new Date(criada.getTime() + 14 * 86_400_000).toISOString();

  it.each([
    ['no dia da criação', '2026-11-18T03:05:00.000Z'],
    ['no meio da avaliação', '2026-11-25T18:00:00.000Z'],
    ['minutos antes do fim', '2026-12-02T02:59:00.000Z'],
    ['depois do fim', '2026-12-03T10:00:00.000Z'],
  ])('%s', (_rotulo, agora) => {
    const servidor = resolveSignupTrialTerms({
      planCode: 'clinica_2026_3',
      attemptedAt: new Date(agora),
      authCreatedAt: criada,
    })!;
    const tela = firstChargeFor(fim, new Date(agora))!;
    expect(tela.dueDate).toBe(servidor.firstDueDate);
    expect(tela.expired).toBe(servidor.expiredAtCheckout);
  });

  it('conta os dias que restam e formata a data sem fuso', () => {
    expect(firstChargeFor(fim, criada)?.remainingDays).toBe(14);
    expect(firstChargeFor(fim, new Date('2026-11-29T03:00:00.000Z'))?.remainingDays).toBe(3);
    expect(formatIsoDate('2026-12-03')).toBe('03/12/2026');
    expect(firstChargeFor('não é data', criada)).toBeNull();
  });
});
