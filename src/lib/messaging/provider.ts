/**
 * MessagingProvider — the FROZEN messaging surface (C10 contract).
 *
 * Exactly four methods — `sendText`, `sendTemplate`, `parseWebhook`,
 * `validateSignature`. No more, no less. This supersedes the 3-method sketch in
 * ADR-004 and absorbs the `webhook-validator.ts` the README anticipated:
 * signature validation is a provider method because each provider signs
 * differently (Meta uses X-Hub-Signature-256 over the raw body).
 *
 * Anti-Hydra: Meta and ZApi implement this interface DIRECTLY — there is no
 * BaseProvider / AbstractProvider / ProviderFactory. Selection is a single
 * `getMessagingProvider(name)` switch (2 impls; ADR-004 sanctions this).
 *
 * Pure transport: NO database, NO bounded-context imports. The route reads the
 * raw body ONCE (for HMAC) and hands the same string to parseWebhook — so both
 * `parseWebhook` and `validateSignature` operate on `rawBody: string`, never on
 * a `Request` (reading the stream twice is impossible).
 */

/** Provider discriminator persisted on every messaging row. */
export type MessagingProviderName = 'meta' | 'zapi';

export interface SendTextArgs {
  /** Recipient phone in digits (Meta accepts E.164 with/without leading +). */
  toNumber: string;
  /** Plain message body. */
  text: string;
  /** Meta `phone_number_id` the clinic sends FROM (provider routing). */
  fromPhoneId: string;
  /** Decrypted per-clinic access token (never logged). */
  accessToken: string;
}

export interface SendTemplateArgs {
  toNumber: string;
  /** Approved template name. */
  templateName: string;
  /** BCP-47 language code (e.g. `pt_BR`). */
  languageCode: string;
  /** Ordered body parameters (text only — no media in C10). */
  variables: string[];
  fromPhoneId: string;
  accessToken: string;
}

/** Result of a successful provider send. */
export interface MessageRef {
  /** Provider message id (Meta `wamid`). */
  providerMessageId: string;
  /** Raw provider response — persisted as `outbound_messages.provider_response`. */
  raw: unknown;
}

/** One inbound text message extracted from a webhook. */
export interface ParsedInboundMessage {
  providerMessageId: string;
  /** Sender phone (digits) — hashed before persist, NEVER stored plaintext. */
  fromNumber: string;
  /** Meta `phone_number_id` the message arrived on (tenant routing). */
  toPhoneId: string;
  /** Clinic display number (non-sensitive) — or null if absent. */
  toNumber: string | null;
  /** Text body, or null for unsupported (media) types — not processed in C10. */
  text: string | null;
  /** Provider-reported timestamp (epoch seconds as string). */
  timestamp: string;
}

/** One delivery/read status callback extracted from a webhook. */
export interface ParsedStatusEvent {
  /** `wamid` of the OUTBOUND message this status refers to. */
  providerMessageId: string;
  /** sent | delivered | read | failed (provider string, stored raw). */
  status: string;
  /** Recipient phone (digits) — hashed before persist; null if absent. */
  recipientNumber: string | null;
  /** `phone_number_id` the status arrived on (tenant routing). */
  toPhoneId: string;
  /** Original provider status object, persisted as `provider_status_events_raw.raw`. */
  raw: unknown;
}

/** Normalized webhook parse result (text messages + status callbacks). */
export interface ParsedWebhookEvent {
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusEvent[];
}

export interface MessagingProvider {
  sendText(args: SendTextArgs): Promise<MessageRef>;
  sendTemplate(args: SendTemplateArgs): Promise<MessageRef>;
  /** Pure parse of an already-read raw body. Never throws on malformed JSON
   *  (returns empty arrays) — a bad body is an operational signal, not a crash. */
  parseWebhook(rawBody: string): ParsedWebhookEvent;
  /** HMAC validation over the raw body. `signatureHeader` = `X-Hub-Signature-256`. */
  validateSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean;
}
