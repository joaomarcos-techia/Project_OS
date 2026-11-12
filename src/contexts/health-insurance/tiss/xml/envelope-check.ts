/**
 * Estrutura mínima de uma mensagem TISS, conferida ANTES do XSD (P9.2):
 *
 *  - tamanho máximo (nada de arquivo gigante chegando ao parser);
 *  - nenhum DTD (`<!DOCTYPE`, `<!ENTITY`, `<!ELEMENT`, `<!ATTLIST`, `<!NOTATION`): sem entidade
 *    externa (XXE) e sem expansão exponencial ("billion laughs"). O TISS não usa DTD, então
 *    recusar é exato, não heurística;
 *  - nenhuma instrução de processamento além da declaração XML, e nenhum XInclude;
 *  - raiz `mensagemTISS` no namespace oficial da ANS;
 *  - `Padrao` igual à versão do conjunto de XSD carregado (o XSD aceita versões antigas no
 *    campo, mas a estrutura validada é a da versão carregada).
 *
 * É a primeira barreira tanto do XML que o Qoro gera (passo 7 da exportação) quanto do XML
 * que chega de fora (retornos e demonstrativos da operadora, P9.5). As mensagens dizem o que
 * está errado, nunca o conteúdo do arquivo.
 */
export const TISS_NAMESPACE = 'http://www.ans.gov.br/padroes/tiss/schemas';

export type EnvelopeProblemCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'DTD_FORBIDDEN'
  | 'PROCESSING_INSTRUCTION_FORBIDDEN'
  | 'XINCLUDE_FORBIDDEN'
  | 'ROOT_ELEMENT'
  | 'NAMESPACE'
  | 'VERSION_MISSING'
  | 'VERSION_UNSUPPORTED';

export interface EnvelopeProblem {
  code: EnvelopeProblemCode;
  message: string;
}

const DTD = /<!(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/iu;
/** Qualquer `<?alvo` que não seja a declaração `<?xml …?>` (ex.: `<?xml-stylesheet`). */
const PROCESSING_INSTRUCTION = /<\?(?!xml\s)[^\s?]/u;
const XINCLUDE = 'http://www.w3.org/2001/XInclude';
/** Raiz: pula declaração, comentários e espaços; captura prefixo, nome local e atributos. */
const ROOT = /^(?:\s|<\?xml\s[\s\S]*?\?>|<!--[\s\S]*?-->)*<([A-Za-z_][\w.-]*)(?::([A-Za-z_][\w.-]*))?(\s[^>]*)?\/?>/u;

/** Nome XML (`[\w.-]` e `:`) dentro de RegExp com a flag `u`: só o ponto é metacaractere. */
const escapeName = (name: string) => name.replace(/\./gu, '\\.');

export function checkTissEnvelope(
  bytes: Uint8Array,
  expected: { version: string; maxBytes: number },
): EnvelopeProblem[] {
  if (bytes.length === 0) return [{ code: 'EMPTY', message: 'O arquivo XML está vazio.' }];
  if (bytes.length > expected.maxBytes) {
    return [
      {
        code: 'TOO_LARGE',
        message: `O arquivo tem ${bytes.length} bytes; o limite de validação é ${expected.maxBytes}. Divida o lote.`,
      },
    ];
  }
  // Leitura byte a byte (latin1): só procura marcadores ASCII, não interpreta o texto.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const problems: EnvelopeProblem[] = [];
  if (DTD.test(text)) {
    problems.push({
      code: 'DTD_FORBIDDEN',
      message: 'O arquivo declara DTD ou entidade (<!DOCTYPE/<!ENTITY): mensagens TISS não usam DTD e o arquivo é recusado.',
    });
  }
  if (PROCESSING_INSTRUCTION.test(text)) {
    problems.push({
      code: 'PROCESSING_INSTRUCTION_FORBIDDEN',
      message: 'O arquivo tem instrução de processamento além da declaração XML.',
    });
  }
  if (text.includes(XINCLUDE)) {
    problems.push({ code: 'XINCLUDE_FORBIDDEN', message: 'O arquivo usa XInclude, que não é aceito.' });
  }
  if (problems.length > 0) return problems;

  const root = ROOT.exec(text);
  const prefix = root?.[2] ? root[1]! : null;
  const local = root ? (root[2] ?? root[1]!) : null;
  if (local !== 'mensagemTISS') {
    return [{ code: 'ROOT_ELEMENT', message: 'O elemento raiz não é mensagemTISS.' }];
  }
  const attrs = root?.[3] ?? '';
  const nsAttr = prefix ? `xmlns:${prefix}` : 'xmlns';
  const ns = new RegExp(`(?:^|\\s)${escapeName(nsAttr)}\\s*=\\s*["']([^"']*)["']`, 'u').exec(attrs)?.[1];
  if (ns !== TISS_NAMESPACE) {
    problems.push({
      code: 'NAMESPACE',
      message: `A raiz mensagemTISS não está no namespace oficial da ANS (${TISS_NAMESPACE}).`,
    });
  }
  const tag = prefix ? `${prefix}:Padrao` : 'Padrao';
  const version = new RegExp(`<${escapeName(tag)}>\\s*([^<]{0,20}?)\\s*</${escapeName(tag)}>`, 'u').exec(text)?.[1];
  if (!version) {
    problems.push({ code: 'VERSION_MISSING', message: 'O cabeçalho não informa a versão do Padrão TISS.' });
  } else if (version !== expected.version) {
    problems.push({
      code: 'VERSION_UNSUPPORTED',
      message: `O arquivo declara a versão ${version.replace(/[^\d.]/gu, '')} do Padrão TISS; o validador do Qoro carrega a ${expected.version}.`,
    });
  }
  return problems;
}
