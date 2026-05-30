/**
 * Sensitive object keys — value at these keys is replaced with `[REDACTED]`
 * during sanitization, regardless of content. Case-insensitive match (lookup
 * is done after `.toLowerCase()`).
 *
 * Rule of thumb for additions: anything that, if leaked into structured logs
 * or audit_events, would constitute a credential / PII / forensic risk on its
 * own. Adjacent benign data (e.g. user IDs, action labels) is fine to leave.
 *
 * Expanding this list is one of the few changes that only requires touching
 * THIS file — no migration, no schema, no API surface.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'session_id',
  'sessionid',
  'session_token',
  'sessiontoken',
  'cookie',
  'jwt',
  'pepper',
  'private_key',
  'privatekey',
  'client_secret',
  'clientsecret',
  'mfa_secret',
  'totp_secret',
  'recovery_codes',
  // C5 (ADR-012): patient PII. Actions already build audit before/after from a
  // non-sensitive projection, so these never reach the audit path — this is
  // defense in depth in case raw rows are ever passed to logAudit/metrics.
  'cpf',
  'cpf_encrypted',
  'cpfencrypted',
  'cpf_hash',
  'cpfhash',
  'telefone_encrypted',
  'telefoneencrypted',
  'telefone_hash',
  'telefonehash',
  'logradouro_encrypted',
  'logradouroencrypted',
  'cep_encrypted',
  'cepencrypted',
]);
