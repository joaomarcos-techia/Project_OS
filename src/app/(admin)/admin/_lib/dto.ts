/**
 * DTOs públicos do Platform Admin (C15) — contratos de SAÍDA das telas.
 *
 * Nunca expomos entidades de banco cruas (review: contrato > implementação).
 * Repositórios mapeiam rows → DTO; páginas consomem só DTO.
 */

// --- Dashboard (/admin) + Métricas (/admin/metricas) ---
export interface DashboardMetricsDTO {
  mrrCents: number;
  arrCents: number;
  churnRatePct: number;
  monthlyGrowthPct: number;
  clinics: { active: number; atRisk: number; new: number; cancelled: number };
  generatedAt: string; // ISO
}

export interface PlatformUsageDTO {
  dau: number;
  wau: number;
  activeClinics: number;
  aiConversations: number;
  aiMessages: number;
  aiTokens: number;
  geminiCostUsd: number;
  dailyAvgMessages: number;
  periodFrom: string; // ISO
  periodTo: string; // ISO
}

// --- Clínicas ---
export interface ClinicListItemDTO {
  id: string;
  nome: string;
  slug: string;
  status: string;
  planCode: string | null;
  billingStatus: string | null;
  lastActivityAt: string | null; // ISO
}

export interface ClinicListResultDTO {
  items: ClinicListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClinicDetailDTO {
  general: {
    id: string;
    nome: string;
    slug: string;
    status: string;
    cnpj: string | null;
    timezone: string;
    createdAt: string; // ISO
  };
  plan: { code: string; name: string; priceCents: number; cycle: string } | null;
  billing: {
    openInvoices: number;
    overdue: number;
    dunningStage: number;
    billingStatus: string | null;
    lastPaidAt: string | null;
  };
  users: { id: string; nome: string; role: string; ativo: boolean }[];
  aiUsage: { conversations: number; messages: number; tokens: number; costUsd: number };
  integrations: { whatsapp: 'connected' | 'pending' | 'none'; asaas: 'linked' | 'none' };
  recentAudit: AuditEntryDTO[];
}

// --- Billing (/admin/billing) ---
export interface InvoiceRowDTO {
  id: string;
  clinicId: string;
  clinicNome: string;
  amountCents: number;
  status: string;
  dueDate: string; // YYYY-MM-DD
  paidAt: string | null; // ISO
}

export interface BillingOverviewDTO {
  mrrCents: number;
  arrCents: number;
  open: InvoiceRowDTO[];
  overdue: InvoiceRowDTO[];
  dunning: { clinicId: string; nome: string; stage: number }[];
  refunds: { clinicId: string; nome: string; amountCents: number; at: string }[];
}

// --- Conversas IA (/admin/conversas-ia) — JÁ DESCRIPTOGRAFADO ---
export interface ConversationListItemDTO {
  id: string;
  clinicId: string;
  clinicNome: string;
  status: string;
  lastMessageAt: string; // ISO
  messageCount: number;
}

export interface AiMessageDTO {
  id: string;
  direction: 'in' | 'out';
  /** plaintext resolvido SERVER-SIDE; jamais ciphertext. */
  text: string;
  model: string | null;
  createdAt: string; // ISO
}

export interface ConversationDetailDTO {
  id: string;
  clinicNome: string;
  status: string;
  messages: AiMessageDTO[];
}

// --- Audit (/admin/audit + export) ---
export interface AuditEntryDTO {
  id: string;
  timestamp: string; // ISO
  userId: string | null;
  action: string;
  clinicId: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  result: string;
}

export interface AuditSearchResultDTO {
  items: AuditEntryDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditExportResultDTO {
  signedUrl: string;
  sha256: string;
  expiresInDays: 7;
  rowCount: number;
}

// --- Health (/admin/saude) ---
export type HealthStatus = 'ok' | 'degraded' | 'down';
export interface HealthReportDTO {
  provider: 'meta' | 'gemini' | 'supabase' | 'asaas';
  status: HealthStatus;
  reason: string;
  latencyMs: number | null;
  lastSuccessAt: string | null; // ISO
  checkedAt: string; // ISO
}
