import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { __testing__ } from './subscriptions';

describe('subscription.activated planCode', () => {
  it.each(['solo', 'clinica', 'pro'] as const)(
    'preserva o plano real %s no contrato do evento',
    (planCode) => {
      expect(__testing__.toPlanCode(planCode)).toBe(planCode);
    },
  );

  it('falha fechado para plano fora do contrato público', () => {
    expect(() => __testing__.toPlanCode('enterprise')).toThrow(/plano não suportado/);
  });

  it('activateSubscription busca o plano vinculado e não publica Solo fixo', () => {
    const source = readFileSync(new URL('./subscriptions.ts', import.meta.url), 'utf8');
    const activation = source.slice(
      source.indexOf('export async function activateSubscription'),
      source.indexOf('/**\n * Materializa a invoice'),
    );

    expect(activation).toContain('.innerJoin(plans, eq(plans.id, subscriptions.planId))');
    expect(activation).toContain('planCode: toPlanCode(sub.planCode)');
    expect(activation).not.toContain("planCode: 'solo'");
  });
});
