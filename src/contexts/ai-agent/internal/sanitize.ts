/**
 * sanitizeAiFailurePayload (R8) — contrato CONGELADO (ADR-022) do payload de
 * ai_agent_failures: WHITELIST estrita. Só escalares operacionais passam;
 * telefone, nome, mensagem, conteúdo, prompt e snapshot NUNCA passam —
 * independente de onde o caller copiou o objeto.
 *
 * Defesa em profundidade: o resultado ainda atravessa sanitizePayload (lib)
 * antes de persistir — se um valor string contiver Bearer/JWT/DSN, é redigido.
 *
 * Este módulo é o ÚNICO caminho de escrita do campo `payload` da tabela.
 */
import { sanitizePayload } from '@/lib/sanitize/redact';

export interface AiFailurePayloadInput {
  toolName?: string | undefined;
  zodIssuePaths?: string[] | undefined;
  errorCode?: string | undefined;
  model?: string | undefined;
  httpStatus?: number | undefined;
  stage?: string | undefined;
}

const MAX_STR = 200;
const MAX_PATHS = 10;

function safeStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_STR) : undefined;
}

export function sanitizeAiFailurePayload(raw: AiFailurePayloadInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const toolName = safeStr(raw.toolName);
  if (toolName) out.toolName = toolName;
  if (Array.isArray(raw.zodIssuePaths)) {
    const paths = raw.zodIssuePaths
      .filter((p): p is string => typeof p === 'string')
      .slice(0, MAX_PATHS)
      .map((p) => p.slice(0, MAX_STR));
    if (paths.length > 0) out.zodIssuePaths = paths;
  }
  const errorCode = safeStr(raw.errorCode);
  if (errorCode) out.errorCode = errorCode;
  const model = safeStr(raw.model);
  if (model) out.model = model;
  if (typeof raw.httpStatus === 'number' && Number.isFinite(raw.httpStatus)) {
    out.httpStatus = raw.httpStatus;
  }
  const stage = safeStr(raw.stage);
  if (stage) out.stage = stage;

  // 2ª camada: redação de padrões sensíveis em valores string (lib).
  return sanitizePayload(out) as Record<string, unknown>;
}
