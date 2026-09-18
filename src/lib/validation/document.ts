/**
 * CPF/CNPJ do responsável pela cobrança.
 *
 * Existe porque o contrato do Asaas **exige documento para assinar**: medido no
 * sandbox em 18/09/2026, `POST /subscriptions` devolve `400 invalid_object`
 * para customer sem `cpfCnpj`, com ou sem `billingType` definido. Não é
 * precaução — é a matriz de bisecção registrada na ADR-053.
 *
 * O documento é dado da própria pessoa, não uma afirmação de autoridade: ele
 * não decide plano, preço, papel nem tenant. Mesmo assim é PII sensível, então
 * a regra do fluxo autônomo é **não persistir antes do tenant existir** — ele
 * atravessa a requisição em memória e só descansa cifrado por tenant em
 * `billing_customers`.
 */
import { isValidCnpj } from './cnpj';

export const DOCUMENT_INVALID_MESSAGE =
  'CPF ou CNPJ inválido. Informe os 11 dígitos do CPF ou os 14 do CNPJ.';

/** Só dígitos. `null` quando não sobra nada — ausência é diferente de inválido. */
export function normalizeDocument(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\D/gu, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Dígitos verificadores do CPF.
 *
 * A rejeição de repetidos (`111...`) é obrigatória: eles passam no algoritmo de
 * módulo 11 e são exatamente o que alguém digita para "preencher o campo".
 */
export function isValidCpf(input: string | null | undefined): boolean {
  const cpf = normalizeDocument(input);
  if (!cpf || cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/u.test(cpf)) return false;

  const digitAt = (index: number): number => Number(cpf[index]);
  for (const [length, position] of [
    [9, 9],
    [10, 10],
  ] as const) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += digitAt(i) * (length + 1 - i);
    const remainder = (sum * 10) % 11;
    const expected = remainder === 10 ? 0 : remainder;
    if (expected !== digitAt(position)) return false;
  }
  return true;
}

/** Aceita CPF (11) ou CNPJ (14). Qualquer outro comprimento é inválido. */
export function isValidDocument(input: string | null | undefined): boolean {
  const digits = normalizeDocument(input);
  if (!digits) return false;
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export type DocumentKind = 'cpf' | 'cnpj';

export interface ParsedDocument {
  digits: string;
  kind: DocumentKind;
}

/**
 * Normaliza e valida de uma vez. Devolve `null` em vez de lançar, porque a
 * borda que chama isto responde `400` — não é exceção de programação.
 */
export function parseDocument(input: string | null | undefined): ParsedDocument | null {
  const digits = normalizeDocument(input);
  if (!digits || !isValidDocument(digits)) return null;
  return { digits, kind: digits.length === 11 ? 'cpf' : 'cnpj' };
}

/**
 * Máscara para exibição/diagnóstico. NUNCA devolve o documento inteiro: o que
 * sai é o suficiente para a pessoa se reconhecer e insuficiente para alguém
 * reconstruir o número.
 */
export function maskDocument(input: string | null | undefined): string {
  const digits = normalizeDocument(input);
  if (!digits) return '';
  const tail = digits.slice(-2);
  return `${'•'.repeat(Math.max(digits.length - 2, 0))}${tail}`;
}
