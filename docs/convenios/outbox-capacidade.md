# Capacidade do outbox compartilhado: diagnóstico, benchmark e proposta para produção

Estado em 20/11/2026 (noite, ciclo R61-B). **Nada mudou em produção.** Recomendação: **opção B** (§4); ficha do GO R61-C no §5; R61-B (proteção no cron compartilhado, patch para o #53) no §9. A alteração de `OUTBOX_BATCH_SIZE` em produção depende de GO específico do fundador.

O outbox é a fila de eventos de **todo** o Qoro, não só do módulo Convênios. Um atraso nele atrasa:
- o recebível do atendimento particular;
- o prontuário rascunho criado pelo cron (a ação de iniciar a consulta já cria o rascunho na hora; o cron é só a reserva);
- as demais tarefas de todas as clínicas.

## 1. Como funciona hoje (código)

| Item | Valor | Fonte |
| --- | --- | --- |
| Frequência | 1 tick por minuto (Vercel cron) | `vercel.json` |
| Lote | `OUTBOX_BATCH_SIZE` = 50 (padrão; variável de ambiente, teto 500) | `src/lib/env.ts` |
| Paralelismo | `OUTBOX_PARALLELISM` = 5 (handlers ao mesmo tempo) | idem |
| Ordem | uma fila só, FIFO global por `next_attempt_at`, `created_at`; sem prioridade nem justiça por clínica | `src/lib/outbox/worker.ts` |
| Conexões | reserva e finalização de todos os eventos por **uma** conexão (`dbWorker`, pool 2: 1 segura o lock, 1 trabalha); handlers no pool do app | `src/lib/db/index.ts` |
| Tempo do tick | sem orçamento interno; limitado pelo `maxDuration` de 60 s da função | `src/app/api/cron/outbox/route.ts` |
| Falhas | backoff 0 → 30 s → 5 min → 30 min → 6 h → `failed`; disjuntor por tipo (≥ 10 falhas em 5 min pausam o tipo por 5 min) | `backoff.ts`, `circuit.ts` |
| Retomada | evento preso em `processing` volta à fila depois de 5 min (janitor); finalização com guarda contra corrida | `worker.ts` |

**Eventos por atendimento concluído:** 4 (5 no particular, que publica também o `financial.lancamento.created` ao criar o recebível). A guia de convênio (`insurance_completed`) é processada **logo depois da resposta**, sem esperar o cron. Os outros 3 vão para o cron:
- `checked_in` não tem consumidor e é descartado, mas ocupa vaga no lote;
- `started` é a reserva do prontuário rascunho;
- `completed` gera o recebível do particular.

## 2. Causa real

O cron trata no máximo **lote × 1 por minuto**. No pico de referência (50 conclusões por minuto numa clínica), entram 150 eventos por minuto no cron. Com lote 50, a fila cresce cerca de 100 eventos por minuto enquanto o pico durar.

**Não é lentidão de processamento:** com lote 200 o tick leva de 1 a 3 s (latência de 2 ms) ou cerca de 14 s (latência de 10 ms). É **capacidade por minuto**, ou seja, lote × frequência.

Fatores secundários medidos:
- **Latência até o banco:** a reserva e a finalização serializadas numa conexão fazem o tick crescer com lote × latência, cerca de 70 ms por evento a 10 ms de ida e volta.
- **Consumidores lentos:** um tick com eventos lentos dura (eventos lentos ÷ 5) × duração de cada um.

## 3. Benchmark controlado

Rodou no runner do GitHub: run `44643529410`, evidência em `evidence/outbox-capacidade-2026-11-20/benchmark-runner.json`, harness em `scripts/security/outbox-capacity-db.ts`.

Condições:
- worker real (`runOutboxOnce`) e handlers reais da conclusão;
- Postgres 17 descartável com as migrations reais;
- latência emulada por proxy (ida e volta medida de 2,2 ms e 10,3 ms);
- carga distribuída entre clínicas, 60% convênio e 40% particular;
- tempo simulado: 1 tick por minuto, com o relógio da fila avançando 60 s.

**Atraso máximo de um evento (minutos), meta ≤ 5:**

| Cenário | Lote 50 | Lote 100 | Lote 150 | Lote 200 |
| --- | :-: | :-: | :-: | :-: |
| Normal (10/min, 3 min) | 1 | 1 | 1 | 1 |
| **Pico (50/min, 3 min, 3 clínicas)** | **8** | 3 | 2 | **1** |
| Acima do pico (100/min, 2 min) | 12 | 6 | 4 | 3 |
| Pico + consumidor lento (20 eventos de 1,5 s por minuto) | 9 | 4 | 2 | 1 |
| Falha transitória + veneno (disjuntor) | 10 | 9 | 9 | 9 |
| Pico com latência de 10 ms | 8 | 3 | 2 | 1 |

**Recebível do particular** (atraso máximo, em minutos):

| Cenário | Lote 50 | Lote 100 | Lote 150 | Lote 200 |
| --- | :-: | :-: | :-: | :-: |
| Pico | 8 | 3 | 2 | 1 |
| Acima do pico | 12 | 6 | 4 | 3 |

**Pior duração do tick** (limite da função: 60 s):

| Cenário | Lote 50 | Lote 100 | Lote 150 | Lote 200 |
| --- | :-: | :-: | :-: | :-: |
| Pico, latência de 2 ms | 3,0 s | 1,9 s | 2,8 s | 3,3 s |
| Pico, latência de 10 ms | 4,0 s | 7,8 s | 11,6 s | 13,9 s |
| Pico com consumidor lento | 6,6 s | 7,5 s | 8,4 s | 9,3 s |

**Pane de consumidor** (60 eventos de 6 s pendentes):

| Lote 50 | Lote 200 |
| :-: | :-: |
| **60,3 s** | **73,2 s** |

Os dois passam do limite: o risco já existe hoje.

**Integridade (todas as 25 rodadas):**
- nenhum recebível, guia ou prontuário perdido ou duplicado;
- nada processado com a clínica errada, nenhum evento preso;
- convênio nunca cobrado cheio;
- a falha transitória se recupera na 2ª tentativa;
- o veneno vira `failed` sem afetar os demais.

**Banco:** no máximo 6 conexões ativas e 0 locks esperando em qualquer lote (o paralelismo continua 5).

**Recuperação:** com falha, o tipo afetado espera cerca de 10 min, por causa do disjuntor e do backoff. Isso independe do lote; os outros tipos seguem.

## 4. Decisão recomendada (20/11): opção B

**B — lote 200 seguro somente depois da proteção adicional de tempo**, com o descarte em bloco dos eventos sem consumidor. Evidência no §8 (benchmark de decisão no runner, 14 rodadas, integridade conferida em todas).

| Opção | Por que sim ou não |
| --- | --- |
| A — lote 200 só com as proteções existentes | **não**: sustenta o pico de 50/min, mas uma pane de consumidor leva o tick a 73 s (passa dos 60 s, junto com a AbacatePay depois do #53) |
| **B — lote 200 + prazo de reserva (30 s) + descarte em bloco** | **sim**: sustenta 50/min indefinidamente (fila zero a cada minuto, atraso de 1 min); a pane fica em 30,5 s; nada se perde nem duplica; capacidade sustentada de cerca de 83 atendimentos/min |
| C — lote 150 com as mesmas proteções | aceitável como etapa intermediária: também sustenta 50/min (fila zero), mas com folga menor (cerca de 62 atendimentos/min) |
| D — mudar arquitetura ou frequência antes de produção | **não é necessário** para o pico de referência; vira necessário se a carga sustentada passar de cerca de 80 atendimentos/min em toda a plataforma |

**Capacidade sustentada** (eventos por minuto que o cron trata ÷ eventos por atendimento; com 40% de particular são 3,4 eventos de cron por atendimento, ou 2,4 sem o `checked_in`):

| Configuração | Atendimentos/min sustentados | Conferido no benchmark |
| --- | :-: | --- |
| Atual (50) | **cerca de 15** | 50/min: fila cresce 106/min |
| Lote 150 | cerca de 44 | 50/min: fila cresce 18/min |
| Lote 200 | cerca de 59 | 50/min: fila zero |
| 150 + descarte em bloco | cerca de 62 | 50/min: fila zero |
| **200 + descarte em bloco** | **cerca de 83** | 50/min: fila zero; 100/min: fila cresce 35/min (não sustentado) |

**Não declaramos capacidade sustentada para 100 atendimentos/min:** nenhuma configuração testada sustenta. Esse total é da plataforma inteira, não por clínica; os outros eventos do Qoro (mensagens, IA, cobrança) entram na mesma conta.

**O que muda em código:** nada além do que já está no #55, com as opções desligadas por padrão. A ligação é uma chamada no `route.ts` do cron, que o #53 também altera. Fica com o #53 na integração (`handoff-53-outbox-r61.md`, §4).

**Risco residual:**
- carga sustentada acima de cerca de 83 atendimentos/min (plataforma inteira);
- o disjuntor segura por cerca de 10 min um tipo de evento que falha em massa (é o desenho atual, não muda);
- um handler que demore mais que o próprio timeout (não deve acontecer; os clientes externos têm `AbortSignal.timeout`).

## 5. Ficha executiva do GO R61-C (produção)

**Estado (20/11, noite):** R61-A cumprido. R61-B **tecnicamente pronto do lado do #55**: o patch para o #53 está provado na composição descartável (§9) e aguarda o #53 aplicá-lo na branch dele. Quando o #53 aplicar e a CI dele ficar verde, o R61-C pode ser pedido.

| Item | Conteúdo |
| --- | --- |
| Configuração atual | `OUTBOX_BATCH_SIZE` = 50 (padrão do código); cron sem prazo de reserva nem descarte em bloco |
| Configuração proposta | **opção B**: `OUTBOX_BATCH_SIZE=200` **e** o cron chamando `runOutboxOnce({ reserveUntil: início + 30_000, skipUnhandledInBulk: true })` |
| Código necessário | o patch R61-B no `route.ts` do #53 (`docs/convenios/r61b/r61b-para-53.patch`); o worker já está no #55 (`ed2fd056` e `85d37eb9`) e vai idêntico no patch |
| Testes | `outbox-budget-db.ts` 6/6; `outbox-shared-cron-db.ts` 6/6, com corte real aos 60 s; composição #53 + patch (§9); benchmark de decisão e R61-B (§8 e §9) |
| Impacto na AbacatePay | **positivo**: o outbox para de reservar aos 30 s. As tarefas da AbacatePay terminam e gravam antes de um eventual corte, mesmo com consumidor travado (provado). Os prazos dela não mudam |
| Responsáveis | #53 (aplicar o patch na rota), #55 (worker e provas), fundador (GO e variável de produção) |

**Gates:**

| Gate | O que é | Situação |
| --- | --- | --- |
| R61-A | homologação técnica DEV/Preview | **cumprido** em ambiente sintético |
| R61-B | proteção implementada na branch responsável e provada | **pronto do lado do #55**: patch provado em composição; falta o #53 aplicar e rodar as regressões do C3 |
| R61-C | sua aprovação explícita | **pronto para pedir** depois do R61-B no #53 |
| R61-D | mudança controlada em produção | depois da integração (#53 → #56 → #55) e do C |
| R61-E | observação operacional | 24 h por etapa, com os critérios abaixo |

**Rollout recomendado (R61-D), em duas etapas:** primeiro a proteção, depois a capacidade, para que cada mudança seja observada sozinha.

1. **Etapa 1, proteção com o lote atual.** A rota com o patch vai para produção no deploy da integração, aprovado à parte, com `OUTBOX_BATCH_SIZE` ainda em 50. Observar 24 h:
   - `worker.tick` com `duration_ms` abaixo de 35 s;
   - `skipped_bulk` coerente com as chegadas;
   - `deferred` só em pane.
2. **Etapa 2, capacidade.**
   - Registrar o valor atual da variável.
   - Mudar só `OUTBOX_BATCH_SIZE` para 200 (ou 150, na opção C).
   - Redeployar o mesmo commit.
   - Conferir o primeiro `worker.tick` com fila.
   - Observar 24 h.

**Monitoramento (R61-E):**
- `worker.tick`: `duration_ms`, `deferred`, `skipped_bulk` e `processed`;
- `outbox.handler_slow` (novo): qualquer ocorrência mostra qual tipo de evento passou de 25 s;
- a fila pendente, sem tendência de alta;
- nenhum timeout da rota;
- `outbox.lost_race` e `worker.tick.skipped_overlap` zerados;
- financeiro: um recebível por particular concluído, nenhum duplicado e nenhuma divergência nova na conciliação (Asaas e AbacatePay);
- `billing.abacatepay.inbox_tick` sem queda de itens.

**Critérios de interrupção:**
- `duration_ms` acima de 45 s;
- timeout da rota;
- `lost_race` ou `skipped_overlap`;
- aumento de `failed`;
- divergência financeira;
- fila crescendo por mais de 15 min sem pico de atendimentos;
- `outbox.handler_slow` repetido para o mesmo tipo de evento (mais de 3 numa hora). Esse último pede investigação do handler antes de seguir.

**Retorno:**
- **Etapa 2:** a variável volta ao valor registrado, com redeploy, ou a Vercel volta instantaneamente ao deploy anterior.
- **Etapa 1:** volta ao deploy anterior. Sem a chamada nova, as opções do worker ficam desligadas.

**Este documento não é o GO** de nenhum gate além do R61-A, que já estava autorizado, e da execução técnica do R61-B em DEV/Preview, autorizada em 20/11.

## 5.1 Operação anterior (19/11, substituída pela ficha acima)

A operação abaixo, de 19/11, mudava só a variável, sem a proteção de tempo. Foi substituída pela opção B. Fica registrada como histórico.

### Proposta de 19/11 (substituída pela opção B)

| Item | Proposta |
| --- | --- |
| Valor atual | `OUTBOX_BATCH_SIZE=50` |
| **Valor recomendado** | **`OUTBOX_BATCH_SIZE=200`** |
| Ganho observado | pico de 8 → 1 min; acima do pico de 12 → 3 min; recebível particular de 8 → 1 min |
| Consumo adicional | o tick fica mais longo só quando há fila: de 3 a 14 s no pico, conforme a latência. Conexões e concorrência não mudam (paralelismo 5) |
| Por que não 100 ou 150 | 100 não cumpre a meta acima do pico (6 min); 150 cumpre com folga zero no pico (capacidade igual à demanda). 200 dá cerca de 33% de folga para o crescimento da base |
| Rate limit externo | não aumenta: chamadas simultâneas a provedores continuam limitadas pelo paralelismo (5); o lote só deixa o tick continuar por mais tempo quando há fila |

**Riscos:**
- **Tick mais longo com consumidor lento ou em pane.** Com lote 200 e 60 eventos de 6 s, o tick passa de 60 s (73 s). Mas o lote 50 atual também passa (60,3 s): o risco já existe e o lote maior o agrava.
- **Função cortada no meio:** os eventos em `processing` voltam à fila depois de 5 min (janitor). Os handlers são idempotentes, então não há duplicidade, mas o atraso aumenta.
- **Coordenação com o #53:** no #53, a rota do cron também executa, **na mesma invocação** e em paralelo, a reconciliação da AbacatePay (recuperação, inbox, fechamentos, renovação). Um tick longo divide os mesmos 60 s com ela.

**Mitigação recomendada (decisão à parte, mudança de código na plataforma):** orçamento de tempo dentro do tick, parando de reservar eventos novos depois de cerca de 40 s. Assim nenhuma combinação de lote e consumidor lento passa do limite da função. Não foi implementado: é código compartilhado (worker) e precisa do dono da plataforma e de coordenação com o #53.

**Dependências:**
- Variável de ambiente de **produção** na Vercel.
- A variável só vale depois de um novo deploy do mesmo commit, sem código novo.
- Não depende de migration.

### Passos da operação de 19/11

1. **Registrar o valor anterior:** em Vercel › Settings › Environment Variables (Production), anotar se `OUTBOX_BATCH_SIZE` existe e com qual valor. Se não existe, o código usa 50.
2. **Aplicar só o ajuste autorizado:** `OUTBOX_BATCH_SIZE=200` em Production; nenhuma outra variável muda.
3. **Propagar:** redeploy do commit que já está em produção.
4. **Conferir:** no log do primeiro `worker.tick` depois do deploy, quando houver fila, `processed + skipped + empty` deve passar de 50.
5. **Monitorar 24 h:**
   - `worker.tick` (`duration_ms`, `processed`, `failed`);
   - ausência de `worker.tick.skipped_overlap` e de `outbox.lost_race`;
   - nenhum timeout da rota `/api/cron/outbox`;
   - fila pendente sem crescimento contínuo.
6. **Conferir o financeiro:**
   - todo atendimento particular concluído tem um recebível, sem duplicado;
   - nenhum recebível cheio de convênio;
   - conciliação diária sem divergência nova (Asaas legado e, depois do #53, AbacatePay).
7. **Critérios de interrupção (voltar na hora):**
   - `duration_ms` acima de 45 s;
   - timeout da rota;
   - `worker.tick.skipped_overlap` ou `outbox.lost_race`;
   - aumento de `failed`;
   - qualquer divergência financeira.
8. **Retorno:** voltar a variável para o valor anotado (ou removê-la) e redeployar. Alternativa: rollback instantâneo da Vercel para o deploy anterior, que guarda o ambiente antigo.

## 6. O evento sem consumidor (20/11)

**Resposta:** `scheduling.appointment.checked_in` é um evento **legítimo publicado à frente do consumidor**. Não é obsoleto e não há handler faltando por defeito.

| Pergunta | Evidência |
| --- | --- |
| Nome exato | `scheduling.appointment.checked_in` (`SCHEDULING_EVENTS.CHECKED_IN`) |
| Onde nasce | na transição para "chegou" (`TRANSITION_EVENT.chegou` em `src/contexts/scheduling/state-machine.ts`), publicado pelo core da agenda |
| Por que nasce | é o evento de domínio da chegada do paciente (schema `TransitionBase` em `scheduling/events.ts`), para os lembretes e notificações de agenda da camada C14 |
| Havia consumidor? | não: o histórico do git não tem handler registrado para ele em nenhum momento |
| Consumidor em outro PR? | não: nenhum handler em `main`, #53, #56, #57, #28 nem #59 |
| Registrado com outro nome? | não: o catálogo tem o schema e o registro não tem handler |
| Natureza | evento de domínio para integração futura; **não é financeiro nem obrigatório** |
| Contrato explícito | está na lista "producer ahead of consumer" do gate (`scripts/check-handler-registry.ts`, F-14, desde 10/06/2026); o gate exige tirar da lista quem ganhar handler |
| Como a fila trata | `processOne` reserva, vê schema sem handler e finaliza `skipped` (terminal, sem retentativa, sem disjuntor), com `processed_at`; a métrica é `outbox.skipped_no_handler`; o `/api/health/outbox` conta os `skipped` |
| Impacto na capacidade | 1 de cada 3 vagas do lote no fluxo de conclusão (chegada, início, conclusão), mais uma reserva e uma finalização pela conexão única do worker |

O mesmo vale para os outros tipos da lista F-14 (por exemplo `scheduling.appointment.confirmed`, `patient.core.*`, `billing.*`).

**Política proposta (sem apagar nada):** descarte em bloco dos tipos sem handler no início do tick (`skipUnhandledInBulk`).
- O evento continua publicado e registrado no outbox, com o **mesmo desfecho de hoje**: `skipped`, `processed_at`, tentativa contada.
- Fica auditável, contado no health e na métrica.
- O que muda é só que ele não ocupa vaga do lote.
- Quando um tipo ganhar handler, ele sai sozinho da lista de descarte, porque a lista é calculada do registro em cada tick.
- Prova: `outbox-budget-db.ts`, prova 4 (paridade de campos com o caminho normal; agendados para depois ficam).

**Alternativa não recomendada agora:** parar de publicar o evento. Isso apagaria a integração futura do C14 e mudaria o contrato do domínio da agenda, que não é do #55.

## 7. Orçamento de tempo (20/11)

**Onde fica:** no worker, como opção `reserveUntil` de `runOutboxOnce`, desligada por padrão.
- Cada vaga do lote confere o prazo **antes de reservar** um evento.
- Depois do prazo, a vaga não reserva nada e o evento fica `pending` para o próximo minuto.

**O que não faz:**
- não abandona nem "cancela" handler em andamento;
- não usa `Promise.race`: um handler financeiro iniciado termina pelo próprio caminho e pelos próprios timeouts.

Por isso não há risco de efeito pela metade nem de evento perdido. O que não foi reservado continua na fila, e o que foi reservado termina.

**Valor sugerido (30 s), com a conta:**

| Item | Valor |
| --- | --- |
| Limite da função (`maxDuration`) | 60 s |
| Partida da função (importação dos handlers e do schema) | até 5 s (estimativa conservadora) |
| Maior timeout de UMA chamada externa de um handler já iniciado | 20 s (Resend; Asaas e Meta 10 s; IA 15 s, com saga retomável) |
| Folga | 5 s |
| **Prazo de reserva** | **60 − 5 − 20 − 5 = 30 s** |

O benchmark mede o efeito real; o valor é configurável na chamada.

**Comportamento nas falhas:**

| Situação | Comportamento |
| --- | --- |
| Invocação cortada mesmo assim | os eventos em `processing` voltam depois de 5 min (janitor); handlers idempotentes, nada duplica (prova 6) |
| Invocação nova antes do fim da anterior | o advisory lock deixa uma só trabalhar (prova 5) |
| Prazo atingido com fila | o resto sai no minuto seguinte; nada se perde (prova 2) |

**Onde ligar:** na chamada do cron (`route.ts`), que o #53 também altera, ao colocar a reconciliação da AbacatePay na mesma invocação. A mudança proposta, para o #53 aplicar na integração, está em `handoff-53-outbox-r61.md` (§4). O #55 não altera esse arquivo.

## 8. Benchmark de decisão (20/11)

- **Onde e como:** runner do GitHub, run `44790428207`; evidência em `evidence/outbox-capacidade-2026-11-20/benchmark-decisao.json`.
- **Condições:** worker e handlers reais, Postgres descartável, 3 clínicas, 60% convênio e 40% particular, ida e volta de 2,3 ms (e 10,4 ms numa rodada).
- **Integridade:** conferida em todas as 14 rodadas.

**Regime sustentado, 50 atendimentos/min por 15 minutos** (entrada no cron de 170 eventos/min):

| Estratégia | Saída por tick | Fila depois de cada minuto | Atraso máx. | Drena em | Pior tick | Regime |
| --- | :-: | --- | :-: | :-: | :-: | --- |
| atual 50 | 50 | +106/min (1.596 no fim) | 33 min | 51 min | 1,8 s | não sustenta |
| lote 150 | 150 | +18/min (268 no fim) | 3 min | 17 min | 3,4 s | não sustenta (atraso cresce com o tempo) |
| lote 200 | 170 | 0 | 1 min | 15 min | 3,8 s | **sustenta** |
| 150 + prazo + descarte | 170 | 0 | 1 min | 15 min | 3,2 s | **sustenta** |
| 200 + prazo + descarte | 170 | 0 | 1 min | 15 min | 3,2 s | **sustenta** |

**Regime sustentado, 100 atendimentos/min por 10 minutos** (entrada de 340/min):

| Estratégia | Fila depois de cada minuto | Atraso máx. | Regime |
| --- | --- | :-: | --- |
| lote 200 | +124/min | 8 min | não sustenta |
| 150 + prazo + descarte | +77/min | 6 min | não sustenta |
| 200 + prazo + descarte | +35/min | 3 min (finito) | **não sustenta** |

**Outros cenários:**

| Cenário | Estratégia | Resultado |
| --- | --- | --- |
| Pico + consumidor lento (20 eventos de 1,5 s/min) | lote 200 | fila zero, atraso de 1 min, tick de 9,4 s |
| Pico + consumidor lento (20 eventos de 1,5 s/min) | 200 + proteção | fila zero, atraso de 1 min, tick de 8,8 s |
| Pico com 10 ms de latência | lote 200 | tick de 14,5 s |
| Pico com 10 ms de latência | 200 + proteção | tick de 11,9 s (o descarte em bloco poupa idas ao banco) |
| Falha transitória + veneno | 200 + proteção | recupera na 2ª tentativa; veneno vira `failed`; o tipo com falha espera cerca de 9 min (disjuntor, como hoje) |
| **Pane de consumidor** (60 eventos de 6 s) | atual 50 | 60,5 s, passa do limite |
| **Pane de consumidor** (60 eventos de 6 s) | lote 200 | 73,3 s, passa do limite |
| **Pane de consumidor** (60 eventos de 6 s) | **200 + proteção** | **30,5 s**: 25 tratados, 175 vagas adiadas, 35 ficam para o minuto seguinte, sem perda |

**Banco:** no máximo 7 conexões ativas e 0 locks esperando em qualquer estratégia.

**Interrupção e concorrência entre rodadas** (prova separada, `outbox-budget-db.ts`, 6/6):
- invocação cortada se recupera pelo janitor, sem duplicar;
- com duas invocações simultâneas, uma só trabalha.

**Este documento não é o GO.** O benchmark foi autorizado em ambiente sintético; a mudança em produção não.

## 9. R61-B (20/11, noite): proteção no cron compartilhado, implementada e provada

**Proprietário:**
- A rota do cron é do **#53**. O patch `docs/convenios/r61b/r61b-para-53.patch` é para o #53 aplicar. Ele leva 5 arquivos: `route.ts`, `route.test.ts` e o worker byte a byte igual ao do #55.
- O handoff formal, com 10 itens, está em `handoff-53-outbox-r61.md`.
- O #55 não altera a branch nem o worktree do #53.

**O que entrou no #55 (`85d37eb9`):**
- **Worker:** a métrica `outbox.handler_slow` (tipo de evento, duração, desfecho) quando um handler iniciado passa de 25 s. Só observa, nada é interrompido.
- **Conector TISS (parte exclusiva do #55):**
  - teto total de 20 s por envio, somando as tentativas;
  - cada tentativa usa no máximo o que sobra;
  - nenhuma tentativa nova sem 2 s de folga;
  - timeout de operadora acima de 20 s é recusado na configuração, em vez de ser cortado em silêncio.
  - Antes, um envio com retentativa podia levar 3 × o timeout configurado, sem teto, e passar sozinho da janela do cron.
- **Provas:** `outbox-shared-cron-db.ts` (6 cenários) e o job `r61b-composicao.yml`.

**Invocação compartilhada da rota com o patch.** A prova `outbox-shared-cron-db.ts` roda num Postgres descartável, com o worker real e os pools reais (`dbWorker`, `db` e `dbAdmin`), e as quatro tarefas financeiras com os prazos da AbacatePay. Os números são do código do #55 (run `44856201797`); a composição #53 + patch (run `44856201899`) deu os mesmos números com diferença de milissegundos.

| Cenário | Outbox | Invocação | Tarefas financeiras | Integridade |
| --- | --- | --- | --- | --- |
| Consumidores rápidos (150 + 50 sem consumidor) | 150 tratados + 50 descartados em bloco em 0,8 s | 33,2 s | as 4 dentro dos prazos | sem perda, duplicidade ou clínica errada |
| Consumidor lento (pane: 60 de 6 s + 140 rápidos) | parou de reservar aos 30 s, terminou em 30,2 s; 25 tratados, 175 vagas adiadas | 33,1 s | dentro dos prazos | drenado depois, cada evento uma vez |
| **Consumidor travado (70 s) + corte real aos 60 s** (processo morto com SIGKILL) | só o travado ficou em `processing`; os outros 70, `processed` | cortada aos 60,0 s | **as 4 terminaram e gravaram antes do corte** (último item aos 33,2 s) | o janitor devolveu o travado; a nova entrega não duplicou o efeito (2 entregas, 1 efeito) |
| Prazo quase esgotado (começou há 29 s / 31 s) | 10 reservados e 190 adiados / nenhum reservado e 200 adiados | — | as sem prazo não começaram nada | nada preso |
| Duas invocações sobrepostas | o outbox trabalhou numa só (150/0) | — | itens divididos (76/76), nenhum repetido | — |
| Handler de CPU (60 blocos síncronos de 300 ms) | 18,6 s | 33,5 s | todas antes do prazo (a pior, 1,5 s antes); de 9% a 22% menos itens naquele minuto | event loop p99 306 ms |

**Composição #53 + patch (run `44856201899`):**

| Gate | Resultado |
| --- | --- |
| Patch aplicado sobre `fad3d5d3`; worker igual ao do #55 (`cmp`) | **PASS** |
| Fusão futura com o #55 | **PASS**: só os 4 conflitos já conhecidos; nenhum no outbox nem na rota |
| Typecheck, lint, gate do registro | **PASS** |
| Testes da rota do cron e do worker | **PASS** (33/33, incluindo os 3 novos da rota) |
| Suíte completa do #53 com o patch | **PASS** (7.411/7.411, 652 arquivos) |
| Isolamento entre duas clínicas | **PASS** |
| Build | **PASS** |
| `outbox-budget-db.ts` e `outbox-shared-cron-db.ts` | **PASS** (6/6 e 6/6) |
| Inventário de segurança | FAIL **da composição, não do patch**: a contagem incluiu os harnesses do #55 copiados para a pasta. O workflow foi corrigido para rodar os gates do #53 antes da cópia; o resultado da nova execução está no §9.1 |

**O que a prova mostra e o que não mostra:**
- **Mostra:**
  - o outbox não reserva depois de 30 s;
  - handler iniciado não é abandonado;
  - as tarefas financeiras terminam e gravam no próprio prazo, qualquer que seja o estado do outbox, inclusive com um handler travado e a função cortada;
  - nada se perde nem duplica;
  - a recuperação é pelo janitor.
- **Não mostra:**
  - que a invocação nunca passa de 60 s: um handler que ignore os próprios timeouts ainda pode segurá-la;
  - o comportamento das tarefas reais da AbacatePay, que são do #53 (as regressões do C3 ficam com ele).
