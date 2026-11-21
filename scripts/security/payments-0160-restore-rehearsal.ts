/**
 * Ensaio da 0160 (R54) sobre os DADOS REAIS do DEV, num Postgres DESCARTÁVEL, e prova de que o
 * backup restaura. Nada é escrito no DEV.
 *
 *   1. cadeia do DEV até a 0159 (a 0159 do #53 com os bytes aplicados) no descartável;
 *   2. restaura o dump de dados (patient_charges, patient_credit_adjustments, payment_transactions)
 *      tirado do DEV antes da janela; contagens e md5 iguais aos do pré-voo do DEV;
 *   3. aplica a 0160 numa transação (como o migrador) e confere: objetos criados, dados intocados,
 *      segunda execução idempotente (IF NOT EXISTS), reversão documentada desfaz.
 *
 *   BACKUP_DIR=<pasta do backup-0160> PRE_FLIGHT=<pre-0160.json> \
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/payments-0160-restore-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = 55534;
const BACKUP = process.env.BACKUP_DIR;
const PRE = process.env.PRE_FLIGHT;
if (!BACKUP || !PRE) throw new Error('BACKUP_DIR e PRE_FLIGHT são obrigatórios');
const pre = JSON.parse(readFileSync(PRE, 'utf8')) as {
  raw: { pc: { n: number; digest: string }; adj: number; pt: { n: number; digest: string } };
};

const chain = (await readDevOrderChain()).filter((m) => !m.file.startsWith('0160_'));
assert.equal(chain.at(-1)!.file, '0159_saas_period_snapshot.sql');
const cluster = await startScratchSchema({ port: PORT, maxConnections: 4, migrations: chain });
const { sql } = cluster;
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const digest = async () => {
  const [pc] = await sql`select count(*)::int n,
      md5(coalesce(string_agg(id::text || status::text || amount::text || coalesce(provider_payment_id,'') || coalesce(extract(epoch from paid_at)::text,''), ',' order by id), '')) as digest
      from public.patient_charges`;
  const [adj] = await sql`select count(*)::int n from public.patient_credit_adjustments`;
  const [pt] = await sql`select count(*)::int n, md5(coalesce(string_agg(id::text || kind::text || amount::text, ',' order by id), '')) digest from public.payment_transactions`;
  return { pc: pc!, adj: adj!.n as number, pt: pt! };
};
const m0160 = readFileSync(path.resolve('drizzle/migrations/0160_patient_external_refunds.sql'), 'utf8');
const statements = m0160
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.replace(/^\s*--.*$/gmu, '').trim().length > 0);

try {
  // 1+2. Restauração do dump de dados do DEV.
  const psql = 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
  execFileSync(psql, [cluster.url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(BACKUP, 'data-0160-tables.sql')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  const restored = await digest();
  assert.deepEqual(
    [restored.pc.n, restored.pc.digest, restored.adj, restored.pt.n, restored.pt.digest],
    [pre.raw.pc.n, pre.raw.pc.digest, pre.raw.adj, pre.raw.pt.n, pre.raw.pt.digest],
  );
  const ledger = readFileSync(path.join(BACKUP, 'data-drizzle-ledger.sql'), 'utf8');
  const copy = ledger.slice(ledger.indexOf('COPY drizzle.__drizzle_migrations'));
  const ledgerRows = copy.slice(copy.indexOf('\n') + 1, copy.indexOf('\n\\.')).split('\n').filter(Boolean);
  assert.equal(ledgerRows.length, 160);
  pass(`o backup restaura: ${restored.pc.n} cobranças, ${restored.pt.n} transações e ${restored.adj} ajustes com o MESMO md5 do pré-voo do DEV; o ledger salvo tem as 160 linhas`);

  // 3. A 0160 sobre esses dados, numa transação (como o migrador).
  await sql.begin(async (tx) => {
    for (const st of statements) await tx.unsafe(st);
  });
  const after = await digest();
  const [obj] = await sql`select to_regclass('public.patient_external_refunds') is not null t,
      exists (select 1 from information_schema.columns where table_name='patient_charges' and column_name='refund_checked_at') c,
      exists (select 1 from pg_enum e join pg_type ty on ty.oid=e.enumtypid where ty.typname='patient_credit_adjustment_kind' and e.enumlabel='external_refund') e,
      (select count(*)::int from public.patient_charges where refund_checked_at is not null) touched`;
  assert.deepEqual([obj!.t, obj!.c, obj!.e, obj!.touched], [true, true, true, 0]);
  assert.deepEqual([after.pc.digest, after.pt.digest, after.adj], [restored.pc.digest, restored.pt.digest, restored.adj]);
  pass(`a 0160 aplica numa transação sobre os dados reais (${statements.length} comandos): tabela, coluna e enum criados; cobranças, transações e ajustes intocados; nenhuma cobrança marcada como lida`);

  await sql.begin(async (tx) => {
    for (const st of statements.filter((s) => !/^CREATE POLICY|^ALTER TABLE public\.patient_external_refunds (ENABLE|FORCE)/mu.test(s)))
      await tx.unsafe(st);
  });
  pass('segunda execução dos comandos idempotentes (IF NOT EXISTS / ON CONFLICT) não falha nem duplica');

  // Reversão documentada no cabeçalho da migration.
  await sql.begin(async (tx) => {
    await tx`DROP TABLE public.patient_external_refunds`;
    await tx`DROP INDEX public.patient_charges_refund_check_idx`;
    await tx`ALTER TABLE public.patient_charges DROP COLUMN refund_checked_at`;
    await tx`DELETE FROM public._schema_version WHERE version = '0160-patient-external-refunds'`;
  });
  const reverted = await digest();
  assert.equal(reverted.pc.digest, restored.pc.digest);
  pass('a reversão documentada desfaz a tabela, o índice e a coluna sem tocar os dados (o valor do enum fica, inofensivo)');

  console.log(`\n${passed}/4 provas do ensaio da 0160 passaram (descartável, dados do backup do DEV).`);
} finally {
  await cluster.stop();
}
process.exit(0);
