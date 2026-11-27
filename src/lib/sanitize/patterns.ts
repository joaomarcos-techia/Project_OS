/**
 * Value-level redaction patterns. Applied to every string traversed by
 * `sanitizePayload()` — catches secrets that the key-based redaction misses
 * (e.g. headers map: { 'x-custom': 'Bearer eyJ...' } where the KEY is not in
 * SENSITIVE_KEYS but the VALUE carries a credential).
 *
 * Patterns are intentionally conservative — false negatives are preferred
 * over false positives in forensic data. Expand carefully in C16+.
 */
type Replacement = string | ((match: string, ...groups: string[]) => string);
type Pattern = { re: RegExp; replacement: Replacement };

export const VALUE_PATTERNS: ReadonlyArray<Pattern> = [
  // JWT: header.payload.signature, base64url-ish chunks de tamanho não-trivial.
  // MEDIUM-18: word boundary anterior evita match em "FooeyJabc..." (parte de
  // string benigna).
  {
    re: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
    replacement: '[REDACTED_JWT]',
  },
  // "Bearer <token>" — case-insensitive, com word boundary.
  {
    re: /\bBearer\s+[A-Za-z0-9_\-\.]{16,}/gi,
    replacement: 'Bearer [REDACTED]',
  },
  // Stripe-style secret keys (sk_live_..., sk_test_...). Word boundary anterior.
  {
    re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,
    replacement: '[REDACTED_SK]',
  },
  // Postgres/MySQL DSN with embedded password.
  {
    re: /\b(?:postgres(?:ql)?|mysql):\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
    replacement: '[REDACTED_DSN]',
  },
  // Query-string credential leak: "?password=...&token=...&token_hash=..."
  {
    re: /\b(password|secret|webhookSecret|token|token_hash|invite|inviteToken|invite_token|api_key|apikey)=([^&\s"]+)/gi,
    replacement: (m: string, _key: string, value: string) => m.replace(value, '[REDACTED]'),
  },
];

export function redactStringValue(s: string): string {
  let out = s;
  for (const { re, replacement } of VALUE_PATTERNS) {
    // String.prototype.replace accepts both string and function replacers.
    out = out.replace(re, replacement as never);
  }
  return out;
}
