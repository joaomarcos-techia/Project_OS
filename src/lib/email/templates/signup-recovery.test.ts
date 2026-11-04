import { describe, expect, it } from 'vitest';
import { renderSignupRecoveryEmail } from './signup-recovery';
const input = {
  url: `https://app.qoro.test/cadastro/retomar#token=${'A'.repeat(43)}`,
  publicOrigin: 'https://app.qoro.test',
  kind: 'verify_email' as const,
  retainedDetails: false,
};
describe('recovery email', () => {
  it('has one secure continuation link and makes no false promise about deleted data', () => {
    const result = renderSignupRecoveryEmail(input);
    expect(result.text).toContain('Se algum dado anterior não estiver mais disponível');
    expect(result.text).toContain('24 horas');
    expect(result.html).toContain('/cadastro/retomar#token=');
    expect(result.html).not.toContain('<script');
  });
  it('uses retained verified details only when available and escapes names', () => {
    const result = renderSignupRecoveryEmail({
      ...input,
      retainedDetails: true,
      name: '<img onerror="alert(1)">',
    });
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
    expect(result.text).toContain('Os dados salvos do seu cadastro serão preservados');
  });
  it('distinguishes plan reminder from email verification without creating another flow', () => {
    const result = renderSignupRecoveryEmail({ ...input, kind: 'resume_signup' });
    expect(result.subject).toBe('Seu cadastro está quase pronto!');
    expect(result.text).toContain(input.url);
  });
  it.each([
    'https://evil.example/cadastro/retomar#token=' + 'A'.repeat(43),
    'javascript:alert(1)',
    'https://app.qoro.test/cadastro/retomar?token=' + 'A'.repeat(43),
    'https://app.qoro.test/other#token=' + 'A'.repeat(43),
  ])('rejects unsafe recovery destination', (url) => {
    expect(() => renderSignupRecoveryEmail({ ...input, url })).toThrow();
  });
});
