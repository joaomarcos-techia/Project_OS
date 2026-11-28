/**
 * S5 / P12.10 — ferramenta do OPERADOR para a ancoragem das trilhas (`src/lib/db/audit-anchor.ts`). Só leitura:
 * roda numa transação READ ONLY, sem SET de sessão (serve também pelo pooler em modo transação), e não grava nada.
 *
 * Calcular (imprime uma linha JSON por dia; guarde a saída FORA do banco — e-mail, Drive, cofre — o destino é decisão
 * do titular, ver `s5-contrato-trilha-59.md`):
 *   ANCHOR_DATABASE_URL=... npx tsx scripts/security/audit-anchor.ts compute --trail clinic_audit --from 2026-11-01 --to 2026-11-27 [--prev <hex>]
 *
 * Conferir um arquivo guardado antes (sai com código 1 se algo mudou; imprime o que mudou):
 *   ANCHOR_DATABASE_URL=... npx tsx scripts/security/audit-anchor.ts verify --trail clinic_audit --file ancoras.jsonl
 *
 * A URL vem de `ANCHOR_DATABASE_URL` (de propósito diferente de `DATABASE_URL`, para não herdar o ambiente do app) e
 * nunca é impressa.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

import {
  ANCHOR_TRAILS,
  computeAnchors,
  verifyAnchors,
  type AnchorQuery,
  type DayAnchor,
} from '../../src/lib/db/audit-anchor';

const [, , mode, ...rest] = process.argv;
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const spec = ANCHOR_TRAILS.find((t) => t.id === arg('trail'));
const url = process.env.ANCHOR_DATABASE_URL;
if (!spec || !url || (mode !== 'compute' && mode !== 'verify')) {
  console.error(
    'uso: audit-anchor.ts compute|verify --trail clinic_audit|platform_audit (--from D --to D [--prev H] | --file F); URL em ANCHOR_DATABASE_URL',
  );
  process.exit(2);
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
  connect_timeout: 45,
  idle_timeout: 5,
  onnotice: () => undefined,
});
try {
  const code = await sql.begin('read only', async (tx) => {
    const query: AnchorQuery = async (text, params) =>
      (await tx.unsafe(text, params as never[])) as unknown as Array<Record<string, unknown>>;
    if (mode === 'compute') {
      const from = arg('from');
      const to = arg('to');
      if (!from || !to) throw new Error('compute exige --from e --to');
      const prev = arg('prev');
      for (const a of await computeAnchors(query, spec, from, to, ...(prev ? [prev] : [])))
        console.log(JSON.stringify(a));
      return 0;
    }
    const file = arg('file');
    if (!file) throw new Error('verify exige --file');
    const stored = readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as DayAnchor);
    const findings = await verifyAnchors(query, spec, stored);
    for (const f of findings) console.log(JSON.stringify(f));
    console.error(
      findings.length === 0
        ? `íntegro: ${stored.length} dia(s) conferido(s)`
        : `ATENÇÃO: ${findings.length} achado(s) em ${stored.length} dia(s)`,
    );
    return findings.length === 0 ? 0 : 1;
  });
  process.exitCode = code;
} finally {
  await sql.end({ timeout: 5 });
}
