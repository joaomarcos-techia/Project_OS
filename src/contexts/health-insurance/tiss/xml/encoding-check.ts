/**
 * Checagem de codificação de um arquivo TISS. O XSD não pega o caso mais comum
 * de erro: texto gravado em UTF-8 com a declaração ISO-8859-1 (o `xmllint`
 * aceita, e o nome com acento chega corrompido na operadora). Ver P9.2.
 */
export type TissEncodingProblem =
  | 'declaration_missing'
  | 'declaration_not_iso_8859_1'
  | 'utf8_bytes_declared_latin1';

const DECLARATION = /^<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']+)["']/iu;

function isStrictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * `null` quando o arquivo declara ISO-8859-1 e os bytes são coerentes.
 *
 * Heurística para UTF-8: há byte acima de 0x7F e o arquivo inteiro é UTF-8
 * válido. Texto latin1 real quase nunca forma UTF-8 válido (ex.: "ção" vira
 * `E7 E3 6F`, sequência inválida em UTF-8). O falso positivo exigiria pares
 * como "Ã©" no próprio texto, que não ocorrem em nomes e endereços.
 */
export function checkTissEncoding(bytes: Uint8Array): TissEncodingProblem | null {
  const head = Buffer.from(bytes.subarray(0, 256)).toString('latin1');
  if (!head.startsWith('<?xml')) return 'declaration_missing';
  const declared = DECLARATION.exec(head)?.[1];
  if (declared?.toUpperCase() !== 'ISO-8859-1') return 'declaration_not_iso_8859_1';
  if (bytes.some((b) => b > 0x7f) && isStrictUtf8(bytes)) return 'utf8_bytes_declared_latin1';
  return null;
}
