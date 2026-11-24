/**
 * P8.4-r — as alternativas do item executado sem solicitação (hipóteses, não política aprovada).
 * A vigente é `undecided`: nada é faturado e o registro não é bloqueado.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_EXTRA_ITEM_POLICY,
  EXTRA_ITEM_POLICIES,
  resolveExtraItemBilling,
  type ExtraItemFacts,
} from './extra-item-policy';

const free: ExtraItemFacts = { requiresAuthorization: false, quantity: 1, grantedAuthorization: null };
const needsAuth: ExtraItemFacts = { requiresAuthorization: true, quantity: 2, grantedAuthorization: null };

describe('P8.4-r: item executado sem solicitação', () => {
  it('a política em vigor é "sem decisão" e não fatura nada', () => {
    expect(ACTIVE_EXTRA_ITEM_POLICY).toBe('undecided');
    for (const facts of [free, needsAuth, { ...needsAuth, grantedAuthorization: { itemId: 'ai-1', remaining: 9 } }]) {
      const r = resolveExtraItemBilling('undecided', facts);
      expect(r).toMatchObject({ bill: false, blocksApproval: false });
      expect(r.bill === false && r.issue?.code).toBe('EXTRA_ITEM_POLICY_PENDING');
    }
  });

  it('nenhuma alternativa bloqueia o REGISTRO: só decide o faturamento', () => {
    // O registro é do banco (0167) e acontece antes; aqui só existe o "fatura ou não".
    for (const p of EXTRA_ITEM_POLICIES) {
      const r = resolveExtraItemBilling(p, free);
      expect(typeof r.bill).toBe('boolean');
    }
  });

  it('(a) bloquear o faturamento: nunca fatura, sem travar a guia', () => {
    for (const facts of [free, needsAuth]) {
      expect(resolveExtraItemBilling('block_billing', facts)).toMatchObject({
        bill: false,
        blocksApproval: false,
        issue: { code: 'EXTRA_ITEM_NOT_BILLED', owner: 'financeiro' },
      });
    }
  });

  it('(b) pendência de regularização: não fatura e trava a aprovação da guia', () => {
    expect(resolveExtraItemBilling('regularization_pending', free)).toMatchObject({
      bill: false,
      blocksApproval: true,
      issue: { code: 'EXTRA_ITEM_REGULARIZATION', owner: 'recepcao' },
    });
  });

  it('(c) autorização posterior: fatura sem autorização só quando o contrato não exige', () => {
    expect(resolveExtraItemBilling('post_authorization', free)).toEqual({ bill: true, authorizationItemId: null });
  });

  it('(c) autorização posterior: com saldo suficiente, consome o item autorizado', () => {
    expect(
      resolveExtraItemBilling('post_authorization', { ...needsAuth, grantedAuthorization: { itemId: 'ai-7', remaining: 2 } }),
    ).toEqual({ bill: true, authorizationItemId: 'ai-7' });
  });

  it('(c) autorização posterior: sem autorização ou com saldo menor, não fatura acima do autorizado', () => {
    expect(resolveExtraItemBilling('post_authorization', needsAuth)).toMatchObject({
      bill: false,
      issue: { code: 'EXTRA_ITEM_AUTHORIZATION_MISSING' },
    });
    const short = resolveExtraItemBilling('post_authorization', {
      ...needsAuth,
      grantedAuthorization: { itemId: 'ai-7', remaining: 1 },
    });
    expect(short).toMatchObject({ bill: false, blocksApproval: false });
    expect(short.bill === false && short.issue?.message).toContain('saldo de 1');
  });

  it('(d) só registro: sem cobrança e sem pendência', () => {
    expect(resolveExtraItemBilling('record_only', needsAuth)).toEqual({ bill: false, issue: null, blocksApproval: false });
  });

  it('quantidade fora de 1 a 999 é recusada antes de qualquer decisão', () => {
    for (const quantity of [0, -1, 1000, 1.5]) {
      expect(() => resolveExtraItemBilling('post_authorization', { ...free, quantity })).toThrow(RangeError);
    }
  });
});
