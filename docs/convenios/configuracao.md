# Convênios — configuração pela interface (R44)

**Situação (13/11/2026):** implementada (`67c2dee6`, `e2d0cf1f`, `bf59cbc3`), testada (harness
`health-insurance-config-db.ts` 13/13) e validada no Preview que usa o DEV
(`e2e/convenios-config-preview.spec.ts`): uma clínica sintética **zerada** configurou tudo pela interface,
sem SQL nem fixture de cadastro.

A fixture `hi-dev-e2e-fixture.ts setup-config` só cria o que não é cadastro da clínica:
- a clínica `e2e-hi-config`;
- as contas;
- a assinatura paga;
- a **habilitação operacional** do módulo, que é decisão do Qoro, nunca da clínica.

## Telas

| Tela | O que faz | Quem altera |
| --- | --- | --- |
| `/convenios/configuracao` | O que falta para faturar (prontidão); identificação do prestador (PJ/PF, nome do contratado, CNES ou declaração de ausência); operadoras; perfil TISS dos profissionais (conselho, número, UF, CBO) | `manage:financial` |
| `/convenios/configuracao/operadoras/:id` | Dados e situação da operadora (rascunho → ativa → suspensa → arquivada → reativada); planos; procedimentos contratados (TUSS, valor, coparticipação, autorização, retorno); versões anteriores; histórico de alterações | `manage:financial` |
| `/convenios/carteirinhas` | Busca do paciente; carteirinhas com só o final visível; cadastrar, substituir o número, validade e plano, desativar e reativar, preferencial; "Ver número" auditado (finalidade `atendimento`) | `edit:patient` (recepção) |
| `/convenios/atendimentos` | Próximos atendimentos de convênio, situação da cobertura e o que falta; registrar ou corrigir a cobertura (inclusive de atendimento remarcado) | `edit:agenda` |
| Agenda › Novo atendimento | Forma de atendimento Particular/Convênio (só com o módulo habilitado): operadora, plano, carteirinha (mascarada), tipo de guia | `edit:agenda` |
| Agenda › linha do atendimento | Selo "Convênio · operadora" (azul = cobertura pronta, âmbar = pendência) e "Mudar para convênio"/"Mudar para particular" até a chegada, com motivo (P4.3) | `edit:agenda` |
| Conciliação › Coparticipações a conferir | Conferir o valor calculado (recepção), confirmar o que cobrar (nunca acima do conferido) ou dispensar com motivo | conferir: `edit:patient`; confirmar e dispensar: `manage:financial` |

Ver é `view:financial` (a médica não vê). Tudo é conferido de novo no servidor e no banco:
- CHECKs e FKs compostas;
- gatilho de mesma clínica;
- contrato imutável;
- carteirinha imutável;
- RLS por clínica.

## Regras que valem

- **Nada inventado.** Registro ANS, código do prestador, CNPJ e CPF vêm da clínica e são conferidos
  (formato e dígitos; CNPJ alfanumérico aceito). Os códigos TUSS (tabela 22), CBO (24), conselho (26) e
  UF (59) só entram se existirem e estiverem vigentes na terminologia oficial carregada. A busca nunca
  oferece código de fora dela.
- **Contrato append-only.**
  - **Reajustar a partir de uma data** encerra a versão anterior na véspera e cria a nova vigência. O
    atendimento antigo sem guia continua com o preço da data dele (provado pela seleção real
    `selectEffectiveContract`).
  - **Corrigir** cria uma versão com a mesma vigência.
  - **Encerrar** cria uma versão com fim.
  - Duas revisões simultâneas do mesmo item: uma vence e a outra recebe "já revisado".
  - **Guia emitida nunca muda** (snapshot congelado).
- **Carteirinha.**
  - O número fica só cifrado, com HMAC de busca sobre `clínica:registro ANS:número` (D21) e os 4
    últimos dígitos.
  - A mesma carteirinha ativa não pode estar em dois pacientes da clínica.
  - Trocar o número é substituição: a antiga fica `replaced` e aponta para a nova.
  - Há uma única preferencial por paciente.
- **Desativar nunca apaga.** Operadora arquivada, plano arquivado e carteirinha inativa continuam no
  histórico e nas guias.
- **Agendamento de convênio.**
  - O atendimento nasce `convenio` no próprio INSERT do Scheduling, e a cobertura entra logo depois. Não
    existe janela "particular" em que um sinal ou um link do saldo cheio possam ser pedidos.
  - Se a cobertura falhar, o atendimento continua convênio com a pendência visível. O paciente não é
    cobrado: o banco só aceita recebível de convênio pela coparticipação confirmada.
  - Remarcar mantém a forma de atendimento e **leva a cobertura**: a mesma operadora, plano e carteirinha
    são registrados no novo horário (contrato, autorização e coparticipação rederivados para a nova data) e
    a cobertura do antigo vira "cancelada", sem ser apagada. Se a escolha não servir mais (carteirinha
    inativa, assinatura suspensa), o novo fica convênio com pendência, nunca particular.
