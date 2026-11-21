/**
 * P6.5 — operadora STUB do webservice TISS 4.03.00, só para testes: nenhum código do app a importa
 * (gate em `tiss-soap.test.ts`), então ela nunca entra no bundle.
 *
 * Servidor HTTP local (127.0.0.1, porta livre) que se comporta como o webservice de uma
 * operadora, com dados sintéticos:
 *   - lê o envelope SOAP com o mesmo leitor estrito do adaptador;
 *   - VALIDA o elemento `*WS` recebido no XSD oficial do webservice (motor do app) e confere
 *     hash, login/senha, destino (registro ANS) e versão, respondendo `tissFault` como o padrão
 *     manda (`SchemaInvalido`, `HashInvalido`, `LoginInvalido`, `DestinatarioInvalido`);
 *   - responde cada operação com a mensagem de resposta do padrão, também válida no XSD, ou com
 *     o comportamento pedido pelo teste (recusa de negócio, falha, demora, hash errado, outra
 *     operadora, fora do XSD, lote trocado, DTD).
 * Registra o que recebeu (elemento, resultado das conferências) — nunca a senha.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { child, textAt, type XmlNode } from '../../../tiss/xml/reader';
import type { TissXsdEngine } from '../../../tiss/xml/xsd-engine';
import { TISS_WS_OPERATIONS, type TissFault } from './operations';
import { canonicalWsDocument, firstText, parseSoapResponse, SOAP_ENVELOPE_NS, tissWsHash, type SoapVersion } from './ws-message';

export type StubMode =
  | 'accept'
  | 'business_error'
  | 'http500'
  | 'bad_hash'
  | 'wrong_operator'
  | 'off_schema'
  | 'other_lote'
  | 'dtd'
  | { fault: TissFault }
  | { delayMs: number };

export interface StubReceived {
  element: string;
  xsdValid: boolean;
  xsdErrors: string[];
  hashOk: boolean;
  loginOk: boolean;
  destinationOk: boolean;
  soapAction: string | null;
  contentType: string | null;
  /** A senha em claro apareceu no envelope? (o teste exige `false` com `md5_hex`) */
  plainPasswordSeen: boolean;
}

export interface StubOperator {
  url: string;
  received: StubReceived[];
  setMode(mode: StubMode): void;
  close(): Promise<void>;
}

export interface StubOperatorOptions {
  registroANS: string;
  login: string;
  /** O que deve chegar em `senhaPrestador` (já codificado como a operadora pede). */
  senhaPrestador: string;
  /** Senha em claro, só para conferir que ela NÃO trafega quando a codificação é MD5. */
  plainPassword?: string;
  soapVersion: SoapVersion;
  xsd: TissXsdEngine;
}

const leaf = (name: string, text: string): XmlNode => ({ name, children: [], text });
const el = (name: string, children: XmlNode[]): XmlNode => ({ name, children, text: '' });

const RESPONSE_TRANSACTION: Record<string, string> = {
  protocoloRecebimentoWS: 'PROTOCOLO_RECEBIMENTO',
  autorizacaoProcedimentoWS: 'RESPOSTA_SOLICITACAO',
  situacaoAutorizacaoWS: 'STATUS_AUTORIZACAO',
  respostaElegibilidadeWS: 'SITUACAO_ELEGIBILIDADE',
  situacaoProtocoloWS: 'SITUACAO_PROTOCOLO',
  demonstrativoRetornoWS: 'DEMONSTRATIVO_ANALISE_CONTA',
  protocoloRecebimentoRecursoWS: 'RECEBIMENTO_RECURSO_GLOSA',
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > 16 * 1024 * 1024) throw new Error('corpo grande demais');
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

