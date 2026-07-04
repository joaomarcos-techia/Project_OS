/**
 * Predicado canônico de CAPACIDADE CLÍNICA (ADR-032 §2).
 *
 * `isPractitioner` substitui os checks espalhados `role === 'doctor'`: o médico-DONO
 * é `owner` (não `doctor`) e, ao ganhar CRM, precisa ser reconhecido como clínico.
 * CRM é ATRIBUTO (credencial), não identidade — a regra `crm != null ⇒ clínico` mora
 * SÓ aqui (Invariante ADR-032), nunca espalhada.
 *
 * Vive em `lib/auth` (não em `contexts/identity`) porque `boundaries` só permite
 * context → lib: o `scheduling` precisa do `practitionerSql` e importa daqui limpo.
 * Espelha o padrão do `Role` (mora em `roles.ts`, re-exportado pela superfície de
 * identity). `@/contexts/identity` re-exporta `isPractitioner`/`practitionerSql`.
 */
import { sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';

import type { Role } from './roles';

/**
 * Subconjunto de `profiles` que o predicado consome. Cresce QUANDO a lógica crescer
 * (ex.: coluna `is_practitioner` dedicada quando existir profissional-sem-CRM —
 * ADR-032 §2). NÃO adicionar campos que o predicado ignora.
 */
export interface PractitionerCandidate {
  role: Role;
  crm: string | null;
}

/**
 * ⚠️ REGRA CANÔNICA (ADR-032 §2) em DUAS codificações que DEVEM mudar JUNTAS:
 *    1) isPractitioner()  — TS, para quando você já tem role+crm em mãos.
 *    2) practitionerSql() — SQL, para filtros em raw SQL. MESMA regra, sintaxe Postgres.
 * Mexeu numa, mexe na outra. `practitioner.test.ts` tem o teste de equivalência TS×SQL
 * que quebra se divergirem.
 */
export function isPractitioner(p: PractitionerCandidate): boolean {
  return p.role === 'doctor' || (p.crm != null && p.crm.trim() !== '');
}

/**
 * Espelho SQL de `isPractitioner`. Recebe as COLUNAS (não uma string) → se renomearem
 * `crm`, o compilador quebra no call-site (`profiles.crm`), não em runtime.
 *
 * ⚠️ `btrim(...) <> ''` espelha o `.trim()` do TS. Sem isto, `crm = '   '` diverge
 *    (TS = false, SQL = true) — a divergência mais fácil de introduzir.
 */
export function practitionerSql(roleCol: AnyColumn, crmCol: AnyColumn): SQL {
  return sql`(${roleCol} = 'doctor' OR (${crmCol} IS NOT NULL AND btrim(${crmCol}) <> ''))`;
}