- **Trocar particular ↔ convênio de um atendimento já criado (P4.3).** Pela linha do atendimento na
  agenda, até a chegada do paciente, com motivo na auditoria. Uma transação faz a troca da modalidade
  (Scheduling), a cobertura e o evento `billing_mode_changed`. O backend recusa, mesmo chamado direto:
  - depois da chegada: só pela correção do atendimento (o gatilho 0148 recusa de novo);
  - guia viva para o atendimento: cancelar ou substituir a guia antes;
  - coparticipação já calculada ou cobrada;
  - para convênio, se o paciente já pagou (sinal ou saldo) ou se já existe recebível: o Caixa decide o
    dinheiro antes (devolução pela clínica ou crédito); nada é devolvido nem cobrado sozinho;
  - para convênio, sem o módulo, sem assinatura paga ativa, com operadora, plano ou carteirinha que não
    servem (carteirinha de outro paciente é recusada).

  Para convênio, o link particular ainda aberto (sinal ou saldo) é anulado no Asaas logo depois da
  resposta. Se o paciente pagar nesse meio-tempo, o valor vai para a devolução pela clínica (D77). Para
  particular, a cobertura vira "cancelada", com operadora, carteirinha e autorização no histórico (a
  autorização não é consumida). A estimativa de coparticipação fica como está: nunca cobra e é
  reaproveitada se o atendimento voltar a convênio. Nenhuma cobrança é criada pela troca; o recebível
  particular nasce na conclusão. Trocar operadora, plano ou carteirinha de um atendimento que já é de
  convênio continua sendo a correção da cobertura em Atendimentos. Trocar de profissional (correção
  "transferir") não mexe na cobertura: a habilitação do novo profissional é conferida na montagem da
  guia (P2.2).
- **Coparticipação.**
  1. Estimada na cobertura.
  2. Calculada na conclusão.
  3. Conferida pela recepção.
  4. Confirmada por quem gerencia o financeiro.
  5. Só então vira recebível do paciente, pelo valor confirmado. No exemplo validado: R$ 45,00 sobre uma
     consulta de R$ 150,00.

## Credenciamento por plano e vigência (P2.2)

Na página da operadora, seção **Credenciamento**:
- **quem** é credenciado: a clínica (contratado) ou um profissional;
- **plano**: escolhido; "todos os planos desta operadora" só existe marcado de propósito (estar
  credenciado na operadora não quer dizer estar em todos os planos);
- **código na operadora** (opcional) e **vigência** (início obrigatório; vigências ativas do mesmo alvo
  não se sobrepõem — o banco recusa);
- mudanças preservam o histórico, sempre com motivo: **encerrar** (fecha a vigência numa data; o passado
  segue coberto), **suspender/reativar**, **nova vigência** (a anterior fecha na véspera e nasce uma linha
  nova). Nada é apagado; cada mudança vai para o histórico da operadora.

Onde vale (serviços reais):
- **agenda** (cobertura do atendimento): sem credenciamento vigente da clínica no plano e na data, a
  cobertura fica com pendência que diz o porquê (suspenso, fora da vigência, só em outros planos);
- **profissional**: clínica pessoa jurídica precisa do executante habilitado quando a operadora exige
  (padrão: exige; dispensa é regra do contrato, abaixo); pessoa física: o credenciamento da clínica é o
  do profissional;
- **guia** (montagem e atualização antes da emissão), **sessão de SP/SADT** e **conferência da
  solicitação** usam a mesma regra na data do atendimento ou da solicitação;
- a **prontidão** da configuração mostra "Credenciamento vigente hoje" por operadora ativa.

Prova: `scripts/security/health-insurance-credentials-db.ts` (7/7) e `credentialing.test.ts`.

## Regras da operadora (P2.5)

Seção **Regras da operadora**, com a origem de cada regra:

| Regra | Origem | Onde é usada |
|---|---|---|
| TISS 4.03.00 e XML validado no XSD oficial | obrigatório pelo padrão (não configurável) | exportação do lote, recurso |
| Máximo de guias por lote (1 a 100) | padrão até 100; menos só por contrato | montagem do lote: o serviço recusa acima; a tela limita "Todas (até N)" |
| Profissional executante habilitado | contrato (padrão: exige) | credenciamento → cobertura, guia, SP/SADT |
| Prazo de envio (dias depois do atendimento) | contrato (opcional) | montagem do lote marca a guia "fora do prazo do contrato" (não bloqueia: a decisão é da clínica com a operadora) |
| Agrupamento SP/SADT | contrato | guia SP/SADT por sessão ou por solicitação |
| Transmissão | configurável (portal) · webservice depende de homologação externa | envio registrado no Qoro |

Nenhuma regra local desliga validação obrigatória do padrão. Código de validação, conector SOAP e
credenciais da operadora seguem pendentes (dependem de homologação com operadora real).

## Trial e suspensão (D24, sem mudança de política)

O bloqueio comercial do banco é a única decisão:
- no trial, a clínica pode **preparar** o cadastro: prestador, operadora, plano, contrato, credenciamento,
  regras da operadora e perfil;
