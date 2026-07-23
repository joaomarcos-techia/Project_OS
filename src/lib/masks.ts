/**
 * Máscaras de input BR (CPF/CNPJ/telefone/CEP) — puras, client-safe.
 *
 * REGRA ARQUITETURAL (não misturar):
 *   - mask*   = UX: formata enquanto o usuário digita. NUNCA é fonte de verdade.
 *   - normalize* (@/lib/crypto) = persistência: tira formatação antes de gravar.
 *   - validate* (@/lib/crypto)  = regra de negócio (ex.: dígito verificador do CPF).
 *
 * As máscaras só deixam passar dígitos (bloqueiam letras/símbolos/Unicode) e
 * inserem os separadores. Idempotentes: aplicar 2× = 1×. Seguras para
 * `null/undefined`. O submit sempre re-normaliza no servidor.
 */

const onlyDigits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** CPF: `000.000.000-00` (até 11 dígitos). */
export function maskCpf(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, '$1-$2');
}

/** CNPJ: `00.000.000/0000-00` (até 14 dígitos). */
export function maskCnpj(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{2}\.\d{3}\.\d{3})(\d)/, '$1/$2')
    .replace(/^(\d{2}\.\d{3}\.\d{3}\/\d{4})(\d)/, '$1-$2');
}

/**
 * CPF **ou** CNPJ no mesmo campo (ex.: titular do cartão): 0–11 dígitos → CPF;
 * 12–14 → CNPJ. Transição determinística ao digitar o 12º dígito.
 */
export function maskCpfCnpj(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 14);
  return d.length <= 11 ? maskCpf(d) : maskCnpj(d);
}

/**
 * Telefone BR: `(11) 90000-0000` (celular, 11 díg) ou `(11) 0000-0000` (fixo, 10).
 * Formata progressivamente: `(`, DDD, `) `, número, `-`.
 */
export function maskPhoneBR(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  // celular (9 díg no rest) quebra em 5+4; fixo (8) em 4+4.
  const pivot = rest.length > 8 ? 5 : 4;
  if (rest.length <= pivot) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, pivot)}-${rest.slice(pivot)}`;
}

/** CEP: `00000-000` (até 8 dígitos). */
export function maskCep(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
