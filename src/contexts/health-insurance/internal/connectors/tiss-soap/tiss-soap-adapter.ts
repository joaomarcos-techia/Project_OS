/**
 * P6.5 — `TissSoapAdapter`: o transporte eletrônico genérico do webservice TISS 4.03.00 para
 * as 7 operações da porta (`OperatorConnector`). Ele entra no registro de homologados
 * (`resolve-connector.ts`) SÓ depois da homologação com cada operadora (B5); até lá o registro
 * de produção é vazio e tudo segue manual. Estado máximo sem operadora: "Testado" (contra o
 * stub que valida o envelope no XSD oficial).
 *
 * Garantias:
 *   - nada sai sem passar no XSD do webservice; mensagem de outra operadora ou de outra
 *     transação é recusada antes da rede (erro para quem chama, nunca "enviado");
 *   - a credencial vem do provedor injetado (módulo de credenciais, P12.5) e só existe no pedido
 *     em memória: nenhum resultado, erro ou recibo a contém;
 *   - endereço só HTTPS, sem usuário/senha na URL e sem seguir redirecionamento; HTTP em loopback
 *     só com `allowLoopbackHttp` explícito (o stub dos testes), nunca numa configuração de operadora;
 *   - tempo, retentativa e circuito por operadora vêm do contrato da P2.5 (`createConnector`):
 *     consultas repetem; envios (lote, solicitação, recurso) só se a operadora deduplica;
 *   - a resposta só vira `accepted`/`rejected` depois de: envelope legível, elemento esperado,
 *     namespace da ANS, XSD oficial, hash conferido e origem igual ao registro ANS da operadora.
 *     Qualquer coisa fora disso é `unavailable` (`invalid_response`): sem estado falso, e a tela
 *     manda conferir no portal antes de reenviar.
 */
import { createHash } from 'node:crypto';

import {
  createConnector,
  DEFAULT_CONNECTOR_OPTIONS,
  type CircuitOptions,
  type ConnectorOutcome,
  type ConnectorRequest,
} from '../../../tiss/connector/connector';
import { child, textAt, type XmlNode } from '../../../tiss/xml/reader';
import type { TissXsdEngine } from '../../../tiss/xml/xsd-engine';
import { OPERATOR_OPERATIONS, type OperatorOperation, type OperatorRequest } from '../operator-connector';
import type { HomologatedTransport } from '../resolve-connector';
import { TISS_FAULTS, TISS_WS_OPERATIONS } from './operations';
import {
  buildWsRequest,
  firstText,
  parseSoapResponse,
  tissWsHash,
  TissSoapRequestError,
  type SoapVersion,
} from './ws-message';

export interface TissSoapConfig {
  /** Identificador do adaptador (resultado e tela), ex.: `tiss-soap:<registroANS>`. */
  id: string;
  insurerId: string;
  /** Registro ANS da operadora: destino dos pedidos e origem obrigatória das respostas. */
  registroANS: string;
  /** Endereço de cada serviço homologado, do WSDL da operadora. Operação sem endereço segue manual. */
  endpoints: Partial<Record<OperatorOperation, string>>;
  /** SOAPAction de cada serviço, como no WSDL da operadora (sem valor: vazio). */
  soapActions?: Partial<Record<OperatorOperation, string>>;
  soapVersion: SoapVersion;
  /** Como a senha vai em `senhaPrestador`, conforme o manual da operadora (confirmado na homologação). */
  passwordEncoding: 'md5_hex' | 'plain';
  /** A operadora deduplica envios repetidos? Só então lote, solicitação e recurso são repetidos após falha. */
  deduplicatesSubmissions: boolean;
  timeoutMs?: number;
  retries?: number;
  circuit?: CircuitOptions;
  /** Maior resposta aceita (padrão 16 MiB). */
  maxResponseBytes?: number;
  /** Só para o stub local dos testes: aceita `http://127.0.0.1`. Configuração de operadora nunca liga. */
  allowLoopbackHttp?: boolean;
}

export interface TissSoapCredential {
  login: string;
  password: string;
}

