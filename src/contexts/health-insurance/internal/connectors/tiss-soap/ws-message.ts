/**
 * P6.5 — montagem e leitura das mensagens do webservice TISS 4.03.00, sem rede.
 *
 * PEDIDO: parte da `mensagemTISS` que o Qoro já gerou e validou (lote, solicitação, recurso,
 * consultas) e monta o elemento `*WS` do `tissWebServicesV4_03_00.xsd`:
 *   - o MESMO cabeçalho, com `loginSenhaPrestador` (credencial da clínica) no fim dele;
 *   - o conteúdo de `prestadorParaOperadora`, com o nome que o webservice usa;
 *   - o `hash` recalculado (mesma regra do epílogo: MD5 dos valores em ISO-8859-1, sem o
 *     próprio hash), porque o login entra no conteúdo;
 *   - o envelope SOAP (1.1 ou 1.2, conforme o WSDL da operadora).
 * O pedido só sai depois de passar no XSD do webservice (quem chama valida).
 *
 * RESPOSTA: lê o envelope com o leitor estrito (sem DTD, entidade, XInclude ou instrução de
 * processamento; limites de tamanho e profundidade), separa falha SOAP (`tissFault`) do
 * elemento de resposta, confere o namespace da ANS, regrava o elemento num documento canônico
 * (o que vai para o XSD e para o recibo) e confere o hash.
 *
 * Nada aqui guarda, registra ou devolve a senha: ela só existe no pedido em memória.
 */
import { createHash } from 'node:crypto';

import { child, readTissXml, type XmlNode } from '../../../tiss/xml/reader';
import { TISS_NAMESPACE } from '../../../tiss/xml/tree';
import { TISS_FAULTS, type TissFault, type TissWsOperation } from './operations';

export const SOAP_ENVELOPE_NS = {
  '1.1': 'http://schemas.xmlsoap.org/soap/envelope/',
  '1.2': 'http://www.w3.org/2003/05/soap-envelope',
} as const;
export type SoapVersion = keyof typeof SOAP_ENVELOPE_NS;

/** Erro de MONTAGEM do pedido (nada foi transmitido). A mensagem nunca traz valor de campo. */
export class TissSoapRequestError extends Error {
  constructor(
    readonly code:
      | 'NOT_TISS_MESSAGE'
      | 'WRONG_TRANSACTION'
      | 'WRONG_OPERATOR'
      | 'MISSING_CONTENT'
      | 'UNSUPPORTED_VERSION'
      | 'INVALID_LOGIN'
      | 'XSD',
    message: string,
  ) {
    super(message);
    this.name = 'TissSoapRequestError';
  }
}

const SKIP_IN_HASH = new Set(['hash', 'Signature', 'Signatures']);

/** Valores das folhas em ordem de documento (a regra do hash TISS), pulando hash e assinatura. */
export function leafValues(n: XmlNode): string[] {
  if (SKIP_IN_HASH.has(n.name)) return [];
  if (n.children.length === 0) return n.text === '' ? [] : [n.text];
  return n.children.flatMap(leafValues);
}

export function tissWsHash(n: XmlNode): string {
  return createHash('md5').update(Buffer.from(leafValues(n).join(''), 'latin1')).digest('hex');
}

const escapeText = (t: string) => t.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

function assertLatin1(text: string): void {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0xff) {
      throw new TissSoapRequestError('INVALID_LOGIN', 'caractere fora do ISO-8859-1 na mensagem do webservice');
    }
  }
}

/** Serializa com o prefixo `ans`, preservando elemento vazio (o leitor e o XSD veem o mesmo). */
function serializeNode(n: XmlNode, out: string[]): void {
  if (n.children.length === 0) {
    assertLatin1(n.text);
    out.push(`<ans:${n.name}>${escapeText(n.text)}</ans:${n.name}>`);
    return;
  }
  out.push(`<ans:${n.name}>`);
  for (const c of n.children) serializeNode(c, out);
  out.push(`</ans:${n.name}>`);
}

