/** Export/verify local. No uploads, environment loading or plaintext file output. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  openRecoveryPackage,
  sealRecoveryPackage,
  type RecoveryEntry,
} from '../src/lib/backup/recovery-package';

async function main(): Promise<void> {
  const mode = process.argv[2],
    filename = process.env.RECOVERY_PACKAGE_FILE,
    password = process.env.RECOVERY_EXPORT_PASSPHRASE;
  if (!filename || !password || !['seal', 'verify'].includes(mode ?? ''))
    throw new Error('Missing recovery package configuration');
  const target = resolve(filename);
  if (
    target.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase() + sep) ||
    !target.endsWith('.qororec')
  ) {
    throw new Error('Recovery package must stay outside the repository with .qororec extension');
  }
  if (filename.startsWith('\\\\') || filename.startsWith('//'))
    throw new Error('Only an approved local directory is allowed');
  const parent = await lstat(dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error('Recovery parent must exist and not be a link');
  let bundle: Buffer;
  if (mode === 'seal') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 128 * 1024 * 1024) throw new Error('Recovery input too large');
      chunks.push(bytes);
    }
    const input: unknown = JSON.parse(
      Buffer.concat(chunks)
        .toString('utf8')
        .replace(/^\uFEFF/u, ''),
    );
    if (!Array.isArray(input)) throw new Error('Invalid recovery input');
    const entries: RecoveryEntry[] = input.map((entry: unknown) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('id' in entry) ||
        typeof entry.id !== 'string' ||
        !('base64' in entry) ||
        typeof entry.base64 !== 'string'
      )
        throw new Error('Invalid recovery input entry');
      return { id: entry.id, data: Buffer.from(entry.base64, 'base64') };
    });
    bundle = sealRecoveryPackage(entries, password);
    openRecoveryPackage(bundle, password);
    await writeFile(target, bundle, { flag: 'wx', mode: 0o600 });
  } else {
    bundle = await readFile(target);
  }
  const entries = openRecoveryPackage(bundle, password);
  process.stdout.write(
    JSON.stringify({
      result: 'PASS',
      mode,
      entries: entries.length,
      bytes: bundle.length,
      sha256: createHash('sha256').update(bundle).digest('hex'),
    }) + '\n',
  );
}
main().catch(() => {
  process.stderr.write('FAIL recovery package; sensitive detail suppressed\n');
  process.exitCode = 1;
});
