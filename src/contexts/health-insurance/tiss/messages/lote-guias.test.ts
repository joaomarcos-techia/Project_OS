import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { formatTissMoney, type ConsultaGuideData } from '../guides/consulta';
import { TissEncodingError } from '../xml/tree';

import {
  TISS_MAX_GUIDES_PER_BATCH,
  TissBatchError,
  buildLoteGuiasMessage,
  type LoteGuiasInput,
} from './lote-guias';

// Dados 100% fictícios.
const guide = (n: number, over: Partial<ConsultaGuideData> = {}): ConsultaGuideData => ({
  registroANS: '123456',
  numeroGuiaPrestador: `G${String(n).padStart(7, '0')}`,
  beneficiario: { numeroCarteira: '0000000000000001', atendimentoRN: 'N' },
  contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001', cnes: '9999999' },
  profissional: {
    nome: 'Profissional Teste',
    conselho: '06',
    numeroConselho: '000001',
    uf: '35',
    cbo: '225133',
  },
  indicacaoAcidente: '9',
  atendimento: {
    regimeAtendimento: '01',
    dataAtendimento: '2026-11-09',
    tipoConsulta: '1',
    procedimento: {
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimento: '150.00',
    },
  },
  ...over,
});

const input = (guides: ConsultaGuideData[]): LoteGuiasInput => ({
  padrao: '4.03.00',
  sequencialTransacao: '1',
  dataRegistro: '2026-11-10',
  horaRegistro: '10:00:00',
  origem: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
  registroANSDestino: '123456',
  numeroLote: '1',
  lote: { type: 'consulta', guides },
});

const EXPECTED_GUIDE =
  '<ans:guiaConsulta><ans:cabecalhoConsulta><ans:registroANS>123456</ans:registroANS><ans:numeroGuiaPrestador>G0000001</ans:numeroGuiaPrestador></ans:cabecalhoConsulta>' +
  '<ans:dadosBeneficiario><ans:numeroCarteira>0000000000000001</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario>' +
  '<ans:contratadoExecutante><ans:codigoPrestadorNaOperadora>TESTE001</ans:codigoPrestadorNaOperadora><ans:CNES>9999999</ans:CNES></ans:contratadoExecutante>' +
  '<ans:profissionalExecutante><ans:nomeProfissional>Profissional Teste</ans:nomeProfissional><ans:conselhoProfissional>06</ans:conselhoProfissional><ans:numeroConselhoProfissional>000001</ans:numeroConselhoProfissional><ans:UF>35</ans:UF><ans:CBOS>225133</ans:CBOS></ans:profissionalExecutante>' +
  '<ans:indicacaoAcidente>9</ans:indicacaoAcidente>' +
  '<ans:dadosAtendimento><ans:regimeAtendimento>01</ans:regimeAtendimento><ans:dataAtendimento>2026-11-09</ans:dataAtendimento><ans:tipoConsulta>1</ans:tipoConsulta><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>10101012</ans:codigoProcedimento><ans:valorProcedimento>150.00</ans:valorProcedimento></ans:procedimento></ans:dadosAtendimento>' +
  '</ans:guiaConsulta>';

describe('mensagem ENVIO_LOTE_GUIAS com Guia de Consulta (4.03.00)', () => {
  it('emite a guia na ordem do XSD, sem opcionais ausentes', () => {
    const { xml } = buildLoteGuiasMessage(input([guide(1)]));
    expect(xml).toContain(EXPECTED_GUIDE);
    expect(xml).not.toMatch(
      /numeroGuiaOperadora|codValidacao|coberturaEspecial|saudeOcupacional|observacao/u,
    );
  });

  it('cabeçalho, lote e epílogo na ordem da mensagem', () => {
    const { xml, hash } = buildLoteGuiasMessage(input([guide(1)]));
    const order = [
      '<ans:cabecalho>',
      '<ans:tipoTransacao>ENVIO_LOTE_GUIAS',
      '<ans:destino><ans:registroANS>123456',
      '<ans:Padrao>4.03.00',
      '<ans:prestadorParaOperadora><ans:loteGuias><ans:numeroLote>1',
      '<ans:guiasTISS><ans:guiaConsulta>',
      `<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo>`,
    ];
    let at = -1;
    for (const marker of order) {
      const next = xml.indexOf(marker);
      expect(next, marker).toBeGreaterThan(at);
      at = next;
    }
  });

  it('o hash bate com um cálculo independente sobre o texto gerado', () => {
    const { xml, hash } = buildLoteGuiasMessage(input([guide(1), guide(2)]));
    const text = xml
      .replace(/^<\?xml[^>]*\?>/u, '')
      .replace(/<ans:epilogo>[\s\S]*<\/ans:epilogo>/u, '')
      .replace(/<[^>]+>/gu, '')
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&amp;/gu, '&');
    expect(hash).toBe(createHash('md5').update(Buffer.from(text, 'latin1')).digest('hex'));
  });

  it('bytes em ISO-8859-1 com acento de um byte', () => {
    const { bytes } = buildLoteGuiasMessage(
      input([guide(1, { profissional: { ...guide(1).profissional, nome: 'Conceição Araújo' } })]),
    );
    expect(bytes.includes(Buffer.from('Conceição', 'latin1'))).toBe(true);
  });

  it('recusa nome com caractere fora do latin1', () => {
    expect(() =>
      buildLoteGuiasMessage(
        input([guide(1, { profissional: { ...guide(1).profissional, nome: 'Nguyễn' } })]),
      ),
    ).toThrow(TissEncodingError);
  });

  it(`aceita até ${TISS_MAX_GUIDES_PER_BATCH} guias e recusa lote vazio ou com 101`, () => {
    const many = Array.from({ length: TISS_MAX_GUIDES_PER_BATCH }, (_, i) => guide(i + 1));
    expect(() => buildLoteGuiasMessage(input(many))).not.toThrow();
    expect(() => buildLoteGuiasMessage(input([...many, guide(101)]))).toThrow(TissBatchError);
    expect(() => buildLoteGuiasMessage(input([]))).toThrow(/sem guias/u);
  });

  it('contratado por CNPJ alfanumérico e opcionais presentes saem no lugar certo', () => {
    const { xml } = buildLoteGuiasMessage(
      input([
        guide(1, {
          numeroGuiaOperadora: 'OP123',
          contratado: { kind: 'cnpjContratado', value: 'AB12CD34EF5612', cnes: '1234567' },
          observacao: 'Retorno',
        }),
      ]),
    );
    expect(xml).toContain(
      '</ans:cabecalhoConsulta><ans:numeroGuiaOperadora>OP123</ans:numeroGuiaOperadora><ans:dadosBeneficiario>',
    );
    expect(xml).toContain(
      '<ans:cnpjContratado>AB12CD34EF5612</ans:cnpjContratado><ans:CNES>1234567</ans:CNES>',
    );
    expect(xml).toContain(
      '</ans:dadosAtendimento><ans:observacao>Retorno</ans:observacao></ans:guiaConsulta>',
    );
  });
});

describe('formatTissMoney', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [15000, '150.00'],
    [123456789, '1234567.89'],
  ])('%i centavos → %s', (cents, text) => {
    expect(formatTissMoney(cents)).toBe(text);
  });

  it('recusa negativo e fração de centavo', () => {
    expect(() => formatTissMoney(-1)).toThrow(RangeError);
    expect(() => formatTissMoney(1.5)).toThrow(RangeError);
  });
});
