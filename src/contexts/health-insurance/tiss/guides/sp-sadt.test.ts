import { describe, expect, it } from 'vitest';

import { buildLoteGuiasMessage } from '../messages/lote-guias';
import { serializeDocument } from '../xml/tree';

import {
  formatFactor,
  sadtItemTotalCents,
  sadtTotalCents,
  spSadtGuideElement,
  type SadtProcedureItem,
  type SpSadtGuideData,
} from './sp-sadt';

// Dados 100% fictícios: sessões de psicoterapia individual (TUSS 20104219).
const session = (seq: number, date: string): SadtProcedureItem => ({
  sequencial: seq,
  dataExecucao: date,
  codigoTabela: '22',
  codigoProcedimento: '20104219',
  descricao: 'Sessão de psicoterapia individual',
  quantidade: 1,
  fatorCentesimos: 100,
  valorUnitarioCentavos: 12000,
  equipe: [
    {
      grauParticipacao: '12',
      codProfissional: { kind: 'codigoPrestadorNaOperadora', value: 'MED001' },
      nome: 'Profissional Teste',
      conselho: '06',
      numeroConselho: '000001',
      uf: '35',
      cbo: '225133',
    },
  ],
});

const guide = (over: Partial<SpSadtGuideData> = {}): SpSadtGuideData => ({
  registroANS: '123456',
  numeroGuiaPrestador: 'S0000001',
  autorizacao: {
    numeroGuiaOperadora: 'OP-998877',
    dataAutorizacao: '2026-11-01',
    senha: 'SENHA123',
    dataValidadeSenha: '2026-12-01',
  },
  beneficiario: { numeroCarteira: '0000000000000001', atendimentoRN: 'N' },
  solicitante: {
    contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
    nomeContratado: 'Clínica Teste',
    profissional: {
      nome: 'Profissional Teste',
      conselho: '06',
      numeroConselho: '000001',
      uf: '35',
      cbo: '225133',
    },
  },
  solicitacao: {
    dataSolicitacao: '2026-10-30',
    caraterAtendimento: '1',
    indicacaoClinica: 'Indicação registrada pelo médico solicitante',
  },
  executante: {
    contratado: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
    cnes: '9999999',
  },
  atendimento: { tipoAtendimento: '03', indicacaoAcidente: '9', regimeAtendimento: '01' },
  procedimentos: [session(1, '2026-11-03'), session(2, '2026-11-10')],
  ...over,
});

describe('valores da SP/SADT', () => {
  it.each([
    [{ quantidade: 4, valorUnitarioCentavos: 15000, fatorCentesimos: 100 }, 60000],
    [{ quantidade: 1, valorUnitarioCentavos: 10000, fatorCentesimos: 70 }, 7000],
    [{ quantidade: 3, valorUnitarioCentavos: 3333, fatorCentesimos: 70 }, 6999], // 69,993 → 69,99
    [{ quantidade: 1, valorUnitarioCentavos: 5, fatorCentesimos: 50 }, 3], // 0,025 → 0,03 (meio para cima)
    [{ quantidade: 2, valorUnitarioCentavos: 0, fatorCentesimos: 100 }, 0], // valor indefinido no contrato
  ])('%o → %i centavos', (item, cents) => {
    expect(sadtItemTotalCents(item)).toBe(cents);
  });

  it('total da guia soma os itens', () => {
    expect(sadtTotalCents(guide().procedimentos)).toBe(24000);
  });

  it('fator em texto com duas casas', () => {
    expect(formatFactor(100)).toBe('1.00');
    expect(formatFactor(70)).toBe('0.70');
    expect(() => formatFactor(1000)).toThrow(RangeError);
  });
});

describe('elemento guiaSP-SADT (4.03.00)', () => {
  it('segue a ordem do XSD', () => {
    const xml = serializeDocument(spSadtGuideElement(guide()));
    const order = [
      '<ans:cabecalhoGuia>',
      '<ans:dadosAutorizacao><ans:numeroGuiaOperadora>OP-998877</ans:numeroGuiaOperadora><ans:dataAutorizacao>2026-11-01</ans:dataAutorizacao><ans:senha>SENHA123</ans:senha><ans:dataValidadeSenha>2026-12-01</ans:dataValidadeSenha></ans:dadosAutorizacao>',
      '<ans:dadosBeneficiario>',
      '<ans:dadosSolicitante><ans:contratadoSolicitante><ans:codigoPrestadorNaOperadora>TESTE001</ans:codigoPrestadorNaOperadora></ans:contratadoSolicitante><ans:nomeContratadoSolicitante>',
      '<ans:dadosSolicitacao><ans:dataSolicitacao>2026-10-30</ans:dataSolicitacao><ans:caraterAtendimento>1</ans:caraterAtendimento><ans:indicacaoClinica>',
      '<ans:dadosExecutante><ans:contratadoExecutante>',
      '<ans:dadosAtendimento><ans:tipoAtendimento>03</ans:tipoAtendimento><ans:indicacaoAcidente>9</ans:indicacaoAcidente><ans:regimeAtendimento>01</ans:regimeAtendimento></ans:dadosAtendimento>',
      '<ans:procedimentosExecutados><ans:procedimentoExecutado><ans:sequencialItem>1</ans:sequencialItem><ans:dataExecucao>2026-11-03</ans:dataExecucao><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>20104219</ans:codigoProcedimento><ans:descricaoProcedimento>Sessão de psicoterapia individual</ans:descricaoProcedimento></ans:procedimento><ans:quantidadeExecutada>1</ans:quantidadeExecutada><ans:reducaoAcrescimo>1.00</ans:reducaoAcrescimo><ans:valorUnitario>120.00</ans:valorUnitario><ans:valorTotal>120.00</ans:valorTotal><ans:equipeSadt><ans:grauPart>12</ans:grauPart><ans:codProfissional>',
      '<ans:valorTotal><ans:valorProcedimentos>240.00</ans:valorProcedimentos><ans:valorTotalGeral>240.00</ans:valorTotalGeral></ans:valorTotal></ans:guiaSP-SADT>',
    ];
    let at = -1;
    for (const marker of order) {
      const next = xml.indexOf(marker);
      expect(next, marker.slice(0, 60)).toBeGreaterThan(at);
      at = next;
    }
  });

  it('sem autorização e sem indicação clínica, os blocos opcionais somem', () => {
    const xml = serializeDocument(
      spSadtGuideElement(guide({ autorizacao: null, solicitacao: { caraterAtendimento: '1' } })),
    );
    expect(xml).not.toContain('dadosAutorizacao');
    expect(xml).not.toContain('indicacaoClinica');
    expect(xml).not.toContain('outrasDespesas');
  });

  it('entra no lote como tipo próprio (um tipo de guia por lote)', () => {
    const { xml } = buildLoteGuiasMessage({
      padrao: '4.03.00',
      sequencialTransacao: '2',
      dataRegistro: '2026-11-10',
      horaRegistro: '11:00:00',
      origem: { kind: 'codigoPrestadorNaOperadora', value: 'TESTE001' },
      registroANSDestino: '123456',
      numeroLote: '2',
      lote: { type: 'sp_sadt', guides: [guide()] },
    });
    expect(xml).toContain('<ans:guiasTISS><ans:guiaSP-SADT>');
    expect(xml).not.toContain('guiaConsulta');
  });
});
