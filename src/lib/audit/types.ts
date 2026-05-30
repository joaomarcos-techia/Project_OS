/**
 * Request context captured at the boundary (Server Action / route handler) and
 * threaded down to logAudit / superAdminAction. None of the fields are PII on
 * their own; sanitizePayload still runs over the rest of the audit row.
 */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}
