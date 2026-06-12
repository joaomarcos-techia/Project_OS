// Superfície pública do contexto `ai-agent` (C11).
// Outros contextos só importam deste arquivo (eslint-plugin-boundaries).
//
// Expõe: entidades de schema + enums, nome/tipo do evento e DTOs públicos.
// Handler, tools, prompt layer, guards e persistência interna NÃO fazem parte
// da superfície cross-context — vizinhos reagem via outbox
// (`ai_agent.conversation.completed`), nunca chamadas diretas. O prompt é
// código congelado (prompts/system.ts) e JAMAIS é exportado/configurável.
export {
  aiConversations,
  aiMessages,
  aiClinicConfig,
  aiHandoffQueue,
  aiAgentFailures,
  aiConversationStatus,
  aiMessageDirection,
  aiFailureStage,
} from './schema';

export { AI_AGENT_EVENTS } from './events';
export type { ConversationCompletedPayload } from './events';

export type {
  PromptContext,
  PromptClinicInfo,
  PromptAiConfig,
  PromptPatientInfo,
  PromptHistoryEntry,
  ConversationSummary,
} from './types';
