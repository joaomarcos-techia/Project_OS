import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PREMIUM_DENIALS,
  PREMIUM_FEATURES,
  PremiumAccessError,
  premiumAccessErrorFrom,
  premiumDenialMessage,
} from './policy';

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'drizzle/migrations/0151_hi_premium_gate.sql'),
  'utf8',
);

describe('premium-access — contrato com o banco (0151)', () => {
  it('todo motivo que o banco devolve é conhecido do app, e vice-versa', () => {
    const fromSql = new Set([...MIGRATION.matchAll(/RETURN '([a-z_]+)';/gu)].map((m) => m[1]));
    expect([...fromSql].sort()).toEqual([...PREMIUM_DENIALS].sort());
  });

  it('os três recursos premium são exatamente os do banco', () => {
    const check = MIGRATION.match(/p_feature NOT IN \(([^)]+)\)/u)![1]!;
    expect(check.split(',').map((s) => s.trim().replace(/'/gu, ''))).toEqual([...PREMIUM_FEATURES]);
  });

  it('nenhum plano pago exclui recurso hoje; plano desconhecido fica de fora (falha fechada)', () => {
    const lists = [...MIGRATION.matchAll(/WHEN '([a-z_]+)' THEN p_plan_code IN \(([^)]+)\)/gu)];
    expect(lists.map((m) => m[1])).toEqual([...PREMIUM_FEATURES]);
    const plans = lists.map((m) => m[2]!.replace(/\s+/gu, ' '));
    expect(new Set(plans).size).toBe(1);
    expect(MIGRATION).toMatch(/ELSE false/u);
  });
});

describe('premium-access — mensagens e tradução do erro', () => {
  it('mensagem comercial clara, sem termo técnico, para todo recurso e motivo', () => {
    for (const feature of PREMIUM_FEATURES) {
      for (const reason of PREMIUM_DENIALS) {
        const msg = premiumDenialMessage(feature, reason);
        expect(msg.length).toBeGreaterThan(30);
        expect(msg).not.toMatch(/sql|constraint|erro|error|null|undefined/iu);
      }
    }
    expect(premiumDenialMessage('health_insurance', 'trial')).toContain(
      'disponível para clínicas com assinatura ativa. Conheça os planos do Qoro',
    );
    expect(premiumDenialMessage('ai_agents', 'subscription_cancelled')).toContain(
      'Os registros já feitos continuam disponíveis para consulta',
    );
  });

  it('traduz só o erro conhecido do banco (23514 + qoro_premium_<recurso>), inclusive aninhado', () => {
    const pg = { code: '23514', constraint_name: 'qoro_premium_health_insurance', detail: 'trial' };
    const err = premiumAccessErrorFrom({ cause: { cause: pg } });
    expect(err).toBeInstanceOf(PremiumAccessError);
    expect([err!.feature, err!.reason, err!.code]).toEqual(['health_insurance', 'trial', 'premium_feature_required']);
    // Motivo fora da lista vira o genérico; recurso desconhecido ou outro erro não é traduzido.
    expect(premiumAccessErrorFrom({ ...pg, detail: 'x; drop table' })!.reason).toBe('subscription_inactive');
    expect(premiumAccessErrorFrom({ ...pg, constraint_name: 'qoro_premium_outro' })).toBeNull();
    expect(premiumAccessErrorFrom({ code: '23514', constraint_name: 'qoro_trial_limit_asaas' })).toBeNull();
    expect(premiumAccessErrorFrom(new Error('SELECT * FROM secret'))).toBeNull();
    const own = new PremiumAccessError('patient_charges', 'plan_excludes');
    expect(premiumAccessErrorFrom(own)).toBe(own);
  });
});
