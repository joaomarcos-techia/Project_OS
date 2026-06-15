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
