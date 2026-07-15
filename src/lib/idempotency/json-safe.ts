/**
 * Guard against non-JSON-safe values in payloads that will be hashed (for
 * idempotency keys) or persisted as jsonb (outbox.payload, audit_events).
 *
 * JSON.stringify silently mangles many values:
 *   - `undefined` → omitted from objects, becomes `null` in arrays.
 *   - `Date` → serialized to ISO string (but TYPE info lost; round-trip mismatch).
 *   - `BigInt` → throws TypeError at runtime (poison pill).
 *   - `NaN`, `Infinity` → become `null`.
 *   - Functions / Symbols → omitted from objects, become `null` in arrays.
 *
 * Any of these means hashes are unstable (canonical form mutates over normal
 * use) and audit/outbox payloads carry implicit data loss. We reject at the
 * boundary instead: callers MUST shape payloads with JSON-safe types only
 * (strings instead of Dates, plain numbers, no BigInt).
 */
export class JsonUnsafeError extends Error {
  constructor(path: string, reason: string) {
    super(`[json-safe] ${path}: ${reason}`);
    this.name = 'JsonUnsafeError';
  }
}

/**
 * Normaliza um payload para ser JSON-safe na idempotência: remove chaves
 * `undefined` (que o Zod mantém para campos opcionais em branco).
 * Determinístico: mesmo input lógico → mesmo hash.
 *
 * COMPLEMENTAR a assertJsonSafe (mesmo módulo — mesmo domínio, serialização
 * para idempotência), NÃO substituta. São papéis distintos e ambos são usados:
 *   - assertJsonSafe: VALIDA e LANÇA (rejeita undefined/Date/BigInt/NaN/…).
 *   - jsonSafe:       NORMALIZA (stripper de `undefined`). Não valida.
 * Não remover uma "porque parece redundante": elas se apoiam mutuamente.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new JsonUnsafeError(path, 'NaN/Infinity not JSON-safe');
    }
    return;
  }
  if (t === 'bigint') throw new JsonUnsafeError(path, 'BigInt not JSON-safe');
  if (t === 'undefined') {
    throw new JsonUnsafeError(path, 'undefined not JSON-safe (use null)');
  }
  if (t === 'function' || t === 'symbol') {
    throw new JsonUnsafeError(path, `${t} not JSON-safe`);
  }
  if (value instanceof Date) {
    throw new JsonUnsafeError(path, 'Date not JSON-safe (use ISO string)');
  }
  // Map, Set, Buffer, custom classes, etc. — anything that isn't a plain
  // object or array — are rejected. Stable canonicalization requires a
  // known shape; we keep that shape narrow.
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new JsonUnsafeError(path, 'non-plain object not JSON-safe');
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertJsonSafe(v, `${path}.${k}`);
  }
}
