/** Fase 2 até existir sessão Supabase Auth local. Nunca imprime cookies/respostas. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const cookieFile = process.argv[2];
assert.ok(
  cookieFile,
  'Uso: pnpm exec tsx scripts/security/authenticated-csrf.ts <cookie-file-local> [baseURL]',
);
const base = new URL(process.argv[3] ?? 'http://localhost:3217');
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'Somente localhost autorizado',
);
assert.equal(base.username + base.password + base.search + base.hash, '');
const cookie = (await readFile(cookieFile, 'utf8')).trim();
assert.ok(cookie.length > 0 && !/[\r\n]/.test(cookie), 'Cookie local vazio/inválido');
const manifest = z
  .object({ node: z.record(z.string(), z.object({ exportedName: z.string().optional() })) })
  .parse(
    JSON.parse(
      await readFile(
        path.resolve('dist/security-local/app/.next/server/server-reference-manifest.json'),
        'utf8',
      ),
    ),
  );
const action = Object.entries(manifest.node).find(
  ([, item]) => item.exportedName === 'buscarPacientes',
);
assert.ok(action, 'Ação de leitura buscarPacientes ausente');
async function invoke(origin: string) {
  return fetch(new URL('/agenda', base), {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Next-Action': action![0],
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: '[""]',
  });
}
// buscarPacientes exige requireUser + VIEW_PATIENT ANTES de retornar [] para termo vazio.
// Assim, o controle positivo prova que esta sessão foi aceita sem ler pacientes reais.
for (const phase of ['antes', 'depois']) {
  const valid = await invoke(base.origin);
  assert.equal(valid.status, 200, `controle autenticado ${phase}`);
  assert.match(await valid.text(), /\n1:\[\]/, 'Sessão não comprovada; recusa não conta como PASS');
  if (phase === 'antes') {
    const rejected = await invoke('https://evil.test');
    assert.equal(rejected.status, 500, 'Next 15 deve rejeitar origem antes de executar ação');
    assert.doesNotMatch(await rejected.text(), /\n1:\[\]/);
  }
}
console.log('PASS origem própria com sessão válida antes/depois; origem evil.test rejeitada');
