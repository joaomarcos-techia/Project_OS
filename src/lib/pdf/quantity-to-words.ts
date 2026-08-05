/**
 * Quantidade por extenso (pt-BR) — helper PURO de RENDER do receituário de
 * controle especial. Prática recomendada na receita de controlado: "30 (trinta)".
 *
 * IMPORTANTE: isto NÃO toca o domínio nem o MedicamentoSchema. `quantidade`
 * continua texto livre. Se o valor for um inteiro puro (ex.: "30"), anexamos o
 * extenso entre parênteses; qualquer outra forma (ex.: "2 caixas", "1/2", "")
 * é devolvida inalterada — nunca inventamos interpretação.
 */

const UNIDADES = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** Inteiro 0..9999 por extenso (pt-BR). Cobre a faixa realista de uma receita. */
export function integerToWords(n: number): string {
  if (n < 0 || !Number.isInteger(n)) return String(n);
  if (n < 20) return UNIDADES[n]!;
  if (n < 100) {
    const d = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? DEZENAS[d]! : `${DEZENAS[d]} e ${UNIDADES[r]}`;
  }
  if (n === 100) return 'cem';
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? CENTENAS[c]! : `${CENTENAS[c]} e ${integerToWords(r)}`;
  }
  if (n < 1_000_000) {
    const milhares = Math.floor(n / 1000);
    const r = n % 1000;
    const prefixo = milhares === 1 ? 'mil' : `${integerToWords(milhares)} mil`;
    if (r === 0) return prefixo;
    // "e" antes da parte final quando ela é < 100 ou centena redonda.
    const liga = r < 100 || r % 100 === 0 ? ' e ' : ' ';
    return `${prefixo}${liga}${integerToWords(r)}`;
  }
  return String(n);
}

/**
 * Anexa o extenso a uma quantidade SE ela for um inteiro puro. Caso contrário,
 * devolve o texto original. Ex.: "30" → "30 (trinta)"; "2 caixas" → "2 caixas".
 */
export function quantityToWords(quantidade: string | null | undefined): string {
  const raw = (quantidade ?? '').trim();
  if (raw === '') return '';
  if (!/^\d+$/.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return raw;
  return `${raw} (${integerToWords(n)})`;
}
