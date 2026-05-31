/**
 * `pnpm bump-role-claims <role>` — fecha a janela de revogação por role (gap
 * 3.2 / D27 do ADR-009).
 *
 * Quando você muda o BUNDLE de uma role (tabela `role_permissions` — ex.: tira
 * `edit:agenda` do `attendant`), os usuários JÁ logados mantêm as permissões
 * antigas no JWT por até ~15min (TTL do token). O `claims_version` só é bumpado
 * automaticamente em mudanças do PRÓPRIO usuário (role/clinic/ativo/overrides),
 * NÃO em mudanças globais de `role_permissions` (D27, débito aceito até C16).
 *
 * Este script bumpa `claims_version` de TODOS os usuários ativos da role → o
 * drift-check do middleware detecta o mismatch e força signOut + re-login em
 * ~60-75s, com o bundle novo. Rode SEMPRE após mudar um bundle de role em prod.
 *
 * Alvo = `DATABASE_URL` do .env.local (rode com as credenciais do ambiente certo).
 */
import { redact } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

const TENANT_ROLES = ['gestor', 'doctor', 'attendant', 'financial', 'owner'] as const;

const role = process.argv[2];
if (!role || !(TENANT_ROLES as readonly string[]).includes(role)) {
  console.error(
    `Uso: pnpm bump-role-claims <role>\n` +
      `  role ∈ ${TENANT_ROLES.join(', ')}\n\n` +
      'Força re-login de todos os usuários ativos da role após mudar o bundle\n' +
      '(role_permissions). Sem isso, mantêm permissões antigas por até ~15min.',
  );
  process.exit(1);
}

console.log(`[bump-role-claims] alvo: ${redact(env.DATABASE_URL)}`);

const rows = (await dbAdmin.execute(sql`
  UPDATE profiles
     SET claims_version = claims_version + 1
   WHERE role = ${role}::role_enum
     AND deleted_at IS NULL
  RETURNING id
`)) as unknown as Array<{ id: string }>;

console.log(`[bump-role-claims] role='${role}': ${rows.length} usuário(s) ativo(s) bumpado(s).`);
console.log(
  'Serão deslogados pelo drift-check do middleware em ~60-75s e relogam com o bundle novo.',
);
process.exit(0);
