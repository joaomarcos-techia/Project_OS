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
export type { InboundReceivedPayload, BusinessAppEchoReceivedPayload } from './events';

// API interna versionada (M14) — consumida pelo AI Agent (C11): ler/marcar
// inbound (tx-aware, decrypt DENTRO do messaging) e enviar texto outbound.
export { messagingApiV1 } from './api';
export type { MessagingApiV1, InboundForAgent, BusinessAppEchoForAgent } from './api';
export { SuppressedRecipientError, NumberNotConnectedError } from './errors';

// META-001 — saúde REAL do canal. A tela e o cron precisam disso para não
// exibir "conectado" quando a Meta não entrega webhook algum.
export { checkClinicChannelHealth, sweepChannelHealth } from './internal/health-check';
export type { ChannelHealthResult } from './internal/health-check';
export { describeChannelHealthReason } from './internal/channel-health';
export type { ChannelHealthReason, ChannelHealthVerdict } from './internal/channel-health';

export type {
  ConnectNumberInput,
  SendOutboundInput,
  OutboundBody,
  OutboundResult,
  WhatsappNumberSummary,
} from './types';
