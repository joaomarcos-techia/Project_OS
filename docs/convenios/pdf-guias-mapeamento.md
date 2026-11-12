# PDFs oficiais das guias TISS — mapeamento campo a campo

> Gerado por `scripts/tiss/print/mapping-doc.ts` a partir de `src/contexts/health-insurance/tiss/print/fields.ts` e do
> modelo oficial extraído (`src/contexts/health-insurance/tiss/print/models/`). Não editar à mão.

**Fonte oficial:** Padrão TISS — Componente de Conteúdo e Estrutura 202511 (zip SHA-256
`6a720ed27da8397fef584e30d794aa56f18906d253ccdf460c30b1019a3a4d3b`; PDF `d96ab600aa82e936738b81d18381305bde79b0aa5ede285b5b1cd6376c213d9a`). Guia de Consulta: modelo na p. 469,
legenda nas p. 470–473. Guia SP/SADT: modelo na p. 520, legenda nas p. 521–531.

## Decisões do mapeamento

1. **O impresso e o XML não têm os mesmos campos.** O papel exige o nome do beneficiário (Consulta 7, SP/SADT 10) e o
   nome do contratado executante (Consulta 10, SP/SADT 30), que não existem no XML 4.03.00. Eles são lidos na transação
   da emissão e gravados no snapshot cifrado, no bloco `print`, **fora** do dado do XML: o construtor do XML nunca os
   lê, e o PDF nunca relê o cadastro atual.
2. **Um modelo só para a SP/SADT.** A ANS tem um formulário único de SP/SADT, com o bloco de solicitação (21–28) e o de
   execução (32–55, 59–65). O Qoro gera o mesmo modelo nos dois usos: na solicitação, execução, autorização (4–7) e
   quantidade autorizada (28) ficam em branco (são da operadora ou do atendimento); na cobrança, o bloco de solicitação
   vem da solicitação vinculada congelada no snapshot, ou fica em branco (o executado nunca vira "solicitado").
3. **Nada fictício.** Campo sem dado fica em branco: nome social (o Qoro não coleta), validade da carteira (só na
   contingência em papel), assinaturas e datas de série (à mão), totais de outras despesas (o Qoro não as fatura).
4. **Layout:** caixas, faixas, título e rótulos são desenhados nas coordenadas extraídas do PDF oficial (A4 paisagem).
   No lugar do exemplo "12345678901234567890" vai o número da guia; no do "Logo da Empresa", o nome da operadora (o
   Qoro não guarda logotipo de terceiro). As máscaras de preenchimento à mão (`|___|`) não são reproduzidas.
5. **Texto longo:** o valor é quebrado e o corpo reduzido até caber na caixa; se não couber no corpo mínimo, a caixa
   mostra o início e o aviso, e o texto **integral** vai para a folha de continuação. Nada é cortado em silêncio.
6. **Paginação (SP/SADT):** 5 linhas de procedimentos solicitados, 5 de executados e 4 de equipe por folha, como no
   modelo; com mais itens, novas folhas do mesmo modelo, numeração contínua e totais (59–65) só na última.
7. **Rastreabilidade (R36/S7):** rodapé com software, número da guia, revisão, início do SHA-256 do snapshot e a página
   do modelo da ANS. Metadados do PDF sem dado pessoal.
8. **CID:** não existe na Consulta nem na SP/SADT 4.03.00 e nunca é impresso. A indicação clínica (SP/SADT 23) é só o
   texto que o profissional escreveu para a solicitação, nunca copiado do prontuário (D17).

## Guia de Consulta (28 campos: 1–7 e 9–29; o 8, CNS, saiu do modelo)

