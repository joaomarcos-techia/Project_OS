/** Messaging context DTOs (C10). */
import { z } from 'zod';

import type { MessagingProviderName } from '@/lib/messaging';

/** Input do connect (Server Action super_admin / script CLI). */
export const ConnectNumberSchema = z.object({
  clinicId: z.string().uuid(),
  provider: z.enum(['meta', 'zapi']).default('meta'),
  phoneNumber: z.string().min(5),
  metaPhoneId: z.string().min(1),
  metaBusinessId: z.string().min(1).optional(),
  token: z.string().min(1),
});
export type ConnectNumberInput = z.input<typeof ConnectNumberSchema>;

export type OutboundBody =
  | { kind: 'text'; text: string }
  | { kind: 'template'; templateName: string; languageCode: string; variables: string[] };

export interface SendOutboundInput {
  clinicId: string;
  toNumber: string;
  /** UUID — validado na borda (evita NULL != NULL no dedup, 2ª#7). */
  idempotencyKey: string;
  body: OutboundBody;
  /** Finalidade usada para aplicar supressão granular; ausente = transacional. */
  purpose?: 'billing' | 'reminder' | 'followup' | 'marketing';
}

export type OutboundSendStatus = 'accepted' | 'failed' | 'unknown';
export type OutboundMessageStatus =
  | 'pending'
  | OutboundSendStatus
  | 'sent'
  | 'delivered'
  | 'read';

export interface OutboundResult {
  id: string;
  status: OutboundMessageStatus;
  providerMessageId: string | null;
  deduped: boolean;
}

export interface WhatsappNumberSummary {
  id: string;
  clinicId: string;
  provider: MessagingProviderName;
  phoneNumber: string;
  active: boolean;
}
