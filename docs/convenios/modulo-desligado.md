# Interruptor do módulo Convênios × operações (parecer e correção de 15/11/2026, noite)

**Pergunta do fundador:** conferir, aprovar e montar lote não olhavam o interruptor do módulo (`hi_clinic_settings.enabled`);
só a geração de guia olhava. Uma clínica com o módulo desligado podia continuar avançando trabalho TISS por chamada
direta ao servidor.

**Política já aprovada** (implementada aqui, não criada):
- ADR-072, item 10: ativação por flag em cada clínica, desligada por padrão;
- `bloqueio-comercial-trial.md`: "assinatura paga com o módulo desligado não opera Convênios". A flag se soma ao
  gate comercial D24, não o substitui;
- diretriz do fundador de 15/11: o módulo desligado não cria nem avança operação TISS por chamada direta, e o bloqueio
  não pode impedir de preservar obrigação já faturada.

**Não mudou:** a política global de habilitação. Quem liga o módulo, o interruptor de plataforma (P1.13) e o vínculo
com o plano ficam como estão.

## Diferenças que importam

| Situação | O que decide | Efeito em Convênios |
| --- | --- | --- |
| Trial (14 dias) | D24 (`qoro_premium_denial`) | conhecer o sistema; nenhuma operação real. A resposta é comercial ("contrate") |
| Assinatura parada ou clínica suspensa | D24 | operação nova barrada; preservação continua |
| Assinatura paga e ativa, **módulo desligado** | interruptor | operação nova barrada (a partir deste ciclo); preservação continua |
| Assinatura paga e ativa, módulo ligado | permissão do usuário | opera conforme o papel |
| Permissão do usuário | `requireCachedPermission`/`requireFreshPermission` | sempre se soma às anteriores |

## Classes de ação

| Classe | Ações | Guard antes | Guard agora |
| --- | --- | --- | --- |
| **A**: cria ou avança trabalho TISS | conferir guia; devolver para correção; ajustar dados da Consulta; aprovar e emitir (Consulta e SP/SADT); montar, exportar, pedir exportação e enviar lote; pedir autorização e registrar a resposta (Consulta, P6.1); solicitação SP/SADT (criar, conferir, indicação clínica, documento oficial); cobertura no check-in e correção de cobertura; confirmar coparticipação | D24 apenas | **D24 + módulo ligado** (`assertConveniosOperableTx`) |
| A, já coberta antes | gerar guia da Consulta; atualizar guia automática; execução SP/SADT (sessão → guia) | D24 + módulo (resultado `module_disabled`, que vira pendência) | sem mudança |
| **B**: consulta e histórico | telas; guia emitida, PDF, XML e arquivos (leitura auditada); histórico e revisões | permissão + leitura auditada | sem mudança. Desligar não apaga nem esconde o que existe (retenção) |
| **C**: preservação e encerramento | cancelar guia ainda não enviada; cancelar lote não enviado; protocolo, análise, retorno e demonstrativo do lote **já enviado**; glosas; recursos; pagamentos da operadora, alocação e estorno de alocação; conciliação; repasse do convênio; cancelar ou concluir solicitação SP/SADT; registrar autorização ou negativa da operadora para a SP/SADT | permissão (sem D24, por decisão de 11/11) | sem mudança. São fatos ou obrigações sobre trabalho já entregue; recusá-los perderia dado financeiro |

