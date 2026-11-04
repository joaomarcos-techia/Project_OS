import 'server-only';

import {
  sendTransactionalEmail,
  TransactionalEmailError,
  type TransactionalEmailInput,
} from './resend';

const QUICK_FAILURE_WINDOW_MS = 2_000;
const RETRY_DELAY_MS = 250;

/** One retry only, identical provider idempotency key/content; no retry of permanent rejections. */
export async function sendTransactionalEmailRetried(
  input: TransactionalEmailInput,
): Promise<{ providerMessageId: string }> {
  const started = Date.now();
  try {
    return await sendTransactionalEmail(input);
  } catch (error) {
    const temporary =
      error instanceof TransactionalEmailError &&
      (error.status === null || error.status === 429 || error.status >= 500);
    // A full provider timeout already spent the request budget. Preserve the
    // uncertain outcome for explicit reconciliation instead of retrying blind.
    if (!temporary || Date.now() - started > QUICK_FAILURE_WINDOW_MS) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return sendTransactionalEmail(input);
  }
}
