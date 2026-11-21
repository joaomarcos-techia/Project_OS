/**
 * Validação canônica de CNPJ — fonte única para fornecedor, perfil da clínica,
 * onboarding e faturamento TISS (VAL-001 / VAL-002; R16 do plano de convênios).
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
 * CNPJ alfanumérico (IN RFB nº 2.229/2024; emitido desde julho de 2026)
 * ===================================================================
 * 12 posições alfanuméricas (A–Z, 0–9) + 2 dígitos verificadores numéricos.
 * O DV é o mesmo módulo 11, com cada caractere valendo `código ASCII − 48`
 * (0–9 → 0–9; A → 17 … Z → 42). Para um CNPJ só de dígitos o cálculo é
 * idêntico ao antigo, e a forma canônica também: CNPJs numéricos já gravados
 * (cifrados e com `hashForLookup`) continuam com o mesmo valor e o mesmo hash.
 *
 * ===================================================================
 * Contrato
 * ===================================================================
 *  - vazio continua OPCIONAL (o campo é opcional nos cadastros);
 *  - preenchido normaliza para 14 caracteres `[A-Z0-9]`, sem pontuação e em
 *    maiúsculas, e passa pelos dois dígitos verificadores;
 *  - letras NUNCA são descartadas em silêncio: um CNPJ com letras não pode
 *    virar outro número;
 *  - a representação CANÔNICA é o que se persiste — inclusive antes de
 *    `encryptForTenant`/`hashForLookup`, senão o hash passa a representar a
 *    formatação em vez do documento, e duas grafias do mesmo CNPJ viram
 *    registros distintos.
 *
 * Formatação com pontuação existe só na APRESENTAÇÃO.
 */

/**
 * Forma canônica: sem pontuação nem espaços, letras em maiúsculas.
 * `null`/vazio → `null` (campo opcional preenchido em branco).
 *
 * Remove todo caractere que não é letra ou dígito ASCII (como antes fazia com
 * tudo que não era dígito), então um CNPJ numérico digitado com qualquer
 * pontuação normaliza exatamente como antes.
 */
export function normalizeCnpj(input: string | null | undefined): string | null {
  if (input == null) return null;
  const clean = input.replace(/[^0-9A-Za-z]/gu, '').toUpperCase();
  return clean.length === 0 ? null : clean;
}

function checkDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * CNPJ numérico ou alfanumérico com os dois dígitos verificadores corretos.
 * Rejeita também os 14 dígitos repetidos — passam no checksum por acidente
 * aritmético e não são documentos reais.
 */
export function isValidCnpj(input: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(input);
  if (cnpj === null || !/^[A-Z0-9]{12}[0-9]{2}$/u.test(cnpj)) return false;
  if (/^(\d)\1{13}$/u.test(cnpj)) return false;
  const base = cnpj.slice(0, 12);
  const first = checkDigit(base);
  const second = checkDigit(base + String(first));
  return cnpj.slice(12) === `${first}${second}`;
}

/** CNPJ com ao menos uma letra (formato novo). Não valida os dígitos verificadores. */
export function isAlphanumericCnpj(input: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(input);
  return cnpj !== null && /[A-Z]/u.test(cnpj);
}

/** Mensagem única — as telas dizem a mesma coisa sobre o mesmo defeito. */
export const CNPJ_INVALID_MESSAGE =
  'CNPJ inválido. Informe os 14 caracteres (só números, ou letras e números no CNPJ novo) ou deixe em branco.';

/**
 * Normaliza e valida em um passo, para uso em `superRefine`/`transform` de Zod.
 *
 * @returns `null` quando o campo está vazio (válido: é opcional).
 * @throws  nunca — devolve `{ ok:false }` para o schema decidir a mensagem.
 */
export function parseOptionalCnpj(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  const cnpj = normalizeCnpj(input);
  if (cnpj === null) return { ok: true, value: null };
  return isValidCnpj(cnpj) ? { ok: true, value: cnpj } : { ok: false };
}

/** Apresentação: `00.000.000/0000-00` (ou `12.ABC.345/01DE-35`). Entrada inválida volta como veio. */
export function formatCnpj(input: string | null | undefined): string {
  const cnpj = normalizeCnpj(input);
  if (cnpj === null || !/^[A-Z0-9]{12}[0-9]{2}$/u.test(cnpj)) return input ?? '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
