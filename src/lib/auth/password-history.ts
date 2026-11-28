import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

import { PASSWORD_HISTORY_SIZE, type PasswordVerifier } from './security-profile/tiss-policies';

/**
 * S4 — histórico de verificadores de senha (`auth_password_history`, candidata 0170). Só o pool administrativo
 * acessa (RLS forçada sem política). Guarda verificador scrypt com sal e pepper, nunca a senha.
 */
export async function readPasswordHistory(
  userId: string,
): Promise<{ verifiers: PasswordVerifier[]; lastChangedAt: Date | null }> {
  const rows = (await dbAdmin.execute(sql`
    SELECT verifier, created_at FROM public.auth_password_history
     WHERE user_id = ${userId}::uuid
     ORDER BY created_at DESC
     LIMIT ${PASSWORD_HISTORY_SIZE}
  `)) as unknown as Array<{ verifier: PasswordVerifier; created_at: Date | string }>;
  return {
    verifiers: rows.map((r) => r.verifier),
    lastChangedAt: rows[0] ? new Date(rows[0].created_at) : null,
  };
}

/** Grava a troca e mantém só as `PASSWORD_HISTORY_SIZE` mais recentes do usuário. */
export async function appendPasswordHistory(
  userId: string,
  verifier: PasswordVerifier,
): Promise<void> {
  await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO public.auth_password_history (user_id, verifier)
      VALUES (${userId}::uuid, jsonb_build_object(
        'alg', ${verifier.alg}::text, 'N', ${verifier.N}::int, 'r', ${verifier.r}::int, 'p', ${verifier.p}::int,
        'salt', ${verifier.salt}::text, 'hash', ${verifier.hash}::text))`);
    // jsonb_build_object, nunca `${JSON.stringify(v)}::jsonb`: o postgres.js codificaria duas vezes (string JSON).
    await tx.execute(sql`
      DELETE FROM public.auth_password_history
       WHERE user_id = ${userId}::uuid
         AND id NOT IN (
           SELECT id FROM public.auth_password_history
            WHERE user_id = ${userId}::uuid
            ORDER BY created_at DESC, id DESC
            LIMIT ${PASSWORD_HISTORY_SIZE})`);
  });
}
