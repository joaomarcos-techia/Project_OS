/** Inspeciona apenas artefatos entregues ao navegador; nunca imprime credenciais. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const build = path.resolve(process.argv[2] ?? 'dist/security-local/app/.next');
const failures: { file: string; rule: string }[] = [];
let count = 0;
async function walk(dir: string, htmlOnly = false): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, htmlOnly);
    else if (htmlOnly ? /\.html$/.test(entry.name) : /\.(js|json|html|map)$/.test(entry.name)) {
      count += 1;
      const content = await readFile(file, 'utf8');
      for (const [rule, pattern] of [
        ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ['server-secret-canary', /security_bundle_canary_(?:supabase|gemini|asaas)_secret/],
        ['vercel-live-script', /https?:\/\/vercel\.live\/_next-live\//],
        ['supabase-secret-key', /sb_secret_[A-Za-z0-9_-]{20,}/],
      ] as const) {
        if (pattern.test(content)) failures.push({ file: path.relative(build, file), rule });
      }
    }
  }
}
await walk(path.join(build, 'static'));
await walk(path.join(build, 'server/app'), true);
console.log(JSON.stringify({ scannedClientFiles: count, failures }, null, 2));
if (failures.length) process.exitCode = 1;
