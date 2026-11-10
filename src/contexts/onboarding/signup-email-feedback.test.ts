import { describe, expect, it } from 'vitest';
import { signupEmailDeliveryFeedback } from './signup-email-feedback';

describe('safe session delivery feedback', () => {
  it.each(['bounced', 'suppressed', 'complained', 'failed'])(
    'surfaces %s without provider detail',
    (value) => {
      expect(signupEmailDeliveryFeedback(value)).toBe('failed');
    },
  );
  it.each([null, undefined, 'sent', 'unexpected provider text'])(
    'keeps uncertain states pending (%s)',
    (value) => {
      expect(signupEmailDeliveryFeedback(value)).toBe('pending');
    },
  );
  it('distinguishes delay and SMTP acceptance without claiming inbox placement', () => {
    expect(signupEmailDeliveryFeedback('delivery_delayed')).toBe('delayed');
    expect(signupEmailDeliveryFeedback('delivered')).toBe('delivered');
  });
});
