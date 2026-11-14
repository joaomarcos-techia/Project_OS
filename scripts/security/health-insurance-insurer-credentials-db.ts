/**
 * P2.5 — credenciais da clínica na operadora, em Postgres DESCARTÁVEL com as migrations reais.
 * Sintético: nenhuma credencial real, nenhuma operadora real, nenhum envio.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-insurer-credentials-db.ts
 */
import assert from 'node:assert/strict';

import { startScratchSchema } from './scratch-schema';

const PORT = 55535;
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

const { withTenant } = await import('../../src/lib/db/tenant');
const { decryptForTenant } = await import('../../src/lib/crypto/encryption');
const cred = await import('../../src/contexts/health-insurance/internal/insurer-credentials');
const { loadHiFixtures } = await import('./hi-fixtures');
const fx = await loadHiFixtures(sql, {
  store: { put: async () => {}, get: async () => new Uint8Array(), remove: async () => {} },
  validateXsd: null as never,
});
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const SECRET = 'senha-sintetica-123';
const SECRET2 = 'senha-sintetica-456';

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  const A = await fx.setupClinic('Credenciais A');
  const B = await fx.setupClinic('Credenciais B');
  const as = <T>(c: typeof A, fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant(c.clinicId, fn, c.doctorId);

  // 1. Cifrada em repouso; decifra só com a chave da clínica.
  const s1 = await as(A, (tx) =>
    cred.saveInsurerCredentialTx(tx, {
      clinicId: A.clinicId,
      userId: A.doctorId,
      insurerId: A.insurerId,
      kind: 'webservice_login',
      username: 'prestador01',
      secret: SECRET,
    }),
  );
  const [row] =
    await sql`select secret_encrypted, username_encrypted from public.hi_insurer_credentials where id = ${s1.credentialId}::uuid`;
  const dump = JSON.stringify(await sql`select * from public.hi_insurer_credentials`);
  assert.ok(
    !dump.includes(SECRET) && !dump.includes('prestador01'),
    'o texto em claro não está no banco',
  );
  assert.equal(await decryptForTenant(A.clinicId, row!.secret_encrypted as string), SECRET);
  await assert.rejects(() => decryptForTenant(B.clinicId, row!.secret_encrypted as string));
  assert.equal(s1.rotated, false);
  pass(
    'guardada cifrada por clínica: o texto em claro (usuário e senha) não aparece no banco; só a chave da clínica A decifra',
  );

  // 2. Rotação: a anterior vira revogada, nada é apagado, uma ativa só.
  const s2 = await as(A, (tx) =>
    cred.saveInsurerCredentialTx(tx, {
      clinicId: A.clinicId,
      userId: A.doctorId,
      insurerId: A.insurerId,
      kind: 'webservice_login',
      username: 'prestador01',
      secret: SECRET2,
    }),
  );
  const all =
    await sql`select id, status, rotated_at is not null as rotated from public.hi_insurer_credentials where clinic_id = ${A.clinicId}::uuid order by created_at`;
  assert.deepEqual(
    [s2.rotated, all.map((r) => r.status), all[0]!.rotated],
    [true, ['revoked', 'active'], true],
  );
  pass(
    'salvar de novo é rotação: a anterior fica "revogada" com a data, uma única ativa, histórico preservado',
  );

  // 3. A leitura da tela nunca devolve segredo, usuário ou texto cifrado.
  const view = await as(A, (tx) => cred.listInsurerCredentialsTx(tx, A.clinicId, A.insurerId));
  const text = JSON.stringify(view);
  assert.ok(
    !text.includes(SECRET2) &&
      !text.includes('prestador01') &&
      !text.includes(String(row!.secret_encrypted).slice(0, 12)),
  );
  assert.deepEqual(Object.keys(view[0]!).sort(), [
    'createdAt',
    'hasUsername',
    'id',
    'kind',
    'lastUsedAt',
    'rotatedAt',
    'status',
  ]);
  pass(
    'a leitura para a tela traz só tipo, situação e datas: nem segredo, nem usuário, nem texto cifrado',
  );

  // 4. Outra clínica não vê nem revoga; operadora alheia ou arquivada é recusada.
  assert.equal(
    (await as(B, (tx) => cred.listInsurerCredentialsTx(tx, B.clinicId, A.insurerId))).length,
    0,
  );
  await assert.rejects(
    () =>
      as(B, (tx) =>
        cred.revokeInsurerCredentialTx(tx, {
          clinicId: B.clinicId,
          insurerId: A.insurerId,
          credentialId: s2.credentialId,
        }),
      ),
    /não encontrada/u,
  );
  await assert.rejects(
    () =>
      as(B, (tx) =>
        cred.saveInsurerCredentialTx(tx, {
          clinicId: B.clinicId,
          userId: B.doctorId,
          insurerId: A.insurerId,
          kind: 'certificate',
          username: null,
          secret: SECRET,
        }),
      ),
    /não encontrada nesta clínica/u,
  );
  await sql`update public.hi_insurers set status = 'archived' where id = ${B.insurerId}::uuid`;
  await assert.rejects(
    () =>
      as(B, (tx) =>
        cred.saveInsurerCredentialTx(tx, {
          clinicId: B.clinicId,
          userId: B.doctorId,
          insurerId: B.insurerId,
          kind: 'certificate',
          username: null,
          secret: SECRET,
        }),
      ),
    /arquivada/u,
  );
  pass(
    'outra clínica não lista nem revoga a credencial da A (RLS) e não guarda credencial em operadora alheia; operadora arquivada é recusada',
  );

  // 5. Revogar; validações de entrada.
  await as(A, (tx) =>
    cred.revokeInsurerCredentialTx(tx, {
      clinicId: A.clinicId,
      insurerId: A.insurerId,
      credentialId: s2.credentialId,
    }),
  );
  const [act] =
    await sql`select count(*)::int as n from public.hi_insurer_credentials where clinic_id = ${A.clinicId}::uuid and status = 'active'`;
  assert.equal(act!.n, 0);
  await assert.rejects(
    () =>
      as(A, (tx) =>
        cred.saveInsurerCredentialTx(tx, {
          clinicId: A.clinicId,
          userId: A.doctorId,
          insurerId: A.insurerId,
          kind: 'webservice_login',
          username: null,
          secret: SECRET,
        }),
      ),
    /usuário do webservice/u,
  );
  await assert.rejects(
    () =>
      as(A, (tx) =>
        cred.saveInsurerCredentialTx(tx, {
          clinicId: A.clinicId,
          userId: A.doctorId,
          insurerId: A.insurerId,
          kind: 'certificate',
          username: null,
          secret: 'curta',
        }),
      ),
    /8 a 16\.384/u,
  );
  pass(
    'revogar deixa a operadora sem credencial ativa (nada apagado); login sem usuário e segredo curto são recusados',
  );

  console.log(`\n${passed}/5 provas das credenciais por operadora (P2.5) passaram.`);
} finally {
  await cluster.stop();
}
process.exit(0);
