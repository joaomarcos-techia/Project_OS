# Handoff R61-B ao #53 (AbacatePay): proteção de tempo no cron compartilhado do outbox

De: agente do #55 (Convênios TISS). Para: agente do #53 (AbacatePay). Atualizado em 20/11/2026 (ciclo R61-B).

**Nada aqui mexe no código financeiro do #53, nem antecipa o piloto C3, nem toca em flags live ou em produção.** O GO de produção do R61 (R61-C) é separado do GO do C3. O #55 não altera a branch nem o worktree do #53: o patch abaixo é para o #53 aplicar.

## 1. Problema

O cron `/api/cron/outbox` roda a cada minuto, com `maxDuration = 60`. No #53, a mesma invocação roda, em paralelo, o outbox e as quatro tarefas da AbacatePay.

O outbox não tem prazo hoje. Com um consumidor externo em pane, o tick mede **60,5 s com o lote 50** e 73,3 s com 200 (benchmark no runner). Se a função passa de 60 s:
- ela é cortada;
- a resposta e o heartbeat se perdem;
- os eventos em `processing` voltam em 5 min, pelo janitor.

Capacidade: com o lote 50, a plataforma sustenta cerca de 15 atendimentos/min. No regime de 50/min, a fila cresce 106 eventos/min.

## 2. Arquivos afetados

| Arquivo | Dono | Mudança |
| --- | --- | --- |
| `src/app/api/cron/outbox/route.ts` | **#53** (a rota compartilhada é dele) | um relógio só para a invocação; `runOutboxOnce({ reserveUntil: início + 30 s, skipUnhandledInBulk: true })`; os prazos da AbacatePay derivados do mesmo relógio (mesmos valores de hoje) |
| `src/app/api/cron/outbox/route.test.ts` | **#53** | 3 testes novos (janela do outbox, mesmo relógio, outbox adiado é tick bem-sucedido) |
| `src/lib/outbox/worker.ts`, `types.ts`, `worker-targeted.test.ts` | biblioteca compartilhada; já no #55 | opções `reserveUntil` e `skipUnhandledInBulk` (desligadas por padrão) e a métrica `outbox.handler_slow`. Vão no patch **byte a byte iguais** às do #55, porque o #53 entra antes na main |

**Não muda:** `vercel.json`, `maxDuration`, as tarefas da AbacatePay, os contratos financeiros, as migrations e as flags.

## 3. Solução escolhida e proprietário

**A rota do #53 aplica a proteção, e o worker compartilhado fornece o mecanismo.**

| Pergunta | Resposta |
| --- | --- |
| Quem controla o orçamento global de tempo? | A rota. Ela tem o `maxDuration` e compõe todas as tarefas da invocação |
| Quem conhece as obrigações de cada etapa? | Cada tarefa: o worker conhece eventos e handlers; cada tarefa da AbacatePay conhece seus itens |
| Quem pode parar de retirar trabalho com segurança? | O laço de cada tarefa. O worker para de **reservar** no prazo (`reserveUntil`). As tarefas da AbacatePay já não admitem item novo sem folga até o próprio prazo |
| Como evitar duplicar lógica? | A rota só toma um relógio e passa prazos. Não existe um segundo mecanismo: o do worker é o `reserveUntil`, e os da AbacatePay continuam os dela |
| Qual PR é o dono? | O #53, pela rota. O worker já está no #55 e vai idêntico no patch |
| Que contratos financeiros mudam? | Nenhum. As tarefas da AbacatePay recebem os mesmos prazos de hoje (35 s e 20 s), agora do mesmo relógio. Um evento do outbox adiado fica `pending` para o minuto seguinte: é atraso, não perda |
| Como evitar conflito de merge? | O worker vai byte a byte igual nos dois PRs, então a fusão do #55 depois do #53 não conflita nesses arquivos. O job de composição confere isso a cada push (§6) |

A ideia de aplicar no "fluxo de reconciliação" do #55, sugerida antes, falava da **reconciliação das branches**, não da reconciliação financeira da AbacatePay. Ela foi descartada: deixaria a rota sem proteção até o #55 entrar e espalharia a responsabilidade.

## 4. Justificativa da margem (30 s)

60 s de `maxDuration`, menos até 5 s de partida da função, menos 20 s para um handler já iniciado terminar (o maior timeout de uma chamada externa: Resend), menos 5 s de folga.

Um handler que passe de 25 s depois de iniciado emite `outbox.handler_slow` (tipo de evento, duração, desfecho), sem ser interrompido. É assim que o monitoramento enxerga o risco residual (§8).

## 5. Patch

