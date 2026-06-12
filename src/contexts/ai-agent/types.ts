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
