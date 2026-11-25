# Decisões humanas pendentes do módulo Convênios (atualizado em 25/11/2026)

## Novidades de 25/11 (tarde)

| Decisão | O que mudou | O que se pede |
| --- | --- | --- |
| **B7** (validador externo) | a Voa `tiss` 0.5.0 rodou os 38 arquivos offline e em CI: XSD 38/38 e hash 37/37 iguais, esquemas idênticos, um falso positivo dela (fator de redução/acréscimo). O XSD dela é libxml2, a mesma família do nosso; o .NET segue como motor independente (`validacao-independente-voa.md`) | aprovar ou não a troca do critério da P13.5 para "Voa (hash e regras) + .NET (XSD)". Até lá, BLOCKED. Também: OK para abrir a issue a montante (texto pronto) |
| **P4.7-b** | guarda implementada: o histórico importado nunca gera guia nem pendência, por nenhum caminho | escolher (a), (b) ou (c). A guarda vale para (a) e (b); a (c) exigiria removê-la |
| **P12.15** | avaliação A × B enviada ao #53 | decisão comercial: A, conectar e barrar o efeito (hoje), ou B, barrar também a conexão |
| **S9, B6, B5, P15.6** | pacotes prontos para envio ou execução: `consulta-regulatoria-s9.md`, `consulta-juridica-b6.md`, `pacote-homologacao-operadora-b5.md`, `roteiro-revisao-financeira-p156.md` | enviar à assessoria e ao jurídico; indicar a operadora e a piloto; marcar a sessão |

## Decididas em 24/11 (ciclo de desbloqueio final)

| Decisão | O que o fundador decidiu | Estado da execução |
| --- | --- | --- |
| **P8.4-r** | APROVADA a política recomendada; exceção do médico: SIM (só a própria sessão); nenhuma operadora informada como "não aceita", sem presumir que todas aceitam | implementada no #55 (`decisao-p84r.md`, "Decisão de 24/11"); banco 28/28 e ensaio 11/11 no runner; CI verde |
| **0167 no DEV** | GO condicional para a versão atualizada à política, depois dos gates | **aplicada em 24/11** (`7249f069…`), com os seis gates de `go-0167-dev.md` §9; falta o E2E da P8.4 |
| **R61-B, etapa 1** | GO condicional para produção, pelo dono do #53, lote 50, depois dos gates de release | GO encaminhado ao #53; o agente TISS não publica |
| **R61-C (lote 200)** | não autorizado neste ciclo | — |
| **R54** | sem quinta tentativa; sem estorno integral; sem cobrança nova | texto do suporte com as seis perguntas pronto (`homologacao-r54-sandbox.md`); envio pelo fundador |

Cada linha é um **pedido de aprovação separado**. Nenhuma decisão é presumida a partir de silêncio, e um GO de uma não vale para outra. As alternativas e recomendações vêm do plano mestre (seções N e L), das provas e do código atual.

## Quadro executivo (23/11, fechamento funcional)

Em ordem de prioridade: primeiro o que destrava teste ou funcionalidade. "Bloqueia" diz se a decisão segura **desenvolvimento**, **homologação externa** ou **produção**.

