# Qoro TISS: dossiê de conformidade regulatória (25/11/2026)

**Para:** o fundador. Este documento reúne o que as normas oficiais dizem, o que o Qoro faz e o que ainda falta, para
decidir sem procurar dezenas de normas.

**Não é:**

- parecer jurídico;
- certificado da ANS;
- homologação de operadora.

**É:** pesquisa documental feita por IA em fontes oficiais, com o grau de certeza de cada conclusão.

Em toda dúvida material, o Qoro adota a medida técnica mais protetora e registra a pergunta exata que só uma autoridade
pode responder.

**Production TISS: NO-GO.**

**Data de acesso de todas as fontes:** 25/11/2026. Os arquivos da ANS foram baixados e conferidos por sha256 (seção 1).

**Categorias de conclusão (nunca misturadas):**

| Sigla | Significa |
| --- | --- |
| **EXP** | exigência normativa expressa (texto de lei ou norma) |
| **INT** | interpretação técnica sustentada (fundamentada, sem texto literal) |
| **BP** | boa prática recomendada (não obrigatória) |
| **PROD** | escolha de produto do Qoro |
| **CONTR** | ponto juridicamente controverso (leituras razoáveis divergentes) |
| **HOM** | homologação externa pendente |

---

## 1. Versões do Padrão TISS verificadas

Fonte: página oficial do Padrão TISS de setembro/2026,
<https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026>,
publicada em 30/09/2026 e atualizada em 03/11/2026.

| Componente | Versão vigente | O que o Qoro usa | Conferência |
| --- | --- | --- | --- |
| Organizacional | 202609 | lido nesta pesquisa (PDF sha256 `fc973a68…`) | não fixa prazo de guarda nem nomeia validador oficial |
| Conteúdo e Estrutura | 202511 | 202511 | — |
| Representação de Conceitos (TUSS) | 202609 | `data/tiss/terminologia/202609` | **o arquivo publicado hoje tem o mesmo sha256 do manifesto** (`7f3d7a97…`, 408 MB, Last-Modified 29/09/2026) |
| Segurança e Privacidade | 202511 | `data/tiss/seguranca/202511` (53 requisitos vigentes) | **o zip publicado hoje tem o mesmo sha256 registrado** (`09af1423…`) |
| Comunicação | 04.03.00 e 01.06.00 | XML 4.03.00 | o pacote de set/2026 ainda traz os XSD de 04.00.00 a 04.03.00 (histórico das versões) |

Fatos de prazo, conferidos no histórico das versões da ANS:

- **Comunicação 04.03.00:** vigência desde 01/12/2025, limite de implantação em 30/06/2026.
- **Requisitos de segurança 81 a 87:** mesmo limite, 30/06/2026. Esse prazo **já passou**, então senha de 90 dias,
  histórico de 10 senhas, inatividade de 10 minutos e log de 180 dias são obrigatórios hoje para quem estiver no
  alcance.

