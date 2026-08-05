/**
 * `pnpm audit:partitions [--retain <meses>]` — manutenção das partições mensais
 * de `audit_events` (gap 4.6 / retenção; ADR-011 dizia "manual no MVP").
 *
 * PROVISION (sempre): cria as partições do mês atual + próximos N meses
 * (AUDIT_MONTHS_AHEAD, default 6) se ausentes — idempotente (CREATE IF NOT
 * EXISTS por nome, padrão `audit_events_YYYY_MM` de 0009). Evita que linhas caiam
 * na `audit_events_default` (que perde partition pruning e incha). Rode
 * mensalmente (cron `/api/cron/audit-partitions` OU operador) ANTES das partições
 * estáticas (até 2027-04) acabarem.
 *
 * RETENÇÃO (opt-in, `--retain N`): DESANEXA (DETACH, NÃO dropa) as partições cujo
 * mês inteiro é mais antigo que N meses. DETACH preserva os dados (vira tabela
 * standalone, fora do parent) — o operador então arquiva (pg_dump) e dropa via
 * migration APROVADA (`-- migration:destructive-approved`). NUNCA auto-dropa
 * audit (dado forense/legal).
 *
 * Alvo = `DATABASE_URL` (role com DDL — mesmo das migrations). Rode com as
 * credenciais do ambiente certo.
 */
import { redact } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

const PARENT = 'audit_events';
const MONTHS_AHEAD = Number(process.env.AUDIT_MONTHS_AHEAD ?? 6);
const retainIdx = process.argv.indexOf('--retain');
const RETAIN_MONTHS = retainIdx >= 0 ? Number(process.argv[retainIdx + 1] ?? 0) : 0;

const pad2 = (n: number) => String(n).padStart(2, '0');
const partName = (y: number, m1: number) => `${PARENT}_${y}_${pad2(m1)}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

console.log(`[audit:partitions] alvo: ${redact(env.DATABASE_URL)}`);

// --- PROVISION -------------------------------------------------------------
const now = new Date();
let ensured = 0;
const warnings: string[] = [];
for (let i = 0; i <= MONTHS_AHEAD; i++) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
  const name = partName(start.getUTCFullYear(), start.getUTCMonth() + 1);
  // Identificadores/datas derivados de aritmética de Date (sem input externo) →
  // sem risco de injeção. sql.raw é necessário p/ DDL com nome dinâmico.
  try {
    await dbAdmin.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${PARENT}" ` +
          `FOR VALUES FROM ('${iso(start)}') TO ('${iso(end)}')`,
      ),
    );
    ensured++;
  } catch (e) {
    // 23514: a partição falta E a `default` já tem linhas nesse mês → o Postgres
    // não move sozinho. Remediação manual (ver runbook). NÃO fatal: meses futuros
    // (sem linha na default) continuam sendo criados normalmente.
    if ((e as { code?: string })?.code === '23514') {
      warnings.push(
        `${name}: a 'default' já tem linhas deste mês — remediação manual (runbooks/audit-retention.md)`,
      );
    } else {
      throw e;
    }
  }
}
console.log(
  `[audit:partitions] provision: ${ensured}/${MONTHS_AHEAD + 1} partição(ões) garantida(s) (mês atual + ${MONTHS_AHEAD}).`,
);
for (const w of warnings) console.warn(`[audit:partitions] AVISO ${w}`);

// --- RETENÇÃO (opt-in) -----------------------------------------------------
if (RETAIN_MONTHS > 0) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETAIN_MONTHS + 1, 1));
  const children = (await dbAdmin.execute(sql`
    SELECT child.relname AS name
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
     WHERE parent.relname = ${PARENT}
  `)) as unknown as Array<{ name: string }>;

  const detached: string[] = [];
  for (const { name } of children) {
    const m = /^audit_events_(\d{4})_(\d{2})$/.exec(name);
    if (!m) continue; // pula a default e nomes fora do padrão
    const upper = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)); // 1º dia do mês seguinte
    if (upper <= cutoff) {
      await dbAdmin.execute(sql.raw(`ALTER TABLE "${PARENT}" DETACH PARTITION "${name}"`));
      detached.push(name);
    }
  }
  if (detached.length === 0) {
    console.log(`[audit:partitions] retenção: nenhuma partição anterior a ${RETAIN_MONTHS} meses.`);
  } else {
    console.log(
      `[audit:partitions] retenção: ${detached.length} partição(ões) DESANEXADA(s) (dados preservados):`,
    );
    for (const n of detached)
      console.log(`  - ${n}  → arquive (pg_dump) e dropie via migration aprovada`);
  }
}

process.exit(0);
