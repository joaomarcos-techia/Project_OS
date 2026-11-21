/**
 * Hash do epílogo das mensagens TISS (Componente Organizacional 202609, p. 49):
 *
 * > "No Padrão TISS o cálculo do hash deve considerar apenas a concatenação do
 * > conteúdo das tags desprezando as tags XML propriamente ditas. [...] O
 * > encoding a ser utilizado será sempre o ISO-8859-1. [...] O hash de uma
 * > transação deve conter, em hexadecimal, a representação MD5 dos valores
 * > contidos na transação, justapostos, lidos da esquerda para a direita."
 *
 * O epílogo em si (onde o hash vai) fica fora do cálculo.
 */
import { createHash } from 'node:crypto';

import { leafValuesInOrder, type XmlElement } from './tree';

export const EPILOGUE_ELEMENT = 'epilogo';

/** MD5 em hexadecimal minúsculo dos valores da mensagem, em ISO-8859-1. */
export function tissEpilogueHash(message: XmlElement): string {
  const concatenated = leafValuesInOrder(message, new Set([EPILOGUE_ELEMENT])).join('');
  return createHash('md5').update(Buffer.from(concatenated, 'latin1')).digest('hex');
}
