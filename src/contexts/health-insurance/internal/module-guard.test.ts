/**
 * Interruptor do módulo nas operações da classe A: comercial primeiro, depois o módulo; sem linha
 * de configuração = desligado (padrão). A prova com banco é health-insurance-module-switch-db.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PremiumAccessError } from '@/lib/premium-access';

import {
  ConveniosModuleDisabledError,
  assertConveniosModuleEnabledTx,
  assertConveniosOperableTx,
} from './module-guard';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const tx = (...answers: unknown[][]) => {
  const execute = vi.fn();
  for (const a of answers) execute.mockResolvedValueOnce(a);
  return { execute };
};

describe('interruptor do módulo (classe A)', () => {
  it('ligado e assinatura ativa: passa (duas leituras, nenhuma escrita)', async () => {
    const t = tx([{ denial: null }], [{ enabled: true }]);
    await expect(assertConveniosOperableTx(t, CLINIC)).resolves.toBeUndefined();
    expect(t.execute).toHaveBeenCalledTimes(2);
  });

  it('desligado ou sem configuração: recusa com a mensagem do módulo', async () => {
    for (const settings of [[{ enabled: false }], [{ enabled: null }], []]) {
      const t = tx([{ denial: null }], settings);
      const error = await assertConveniosOperableTx(t, CLINIC).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConveniosModuleDisabledError);
      expect((error as Error).message).toMatch(/^Convênios está desligado nesta clínica\./u);
    }
  });

  it('trial ou suspensa: a resposta é a comercial e o interruptor nem é lido', async () => {
    const t = tx([{ denial: 'trial' }]);
    const error = await assertConveniosOperableTx(t, CLINIC).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PremiumAccessError);
    expect(t.execute).toHaveBeenCalledTimes(1);
  });

  it('só o interruptor, para quem já decidiu a parte comercial', async () => {
    await expect(assertConveniosModuleEnabledTx(tx([{ enabled: true }]), CLINIC)).resolves.toBeUndefined();
    await expect(assertConveniosModuleEnabledTx(tx([]), CLINIC)).rejects.toBeInstanceOf(ConveniosModuleDisabledError);
  });
});
