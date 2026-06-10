// Superfície pública do contexto `messaging` (C10).
// Outros contextos só importam deste arquivo (eslint-plugin-boundaries).
//
// Expõe: entidades de schema + enums, nome/tipo do evento, e DTOs públicos.
// Server Actions, queries e persistência interna NÃO fazem parte da superfície
// cross-context — vizinhos (C11 AI Agent) reagem via `messaging.inbound.received`.
export {
  clinicWhatsappNumbers,
  inboundMessagesRaw,
  outboundMessages,
  providerStatusEventsRaw,
  inboundMessagesOrphaned,
  messagingProvider,
  outboundStatus,
} from './schema';

export { MESSAGING_EVENTS } from './events';
export type { InboundReceivedPayload } from './events';

export type {
  ConnectNumberInput,
  SendOutboundInput,
  OutboundBody,
  OutboundResult,
  WhatsappNumberSummary,
} from './types';
