/**
 * Validação canônica de CNPJ — fonte única para fornecedor, perfil da clínica
 * e onboarding (VAL-001 / VAL-002).
 *
 * ===================================================================
 * O que o pentest encontrou
 * ===================================================================
 * `CreateSupplierSchema` aplicava `trim().max(18)` e `ClinicProfileSchema`
 * aceitava qualquer string de até 20 caracteres. Nos dois casos o valor `1` foi
 * enviado, aceito e persistido — no perfil da clínica, cifrado e hasheado. O
 * comentário do próprio schema já registrava a lacuna.
 *
 * A máscara do formulário limita CARACTERES; ela não é validação de domínio e
 * não protege caller direto (Server Action reapresentada, importação, agente).
 *
 * ===================================================================
 * Contrato
 * ===================================================================
 *  - vazio continua OPCIONAL (o campo é opcional nos dois cadastros);
 *  - preenchido normaliza para 14 DÍGITOS e passa pelos dois dígitos
 *    verificadores (módulo 11);
 *  - a representação CANÔNICA (só dígitos) é o que se persiste — inclusive
 *    antes de `encryptForTenant`/`hashForLookup`, senão o hash passa a
 *    representar a formatação em vez do documento, e duas grafias do mesmo CNPJ
 *    viram registros distintos.
 *
 * Formatação com pontuação existe só na APRESENTAÇÃO.
 */

/** Só os dígitos. `null`/vazio → `null` (campo opcional preenchido em branco). */
export function normalizeCnpj(input: string | null | undefined): string | null {
  if (input == null) return null;
  const digits = input.replace(/\D/gu, '');
  return digits.length === 0 ? null : digits;
}

/**
 * Dígitos verificadores do CNPJ (módulo 11, pesos 2..9 cíclicos da direita).
 * Rejeita também os 14 dígitos repetidos — passam no checksum por acidente
 * aritmético e não são documentos reais.
 */
export function isValidCnpj(input: string | null | undefined): boolean {
  const digits = normalizeCnpj(input);
  if (digits === null) return false;
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/u.test(digits)) return false;

  const checkDigit = (slice: string): number => {
    let weight = 2;
    let sum = 0;
    for (let i = slice.length - 1; i >= 0; i--) {
      sum += Number(slice[i]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = digits.slice(0, 12);
  const first = checkDigit(base);
  if (first !== Number(digits[12])) return false;
  return checkDigit(base + String(first)) === Number(digits[13]);
}

/** Mensagem única — as duas telas dizem a mesma coisa sobre o mesmo defeito. */
export const CNPJ_INVALID_MESSAGE = 'CNPJ inválido. Informe os 14 dígitos ou deixe em branco.';

/**
 * Normaliza e valida em um passo, para uso em `superRefine`/`transform` de Zod.
 *
 * @returns `null` quando o campo está vazio (válido: é opcional).
 * @throws  nunca — devolve `{ ok:false }` para o schema decidir a mensagem.
 */
export function parseOptionalCnpj(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  const digits = normalizeCnpj(input);
  if (digits === null) return { ok: true, value: null };
  return isValidCnpj(digits) ? { ok: true, value: digits } : { ok: false };
}

/** Apresentação: `00.000.000/0000-00`. Entrada inválida volta como veio. */
export function formatCnpj(input: string | null | undefined): string {
  const digits = normalizeCnpj(input);
  if (digits === null || digits.length !== 14) return input ?? '';
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
