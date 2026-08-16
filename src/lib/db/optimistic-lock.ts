import 'server-only';

import { sql, type Column, type SQL } from 'drizzle-orm';

/**
 * REGRESSION (E2E de produção, 2026-08-16) — compare-and-swap por `updated_at`
 * NUNCA casava, e toda edição concorrente-safe falhava.
 *
 * `timestamptz` no Postgres tem precisão de MICROSSEGUNDOS. O valor chega ao
 * formulário como ISO-8601 (`toISOString()`), que só tem MILISSEGUNDOS, e volta
 * como `new Date(iso)`. Comparar os dois com `=` compara `…471227` com
 * `…471000`: nunca é igual. O resultado observado em produção foram DUAS
 * escritas concorrentes falhando com `StaleWriteError` — quando o correto é uma
 * vencer — e, pior, TODA edição isolada de paciente falhando também, porque a
 * comparação só depende do round-trip, não da concorrência.
 *
 * As três telas corrigidas para lost update no ciclo anterior (paciente,
 * fornecedor, perfil da clínica) tinham a mesma linha copiada. Este helper
 * existe para que a regra viva num lugar só.
 *
 * A comparação trunca AMBOS os lados ao milissegundo — a precisão que o
 * round-trip realmente preserva. Não enfraquece a detecção: duas edições
 * distintas separadas por menos de 1 ms não são um cenário real, e o `FOR
 * UPDATE`/lock de linha já serializa gravações simultâneas de qualquer forma.
 */
export function matchesExpectedVersion(column: Column, expectedIso: string): SQL {
  // A string ISO vai CRUA como parâmetro. Passar um `Date` aqui parece
  // equivalente e não é: o template do Drizzle o serializa com `toString()`
  // (`Sun Aug 16 2026 12:52:18 GMT+0000 (Coordinated Universal Time)`), que o
  // Postgres não converte para timestamptz — a query inteira falha em vez de
  // casar zero linhas. O ISO-8601 é parseado nativamente.
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expectedIso}::timestamptz)`;
}
