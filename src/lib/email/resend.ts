import 'server-only';

import { assertEmailRuntimeReady, env } from '@/lib/env';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

export class TransactionalEmailError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'TransactionalEmailError';
  }
}

export type TransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

type ResendConfig = { apiKey: string; from: string };

function assertInput(input: TransactionalEmailInput): void {
  if (!input.to || !input.subject || !input.html || !input.text) {
    throw new TransactionalEmailError('transactional email requires recipient and content', null);
  }
  if (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 256) {
    throw new TransactionalEmailError('transactional email idempotency key is invalid', null);
  }
}

export async function sendWithResend(
  input: TransactionalEmailInput,
  config: ResendConfig,
): Promise<{ providerMessageId: string }> {
  assertInput(input);
  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new TransactionalEmailError(
      `Resend is unreachable: ${error instanceof Error ? error.name : 'unknown'}`,
      null,
    );
  }
  if (!response.ok) {
    throw new TransactionalEmailError(
      `Resend rejected transactional email (${response.status})`,
      response.status,
    );
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new TransactionalEmailError('Resend response omitted message id', response.status);
  }
  return { providerMessageId: body.id };
}

export async function sendTransactionalEmail(
  input: TransactionalEmailInput,
): Promise<{ providerMessageId: string }> {
  assertEmailRuntimeReady();
  return sendWithResend(input, { apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! });
}
