export type SignupEmailDelivery = 'pending' | 'delivered' | 'delayed' | 'failed';

/** Public feedback for the requesting session; never expose SMTP text or an account lookup. */
export function signupEmailDeliveryFeedback(
  status: string | null | undefined,
): SignupEmailDelivery {
  if (status === 'delivered') return 'delivered';
  if (status === 'delivery_delayed') return 'delayed';
  if (['bounced', 'suppressed', 'complained', 'failed'].includes(status ?? '')) return 'failed';
  return 'pending';
}
