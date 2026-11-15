/**
 * D24: toda negativa comercial vira evento observável (`premium.denied`), no mesmo padrão da
 * negativa de permissão (`authz.denied`, SEC-050). Achado de 15/11 (noite): a clínica em trial ou
 * suspensa que chamava a action direto não deixava rastro nenhum — a auditoria da operação morre
 * no rollback. Estes testes travam: conta uma vez, só campos estruturais, nada quando liberado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { metrics } from '@/lib/observability/metrics';

import { assertPremiumFeatureTx, PremiumAccessError, premiumAccessErrorFrom } from './index';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const txReturning = (denial: string | null) => ({ execute: vi.fn(async () => [{ denial }]) });
const dbError = (detail: string) => ({
  code: '23514',
  constraint_name: 'qoro_premium_health_insurance',
  detail,
  message: 'new row for relation "hi_guides" violates check constraint',
});

describe('premium.denied', () => {
  let emit: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    emit = vi.spyOn(metrics, 'emit').mockImplementation(() => undefined);
  });
  afterEach(() => emit.mockRestore());

  it('negativa no serviço: lança a mensagem de usuário e conta uma vez, com campos estruturais', async () => {
    const tx = txReturning('clinic_suspended');
    const error = await assertPremiumFeatureTx(tx, CLINIC, 'health_insurance').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PremiumAccessError);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('premium.denied', {
      feature: 'health_insurance',
      reason: 'clinic_suspended',
      source: 'service',
    });
    // A action traduz o mesmo erro para a mensagem: não conta de novo.
    expect(premiumAccessErrorFrom(error)).toBe(error);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('liberado: nada é contado', async () => {
    await assertPremiumFeatureTx(txReturning(null), CLINIC, 'health_insurance');
    expect(emit).not.toHaveBeenCalled();
  });

  it('negativa do gatilho do banco: conta uma vez, mesmo traduzida duas vezes', () => {
    const raw = { message: 'falhou', cause: dbError('trial') };
    const first = premiumAccessErrorFrom(raw);
    const second = premiumAccessErrorFrom(raw);
    expect(first).toBeInstanceOf(PremiumAccessError);
    expect(second).toBe(first);
    expect(first?.reason).toBe('trial');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('premium.denied', {
      feature: 'health_insurance',
      reason: 'trial',
      source: 'database',
    });
  });

  it('erro que não é negativa comercial: nada é contado', () => {
    expect(premiumAccessErrorFrom(new Error('outra coisa'))).toBeNull();
    expect(premiumAccessErrorFrom({ code: '23514', constraint_name: 'hi_guides_cancelled_chk' })).toBeNull();
    expect(premiumAccessErrorFrom(null)).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('o evento não carrega mensagem, SQL, clínica nem pessoa', async () => {
    await assertPremiumFeatureTx(txReturning('trial'), CLINIC, 'health_insurance').catch(() => null);
    premiumAccessErrorFrom(dbError('clinic_suspended'));
    for (const [, fields] of emit.mock.calls) {
      expect(Object.keys(fields as object).sort()).toEqual(['feature', 'reason', 'source']);
      expect(JSON.stringify(fields)).not.toContain(CLINIC);
      expect(JSON.stringify(fields)).not.toContain('hi_guides');
    }
  });

  it('cada negativa nova conta (é o que permite alertar por taxa)', async () => {
    for (let i = 0; i < 3; i += 1) {
      await assertPremiumFeatureTx(txReturning('trial'), CLINIC, 'health_insurance').catch(() => null);
    }
    expect(emit).toHaveBeenCalledTimes(3);
  });
});
