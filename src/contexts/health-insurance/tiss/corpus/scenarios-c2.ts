/**
 * Corpus `c2` (P13.1, ampliação): solicitação de procedimento SP/SADT e recurso de
 * glosa, gerados pelo CÓDIGO REAL com dados 100% fictícios (os mesmos de `fixtures.ts`).
 *
 * Oráculo nos dois sentidos, por camada: `rejectedBy` diz quem DEVE recusar
 * (`xsd`, `internal`); vazio = válido em todas. O teste confere a camada interna,
 * o hash e a codificação; os scripts `validate-xsd*.ts/ps1` conferem o XSD com dois
 * motores independentes e gravam o resultado ao lado do manifesto.
 */
import type { BuiltTissMessage } from '../messages/lote-guias';
import type { PrestadorMessageHeader } from '../messages/prestador-message';
import { buildRecursoGlosaMessage, type GlossAppealData } from '../messages/recurso-glosa';
import {
  buildSolicitacaoProcedimentoMessage,
  type SpSadtRequestData,
} from '../messages/solicitacao-procedimento';
import type { TerminologyLookup } from '../terminology/lookup';
import type { GuideIssue } from '../validation/common';
import { validateGlossAppeal, validateSpSadtRequest } from '../validation/message-validators';

import { SYNTHETIC } from './fixtures';

export const CORPUS_C2_DIR = 'data/tiss/corpus/4.03.00/c2';
export const C2_TODAY = '2026-11-20';

const HEADER: PrestadorMessageHeader = {
  padrao: '4.03.00',
  sequencialTransacao: '1',
  dataRegistro: '2026-11-20',
  horaRegistro: '10:00:00',
  origem: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
  registroANSDestino: SYNTHETIC.registroANS,
};

export function sadtRequest(over: Partial<SpSadtRequestData> = {}): SpSadtRequestData {
  return {
    registroANS: SYNTHETIC.registroANS,
    numeroGuiaPrestador: 'SOL0000001',
    tipoEtapaAutorizacao: '1',
    beneficiario: { numeroCarteira: SYNTHETIC.carteira, atendimentoRN: 'N' },
    solicitante: {
      contratado: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
      nomeContratado: 'Clínica Teste',
      profissional: { nome: 'Profissional Teste', conselho: '06', numeroConselho: '000001', uf: '35', cbo: '225133' },
    },
    caraterAtendimento: '1',
    dataSolicitacao: '2026-11-19',
    indicacaoClinica: 'Texto escrito pelo profissional solicitante para esta solicitação',
    procedimentos: [
      { codigoTabela: '22', codigoProcedimento: '40301010', descricao: '3-metil histidina, pesquisa e/ou dosagem no soro', quantidade: 1 },
      { codigoTabela: '22', codigoProcedimento: '40302016', descricao: 'Gasometria (pH, pCO2, SA, O2, excesso base) - pesquisa e/ou dosagem', quantidade: 2 },
    ],
    ...over,
  };
}

export function glossAppeal(over: Partial<GlossAppealData> = {}): GlossAppealData {
  return {
    registroANS: SYNTHETIC.registroANS,
    numeroGuiaRecGlosaPrestador: 'REC0000001',
    nomeOperadora: 'Operadora Teste',
    objetoRecurso: '2',
    contratado: { kind: 'codigoPrestadorNaOperadora', value: SYNTHETIC.providerCode },
    numeroLote: '12',
    numeroProtocolo: '202611000123',
    guias: [
      {
        numeroGuiaOrigem: 'S0000001',
        itens: [
          {
            sequencialItem: 1,
            dataInicio: '2026-11-03',
            codigoTabela: '22',
            codigoProcedimento: '40301010',
            descricao: '3-metil histidina, pesquisa e/ou dosagem no soro',
            codigoGlosa: '1001',
            valorRecursadoCentavos: 12000,
            justificativa: 'A carteirinha estava válida na data; segue comprovante da elegibilidade.',
          },
          {
            sequencialItem: 2,
            dataInicio: '2026-11-10',
            codigoTabela: '22',
            codigoProcedimento: '40302016',
            descricao: 'Gasometria (pH, pCO2, SA, O2, excesso base) - pesquisa e/ou dosagem',
            codigoGlosa: '1001',
            valorRecursadoCentavos: 8050,
            justificativa: 'Mesma situação do item 1: elegibilidade confirmada pela operadora.',
          },
        ],
      },
    ],
    valorTotalRecursadoCentavos: 20050,
    dataRecurso: '2026-11-20',
    ...over,
  };
}

export interface C2Scenario {
  id: string;
  file: string;
  description: string;
  rejectedBy: ReadonlyArray<'xsd' | 'internal'>;
  build(): BuiltTissMessage;
  validate(t: TerminologyLookup): GuideIssue[];
}

