// Ledger de migrations no DEV (SOMENTE LEITURA): casa cada linha de
// drizzle.__drizzle_migrations com o SHA-256 dos arquivos de main, #53 e #55.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('C:/dev/Qoro_convenios_tiss_20261110/package.json');
const postgres = require('postgres');
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('pqhkirrszzpwezdaqrai') || url.includes('shlcbxawrxuaebazuiue')) throw new Error('não é o DEV');

const repo = 'C:/dev/Qoro_convenios_tiss_20261110';
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const refs = { main: 'origin/main', pr53: 'origin/feat/billing-abacatepay-20261107', pr55: 'HEAD' };
const files = new Map(); // hash -> {tag, refs[], when}
for (const [name, ref] of Object.entries(refs)) {
  const journal = JSON.parse(git('show', `${ref}:drizzle/migrations/meta/_journal.json`));
  for (const e of journal.entries) {
    const sqlText = git('show', `${ref}:drizzle/migrations/${e.tag}.sql`);
    const hash = createHash('sha256').update(sqlText).digest('hex');
    const cur = files.get(hash) ?? { tag: e.tag, when: e.when, refs: [] };
    cur.refs.push(name);
    files.set(hash, cur);
  }
}

const sql = postgres(url, { connect_timeout: 45, max: 1, prepare: false, idle_timeout: 5 });
try {
  const out = await sql.begin('read only', async (tx) => {
    const [{ n }] = await tx`select count(*)::int as n from drizzle.__drizzle_migrations`;
    const rows = await tx`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 14`;
    return { n, rows };
  });
  console.log('DEV __drizzle_migrations rows:', out.n);
  for (const r of out.rows.reverse()) {
    const f = files.get(r.hash);
    const whenOk = f ? String(f.when) === String(r.created_at) : null;
    console.log(
      `id=${r.id} created_at=${r.created_at} ${new Date(Number(r.created_at)).toISOString()} hash=${r.hash.slice(0, 12)} ->`,
      f ? `${f.tag} [${f.refs.join(',')}] when_matches_journal=${whenOk}` : 'SEM ARQUIVO CORRESPONDENTE',
    );
  }
  const applied = new Set((await sql`select hash from drizzle.__drizzle_migrations`).map((r) => r.hash));
  const notApplied = [...files.entries()].filter(([h]) => !applied.has(h)).map(([, f]) => `${f.tag} [${f.refs.join(',')}]`);
  console.log('Arquivos sem linha no DEV:', notApplied.length ? notApplied.join('; ') : 'nenhum');
} finally {
  await sql.end();
}
