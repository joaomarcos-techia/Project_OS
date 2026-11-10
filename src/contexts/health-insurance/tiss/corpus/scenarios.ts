/**
 * Corpus sintético de validação TISS 4.03.00 (P13.1, matriz G.4 do plano mestre).
 *
 * Cada cenário diz o que se ESPERA de cada camada interna, nos dois sentidos:
 * as camadas listadas em `rejectedBy` devem recusar o arquivo e as demais
 * devem aceitá-lo. As expectativas vêm das regras (XSD, Componente
 * Organizacional, validadores do Qoro), não do resultado observado.
 *
 * Origem dos arquivos:
 *  - `builder`: gerador do app (`buildLoteGuiasMessage`), com dados fictícios;
 *  - `unguarded`: o mesmo código de montagem sem as travas do gerador, para
 *    lotes que o padrão proíbe (101 guias, tipos misturados);
 *  - `mutation`: mutação controlada e documentada depois do gerador, só para
 *    defeitos que o gerador não consegue produzir (codificação, namespace,
 *    hash, truncamento). Nunca se edita XML para fazê-lo PASSAR;
 *  - `none`: o gerador recusa e não há arquivo.
 *
 * Os arquivos ficam em `data/tiss/corpus/4.03.00/c1/` (script
 * `scripts/tiss/corpus/generate.ts`); o teste `corpus.test.ts` confere que o
 * código regenera os mesmos bytes.
 */
import { consultaGuideElement } from '../guides/consulta';
import { spSadtGuideElement } from '../guides/sp-sadt';
import {
  assembleLoteGuiasMessage,
  buildLoteGuiasMessage,
  type LoteGuiasInput,
} from '../messages/lote-guias';
import { TISS_NAMESPACE } from '../xml/tree';

import {
  SYNTHETIC,
  consultaAtendimento,
  consultaBatch,
  consultaGuide,
  sadtBatch,
  sadtGuide,
  sadtItem,
} from './fixtures';

export const CORPUS_ID = 'tiss-4.03.00-c1';
export const CORPUS_DIR = 'data/tiss/corpus/4.03.00/c1';
/** "Hoje" das regras de data do corpus (fixo, para o corpus ser reproduzível). */
export const CORPUS_TODAY = '2026-11-10';

export type CorpusLayer = 'builder' | 'xsd' | 'rules' | 'hash' | 'encoding';

export interface CorpusRulesContext {
  today: string;
  contractorPerson: 'PF' | 'PJ';
  requesterPerson: 'PF' | 'PJ';
  authorizationRequired: boolean;
}

export interface CorpusScenario {
  /** Nome do arquivo sem extensão. */
  id: string;
  /** Linhas da matriz G.4 cobertas. */
  matrix: string[];
  guideType: 'consulta' | 'sp_sadt' | 'misto';
  title: string;
  expected: 'valid' | 'invalid';
  /** Camadas internas que devem recusar; vazio nos válidos. */
  rejectedBy: CorpusLayer[];
  /** Códigos que a camada de regras deve apontar (quando `rules` recusa). */
  expectedIssues?: string[];
  origin: 'builder' | 'unguarded' | 'mutation' | 'none';
  mutation?: string;
  rules: CorpusRulesContext;
  /** Entrada do gerador, quando o cenário é representável nos tipos do app. */
  input: LoteGuiasInput | null;
  /** Bytes do arquivo; `null` quando não há arquivo (o gerador recusa). */
  bytes(): Buffer | null;
}

const RULES: CorpusRulesContext = {
  today: CORPUS_TODAY,
  contractorPerson: 'PJ',
  requesterPerson: 'PJ',
  authorizationRequired: true,
};

type Draft = Omit<CorpusScenario, 'bytes' | 'rules' | 'origin' | 'rejectedBy' | 'expected'> & {
  rules?: Partial<CorpusRulesContext>;
  rejectedBy?: CorpusLayer[];
};

function fromBuilder(d: Draft & { input: LoteGuiasInput }): CorpusScenario {
  const rejectedBy = d.rejectedBy ?? [];
  return {
    ...d,
    expected: rejectedBy.length === 0 ? 'valid' : 'invalid',
    rejectedBy,
    origin: rejectedBy.includes('builder') ? 'none' : 'builder',
    rules: { ...RULES, ...d.rules },
    bytes: () => (rejectedBy.includes('builder') ? null : buildLoteGuiasMessage(d.input).bytes),
  };
}

