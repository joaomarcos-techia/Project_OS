/**
 * Conferência independente do hash do epílogo a partir do TEXTO do arquivo,
 * sem usar a árvore que o gerou. Serve para provar que o hash gravado bate com
 * o conteúdo (corpus de validação, P13) e, depois, para conferir arquivos que
 * chegam da operadora (demonstrativos, P9.5).
 *
 * Regra (Componente Organizacional 202609, p. 49): MD5 em hexadecimal da
 * concatenação dos valores das tags, da esquerda para a direita, em
 * ISO-8859-1, sem o epílogo.
 *
 * Limites conhecidos, aceitáveis para o Padrão TISS: não trata CDATA nem DTD
 * (o padrão não usa); remove comentários e instruções de processamento; ignora
 * texto só de espaço entre elementos (indentação de arquivos formatados).
 */
import { createHash } from 'node:crypto';

export interface EpilogueHashCheck {
  /** Hash gravado no epílogo, ou `null` se não houver. */
  declared: string | null;
  /** Hash recalculado a partir do conteúdo. */
  computed: string;
  matches: boolean;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/gu, (_, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return NAMED_ENTITIES[e]!;
  });
}

const EPILOGUE = /<(?:[\w.-]+:)?epilogo\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?epilogo\s*>/u;
const HASH = /<(?:[\w.-]+:)?hash\b[^>]*>([^<]*)<\//u;

export function verifyEpilogueHash(bytes: Uint8Array): EpilogueHashCheck {
  const text = Buffer.from(bytes)
    .toString('latin1')
    .replace(/<\?[\s\S]*?\?>/gu, '')
    .replace(/<!--[\s\S]*?-->/gu, '');
  const epilogue = EPILOGUE.exec(text);
  const declared = epilogue ? (HASH.exec(epilogue[1]!)?.[1]?.trim() ?? null) : null;
  const content = epilogue
    ? text.slice(0, epilogue.index) + text.slice(epilogue.index + epilogue[0].length)
    : text;

  const values: string[] = [];
  for (const m of content.matchAll(/>([^<]+)</gu)) {
    if (m[1]!.trim() === '') continue;
    values.push(decodeEntities(m[1]!));
  }
  const computed = createHash('md5')
    .update(Buffer.from(values.join(''), 'latin1'))
    .digest('hex');
  return {
    declared,
    computed,
    matches: declared !== null && declared.toLowerCase() === computed,
  };
}
