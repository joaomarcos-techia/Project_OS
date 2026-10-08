/**
 * "Já paguei" é respondido pelo servidor (08/10/2026, EC-22). A decisão é coberta
 * em `payment-claim.test.ts`; aqui ficam as travas estruturais do handler.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./inbound-received.ts', import.meta.url), 'utf8');

describe('ramo do "já paguei"', () => {
  it('mídia nunca é afirmação de pagamento', () => {
    expect(source).toContain(
      'const paymentClaim = media ? { claimed: false, cash: false } : detectPaymentClaim(turnText);',
    );
  });

  it('só para paciente identificado, depois de urgência e clínico, antes do kill-switch e do LLM', () => {
    const branch = source.indexOf('} else if (paymentClaim.claimed && conversation.patientId) {');
    expect(branch).toBeGreaterThan(source.indexOf("} else if (guard.kind === 'emergency') {"));
    expect(branch).toBeGreaterThan(
      source.indexOf("} else if (guard.kind === 'clinical_block' || guard.kind === 'clinical_with_operational') {"),
    );
    expect(branch).toBeLessThan(source.indexOf("} else if ((await getAiAgentMode()) === 'fallback_only') {"));
  });

  it('a resposta vem do status real e a equipe entra quando a decisão pede', () => {
    const start = source.indexOf('} else if (paymentClaim.claimed && conversation.patientId) {');
    const branch = source.slice(start, source.indexOf("} else if ((await getAiAgentMode()) === 'fallback_only') {"));
    expect(branch).toContain('await paymentClaimTurn({');
    expect(branch).toContain('responseText = decision.text;');
    expect(branch).toMatch(/if \(handoffReason\) \{\s+await phase\(clinicId, \(tx\) =>\s+escalateToHuman\(tx, clinicId, conversation\.id, handoffReason\)/);
    expect(branch).not.toContain('generate');
  });
});
