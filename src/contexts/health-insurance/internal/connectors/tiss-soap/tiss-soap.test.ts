/**
 * P6.5 — `TissSoapAdapter` contra a operadora STUB, com o XSD oficial do webservice (motor do
 * app, xmllint-wasm) dos dois lados. Sem operadora real: o teto é "Testado".
 *
 * Fora do CI, o pacote pode vir de uma instalação isolada: `TISS_XMLLINT_WASM_DIR=<pasta>`.
 */
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { corpusScenarios } from '../../../tiss/corpus/scenarios';
import { C2_SCENARIOS } from '../../../tiss/corpus/scenarios-c2';
import { SYNTHETIC } from '../../../tiss/corpus/fixtures';
import {
  buildSolicitacaoDemonstrativoMessage,
  buildStatusAutorizacaoMessage,
  buildStatusProtocoloMessage,
  buildVerificaElegibilidadeMessage,
  type ContractedProvider,
} from '../../../tiss/messages/consultas-operadora';
import type { PrestadorMessageHeader } from '../../../tiss/messages/prestador-message';
import { readTissXml } from '../../../tiss/xml/reader';
import { createTissXsdEngine, TISS_WS_ELEMENTS, TISS_WS_ENTRYPOINT } from '../../../tiss/xml/xsd-engine';
import type { OperatorOperation } from '../operator-connector';
import { resolveOperatorConnector } from '../resolve-connector';
import { TISS_WS_OPERATIONS } from './operations';
import { startStubOperator, type StubOperator } from './stub-operator';
import { isBlockedAddress } from './guarded-post';
import { createTissSoapTransport, TissSoapConfigError, type TissSoapConfig } from './tiss-soap-adapter';
import { buildWsRequest, parseSoapResponse, tissWsHash, TissSoapRequestError } from './ws-message';

const mensagemXsd = createTissXsdEngine();
const wsXsd = createTissXsdEngine({ entrypoint: TISS_WS_ENTRYPOINT, rootElements: TISS_WS_ELEMENTS });

const LOGIN = 'clinica-sintetica';
const PASSWORD = 'senha-sintetica-123';
const MD5 = createHash('md5').update(PASSWORD, 'latin1').digest('hex');
const INSURER = '00000000-0000-4000-8000-000000000001';

const HEADER: PrestadorMessageHeader = {
  padrao: '4.03.00',
  sequencialTransacao: '7',
  dataRegistro: '2026-11-19',
  horaRegistro: '10:00:00',
  origem: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
  registroANSDestino: SYNTHETIC.registroANS,
};
const PRESTADOR: ContractedProvider = { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode };

const messages: Record<OperatorOperation, Uint8Array> = {
  submit_batch: corpusScenarios().find((s) => s.id === 'V1a-consulta-pj-codigo-operadora')!.bytes()!,
  request_authorization: C2_SCENARIOS.find((s) => s.id === 'R01-solicitacao-valida')!.build().bytes,
  authorization_status: buildStatusAutorizacaoMessage(HEADER, {
    registroANS: SYNTHETIC.registroANS,
    numeroGuiaPrestador: 'SOL0000001',
    beneficiario: { numeroCarteira: SYNTHETIC.carteira, atendimentoRN: 'N' },
    prestador: PRESTADOR,
  }).bytes,
  eligibility: buildVerificaElegibilidadeMessage(HEADER, {
    prestador: PRESTADOR,
    numeroCarteira: SYNTHETIC.carteira,
  }).bytes,
  protocol_status: buildStatusProtocoloMessage(HEADER, { prestador: PRESTADOR, numeroProtocolo: 'PROT123' }).bytes,
  statement: buildSolicitacaoDemonstrativoMessage(HEADER, {
    tipo: 'analise',
    prestador: PRESTADOR,
    dataSolicitacao: '2026-11-19',
    protocolos: ['PROT123'],
  }).bytes,
  submit_appeal: C2_SCENARIOS.find((s) => s.id === 'G01-recurso-protocolo')!.build().bytes,
};
const OPS = Object.keys(TISS_WS_OPERATIONS) as OperatorOperation[];

