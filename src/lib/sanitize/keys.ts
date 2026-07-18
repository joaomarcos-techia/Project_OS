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
  // C10/C11 (ADR-020/022): conteúdo de mensagem + telefone de resposta + prompt
  // snapshot. Mesma lógica de defense in depth — rows cruas jamais devem vazar
  // para metrics/audit com esses campos legíveis.
  'content_encrypted',
  'contentencrypted',
  'from_number_encrypted',
  'fromnumberencrypted',
  'patient_phone_encrypted',
  'patientphoneencrypted',
  'patient_phone_hash',
  'patientphonehash',
  'prompt_snapshot_encrypted',
  'promptsnapshotencrypted',
  // A1 / ADR-044 — CONTEÚDO CLÍNICO EM CLARO. Esta lista tinha
  // `content_encrypted` mas não o `content` puro, e foi por isso que a
  // auditoria de banco mediu 32 audit_events guardando o SOAP legível: o valor
  // decifrado (ou nunca cifrado) não casa com nenhum regex de credencial.
  //
  // A defesa primária é o seam `project` do idempotentMutation (redige antes do
  // disco). Isto é a rede embaixo, para o caminho novo que ninguém previu.
  // Deliberadamente NÃO inclui `descricao` (campo de negócio benigno em
  // financeiro) — redigir demais cega o diagnóstico operacional.
  'content',
  'nota',
  'notas',
  'soap',
  'subjetivo',
  'objetivo',
  'avaliacao',
  'conduta',
  'observacoes',
  'medicamentos',
  'diagnostico',
  'alergias',
]);
