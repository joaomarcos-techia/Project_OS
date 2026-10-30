import { describe, expect, it } from 'vitest';

import { turnOutcomeAfterOutbound } from './inbound-received';

describe('resultado do turno após o envio ao WhatsApp', () => {
  it.each(['accepted', 'sent', 'delivered', 'read'] as const)(
    'contabiliza resposta que a Meta aceitou (%s)',
    (status) => {
      expect(turnOutcomeAfterOutbound('replied', status)).toBe('replied');
    },
  );

  it.each(['pending', 'unknown', 'failed'] as const)(
    'não afirma resposta enviada se o status é %s',
    (status) => {
      expect(turnOutcomeAfterOutbound('replied', status)).toBe('fallback');
    },
  );

  it('preserva os outcomes que não consomem a referência comercial', () => {
    expect(turnOutcomeAfterOutbound('handoff', 'failed')).toBe('handoff');
    expect(turnOutcomeAfterOutbound('suppressed', 'accepted')).toBe('suppressed');
  });
});