| Nº | Rótulo no modelo oficial | Condição (legenda ANS) | Origem no Qoro | Caminho no XML | De onde vem / por que fica em branco |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 - Registro ANS | Obrigatório | XML (snapshot) | `cabecalhoConsulta/registroANS` | operadora: hi_insurers.registro_ans |
| 2 | 2- Nº Guia no Prestador | Obrigatório | XML (snapshot) | `cabecalhoConsulta/numeroGuiaPrestador` | numeração da clínica (hi_counters), alocada uma vez |
| 3 | 3 - Número da Guia Atribuído pela Operadora | Condicionado | XML (snapshot) | `numeroGuiaOperadora` | número que a operadora atribuiu (autorização), só se existir |
| 4 | 4 - Número da Carteira | Obrigatório | XML (snapshot) | `dadosBeneficiario/numeroCarteira` | carteirinha: leitura auditada na emissão |
| 5 | 5 - Validade da Carteira | Condicionado | à mão no papel | — | só na contingência em papel sem autorização obtida: o Qoro não usa contingência; fica em branco |
| 6 | 6 – Atendimento a RN (Sim ou Não) | Obrigatório | XML (snapshot) | `dadosBeneficiario/atendimentoRN` | recém-nato no contrato do responsável (S/N), informado na emissão |
| 7 | 7 – Nome | Obrigatório | só impresso (snapshot `print`) | — | nome do paciente congelado na emissão (print.beneficiarioNome); não existe no XML 4.03.00 |
| 9 | 9- Código na Operadora | Obrigatório | XML (snapshot) | `contratadoExecutante/(codigoPrestadorNaOperadora\|cpfContratado\|cnpjContratado)` | identificação do contratado na operadora (código, CPF ou CNPJ do cadastro da operadora) |
| 10 | 10 - Nome do Contratado | Obrigatório | só impresso (snapshot `print`) | — | nome do contratado congelado na emissão (print.contratadoNome: nome do contratado da configuração ou nome da clínica); não existe no XML |
| 11 | 11 - Código CNES | Obrigatório | XML (snapshot) | `contratadoExecutante/CNES` | CNES da clínica, ou 9999999 quando declarado que não tem |
| 12 | 12 - Nome do Profissional Executante | Condicionado | XML (snapshot) | `profissionalExecutante/nomeProfissional` | nome do profissional (obrigatório quando o contratado é PJ) |
| 13 | 13 - Conselho | Obrigatório | XML (snapshot) | `profissionalExecutante/conselhoProfissional` | perfil TISS do profissional: conselho (tabela 26) |
| 14 | 14 - Número no Conselho | Obrigatório | XML (snapshot) | `profissionalExecutante/numeroConselhoProfissional` | perfil TISS do profissional: número no conselho |
| 15 | 15 - UF | Obrigatório | XML (snapshot) | `profissionalExecutante/UF` | perfil TISS do profissional: UF do conselho (tabela 59, código) |
| 16 | 16 - Código CBO | Obrigatório | XML (snapshot) | `profissionalExecutante/CBOS` | perfil TISS do profissional: CBO (tabela 24) |
| 17 | 17 - Indicação de Acidente (acidente ou doença | Obrigatório | XML (snapshot) | `indicacaoAcidente` | indicação de acidente (tabela 36) |
| 18 | 18 - Data do Atendimento | Obrigatório | XML (snapshot) | `dadosAtendimento/dataAtendimento` | data do atendimento |
| 19 | 19 - Tipo de Consulta | Obrigatório | XML (snapshot) | `dadosAtendimento/tipoConsulta` | tipo de consulta (tabela 52), primeira ou seguimento |
| 20 | 20 - Tabela | Obrigatório | XML (snapshot) | `dadosAtendimento/procedimento/codigoTabela` | tabela do procedimento (tabela 87) |
| 21 | 21 - Código do Procedimento | Obrigatório | XML (snapshot) | `dadosAtendimento/procedimento/codigoProcedimento` | código TUSS do contrato do item |
| 22 | 22 - Valor do Procedimento | Obrigatório | XML (snapshot) | `dadosAtendimento/procedimento/valorProcedimento` | valor do contrato do item (zero se o contrato não define) |
| 23 | 23 - Observação / Justificativa | Opcional | XML (snapshot) | `observacao` | observação escrita na guia (até 500) |
| 24 | 24 - Assinatura do Profissional Executante | Obrigatório | à mão no papel | — | assinatura do profissional executante, no papel |
| 25 | 25 - Assinatura do Beneficiário ou Responsável | Obrigatório | à mão no papel | — | assinatura do beneficiário ou responsável, no papel |
| 26 | 26 – Nome Social | Condicionado | só impresso (snapshot `print`) | — | nome social só quando o beneficiário pede (Decreto 8.727): o Qoro não coleta; fica em branco, para preencher à mão |
| 27 | 27 - Indicador de Cobertura Especial | Opcional | XML (snapshot) | `dadosAtendimento/coberturaEspecial` | cobertura especial (tabela 75), quando houver |
| 28 | 28 -Regime de Atendimento | Obrigatório | XML (snapshot) | `dadosAtendimento/regimeAtendimento` | regime de atendimento (tabela 76) |
| 29 | 29 – Saúde Ocupacional | Opcional | XML (snapshot) | `dadosAtendimento/saudeOcupacional` | saúde ocupacional (tabela 77), quando houver |

## Guia SP/SADT — cobrança e solicitação (71 campos: 1–10, 12–68 e 89–92; o 11, CNS, saiu do modelo)

| Nº | Rótulo no modelo oficial | Condição (legenda ANS) | Origem no Qoro | Caminho no XML | De onde vem / por que fica em branco |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 - Registro ANS | Obrigatório | XML (snapshot) | `cabecalhoGuia/registroANS` | operadora: hi_insurers.registro_ans |
| 2 | 2- Nº Guia no Prestador | Obrigatório | XML (snapshot) | `cabecalhoGuia/numeroGuiaPrestador` | numeração da clínica (hi_counters) |
| 3 | 3 – Número da Guia Principal | Condicionado | XML (snapshot) | `cabecalhoGuia/guiaPrincipal` | guia principal (SADT em internado ou honorário em separado) |
| 4 | 4 - Data da Autorização | Condicionado | XML (snapshot) | `dadosAutorizacao/dataAutorizacao` | data da autorização concedida pela operadora (nunca presumida) |
| 5 | 5-Senha | Condicionado | XML (snapshot) | `dadosAutorizacao/senha` | senha emitida pela operadora |
| 6 | 6 - Data de Validade da Senha | Condicionado | XML (snapshot) | `dadosAutorizacao/dataValidadeSenha` | validade da senha |
| 7 | 7 - Número da Guia Atribuído pela Operadora | Condicionado | XML (snapshot) | `dadosAutorizacao/numeroGuiaOperadora` | número que a operadora atribuiu |
| 8 | 8 - Número da Carteira | Obrigatório | XML (snapshot) | `dadosBeneficiario/numeroCarteira` | carteirinha: leitura auditada na emissão |
| 9 | 9 - Validade da Carteira | Condicionado | à mão no papel | — | só na contingência em papel: o Qoro não usa contingência; fica em branco |
| 10 | 10 - Nome | Obrigatório | só impresso (snapshot `print`) | — | nome do paciente congelado na emissão (print.beneficiarioNome); não existe no XML |
| 12 | 12 -Atendimento a RN | Obrigatório | XML (snapshot) | `dadosBeneficiario/atendimentoRN` | recém-nato no contrato do responsável (S/N) |
| 13 | 13 - Código na Operadora | Obrigatório | XML (snapshot) | `dadosSolicitante/contratadoSolicitante` | contratado solicitante na operadora |
| 14 | 14 - Nome do Contratado | Obrigatório | XML (snapshot) | `dadosSolicitante/nomeContratadoSolicitante` | nome do contratado solicitante |
| 15 | 15 - Nome do Profissional Solicitante | Condicionado | XML (snapshot) | `dadosSolicitante/profissionalSolicitante/nomeProfissional` | nome do profissional solicitante (contratado PJ) |
| 16 | 16 - Conselho | Obrigatório | XML (snapshot) | `dadosSolicitante/profissionalSolicitante/conselhoProfissional` | conselho do solicitante (tabela 26) |
| 17 | 17 - Número no Conselho | Obrigatório | XML (snapshot) | `dadosSolicitante/profissionalSolicitante/numeroConselhoProfissional` | número no conselho do solicitante |
| 18 | 18 – UF | Obrigatório | XML (snapshot) | `dadosSolicitante/profissionalSolicitante/UF` | UF do conselho do solicitante (tabela 59) |
| 19 | 19 - Código CBO | Obrigatório | XML (snapshot) | `dadosSolicitante/profissionalSolicitante/CBOS` | CBO do solicitante (tabela 24) |
| 20 | 20 - Assinatura do Profissional Solicitante | Obrigatório | à mão no papel | — | assinatura do profissional solicitante, no papel |
| 21 | 21 - Caráter do | Obrigatório | XML (snapshot) | `dadosSolicitacao/caraterAtendimento` | caráter do atendimento (tabela 23) |
| 22 | 22 - Data da Solicitação | Condicionado | XML (snapshot) | `dadosSolicitacao/dataSolicitacao` | data da solicitação |
| 23 | 23 - Indicação Clínica | Condicionado | XML (snapshot) | `dadosSolicitacao/indicacaoClinica` | só o texto que o profissional escreveu para esta solicitação; nunca copiado do prontuário (D17) |
| 24 | 24-Tabela | Obrigatório | XML (snapshot) | `procedimentosSolicitados/procedimento/codigoTabela` | tabela do item solicitado (solicitação) ou da solicitação vinculada (cobrança) |
| 25 | 25- Código do Procedimento | Obrigatório | XML (snapshot) | `procedimentosSolicitados/procedimento/codigoProcedimento` | código do item solicitado |
| 26 | 26 - Descrição | Obrigatório | XML (snapshot) | `procedimentosSolicitados/procedimento/descricaoProcedimento` | descrição TUSS do item solicitado |
| 27 | 27-Qtde. Solic. | Obrigatório | XML (snapshot) | `procedimentosSolicitados/quantidadeSolicitada` | quantidade solicitada |
| 28 | 28-Qtde. Aut. | Obrigatório | só impresso (snapshot `print`) | — | quantidade autorizada pela operadora: só da autorização registrada; na solicitação, em branco |
| 29 | 29 - Código na Operadora | Obrigatório | XML (snapshot) | `dadosExecutante/contratadoExecutante` | contratado executante na operadora |
| 30 | 30 - Nome do Contratado | Obrigatório | só impresso (snapshot `print`) | — | nome do contratado executante congelado na emissão (print.contratadoNome); não existe no XML |
| 31 | 31 - Código CNES | Obrigatório | XML (snapshot) | `dadosExecutante/CNES` | CNES do executante (ou 9999999) |
| 32 | 32-Tipo de Atendimento | Obrigatório | XML (snapshot) | `dadosAtendimento/tipoAtendimento` | tipo de atendimento (tabela 50) — cobrança |
| 33 | 33 - Indicação de Acidente (acidente ou doença relacionada) | Obrigatório | XML (snapshot) | `dadosAtendimento/indicacaoAcidente` | indicação de acidente (tabela 36) — cobrança |
| 34 | 34 - Tipo de Consulta | Condicionado | XML (snapshot) | `dadosAtendimento/tipoConsulta` | tipo de consulta (tabela 52), se o atendimento for consulta |
| 35 | 35 - Motivo de Encerramento do Atendimento | Condicionado | XML (snapshot) | `dadosAtendimento/motivoEncerramento` | motivo de encerramento (tabela 39), em caso de óbito |
| 36 | 36-Data | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/dataExecucao` | data de execução de cada item |
| 37 | 37-Hora Inicial | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/horaInicial` | hora inicial (urgência/emergência) |
| 38 | 38-Hora Final 39-Tabela 40-Código do Procedimento | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/horaFinal` | hora final (urgência/emergência) |
| 39 | 39-Tabela | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/procedimento/codigoTabela` | tabela do item executado |
| 40 | 40-Código do Procedimento | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/procedimento/codigoProcedimento` | código do item executado |
| 41 | 41-Descrição | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/procedimento/descricaoProcedimento` | descrição do item executado |
| 42 | 42 - Qtde. | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/quantidadeExecutada` | quantidade executada |
| 43 | 43-Via 44-Tec. 45- Fator Red./Acresc. | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/viaAcesso` | via de acesso (tabela 61), procedimento cirúrgico |
| 44 | 44-Tec. | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/tecnicaUtilizada` | técnica (tabela 48), procedimento cirúrgico |
| 45 | 45- Fator Red./Acresc. | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/reducaoAcrescimo` | fator de redução/acréscimo (1,00 sem redução) |
| 46 | 46-Valor Unitário (R$) | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/valorUnitario` | valor unitário do contrato |
| 47 | 47-Valor Total (R$) | Condicionado | XML (snapshot) | `procedimentosExecutados/procedimentoExecutado/valorTotal` | valor total do item (quantidade × unitário × fator) |
| 48 | 48-Seq.Ref 49-Grau Part. 50-Código na Operadora/CPF | Condicionado | só impresso (snapshot `print`) | — | sequencial de referência do item da equipe (número da linha), derivado do item |
| 49 | 49-Grau Part. | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/grauPart` | grau de participação (tabela 35) |
| 50 | 50-Código na Operadora/CPF | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/codProfissional` | código na operadora ou CPF do profissional da equipe |
| 51 | 51-Nome do Profissional | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/nomeProf` | nome do profissional da equipe |
| 52 | 52-Conselho | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/conselho` | conselho do profissional da equipe |
| 53 | 53-Número no Conselho | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/numeroConselhoProfissional` | número no conselho do profissional da equipe |
| 54 | 54-UF | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/UF` | UF do conselho do profissional da equipe |
| 55 | 55-Código CBO | Condicionado | XML (snapshot) | `procedimentoExecutado/equipeSadt/CBOS` | CBO do profissional da equipe |
| 56 | 56-Data de Realização de Procedimentos em Série 57-Assinatura do Beneficiário ou Responsável | Condicionado | à mão no papel | — | datas de procedimentos em série: preenchidas à mão a cada sessão (o Qoro ainda não emite série) |
| 57 | 57-Assinatura do Beneficiário ou Responsável | Obrigatório | à mão no papel | — | assinatura do beneficiário em cada sessão da série, no papel |
| 58 | 58-Observação / Justificativa | Opcional | XML (snapshot) | `observacao` | observação escrita na guia (até 500) |
| 59 | 59 - Total de Procedimentos (R$) | Condicionado | XML (snapshot) | `valorTotal/valorProcedimentos` | total de procedimentos — cobrança |
| 60 | 60 - Total de Taxas e Aluguéis (R$) | Condicionado | XML (snapshot) | `valorTotal/valorTaxasAlugueis` | total de taxas e aluguéis: o Qoro não fatura outras despesas; em branco |
| 61 | 61 - Total de Materiais (R$) | Condicionado | XML (snapshot) | `valorTotal/valorMateriais` | total de materiais: idem |
| 62 | 62- Total de OPME (R$) | Condicionado | XML (snapshot) | `valorTotal/valorOPME` | total de OPME: idem |
| 63 | 63 - Total de Medicamentos (R$) | Condicionado | XML (snapshot) | `valorTotal/valorMedicamentos` | total de medicamentos: idem |
| 64 | 64 - Total de Gases Medicinais (R$) | Condicionado | XML (snapshot) | `valorTotal/valorGasesMedicinais` | total de gases medicinais: idem |
| 65 | 65 - Total Geral (R$) | Obrigatório | XML (snapshot) | `valorTotal/valorTotalGeral` | total geral — cobrança |
| 66 | 66 - Assinatura do Responsável pela Autorização | Obrigatório | à mão no papel | — | assinatura do responsável pela autorização (operadora), no papel |
| 67 | 67 - Assinatura do Beneficiário ou Responsável | Obrigatório | à mão no papel | — | assinatura do beneficiário ou responsável, no papel |
| 68 | 68 - Assinatura do Contratado | Obrigatório | à mão no papel | — | assinatura do contratado, no papel |
| 89 | 89 - Nome Social | Condicionado | só impresso (snapshot `print`) | — | nome social só quando o beneficiário pede: o Qoro não coleta; em branco |
| 90 | 90 - Indicador de Cobertura Especial | Opcional | XML (snapshot) | `dadosSolicitacao/indCobEspecial` | cobertura especial (tabela 75), quando houver |
| 91 | 91 - Regime de atendimento | Obrigatório | XML (snapshot) | `dadosAtendimento/regimeAtendimento` | regime de atendimento (tabela 76) — cobrança |
| 92 | 92 - Saúde Ocupacional | Opcional | XML (snapshot) | `dadosAtendimento/saudeOcupacional` | saúde ocupacional (tabela 77) — cobrança, quando houver |

## Como verificar

- Testes: `src/contexts/health-insurance/tiss/print/print.test.ts` (rótulos no lugar do modelo, valores dentro da caixa,
  consistência com o XML, paginação, texto longo, acentos, metadados e logs).
- Visual, reproduzível: `TISS_CONTEUDO_PDF=<pdf oficial> npx tsx scripts/tiss/print/visual-check.ts <pasta>` gera as
  folhas em PNG ao lado das páginas oficiais (`index.html`) e as medidas (`report.json`).