export interface TissSoapDeps {
  /** Credencial ativa da clínica nesta operadora (P12.5); `null` sem credencial. */
  credentials(): Promise<TissSoapCredential | null>;
  /** Motor XSD do webservice (`getTissWsXsdEngine()`). */
  xsd: TissXsdEngine;
  fetch?: typeof fetch;
  now?: () => number;
}

export class TissSoapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TissSoapConfigError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function checkEndpoint(raw: string, allowLoopbackHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TissSoapConfigError('endereço de webservice inválido');
  }
  if (url.username || url.password) throw new TissSoapConfigError('endereço de webservice com usuário ou senha embutidos');
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new TissSoapConfigError('o webservice da operadora precisa de HTTPS');
  }
  return url;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function nodeAt(n: XmlNode | undefined, path: string): XmlNode | undefined {
  let cur = n;
  for (const part of path.split('/')) cur = child(cur, part);
  return cur;
}
const INVALID: ConnectorOutcome = { kind: 'unavailable', reason: 'invalid_response' };

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) return null;
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export function createTissSoapTransport(config: TissSoapConfig, deps: TissSoapDeps): HomologatedTransport {
  const endpoints = new Map<OperatorOperation, URL>();
  for (const op of OPERATOR_OPERATIONS) {
    const raw = config.endpoints[op];
    if (raw) endpoints.set(op, checkEndpoint(raw, config.allowLoopbackHttp === true));
  }
  if (endpoints.size === 0) throw new TissSoapConfigError('nenhuma operação com endereço homologado');
  if (!/^\d{6}$/u.test(config.registroANS)) throw new TissSoapConfigError('registro ANS da operadora inválido');
  const doFetch = deps.fetch ?? fetch;
  const maxResponseBytes = config.maxResponseBytes ?? 16 * 1024 * 1024;
  // Por pedido: o que conferir na resposta (lote enviado). Nunca guarda o envelope.
  const pending = new WeakMap<ConnectorRequest, { operation: OperatorOperation; numeroLote: string | null }>();

  async function interpret(
    operation: OperatorOperation,
    expectedLote: string | null,
    status: number,
    bytes: Uint8Array,
  ): Promise<ConnectorOutcome> {
    const op = TISS_WS_OPERATIONS[operation];
    const parsed = parseSoapResponse(bytes, config.soapVersion);
    if (parsed.kind === 'invalid') return status >= 500 ? { kind: 'unavailable', reason: 'server_error' } : INVALID;
    if (parsed.kind === 'fault') {
      if (!parsed.fault || parsed.fault === 'ErroInesperadoServidor') return { kind: 'unavailable', reason: 'server_error' };
      return { kind: 'rejected', code: parsed.fault, message: TISS_FAULTS[parsed.fault] };
    }
    if (status < 200 || status >= 300) return { kind: 'unavailable', reason: 'server_error' };
    const el = parsed.element;
    if (el.name !== op.response.element) return INVALID;
    let validation;
    try {
      validation = await deps.xsd.validate({ bytes: parsed.document });
    } catch {
      // Validador indisponível: a resposta não pôde ser conferida (nunca vira aceita).
      return INVALID;
    }
    if (!validation.valid) return INVALID;
    if (textAt(el, 'hash')?.toLowerCase() !== tissWsHash(el)) return INVALID;
    const cab = child(el, 'cabecalho');
    if (textAt(cab, 'origem/registroANS') !== config.registroANS) return INVALID;
    const receipt = { element: el.name, xml: new Uint8Array(parsed.document), sha256: sha256(parsed.document) };
    const falha = textAt(cab, 'falhaNegocio');
    if (falha) return { kind: 'rejected', code: falha, message: `A operadora recusou a transação (código ${falha}).`, receipt };
    const content = child(el, op.response.content);
    const choice = content?.children[0];
    if (!content || !choice) return INVALID;
    const nested = op.nestedErrorPath ? nodeAt(content, op.nestedErrorPath) : undefined;
    const refusal = op.errorChoices.includes(choice.name) ? choice : nested;
    if (refusal) {
      const code = textAt(refusal, 'codigoGlosa') ?? 'sem código';
      const description = textAt(refusal, 'descricaoGlosa');
      return {
        kind: 'rejected',
        code,
        message: description ?? `A operadora recusou o pedido (código ${code}).`,
        receipt,
      };
    }
    if (expectedLote !== null && (operation === 'submit_batch' || operation === 'submit_appeal')) {
      // O protocolo tem de ser do lote que saiu: recibo de outro lote não confirma nada.
      if (firstText(choice, 'numeroLote') !== expectedLote) return INVALID;
    }
    const protocol = op.protocolPath
      ? textAt(content, op.protocolPath)
      : textAt(cab, 'identificacaoTransacao/sequencialTransacao');
    if (!protocol) return INVALID;
    return { kind: 'accepted', protocol, receipt };
  }

  const connector = createConnector({
    ...DEFAULT_CONNECTOR_OPTIONS,
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.retries !== undefined ? { retries: config.retries } : {}),
    ...(config.circuit ? { circuit: config.circuit } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    transport: {
      idempotent: false,
      isIdempotent(request) {
        const op = TISS_WS_OPERATIONS[request.operation as OperatorOperation];
        return Boolean(op && (op.query || config.deduplicatesSubmissions));
      },
      async send(request, signal) {
        const meta = pending.get(request);
        if (!meta) return { kind: 'not_configured' };
        const url = endpoints.get(meta.operation)!;
        const action = config.soapActions?.[meta.operation] ?? '';
        const headers: Record<string, string> =
          config.soapVersion === '1.1'
            ? { 'Content-Type': 'text/xml; charset=ISO-8859-1', SOAPAction: `"${action}"` }
            : { 'Content-Type': `application/soap+xml; charset=ISO-8859-1${action ? `; action="${action}"` : ''}` };
        const res = await doFetch(url, {
          method: 'POST',
          headers,
          body: new Uint8Array(request.xml),
          signal,
          redirect: 'error',
        });
        const bytes = await readCapped(res, maxResponseBytes);
        if (bytes === null) return INVALID;
        return interpret(meta.operation, meta.numeroLote, res.status, bytes);
      },
    },
  });

  return {
    id: config.id,
    operations: new Set(endpoints.keys()),
    async submit(request: OperatorRequest): Promise<ConnectorOutcome> {
      if (request.insurerId !== config.insurerId) {
        throw new TissSoapRequestError('WRONG_OPERATOR', 'pedido de outra operadora neste adaptador');
      }
      const op = TISS_WS_OPERATIONS[request.operation];
      if (!endpoints.has(request.operation)) return { kind: 'not_configured' };
      if (!request.xml) {
        throw new TissSoapRequestError('MISSING_CONTENT', `a operação ${request.operation} exige a mensagemTISS validada`);
      }
      const credential = await deps.credentials();
      if (!credential) return { kind: 'not_configured' };
      const senhaPrestador =
        config.passwordEncoding === 'md5_hex'
          ? createHash('md5').update(Buffer.from(credential.password, 'latin1')).digest('hex')
          : credential.password;
      const built = buildWsRequest({
        mensagem: request.xml,
        operation: op,
        registroANS: config.registroANS,
        login: credential.login,
        senhaPrestador,
        soapVersion: config.soapVersion,
      });
      const validation = await deps.xsd.validate({ bytes: built.document });
      if (!validation.valid) {
        // Mensagens do motor já mascaram valores; a senha nunca aparece.
        throw new TissSoapRequestError('XSD', `o pedido não passa no XSD do webservice: ${validation.errors.slice(0, 3).join('; ')}`);
      }
      const connectorRequest: ConnectorRequest = {
        insurerId: request.insurerId,
        operation: request.operation,
        xml: built.envelope,
        idempotencyKey: request.idempotencyKey,
      };
      pending.set(connectorRequest, { operation: request.operation, numeroLote: built.numeroLote });
      return connector.submit(connectorRequest);
    },
  };
}