export async function startStubOperator(opts: StubOperatorOptions): Promise<StubOperator> {
  let mode: StubMode = 'accept';
  let seq = 0;
  const received: StubReceived[] = [];
  const envNs = SOAP_ENVELOPE_NS[opts.soapVersion];

  const soap = (inner: string) =>
    Buffer.from(
      `<?xml version="1.0" encoding="ISO-8859-1"?><soapenv:Envelope xmlns:soapenv="${envNs}"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`,
      'latin1',
    );
  const fault = (value: TissFault) =>
    soap(
      `<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>${value}</faultstring><detail><ans:tissFaultWS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:tissFault>${value}</ans:tissFault></ans:tissFaultWS></detail></soapenv:Fault>`,
    );
  const strip = (doc: Buffer) => doc.toString('latin1').replace(/^<\?xml[^?]*\?>/u, '');

  function responseFor(request: XmlNode, opName: keyof typeof TISS_WS_OPERATIONS): XmlNode {
    const op = TISS_WS_OPERATIONS[opName];
    seq += 1;
    const cab = child(request, 'cabecalho');
    const prestador = child(child(cab, 'origem'), 'identificacaoPrestador')?.children[0] ?? leaf('codigoPrestadorNaOperadora', '0');
    const registro = mode === 'wrong_operator' ? '999999' : opts.registroANS;
    const header = el('cabecalho', [
      el('identificacaoTransacao', [
        leaf('tipoTransacao', RESPONSE_TRANSACTION[op.response.element]!),
        leaf('sequencialTransacao', `OP${seq}`),
        leaf('dataRegistroTransacao', '2026-11-19'),
        leaf('horaRegistroTransacao', '10:00:00'),
      ]),
      el('origem', [leaf('registroANS', registro)]),
      el('destino', [el('identificacaoPrestador', [leaf(prestador.name, prestador.text)])]),
      leaf('Padrao', '4.03.00'),
    ]);
    const contratado = el('dadosPrestador', [leaf('codigoPrestadorNaOperadora', prestador.text.slice(0, 14))]);
    const content = child(request, op.request.content);
    const carteira = firstText(content, 'numeroCarteira') ?? '000000000000';
    const beneficiario = el('dadosBeneficiario', [leaf('numeroCarteira', carteira), leaf('atendimentoRN', 'N')]);
    const guiaPrestador = firstText(content, 'numeroGuiaPrestador') ?? 'G1';
    const lote = mode === 'other_lote' ? 'OUTRO' : (firstText(content, 'numeroLote') ?? '1');
    let choice: XmlNode;
    if (mode === 'business_error') {
      const errorName = op.errorChoices[op.errorChoices.length - 1]!;
      choice = el(errorName, [leaf('codigoGlosa', '1001'), leaf('descricaoGlosa', 'NUMERO DA CARTEIRA INVALIDO')]);
    } else {
      switch (opName) {
        case 'submit_batch':
          choice = el('protocoloRecebimento', [
            leaf('registroANS', registro),
            contratado,
            leaf('numeroLote', lote),
            leaf('dataEnvioLote', '2026-11-19'),
            el('detalheProtocolo', [
              leaf('numeroProtocolo', `PROT${seq}`),
              leaf('valorTotalProtocolo', '0.00'),
              el('dadosGuiasProtocolo', [el('dadosGuias', [leaf('numeroGuiaPrestador', guiaPrestador), beneficiario])]),
            ]),
          ]);
          break;
        case 'request_authorization':
        case 'authorization_status':
          choice = el('autorizacaoServico', [
            el('dadosAutorizacao', [leaf('numeroGuiaPrestador', guiaPrestador), leaf('numeroGuiaOperadora', `GOP${seq}`)]),
            leaf('tipoEtapaAutorizacao', '1'),
            beneficiario,
            leaf('nomeBeneficiario', 'BENEFICIARIO SINTETICO'),
            leaf('statusSolicitacao', '2'),
          ]);
          break;
        case 'eligibility':
          choice = el('reciboElegibilidade', [
            leaf('registroANS', registro),
            leaf('numeroCarteira', carteira),
            leaf('nomeBeneficiario', 'BENEFICIARIO SINTETICO'),
            leaf('respostaSolicitacao', 'S'),
          ]);
          break;
        case 'protocol_status':
          choice = el('situacaoDoProtocolo', [
            leaf('identificacaoOperadora', registro),
            contratado,
            el('lote', [
              el('detalheLote', [
                leaf('statusProtocolo', '1'),
                leaf('numeroProtocolo', firstText(content, 'numeroProtocolo') ?? 'P1'),
                leaf('numeroLote', '1'),
                leaf('dataEnvioLote', '2026-11-19'),
                el('valorTotalLote', [leaf('valorProcessado', '0.00'), leaf('valorGlosa', '0.00'), leaf('valorLiberado', '0.00')]),
                el('guiasTISS', [el('guiasMedicas', [el('guias', [leaf('numeroGuiaPrestador', 'G1'), beneficiario])])]),
              ]),
            ]),
          ]);
          break;
        case 'statement':
          choice = el('situacaoDemonstrativoRetorno', [
            leaf('identificacaoOperadora', registro),
            contratado,
            leaf('numeroProtocolo', `DEM${seq}`),
            leaf('protocoloSolicitacaoDemonstrativo', `SOL${seq}`),
            leaf('tipoDemonstrativo', '1'),
            leaf('dataSituacaoDemonstrativo', '2026-11-19'),
            leaf('situacaoDemonstrativo', '1'),
          ]);
          break;
        case 'submit_appeal':
          choice = el('protocoloRecebimento', [
            leaf('nrProtocoloRecursoGlosa', `REC${seq}`),
            leaf('dataEnvioRecurso', '2026-11-19'),
            leaf('dataRecebimentoRecurso', '2026-11-19'),
            leaf('numeroLote', lote),
            leaf('registroANS', registro),
            contratado,
            leaf('nrProtocoloRecursado', firstText(content, 'numeroProtocolo') ?? '1'),
            leaf('valorTotalRecursado', '0.00'),
          ]);
          break;
      }
    }
    const body = [header, el(op.response.content, [choice])];
    if (mode === 'off_schema') body.push(leaf('campoForaDoPadrao', 'x'));
    const unsigned = el(op.response.element, body);
    const hash = mode === 'bad_hash' ? '0'.repeat(32) : tissWsHash(unsigned);
    return el(op.response.element, [...body, leaf('hash', hash)]);
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: Buffer) => {
        res.writeHead(status, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(body);
      };
      try {
        const bytes = await readBody(req);
        const parsed = parseSoapResponse(bytes, opts.soapVersion);
        if (parsed.kind !== 'element') return send(500, fault('SchemaInvalido'));
        const request = parsed.element;
        const opName = (Object.keys(TISS_WS_OPERATIONS) as Array<keyof typeof TISS_WS_OPERATIONS>).find(
          (k) => TISS_WS_OPERATIONS[k].request.element === request.name,
        );
        const validation = await opts.xsd.validate({ bytes: canonicalWsDocument(request) });
        const cab = child(request, 'cabecalho');
        const entry: StubReceived = {
          element: request.name,
          xsdValid: validation.valid,
          xsdErrors: validation.errors,
          hashOk: textAt(request, 'hash') === tissWsHash(request),
          loginOk:
            textAt(cab, 'loginSenhaPrestador/loginPrestador') === opts.login &&
            textAt(cab, 'loginSenhaPrestador/senhaPrestador') === opts.senhaPrestador,
          destinationOk: textAt(cab, 'destino/registroANS') === opts.registroANS,
          soapAction: (req.headers.soapaction as string | undefined) ?? null,
          contentType: req.headers['content-type'] ?? null,
          plainPasswordSeen: Boolean(opts.plainPassword && bytes.toString('latin1').includes(opts.plainPassword)),
        };
        received.push(entry);
        if (!opName || !entry.xsdValid) return send(500, fault('SchemaInvalido'));
        if (!entry.hashOk) return send(500, fault('HashInvalido'));
        if (!entry.loginOk) return send(500, fault('LoginInvalido'));
        if (!entry.destinationOk) return send(500, fault('DestinatarioInvalido'));
        const current = mode;
        if (typeof current === 'object' && 'delayMs' in current) await new Promise((r) => setTimeout(r, current.delayMs));
        if (typeof current === 'object' && 'fault' in current) return send(500, fault(current.fault));
        if (mode === 'http500') return send(500, Buffer.from('erro interno', 'latin1'));
        if (mode === 'dtd') {
          return send(200, Buffer.from(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><soapenv:Envelope xmlns:soapenv="${envNs}"><soapenv:Body>&e;</soapenv:Body></soapenv:Envelope>`, 'latin1'));
        }
        send(200, soap(strip(canonicalWsDocument(responseFor(request, opName)))));
      } catch {
        if (!res.headersSent) send(500, fault('ErroInesperadoServidor'));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/tiss`,
    received,
    setMode(m) {
      mode = m;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