**Inconsistência anotada, sem mudança:** a resposta da operadora à autorização da **Consulta** (P6.1) é barrada como
operação nova, mas a da **SP/SADT** é preservação. Pela regra da D24 ("fatos da operadora sobre trabalho já
entregue"), as duas deveriam ser preservação. Decisão do fundador; a mais restritiva fica até lá.

## Impacto

- **Guias existentes:**
  - com o módulo desligado, nada é apagado, cancelado ou escondido;
  - guias em edição, conferidas ou aprovadas ficam paradas onde estão, e voltam a andar quando o módulo é religado;
  - o que já foi enviado continua recebendo protocolo, retorno, glosa, pagamento e recurso.
- **Financeiro:** nenhum valor muda. Nenhuma cobrança, recebível ou repasse é criado ou desfeito pelo interruptor.
  - A coparticipação ainda não confirmada espera.
  - Uma cobrança Asaas de coparticipação já confirmada segue o portão próprio (`patient_charges`), sem mudança.
- **Em segundo plano:**
  - a exportação de lote pedida antes de desligar termina como recusa definitiva (`module_disabled`), sem nova
    tentativa;
  - a troca de forma de atendimento na agenda deixa a cobertura pendente;
  - a cobertura no agendamento devolve a mensagem do módulo.

## Mensagem para o usuário

"Convênios está desligado nesta clínica. Para voltar a operar, a gestão liga o módulo em Convênios › Configuração; os
registros já feitos continuam disponíveis para consulta."

Sem dado interno do banco. No trial ou com a assinatura parada, aparece a mensagem comercial, que tem prioridade.

## Testes

- **Unitários:**
  - `internal/module-guard.test.ts`: ligado; desligado; sem configuração; comercial primeiro;
  - `actions.test.ts`: conferir e devolver recusados com o módulo desligado ou sem configuração, sem UPDATE e sem
    auditoria.
- **Banco descartável (job sintético do Actions):** `scripts/security/health-insurance-module-switch-db.ts`, 4 provas:
  - classe A recusada sem tocar em nada;
  - classe C continua;
  - trial com o módulo desligado responde a comercial;
  - religado, a mesma operação passa.
- **Telas:** a tela de Convênios com o módulo desligado já mostra "não habilitado" (E15). Nada novo na interface.

## O que fica para decisão

1. Confirmar a classe C como está (especialmente o repasse e o cancelamento de lote não enviado).
2. Resposta da operadora à autorização da Consulta: preservação, como a da SP/SADT? Mapeamento e regra proposta no §6.
3. Levar o interruptor também para os gatilhos do banco (hoje só o D24 está no banco). Proposta técnica e prova
   sintética no §7. Exige migration nova e autorização.

## 6. Respostas da operadora: Consulta × SP/SADT (16/11/2026)

Código lido: `recordManualAuthorizationResponseTx` (`internal/authorizations.ts`, Consulta, P6.1) e
`recordSadtAuthorizationInTx` (`internal/sadt-request-service.ts`, SP/SADT, P6.2). No banco, nenhuma das duas tem
gatilho comercial ou de módulo: `hi_aa_premium_authorizations` só dispara no INSERT (o pedido), não no UPDATE (a
resposta).

| Pergunta | Consulta | SP/SADT |
| --- | --- | --- |
| O que modifica | `hi_authorizations` (estado, data da resposta, número da guia na operadora, protocolo, senha cifrada, validade, autor), as quantidades em `hi_authorization_items` e uma linha no histórico da autorização | o mesmo, mais o estado e a versão da solicitação (`hi_sadt_requests`) e uma linha no histórico dela |
| É entrada de informação externa? | sim: a resposta real da operadora, registrada por uma pessoa. "Autorizada" exige evidência (número, senha ou protocolo) | sim, com a mesma exigência |
| Cria obrigação nova? | não. Nenhuma guia, lote, recebível ou cobrança nasce da resposta | não |
| Altera guia existente? | não | não (altera a solicitação, que não é guia) |
| Pode gerar cobrança? | não diretamente. Habilita o passo seguinte (guia), que é classe A e continua barrado | não diretamente. Habilita a execução (sessão → guia), que é classe A e continua barrada |
| Exige o módulo hoje? | **sim** (`assertConveniosOperableTx` desde 15/11) | **não** (sem checagem comercial nem de módulo) |
| Precisa continuar acessível para o histórico? | sim: sem o registro, o fato fica só no papel e a fila mostra o pedido como "aguardando" | sim, igual |
| Risco de recusar uma resposta legítima | o registro do fato atrasa até religar. A validade da senha é uma data absoluta: registrar depois não a estende. Uma negativa não registrada deixa a fila enganosa | igual |
| Risco de aceitar uma operação indevida | baixo. Só responde pedido que já existe, em `requested` ou `pending_operator` (criado quando a clínica podia operar), com evidência, datas entre o pedido e hoje, quantidade até a pedida e número da operadora sem repetição. Não fatura | igual |

**Regra consistente proposta (para decisão; nada muda no código sem ela).** A resposta da operadora a um pedido já
feito é **preservação (classe C) nos dois tipos**, porque é fato externo sobre pedido existente, não cria obrigação e
não altera guia. Quatro travas impedem que a preservação vire criação, e já existem nos dois serviços:
1. só responde pedido existente da clínica, aguardando resposta. Nunca cria pedido nem item;
2. "autorizada" só com evidência da operadora;
3. quantidade até a pedida, e data entre o pedido e o dia da clínica;
4. não move guia nem cria cobrança. O passo seguinte (sessão, guia, emissão, lote) continua classe A, barrado com o
   módulo desligado e com a assinatura parada.

Efeito no código, **se aprovada:** a Consulta deixa de chamar `assertConveniosOperableTx` na resposta (o pedido
continua chamando), com testes nos dois sentidos: a resposta passa com o módulo desligado e com a assinatura suspensa,
e a emissão da guia que usaria a autorização continua recusada.

**Alternativa:** as duas como classe A. A SP/SADT passaria a chamar `assertConveniosOperableTx` na resposta. É mais
restritiva e atrasa o registro de fatos reais, sem ganho de segurança financeira.

**Até a decisão:** fica como está (Consulta barrada, SP/SADT permitida).

## 7. Proposta: o interruptor também nos gatilhos do banco (16/11/2026)

**Situação:** proposta técnica, **não aplicada**. A candidata
[`migrations/hi_module_switch_guard.candidate.sql`](migrations/hi_module_switch_guard.candidate.sql) está fora do
journal e **sem número**. O número é escolhido só na autorização, depois da 0162 e pela coordenação com o #53. Não
entra na 0162 nem no pacote SaaS (0136–0159). Não altera gatilho nenhum no DEV.

**O que acrescenta:** defesa em profundidade da classe A. Hoje o serviço recusa; a candidata faz o banco recusar também
um caminho que pule o serviço (script, função do banco chamada direto, código novo que esqueça o guard).

**Escopo exato (o mesmo conjunto do serviço, nada além):**

| Tabela | Barrado com o módulo desligado |
| --- | --- |
| `hi_guides` | INSERT; `ready_for_review → reviewed`; `reviewed → approved`; mudança de `consulta_overrides` |
| `hi_guide_snapshots` | INSERT |
| `hi_batches` | INSERT; estado → `validated`, `exported`, `sent` |
| `hi_files` | INSERT de `batch_xml`, `authorization_request_xml`, `authorization_request_pdf` (lista fechada) |
| `hi_authorizations`, `hi_sadt_requests`, `hi_appointment_coverages` | INSERT |
| `hi_copayments` | estado → `confirmed` |

**Continua passando:** cancelar guia, devolver, reabrir; guia voltando a "aprovada" quando o lote é cancelado ou
reaberto; protocolo, análise, retorno e demonstrativo do lote; recurso de glosa; glosas, pagamentos, alocações e
estornos; repasses; resposta, vencimento e comprovante de autorização; cancelar e concluir solicitação SP/SADT;
coparticipação indo a `charged` (portão próprio); ligar e desligar o módulo; carteirinha; renderização do PDF já
emitido.

**Cuidados pedidos pelo fundador:**

| Cuidado | Como a candidata trata |
| --- | --- |
| Operações internas legítimas | só a classe A é barrada; a geração automática de guia já para antes no serviço (`module_disabled` vira pendência) |
| Migrações históricas | a candidata só cria a função e os gatilhos; não reescreve migration nem dado |
| Backfills | uma migration futura que precise inserir para clínica desligada desliga o gatilho **pelo nome** dentro da própria transação. Não há variável de sessão de escape, porque uma sessão autenticada poderia defini-la |
| Restauração | carregar dados com `session_replication_role = replica` (ou `--disable-triggers`), como os gatilhos D24 já exigem. Confirmar no roteiro de backup antes de aplicar |
| Auditoria | nada muda: a recusa acontece antes de gravar |
| Cancelamento e obrigações | fora do escopo (provado) |
| Integrações e reprocessamentos | retorno, demonstrativo e recurso passam; a exportação pedida antes de desligar já termina como recusa definitiva no serviço |

**Ordem e mensagem:** os gatilhos `hi_ab_module_*` disparam depois do D24 (`hi_aa_premium_*`) e antes das validações.
No trial, a resposta continua sendo a comercial. O erro do banco é 55000 / `hi_module_enabled`, sem dado interno. Pelo
serviço, a mensagem da tela não muda, porque ele recusa antes. O código que traduz o erro do banco sobe junto com a
aplicação.

**Prova sintética:** `scripts/security/health-insurance-module-switch-triggers-db.ts`, 9 provas no job do Actions
(cadeia na ordem do DEV, dados sintéticos):
1. aplica e reaplica;
2. tipos de arquivo classificados e ordem dos gatilhos;
3. classe A recusada por caminho direto, sem criar nem mudar nada;
4. recuperação e preservação passam;
5. trial responde a comercial;
6. o serviço responde primeiro;
7. restauração e backfill;
8. religado, passa;
9. reversão e reaplicação.

**Pedido (quando o fundador quiser):** autorizar a candidata como migration do #55, com número definido na hora,
aplicada no DEV pelo mesmo procedimento da 0161 (pré-voo, backup, aplicação limitada, pós-voo), depois da 0162.