- carteirinha, cobertura, guia, lote e confirmação da coparticipação são **operações novas** e são
  recusadas;
- as telas mostram Convênios como recurso contratável.

## Processamento na hora (Preview e DEV não têm cron)

O evento da conclusão de atendimento de convênio (consultório → guia automática), o da coparticipação
confirmada (→ recebível) e o pedido de XML em segundo plano (R45) são processados logo depois da
resposta, só pelas chaves que o request publicou (`runOutboxEventsNow` via `after`). O mesmo vale para o
webhook do pagamento do paciente: a baixa e a coparticipação "paga" andam logo depois do webhook
(`settlement-follow-up.ts`), provado ao vivo no Asaas Sandbox em 13/11. O cron do outbox e o
`financial-reconcile` continuam sendo a garantia.

## Ainda não coberto (com tarefa no plano)

- Configurações por operadora que dependem de operadora real: código de validação, conector SOAP e
  credenciais cifradas (P2.5, parte externa).
- Aba "Convênios" na ficha do paciente e item de menu: dependem da branch de UI (P3.2, menu).

## Importação da tabela por planilha (P2.7)

Na página da operadora, painel "Importar tabela por planilha" (quem gerencia o financeiro).

- **Formato:** CSV (`;` ou `,`, UTF-8) ou XLSX, até 2 MB e 2.000 linhas. Há um modelo para baixar, com a
  lista das colunas. As obrigatórias são `codigo`, `tipo_guia`, `valor`, `vigencia_inicio` e
  `procedimento_clinica`. As opcionais: `tabela` (só 22), `descricao`, `vigencia_fim`, `plano`,
  `exige_autorizacao`, `coparticipacao_tipo`/`coparticipacao_valor`, `retorno_dias` e `retorno_faturavel`.
- **Escopo:** itens de contrato de uma operadora por planilha. Operadoras, planos e credenciamento não são
  criados por planilha (o plano citado precisa existir e estar ativo).
- **Leitura segura:** o XLSX passa pelo leitor próprio do Qoro, com limites de zip, e uma fórmula nunca é
  executada (vale o valor em cache). Célula de texto com cara de fórmula (`=`, `+`, `-` ou `@` seguido de
  letra) é recusada. O conteúdo é tratado só como dado.
- **Prévia:** cada linha passa pelas mesmas funções da tela (TUSS da tabela oficial válido na data, plano
  da operadora, catálogo da clínica, sobreposição, coparticipação), numa transação que é desfeita no fim.
  Nenhum contrato muda na prévia. O resultado por linha é "novo item", "reajuste" (valor novo a partir de
  uma data posterior: o item atual vale até a véspera), "sem mudança" ou "erro" com o motivo.
- **Política: atômica.** Com qualquer erro, nada é aplicado; corrige a planilha e envia de novo. A política
  aparece na tela antes de confirmar.
- **Aplicar:** a mesma sequência, numa transação real, revalidada contra o estado atual. Se o efeito de
  alguma linha mudou desde a prévia (outra pessoa mexeu no contrato), nada é aplicado e a importação fica
  "com erros" pedindo nova prévia.
- **Nada reescreve o passado:** a planilha não corrige item desde o início (isso é "Corrigir" na tela) nem
  muda o fim de um item ("Encerrar"). Guias emitidas não mudam.
- **Idempotência:** a mesma planilha (sha256) já aplicada nesta operadora não é aplicada de novo. Linha
  igual ao item vigente é "sem mudança".
- **Rastro:** cada importação fica em `hi_contract_imports` (arquivo, sha256, contagens, linhas
  normalizadas e resultado por linha, sem dado pessoal). Os itens criados guardam `import_id`. Validar e
  aplicar entram na auditoria. O painel mostra as importações anteriores.

## Conexão com a operadora (P2.5, parte sem operadora real)

Na página da operadora, painel "Conexão com a operadora" (quem gerencia o financeiro).

- **Envio hoje:** o arquivo XML do lote, validado no XSD oficial, que a clínica baixa no Qoro e envia no
  portal da operadora.
- **Credenciais:** login do webservice ou certificado. São guardadas cifradas por clínica
  (`hi_insurer_credentials`, 0144), com uma ativa por tipo. Guardar de novo é rotação: a anterior fica
  "revogada" com a data, e nada é apagado. A tela mostra só tipo, situação e datas, nunca o segredo, o
  usuário ou o texto cifrado. A auditoria registra tipo e rotação, sem o segredo.
- **Conector** (`tiss/connector/connector.ts`): define o formato do resultado (aceito com protocolo,
  recusado pela operadora, indisponível, circuito aberto, não configurado), o limite de tempo, a
  retentativa só com transporte que a operadora deduplica, e um circuito por operadora (abre com falhas
  seguidas e, depois do intervalo, deixa uma tentativa passar). O transporte padrão recusa sempre: sem
  homologação, nada sai do Qoro por webservice.
- **Bloqueado por operadora real (P12.5):** endereço do webservice, WSDL da versão TISS da operadora,
  certificado, código de validação e homologação. Nenhum endpoint ou resposta de operadora foi inventado.
