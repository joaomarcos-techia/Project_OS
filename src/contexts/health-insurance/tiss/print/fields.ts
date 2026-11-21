/**
 * Mapeamento OFICIAL dos campos dos modelos impressos (legendas da ANS, Conteúdo e
 * Estrutura 202511: Consulta p. 470–473; SP/SADT p. 521–531) para o Qoro.
 *
 * O rótulo de cada campo vem do próprio modelo (`official-model.ts`); aqui ficam a
 * condição de preenchimento da legenda, a ORIGEM do valor e de onde ele sai no Qoro.
 *
 * O impresso e o XML NÃO têm os mesmos campos (B.10.2): o nome do beneficiário e o
 * nome do contratado executante são obrigatórios no papel e não existem no XML
 * 4.03.00. Eles vêm do bloco `print` do snapshot, congelado na emissão, e nunca
 * entram no XML. Assinaturas, validade da carteira (só na contingência em papel) e
 * datas de procedimentos em série são preenchidas à mão.
 */

export type PrintRule = 'obrigatorio' | 'condicionado' | 'opcional';
export type PrintSource =
  /** Mesmo dado do XML emitido (o snapshot aprovado). */
  | 'xml'
  /** Só existe no impresso; congelado no snapshot na emissão (`print`), fora do XML. */
  | 'impresso'
  /** Preenchido à mão no papel (assinatura, contingência). */
  | 'manual';

export interface PrintFieldSpec {
  no: number;
  rule: PrintRule;
  source: PrintSource;
  /** Caminho no XML (`ctm_consultaGuia`/`ctm_sp-sadtGuia`/`ctm_sp-sadtSolicitacaoGuia`) quando `source = xml`. */
  xml?: string;
  /** De onde o valor sai no Qoro, ou por que fica em branco. */
  qoro: string;
}

const f = (no: number, rule: PrintRule, source: PrintSource, qoro: string, xml?: string): PrintFieldSpec => ({
  no,
  rule,
  source,
  qoro,
  ...(xml ? { xml } : {}),
});

/** Guia de Consulta: campos 1–7 e 9–29 (o 8, CNS, saiu do modelo). */
export const CONSULTA_FIELDS: readonly PrintFieldSpec[] = [
  f(1, 'obrigatorio', 'xml', 'operadora: hi_insurers.registro_ans', 'cabecalhoConsulta/registroANS'),
  f(2, 'obrigatorio', 'xml', 'numeração da clínica (hi_counters), alocada uma vez', 'cabecalhoConsulta/numeroGuiaPrestador'),
  f(3, 'condicionado', 'xml', 'número que a operadora atribuiu (autorização), só se existir', 'numeroGuiaOperadora'),
  f(4, 'obrigatorio', 'xml', 'carteirinha: leitura auditada na emissão', 'dadosBeneficiario/numeroCarteira'),
  f(5, 'condicionado', 'manual', 'só na contingência em papel sem autorização obtida: o Qoro não usa contingência; fica em branco'),
  f(6, 'obrigatorio', 'xml', 'recém-nato no contrato do responsável (S/N), informado na emissão', 'dadosBeneficiario/atendimentoRN'),
  f(7, 'obrigatorio', 'impresso', 'nome do paciente congelado na emissão (print.beneficiarioNome); não existe no XML 4.03.00'),
  f(9, 'obrigatorio', 'xml', 'identificação do contratado na operadora (código, CPF ou CNPJ do cadastro da operadora)', 'contratadoExecutante/(codigoPrestadorNaOperadora|cpfContratado|cnpjContratado)'),
  f(10, 'obrigatorio', 'impresso', 'nome do contratado congelado na emissão (print.contratadoNome: nome do contratado da configuração ou nome da clínica); não existe no XML'),
  f(11, 'obrigatorio', 'xml', 'CNES da clínica, ou 9999999 quando declarado que não tem', 'contratadoExecutante/CNES'),
  f(12, 'condicionado', 'xml', 'nome do profissional (obrigatório quando o contratado é PJ)', 'profissionalExecutante/nomeProfissional'),
  f(13, 'obrigatorio', 'xml', 'perfil TISS do profissional: conselho (tabela 26)', 'profissionalExecutante/conselhoProfissional'),
  f(14, 'obrigatorio', 'xml', 'perfil TISS do profissional: número no conselho', 'profissionalExecutante/numeroConselhoProfissional'),
  f(15, 'obrigatorio', 'xml', 'perfil TISS do profissional: UF do conselho (tabela 59, código)', 'profissionalExecutante/UF'),
  f(16, 'obrigatorio', 'xml', 'perfil TISS do profissional: CBO (tabela 24)', 'profissionalExecutante/CBOS'),
  f(17, 'obrigatorio', 'xml', 'indicação de acidente (tabela 36)', 'indicacaoAcidente'),
  f(18, 'obrigatorio', 'xml', 'data do atendimento', 'dadosAtendimento/dataAtendimento'),
  f(19, 'obrigatorio', 'xml', 'tipo de consulta (tabela 52), primeira ou seguimento', 'dadosAtendimento/tipoConsulta'),
  f(20, 'obrigatorio', 'xml', 'tabela do procedimento (tabela 87)', 'dadosAtendimento/procedimento/codigoTabela'),
  f(21, 'obrigatorio', 'xml', 'código TUSS do contrato do item', 'dadosAtendimento/procedimento/codigoProcedimento'),
  f(22, 'obrigatorio', 'xml', 'valor do contrato do item (zero se o contrato não define)', 'dadosAtendimento/procedimento/valorProcedimento'),
  f(23, 'opcional', 'xml', 'observação escrita na guia (até 500)', 'observacao'),
  f(24, 'obrigatorio', 'manual', 'assinatura do profissional executante, no papel'),
  f(25, 'obrigatorio', 'manual', 'assinatura do beneficiário ou responsável, no papel'),
  f(26, 'condicionado', 'impresso', 'nome social só quando o beneficiário pede (Decreto 8.727): o Qoro não coleta; fica em branco, para preencher à mão'),
  f(27, 'opcional', 'xml', 'cobertura especial (tabela 75), quando houver', 'dadosAtendimento/coberturaEspecial'),
  f(28, 'obrigatorio', 'xml', 'regime de atendimento (tabela 76)', 'dadosAtendimento/regimeAtendimento'),
  f(29, 'opcional', 'xml', 'saúde ocupacional (tabela 77), quando houver', 'dadosAtendimento/saudeOcupacional'),
];