Conclusão: **o Qoro está na versão vigente** em todos os componentes que usa (EXP: RN 501, art. 7º, "obrigatoriamente
na versão vigente").

## 2. Legislação aplicável (verificada)

| Norma | Dispositivos lidos | Fonte oficial |
| --- | --- | --- |
| RN ANS 501/2022 (Padrão TISS obrigatório) | arts. 1º–8º, 14, 16–22, 25–28 | <https://bvsms.saude.gov.br/bvs/saudelegis/ans/2022/res0501_01_04_2022.html> |
| RN ANS 489/2022 (penalidades) | art. 1º, §1º | <https://bvsms.saude.gov.br/bvs/saudelegis/ans/2022/res0489_31_03_2022.html> |
| Padrão TISS: Componente Organizacional 202609 | itens 119–137 (segurança e comunicação), glossário | página de set/2026 (acima) |
| Padrão TISS: Segurança e Privacidade 202511 | 53 requisitos vigentes (íntegra em `data/tiss/seguranca/202511/requisitos.json`) | idem |
| LGPD (Lei 13.709/2018, compilada) | arts. 5º VI, VII, XI, XIV; 6º III e VII; 11, II, a, d, f, g; 15; 16; 18, IV, VI e §2º; 37; 39; 46; 48 | <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm> |
| Lei 13.787/2018 (prontuário) | arts. 1º–6º | <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm> |
| Marco Civil da Internet (Lei 12.965/2014) | arts. 5º, VII e VIII; 15; 16 | <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm> |
| CTN (Lei 5.172/1966) | arts. 173, I; 174; 195, parágrafo único | <https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm> |
| Código Civil (Lei 10.406/2002) | arts. 205; 206, §3º IV e V, §5º I e II | <https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm> |
| Lei 6.206/1975 | art. 1º (carteira de conselho profissional vale como identidade) | <https://www2.camara.leg.br/legin/fed/lei/1970-1979/lei-6206-7-maio-1975-356336-publicacaooriginal-1-pl.html> |
| Resolução CFM 1.821/2007 (e 2.218/2018, que revogou só o art. 10) | arts. 7º e 8º | <https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2007/1821_2007.pdf> |
| Parecer CFM 19/2026 (20/05/2026) | eliminação de prontuário | <https://portal.cfm.org.br/wp-content/uploads/2026/06/19_2026.pdf> |
| Resoluções CFP 01/2009 e 06/2019 | guarda mínima de 5 anos do registro do psicólogo | <https://www.crpsp.org/uploads/legislacao/1514/x2FGTbFDQCxbeCfLswwYF9gL224qLaq_.pdf> |
| ANPD: guias de agentes de tratamento e de segurança para pequeno porte | não vinculantes (a própria ANPD diz que são boa prática) | <https://www.gov.br/anpd/> |
| NIST SP 800-63B-4 (jul/2025), referência técnica | gerenciadores de senha | <https://pages.nist.gov/800-63-4/sp800-63b/authenticators> |

Limitação do acesso: o Planalto recusou conexões diretas desta máquina. Os dispositivos foram lidos pelo serviço de
leitura do servidor, que só devolve trechos curtos. Por isso as citações literais abaixo são curtas. A íntegra deve ser
conferida no Planalto antes de uso jurídico.

**Quem a ANS pune:** a RN 489, art. 1º, §1º, sujeita às penalidades as **operadoras** e seus administradores. Para o
prestador (a clínica) e para o fornecedor do software (o Qoro), a não conformidade tem consequências de outra natureza:

- **contratual:** a operadora é obrigada a seguir o padrão (RN 501, art. 8º) e pode recusar trocas fora dele;
- **LGPD:** o titular e a ANPD podem cobrar a segurança dos dados (arts. 46 e 48).

A RN 501, art. 4º, lista os agentes do padrão (operadora, prestador, contratante, beneficiário e ANS). O fornecedor de
software não está na lista. Mas o art. 17 exige que "qualquer solução tecnológica" atenda "na íntegra" todos os
componentes.

## 3. Componente de Segurança e Privacidade: situação dos 53 requisitos

A matriz requisito a requisito está em `data/tiss/seguranca/202511/matriz-qoro.json`, com teste que recusa declarar
conformidade integral. Mudanças deste ciclo:

| Req. | Antes | Agora | Evidência |
| --- | --- | --- | --- |
| 69 (≤ 5 tentativas "por qualquer meio") | parcial: na queda do Upstash, contador só em memória por instância | **atende tecnicamente:** na queda do Upstash, o login conta as falhas na trilha `login_attempts` do banco (5 por e-mail e 10 por IP em 15 min); se o banco também cair, o login **fecha** | `src/lib/auth/login-attempts-fallback.ts` (5 testes), `login/actions.ts` (4 testes novos), `rate-limit.test.ts` |
| 84 (log de acessos ≥ 180 dias) | lacuna: purga aos 90 dias | **atende tecnicamente:** 186 dias | `src/lib/db/retention-policy.ts` (`LOGIN_ATTEMPTS_DAYS`), teste do piso legal |
| 56/79 (arquivo fora do banco) | interpretação | interpretação sustentada (seção 12) | `TISS_DOWNLOAD_HEADERS` (`private, no-store`), `tiss-file-access.ts` |

Valem em produção **só depois do merge do #55**. A retenção de 186 dias também cobre uma obrigação da **plataforma
inteira** (seção 9, Marco Civil). Ela tem prazo: a purga mensal de produção roda em **01/12/2026 às 05h UTC**. O patch
mínimo para o #53, que publica produção, está em `docs/convenios/patches/hotfix-marco-civil-login-attempts-186.patch`
e foi comentado no PR #53.

## 4. Matriz S1–S9 (alcance e decisões do perfil de segurança)

### 4.1 S9, questão 1: alcance no SaaS multi-clínica

| Campo | Conteúdo |
| --- | --- |
| Exigência expressa (EXP) | Componente Organizacional 202609, item 123: os requisitos "se aplicam a todos os sistemas e portais que tratam os dados que fazem parte do Padrão TISS". RN 501, art. 17: a solução tem de atender "na íntegra" os componentes |
| Interpretação fundamentada (INT) | A norma não define "sistema"; o glossário do Componente Organizacional não traz o termo. O Qoro é um sistema que trata dado TISS assim que uma clínica o usa. Os requisitos se dividem em dois tipos: **de sistema** (armazenamento da senha, TLS, auditoria, log de acesso, limite de tentativas), que são propriedades da plataforma, e **de usuário** (inatividade, prazo e histórico de senha, complexidade), que mudam o uso de cada pessoa. O usuário de uma clínica sem dado TISS não tem acesso possível a dado TISS: o isolamento por RLS é provado em todas as tabelas do Convênios |
| Incerteza material | A ANS pode entender "sistema" como o produto inteiro, e então os requisitos de usuário valeriam para todas as clínicas. Não há definição nem orientação pública. **Residual** |
| Medida conservadora | 1. Requisitos de **sistema**: globais. Os de hoje (69 e 84) já foram feitos assim. 2. Requisitos de **usuário**: para todo usuário de clínica que **tem dado TISS**, mesmo com o módulo desligado (desligar não apaga guia), e para o suporte da plataforma quando entra nela. 3. A feature flag sozinha **não** tira ninguém do alcance. 4. Ampliar para a plataforma inteira é uma troca de modo, sem migração (`tiss-scope.ts`, modo `platform`) |
| Evidência | `src/lib/auth/security-profile/tiss-scope.ts` + 6 testes; isolamento: harnesses de tenant do Convênios |
| Pergunta residual exata | "Num SaaS multi-inquilino com isolamento técnico por inquilino, os requisitos 67, 81, 82 e 83 valem para os usuários de inquilinos que nunca trataram dado TISS?" Destinatário: ANS (DIDES / área de padronização). Não contatada: falta autorização institucional |
| Categoria | INT, com ponto residual CONTR |

### 4.2 S9, questão 2: XML e PDF fora do banco (requisitos 56 e 79): seção 12

### 4.3 S9, questão 3: documento unívoco do usuário (requisito 41): seção 10

### 4.4 S9, questão 4: gerenciadores de senha (requisito 43): seção 9

### 4.5 S9, questão 5: "256 bits" (requisito 77): seção 9

### 4.6 S1 a S8

| Item | Critério normativo | Estado técnico (25/11) | Testes | Risco | Decisão proposta | Status efetivo |
| --- | --- | --- | --- | --- | --- | --- |
| S1 alcance | item 123; RN 501 art. 17 | resolvedor de alcance pronto (dado TISS, não só módulo), modo plataforma pronto | 6 | alcance errado se a ANS ler "sistema" como o produto | adotar a medida da 4.1 | **PRONTO, desligado** |
| S2 inatividade 10 min | req. 83 (EXP, prazo vencido) | decisão de servidor pronta; **falta o rascunho do prontuário no servidor** antes de ligar | 2 | perder texto clínico | implementar o rascunho, depois E2E, depois ligar | **PARTIAL** |
| S3 complexidade | req. 67 (EXP) | política pronta; falta ligar nos 5 fluxos de senha | 1 | fluxo esquecido | ligar no perfil `tiss` | **PARTIAL** |
| S4 90 dias + histórico de 10 | req. 81 e 82 (EXP, prazo vencido) | prazo, carência e verificador scrypt prontos; falta a tabela de histórico (migration aditiva) e a revogação de sessões | 6 | equipe trancada sem carência | 90 dias com carência de 90 na ativação | **PARTIAL** |
| S5 auditoria 180 dias | req. 84, 85 e 58 (EXP) | **84 atendido (186 dias)**; `audit_events` sem purga e sem política de UPDATE/DELETE para o app; falta o bloqueio contra o dono do banco e a recusa de DETACH < 180 dias (sobrepõe a trilha append-only do #59, ADR-075) | teste do piso legal | trilha apagável por quem tem o dono do banco | concluir junto com o #59 | **PARTIAL** |
| S6 documento do usuário | req. 41 (EXP) | sem documento hoje; desenho pronto (seção 10) | — | coleta excessiva × não atender | conselho + UF + número para profissionais, CPF só para os demais, só no perfil `tiss` | **NOT RUN** |
| S7 fornecedor e versão | req. 36 (EXP) | feito (P12.11) | `software-identity.test.ts`, `print.test.ts`, E2E | — | — | **PASS** |
| S8 último acesso, memorização, queda do Upstash | req. 42, 43, 69 (EXP) | **69 atendido** (fallback no banco, fecha se o banco cair); 42 (último acesso) sem tela; 43, seção 9 | 10 | — | ligar 42 depois do shell do #56 | **PARTIAL** |
| S9 consulta | — | pesquisa documental completa; 2 pontos residuais (4.1 e 9.3) | — | — | — | **PARTIAL** (questões residuais) |

**S1–S8 TECHNICAL READINESS: PARTIAL.** S7 está PASS. S1 está pronta. 69 e 84 foram resolvidos. S2, S3, S4, S5 e S6
ainda têm trabalho técnico listado acima, e S2 depende do rascunho do prontuário.

## 5. LGPD: papéis e bases legais

| Conclusão | Cat. | Fundamento | Consequência técnica |
| --- | --- | --- | --- |
| A clínica é **controladora** dos dados de paciente; o Qoro é **operador** | INT | LGPD art. 5º, VI e VII; art. 39 (o operador segue as instruções do controlador); guia da ANPD sobre agentes de tratamento | o prazo e o destino dos documentos são decisão da clínica; o Qoro oferece o padrão mais protetor e nunca descarta por conta própria |
| O Qoro é **controlador** das contas e do registro de acesso dos usuários | INT | art. 5º, VI; Marco Civil art. 15 (o provedor guarda os registros) | `login_attempts` e trilha da plataforma são do Qoro |
| Dado de saúde sem consentimento é lícito para a tutela da saúde, obrigação legal e exercício de direitos em contrato | EXP | art. 11, II, a, d e f | guia e prontuário não dependem de consentimento |
| O direito de **eliminação** do art. 18, VI vale para dado tratado **com consentimento**, ressalvado o art. 16 | EXP | art. 18, VI; art. 16, I | pedido de exclusão com guia retida termina em anonimização do cadastro (já é assim), com a base do art. 16, I |
| Para dados de outras bases, o titular pede anonimização ou eliminação do **desnecessário, excessivo ou irregular** e pode se opor | EXP | art. 18, IV e §2º | carteirinha sem guia de paciente anonimizado: sem finalidade restante (seção 7) |
| Registro das operações | EXP | art. 37 | trilha de auditoria (seção 11) |
| Incidente: comunicar ANPD e titular quando houver risco ou dano relevante | EXP | art. 48 | runbook de incidente existente |

## 6. Dados sensíveis

| Conclusão | Cat. | Fundamento | Evidência no Qoro |
| --- | --- | --- | --- |
| Carteirinha, CPF, prontuário e conteúdo da guia são dados que exigem confidencialidade | EXP | LGPD art. 5º, II; art. 46; TISS req. 62 | cifrados por clínica; leitura só pela via auditada com finalidade (`membership-access.ts`, `guide-access.ts`) |
| Operadora e prestador devem manter protegida a informação assistencial individualizada | EXP | RN 501, art. 21; Organizacional 202609, item 122 | RLS forçada por clínica; arquivos só pelo servidor |
| Dados TISS devem ser fornecidos ao beneficiário **sem ônus** quando pedidos | EXP | RN 501, art. 20 | **inventário por paciente** (`retention-inventory.ts`) para responder ao pedido de acesso |

## 7. Retenção documental (B6)

O catálogo vive no código: `src/lib/compliance/retention-catalog.ts`, com 13 testes. Ele é a fonte única das 16
categorias.

**Regras travadas por teste:**

- nada com fundamento incerto é descartado automaticamente;
- todo descarte exige termo humano;
- a simulação só classifica.

| Categoria | Prazo mínimo | Marco | Fundamento | Cat. | Destino depois do prazo |
| --- | --- | --- | --- | --- | --- |
| Prontuário | **20 anos** | último registro | Lei 13.787, art. 6º (inclusive o eletrônico, §5º); CFM 1.821 arts. 7º e 8º; Parecer CFM 19/2026; CFP 01/2009 (5 anos, menor: prevalece o da lei) | **EXP** | revisão humana: eliminar com termo guardado permanentemente, ou devolver ao paciente (art. 6º, §2º) |
| Registro do atendimento | 20 anos, por cautela | atendimento | Lei 13.787, se integra a documentação da assistência | INT | revisão humana |
| Guia TISS, autorização, demonstrativo, recurso de glosa | **5 anos a partir de 1º de janeiro do ano seguinte** | último evento financeiro da guia | CC art. 206, §5º, I; CC art. 1.194; CTN arts. 173, I e 195, parágrafo único; CDC art. 27 | INT (sem prazo TISS expresso) | anonimizar o conteúdo pessoal com termo; o documento financeiro fica |
| XML e PDF TISS | idem | idem | idem | INT | revisão humana; a eliminação tem de alcançar os bytes no armazenamento, não só a linha |
| Recebível e lançamento; comprovante de pagamento | 5 anos do exercício seguinte | lançamento | CTN art. 195, parágrafo único; CC art. 1.194 | EXP (regra); a contagem por tributo é do contador | anonimizar a descrição com termo |
| Documento fiscal (NFS-e) | 5 anos do exercício seguinte | emissão | CTN arts. 173 e 174 | EXP | fora do Qoro |
| Trilha de auditoria | **180 dias**, sem alterar nem remover | evento | TISS req. 85 (que "não desconsidera" os prazos do prontuário) e 58 | EXP no mínimo; INT no vínculo com o prontuário | hoje nada é purgado |
| Registro de acesso (`login_attempts`) | **186 dias** | tentativa | Marco Civil art. 15 (6 meses); TISS req. 84 (180 dias) | **EXP** | **purga automática** (a única categoria; minimização, LGPD art. 6º, III) |
| Backup | sem prazo afirmável | cópia | LGPD arts. 6º VII, 15, 16, 46 | INT | expira pela rotação do provedor; eliminação decidida é reaplicada depois de restauração |
| Cadastro do paciente | enquanto houver finalidade; com documento retido, anonimiza | pedido ou fim da relação | LGPD arts. 16 e 18 | EXP | já implementado (anonimização com guia ou prontuário retidos) |
| Carteirinha | segue a guia; sem guia, sem finalidade | última guia | LGPD arts. 6º III e 16 | INT | **eliminar a carteirinha sem guia de paciente anonimizado**: leitura sustentada, à espera do seu OK porque é irreversível |

**Respostas às 5 perguntas da ficha B6** (`consulta-juridica-b6.md`):

1. **Prazo:** prontuário em 20 anos (EXP); documentos de cobrança em 5 anos a partir do exercício seguinte (INT). O
   contrato com a operadora pode pedir mais, e isso entra no pacote B5.
2. **Destino:** anonimizar o conteúdo pessoal do documento de cobrança, com termo de uma pessoa da clínica. O prontuário
   segue o rito do Parecer CFM 19/2026 (termo guardado permanentemente). Backup: rotação do provedor e reaplicação da
   eliminação depois de restauração.
3. **Acesso a anonimizado com guia retida:** basta a permissão de faturamento com leitura auditada e finalidade, e não
   há norma pedindo perfil mais restrito (INT). Recomendação (BP): mostrar o paciente como "anonimizado" nas telas.
4. **Texto ao titular:** "Seus dados de cadastro foram anonimizados. Os documentos de cobrança já emitidos ao seu plano
   de saúde são guardados pelo prazo legal (LGPD, art. 16, I; Código Civil, art. 206; CTN, art. 195), com acesso
   restrito e auditado. Você pode pedir cópia deles a qualquer momento (RN ANS 501, art. 20)." O pedido de **acesso**
   inclui os documentos emitidos: o inventário lista guias, arquivos e carteirinhas.
5. **Carteirinha sem guia de anonimizado:** eliminar (INT, LGPD art. 6º, III). Falta só o seu OK.

**Implementado neste ciclo:**

- catálogo;
- simulação de vencimento (só classifica, nunca escreve);
- trava de descarte (`assertDisposalAllowed`), que exige fundamento expresso, prazo cumprido e termo humano;
- inventário por paciente: guias, arquivos (o XML do lote marcado como compartilhado com outros beneficiários),
  carteirinhas e o ponto do prazo de cada guia, só com metadados e sob RLS. Provado no harness
  `health-insurance-retention-db.ts`: a simulação não altera nenhuma linha, outra clínica não vê nada e o banco recusa a
  exclusão física do paciente com guia.

**Já existia:** anonimização do cadastro com guia retida; histórico dos pedidos do titular (`lgpd_requests` e
`lgpd_request_history`); recusa do banco a excluir guia por cascata.

**Não há descarte automático de documento.** A única purga automática é a do registro de acesso.

**B6 LEGAL RESEARCH: COMPLETE** (documental). **B6 TECHNICAL CONTROLS: PASS** para o critério técnico: classificar,
restringir, anonimizar, bloquear eliminação indevida, inventariar, simular e auditar. Restam duas decisões materiais
suas: o OK para eliminar a carteirinha sem guia e o aceite do prazo INT dos documentos de cobrança. A rotina de
anonimização de documento vencido não existe e só deve existir depois disso.

## 8. Direitos dos titulares

| Direito | Fundamento | Qoro |
| --- | --- | --- |
| Acesso e confirmação | LGPD art. 18, I e II; RN 501, art. 20 | exportação LGPD existente + inventário TISS |
| Correção | art. 18, III | cadastro editável; documentos emitidos não são reescritos (substituição de guia com histórico) |
| Anonimização, bloqueio ou eliminação do desnecessário | art. 18, IV | anonimização do cadastro com documento retido |
| Eliminação do tratado com consentimento | art. 18, VI e art. 16 | exclusão total sem documento retido; anonimização com documento retido |
| Histórico dos pedidos | art. 37 | `lgpd_requests` e `lgpd_request_history` |

## 9. Segurança de senhas e de login

| Conclusão | Cat. | Fundamento | Consequência e evidência |
| --- | --- | --- | --- |
| Bloquear após no máximo 5 tentativas, por qualquer meio | EXP | TISS req. 69 | **feito:** fallback no banco com o Upstash fora, e fecha se o banco cair |
| Log de acessos e tentativas por ≥ 180 dias | EXP | TISS req. 84 | **feito:** 186 dias |
| **Registros de acesso por 6 meses (toda a plataforma)** | **EXP** | **Marco Civil, art. 15** (provedor PJ com fins econômicos) | **risco com data:** o código em produção (`cf712ab4`) apaga `login_attempts` aos 90 dias pelo cron mensal (`0 5 1 * *`). Leitura de produção em 25/11 (`READ ONLY`, só agregados): a linha mais antiga é de 10/08/2026, então nada foi apagado ainda, e o `auth.audit_log_entries` do Supabase está vazio (não há outro registro). **Em 01/12/2026 a purga apagaria registros com menos de 6 meses.** Patch mínimo para o #53 (comentado no PR #53); o #55 traz a mesma correção |
| Senha de 8+ caracteres com os 4 tipos | EXP | req. 67 | hoje faltam os símbolos; política pronta (S3) |
| Troca em ≤ 90 dias e sem repetir as 10 últimas | EXP | req. 81 e 82 (prazo vencido) | pronto em parte (S4) |
| Inatividade de ≤ 10 minutos | EXP | req. 83 (prazo vencido) | pronto em parte (S2), depende do rascunho do prontuário |
| Mensagem de erro de login genérica | EXP | req. 51 | atende ("Email ou senha inválidos.") |
| Captcha no login e na recuperação | BP | req. 63 e 65 (recomendados) | atende (Turnstile) |
| Segundo fator por e-mail ou celular | BP | req. 86 e 87 (recomendados) | TOTP opcional; não adotado por e-mail ou SMS |

### 9.3 Requisito 43: gerenciadores de senha (S9, questão 4)

| Campo | Conteúdo |
| --- | --- |
| Exigência expressa | a interface de credenciais "deve impedir a memorização e a visualização de dados anteriores (lista de logins já digitados, lembrança automática de senhas…)"; senha sempre mascarada |
| Interpretação fundamentada | O alvo são os recursos **do sistema** que guardam e mostram credenciais. O gerenciador de senhas do usuário é uma ferramenta dele, e o navegador ignora `autocomplete="off"` em campos de login. A referência técnica atual vai no sentido oposto ao texto literal: NIST SP 800-63B-4 (jul/2025), "Verifiers SHALL allow the use of password managers and autofill functionality" |
| Incerteza material | O próprio requisito cita como exemplo a "lista de logins já digitados", que é o autopreenchimento do navegador. A leitura literal pede `autocomplete="off"`. **CONTR** |
| Medida conservadora (adotada) | Senha sempre mascarada por padrão, campo limpo após erro e nenhuma memorização pelo Qoro (sem "lembrar meu login", sem e-mail guardado no navegador). **Não** bloquear gerenciadores, porque isso enfraquece a segurança (senhas mais fracas e repetidas). **Achado:** a tela de login é anterior à identificação da clínica, então qualquer medida aqui vale para a plataforma inteira, e não dá para restringi-la ao perfil `tiss` |
| Pergunta residual exata | "O requisito 43 exige `autocomplete=off` nos campos de login, mesmo que os navegadores o ignorem e que o NIST 800-63B-4 mande permitir gerenciadores?" |

### 9.4 Requisito 77: "256 bits" (S9, questão 5)

| Campo | Conteúdo |
| --- | --- |
| Exigência expressa | "A senha deve ser armazenada em banco de dados, de forma codificada por algoritmo criptográfico no minimo igual a 256 bits"; codificações protegidas contra acesso não autorizado |
| Fatos | O Supabase Auth guarda a senha em **bcrypt** (documentação oficial "Password security"), com sal por usuário, custo adaptativo e saída de 184 bits sobre Blowfish (chave de até 448 bits). O Qoro não guarda senha |
| Interpretação | "Algoritmo de 256 bits" admite três leituras: tamanho da saída (o bcrypt não atende), tamanho da chave (atende) ou força de segurança. Esta última depende da entropia da senha e do custo da derivação, não de um número de bits. As referências técnicas (NIST 800-63B, OWASP) medem a proteção de senha pela função lenta com sal (Argon2id, scrypt, bcrypt, PBKDF2), não pela largura do hash |
| Incerteza material | **CONTR**: o texto não define a métrica |
| Medida conservadora | **Não trocar o provedor nem o mecanismo em produção sem projeto de migração.** Os hashes ficam protegidos: `auth.users` não é exposta e não há SDK do Supabase no navegador (teste de arquitetura). Se a autoridade exigir saída de 256 bits, o caminho é um verificador adicional com scrypt, sal, pepper e 256 bits de saída. Ele já existe no código da S4 para o histórico. Isso precisa de projeto próprio, porque cria uma segunda cópia derivada da senha |
| Pergunta residual exata | "bcrypt com custo adequado e sal por usuário atende ao requisito 77, ou a ANS exige saída de 256 bits?" |

## 10. Identificação profissional (requisito 41, S9 questão 3)

| Campo | Conteúdo |
| --- | --- |
| Exigência expressa | usuário vinculado "minimamente a um documento de identificação pessoal unívoco"; unicidade validada; não excluir quem operou, só inativar, e o inativo não entra |
| Fundamento adicional | **Lei 6.206/1975, art. 1º:** a carteira emitida pelos conselhos de fiscalização profissional criados por lei federal "é válida em todo o Território Nacional como prova de identidade, para qualquer efeito" (EXP). A guia TISS já exige conselho, número e UF do profissional |
| Interpretação fundamentada | Para profissional de saúde, conselho + UF + número é documento de identidade por lei, e coletar o CPF dele seria excessivo (LGPD art. 6º, III). Para os demais usuários (recepção, gestão), não há documento profissional. O documento mínimo é o CPF, com base no art. 7º, II, e **só no alcance do perfil `tiss`** |
| Incerteza material | 1. Um profissional pode ter inscrição em mais de uma UF. Cada inscrição é unívoca, mas a pessoa tem duas. 2. A "unicidade no sistema" num SaaS: o mesmo profissional em duas clínicas tem duas contas. Medida: unicidade por clínica |
| Medida conservadora | No perfil `tiss`: profissional com conselho + UF + número (unívoco por clínica); demais usuários com CPF cifrado, com hash para a unicidade, nunca em log. Fora do perfil, nada muda. **Não implementado** (S6): exige tela de cadastro de usuário e migration. Inativar em vez de excluir já existe (`deleted_at`) |
| Categoria | INT (com a Lei 6.206/1975 como EXP de apoio) |

## 11. Auditoria

| Conclusão | Cat. | Fundamento | Estado |
| --- | --- | --- | --- |
| Trilha completa: quem, quando, o quê, operação e finalidade | EXP | req. 85 | atende no módulo (carteirinha, guia, lote, arquivos, com finalidade e falha confirmada antes do erro) |
| Disponível à ANS e ao titular por 180 dias, sem alterar nem remover | EXP | req. 85 | `audit_events` sem purga; o app não tem UPDATE/DELETE. **Falta:** o bloqueio contra o dono do banco e a recusa de DETACH < 180 dias (S5, junto com a ADR-075/#59) |
| Integridade e proteção contra acesso não autorizado | EXP | req. 58 | parcial (idem) |
| Tela cronológica | BP | req. 59 | parcial |

## 12. Armazenamento (requisitos 56 e 79, S9 questão 2)

| Campo | Conteúdo |
| --- | --- |
| Exigência expressa | **79:** dados estruturados no SGBD, e "dados pessoais e pessoais sensíveis não estruturados e não armazenados em SGBD devem atender à requisitos de confidencialidade". **62:** arquivos com dados pessoais protegidos (criptografia, acesso autorizado). **56:** componentes de interoperabilidade, visualização ou assinatura "não devem manter tais dados fora do SGBD após o término da operação" |
| Interpretação fundamentada | O próprio 79 prevê dado **não estruturado fora do SGBD**, desde que confidencial. Se o 56 proibisse todo armazenamento fora do banco, essa parte do 79 não teria efeito. A leitura harmônica é que o 56 rege as **cópias transitórias** criadas durante a operação (arquivo temporário, cache, exportação esquecida) e o 79 rege o armazenamento permanente |
| Incerteza material | moderada: o 56 isolado admite leitura ampla |
| Medida conservadora (já implementada) | 1. XML e PDF gerados **em memória**, sem arquivo temporário. 2. O dado identificado canônico fica **no banco** (snapshot cifrado da guia); o arquivo é uma cópia de prova. 3. Arquivo cifrado por clínica, em armazenamento privado, com SHA-256 do conteúdo e do cifrado no banco, conferidos a cada leitura. 4. Leitura só pelo servidor, auditada com finalidade. 5. Download com `Cache-Control: private, no-store`, `Pragma: no-cache` e `nosniff` |
| Evidência | `tiss-file-access.ts`, `src/app/(app)/_lib/tiss-download.ts`, `hi_files` (`content_sha256`, `ciphertext_sha256`) |
| Categoria | INT |

## 13. Criptografia

| Conclusão | Cat. | Fundamento | Estado |
| --- | --- | --- | --- |
| Comunicação com autenticação, integridade e confidencialidade, algoritmo ≥ 256 bits | EXP | req. 46 e 64 | TLS da Vercel e do Supabase; as cifras do provedor não foram medidas por nós (falta evidência própria) |
| TLS ≥ 1.2 | EXP | req. 71 | padrão dos provedores (idem) |
| App ↔ banco cifrado | EXP | req. 78 | `ssl: 'require'` |
| Dado sensível cifrado em repouso | EXP | req. 62 | cifra por clínica |
| Certificado digital e assinatura XAdES | EXP quando houver certificado | req. 12–18, 35; Organizacional itens 143–144 | não usamos certificado hoje; passa a valer com XAdES ou conector |

## 14. XML

Toda mensagem usa o namespace dos XSD do Componente de Comunicação (Organizacional, item 134). As mensagens emitidas
são guia de Consulta, guia SP/SADT, lote, recurso de glosa e demonstrativos, todas em 4.03.00. O corpus sintético tem 38
arquivos (13 válidos e 25 inválidos).

## 15. XSD

O conjunto oficial 4.03.00 é validado em dois motores: libxml2 (xmllint-wasm) e .NET `System.Xml.Schema`. Os 38/38
resultados são iguais. Os XSD embutidos na Voa são **byte a byte iguais** aos do Qoro.

## 16. Validação independente (B7)

**O que a B7 exige:** o critério da P13.5 diz literalmente "Validador C (Validador TISS, Windows)".

**O que a norma exige:** nada sobre validador. O Componente Organizacional 202609, item 142, só aponta os arquivos de
definição no site da ANS. A ANS não publica validador oficial. O "Validador TISS" é de terceiro, com licença grátis que
veda uso comercial e telemetria.

**Conclusão:** o objetivo **normativo** é a compatibilidade com o padrão oficial, e isso está provado em dois motores XSD
independentes. O objetivo da B7 era ter uma terceira opinião externa, e a exigência de um programa específico é escolha
do plano, não da norma.

| Camada | Motor | Independência | Resultado |
| --- | --- | --- | --- |
| A | xmllint-wasm (libxml2) | principal | 38/38 conforme o esperado |
| B | .NET `System.Xml.Schema` | **motor independente** | 38/38 iguais à A |
| C (proposta) | Voa `tiss` 0.5.0 (Apache-2.0, offline, sha256 fixado) | XSD **não** independente (lxml/libxml2); hash e regras **independentes** | XSD 38/38 iguais; hash 37/37 iguais; 1 falso positivo da Voa; 10 regras do Qoro que a Voa não tem |
| D | validadores próprios do Qoro | regras de negócio | 38/38 com o código esperado |

**Falso positivo da Voa:** reproduzido com dado sintético em `scripts/tiss/corpus/voa-repro-reducao-acrescimo.py`. Ele
roda no CI e acusa quando a Voa corrigir. O XML do Qoro não foi alterado. A versão 0.5.0 segue a mais recente no PyPI em
25/11. O texto da issue está pronto em `validacao-independente-voa.md`. **Não publiquei:** é comunicação pública em nome
do Qoro, e a autorização foi para preparar e reproduzir.

**Política composta proposta (A + B + C + D):** cobre a compatibilidade com o padrão oficial (dois motores
independentes) e a terceira opinião externa de hash e regras. **Limites:**

- não há terceiro motor XSD independente;
- a camada C tem um defeito conhecido, registrado como exceção.

**B7 VALIDATION: PARTIAL.** Tecnicamente resolvida no maior grau possível sem licença. A troca formal do critério da
P13.5 precisa do seu aceite. A alternativa é a licença comercial do programa Windows, que é despesa.

## 17. Homologação com operadora (B5)

| Operadora | Documentação pública | Versão | Ambiente de homologação | Adequação |
| --- | --- | --- | --- | --- |
| Saúde Petrobras | manual de webservice com WSDL de produção (`webservices.crc.com.br/tiss/ws/40100/…`), login e senha (MD5) da conectividade | **4.01.00** | não publicado | **não serve** (não é 4.03.00) |
| Saúde Caixa | 11 webservices publicados (`novosiags.caixa.gov.br`), certificado digital + usuário do Autorizador WEB | **4.02.00** | não publicado | **não serve** |
| Unimed Planalto Médio | Portal TISS: o WebC aceita **só 4.03.00 desde 01/07/2026** | 4.03.00 | não publicado; menus de "homologação" por serviço, sem detalhe técnico | candidata, se a piloto for credenciada |
| Copass Saúde | Portal TISS: 4.03.00 desde 01/07/2026; **Coordenador TISS e suplente com contato publicados** | 4.03.00 | não publicado | candidata, se a piloto for credenciada |

**Achados:**

1. Nenhuma operadora pesquisada publica ambiente de homologação aberto. Todas exigem prestador **credenciado**. O canal
   oficial é o **Coordenador TISS**, que a operadora é obrigada a publicar no seu Portal TISS (RN 501, art. 16, II).
2. Várias versões convivem, porque o pacote de set/2026 traz de 04.00.00 a 04.03.00. **Requisito novo do pacote B5:**
   a operadora piloto tem de aceitar 4.03.00, porque o Qoro só emite essa versão.

**Nada foi executado contra operadora:**

- não há endpoint de teste público autorizado;
- não usei credencial de terceiros;
- não tentei endpoints por adivinhação.

**Recomendada:** a operadora em que a clínica piloto já é credenciada, desde que confirme 4.03.00. Entre as pesquisadas,
a Copass Saúde tem o caminho mais direto (contato do Coordenador TISS publicado).

**Passo humano mínimo:** a clínica piloto pede ao Coordenador TISS da operadora acesso de homologação em 4.03.00,
usando as 17 perguntas de `pacote-homologacao-operadora-b5.md`.

**B5 OPERATOR HOMOLOGATION: BLOCKED** (credenciamento e clínica real).

## 18. Limitações conhecidas

- **Pesquisa por IA:** sem parecer assinado. Os textos do Planalto foram lidos em trechos.
- **Pontos residuais da S9:** alcance dos requisitos de usuário (4.1) e "256 bits" (9.4). Ponto controverso:
  memorização (9.3).
- **S2, S3, S4, S6, R42:** não estão ligados.
- **S5:** falta a imutabilidade contra o dono do banco.
- **Cifras TLS:** não medidas por nós.
- **Camada C da validação:** sem motor XSD independente.
- **Operadora real:** nenhuma homologação.
- **P4.7-b:** opção (b) planejada, não implementada. Precisa de migration aditiva (0168), aplicação no DEV e E2E.

## 19. Riscos jurídicos residuais

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Registros de acesso apagados aos 90 dias (Marco Civil, art. 15) | **certa em 01/12/2026** sem o patch | sanção pelo descumprimento do art. 15 (o §4º lista os critérios de dosimetria); prova faltando num incidente | patch de uma linha + teste para o #53 antes de 01/12; 186 dias no #55 |
| A ANS entender o alcance como a plataforma inteira | média | ligar os requisitos de usuário para todos | modo `platform` pronto |
| Leitura literal do 43 ou do 77 | baixa a média | ajuste na tela de login ou verificador adicional | perguntas residuais prontas; nenhuma mudança que enfraqueça a segurança |
| Prazo de documento de cobrança contratual maior que 5 anos | média | guarda a mais | nada é descartado automaticamente |
| Coleta de CPF sem base | baixa (não adotada) | LGPD | só no perfil `tiss` e só para quem não tem registro profissional |
| Ligar o módulo sem os requisitos 81–83 | alta se ligar hoje | não conformidade com prazo vencido | **NO-GO** mantido |

**Manifestação formal necessária:**

- **ANS:** para os pontos residuais 4.1 e 9.4. Opcional, mas é a única fonte de certeza.
- **Contador da clínica:** para a contagem tributária exata.
- **Nenhum ponto exige advogado para o Qoro seguir tecnicamente.**

## 20. Requisitos para o lançamento (P15.8)

1. Merge na ordem #53 → #56 → #55, com a 0159 legítima e a 0167 preservadas e CI e E2E verdes no SHA final.
2. S1 ligado no alcance da seção 4.1. **S2, S3, S4 e S5 implementados e ligados nesse alcance**, porque os requisitos
   81 a 85 têm prazo vencido. S2 depende do rascunho do prontuário.
3. Os requisitos 69 e 84 em produção (estão no #55).
4. S6 (documento do usuário) e R42 (último acesso) ligados.
5. Homologação com operadora real (B5), com protocolo genuíno.
6. P15.6 com o seu aceite. A pré-auditoria automática já está pronta (seção 21).
7. Sentry com alerta real recebido (P12.6).
8. Decisão B7 registrada (troca do critério ou licença).
9. Pré-voo e pós-voo do runbook, rollback provado, migrations do TISS em produção com autorização específica.

## 21. P15.6: pré-auditoria financeira técnica

O harness `scripts/security/health-insurance-financial-preaudit-db.ts` roda os 12 casos do roteiro com os valores
exatos:

- consulta de R$ 150,00;
- coparticipação de R$ 45,00;
- glosa de R$ 30,00, com recurso aceito em R$ 20,00;
- pagamento de R$ 100,00, com estorno no meio;
- repasse de 40%.

Ele usa o código real, em Postgres descartável, pela cadeia do DEV. Imprime o dossiê (cenário, valor inicial, operação,
esperado, observado, diferença, evidência, SHA e resultado) no log e no resumo do job "Convênios — provas sintéticas de
banco (legado)". **O resultado e o SHA estão no checkpoint do plano mestre de 25/11 (noite).**

**P15.6 HUMAN ACCEPTANCE: PENDING.** O critério pede a sua aprovação. A sessão fica curta: conferir o dossiê e abrir o
Preview só nos casos que quiser ver com os próprios olhos.
