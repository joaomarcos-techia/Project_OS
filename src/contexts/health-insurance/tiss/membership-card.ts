/**
 * Número da carteirinha: normalização, entrada do HMAC de busca e "últimos 4"
 * (P1.5; D21 do plano mestre).
 *
 * - O Padrão TISS trata o número como texto de até 20 caracteres
 *   (`st_texto20`); operadoras usam dígitos e, às vezes, letras. A forma
 *   canônica tira espaços, pontos, hífens e barras e põe letras em maiúsculas.
 *   Outros símbolos não são descartados: tornam o número inválido, em vez de
 *   virar outro número em silêncio.
 * - A busca usa HMAC (`hashForLookup`) sobre "<clinic_id>:<registro ANS>:<número>".
 *   Com a clínica e a operadora na entrada, a mesma carteirinha não gera o mesmo
 *   hash em duas clínicas: não dá para correlacionar pacientes entre clínicas
 *   pelo banco.
 * - A tela mostra só os 4 últimos caracteres.
 */
export const CARD_NUMBER_MAX = 20;

export class CardNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardNumberError';
  }
}

/** Forma canônica; lança `CardNumberError` se vazia, longa demais ou com símbolo. */
export function normalizeCardNumber(input: string): string {
  const canonical = input.replace(/[\s.\-/]/gu, '').toUpperCase();
  if (canonical.length === 0) throw new CardNumberError('Informe o número da carteirinha.');
  if (canonical.length > CARD_NUMBER_MAX) {
    throw new CardNumberError(
      `O número da carteirinha tem no máximo ${CARD_NUMBER_MAX} caracteres.`,
    );
  }
  if (!/^[0-9A-Z]+$/u.test(canonical)) {
    throw new CardNumberError('O número da carteirinha só pode ter letras e números.');
  }
  return canonical;
}

/** Entrada do HMAC de busca (D21). Recebe o número já normalizado. */
export function cardLookupInput(clinicId: string, registroAns: string, canonical: string): string {
  if (!/^[0-9]{6}$/u.test(registroAns)) throw new CardNumberError('Registro ANS inválido.');
  return `${clinicId}:${registroAns}:${canonical}`;
}

/** Últimos 4 caracteres do número normalizado, para exibição. */
export function cardLast4(canonical: string): string {
  return canonical.slice(-4);
}
