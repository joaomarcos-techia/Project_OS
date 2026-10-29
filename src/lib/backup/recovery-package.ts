import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('QOROREC1');
const SALT_BYTES = 16,
  IV_BYTES = 12,
  TAG_BYTES = 16;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 4096;
export type RecoveryEntry = { id: string; data: Buffer };
type WireEntry = { id: string; base64: string; sha256: string };
function key(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 24 || /[\r\n]/u.test(passphrase))
    throw new Error('Invalid recovery passphrase');
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{0,127}$/u.test(id);
}

/** Formato portátil versionado; nomes, hashes e conteúdo ficam autenticados e cifrados. */
export function sealRecoveryPackage(entries: readonly RecoveryEntry[], passphrase: string): Buffer {
  if (!entries.length || entries.length > MAX_ENTRIES)
    throw new Error('Invalid recovery entry count');
  const ids = new Set<string>();
  let size = 0;
  const wire = entries.map(({ id, data }): WireEntry => {
    if (!validId(id) || ids.has(id) || !Buffer.isBuffer(data))
      throw new Error('Invalid recovery entry');
    ids.add(id);
    size += data.length;
    if (size > MAX_PACKAGE_BYTES / 2) throw new Error('Recovery package is too large');
    return { id, base64: data.toString('base64'), sha256: digest(data) };
  });
  const salt = randomBytes(SALT_BYTES),
    iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  cipher.setAAD(header);
  const payload = Buffer.from(JSON.stringify({ version: 1, entries: wire }));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

/** Decifra exclusivamente em memória. A senha nunca é incluída nos erros. */
export function openRecoveryPackage(bundle: Buffer, passphrase: string): RecoveryEntry[] {
  const headerSize = MAGIC.length + SALT_BYTES + IV_BYTES;
  if (
    bundle.length <= headerSize + TAG_BYTES ||
    bundle.length > MAX_PACKAGE_BYTES ||
    !bundle.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error('Invalid recovery package');
  let raw: unknown;
  try {
    const salt = bundle.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = bundle.subarray(MAGIC.length + SALT_BYTES, headerSize);
    const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv);
    decipher.setAAD(bundle.subarray(0, headerSize));
    decipher.setAuthTag(bundle.subarray(headerSize, headerSize + TAG_BYTES));
    raw = JSON.parse(
      Buffer.concat([
        decipher.update(bundle.subarray(headerSize + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new Error('Recovery authentication failed');
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('version' in raw) ||
    raw.version !== 1 ||
    !('entries' in raw) ||
    !Array.isArray(raw.entries) ||
    !raw.entries.length ||
    raw.entries.length > MAX_ENTRIES
  )
    throw new Error('Invalid recovery manifest');
  const ids = new Set<string>();
  return raw.entries.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('id' in entry) ||
      !validId(entry.id) ||
      ids.has(entry.id) ||
      !('base64' in entry) ||
      typeof entry.base64 !== 'string' ||
      !('sha256' in entry) ||
      typeof entry.sha256 !== 'string'
    )
      throw new Error('Invalid recovery manifest entry');
    ids.add(entry.id);
    const data = Buffer.from(entry.base64, 'base64');
    if (data.toString('base64') !== entry.base64 || digest(data) !== entry.sha256)
      throw new Error('Recovery integrity failed');
    return { id: entry.id, data };
  });
}