/** Documento canônico ISO-8859-1 de um elemento TISS (namespace da ANS na raiz). */
export function canonicalWsDocument(root: XmlNode): Buffer {
  const out: string[] = [];
  serializeNode(root, out);
  const body = out.join('');
  const open = `<ans:${root.name}>`;
  const xml =
    `<?xml version="1.0" encoding="ISO-8859-1"?><ans:${root.name} xmlns:ans="${TISS_NAMESPACE}">` +
    body.slice(open.length);
  return Buffer.from(xml, 'latin1');
}

const leafNode = (name: string, text: string): XmlNode => ({ name, children: [], text });
const elementNode = (name: string, children: XmlNode[]): XmlNode => ({ name, children, text: '' });

export interface WsRequest {
  /** Elemento `*WS` (árvore), com o hash. */
  element: XmlNode;
  /** Documento canônico do elemento (o que passa no XSD do webservice). */
  document: Buffer;
  /** Envelope SOAP pronto para o POST. Contém a senha: nunca registrar. */
  envelope: Buffer;
  /** Para conferir a resposta: número do lote/recurso do prestador, quando houver. */
  numeroLote: string | null;
}

export function buildWsRequest(args: {
  mensagem: Uint8Array;
  operation: TissWsOperation;
  registroANS: string;
  login: string;
  senhaPrestador: string;
  soapVersion: SoapVersion;
}): WsRequest {
  let root: XmlNode;
  try {
    root = readTissXml(args.mensagem);
  } catch {
    throw new TissSoapRequestError('NOT_TISS_MESSAGE', 'o XML de entrada não é uma mensagem TISS legível');
  }
  if (root.name !== 'mensagemTISS') {
    throw new TissSoapRequestError('NOT_TISS_MESSAGE', 'o XML de entrada não é uma mensagemTISS');
  }
  const cabecalho = child(root, 'cabecalho');
  const tipo = child(child(cabecalho, 'identificacaoTransacao'), 'tipoTransacao')?.text.trim();
  if (tipo !== args.operation.tipoTransacao) {
    throw new TissSoapRequestError(
      'WRONG_TRANSACTION',
      `a mensagem é de outra transação (esperado ${args.operation.tipoTransacao})`,
    );
  }
  if (child(cabecalho, 'Padrao')?.text.trim() !== '4.03.00') {
    throw new TissSoapRequestError('UNSUPPORTED_VERSION', 'o webservice homologado é o da versão 4.03.00');
  }
  if (child(child(cabecalho, 'destino'), 'registroANS')?.text.trim() !== args.registroANS) {
    // Mensagem de uma operadora pelo adaptador de outra: nada sai.
    throw new TissSoapRequestError('WRONG_OPERATOR', 'a mensagem é destinada a outra operadora');
  }
  const contents = child(root, 'prestadorParaOperadora')?.children ?? [];
  const source = contents.length === 1 && contents[0]!.name === args.operation.source ? contents[0]! : null;
  if (!source) {
    throw new TissSoapRequestError('MISSING_CONTENT', `a mensagem não traz ${args.operation.source}`);
  }
  if (!args.login || args.login.length > 20 || !args.senhaPrestador || args.senhaPrestador.length > 32) {
    // `st_texto20` e `st_texto32`: fora disso a operadora recusaria no XSD.
    throw new TissSoapRequestError('INVALID_LOGIN', 'o login da operadora não cabe no cabeçalho TISS');
  }
  const header = elementNode('cabecalho', [
    ...cabecalho!.children.filter((c) => c.name !== 'loginSenhaPrestador'),
    elementNode('loginSenhaPrestador', [
      leafNode('loginPrestador', args.login),
      leafNode('senhaPrestador', args.senhaPrestador),
    ]),
  ]);
  const content = elementNode(args.operation.request.content, source.children);
  const unsigned = elementNode(args.operation.request.element, [header, content]);
  const element = elementNode(args.operation.request.element, [
    header,
    content,
    leafNode('hash', tissWsHash(unsigned)),
  ]);
  const document = canonicalWsDocument(element);
  const inner = document.toString('latin1').replace(/^<\?xml[^?]*\?>/u, '');
  const ns = SOAP_ENVELOPE_NS[args.soapVersion];
  const envelope = Buffer.from(
    `<?xml version="1.0" encoding="ISO-8859-1"?><soapenv:Envelope xmlns:soapenv="${ns}"><soapenv:Header/><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`,
    'latin1',
  );
  return { element, document, envelope, numeroLote: firstText(source, 'numeroLote') };
}

