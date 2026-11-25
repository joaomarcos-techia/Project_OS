/**
 * Árvore XML mínima para as mensagens TISS (P9.1 do plano mestre).
 *
 * A mesma árvore gera o texto do arquivo e o hash do epílogo, então os dois
 * nunca divergem. Regras do Padrão TISS aplicadas aqui:
 *  - codificação ISO-8859-1: caractere fora do latin1 é ERRO, nunca é trocado
 *    em silêncio (o nome errado do beneficiário seria pior que a recusa);
 *  - saída compacta, sem espaço nem quebra entre elementos: o hash concatena o
 *    conteúdo literal das tags, e indentação tornaria o cálculo ambíguo;
 *  - elemento sem valor não é emitido (campo opcional ausente), nunca vazio.
 */

export const TISS_NAMESPACE = 'http://www.ans.gov.br/padroes/tiss/schemas';
const PREFIX = 'ans';

export interface XmlElement {
  readonly name: string;
  readonly children?: readonly XmlNode[];
  readonly text?: string;
}
export type XmlNode = XmlElement;

export class TissEncodingError extends Error {
  constructor(
    readonly path: string,
    readonly character: string,
  ) {
    super(
      `caractere fora do ISO-8859-1 em ${path}: "${character}" (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`,
    );
    this.name = 'TissEncodingError';
  }
}

/** Elemento com texto; `undefined`/`null`/`''` não emite nada. */
export function leaf(name: string, value: string | number | null | undefined): XmlElement | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : { name, text };
}

/** Elemento com filhos; remove os nulos (opcionais ausentes). */
export function node(name: string, children: ReadonlyArray<XmlElement | null>): XmlElement {
  return { name, children: children.filter((c): c is XmlElement => c !== null) };
}

function assertLatin1(text: string, path: string): void {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0xff) throw new TissEncodingError(path, ch);
  }
}

function escapeText(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function serialize(el: XmlElement, path: string, out: string[]): void {
  const here = `${path}/${el.name}`;
  if (el.text !== undefined) {
    assertLatin1(el.text, here);
    out.push(`<${PREFIX}:${el.name}>${escapeText(el.text)}</${PREFIX}:${el.name}>`);
    return;
  }
  out.push(`<${PREFIX}:${el.name}>`);
  for (const child of el.children ?? []) serialize(child, here, out);
  out.push(`</${PREFIX}:${el.name}>`);
}

/**
 * Documento completo: declaração ISO-8859-1 + raiz com o namespace TISS.
 * Devolve o texto; para gravar ou enviar use `toLatin1Bytes`.
 */
export function serializeDocument(root: XmlElement): string {
  const out: string[] = [];
  serialize(root, '', out);
  const body = out.join('');
  const open = `<${PREFIX}:${root.name}>`;
  const withNs =
    `<${PREFIX}:${root.name} xmlns:${PREFIX}="${TISS_NAMESPACE}">` + body.slice(open.length);
  return `<?xml version="1.0" encoding="ISO-8859-1"?>${withNs}`;
}

/** Bytes ISO-8859-1 do documento (o texto já foi conferido como latin1). */
export function toLatin1Bytes(xml: string): Buffer {
  return Buffer.from(xml, 'latin1');
}

/** Valores das folhas em ordem de documento, opcionalmente pulando subárvores. */
export function leafValuesInOrder(el: XmlElement, skip: ReadonlySet<string> = new Set()): string[] {
  if (skip.has(el.name)) return [];
  if (el.text !== undefined) return [el.text];
  return (el.children ?? []).flatMap((child) => leafValuesInOrder(child, skip));
}
