/**
 * Crypto public surface (C5). The ONLY import path for encryption + lookup
 * hashing. Keeping it centralized makes "where do we decrypt?" auditable
 * (5.7 checklist: a single decryption point).
 */
export {
  getTenantKey,
  encryptForTenant,
  decryptForTenant,
  hashForLookup,
  hashesEqual,
  normalizeCpf,
  normalizePhone,
  normalizeEmail,
  validateCpf,
} from './encryption';
export { getSecretProvider, type SecretProvider } from './secret-provider';
