/**
 * Cifra/decifra do CONTEÚDO CLÍNICO (auditoria de banco, A1 · ADR-044).
 *
 * Estende o escopo do ADR-012 (que cifrava só CPF/telefone/endereço) ao registro
 * médico — a categoria de maior sensibilidade (LGPD Art. 11) que estava em claro.
 * REUSA o mecanismo do ADR-012 sem trocá-lo: `encryptForTenant` (HKDF por
 * clinic_id, AES-256-GCM, wire format congelado). Só muda o que é cifrado.
 *
 * Este é o ponto ÚNICO de cifra/decifra clínica — espelha a disciplina do
 * `patient/queries.ts` (single decryption point). Inline aqui porque clinical é
 * o único consumidor (1º uso); promover a `@/lib/crypto` só no 2º.
 */
import 'server-only';

import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import type { Encrypted } from '@/lib/crypto/brand';

/**
 * Cifra um valor estruturado. O plaintext DEVE já estar validado por Zod
 * (`ProntuarioContentSchema.parse` etc.) — a cifra não valida forma, só protege.
 */
export async function encryptJson<T>(clinicId: string, value: T): Promise<Encrypted<T>> {
  const ciphertext = await encryptForTenant(clinicId, JSON.stringify(value));
  return ciphertext as Encrypted<T>;
}

/**
 * Decifra para o tipo T. NÃO re-valida com Zod: o ciphertext é AEAD — adulterar
 * o payload sem a chave é computacionalmente inviável (o auth tag GCM falha), e a
 * única fonte de shape ruim seria bug nosso no write, que já passou pelo `.parse`.
 * Re-parsear defenderia contra ameaça que o tag já cobre.
 *
 * `assertClinicOwnership` roda ANTES do decrypt. Enquadramento honesto: o decrypt
 * já falha fechado por construção — o HKDF usa `clinicId` como salt, então clínica
 * errada ⇒ chave errada ⇒ tag GCM falha ⇒ throw. O ganho aqui não é isolamento
 * adicional; é (a) erro PRECISO ("linha de outra clínica") em vez de "decrypt
 * failed" opaco, e (b) o invariante sobrevive caso um refactor futuro desacople a
 * chave do tenant (hoje nada no TIPO força o clinicId certo).
 */
export async function decryptJson<T>(
  clinicId: string,
  rowClinicId: string,
  ciphertext: Encrypted<T>,
): Promise<T> {
  assertClinicOwnership(clinicId, rowClinicId);
  const plaintext = await decryptForTenant(clinicId, ciphertext);
  return JSON.parse(plaintext) as T;
}

/**
 * Defesa-em-profundidade: a linha lida tem que pertencer à clínica do contexto.
 * Sob RLS/withTenant isto é sempre verdade; a checagem é o cinto-e-suspensório
 * para caminhos `dbAdmin` (backfill, jobs) onde o RLS não intercepta.
 */
export function assertClinicOwnership(expectedClinicId: string, rowClinicId: string): void {
  if (expectedClinicId !== rowClinicId) {
    throw new Error(
      `[clinical] cross-tenant read blocked: contexto=${expectedClinicId} linha=${rowClinicId}`,
    );
  }
}