function fromMutation(
  d: Draft & { input: LoteGuiasInput; mutation: string },
  mutate: (built: ReturnType<typeof buildLoteGuiasMessage>) => Buffer,
): CorpusScenario {
  return {
    ...d,
    expected: 'invalid',
    rejectedBy: d.rejectedBy ?? [],
    origin: 'mutation',
    rules: { ...RULES, ...d.rules },
    bytes: () => mutate(buildLoteGuiasMessage(d.input)),
  };
}

const sadtTeam = sadtGuide(1).procedimentos[0]!.equipe!;

export function corpusScenarios(): CorpusScenario[] {
  const base = consultaBatch([consultaGuide(1)]);
  return [
    // ── Válidos: Consulta ──────────────────────────────────────────────
    fromBuilder({
      id: 'V1a-consulta-pj-codigo-operadora',
      matrix: ['V1', 'V3'],
      guideType: 'consulta',
      title:
        'Consulta, contratado PJ pelo código na operadora, sem CNES (9999999); lote com 1 guia',
      input: base,
    }),
    fromBuilder({
      id: 'V1b-consulta-cnpj-alfanumerico-cnes',
      matrix: ['V1'],
      guideType: 'consulta',
      title: 'Consulta com CNPJ alfanumérico (exemplo oficial da Receita) e CNES informado',
      input: consultaBatch(
        [
          consultaGuide(1, {
            contratado: {
              kind: 'cnpjContratado',
              value: SYNTHETIC.cnpjAlphanumeric,
              cnes: '1234567',
            },
          }),
        ],
        { origem: { kind: 'CNPJ', value: SYNTHETIC.cnpjAlphanumeric } },
      ),
    }),
    fromBuilder({
      id: 'V1c-consulta-pf-cpf-sem-nome',
      matrix: ['V1'],
      guideType: 'consulta',
      title: 'Consulta de pessoa física (CPF), sem o nome do profissional (opcional para PF)',
      rules: { contractorPerson: 'PF' },
      input: consultaBatch(
        [
          consultaGuide(1, {
            contratado: { kind: 'cpfContratado', value: SYNTHETIC.cpf, cnes: '9999999' },
            profissional: { conselho: '06', numeroConselho: '000001', uf: '35', cbo: '225125' },
          }),
        ],
        { origem: { kind: 'CPF', value: SYNTHETIC.cpf } },
      ),
    }),
    fromBuilder({
      id: 'V1d-consulta-tipos-e-regimes',
      matrix: ['V1'],
      guideType: 'consulta',
      title:
        'Consultas dos tipos 1 a 4 em cada regime de atendimento 01 a 05 (20 guias, valor zero)',
      input: consultaBatch(
        [1, 2, 3, 4].flatMap((t) =>
          ['01', '02', '03', '04', '05'].map((r, i) =>
            consultaGuide(t * 10 + i, {
              atendimento: consultaAtendimento({
                regimeAtendimento: r,
                tipoConsulta: String(t),
                procedimento: { valorProcedimento: '0.00' },
              }),
            }),
          ),
        ),
      ),
    }),
    fromBuilder({
      id: 'V1e-consulta-opcionais-valor-maximo',
      matrix: ['V1', 'V18'],
      guideType: 'consulta',
      title: 'Consulta com todos os opcionais, símbolos escapados (& < >) e o maior valor do XSD',
      input: consultaBatch([
        consultaGuide(1, {
          numeroGuiaOperadora: 'OP123',
          ausenciaCodValidacao: '01',
          observacao: 'Observação com acento & símbolos <ok>',
          atendimento: consultaAtendimento({
            coberturaEspecial: '01',
            saudeOcupacional: '01',
            tipoConsulta: '2',
            procedimento: { valorProcedimento: '99999999.99' },
          }),
        }),
      ]),
    }),
    fromBuilder({
      id: 'V4-consulta-lote-100-guias',
      matrix: ['V4'],
      guideType: 'consulta',
      title: 'Lote de Consulta com 100 guias (limite do padrão)',
      input: consultaBatch(Array.from({ length: 100 }, (_, i) => consultaGuide(i + 1))),
    }),
    fromBuilder({
      id: 'V18-consulta-acentos-latin1',
      matrix: ['V18'],
      guideType: 'consulta',
      title: 'Nome com acentos e trema em ISO-8859-1',
      input: consultaBatch([
        consultaGuide(1, {
          profissional: {
            nome: 'Conceição Araújo Müller',
            conselho: '06',
            numeroConselho: '000001',
            uf: '35',
            cbo: '225133',
          },
        }),
      ]),
    }),

    // ── Válidos: SP/SADT ───────────────────────────────────────────────
    fromBuilder({
      id: 'V2a-sadt-sessoes-autorizacao-equipe',
      matrix: ['V2'],
      guideType: 'sp_sadt',
      title: 'SP/SADT com 2 sessões, autorização, senha e equipe',
      input: sadtBatch([sadtGuide(1)]),
    }),
    fromBuilder({
      id: 'V2b-sadt-sem-autorizacao',
      matrix: ['V2'],
      guideType: 'sp_sadt',
      title: 'SP/SADT sem autorização, em contrato que não a exige',
      rules: { authorizationRequired: false },
      input: sadtBatch([sadtGuide(2, { autorizacao: null })]),
    }),
    fromBuilder({
      id: 'V2c-sadt-itens-variados',
      matrix: ['V2'],
      guideType: 'sp_sadt',
      title: 'SP/SADT com quantidade 4, redução (fator 0,70), horários e item de valor zero',
      input: sadtBatch([
        sadtGuide(3, {
          procedimentos: [
            sadtItem(1, { quantidade: 4, valorUnitarioCentavos: 15000 }),
            sadtItem(2, {
              fatorCentesimos: 70,
              valorUnitarioCentavos: 3333,
              quantidade: 3,
              codigoProcedimento: '50000470',
              descricao: 'Sessão de psicoterapia individual por psicólogo',
              equipe: [],
            }),
            sadtItem(3, {
              horaInicial: '10:00:00',
              horaFinal: '10:50:00',
              valorUnitarioCentavos: 0,
            }),
          ],
        }),
      ]),
    }),
    fromBuilder({
      id: 'V2d-sadt-solicitante-externo',
      matrix: ['V2'],
      guideType: 'sp_sadt',
      title: 'SP/SADT com solicitante externo (código 99999999999999 e CBO 999999)',
      rules: { requesterPerson: 'PF' },
      input: sadtBatch([
        sadtGuide(4, {
          solicitante: {
            contratado: { kind: 'codigoPrestadorNaOperadora', value: '99999999999999' },
            nomeContratado: 'Médico externo',
            profissional: { conselho: '06', numeroConselho: '123456', uf: '33', cbo: '999999' },
          },
        }),
      ]),
    }),
    fromBuilder({
      id: 'V2e-sadt-consulta-tipo-04',
      matrix: ['V2'],
      guideType: 'sp_sadt',
      title: 'Consulta faturada em SP/SADT (tipo de atendimento 04)',
      input: sadtBatch([
        sadtGuide(5, {
          atendimento: {
            tipoAtendimento: '04',
            indicacaoAcidente: '9',
            tipoConsulta: '1',
            regimeAtendimento: '01',
          },
          procedimentos: [
            sadtItem(1, {
              codigoProcedimento: '10101012',
              descricao: 'Consulta em consultório (no horário normal ou preestabelecido)',
            }),
          ],
        }),
      ]),
    }),
    fromBuilder({
      id: 'V2f-sadt-lote-100-guias',
      matrix: ['V2', 'V4'],
      guideType: 'sp_sadt',
      title: 'Lote de SP/SADT com 100 guias',
      input: sadtBatch(Array.from({ length: 100 }, (_, i) => sadtGuide(i + 1))),
    }),

    // ── Inválidos pelo XSD (e pelas regras) ────────────────────────────
    fromBuilder({
      id: 'N06-consulta-registro-ans-5-digitos',
      matrix: ['V6'],
      guideType: 'consulta',
      title: 'Registro ANS com 5 dígitos (na guia e no destino)',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['ANS_REGISTRY_FORMAT'],
      input: consultaBatch([consultaGuide(1, { registroANS: '12345' })], {
        registroANSDestino: '12345',
      }),
    }),
    fromBuilder({
      id: 'N07-consulta-carteira-21',
      matrix: ['V7'],
      guideType: 'consulta',
      title: 'Carteirinha com 21 caracteres',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['CARD_NUMBER'],
      input: consultaBatch([
        consultaGuide(1, { beneficiario: { numeroCarteira: '1'.repeat(21), atendimentoRN: 'N' } }),
      ]),
    }),
    fromBuilder({
      id: 'N14-consulta-carteira-ausente',
      matrix: ['V7', 'V14'],
      guideType: 'consulta',
      title: 'Carteirinha vazia: o elemento obrigatório some do XML',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['CARD_NUMBER'],
      input: consultaBatch([
        consultaGuide(1, { beneficiario: { numeroCarteira: '', atendimentoRN: 'N' } }),
      ]),
    }),
    fromBuilder({
      id: 'N08-consulta-cbo-fora-do-dominio',
      matrix: ['V8'],
      guideType: 'consulta',
      title: 'CBO 123456, fora da tabela 24',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['CBO_DOMAIN'],
      input: consultaBatch([
        consultaGuide(1, {
          profissional: { ...consultaGuide(1).profissional, cbo: '123456' },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N09-consulta-conselho-fora-do-dominio',
      matrix: ['V9'],
      guideType: 'consulta',
      title: 'Conselho profissional 99, fora da tabela 26',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['COUNCIL_DOMAIN'],
      input: consultaBatch([
        consultaGuide(1, {
          profissional: { ...consultaGuide(1).profissional, conselho: '99' },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N12-consulta-cnes-8-digitos',
      matrix: ['V12'],
      guideType: 'consulta',
      title: 'CNES com 8 dígitos',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['CNES_FORMAT'],
      input: consultaBatch([
        consultaGuide(1, {
          contratado: {
            kind: 'codigoPrestadorNaOperadora',
            value: SYNTHETIC.providerCode,
            cnes: '12345678',
          },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N13-consulta-cnpj-formato',
      matrix: ['V13'],
      guideType: 'consulta',
      title: 'CNPJ fora do formato (3 letras)',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['CONTRACTOR_CNPJ'],
      input: consultaBatch([
        consultaGuide(1, { contratado: { kind: 'cnpjContratado', value: 'ABC', cnes: '9999999' } }),
      ]),
    }),
    fromBuilder({
      id: 'N16a-consulta-valor-3-casas',
      matrix: ['V16'],
      guideType: 'consulta',
      title: 'Valor com 3 casas decimais',
      rejectedBy: ['xsd', 'rules'],
      expectedIssues: ['PROCEDURE_VALUE_FORMAT'],
      input: consultaBatch([
        consultaGuide(1, {
          atendimento: consultaAtendimento({ procedimento: { valorProcedimento: '150.001' } }),
        }),
      ]),
    }),

    // ── Inválidos só pelas regras (o XSD aceita) ───────────────────────
    fromBuilder({
      id: 'N16b-consulta-valor-negativo',
      matrix: ['V16'],
      guideType: 'consulta',
      title: 'Valor negativo: o XSD (st_decimal10-2) não tem mínimo',
      rejectedBy: ['rules'],
      expectedIssues: ['PROCEDURE_VALUE_FORMAT'],
      input: consultaBatch([
        consultaGuide(1, {
          atendimento: consultaAtendimento({ procedimento: { valorProcedimento: '-1.00' } }),
        }),
      ]),
    }),
    fromBuilder({
      id: 'N10-consulta-tuss-inexistente',
      matrix: ['V10'],
      guideType: 'consulta',
      title: 'Código TUSS 99999999, inexistente na tabela 22',
      rejectedBy: ['rules'],
      expectedIssues: ['PROCEDURE_CODE_UNKNOWN'],
      input: consultaBatch([
        consultaGuide(1, {
          atendimento: consultaAtendimento({ procedimento: { codigoProcedimento: '99999999' } }),
        }),
      ]),
    }),
    fromBuilder({
      id: 'N11-consulta-tuss-fora-de-vigencia',
      matrix: ['V11'],
      guideType: 'consulta',
      title: 'TUSS 50000802 (vigente até 31/12/2026) em atendimento de 05/01/2027',
      rejectedBy: ['rules'],
      expectedIssues: ['PROCEDURE_CODE_NOT_EFFECTIVE'],
      rules: { today: '2027-01-10' },
      input: consultaBatch([
        consultaGuide(1, {
          atendimento: consultaAtendimento({
            dataAtendimento: '2027-01-05',
            procedimento: { codigoProcedimento: '50000802' },
          }),
        }),
      ]),
    }),
    fromBuilder({
      id: 'N15a-consulta-atendimento-futuro',
      matrix: ['V15'],
      guideType: 'consulta',
      title: 'Atendimento em data futura',
      rejectedBy: ['rules'],
      expectedIssues: ['SERVICE_DATE_IN_FUTURE'],
      input: consultaBatch([
        consultaGuide(1, { atendimento: consultaAtendimento({ dataAtendimento: '2026-12-15' }) }),
      ]),
    }),
    fromBuilder({
      id: 'N15b-sadt-senha-vence-antes-da-autorizacao',
      matrix: ['V15'],
      guideType: 'sp_sadt',
      title: 'Validade da senha anterior à data da autorização',
      rejectedBy: ['rules'],
      expectedIssues: ['PASSWORD_VALIDITY_BEFORE_AUTHORIZATION'],
      input: sadtBatch([
        sadtGuide(1, {
          autorizacao: { ...sadtGuide(1).autorizacao!, dataValidadeSenha: '2026-10-01' },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N-sadt-terapia-sem-indicacao-clinica',
      matrix: ['V14'],
      guideType: 'sp_sadt',
      title: 'Terapia (tipo 03) sem indicação clínica: pendência do médico',
      rejectedBy: ['rules'],
      expectedIssues: ['CLINICAL_INDICATION_REQUIRED'],
      input: sadtBatch([
        sadtGuide(1, {
          solicitacao: { dataSolicitacao: '2026-10-30', caraterAtendimento: '1' },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N22-consulta-guias-duplicadas',
      matrix: ['V22'],
      guideType: 'consulta',
      title: 'Duas guias com o mesmo número no lote',
      rejectedBy: ['rules'],
      expectedIssues: ['GUIDE_NUMBER_DUPLICATED'],
      input: consultaBatch([consultaGuide(1), consultaGuide(1)]),
    }),
    fromBuilder({
      id: 'N24-consulta-versao-4-02-00',
      matrix: ['V24'],
      guideType: 'consulta',
      title: 'Padrao 4.02.00 com estrutura 4.03.00 (o XSD aceita a versão no campo)',
      rejectedBy: ['rules'],
      expectedIssues: ['BATCH_VERSION'],
      input: consultaBatch([consultaGuide(1)], { padrao: '4.02.00' as '4.03.00' }),
    }),
    fromBuilder({
      id: 'N-consulta-operadora-diferente-do-destino',
      matrix: ['V22'],
      guideType: 'consulta',
      title: 'Guia de outra operadora dentro do lote',
      rejectedBy: ['rules'],
      expectedIssues: ['GUIDE_OPERATOR_MISMATCH'],
      input: consultaBatch([consultaGuide(1), consultaGuide(2, { registroANS: '654321' })]),
    }),
    fromBuilder({
      id: 'N-consulta-cnpj-digito-errado',
      matrix: ['V13'],
      guideType: 'consulta',
      title: 'CNPJ alfanumérico no formato certo, com dígito verificador errado',
      rejectedBy: ['rules'],
      expectedIssues: ['CONTRACTOR_CNPJ'],
      input: consultaBatch([
        consultaGuide(1, {
          contratado: { kind: 'cnpjContratado', value: '12ABC34501DE36', cnes: '9999999' },
        }),
      ]),
    }),
    fromBuilder({
      id: 'N-consulta-cpf-digito-errado',
      matrix: ['V13'],
      guideType: 'consulta',
      title: 'CPF no formato certo, com dígito verificador errado',
      rejectedBy: ['rules'],
      expectedIssues: ['CONTRACTOR_CPF'],
      rules: { contractorPerson: 'PF' },
      input: consultaBatch([
        consultaGuide(1, {
          contratado: { kind: 'cpfContratado', value: '00000000192', cnes: '9999999' },
          profissional: { conselho: '06', numeroConselho: '000001', uf: '35', cbo: '225125' },
        }),
      ]),
    }),

    // ── Recusados pelo próprio gerador (sem arquivo) ───────────────────
    fromBuilder({
      id: 'B-consulta-nome-fora-do-latin1',
      matrix: ['V17'],
      guideType: 'consulta',
      title: 'Nome com caractere fora do ISO-8859-1 (Nguyễn): o gerador recusa, nunca troca',
      rejectedBy: ['builder', 'rules'],
      expectedIssues: ['ENCODING_NOT_LATIN1'],
      input: consultaBatch([
        consultaGuide(1, {
          profissional: { ...consultaGuide(1).profissional, nome: 'Nguyễn Teste' },
        }),
      ]),
    }),

    // ── Montagem sem as travas do gerador ──────────────────────────────
    {
      id: 'N05-consulta-lote-101-guias',
      matrix: ['V5'],
      guideType: 'consulta',
      title: 'Lote com 101 guias: o gerador recusa; o arquivo vem da montagem sem travas',
      expected: 'invalid',
      rejectedBy: ['builder', 'xsd', 'rules'],
      expectedIssues: ['BATCH_TOO_LARGE'],
      origin: 'unguarded',
      rules: RULES,
      input: consultaBatch(Array.from({ length: 101 }, (_, i) => consultaGuide(i + 1))),
      bytes: () =>
        assembleLoteGuiasMessage(
          consultaBatch([]),
          Array.from({ length: 101 }, (_, i) => consultaGuideElement(consultaGuide(i + 1))),
        ).bytes,
    },
    {
      id: 'N23-lote-tipos-misturados',
      matrix: ['V23'],
      guideType: 'misto',
      title:
        'Consulta e SP/SADT no mesmo lote: impossível nos tipos do app; arquivo da montagem sem travas',
      expected: 'invalid',
      rejectedBy: ['xsd'],
      origin: 'unguarded',
      rules: RULES,
      input: null,
      bytes: () =>
        assembleLoteGuiasMessage(consultaBatch([]), [
          consultaGuideElement(consultaGuide(1)),
          spSadtGuideElement(sadtGuide(2, { procedimentos: [sadtItem(1, { equipe: sadtTeam })] })),
        ]).bytes,
    },

    // ── Mutações controladas (defeitos que o gerador não produz) ───────
    fromMutation(
      {
        id: 'M17-consulta-utf8-declarado-iso',
        matrix: ['V17'],
        guideType: 'consulta',
        title: 'Texto gravado em UTF-8 com declaração ISO-8859-1 (o XSD não detecta)',
        rejectedBy: ['encoding', 'hash'],
        mutation: 'mesmo texto do V18 gravado em UTF-8 em vez de ISO-8859-1',
        input: consultaBatch([
          consultaGuide(1, {
            profissional: { ...consultaGuide(1).profissional, nome: 'Conceição Araújo Müller' },
          }),
        ]),
      },
      (built) => Buffer.from(built.xml, 'utf8'),
    ),
    fromMutation(
      {
        id: 'M19-consulta-namespace-incorreto',
        matrix: ['V19'],
        guideType: 'consulta',
        title: 'Namespace TISS trocado',
        rejectedBy: ['xsd'],
        mutation: `namespace ${TISS_NAMESPACE} trocado por ${TISS_NAMESPACE}/errado`,
        input: base,
      },
      (built) =>
        Buffer.from(built.xml.replace(TISS_NAMESPACE, `${TISS_NAMESPACE}/errado`), 'latin1'),
    ),
    fromMutation(
      {
        id: 'M20-consulta-hash-incorreto',
        matrix: ['V20'],
        guideType: 'consulta',
        title: 'Hash do epílogo trocado por 32 zeros',
        rejectedBy: ['hash'],
        mutation: 'hash do epílogo substituído por 00000000000000000000000000000000',
        input: base,
      },
      (built) =>
        Buffer.from(
          built.xml.replace(
            `<ans:hash>${built.hash}</ans:hash>`,
            `<ans:hash>${'0'.repeat(32)}</ans:hash>`,
          ),
          'latin1',
        ),
    ),
    fromMutation(
      {
        id: 'M21-consulta-truncado',
        matrix: ['V21'],
        guideType: 'consulta',
        title: 'Arquivo truncado na metade',
        rejectedBy: ['xsd', 'hash'],
        mutation: 'primeira metade dos bytes do V1a',
        input: base,
      },
      (built) => built.bytes.subarray(0, Math.floor(built.bytes.length / 2)),
    ),
  ];
}
