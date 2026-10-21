import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SubscriptionCreatedSchema } from './events';
import {
  isOffer2026PlanCode,
  OFFER_2026_PLAN_CODES,
  offer2026MonthlyCents,
  offer2026PlanCodeFor,
  offer2026Professionals,
  offer2026StaffLimit,
  planCatalogOf,
  planHasTeamFeatures,
} from './offer-2026';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0119_offer_2026_per_professional.sql'),
  'utf8',
);

describe('oferta 2026 — regra comercial (ADR-067)', () => {
  it('Consultório custa R$ 197 e a Clínica R$ 397 + R$ 147 por profissional além de 2', () => {
    expect(offer2026MonthlyCents(1)).toBe(19_700);
    expect(offer2026MonthlyCents(2)).toBe(39_700);
    expect(offer2026MonthlyCents(3)).toBe(54_400);
    expect(offer2026MonthlyCents(5)).toBe(83_800);
    expect(offer2026MonthlyCents(10)).toBe(157_300);
  });

  it('recusa quantidade fora de 1 a 10 ou fracionada', () => {
    for (const invalid of [0, -1, 11, 2.5, Number.NaN]) {
      expect(offer2026MonthlyCents(invalid)).toBeNull();
      expect(offer2026PlanCodeFor(invalid)).toBeNull();
      expect(offer2026StaffLimit(invalid)).toBeNull();
    }
  });

  it('cada quantidade tem um plano, e o plano devolve a quantidade', () => {
    expect(OFFER_2026_PLAN_CODES).toHaveLength(10);
    for (let professionals = 1; professionals <= 10; professionals += 1) {
      const code = offer2026PlanCodeFor(professionals);
      expect(code).not.toBeNull();
      expect(offer2026Professionals(code)).toBe(professionals);
    }
    expect(offer2026PlanCodeFor(1)).toBe('consultorio_2026');
    expect(offer2026PlanCodeFor(4)).toBe('clinica_2026_4');
  });

  it('equipe: até 3 no Consultório, ilimitada na Clínica', () => {
    expect(offer2026StaffLimit(1)).toBe(3);
    expect(offer2026StaffLimit(2)).toBeNull();
    expect(offer2026StaffLimit(10)).toBeNull();
  });

  it('a tabela antiga continua separada e não é reconhecida como oferta nova', () => {
    for (const legacy of ['solo', 'clinica', 'pro']) {
      expect(isOffer2026PlanCode(legacy)).toBe(false);
      expect(offer2026Professionals(legacy)).toBeNull();
      expect(planCatalogOf(legacy)).toBe('legacy');
    }
    expect(planCatalogOf('clinica_2026_7')).toBe('offer_2026');
  });

  it('ajuste por pessoa, repasse e preço por meio: Clínica nova e antiga, Pro; nunca Consultório/Solo', () => {
    expect(planHasTeamFeatures('clinica')).toBe(true);
    expect(planHasTeamFeatures('pro')).toBe(true);
    expect(planHasTeamFeatures('clinica_2026_2')).toBe(true);
    expect(planHasTeamFeatures('clinica_2026_10')).toBe(true);
    expect(planHasTeamFeatures('consultorio_2026')).toBe(false);
    expect(planHasTeamFeatures('solo')).toBe(false);
    expect(planHasTeamFeatures(null)).toBe(false);
  });

  it('os eventos de billing aceitam os códigos novos sem perder os antigos', () => {
    for (const code of ['solo', 'clinica', 'pro', ...OFFER_2026_PLAN_CODES]) {
      expect(SubscriptionCreatedSchema.shape.planCode.safeParse(code).success).toBe(true);
    }
    expect(SubscriptionCreatedSchema.shape.planCode.safeParse('clinica_2026_11').success).toBe(
      false,
    );
  });
});

describe('oferta 2026 — migration 0119 grava o mesmo catálogo', () => {
  const seatRows = [
    ...migration.matchAll(
      /\('((?:consultorio|clinica)_2026(?:_\d+)?)', (\d+), (3|NULL::integer)\)/gu,
    ),
  ].map(([, code, professionals, staff]) => ({
    code,
    professionals: Number(professionals),
    staff: staff === 'NULL::integer' ? null : Number(staff),
  }));

  it('um plano ativo por código, com o nome que o Checkout mostra', () => {
    for (const code of OFFER_2026_PLAN_CODES) {
      const professionals = offer2026Professionals(code)!;
      const name = professionals === 1 ? 'Consultório' : `Clínica · ${professionals} profissionais`;
      expect(migration).toContain(`('${code}', '${name}', true)`);
      // O Asaas corta o item em 30 caracteres (signup-hosted-checkout).
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it('tetos por plano iguais aos do módulo', () => {
    expect(seatRows.map((row) => row.code)).toEqual([...OFFER_2026_PLAN_CODES]);
    for (const row of seatRows) {
      expect(row.professionals).toBe(offer2026Professionals(row.code));
      expect(row.staff).toBe(offer2026StaffLimit(row.professionals));
    }
  });

  it('a mensalidade é calculada pela mesma fórmula e conferida no fim da migration', () => {
    const formula =
      'CASE WHEN l.professionals = 1 THEN 197.00\n            ELSE 397.00 + 147.00 * (l.professionals - 2) END';
    expect(migration).toContain(formula);
    expect(migration).toContain("'monthly'");
    expect(migration).not.toMatch(/'annual'/u);
    // Bloco de conferência: falha alto se o ON CONFLICT engolir algo (0077/0078).
    expect(migration).toMatch(/RAISE EXCEPTION 'catalogo da oferta 2026 incompleto/u);
  });

  it('não toca preço nem limite da tabela antiga', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.prices/iu);
    expect(migration).not.toMatch(/UPDATE\s+(public\.)?plan_limits/iu);
    expect(migration).not.toMatch(/UPDATE\s+(public\.)?subscriptions/iu);
    expect(migration).not.toMatch(/INSERT INTO public\.plan_limits/iu);
  });
});