const request = (id: string, description: string, rejectedBy: C2Scenario['rejectedBy'], data: SpSadtRequestData): C2Scenario => ({
  id,
  file: `${id}.xml`,
  description,
  rejectedBy,
  build: () => buildSolicitacaoProcedimentoMessage(HEADER, data),
  validate: (terminology) => validateSpSadtRequest(data, { terminology, today: C2_TODAY }),
});
const appeal = (id: string, description: string, rejectedBy: C2Scenario['rejectedBy'], data: GlossAppealData): C2Scenario => ({
  id,
  file: `${id}.xml`,
  description,
  rejectedBy,
  build: () => buildRecursoGlosaMessage(HEADER, data),
  validate: (terminology) => validateGlossAppeal(data, { terminology, today: C2_TODAY }),
});

export const C2_SCENARIOS: readonly C2Scenario[] = [
  request('R01-solicitacao-valida', 'solicitação SP/SADT com 2 procedimentos e indicação clínica escrita pelo profissional', [], sadtRequest()),
  request('R02-solicitacao-sem-indicacao', 'solicitação sem indicação clínica (campo opcional; nada é preenchido pelo sistema)', [], sadtRequest({ indicacaoClinica: null })),
  request('R03-quantidade-acima', 'quantidade 1000 (st_numerico3 vai até 999)', ['xsd', 'internal'], sadtRequest({
    procedimentos: [{ codigoTabela: '22', codigoProcedimento: '40301010', descricao: '3-metil histidina, pesquisa e/ou dosagem no soro', quantidade: 1000 }],
  })),
  request('R04-data-futura', 'data da solicitação no futuro (o XSD aceita; a regra interna recusa)', ['internal'], sadtRequest({ dataSolicitacao: '2026-12-01' })),
  request('R05-procedimento-repetido', 'o mesmo procedimento duas vezes (o XSD aceita; a regra interna pede somar)', ['internal'], sadtRequest({
    procedimentos: [
      { codigoTabela: '22', codigoProcedimento: '40301010', descricao: '3-metil histidina, pesquisa e/ou dosagem no soro', quantidade: 1 },
      { codigoTabela: '22', codigoProcedimento: '40301010', descricao: '3-metil histidina, pesquisa e/ou dosagem no soro', quantidade: 1 },
    ],
  })),
  request('R06-carater-invalido', 'caráter do atendimento 3 (fora do domínio)', ['xsd', 'internal'], sadtRequest({ caraterAtendimento: '3' as '1' })),
  appeal('G01-recurso-protocolo', 'recurso do protocolo inteiro (objeto 1)', [], glossAppeal({
    objetoRecurso: '1',
    guias: null,
    recursoProtocolo: { codigoGlosa: '1001', justificativa: 'Todas as carteirinhas do lote estavam válidas nas datas de atendimento.' },
    valorTotalRecursadoCentavos: 45000,
  })),
  appeal('G02-recurso-itens', 'recurso por guia, dois itens, total = soma dos itens', [], glossAppeal()),
  appeal('G03-recurso-guia-completa', 'recurso da guia completa', [], glossAppeal({
    guias: [{ numeroGuiaOrigem: 'S0000002', guiaCompleta: [{ codigoGlosa: '1001', justificativa: 'Elegibilidade confirmada pela operadora no dia do atendimento.' }] }],
    valorTotalRecursadoCentavos: 15000,
  })),
  appeal('G04-total-divergente', 'total recursado diferente da soma dos itens (o XSD aceita)', ['internal'], glossAppeal({ valorTotalRecursadoCentavos: 30000 })),
  appeal('G05-protocolo-nao-numerico', 'protocolo com letras (st_numerico12)', ['xsd', 'internal'], glossAppeal({ numeroProtocolo: 'PROT-1' })),
  appeal('G06-codigo-glosa-inexistente', 'código de glosa fora da tabela 38 e do dm_tipoGlosa', ['xsd', 'internal'], glossAppeal({
    guias: [{ numeroGuiaOrigem: 'S0000002', guiaCompleta: [{ codigoGlosa: '9999', justificativa: 'Justificativa de teste para código inexistente.' }] }],
    valorTotalRecursadoCentavos: 15000,
  })),
  appeal('G07-justificativa-curta', 'justificativa com 2 caracteres (o XSD aceita; a regra interna pede o texto de quem recorre)', ['internal'], glossAppeal({
    guias: [{ numeroGuiaOrigem: 'S0000002', guiaCompleta: [{ codigoGlosa: '1001', justificativa: 'ok' }] }],
    valorTotalRecursadoCentavos: 15000,
  })),
  appeal('G08-forma-trocada', 'objeto 2 (guia) com recurso de protocolo', ['internal'], glossAppeal({
    guias: null,
    recursoProtocolo: { codigoGlosa: '1001', justificativa: 'Justificativa de teste com forma trocada.' },
  })),
];
