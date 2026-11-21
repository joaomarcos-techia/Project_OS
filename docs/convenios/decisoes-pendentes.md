# Decisões humanas pendentes do módulo Convênios (atualizado em 20/11/2026)

Cada linha é um **pedido de aprovação separado**. Nenhuma decisão é presumida a partir de silêncio, e um GO de uma não vale para outra. As alternativas e recomendações vêm do plano mestre (seções N e L), das provas e do código atual.

## Quadro consolidado (20/11, noite, ciclo R61-B)

| Pendência | Critério | Evidência atual | Trabalho técnico já possível | Decisão humana | Risco sem a decisão | Próxima ação |
| --- | --- | --- | --- | --- | --- | --- |
| **R61-C** (GO de produção do outbox) | proteção ligada no cron real + lote escolhido + observação sem critério de interrupção | R61-A cumprido; R61-B: patch para o #53 provado em composição descartável (`r61b/r61b-para-53.patch`) | nada além: a ligação é do #53 (R61-B), e o lote é variável de produção | aprovar a opção B (ou C) e a janela da mudança | fila acumula acima de ~15 atendimentos/min; pane de provedor estoura a janela do cron | #53 aplica o patch; depois, pedir o GO R61-C (ficha em `outbox-capacidade.md` §5) |
| P12.6 (alerta no Sentry) | alerta disparando em teste, com entrega conferida | manutenção só emite métrica; token local inválido (não reutilizado) | regra descrita; falha sintética controlada pronta para o Preview | criar a regra pela tela (ou dar acesso com escopo de alertas, fora do chat) | falha da manutenção TISS sem alerta ativo | você cria a regra; o agente provoca a falha no Preview e marca a P12.6 |
| B5 (operadora e clínica piloto) | recibo real devolvido pelo webservice, conferido no XSD e no hash | conector testado só contra stub; registro de produção vazio | cenários H22–H26 e critério de PASS prontos (`homologacao-operadora.md` §4.0) | escolher operadora real, clínica piloto paga e responsável | P9.4, P2.5, P13.6, P15.3 e P15.4 seguem sem homologação | indicar a operadora; o agente configura só o ambiente de homologação |
| B6 (retenção legal) | prazos de guarda, descarte e texto ao titular definidos | anonimização do paciente preservando a guia já implementada | rotina de descarte parametrizável depois do prazo | orientação jurídica formal | guardar além do necessário ou descartar antes de obrigação contratual | obter a orientação; o agente implementa prazos, rotina e testes LGPD |
| B7 (Validador TISS para Windows) | corpus sintético validado na terceira camada | XSD oficial em dois motores (38/38) | roteiro para VM isolada | licença, VM isolada ou autorização do fornecedor | divergência de validação só aparecer na operadora | escolher o caminho; rodar o corpus na VM (P13.5/P13.6) |
| S1–S9 (segurança ANS) | os 9 itens com decisão e teste | fichas com 10 campos (`perfil-seguranca-s1-s9.md`); nada ligado para usuário real | S2–S4 já preparados e testados, desligados | um pedido por item, na ordem sugerida (S9 primeiro) | P15.5 não fecha; produção bloqueada | decidir S9 (consulta formal) e S1 |
| P4.7-b (importação com convênio) | regra do histórico definida e provada | importação hoje trata tudo como particular | coluna e validação por linha, sem gerar guia, depois da decisão | escolher (a), (b) ou (c) | faturar duas vezes o que a clínica já cobrou, se (c) | decidir; recomendação (b) |
| P15.6 (revisão financeira) | conciliação ponta a ponta revisada com você | relatório por operadora, conciliação, repasse e benchmark com integridade | sessão preparada sobre a clínica sintética | marcar a sessão | P15.8 não pode ser pedida | marcar a sessão |
| P15.8 (aprovação final) | release aprovado e piloto ligado por flag | contrato da P1.13 pronto; pré-condições abertas | nenhum até as pré-condições | aprovar depois de R61-C executado, B5, B6, S1–S4, P15.6 e P12.6 | — | aguardar as anteriores |
| P9.4 (recibo real) | protocolo real com recibo conferido | 7/7 contra stub; teto de 20 s por envio (R61) | nenhum sem operadora | B5 | marcar homologação com XSD sintético seria falso | depende de B5 |
| R54 (estornos no Sandbox) | dois estornos parciais reais, conciliados | pagamento de R$ 10 conciliado; 3 recusas pelo prazo do Asaas; 0 estornos | nenhum antes da janela | nenhuma nova (GO "SIM, TUDO" vale) | só a evidência incompleta | segunda, 23/11, a partir das 09h00: UMA tentativa de R$ 4, se a sessão for retomada |

## GO R61 — capacidade do outbox compartilhado

- **O que decidir:** cinco gates, cada um com aprovação própria:
  - **R61-A:** homologação técnica (já autorizada e em andamento no #55).
  - **R61-B:** revisão conjunta com o #53 (handoff `handoff-53-outbox-r61.md`).
  - **R61-C:** sua aprovação explícita.
  - **R61-D:** mudança controlada em produção.
  - **R61-E:** observação operacional.
- **Por que:** com o lote atual (50), 50 atendimentos por minuto mantidos por 15 min fazem a fila crescer 106 eventos/min e atrasam em até 33 min o recebível do particular e as tarefas de todas as clínicas. Num pico curto, o atraso chega a 8 min. Um consumidor externo em pane já leva o tick além dos 60 s da função.
- **Recomendação (benchmark de decisão de 20/11, 14 rodadas, integridade conferida em todas): opção B.** Lote 200 **com** o prazo de reserva de 30 s e o descarte em bloco dos eventos sem consumidor.
  - Sustenta 50 atendimentos/min indefinidamente: fila zero a cada minuto, atraso de 1 min.
  - A pane de consumidor fica em 30,5 s (hoje passa de 60 s).
  - Capacidade sustentada de cerca de 83 atendimentos/min na plataforma. A configuração atual sustenta cerca de 15.
  - Detalhes, riscos, monitoramento e retorno em `outbox-capacidade.md` (§4, §5 e §8).
- **Bloqueia:** produção (condição de liberação do TISS). Não bloqueia DEV nem a integração.
- **Depois do GO R61-C:**
  - aplicar a ligação no cron (com o #53, na integração);
  - registrar o valor anterior da variável, mudar só o lote e redeployar o mesmo commit;
  - monitorar com os critérios de interrupção;
  - em problema, voltar à configuração anterior.
- **Independente** do GO do C3 da AbacatePay.

## R54 — estorno externo no Asaas Sandbox

- **Situação:** decidida ("SIM, TUDO"). O pagamento de R$ 10,00 está conciliado.
- **Estornos:** o parcial foi recusado três vezes pelo prazo do Asaas; nenhum foi criado.
- **Próxima tentativa:** uma única, em 23/11 a partir das 09h, se alguém retomar a sessão. Não há agendamento automático.
- **Se recusar de novo:** enviar a pergunta ao suporte do Asaas (rascunho em `homologacao-r54-sandbox.md`).
- **Nada a decidir agora.**

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
