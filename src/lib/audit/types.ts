/**
 * Request context captured at the boundary (Server Action / route handler) and
 * threaded down to logAudit / superAdminAction. None of the fields are PII on
 * their own; sanitizePayload still runs over the rest of the audit row.
 */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  /**
   * M20 — distributed-tracing correlation id. Optional/additive: when present
   * (propagated via `x-correlation-id`) logAudit persists it so an operation is
   * traceable across contexts. Falls back to `requestId` when absent.
   */
  correlationId?: string | null;
}
