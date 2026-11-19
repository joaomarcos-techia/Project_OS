/**
 * Carrega a terminologia TUSS versionada (artefatos de `data/tiss/terminologia`)
 * e as versões de comunicação TISS (manifestos dos XSDs) nas tabelas globais
 * `tiss_*` (P1.3 do QORO_TISS_MASTER_PLAN.md).
 *
 * Garantias:
 *  - confere o SHA-256 de cada arquivo contra o MANIFEST antes de gravar;
 *  - idempotente: rodar de novo não duplica (ON CONFLICT DO NOTHING);
 *  - recusa sobrescrever uma competência já carregada com conteúdo diferente;
 *  - confere as contagens por tabela no fim, dentro da mesma transação;
 *  - só DEV, e só no projeto que o operador nomear (`--expected-ref`).
 *    Produção segue o runbook de publicação (P15.7), nunca este atalho.
 *
 * Por que conexão própria e não `dbAdmin`: o DEV compartilhado fica em outra
 * região e leva ~10–16 s para aceitar conexão daqui; o pool do app tem
 * `connect_timeout` de 10 s e falha antes. Script one-shot e guardado, na
 * lista de exceções do lint e do `arch-db-check` (mesmo padrão do
 * `run-signup-recovery-dev.ts`).
 *
 * Uso:
 *   npx tsx scripts/tiss/terminology/load.ts --version 202609 --expected-ref <ref do projeto DEV>
 *
 * O núcleo (leitura conferida e gravação) fica em `load-core.ts`, sem conexão própria, para a
 * medição em Postgres descartável (P14.4) usar o mesmo código.
 */
import postgres from 'postgres';

import { assertDevContext } from '../../_env';
import { loadTerminologyTx, readTerminologyArtifacts, type TerminologyTx } from './load-core';

const startedAt = Date.now();
function progress(message: string): void {
  console.log(
    `[tiss:terminology:load] ${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`,
  );
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const version = arg('version');
  const expectedRef = arg('expected-ref');
  if (!version || !/^\d{6}$/u.test(version)) throw new Error('--version AAAAMM é obrigatório');
  if (!expectedRef || !/^[a-z0-9]{20}$/u.test(expectedRef)) {
    throw new Error('--expected-ref <ref do projeto Supabase de destino> é obrigatório');
  }
  // No pooler do Supabase o projeto vem no usuário (`postgres.<ref>`); na
  // conexão direta, no host (`db.<ref>.supabase.co`).
  const target = new URL(databaseUrl);
  if (!target.username.endsWith(`.${expectedRef}`) && !target.hostname.includes(expectedRef)) {
    throw new Error('DATABASE_URL não aponta para o projeto informado em --expected-ref');
  }

  const artifacts = readTerminologyArtifacts(version);
  progress(`artefatos conferidos: ${artifacts.tables.length} tabelas, ${artifacts.schemas.length} versão(ões) TISS`);

  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: 'require',
    max: 1,
    connect_timeout: 45,
    idle_timeout: 30,
  });
  try {
    await sql.begin(async (tx) => {
      progress('conectado; transação aberta');
      await loadTerminologyTx(tx as unknown as TerminologyTx, artifacts, { progress });
    });
    progress('transação confirmada');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[tiss:terminology:load] FALHOU:', error instanceof Error ? error.message : error);
  process.exit(1);
});