/**
 * Guia SP/SADT: campos 1–10, 12–68 e 89–92 (o 11, CNS, saiu do modelo). O MESMO
 * modelo serve à solicitação e à cobrança: na solicitação, os campos de execução
 * (32–55 e 59–65) ficam em branco; na cobrança, o bloco de solicitação (24–28) vem
 * da solicitação vinculada congelada no snapshot, quando existir.
 */
export const SP_SADT_FIELDS: readonly PrintFieldSpec[] = [
  f(1, 'obrigatorio', 'xml', 'operadora: hi_insurers.registro_ans', 'cabecalhoGuia/registroANS'),
  f(2, 'obrigatorio', 'xml', 'numeração da clínica (hi_counters)', 'cabecalhoGuia/numeroGuiaPrestador'),
  f(3, 'condicionado', 'xml', 'guia principal (SADT em internado ou honorário em separado)', 'cabecalhoGuia/guiaPrincipal'),
  f(4, 'condicionado', 'xml', 'data da autorização concedida pela operadora (nunca presumida)', 'dadosAutorizacao/dataAutorizacao'),
  f(5, 'condicionado', 'xml', 'senha emitida pela operadora', 'dadosAutorizacao/senha'),
  f(6, 'condicionado', 'xml', 'validade da senha', 'dadosAutorizacao/dataValidadeSenha'),
  f(7, 'condicionado', 'xml', 'número que a operadora atribuiu', 'dadosAutorizacao/numeroGuiaOperadora'),
  f(8, 'obrigatorio', 'xml', 'carteirinha: leitura auditada na emissão', 'dadosBeneficiario/numeroCarteira'),
  f(9, 'condicionado', 'manual', 'só na contingência em papel: o Qoro não usa contingência; fica em branco'),
  f(10, 'obrigatorio', 'impresso', 'nome do paciente congelado na emissão (print.beneficiarioNome); não existe no XML'),
  f(12, 'obrigatorio', 'xml', 'recém-nato no contrato do responsável (S/N)', 'dadosBeneficiario/atendimentoRN'),
  f(13, 'obrigatorio', 'xml', 'contratado solicitante na operadora', 'dadosSolicitante/contratadoSolicitante'),
  f(14, 'obrigatorio', 'xml', 'nome do contratado solicitante', 'dadosSolicitante/nomeContratadoSolicitante'),
  f(15, 'condicionado', 'xml', 'nome do profissional solicitante (contratado PJ)', 'dadosSolicitante/profissionalSolicitante/nomeProfissional'),
  f(16, 'obrigatorio', 'xml', 'conselho do solicitante (tabela 26)', 'dadosSolicitante/profissionalSolicitante/conselhoProfissional'),
  f(17, 'obrigatorio', 'xml', 'número no conselho do solicitante', 'dadosSolicitante/profissionalSolicitante/numeroConselhoProfissional'),
  f(18, 'obrigatorio', 'xml', 'UF do conselho do solicitante (tabela 59)', 'dadosSolicitante/profissionalSolicitante/UF'),
  f(19, 'obrigatorio', 'xml', 'CBO do solicitante (tabela 24)', 'dadosSolicitante/profissionalSolicitante/CBOS'),
  f(20, 'obrigatorio', 'manual', 'assinatura do profissional solicitante, no papel'),
  f(21, 'obrigatorio', 'xml', 'caráter do atendimento (tabela 23)', 'dadosSolicitacao/caraterAtendimento'),
  f(22, 'condicionado', 'xml', 'data da solicitação', 'dadosSolicitacao/dataSolicitacao'),
  f(23, 'condicionado', 'xml', 'só o texto que o profissional escreveu para esta solicitação; nunca copiado do prontuário (D17)', 'dadosSolicitacao/indicacaoClinica'),
  f(24, 'obrigatorio', 'xml', 'tabela do item solicitado (solicitação) ou da solicitação vinculada (cobrança)', 'procedimentosSolicitados/procedimento/codigoTabela'),
  f(25, 'obrigatorio', 'xml', 'código do item solicitado', 'procedimentosSolicitados/procedimento/codigoProcedimento'),
  f(26, 'obrigatorio', 'xml', 'descrição TUSS do item solicitado', 'procedimentosSolicitados/procedimento/descricaoProcedimento'),
  f(27, 'obrigatorio', 'xml', 'quantidade solicitada', 'procedimentosSolicitados/quantidadeSolicitada'),
  f(28, 'obrigatorio', 'impresso', 'quantidade autorizada pela operadora: só da autorização registrada; na solicitação, em branco'),
  f(29, 'obrigatorio', 'xml', 'contratado executante na operadora', 'dadosExecutante/contratadoExecutante'),
  f(30, 'obrigatorio', 'impresso', 'nome do contratado executante congelado na emissão (print.contratadoNome); não existe no XML'),
  f(31, 'obrigatorio', 'xml', 'CNES do executante (ou 9999999)', 'dadosExecutante/CNES'),
  f(32, 'obrigatorio', 'xml', 'tipo de atendimento (tabela 50) — cobrança', 'dadosAtendimento/tipoAtendimento'),
  f(33, 'obrigatorio', 'xml', 'indicação de acidente (tabela 36) — cobrança', 'dadosAtendimento/indicacaoAcidente'),
  f(34, 'condicionado', 'xml', 'tipo de consulta (tabela 52), se o atendimento for consulta', 'dadosAtendimento/tipoConsulta'),
  f(35, 'condicionado', 'xml', 'motivo de encerramento (tabela 39), em caso de óbito', 'dadosAtendimento/motivoEncerramento'),
  f(36, 'condicionado', 'xml', 'data de execução de cada item', 'procedimentosExecutados/procedimentoExecutado/dataExecucao'),
  f(37, 'condicionado', 'xml', 'hora inicial (urgência/emergência)', 'procedimentosExecutados/procedimentoExecutado/horaInicial'),
  f(38, 'condicionado', 'xml', 'hora final (urgência/emergência)', 'procedimentosExecutados/procedimentoExecutado/horaFinal'),
  f(39, 'condicionado', 'xml', 'tabela do item executado', 'procedimentosExecutados/procedimentoExecutado/procedimento/codigoTabela'),
  f(40, 'condicionado', 'xml', 'código do item executado', 'procedimentosExecutados/procedimentoExecutado/procedimento/codigoProcedimento'),
  f(41, 'condicionado', 'xml', 'descrição do item executado', 'procedimentosExecutados/procedimentoExecutado/procedimento/descricaoProcedimento'),
  f(42, 'condicionado', 'xml', 'quantidade executada', 'procedimentosExecutados/procedimentoExecutado/quantidadeExecutada'),
  f(43, 'condicionado', 'xml', 'via de acesso (tabela 61), procedimento cirúrgico', 'procedimentosExecutados/procedimentoExecutado/viaAcesso'),
  f(44, 'condicionado', 'xml', 'técnica (tabela 48), procedimento cirúrgico', 'procedimentosExecutados/procedimentoExecutado/tecnicaUtilizada'),
  f(45, 'condicionado', 'xml', 'fator de redução/acréscimo (1,00 sem redução)', 'procedimentosExecutados/procedimentoExecutado/reducaoAcrescimo'),
  f(46, 'condicionado', 'xml', 'valor unitário do contrato', 'procedimentosExecutados/procedimentoExecutado/valorUnitario'),
  f(47, 'condicionado', 'xml', 'valor total do item (quantidade × unitário × fator)', 'procedimentosExecutados/procedimentoExecutado/valorTotal'),
  f(48, 'condicionado', 'impresso', 'sequencial de referência do item da equipe (número da linha), derivado do item'),
  f(49, 'condicionado', 'xml', 'grau de participação (tabela 35)', 'procedimentoExecutado/equipeSadt/grauPart'),
  f(50, 'condicionado', 'xml', 'código na operadora ou CPF do profissional da equipe', 'procedimentoExecutado/equipeSadt/codProfissional'),
  f(51, 'condicionado', 'xml', 'nome do profissional da equipe', 'procedimentoExecutado/equipeSadt/nomeProf'),
  f(52, 'condicionado', 'xml', 'conselho do profissional da equipe', 'procedimentoExecutado/equipeSadt/conselho'),
  f(53, 'condicionado', 'xml', 'número no conselho do profissional da equipe', 'procedimentoExecutado/equipeSadt/numeroConselhoProfissional'),
  f(54, 'condicionado', 'xml', 'UF do conselho do profissional da equipe', 'procedimentoExecutado/equipeSadt/UF'),
  f(55, 'condicionado', 'xml', 'CBO do profissional da equipe', 'procedimentoExecutado/equipeSadt/CBOS'),
  f(56, 'condicionado', 'manual', 'datas de procedimentos em série: preenchidas à mão a cada sessão (o Qoro ainda não emite série)'),
  f(57, 'obrigatorio', 'manual', 'assinatura do beneficiário em cada sessão da série, no papel'),
  f(58, 'opcional', 'xml', 'observação escrita na guia (até 500)', 'observacao'),
  f(59, 'condicionado', 'xml', 'total de procedimentos — cobrança', 'valorTotal/valorProcedimentos'),
  f(60, 'condicionado', 'xml', 'total de taxas e aluguéis: o Qoro não fatura outras despesas; em branco', 'valorTotal/valorTaxasAlugueis'),
  f(61, 'condicionado', 'xml', 'total de materiais: idem', 'valorTotal/valorMateriais'),
  f(62, 'condicionado', 'xml', 'total de OPME: idem', 'valorTotal/valorOPME'),
  f(63, 'condicionado', 'xml', 'total de medicamentos: idem', 'valorTotal/valorMedicamentos'),
  f(64, 'condicionado', 'xml', 'total de gases medicinais: idem', 'valorTotal/valorGasesMedicinais'),
  f(65, 'obrigatorio', 'xml', 'total geral — cobrança', 'valorTotal/valorTotalGeral'),
  f(66, 'obrigatorio', 'manual', 'assinatura do responsável pela autorização (operadora), no papel'),
  f(67, 'obrigatorio', 'manual', 'assinatura do beneficiário ou responsável, no papel'),
  f(68, 'obrigatorio', 'manual', 'assinatura do contratado, no papel'),
  f(89, 'condicionado', 'impresso', 'nome social só quando o beneficiário pede: o Qoro não coleta; em branco'),
  f(90, 'opcional', 'xml', 'cobertura especial (tabela 75), quando houver', 'dadosSolicitacao/indCobEspecial'),
  f(91, 'obrigatorio', 'xml', 'regime de atendimento (tabela 76) — cobrança', 'dadosAtendimento/regimeAtendimento'),
  f(92, 'opcional', 'xml', 'saúde ocupacional (tabela 77) — cobrança, quando houver', 'dadosAtendimento/saudeOcupacional'),
];