let stub: StubOperator;
let clock = 0;

function config(over: Partial<TissSoapConfig> = {}): TissSoapConfig {
  return {
    id: `tiss-soap:${SYNTHETIC.registroANS}`,
    insurerId: INSURER,
    registroANS: SYNTHETIC.registroANS,
    endpoints: Object.fromEntries(OPS.map((op) => [op, stub.url])),
    soapVersion: '1.1',
    passwordEncoding: 'md5_hex',
    deduplicatesSubmissions: false,
    allowLoopbackHttp: true,
    timeoutMs: 5_000,
    retries: 2,
    circuit: { failureThreshold: 3, cooldownMs: 60_000 },
    ...over,
  };
}
const transport = (over: Partial<TissSoapConfig> = {}, credential: { login: string; password: string } | null = { login: LOGIN, password: PASSWORD }) =>
  createTissSoapTransport(config(over), { credentials: async () => credential, xsd: wsXsd, now: () => clock });
const req = (operation: OperatorOperation, extra: { insurerId?: string; xml?: Uint8Array | undefined } = {}) => ({
  operation,
  insurerId: extra.insurerId ?? INSURER,
  xml: 'xml' in extra ? extra.xml : messages[operation],
  idempotencyKey: `k-${operation}`,
});

beforeAll(async () => {
  stub = await startStubOperator({
    registroANS: SYNTHETIC.registroANS,
    login: LOGIN,
    senhaPrestador: MD5,
    plainPassword: PASSWORD,
    soapVersion: '1.1',
    xsd: wsXsd,
  });
}, 60_000);
afterAll(async () => {
  await stub.close();
});
beforeEach(() => {
  stub.setMode('accept');
  stub.received.length = 0;
  clock = 0;
});

describe('mensagens de consulta (P6.5)', () => {
  it('as quatro consultas novas passam no XSD oficial da mensagemTISS', async () => {
    for (const op of ['authorization_status', 'eligibility', 'protocol_status', 'statement'] as const) {
      const r = await mensagemXsd.validate({ bytes: messages[op] });
      expect(r.errors, op).toEqual([]);
      expect(r.valid, op).toBe(true);
    }
  }, 60_000);
});