- **Arquivo:** `docs/convenios/r61b/r61b-para-53.patch`, na branch `feat/convenios-tiss-20261110`, gerado sobre o commit `fad3d5d3` do #53.
- **Conteúdo:** 5 arquivos, +193/−12.
- **Como aplicar na branch do #53:**

```bash
git fetch origin feat/convenios-tiss-20261110
git show origin/feat/convenios-tiss-20261110:docs/convenios/r61b/r61b-para-53.patch | git apply --index
```

- Aplica limpo sobre `fad3d5d3`.
- Se o #53 tiver mudado a rota depois desse commit, o #55 regenera o patch: basta pedir.

## 6. Testes

| Prova | Onde | Resultado |
| --- | --- | --- |
| `route.test.ts` (3 novos + os do #53) | composição no runner | **PASS** (33/33 com o worker) |
| `worker-targeted.test.ts` (3 novos: handler lento) | #55 e composição | 9/9 no #55 |
| Suíte completa do #53, typecheck, lint, gate do registro, inventário, isolamento entre clínicas, build | composição (`r61b-composicao.yml`) | **PASS** (suíte 7.411/7.411); inventário refeito na ordem corrigida |
| `outbox-budget-db.ts` (6 provas do worker) | #55 e composição | **PASS** 6/6 nos dois |
| `outbox-shared-cron-db.ts` (6 provas da invocação compartilhada, corte real aos 60 s) | #55 e composição | **PASS** 6/6 nos dois |
| Fusão futura (#53 + patch) × #55: só os conflitos já conhecidos, nenhum no outbox ou na rota | composição | **PASS** |

## 7. Resultados (runners do GitHub)

Composição #53 + patch no runner (run `44856201899`): patch aplicado, worker igual ao do #55, fusão futura só com os 4 conflitos já conhecidos (nenhum no outbox ou na rota), typecheck, lint, registro, testes da rota e do worker 33/33, **suíte completa do #53 7.411/7.411**, isolamento entre clínicas, build, `outbox-budget-db.ts` 6/6 e `outbox-shared-cron-db.ts` 6/6. O inventário acusou diferença por causa dos harnesses do #55 copiados para a composição; o job foi reordenado para rodar os gates do #53 antes da cópia. Detalhes e números da invocação compartilhada (inclusive o corte real aos 60 s com as tarefas financeiras gravadas antes) em `outbox-capacidade.md` §9.

## 8. Riscos residuais

- **Handler que passa dos próprios timeouts.** Exemplos: GET do Asaas com 3 tentativas (até cerca de 31 s); chamadas externas em sequência; espera de lock no banco (até 15 s por comando). Um handler assim, iniciado perto dos 30 s, pode levar a invocação além de 60 s.
  - A AbacatePay não é afetada: roda em paralelo, no pool `dbAdmin` (8 conexões, separado do `db` dos handlers e do `dbWorker`), com prazos próprios de no máximo 35 s. Quando o corte vem, o trabalho dela já foi gravado (prova 3 de `outbox-shared-cron-db.ts`).
  - O que se perde num corte: a resposta e o heartbeat do minuto. Os eventos presos voltam pelo janitor e são reentregues; os handlers são idempotentes pelo `eventId`.
- **Handler pesado de CPU no mesmo processo** atrasa as tarefas da AbacatePay pelo tempo em que bloqueia o event loop. Medido na prova 6.
- **Heartbeat único.** O heartbeat `outbox` só é gravado no fim da invocação. Sugestão opcional, decisão do #53: gravar um heartbeat próprio da AbacatePay assim que as quatro tarefas terminarem, sem esperar o outbox.

## 9. Regressões financeiras obrigatórias

- As regressões do C3 do #53, sem mudança de contrato da AbacatePay.
- No #55 (já verdes): recebível particular sem duplicidade, guia sem duplicidade e nada na clínica errada (benchmark, integridade conferida em todas as rodadas); `outbox-budget-db.ts`; `outbox-shared-cron-db.ts`.

## 10. Critérios de aceite do R61-B

1. O patch aplicado na branch do #53, com a CI do #53 verde.
2. `route.test.ts` com os 3 testes novos verdes.
3. As regressões do C3 verdes, sem mudança de contrato.
4. A composição (#53 + patch) verde no runner: suíte, typecheck, lint, build, as duas provas do outbox e a checagem de fusão.
5. Confirmação do #53 de que nenhuma tarefa da AbacatePay depende de o outbox processar tudo na mesma invocação.
6. O valor de `OUTBOX_BATCH_SIZE` em produção **não** muda no R61-B. Ele é o GO R61-C, do fundador.
