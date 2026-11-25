/**
 * Dados 100% FICTÍCIOS para o corpus de validação e os testes.
 *
 * Nenhum valor aqui vem de paciente, profissional ou operadora reais:
 *  - carteirinha `0000000000000001`, registro ANS `123456` e códigos `TESTE001`;
 *  - CPF `00000000191`, sequência de teste conhecida (só dígitos verificadores);
 *  - CNPJ alfanumérico `12ABC34501DE35`, o exemplo oficial da Receita Federal;
 *  - nomes genéricos ("Profissional Teste", "Clínica Teste").
 *
 * Arquivos gerados com estes dados podem ir a validadores externos (G.5).
 */
import type { ConsultaGuideData } from '../guides/consulta';
import type { SadtProcedureItem, SadtTeamMember, SpSadtGuideData } from '../guides/sp-sadt';
import type { LoteGuiasInput } from '../messages/lote-guias';

export const SYNTHETIC = {
  registroANS: '123456',
  carteira: '0000000000000001',
  providerCode: 'TESTE001',
  cpf: '00000000191',
  cnpjAlphanumeric: '12ABC34501DE35',
} as const;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function consultaGuide(n: number, over: Partial<ConsultaGuideData> = {}): ConsultaGuideData {
  return {
    registroANS: SYNTHETIC.registroANS,
    numeroGuiaPrestador: `G${String(n).padStart(7, '0')}`,
    beneficiario: { numeroCarteira: SYNTHETIC.carteira, atendimentoRN: 'N' },
    contratado: {
      kind: 'codigoPrestadorNaOperadora',
      value: SYNTHETIC.providerCode,
      cnes: '9999999',
    },
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
  };
}

/** Atendimento da Consulta com só os campos alterados. */
export function consultaAtendimento(
  over: DeepPartial<ConsultaGuideData['atendimento']>,
): ConsultaGuideData['atendimento'] {
  const base = consultaGuide(1).atendimento;
  return { ...base, ...over, procedimento: { ...base.procedimento, ...over.procedimento } };
}

export const SADT_TEAM_MEMBER: SadtTeamMember = {
  grauParticipacao: '12',
  codProfissional: { kind: 'codigoPrestadorNaOperadora', value: 'MED001' },
  nome: 'Profissional Teste',
  conselho: '06',
  numeroConselho: '000001',
  uf: '35',
  cbo: '225133',
};

export function sadtItem(seq: number, over: Partial<SadtProcedureItem> = {}): SadtProcedureItem {
  return {
    sequencial: seq,
    dataExecucao: '2026-11-03',
    codigoTabela: '22',
    codigoProcedimento: '20104219',
    descricao: 'Sessão de psicoterapia individual',
    quantidade: 1,
    fatorCentesimos: 100,
    valorUnitarioCentavos: 12000,
    equipe: [SADT_TEAM_MEMBER],
    ...over,
  };
}

export function sadtGuide(n: number, over: Partial<SpSadtGuideData> = {}): SpSadtGuideData {
  return {
    registroANS: SYNTHETIC.registroANS,
    numeroGuiaPrestador: `S${String(n).padStart(7, '0')}`,
    autorizacao: {
      numeroGuiaOperadora: 'OP-998877',
      dataAutorizacao: '2026-11-01',
      senha: 'SENHA123',
      dataValidadeSenha: '2026-12-01',
    },
    beneficiario: { numeroCarteira: SYNTHETIC.carteira, atendimentoRN: 'N' },
    solicitante: {
      contratado: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
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
      contratado: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
      cnes: '9999999',
    },
    atendimento: { tipoAtendimento: '03', indicacaoAcidente: '9', regimeAtendimento: '01' },
    procedimentos: [sadtItem(1), sadtItem(2, { dataExecucao: '2026-11-10' })],
    ...over,
  };
}

const HEADER = {
  padrao: '4.03.00',
  dataRegistro: '2026-11-10',
  origem: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
  registroANSDestino: SYNTHETIC.registroANS,
} as const;

export function consultaBatch(
  guides: ConsultaGuideData[],
  over: Partial<Omit<LoteGuiasInput, 'lote'>> = {},
): LoteGuiasInput {
  return {
    ...HEADER,
    sequencialTransacao: '1',
    horaRegistro: '10:00:00',
    numeroLote: '1',
    ...over,
    lote: { type: 'consulta', guides },
  };
}

export function sadtBatch(
  guides: SpSadtGuideData[],
  over: Partial<Omit<LoteGuiasInput, 'lote'>> = {},
): LoteGuiasInput {
  return {
    ...HEADER,
    sequencialTransacao: '2',
    horaRegistro: '11:00:00',
    numeroLote: '2',
    ...over,
    lote: { type: 'sp_sadt', guides },
  };
}
