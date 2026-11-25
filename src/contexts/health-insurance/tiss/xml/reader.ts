/**
 * Leitor XML ESTRITO para mensagens TISS recebidas da operadora (P9.5).
 *
 * Só é usado DEPOIS do envelope (sem DTD/DOCTYPE, entidade externa, XInclude ou instrução de
 * processamento), do XSD oficial e do hash do epílogo. Mesmo assim, por defesa em
 * profundidade, este leitor:
 *  - recusa `<!DOCTYPE`, `<!ENTITY` e qualquer `<?…?>` que não seja a declaração inicial;
 *  - só decodifica as 5 entidades predefinidas e referências numéricas; qualquer outra
 *    (`&nome;`) é erro — não existe expansão de entidade;
 *  - limita profundidade, quantidade de nós e tamanho do texto.
 * Não resolve nada externo, não lê arquivo, não acessa rede.
 */
export interface XmlNode {
  /** Nome local (sem prefixo de namespace). */
  name: string;
  children: XmlNode[];
  text: string;
}

export class TissXmlReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TissXmlReadError';
  }
}

const MAX_DEPTH = 64;
const MAX_NODES = 500_000;
const MAX_TEXT = 4_000;

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeText(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/gu, (m, ent: string | undefined) => {
    if (!ent) throw new TissXmlReadError('BARE_AMPERSAND', 'caractere & solto no texto');
    if (ent.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10));
    const v = NAMED[ent];
    if (v === undefined) throw new TissXmlReadError('ENTITY_FORBIDDEN', `entidade não permitida: &${ent.slice(0, 20)};`);
    return v;
  });
}

/** Lê a mensagem (ISO-8859-1) e devolve a raiz. */
export function readTissXml(bytes: Uint8Array): XmlNode {
  const src = Buffer.from(bytes).toString('latin1');
  let pos = 0;
  const decl = /^﻿?\s*<\?xml[^?]*\?>/u.exec(src);
  if (decl) pos = decl[0].length;
  const root: XmlNode = { name: '#document', children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  const tag = /<(\/)?([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/gy;
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > pos) {
      const raw = src.slice(pos, textEnd);
      const top = stack[stack.length - 1]!;
      if (raw.trim()) {
        if (top === root) throw new TissXmlReadError('TEXT_OUTSIDE_ROOT', 'texto fora do elemento raiz');
        const t = decodeText(raw);
        if (top.text.length + t.length > MAX_TEXT) throw new TissXmlReadError('TEXT_TOO_LONG', `texto longo demais em ${top.name}`);
        top.text += t;
      }
      pos = textEnd;
      continue;
    }
    if (src.startsWith('<!--', pos)) {
      const end = src.indexOf('-->', pos + 4);
      if (end === -1) throw new TissXmlReadError('MALFORMED', 'comentário sem fim');
      pos = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', pos)) {
      const end = src.indexOf(']]>', pos + 9);
      if (end === -1) throw new TissXmlReadError('MALFORMED', 'CDATA sem fim');
      const top = stack[stack.length - 1]!;
      if (top === root) throw new TissXmlReadError('TEXT_OUTSIDE_ROOT', 'texto fora do elemento raiz');
      top.text += src.slice(pos + 9, end);
      pos = end + 3;
      continue;
    }
    if (src.startsWith('<!', pos)) throw new TissXmlReadError('DTD_FORBIDDEN', 'DOCTYPE/ENTITY não são aceitos');
    if (src.startsWith('<?', pos)) throw new TissXmlReadError('PI_FORBIDDEN', 'instrução de processamento não é aceita');
    tag.lastIndex = pos;
    const m = tag.exec(src);
    if (!m) throw new TissXmlReadError('MALFORMED', `marcação inválida perto da posição ${pos}`);
    const [, closing, , local, , selfClosing] = m;
    pos = tag.lastIndex;
    if (closing) {
      const top = stack.pop();
      if (!top || top === root || top.name !== local) throw new TissXmlReadError('MALFORMED', `fechamento inesperado de ${local}`);
      continue;
    }
    nodes += 1;
    if (nodes > MAX_NODES) throw new TissXmlReadError('TOO_MANY_NODES', 'mensagem com nós demais');
    const parent = stack[stack.length - 1]!;
    if (parent === root && root.children.length > 0) throw new TissXmlReadError('MULTIPLE_ROOTS', 'mais de um elemento raiz');
    const node: XmlNode = { name: local!, children: [], text: '' };
    parent.children.push(node);
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw new TissXmlReadError('TOO_DEEP', 'aninhamento profundo demais');
      stack.push(node);
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new TissXmlReadError('MALFORMED', 'documento incompleto');
  return root.children[0]!;
}

// ── Navegação ────────────────────────────────────────────────────────────

export function child(n: XmlNode | undefined, name: string): XmlNode | undefined {
  return n?.children.find((c) => c.name === name);
}

export function children(n: XmlNode | undefined, name: string): XmlNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}

/** Texto (aparado) do caminho `a/b/c` a partir do nó; `null` se ausente. */
export function textAt(n: XmlNode | undefined, path: string): string | null {
  let cur = n;
  for (const part of path.split('/')) cur = child(cur, part);
  return cur ? cur.text.trim() : null;
}

/** Valor monetário TISS (`123.45`) em centavos; `null` se ausente ou fora do formato. */
export function centsAt(n: XmlNode | undefined, path: string): number | null {
  const t = textAt(n, path);
  if (t === null || !/^-?\d{1,10}(?:\.\d{1,2})?$/u.test(t)) return null;
  const [int, dec = ''] = t.replace('-', '').split('.');
  const v = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  return t.startsWith('-') ? -v : v;
}
