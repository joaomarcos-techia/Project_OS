/**
 * P8.4-r — política APROVADA em 24/11/2026: cada estado do item executado adicional leva a uma
 * decisão (pendência, ações possíveis e mensagem). Sem faturamento automático, sem autorização
 * presumida, sem aprovação silenciosa, operadora desconhecida não é aceite presumido.
 */
import { describe, expect, it } from 'vitest';

import { decideExtraItem, EXTRA_ITEM_POLICY, pendingApprovalMessage, type ExtraItemFacts } from './extra-item-policy';

const base: ExtraItemFacts = {
  status: 'recorded',
  requiresAuthorization: false,
  quantity: 2,
  guideState: 'open',
  insurerRule: 'accepts',
  candidateAuthorization: null,
  linkedAuthorizationProblem: null,
  billedInLiveGuide: false,
};
const decide = (over: Partial<ExtraItemFacts>) => decideExtraItem({ ...base, ...over });

describe('P8.4-r: política aprovada para o item executado além do solicitado', () => {
  it('é a política de 24/11 (nenhuma alternativa antiga em vigor)', () => {
    expect(EXTRA_ITEM_POLICY).toBe('p84r-2026-11-24');
  });

  it('regras 2 e 4: contrato sem exigência fica PENDENTE até a ação explícita do faturamento (nunca entra sozinho)', () => {
    const d = decide({});
    expect(d).toMatchObject({ stage: 'ready_to_include', pending: true, canInclude: true, canExclude: true, canCancel: true, canRegularize: false });
    expect(d.includeNeedsInsurerConfirmation).toBe(false);
  });

  it('regra 3: contrato que exige, sem autorização da solicitação: aguarda; não inclui nem liga', () => {
    const d = decide({ requiresAuthorization: true });
    expect(d).toMatchObject({ stage: 'awaiting_authorization', pending: true, canInclude: false, canRegularize: false, canExclude: true });
  });

  it('regra 3: autorização concedida com saldo ≥ quantidade: a recepção liga; ainda não inclui', () => {
    const d = decide({ requiresAuthorization: true, candidateAuthorization: { itemId: 'ai', remaining: 2 } });
    expect(d).toMatchObject({ stage: 'authorization_available', canRegularize: true, canInclude: false, pending: true });
  });

  it('regra 3: saldo menor que a quantidade não serve (nunca fatura acima do autorizado)', () => {
    const d = decide({ requiresAuthorization: true, candidateAuthorization: { itemId: 'ai', remaining: 1 } });
    expect(d).toMatchObject({ stage: 'awaiting_authorization', canRegularize: false, canInclude: false });
    expect(d.message).toContain('saldo autorizado (1)');
  });

  it('regra 3: regularizado e a autorização serve: o faturamento inclui (consome o saldo)', () => {
    expect(decide({ requiresAuthorization: true, status: 'regularized' })).toMatchObject({ stage: 'ready_to_include', canInclude: true });
  });

  it('autorização ligada que deixou de servir (cancelada, vencida, sem saldo): não inclui; pode não faturar', () => {
    const d = decide({ requiresAuthorization: true, status: 'regularized', linkedAuthorizationProblem: 'a autorização não está concedida pela operadora' });
    expect(d).toMatchObject({ stage: 'authorization_invalid', canInclude: false, canExclude: true, pending: true });
  });

  it('regra 7: operadora desconhecida pede a confirmação do contrato; proibição registrada impede incluir e ligar', () => {
    expect(decide({ insurerRule: 'unknown' }).includeNeedsInsurerConfirmation).toBe(true);
    expect(decide({ insurerRule: 'unknown', requiresAuthorization: true, status: 'regularized' }).includeNeedsInsurerConfirmation).toBe(true);
    const f = decide({ insurerRule: 'forbids' });
    expect(f).toMatchObject({ stage: 'insurer_forbids', canInclude: false, canRegularize: false, canExclude: true, pending: true });
    const fa = decide({ insurerRule: 'forbids', requiresAuthorization: true, candidateAuthorization: { itemId: 'ai', remaining: 9 } });
    expect(fa).toMatchObject({ stage: 'insurer_forbids', canRegularize: false });
  });

  it('a etapa da guia limita as ações: conferida só não fatura; aprovada não muda nada; sem guia não inclui', () => {
    expect(decide({ guideState: 'reviewed' })).toMatchObject({ canInclude: false, canExclude: true, canCancel: false, pending: true });
    expect(decide({ guideState: 'closed' })).toMatchObject({ canInclude: false, canExclude: false, canCancel: false });
    expect(decide({ guideState: 'none' })).toMatchObject({ canInclude: false, canExclude: true, canCancel: true });
  });

  it('regra 6: não faturado e cancelado não são pendência e não oferecem ação; incluído também não', () => {
    for (const status of ['excluded', 'cancelled'] as const) {
      const d = decide({ status });
      expect(d.pending).toBe(false);
      expect([d.canInclude, d.canExclude, d.canCancel, d.canRegularize]).toEqual([false, false, false, false]);
    }
    expect(decide({ status: 'included', billedInLiveGuide: true })).toMatchObject({ stage: 'included', pending: false, canInclude: false, canExclude: false });
  });

  it('incluído numa guia cancelada volta a ser pendência: incluir na guia nova ou não faturar', () => {
    const d = decide({ status: 'included', billedInLiveGuide: false });
    expect(d).toMatchObject({ stage: 'included_in_dead_guide', pending: true, canInclude: true, canExclude: true, canCancel: false });
  });

  it('quantidade fora de 1 a 999 é erro de programação, não decisão', () => {
    for (const quantity of [0, 1000, 1.5]) expect(() => decide({ quantity })).toThrow(RangeError);
  });

  it('a mensagem de bloqueio da aprovação diz o que fazer', () => {
    expect(pendingApprovalMessage(1)).toMatch(/1 item executado adicional pendente.*aprove sem ele, informando o motivo/u);
    expect(pendingApprovalMessage(3)).toMatch(/3 itens/u);
  });
});
