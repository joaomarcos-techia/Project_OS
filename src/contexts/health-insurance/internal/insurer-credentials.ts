/**
 * P2.5 — credenciais da clínica junto à operadora (login do webservice ou certificado), em
 * `hi_insurer_credentials` (0144). Engenharia independente de operadora real:
 *
 *   - cifradas por clínica (`encryptForTenant`); o texto em claro só existe na memória do pedido;
 *   - uma ativa por operadora e tipo (índice único da 0144); salvar de novo é ROTAÇÃO: a anterior
 *     vira `revoked` com a data, nada é apagado;
 *   - a leitura para a tela nunca devolve segredo, usuário nem texto cifrado — só tipo, situação
 *     e datas;
 *   - quem decifra é só o conector homologado (P12.5), que ainda não existe: até lá nada usa o
 *     segredo e `last_used_at` fica vazio.
 */
import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { encryptForTenant } from '@/lib/crypto/encryption';

import { hiInsurerCredentials, hiInsurers } from '../schema-clinic';
import { InsuranceConfigError } from './config-service';

export type InsurerCredentialKind = 'webservice_login' | 'certificate';

export interface InsurerCredentialView {
  id: string;
  kind: InsurerCredentialKind;
  status: 'active' | 'revoked';
  hasUsername: boolean;
  createdAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
}

const fail = (code: string, message: string): never => {
  throw new InsuranceConfigError(message, code);
};

async function assertInsurer(tx: Tx, clinicId: string, insurerId: string) {
  const [ins] = await tx
    .select({ status: hiInsurers.status })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, clinicId), eq(hiInsurers.id, insurerId)))
    .limit(1);
  if (!ins) fail('INSURER_NOT_FOUND', 'Operadora não encontrada nesta clínica.');
  if (ins!.status === 'archived')
    fail('INSURER_ARCHIVED', 'Operadora arquivada não recebe credencial.');
}

/** Salva (ou rotaciona) a credencial. Devolve só o id e se houve rotação. */
export async function saveInsurerCredentialTx(
  tx: Tx,
  input: {
    clinicId: string;
    userId: string;
    insurerId: string;
    kind: InsurerCredentialKind;
    username: string | null;
    secret: string;
  },
): Promise<{ credentialId: string; rotated: boolean }> {
  if (input.kind !== 'webservice_login' && input.kind !== 'certificate') {
    fail('CREDENTIAL_KIND', 'Tipo de credencial inválido.');
  }
  const secret = input.secret;
  if (secret.length < 8 || secret.length > 16_384) {
    fail('CREDENTIAL_SECRET', 'A senha/certificado precisa ter de 8 a 16.384 caracteres.');
  }
  const username = input.username?.trim() || null;
  if (input.kind === 'webservice_login' && !username) {
    fail('CREDENTIAL_USERNAME', 'Informe o usuário do webservice da operadora.');
  }
  if (username && username.length > 200) fail('CREDENTIAL_USERNAME', 'Usuário longo demais.');
  await assertInsurer(tx, input.clinicId, input.insurerId);

  // Serializa a troca: duas pessoas não deixam duas ativas (o índice único também recusaria).
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hi:insurer-credential:${input.clinicId}:${input.insurerId}:${input.kind}`}, 0))`,
  );
  const revoked = await tx
    .update(hiInsurerCredentials)
    .set({ status: 'revoked', rotatedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(hiInsurerCredentials.clinicId, input.clinicId),
        eq(hiInsurerCredentials.insurerId, input.insurerId),
        eq(hiInsurerCredentials.kind, input.kind),
        eq(hiInsurerCredentials.status, 'active'),
      ),
    )
    .returning({ id: hiInsurerCredentials.id });
  const [row] = await tx
    .insert(hiInsurerCredentials)
    .values({
      clinicId: input.clinicId,
      insurerId: input.insurerId,
      kind: input.kind,
      usernameEncrypted: username ? await encryptForTenant(input.clinicId, username) : null,
      secretEncrypted: await encryptForTenant(input.clinicId, secret),
      status: 'active',
      createdBy: input.userId,
    })
    .returning({ id: hiInsurerCredentials.id });
  return { credentialId: row!.id, rotated: revoked.length > 0 };
}

export async function revokeInsurerCredentialTx(
  tx: Tx,
  input: { clinicId: string; insurerId: string; credentialId: string },
): Promise<void> {
  const out = await tx
    .update(hiInsurerCredentials)
    .set({ status: 'revoked', rotatedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(hiInsurerCredentials.clinicId, input.clinicId),
        eq(hiInsurerCredentials.insurerId, input.insurerId),
        eq(hiInsurerCredentials.id, input.credentialId),
        eq(hiInsurerCredentials.status, 'active'),
      ),
    )
    .returning({ id: hiInsurerCredentials.id });
  if (out.length === 0)
    fail('CREDENTIAL_NOT_FOUND', 'Credencial ativa não encontrada nesta operadora.');
}

/** Para a tela: tipo, situação e datas. NUNCA segredo, usuário ou texto cifrado. */
export async function listInsurerCredentialsTx(
  tx: Tx,
  clinicId: string,
  insurerId: string,
): Promise<InsurerCredentialView[]> {
  const rows = await tx
    .select({
      id: hiInsurerCredentials.id,
      kind: hiInsurerCredentials.kind,
      status: hiInsurerCredentials.status,
      hasUsername: sql<boolean>`${hiInsurerCredentials.usernameEncrypted} IS NOT NULL`,
      createdAt: hiInsurerCredentials.createdAt,
      rotatedAt: hiInsurerCredentials.rotatedAt,
      lastUsedAt: hiInsurerCredentials.lastUsedAt,
    })
    .from(hiInsurerCredentials)
    .where(
      and(
        eq(hiInsurerCredentials.clinicId, clinicId),
        eq(hiInsurerCredentials.insurerId, insurerId),
      ),
    )
    .orderBy(desc(hiInsurerCredentials.createdAt))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as InsurerCredentialKind,
    status: r.status as 'active' | 'revoked',
    hasUsername: Boolean(r.hasUsername),
    createdAt: (r.createdAt as Date).toISOString(),
    rotatedAt: r.rotatedAt ? (r.rotatedAt as Date).toISOString() : null,
    lastUsedAt: r.lastUsedAt ? (r.lastUsedAt as Date).toISOString() : null,
  }));
}