describe('TissSoapAdapter contra o stub (P6.5)', () => {
  it('as 7 operações: envelope válido no XSD do webservice, com hash e login; resposta conferida vira protocolo com recibo', async () => {
    const t = transport();
    for (const op of OPS) {
      stub.received.length = 0;
      const out = await t.submit(req(op));
      expect(out.kind, op).toBe('accepted');
      if (out.kind !== 'accepted') continue;
      expect(out.protocol, op).toMatch(/^(PROT|GOP|OP|REC)\w+$/u);
      expect(out.receipt?.element).toBe(TISS_WS_OPERATIONS[op].response.element);
      // O recibo é o elemento que passou no XSD: conferido de novo aqui, independente.
      expect((await wsXsd.validate({ bytes: out.receipt!.xml })).valid, op).toBe(true);
      expect(stub.received, op).toHaveLength(1);
      const got = stub.received[0]!;
      expect(got.element).toBe(TISS_WS_OPERATIONS[op].request.element);
      expect(got.xsdErrors, op).toEqual([]);
      expect(got).toMatchObject({ xsdValid: true, hashOk: true, loginOk: true, destinationOk: true, plainPasswordSeen: false });
      expect(got.soapAction).toBe('""');
      expect(got.contentType).toBe('text/xml; charset=ISO-8859-1');
    }
  }, 120_000);

  it('pela porta: homologado vira resultado eletrônico; operação sem endereço segue manual', async () => {
    const registry = new Map([[INSURER, transport({ endpoints: { eligibility: stub.url } })]]);
    const connector = resolveOperatorConnector({ insurerId: INSURER, registry, hasActiveCredential: true });
    const electronic = await connector.perform(req('eligibility'));
    expect(electronic).toMatchObject({ kind: 'electronic', operation: 'eligibility', outcome: { kind: 'accepted' } });
    const manual = await connector.perform(req('submit_batch'));
    expect(manual).toMatchObject({ kind: 'manual', reason: 'credential_without_homologation' });
    expect(stub.received).toHaveLength(1);
  }, 60_000);

  it('recusa de negócio da operadora vira rejected com o código e o texto dela', async () => {
    stub.setMode('business_error');
    for (const op of ['submit_batch', 'eligibility'] as const) {
      const out = await transport().submit(req(op));
      expect(out).toMatchObject({ kind: 'rejected', code: '1001', message: 'NUMERO DA CARTEIRA INVALIDO' });
    }
  }, 60_000);

  it('tissFault: login, hash e schema são recusa; erro interno é indisponível e volta ao manual', async () => {
    stub.setMode({ fault: 'LoginInvalido' });
    expect(await transport().submit(req('protocol_status'))).toMatchObject({ kind: 'rejected', code: 'LoginInvalido' });
    stub.setMode({ fault: 'SchemaInvalido' });
    expect(await transport().submit(req('protocol_status'))).toMatchObject({ kind: 'rejected', code: 'SchemaInvalido' });
    stub.setMode({ fault: 'ErroInesperadoServidor' });
    const registry = new Map([[INSURER, transport({ retries: 0 })]]);
    const out = await resolveOperatorConnector({ insurerId: INSURER, registry, hasActiveCredential: true }).perform(req('submit_batch'));
    expect(out).toMatchObject({ kind: 'manual', reason: 'connector_unavailable' });
  }, 60_000);

  it('o stub recusa login errado com LoginInvalido (a conferência do lado da operadora funciona)', async () => {
    const out = await transport({}, { login: LOGIN, password: 'outra-senha-123' }).submit(req('eligibility'));
    expect(out).toMatchObject({ kind: 'rejected', code: 'LoginInvalido' });
    expect(stub.received[0]).toMatchObject({ xsdValid: true, hashOk: true, loginOk: false });
  }, 60_000);

  it('tempo esgotado: envio NÃO é repetido; consulta é repetida até o limite', async () => {
    stub.setMode({ delayMs: 1_500 });
    const t = transport({ timeoutMs: 300, retries: 2 });
    expect(await t.submit(req('submit_batch'))).toEqual({ kind: 'unavailable', reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 1_700));
    expect(stub.received.filter((r) => r.element === 'loteGuiasWS')).toHaveLength(1);
    expect(await t.submit(req('eligibility'))).toEqual({ kind: 'unavailable', reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 1_700));
    expect(stub.received.filter((r) => r.element === 'pedidoElegibilidadeWS')).toHaveLength(3);
  }, 60_000);

  it('envio só é repetido quando a operadora declara deduplicação', async () => {
    stub.setMode('http500');
    await transport({ deduplicatesSubmissions: true, retries: 2 }).submit(req('submit_appeal'));
    expect(stub.received).toHaveLength(3);
  }, 60_000);

  it('circuito por operadora: falhas seguidas abrem; aberto nem chama o webservice', async () => {
    stub.setMode('http500');
    const t = transport({ retries: 0 });
    for (let i = 0; i < 3; i++) expect(await t.submit(req('protocol_status'))).toEqual({ kind: 'unavailable', reason: 'server_error' });
    const before = stub.received.length;
    expect(await t.submit(req('protocol_status'))).toMatchObject({ kind: 'circuit_open' });
    expect(stub.received).toHaveLength(before);
    clock = 60_000;
    stub.setMode('accept');
    expect(await t.submit(req('protocol_status'))).toMatchObject({ kind: 'accepted' });
  }, 60_000);

  it('resposta que não confere nunca vira aceita: hash, outra operadora, fora do XSD, lote trocado, DTD', async () => {
    for (const mode of ['bad_hash', 'wrong_operator', 'off_schema', 'other_lote', 'dtd'] as const) {
      stub.setMode(mode);
      const out = await transport({ retries: 0 }).submit(req('submit_batch'));
      expect(out, mode).toEqual({ kind: 'unavailable', reason: 'invalid_response' });
    }
  }, 60_000);

  it('nada sai antes da rede quando o pedido não serve: outra operadora, outra transação, login grande, sem XML', async () => {
    const t = transport();
    await expect(t.submit(req('eligibility', { insurerId: '00000000-0000-4000-8000-000000000002' }))).rejects.toMatchObject({ code: 'WRONG_OPERATOR' });
    await expect(t.submit({ ...req('eligibility'), xml: messages.submit_batch })).rejects.toMatchObject({ code: 'WRONG_TRANSACTION' });
    const otherOperator = buildVerificaElegibilidadeMessage({ ...HEADER, registroANSDestino: '654321' }, {
      prestador: PRESTADOR,
      numeroCarteira: SYNTHETIC.carteira,
    }).bytes;
    await expect(t.submit({ ...req('eligibility'), xml: otherOperator })).rejects.toMatchObject({ code: 'WRONG_OPERATOR' });
    await expect(transport({}, { login: 'x'.repeat(21), password: PASSWORD }).submit(req('eligibility'))).rejects.toMatchObject({ code: 'INVALID_LOGIN' });
    await expect(t.submit(req('eligibility', { xml: undefined }))).rejects.toMatchObject({ code: 'MISSING_CONTENT' });
    expect(stub.received).toHaveLength(0);
  }, 60_000);

  it('sem credencial ativa: não configurado (a porta volta ao manual), sem chamar o webservice', async () => {
    expect(await transport({}, null).submit(req('eligibility'))).toEqual({ kind: 'not_configured' });
    expect(stub.received).toHaveLength(0);
  }, 60_000);

  it('a senha não aparece em resultado, recusa ou erro', async () => {
    const seen: string[] = [];
    stub.setMode('business_error');
    seen.push(JSON.stringify(await transport().submit(req('eligibility'))));
    stub.setMode({ fault: 'LoginInvalido' });
    seen.push(JSON.stringify(await transport().submit(req('eligibility'))));
    await transport({}, { login: 'x'.repeat(21), password: PASSWORD })
      .submit(req('eligibility'))
      .catch((e: Error) => seen.push(e.message));
    for (const s of seen) {
      expect(s).not.toContain(PASSWORD);
      expect(s).not.toContain(MD5);
    }
  }, 60_000);

  it('configuração: só HTTPS (loopback em HTTP só com a opção do stub), sem senha na URL, com ao menos um serviço', () => {
    expect(() => transport({ endpoints: { eligibility: 'http://operadora.example/tiss' } })).toThrow(TissSoapConfigError);
    expect(() => transport({ endpoints: { eligibility: 'http://127.0.0.1:8080/tiss' }, allowLoopbackHttp: false })).toThrow(TissSoapConfigError);
    expect(() => createTissSoapTransport({ ...config({ endpoints: { eligibility: 'http://localhost/tiss' } }), allowLoopbackHttp: false }, { credentials: async () => null, xsd: wsXsd })).toThrow(TissSoapConfigError);
    expect(() => transport({ endpoints: { eligibility: 'https://u:p@operadora.example/tiss' } })).toThrow(TissSoapConfigError);
    expect(() => transport({ endpoints: {} })).toThrow(TissSoapConfigError);
    expect(() => transport({ registroANS: '12' })).toThrow(TissSoapConfigError);
    expect(transport({ endpoints: { eligibility: 'https://operadora.example/tiss' } }).operations).toEqual(new Set(['eligibility']));
  });

  it('R61: tempo limite da operadora acima de 20 s (ou inválido) é recusado na configuração, não cortado em silêncio', () => {
    for (const timeoutMs of [20_001, 60_000, 0, -1, 1.5e3 + 0.5, Number.NaN]) {
      expect(() => transport({ timeoutMs }), String(timeoutMs)).toThrow(TissSoapConfigError);
    }
    expect(() => transport({ timeoutMs: 300 })).not.toThrow();
    expect(() => transport({ timeoutMs: 20_000 })).not.toThrow();
    // Sem o campo: vale o padrão do conector (20 s por tentativa e 20 s no total).
    const { timeoutMs: _omitido, ...semTempo } = config();
    expect(() => createTissSoapTransport(semTempo, { credentials: async () => null, xsd: wsXsd })).not.toThrow();
  });

  it('senha em texto quando o manual da operadora pede (codificação é configuração da homologação)', async () => {
    const plain = await startStubOperator({ registroANS: SYNTHETIC.registroANS, login: LOGIN, senhaPrestador: PASSWORD, soapVersion: '1.2', xsd: wsXsd });
    try {
      const t = createTissSoapTransport(
        config({ endpoints: { eligibility: plain.url }, passwordEncoding: 'plain', soapVersion: '1.2', soapActions: { eligibility: 'tissVerificaElegibilidade' } }),
        { credentials: async () => ({ login: LOGIN, password: PASSWORD }), xsd: wsXsd },
      );
      expect(await t.submit(req('eligibility'))).toMatchObject({ kind: 'accepted' });
      expect(plain.received[0]!.contentType).toBe('application/soap+xml; charset=ISO-8859-1; action="tissVerificaElegibilidade"');
    } finally {
      await plain.close();
    }
  }, 60_000);
});

