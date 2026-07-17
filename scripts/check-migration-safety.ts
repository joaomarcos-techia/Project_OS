/**
 * Guard anti-migration destrutiva (gap 1.3).
 *
 * Varre `drizzle/migrations/*.sql` por operações que APAGAM DADOS
 * (DROP TABLE/COLUMN/SCHEMA/DATABASE, TRUNCATE). Um DROP acidental — gerado por
 * `drizzle-kit generate` ao renomear/remover uma coluna no schema, por exemplo —
 * pode destruir dados em produção sem aviso. Este checker é o gate fail-closed.
 *
 * Objetos NÃO-destrutivos de dados (DROP POLICY/TRIGGER/INDEX/FUNCTION/TYPE/
 * CONSTRAINT) são recriáveis e NÃO disparam o gate.
 *
 * Escape hatch (operação destrutiva intencional, ex.: remover coluna deprecada
 * APÓS migração de dados): adicione no arquivo da migration a linha de aprovação
 *     -- migration:destructive-approved <motivo + quem aprovou>
 *
 * Uso:
 *   - CLI:  `pnpm check:migrations`  (CI / pré-merge)
 *   - Import: `assertMigrationsSafe()` é chamado no pré-flight do db:migrate:prod.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle/migrations');
const APPROVAL_MARKER = /migration:destructive-approved/i;

const DESTRUCTIVE: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'DROP TABLE', re: /\bdrop\s+table\b/i },
  { kind: 'DROP COLUMN', re: /\bdrop\s+column\b/i },
  { kind: 'DROP SCHEMA', re: /\bdrop\s+schema\b/i },
  { kind: 'DROP DATABASE', re: /\bdrop\s+database\b/i },
  { kind: 'TRUNCATE', re: /\btruncate\b/i },
];

/**
 * `TRUNCATE` é AMBÍGUO em SQL: é um COMANDO (`TRUNCATE tabela` — apaga dados) e
 * também o nome de um PRIVILÉGIO (`REVOKE ... TRUNCATE ... FROM role` — que é o
 * OPOSTO de apagar: endurece a permissão).
 *
 * Sem distinguir os dois, o gate dá falso positivo justamente nas migrations que
 * ENDURECEM permissões (0040), e a única saída seria marcar o arquivo inteiro com
 * `destructive-approved` — o que silenciaria o gate para um `DROP TABLE` futuro no
 * MESMO arquivo. Um falso positivo que ensina a desligar o alarme é pior do que
 * não ter alarme.
 *
 * Regra: dentro de um statement GRANT/REVOKE, `TRUNCATE` é privilégio, não comando.
 * `DROP *` segue valendo em qualquer contexto (não há privilégio chamado "DROP").
 */
const PRIVILEGE_STATEMENT = /^\s*(grant|revoke)\b/i;
const TRUNCATE_KIND = 'TRUNCATE';

export interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/** Remove a parte de comentário (`-- ...`) para não casar keywords em docs/comentários. */
function stripComment(line: string): string {
  const i = line.indexOf('--');
  return i === -1 ? line : line.slice(0, i);
}

/**
 * Varre UM arquivo SQL. Statement a statement (não linha a linha), porque saber se
 * um `TRUNCATE` é comando ou privilégio exige o começo do statement — que pode
 * estar numa linha anterior (`REVOKE ...\n  ON tabela FROM role;`).
 *
 * Exportada para teste (`src/lib/db/migration-safety.test.ts`).
 */
export function scanSql(file: string, raw: string): Finding[] {
  const findings: Finding[] = [];
  const originalLines = raw.split(/\r?\n/);
  // Tira comentários preservando as quebras de linha, para a contagem não deslizar.
  const code = originalLines.map(stripComment).join('\n');

  let cursor = 0;
  for (const statement of code.split(';')) {
    const isPrivilegeStatement = PRIVILEGE_STATEMENT.test(statement);
    for (const d of DESTRUCTIVE) {
      const match = d.re.exec(statement);
      if (!match) continue;
      // Dentro de GRANT/REVOKE, TRUNCATE é o nome do privilégio — não apaga nada.
      if (d.kind === TRUNCATE_KIND && isPrivilegeStatement) continue;
      const line = code.slice(0, cursor + match.index).split('\n').length;
      findings.push({
        file,
        line,
        kind: d.kind,
        text: (originalLines[line - 1] ?? '').trim().slice(0, 120),
      });
    }
    cursor += statement.length + 1; // +1 = o ';' consumido pelo split
  }
  return findings;
}

export function scanMigrations(): { findings: Finding[]; approved: string[] } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const findings: Finding[] = [];
  const approved: string[] = [];
  for (const file of files) {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const isApproved = APPROVAL_MARKER.test(raw);
    if (isApproved) {
      approved.push(file);
      continue; // arquivo explicitamente aprovado — não reporta
    }
    findings.push(...scanSql(file, raw));
  }
  return { findings, approved };
}

/** Lança se houver destrutivo não-aprovado. Usado no pré-flight do migrate:prod. */
export function assertMigrationsSafe(): void {
  const { findings } = scanMigrations();
  if (findings.length === 0) return;
  const lines = findings.map((f) => `  ${f.file}:${f.line}  ${f.kind}  →  ${f.text}`).join('\n');
  throw new Error(
    `Migração destrutiva NÃO-APROVADA detectada (gap 1.3):\n${lines}\n\n` +
      'Se for intencional, adicione no arquivo da migration:\n' +
      '  -- migration:destructive-approved <motivo + quem aprovou>',
  );
}

function main(): void {
  const { findings, approved } = scanMigrations();
  if (approved.length > 0) {
    console.log(`[check:migrations] ${approved.length} migration(s) com DROP/TRUNCATE aprovado(s): ${approved.join(', ')}`);
  }
  if (findings.length === 0) {
    console.log('[check:migrations] OK — nenhuma operação destrutiva não-aprovada.');
    return;
  }
  console.error('[check:migrations] BLOQUEADO — operações que APAGAM DADOS sem aprovação:\n');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}\n    ${f.text}`);
  console.error(
    '\nUm DROP/TRUNCATE acidental em prod pode apagar dados. Se for INTENCIONAL\n' +
      '(ex.: remover coluna deprecada após migrar os dados), adicione no topo do\n' +
      'arquivo da migration:\n' +
      '  -- migration:destructive-approved <motivo + quem aprovou>',
  );
  process.exitCode = 1;
}

// Roda como CLI; não executa quando importado (pré-flight do migrate:prod).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