| Decisão | Descrição | Evidência atual | Opções | Recomendação técnica | Risco | Impacto | Depois da aprovação | Bloqueia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **0167 no DEV** (D23) | aplicar a migration 0167 (itens executados adicionais) só no DEV compartilhado | **pedido de GO completo em `go-0167-dev.md`** (SHA, SQL, objetos, testes, compatibilidade, journal, ordem, riscos, recuperação); banco da P8.4 18/18 e ensaio com o migrador real 11/11 em Postgres descartável; corrida guia × registro achada e corrigida antes de aplicar | aplicar no DEV / esperar | aplicar no DEV pelo aplicador limitado, com promoção ao journal, pré-voo, backup e pós-voo | toma ShareRowExclusive em `clinics` e em duas tabelas de convênio até o COMMIT (milissegundos; desiste sozinho em 2 s com escrita longa); DEV compartilhado | destrava o E2E da P8.4 no Preview | promoção ao journal, pré-voo, aplicação, pós-voo e E2E da conferência | homologação da P8.4 |
| **P8.4-r** | o que fazer, no faturamento, com o item executado sem solicitação prévia | **ficha em `decisao-p84r.md`** com A, B e C, consequências, testes e texto exato; vigente "sem decisão": registra e não fatura | A registrar e manter pendente; B regularização posterior com autorização válida e auditoria; C conferência antes de qualquer transmissão (combináveis) | combinação A + B + C (a sua preferência de segurança): registrar sempre, nunca faturar sozinho, incluir só com autorização e saldo ou com a confirmação do faturamento, aprovar sem o item só com motivo. Junto: "exceção do médico" no consultório (sim/não). **Decisão sua** | A sozinha deixa de cobrar o que foi feito; B sem C pode faturar sem conferência humana | define se a SP/SADT com vários itens é faturada e quem registra no consultório | política nova, ações "incluir" e "aprovar sem o item", montagem da guia, aviso na conferência e os 14 casos de teste da ficha | funcionalidade (faturamento dos itens) |
| **P12.6** | regra de alerta no Sentry disparando em teste | manutenção só emite métrica; token local inválido (não reutilizado) | (a) você cria pela tela; (b) token com escopo de alertas como segredo do repositório; (c) outro provedor | (a), cerca de 5 minutos | falha da manutenção TISS sem alerta | fecha a P12.6 | falha sintética no Preview e conferência da entrega | produção |
| **B5** | operadora e clínica piloto para a homologação real | conector com recibo provado contra o simulador; registro de produção vazio | indicar operadora com ambiente de homologação TISS 4.03.00 e clínica paga | a operadora em que a piloto já fatura | sem B5 não há recibo real | P9.4, P2.5, P13.6, P15.3 e P15.4 | configurar só o ambiente de homologação; H22–H26 | homologação externa |
| **S9 e S1** (segurança ANS) | consulta formal (S9) e alcance só nas clínicas com convênio (S1) | fichas com 10 campos; nada ligado para usuário real | ver `perfil-seguranca-s1-s9.md` | S9 primeiro; S1 só nas clínicas com convênio | P15.5 não fecha | perfil de segurança TISS | ligar S2–S4 no Preview depois dos E2E | produção |
| **P4.7-b** | importação de agenda histórica com convênio | importação trata tudo como particular | (a) particular; (b) forma e cobertura sem guia; (c) gera guia | (b) | (c) fatura duas vezes o que a clínica já cobrou | completa a P4.7 | coluna, validação por linha, prova e E2E | funcionalidade |
| **B6** | prazos legais de retenção e descarte | anonimização preservando a guia implementada | orientação jurídica / prazo mais longo conhecido | orientação jurídica formal | guarda além do necessário ou descarte cedo | P12.3, P12.13 | prazos, rotina de descarte, texto ao titular | produção |
| **B7** | terceira camada de validação (Windows) | XSD oficial em dois motores (38/38) | licença / VM isolada / autorização do fornecedor | VM isolada só com o corpus sintético | divergência só aparecer na operadora | P13.5, P13.6 | rodar o corpus na VM | homologação externa (não produção) |
| **P15.6** | revisão financeira com você | conciliação, repasse, relatório e benchmark com integridade | marcar a sessão | sessão sobre a clínica sintética | P15.8 não pode ser pedida | — | registrar aprovação ou ajustes | produção |
| **R61-C** | GO de produção do outbox, em duas etapas | R61-B provado; composição verde sobre `bc955f4e`; produção sem backlog nem incidente (leitura de 22/11) | B (200 com proteção) / C (150 com proteção) | B, em duas etapas: proteção com lote 50, depois 200 | capacidade atual de cerca de 15 atendimentos/min | todas as clínicas | etapa 1, observação de 24 h, etapa 2 | produção (só depois de o #53 aplicar o patch) |
| **P15.8** | aprovação final e piloto por flag | pré-condições abertas | — | depois das anteriores | — | publicação | gates T2, T3 e T4 | produção |

O R54 não precisa de decisão nova: o GO "SIM, TUDO" vale, e a próxima tentativa é única, na janela de segunda, 23/11, a partir das 09h00.

## GO R61 — capacidade do outbox compartilhado

- **O que decidir:** cinco gates, cada um com aprovação própria:
  - **R61-A:** homologação técnica (já autorizada e em andamento no #55).
  - **R61-B:** **feito em 24/11.** O #53 incorporou o patch no `9e6ed4c7`, com os mesmos arquivos e diferenças só de formatação (Prettier). A CI da branch dele ficou verde no `cf712ab4`, e a composição do #55 sobre esse código (gates do #53, prazo de reserva 6/6, invocação compartilhada 6/6) também ficou verde. Ainda **sem deploy** (não autorizado).
  - **R61-C:** sua aprovação explícita.
  - **R61-D:** mudança controlada em produção.
  - **R61-E:** observação operacional.
- **Por que:** com o lote atual (50), 50 atendimentos por minuto mantidos por 15 min fazem a fila crescer 106 eventos/min e atrasam em até 33 min o recebível do particular e as tarefas de todas as clínicas. Num pico curto, o atraso chega a 8 min. Um consumidor externo em pane já leva o tick além dos 60 s da função.
- **Recomendação (benchmark de decisão de 20/11, 14 rodadas, integridade conferida em todas): opção B.** Lote 200 **com** o prazo de reserva de 30 s e o descarte em bloco dos eventos sem consumidor.
  - Sustenta 50 atendimentos/min indefinidamente: fila zero a cada minuto, atraso de 1 min.
  - A pane de consumidor fica em 30,5 s (hoje passa de 60 s).
  - Capacidade sustentada de cerca de 83 atendimentos/min na plataforma. A configuração atual sustenta cerca de 15.
  - Detalhes, riscos, monitoramento e retorno em `outbox-capacidade.md` (§4, §5 e §8).
- **Produção, leitura de 24/11** (`evidence/tiss-r61-producao-2026-11-24/`): fila saudável, nada pendente nem falho, nada devolvido pelo janitor em 7 dias, tick de 708 ms. O tráfego foi quase nulo nas últimas 48 h, então isso não prova capacidade de pico.
- **GO da etapa 1 (24/11):** o fundador autorizou o rollout do R61-B em produção, **executado pelo dono do #53**, com `OUTBOX_BATCH_SIZE=50`, depois dos gates de release (CI verde do candidato exato, regressões financeiras, compatibilidade com o schema de produção, build, pré-voo saudável, nada de pagamento ou assinatura ambígua sem contenção, aquisição fechada, nenhuma cobrança de teste nova, plano de retorno e observabilidade prontos). Observação de 24 h depois do deploy. O agente TISS não altera a branch financeira nem publica.
- **Risco residual (fica escrito):** o prazo de reserva não garante término abaixo de 60 s quando um handler já iniciado trava.
- **R61-C (lote 200):** não autorizado; só com a observação da etapa 1 e um GO novo.
- **Bloqueia:** produção (condição de liberação do TISS). Não bloqueia DEV nem a integração.
- **Depois do GO R61-C:**
  - aplicar a ligação no cron (com o #53, na integração);
  - registrar o valor anterior da variável, mudar só o lote e redeployar o mesmo commit;
  - monitorar com os critérios de interrupção;
  - em problema, voltar à configuração anterior.
- **Independente** do GO do C3 da AbacatePay.

## R54 — estorno externo no Asaas Sandbox

- **Situação:** decidida ("SIM, TUDO"). O pagamento de R$ 10,00 está conciliado.
- **Estornos:** o parcial de R$ 4,00 foi recusado **quatro** vezes, a última na tentativa única de 23/11 às 09h56. A mensagem é sempre a mesma ("só pode ser estornada parcialmente no próximo dia"). Nenhum estorno foi criado, e o estado do Asaas e do Qoro ficou igual antes e depois.
- **Tentativas paradas,** conforme a regra do ciclo:
  - sem nova tentativa;
  - sem estorno integral de R$ 10,00;
  - sem novo checkout.
- **Ação sua (2 minutos):** enviar ao suporte do Asaas, pelo painel do Sandbox, o texto pronto em `homologacao-r54-sandbox.md`, seção "Pedido ao suporte do Asaas". Copie o identificador da cobrança do painel. Não mande dado de cartão nem chave.
- **Depois da resposta:** voltar a este item. Com o caminho que o Asaas indicar, o estorno parcial e o restante podem ser feitos numa sessão com GO.

## P12.6 — alerta do provedor disparando em teste

- **O que decidir:** quem cria a regra de alerta no Sentry, ou entrega um acesso com permissão de alertas, fora do chat. O token local é inválido e não é reutilizado.
- **Por que:** a P12.6 exige alerta disparando em teste; hoje a manutenção só registra métricas.
- **Alternativas:**
  - (a) você cria pela tela do Sentry;
  - (b) token com escopo de alertas guardado como segredo do repositório;
  - (c) outro provedor (conta nova).
- **Recomendação:** (a). Regra de issue alert no projeto do app:
  - ambiente `preview`;
  - filtro pela tag `flow` começando por `cron.insurance-maintenance`;
  - ação: e-mail para o endereço de teste que você escolher.
- **Risco sem a decisão:** falha da manutenção TISS sem alerta ativo.
- **Bloqueia:** produção.
- **Depois:** o agente provoca uma falha sintética controlada no Preview, confere o evento, a regra e a entrega, e marca a P12.6.

## B5 — operadora e clínica piloto (homologação real da P9.4)

| Campo | Pedido |
| --- | --- |
| Operadora | a sua escolha. Não inventamos operadora: indique uma com ambiente de homologação TISS 4.03.00 |
| Clínica piloto | uma clínica real com assinatura paga e ativa, que já fature essa operadora |
| Responsável | quem fala com a operadora e assina o aceite |
| Contrato | contrato vigente da clínica com a operadora (valores e regras de autorização) |
| Ambiente de homologação | WSDL, endereços, SOAPAction, versão SOAP, codificação da senha e deduplicação, conforme `conector-soap-homologacao.md` |
| Dados permitidos | só sintéticos combinados com a operadora (carteirinha de teste); nada real de paciente |
| Protocolo esperado | protocolo real devolvido pelo webservice, com recibo conferido no XSD e no hash |
| Critério de PASS | cenários H22 a H25 de `homologacao-operadora.md`, com evidência real |
| Critério de interrupção | recusa de login, resposta sem hash conferível, protocolo de outro lote ou dado real fora do combinado |

- **Por que:** a P9.4 e as homologações P15.3 e P15.4 só fecham com recibo real.
- **Bloqueia:** P9.4, P2.5 (C1–C10), P13.6, P15.3, P15.4.
- **Depois:**
  - o agente preenche a configuração da operadora no registro de homologadas, só no ambiente de homologação;
  - roda H22 a H26;
  - a operadora entra no registro de produção só com o seu GO (P15.8).

## B6 — retenção legal (P12.3, P12.13)

- **O que decidir:** prazos de guarda de guias, carteirinhas e autorizações; o descarte; o texto ao titular.
- **Alternativas:** seguir a recomendação jurídica formal, ou adotar o prazo mais longo conhecido, como conservador.
- **Recomendação:** orientação jurídica formal. O técnico já anonimiza o paciente e preserva a guia.
- **Risco:** guardar além do necessário (LGPD), ou descartar antes de uma obrigação contratual.
- **Bloqueia:** produção.
- **Depois:** prazos no runbook de retenção, rotina de descarte, texto ao titular e testes LGPD.

## B7 — Validador TISS para Windows (P13.5)

- **O que decidir:** como obter a terceira camada de validação sem instalar o programa na máquina principal.
- **Alternativas:** licença comercial; VM isolada sem dado real; autorização expressa do fornecedor.
- **Recomendação:** VM isolada só com o corpus sintético. Hoje o substituto é o motor XSD da Microsoft (38/38).
- **Risco:** uma divergência de validação só aparecer na operadora.
- **Bloqueia:** P13.5 (não bloqueia produção, que já usa o XSD oficial).
- **Depois:** rodar o corpus na VM e registrar as divergências (P13.6).

## S1–S9 — perfil de segurança TISS da ANS (B10)

Ficha detalhada, com requisito, situação, risco, opções, recomendação, impacto, critério de segurança, teste, dependências e autorização de cada item: **`perfil-seguranca-s1-s9.md`**.

- **Pedidos específicos, na ordem sugerida:**
  - S9: quem faz a consulta formal e como;
  - S1: alcance só nas clínicas com convênio;
  - S2 a S4: ligar no Preview, numa clínica de teste, depois dos E2E;
  - S5: auditoria imutável global de 180 dias;
  - S7: com o #56;
  - S8: R42 e o fallback do R69;
  - S6: depois da S9.
- **Bloqueia:** produção e o fechamento definitivo da P15.5.

## P4.7 (parte b) — importação de agenda com convênio

- **O que decidir:** se a importação de atendimentos HISTÓRICOS aceita convênio; se sim, se registra só a forma de atendimento e a cobertura, ou também gera guia.
- **Alternativas:**
  - (a) o histórico entra como particular (hoje), fora do faturamento TISS;
  - (b) registra forma e cobertura sem gerar guia (histórico faturado fora do Qoro);
  - (c) gera guia, como uma conclusão nova.
- **Recomendação:** (b). Gerar guia para atendimento antigo arrisca faturar duas vezes o que a clínica já cobrou.
- **Bloqueia:** P4.7.
- **Depois:** coluna de convênio no arquivo, cobertura por linha sem guia, prova de banco e E2E da importação.

## P15.6 — revisão financeira com você

- **O que decidir:** marcar uma sessão para conferir a conciliação ponta a ponta sobre a clínica sintética: faturado, recebido, glosado, pendente, repasse e coparticipação.
- **Evidência pronta:**
  - relatório por operadora (P9.10), com as somas conferidas contra o livro;
  - conciliação e repasse validados no Preview;
  - benchmark do outbox com integridade financeira em todas as rodadas.
- **Bloqueia:** P15.8.
- **Depois:** registro da aprovação, ou dos ajustes pedidos, no plano.

## P15.8 — aprovação final e piloto

- **O que decidir:** a aprovação de release e a ativação por flag numa clínica piloto (o contrato da P1.13 está pronto).
- **Pré-condições:**
  - GO R61 executado e observado;
  - B5, B6 e B10 (no mínimo S1 a S4);
  - P15.6 e P12.6;
  - integração #53 → #56 → #55;
  - o painel do #57.
- **Depois:** gates T2 (pré-voo de produção só leitura), T3 e T4, cada um com autorização própria.