describe('destino do webservice: só endereço público (P15.5, SSRF)', () => {
  it('rede interna, loopback, link-local (metadados da nuvem), CGNAT e reservados são recusados; público passa', () => {
    for (const a of ['10.0.0.5', '172.16.3.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) expect(isBlockedAddress(a), a).toBe(false);
    expect(isBlockedAddress('nao-e-ip')).toBe(true);
  });

  it('IP literal de rede interna é recusado já na configuração', () => {
    for (const u of ['https://10.0.0.5/tiss', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/tiss', 'https://127.0.0.1/tiss']) {
      expect(() => transport({ endpoints: { eligibility: u }, allowLoopbackHttp: false }), u).toThrow(TissSoapConfigError);
    }
  });

  it('nome que resolve para rede interna na hora da conexão (DNS trocado) é recusado antes de sair um byte', async () => {
    const answers: Record<string, Array<{ address: string; family: number }>> = {
      'interna.example': [{ address: '10.0.0.7', family: 4 }],
      'metadados.example': [{ address: '169.254.169.254', family: 4 }],
      'mista.example': [{ address: '8.8.8.8', family: 4 }, { address: '192.168.0.10', family: 4 }],
    };
    const resolve = ((host: string, _opts: unknown, cb: (e: Error | null, a: unknown) => void) => cb(null, answers[host] ?? [])) as never;
    for (const host of Object.keys(answers)) {
      const t = createTissSoapTransport(config({ endpoints: { eligibility: `https://${host}/tiss` }, allowLoopbackHttp: false, retries: 0 }), {
        credentials: async () => ({ login: LOGIN, password: PASSWORD }),
        xsd: wsXsd,
        resolve,
      });
      expect(await t.submit(req('eligibility')), host).toEqual({ kind: 'unavailable', reason: 'network' });
    }
    expect(stub.received).toHaveLength(0);
  }, 60_000);

  it('redirecionamento da operadora nunca é seguido: o destino do Location não recebe nada', async () => {
    const { createServer } = await import('node:http');
    let hits = 0;
    const target = createServer((_req, res) => {
      hits += 1;
      res.end('x');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    const port = (target.address() as { port: number }).port;
    try {
      stub.setMode({ redirectTo: `http://127.0.0.1:${port}/interno` });
      const t = transport({ retries: 0 });
      expect(await t.submit(req('eligibility'))).toEqual({ kind: 'unavailable', reason: 'invalid_response' });
      expect(await t.submit(req('submit_batch'))).toEqual({ kind: 'unavailable', reason: 'invalid_response' });
      expect(hits).toBe(0);
    } finally {
      stub.setMode('accept');
      await new Promise<void>((r) => target.close(() => r()));
    }
  }, 60_000);
});

describe('fronteira do stub e do registro (P6.5)', () => {
  it('nenhum código do app importa o stub; o adaptador só é montado pelo envio do lote (P9.4), com o registro de produção vazio', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative, sep } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name) ? [full] : [];
      });
    const files = walk(join(process.cwd(), 'src')).map((f) => ({ f: relative(process.cwd(), f).split(sep).join('/'), s: readFileSync(f, 'utf8') }));
    expect(files.filter(({ s }) => /tiss-soap\/stub-operator['"]|from '\.\/stub-operator'/u.test(s)).map(({ f }) => f)).toEqual([]);
    const adapterUsers = files
      .filter(({ s }) => /createTissSoapTransport/u.test(s))
      .map(({ f }) => f)
      .filter((f) => !f.endsWith('tiss-soap/tiss-soap-adapter.ts'));
    // Só o envio do lote pelo webservice (P9.4) monta o adaptador, e só para operadora homologada.
    expect(adapterUsers).toEqual(['src/contexts/health-insurance/internal/handlers/batch-send-requested.ts']);
    const { NO_HOMOLOGATED_OPERATORS } = await import('../resolve-connector');
    expect(NO_HOMOLOGATED_OPERATORS.size).toBe(0);
    const { PRODUCTION_HOMOLOGATIONS, homologationRuntime } = await import('../homologated-operators');
    expect(PRODUCTION_HOMOLOGATIONS.size).toBe(0);
    expect(homologationRuntime.registry()).toBe(PRODUCTION_HOMOLOGATIONS);
  }, 60_000);
});

describe('mensagem do webservice (P6.5)', () => {
  it('renomeia o conteúdo, põe o login no fim do cabeçalho e recalcula o hash sobre tudo', () => {
    const built = buildWsRequest({
      mensagem: messages.eligibility,
      operation: TISS_WS_OPERATIONS.eligibility,
      registroANS: SYNTHETIC.registroANS,
      login: LOGIN,
      senhaPrestador: MD5,
      soapVersion: '1.1',
    });
    const ws = readTissXml(built.document);
    expect(ws.name).toBe('pedidoElegibilidadeWS');
    expect(ws.children.map((c) => c.name)).toEqual(['cabecalho', 'pedidoElegibilidade', 'hash']);
    expect(ws.children[0]!.children.at(-1)!.name).toBe('loginSenhaPrestador');
    expect(ws.children[2]!.text).toBe(tissWsHash(ws));
    expect(built.envelope.toString('latin1')).toContain('<soapenv:Body><ans:pedidoElegibilidadeWS xmlns:ans=');
  });

  it('resposta com elemento fora do namespace da ANS é recusada', () => {
    const env = Buffer.from(
      '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><x:respostaElegibilidadeWS xmlns:x="urn:outro"><x:hash>0</x:hash></x:respostaElegibilidadeWS></s:Body></s:Envelope>',
      'latin1',
    );
    expect(parseSoapResponse(env, '1.1')).toMatchObject({ kind: 'invalid' });
    expect(parseSoapResponse(env, '1.2')).toMatchObject({ kind: 'invalid' });
  });

  it('erro de montagem tem código e nunca o valor do campo', () => {
    try {
      buildWsRequest({ mensagem: Buffer.from('<x/>'), operation: TISS_WS_OPERATIONS.eligibility, registroANS: '123456', login: LOGIN, senhaPrestador: MD5, soapVersion: '1.1' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TissSoapRequestError);
      expect((e as TissSoapRequestError).code).toBe('NOT_TISS_MESSAGE');
    }
  });
});
