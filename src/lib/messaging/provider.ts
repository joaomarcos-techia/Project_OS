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
  /**
   * Meta message `type` (`text`, `audio`, `image`, `document`, `video`, `sticker`…).
   * Lets the AI agent answer a voice note or a file instead of staying silent
   * (08/10/2026). Not personal data; null when the provider does not send it.
   */
  messageType?: string | null;
  /** Provider-reported timestamp (epoch seconds as string). */
  timestamp: string;
  /**
   * WhatsApp profile name of the sender (`contacts[].profile.name`), already
   * sanitized; null/absent when the provider does not send it. Personal data:
   * encrypted before persist, never logged nor put in an outbox payload.
   */
  contactName?: string | null;
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

/**
 * Coexistência — mensagem que a recepção ENVIOU pelo app WhatsApp Business do
 * celular (webhook field `smb_message_echoes`). Não é inbound: o remetente é a
 * própria clínica e o destinatário é o paciente.
 */
export interface ParsedBusinessAppEcho {
  providerMessageId: string;
  /** Destinatário (o paciente), dígitos — hashed/cifrado antes de persistir. */
  toNumber: string;
  /** `phone_number_id` da clínica (roteamento de tenant). */
  fromPhoneId: string;
  /** Texto, ou null para mídia e outros tipos. */
  text: string | null;
  /** Epoch em segundos, como string (formato da Meta). */
  timestamp: string;
}

/**
 * `account_update` com `event: PARTNER_REMOVED`: a clínica (ou a Meta, por
 * inatividade do celular) tirou a Qoro da conta. A partir daqui a Qoro não
 * consegue mais enviar por aquela WABA.
 */
export interface ParsedPartnerRemoval {
  wabaId: string;
  /** Ex.: `PRIMARY_INACTIVITY`, `ACCOUNT_DISCONNECTED` — null se a Meta não informou. */
  reason: string | null;
  /** `USER` ou `SYSTEM` — null se a Meta não informou. */
  initiatedBy: string | null;
}

/** Normalized webhook parse result (text messages + status callbacks). */
export interface ParsedWebhookEvent {
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusEvent[];
  /** Coexistência: respostas da recepção pelo celular. */
  echoes?: ParsedBusinessAppEcho[];
  partnerRemovals?: ParsedPartnerRemoval[];
  /**
   * Histórico (`history`) e contatos (`smb_app_state_sync`) da coexistência:
   * a Qoro pede a sincronização (a Meta exige) mas NÃO guarda o conteúdo —
   * decisão de produto/LGPD de 30/09/2026. Só a contagem sobe, para métrica.
   */
  discarded?: { historyMessages: number; stateSyncItems: number };
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
