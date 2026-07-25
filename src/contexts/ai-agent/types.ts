/**
 * DTOs públicos do contexto ai-agent (C11).
 *
 * PromptContext é o objeto ESTRUTURADO que o Context Builder produz (dados,
 * nunca prompt) e que a prompt layer consome. Lazy context (review G3): NÃO
 * carrega slots/procedures — as tools buscam seus próprios dados sob demanda.
 */

export interface PromptClinicInfo {
  id: string;
  nome: string;
  endereco: string | null;
  timezone: string;
}

export interface PromptAiConfig {
  workingHours: unknown;
  especialidades: string[] | null;
  canScheduleAnonymous: boolean;
  maxDaysAhead: number;
  /** C12: opt-in p/ divulgar valores de cobrança via agente (list_pending_payments). */
  canDisclosePayments: boolean;
}

/** Projeção mínima do paciente identificado (sem PII além do nome). */
export interface PromptPatientInfo {
  id: string;
  nome: string;
}

export interface PromptHistoryEntry {
  direction: 'in' | 'out';
  text: string;
}

export interface PromptContext {
  clinic: PromptClinicInfo;
  aiConfig: PromptAiConfig;
  patient: PromptPatientInfo | null;
  /** Últimas MAX_CONTEXT_MESSAGES em ordem cronológica (decifradas). */
  history: PromptHistoryEntry[];
  /** Mensagem corrente, já truncada em MAX_INBOUND_CHARS. */
  currentMessage: string;
}

/**
 * C12 — dados coletados de paciente NOVO durante o fluxo multi-turn (par.12.2).
 * Persistido cifrado per-tenant em ai_conversations.collected_data_encrypted
 * (contém CPF → nunca plaintext). O handler cria o paciente SÓ quando completo
 * (nome+cpf+telefone+motivo) E confirmado pelo paciente.
 */
export interface CollectedData {
  nome?: string;
  cpf?: string;
  telefone?: string;
  motivo?: string;
}

/** Forma armazenada: CollectedData + estado de coleta (estagnação + confirmação). */
export interface StoredCollect extends CollectedData {
  /** Turnos de coleta consecutivos SEM progresso (reset a cada campo novo). */
  _stagnation?: number;
  /** Paciente confirmou o resumo dos dados (gate de createPatient — par.12). */
  _confirmed?: boolean;
}

/** Campos obrigatórios para criar o paciente (par.12 — regras de coleta). */
export const COLLECT_REQUIRED_FIELDS = ['nome', 'cpf', 'telefone', 'motivo'] as const;

/** Resumo de conversa exposto cross-context (C15 lista a fila/viewer). */
export interface ConversationSummary {
  id: string;
  clinicId: string;
  patientId: string | null;
  status: 'active' | 'handoff' | 'closed' | 'abandoned';
  fallbackCount: number;
  startedAt: string;
  lastMessageAt: string;
}

// --- painel /conversas (ADR-047) ------------------------------------------------
//
// Fronteira dura entre row de banco e o que chega ao navegador. NENHUM destes
// tipos carrega patient_phone_encrypted, patient_phone_hash,
// collected_data_encrypted (contém CPF) ou prompt_snapshot_encrypted. Se um
// campo novo precisar aparecer na tela, ele entra AQUI explicitamente — nunca
// por spread de row.

export type AIConversationStatus = 'active' | 'handoff' | 'closed' | 'abandoned';
export type AIHandoffPriority = 'normal' | 'urgent';

export interface AIHandoffState {
  assignedToUserId: string | null;
  priority: AIHandoffPriority;
  dueAt: string;
  overdue: boolean;
}

export interface AIConversationListItem {
  id: string;
  /** Nome do paciente vinculado; null quando o contato não é paciente ainda. */
  patientDisplayName: string | null;
  /** Fallback de identificação quando não há nome. Sempre mascarado. */
  maskedPhone: string | null;
  /** Trecho da última mensagem, truncado. Decifrado no servidor. */
  lastMessagePreview: string | null;
  status: AIConversationStatus;
  lastMessageAt: string;
  intentAtual: string | null;
  handoff: AIHandoffState | null;
}

export interface AIConversationListResult {
  items: AIConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Autoria da mensagem. `direction` sozinho não basta: 'out' pode ser o agente
 * ou um humano do painel — quem separa é `sent_by_user_id` (ADR-047).
 */
export type AIMessageAuthor = 'patient' | 'agent' | 'human';

/**
 * Estado de ENTREGA da mensagem manual. `null` para inbound e para mensagens do
 * agente (o agente envia de forma síncrona no próprio turno). Deriva de
 * outbound_messages — persistir em ai_messages NÃO significa entregue.
 */
export type AIMessageDelivery = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Metadados operacionais do turno do agente. NUNCA inclui prompt snapshot. */
export interface AIMessageAgentMeta {
  intent: string | null;
  toolCalls: unknown;
  model: string | null;
  latencyMs: number | null;
  costUsd: number | null;
}

export interface AIThreadMessage {
  id: string;
  direction: 'in' | 'out';
  author: AIMessageAuthor;
  /** Conteúdo decifrado no servidor, dentro do tenant autorizado. */
  text: string;
  createdAt: string;
  meta: AIMessageAgentMeta | null;
  delivery: AIMessageDelivery | null;
}

export interface AIConversationThread {
  id: string;
  patientDisplayName: string | null;
  maskedPhone: string | null;
  status: AIConversationStatus;
  intentAtual: string | null;
  startedAt: string;
  lastMessageAt: string;
  messages: AIThreadMessage[];
  handoff: AIHandoffState | null;
  /** Janela de 24h da Meta, calculada no servidor no momento da leitura. */
  window: { open: boolean; lastInboundAt: string | null; closesAt: string | null };
}