/** Primeiro texto de um elemento com este nome na subárvore. */
export function firstText(n: XmlNode | undefined, name: string): string | null {
  if (!n) return null;
  if (n.name === name && n.children.length === 0) return n.text.trim();
  for (const c of n.children) {
    const t = firstText(c, name);
    if (t !== null) return t;
  }
  return null;
}

export type ParsedSoapResponse =
  /** Falha SOAP; `fault` é o `tissFault` quando a operadora informa um valor do padrão. */
  | { kind: 'fault'; fault: TissFault | null }
  /** Elemento de resposta do webservice, regravado em documento canônico para XSD e recibo. */
  | { kind: 'element'; element: XmlNode; document: Buffer }
  /** Algo que não é resposta TISS legível (motivo curto, sem conteúdo). */
  | { kind: 'invalid'; reason: string };

function findNode(n: XmlNode, name: string): XmlNode | null {
  if (n.name === name) return n;
  for (const c of n.children) {
    const f = findNode(c, name);
    if (f) return f;
  }
  return null;
}

/** O prefixo do elemento está ligado ao namespace da ANS em algum ponto antes dele? */
function boundToTissNamespace(text: string, localName: string): boolean {
  const open = new RegExp(`<(?:([A-Za-z_][\\w.-]*):)?${localName}[\\s>/]`, 'u').exec(text);
  if (!open) return false;
  const prefix = open[1];
  const upTo = text.slice(0, open.index + open[0].length + 2048);
  const ns = TISS_NAMESPACE.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  const decl = prefix ? new RegExp(`xmlns:${prefix}\\s*=\\s*["']${ns}["']`, 'u') : new RegExp(`xmlns\\s*=\\s*["']${ns}["']`, 'u');
  return decl.test(upTo);
}

export function parseSoapResponse(bytes: Uint8Array, soapVersion: SoapVersion): ParsedSoapResponse {
  let root: XmlNode;
  try {
    root = readTissXml(bytes);
  } catch {
    return { kind: 'invalid', reason: 'resposta não é XML legível ou usa construção proibida' };
  }
  const text = Buffer.from(bytes).toString('latin1');
  if (root.name !== 'Envelope' || !text.includes(SOAP_ENVELOPE_NS[soapVersion])) {
    return { kind: 'invalid', reason: 'resposta sem envelope SOAP da versão configurada' };
  }
  const body = child(root, 'Body');
  const first = body?.children[0];
  if (!body || body.children.length !== 1 || !first) {
    return { kind: 'invalid', reason: 'envelope SOAP sem um único elemento no corpo' };
  }
  if (first.name === 'Fault' || first.name === 'tissFaultWS') {
    const value = findNode(first, 'tissFault')?.text.trim() ?? null;
    return { kind: 'fault', fault: value && value in TISS_FAULTS ? (value as TissFault) : null };
  }
  if (!boundToTissNamespace(text, first.name)) {
    return { kind: 'invalid', reason: 'elemento de resposta fora do namespace da ANS' };
  }
  try {
    return { kind: 'element', element: first, document: canonicalWsDocument(first) };
  } catch {
    return { kind: 'invalid', reason: 'resposta com caractere fora do ISO-8859-1' };
  }
}
