import { describe, expect, it } from 'vitest';

import { CONTENT_SECURITY_POLICY } from './next.config';

describe('CONTENT_SECURITY_POLICY', () => {
  it('permite o SDK do Facebook usado pelo Embedded Signup', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain('https://connect.facebook.net');
  });
});
