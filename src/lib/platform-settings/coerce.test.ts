import { describe, expect, it } from 'vitest';

import { coerceAiMode, coerceBool } from './coerce';

describe('platform-settings coerce — defaults SEGUROS por flag', () => {
  describe('coerceBool (proactive_jobs.enabled)', () => {
    it('respeita booleans válidos', () => {
      expect(coerceBool(true, true)).toBe(true);
      expect(coerceBool(false, true)).toBe(false);
    });
    it('valor corrompido/ausente → fallback', () => {
      expect(coerceBool(undefined, true)).toBe(true);
      expect(coerceBool(null, true)).toBe(true);
      expect(coerceBool('false', true)).toBe(true); // string não é boolean → fallback
      expect(coerceBool(0, true)).toBe(true);
    });
  });

  describe('coerceAiMode (ai_agent.mode)', () => {
    it('só fallback_only ativa a degradação', () => {
      expect(coerceAiMode('fallback_only')).toBe('fallback_only');
    });
    it('qualquer outra coisa → normal (não degradar por erro)', () => {
      expect(coerceAiMode('normal')).toBe('normal');
      expect(coerceAiMode('FALLBACK_ONLY')).toBe('normal');
      expect(coerceAiMode(undefined)).toBe('normal');
      expect(coerceAiMode({ mode: 'fallback_only' })).toBe('normal');
    });
  });
});
