import 'server-only';

const RESEND_API = 'https://api.resend.com';
const EMAIL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class ResendInspectorError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ResendInspectorError';
  }
}

export interface ResendEmailSummary {
  id: string;
  to: string[];
  from: string;
  subject: string;
  createdAt: string;
  lastEvent: string | null;
}

export interface ResendEmail extends ResendEmailSummary {
  html: string | null;
  text: string | null;
  messageId: string | null;
}

type ResendList = { data?: unknown; has_more?: unknown };

function errorKind(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('name' in body)) return null;
  const value = body.name;
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/iu.test(value) ? value : null;
}

async function resendGet(path: string, apiKey: string): Promise<unknown> {
  if (!apiKey) throw new ResendInspectorError('Resend inspector API key is missing', null);
  let response: Response;
  try {
    response = await fetch(`${RESEND_API}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new ResendInspectorError(
      `Resend inspector is unreachable: ${error instanceof Error ? error.name : 'unknown'}`,
      null,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const kind = errorKind(body);
    throw new ResendInspectorError(
      `Resend inspector rejected request (${response.status}${kind ? `; ${kind}` : ''})`,
      response.status,
    );
  }
  return body;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function summary(value: unknown): ResendEmailSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    !EMAIL_ID.test(row.id) ||
    typeof row.from !== 'string' ||
    typeof row.subject !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    to: strings(row.to),
    from: row.from,
    subject: row.subject,
    createdAt: row.created_at,
    lastEvent: typeof row.last_event === 'string' ? row.last_event : null,
  };
}

function email(value: unknown): ResendEmail {
  const base = summary(value);
  if (!base || !value || typeof value !== 'object') {
    throw new ResendInspectorError('Resend inspector returned an invalid email payload', 200);
  }
  const row = value as Record<string, unknown>;
  return {
    ...base,
    html: typeof row.html === 'string' ? row.html : null,
    text: typeof row.text === 'string' ? row.text : null,
    messageId: typeof row.message_id === 'string' ? row.message_id : null,
  };
}

async function list(
  path: '/emails' | '/emails/receiving',
  apiKey: string,
): Promise<ResendEmailSummary[]> {
  const body = (await resendGet(`${path}?limit=100`, apiKey)) as ResendList;
  if (!Array.isArray(body?.data)) {
    throw new ResendInspectorError('Resend inspector returned an invalid list payload', 200);
  }
  return body.data.map(summary).filter((item): item is ResendEmailSummary => item !== null);
}

export function listSentEmails(apiKey: string): Promise<ResendEmailSummary[]> {
  return list('/emails', apiKey);
}

export function listReceivedEmails(apiKey: string): Promise<ResendEmailSummary[]> {
  return list('/emails/receiving', apiKey);
}

export async function getSentEmail(apiKey: string, id: string): Promise<ResendEmail> {
  if (!EMAIL_ID.test(id)) throw new ResendInspectorError('Resend email id is invalid', null);
  return email(await resendGet(`/emails/${encodeURIComponent(id)}`, apiKey));
}

export async function getReceivedEmail(apiKey: string, id: string): Promise<ResendEmail> {
  if (!EMAIL_ID.test(id)) throw new ResendInspectorError('Resend email id is invalid', null);
  return email(await resendGet(`/emails/receiving/${encodeURIComponent(id)}`, apiKey));
}

export interface WaitForResendEmailInput {
  apiKey: string;
  to: string;
  subject: string;
  sentAfter: Date;
  kind: 'sent' | 'received';
  timeoutMs?: number;
  pollMs?: number;
  acceptedLastEvents?: readonly string[];
  rejectedLastEvents?: readonly string[];
}

/** Polls metadata, then retrieves the body only for the exact matching test email. */
export async function waitForResendEmail(input: WaitForResendEmailInput): Promise<ResendEmail> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const pollMs = input.pollMs ?? 1_000;
  if (timeoutMs < 1_000 || timeoutMs > 120_000 || pollMs < 100 || pollMs > 10_000) {
    throw new ResendInspectorError('Resend inbox polling limits are invalid', null);
  }
  const recipient = input.to.trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows =
      input.kind === 'sent'
        ? await listSentEmails(input.apiKey)
        : await listReceivedEmails(input.apiKey);
    const match = rows.find(
      (row) =>
        row.subject === input.subject &&
        row.to.some((address) => address.toLowerCase() === recipient) &&
        Date.parse(row.createdAt) >= input.sentAfter.getTime(),
    );
    if (match) {
      const lastEvent = match.lastEvent?.toLowerCase() ?? null;
      if (lastEvent && input.rejectedLastEvents?.includes(lastEvent)) {
        throw new ResendInspectorError(
          `Expected test email reached rejected event: ${lastEvent}`,
          null,
        );
      }
      if (
        input.acceptedLastEvents &&
        (!lastEvent || !input.acceptedLastEvents.includes(lastEvent))
      ) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      return input.kind === 'sent'
        ? getSentEmail(input.apiKey, match.id)
        : getReceivedEmail(input.apiKey, match.id);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new ResendInspectorError('Timed out waiting for the expected test email', null);
}

/** Creates an isolated address on the catch-all Resend inbound domain. */
export function createResendInboxAlias(baseAddress: string, runId: string): string {
  const parts = baseAddress.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !/^[a-z0-9.-]+$/u.test(parts[1] ?? '')) {
    throw new ResendInspectorError('E2E Resend inbox address is invalid', null);
  }
  const safeRunId = runId
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, '')
    .slice(0, 48);
  if (!safeRunId) throw new ResendInspectorError('E2E Resend inbox run id is invalid', null);
  return `qoro-e2e-${safeRunId}@${parts[1]}`;
}
