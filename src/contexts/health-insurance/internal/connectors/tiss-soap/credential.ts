/**
 * P6.5/P12.5 — a ÚNICA leitura da credencial da operadora em claro: o login do webservice da
 * clínica, decifrado na hora do envio pelo adaptador homologado (`tiss-soap-adapter.ts`).
 *
 *   - só a credencial ATIVA do tipo `webservice_login` daquela clínica e operadora;
 *   - marca `last_used_at` (a tela mostra quando a credencial foi usada);
 *   - devolve só para o adaptador, em memória; nada vai para log, resultado, erro ou recibo;
 *   - o gate estático (`insurer-credential-actions.test.ts`) aceita este arquivo e nenhum outro
 *     decifrando a coluna.
 *
 * Sem adaptador homologado no registro de produção (B5), nada chama esta função.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { decryptForTenant } from '@/lib/crypto/encryption';

import { hiInsurerCredentials } from '../../../schema-clinic';
import type { TissSoapCredential } from './tiss-soap-adapter';

export async function readWebserviceCredentialForSendTx(
  tx: Tx,
  clinicId: string,
  insurerId: string,
): Promise<TissSoapCredential | null> {
  const [row] = await tx
    .update(hiInsurerCredentials)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(hiInsurerCredentials.clinicId, clinicId),
        eq(hiInsurerCredentials.insurerId, insurerId),
        eq(hiInsurerCredentials.kind, 'webservice_login'),
        eq(hiInsurerCredentials.status, 'active'),
      ),
    )
    .returning({
      usernameEncrypted: hiInsurerCredentials.usernameEncrypted,
      secretEncrypted: hiInsurerCredentials.secretEncrypted,
    });
  if (!row?.usernameEncrypted) return null;
  return {
    login: await decryptForTenant(clinicId, row.usernameEncrypted),
    password: await decryptForTenant(clinicId, row.secretEncrypted),
  };
}
