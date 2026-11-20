# Capacidade do outbox compartilhado: diagnóstico, benchmark e proposta para produção

Estado em 20/11/2026. **Nada mudou em produção.** A alteração de `OUTBOX_BATCH_SIZE` em produção depende de GO específico do fundador.

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

**Eventos por atendimento concluído:** 4. A guia de convênio (`insurance_completed`) é processada **logo depois da resposta**, sem esperar o cron. Os outros 3 vão para o cron:
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

## 4. Proposta

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

## 5. Operação controlada (só com GO do fundador)

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

**Este documento não é o GO.** O benchmark foi autorizado em ambiente sintético; a mudança em produção não.
