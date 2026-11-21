# Handoff ao #53 (AbacatePay): risco R61 no cron compartilhado do outbox

De: agente do #55 (Convênios TISS). Para: agente do #53 (AbacatePay). Data: 20/11/2026.

**Nada aqui mexe no código financeiro do #53, nem antecipa o piloto C3, nem toca em flags live ou em produção.** O GO de produção do R61 é separado do GO do C3.

## 1. O que acontece

O outbox é a fila de eventos de todo o Qoro. O cron `/api/cron/outbox` roda a cada minuto, com `maxDuration = 60`. Hoje ele trata até `OUTBOX_BATCH_SIZE` = 50 eventos por invocação, com paralelismo 5.

**Causa (benchmark no runner, 25 rodadas, integridade conferida em todas):** a capacidade é lote × 1 por minuto.
- No pico de referência (50 atendimentos concluídos por minuto numa clínica), entram cerca de 170 eventos por minuto no cron: chegada, início, conclusão e, no particular, o `financial.lancamento.created`.
- Num pico curto, o lote 50 deixa até 8 min de atraso (meta: 5), e o lote 200 deixa 1 min.
- Em regime (50/min por 15 min, benchmark de decisão de 20/11): com o lote 50, a fila cresce 106/min e o atraso chega a 33 min; com o lote 200, a fila fica zero.

**O que atrasa:** o recebível do atendimento particular, a reserva do prontuário rascunho e as tarefas de todas as clínicas.

## 2. Onde o #53 entra

No #53, `src/app/api/cron/outbox/route.ts` executa **na mesma invocação**, em paralelo (`Promise.allSettled`):

| Tarefa | Prazo próprio |
| --- | --- |
| `runRegisteredOutbox()` (outbox) | nenhum hoje |
| `reconcileAbacatePayRecoveryTick` | 35 s |
| `reconcileAbacatePayInboxTick` | — |
| `reconcileAbacatePayCheckoutClosuresTick` | 20 s |
| `reconcileAbacatePayRenewalWatchTick` | — |

A invocação termina quando todas terminam. Se o outbox passar de 60 s, a função é cortada:
- a resposta e o heartbeat se perdem;
- os eventos em `processing` voltam à fila depois de 5 min (janitor);
- as tarefas da AbacatePay que ainda estiverem rodando são cortadas junto.

**Durações medidas do tick do outbox:**
- 1 a 14 s em operação normal e no pico, conforme a latência até o banco.
- Com consumidor externo em pane (eventos de 6 s): **60,3 s com o lote 50 atual** e 73,2 s com 200.

O risco já existe hoje e cresce com o lote.

## 3. Proteção preparada no #55 (sem efeito até alguém ligar)

`runOutboxOnce` ganhou duas opções, desligadas por padrão:

| Opção | O que faz |
| --- | --- |
| `reserveUntil` | Cada vaga confere o prazo **antes de reservar**. Depois do prazo, não reserva e o evento fica `pending` para o próximo minuto. Handler já iniciado **não é abandonado**: termina pelo próprio caminho e pelos próprios timeouts (Asaas 10 s, Meta 10 s, IA 15 s, Resend 20 s). |
| `skipUnhandledInBulk` | Os eventos do catálogo sem handler (lista "producer ahead" do gate F-14, como `scheduling.appointment.checked_in`) viram `skipped` num UPDATE só, com o mesmo desfecho de hoje, sem ocupar vaga do lote. |

**Provas:** `scripts/security/outbox-budget-db.ts`, 6/6, no job sintético.
- Sem as opções, o tick é o de sempre.
- O prazo para de reservar, e os handlers iniciados concluem.
- Cada evento é tratado uma única vez.
- O descarte em bloco tem paridade de campos com o caminho normal.
- Com duas invocações simultâneas, só uma trabalha.
- Uma invocação cortada se recupera pelo janitor, sem duplicar.

**Benchmark de decisão (20/11, runner, 14 rodadas, integridade conferida em todas):** com lote 200, prazo de 30 s e descarte em bloco, a fila fica zero a cada minuto com 50 atendimentos/min por 15 min, e a pane de consumidor fica em 30,5 s (sem a proteção: 73,3 s). **Recomendação: opção B** (`outbox-capacidade.md` §4).

**Prazo de reserva sugerido: 30 s.** Conta: 60 s, menos até 5 s de partida da função, menos o maior timeout de uma chamada externa de um handler já iniciado (20 s), menos 5 s de folga. O benchmark de decisão (`docs/convenios/outbox-capacidade.md`) mede o efeito real.

## 4. Mudança proposta no `route.ts` do #53 (para o #53 aplicar; o #55 não altera este arquivo)

```ts
// GET: guardar o início da invocação logo no começo do handler.
const invocationStartedAt = Date.now();
// ...
async function runRegisteredOutbox(invocationStartedAt: number) {
  await import('@/lib/db/schema');
  await import('./handlers');
  return runOutboxOnce({
    // R61: o outbox para de reservar eventos novos 30 s depois do início da invocação.
    reserveUntil: invocationStartedAt + 30_000,
    skipUnhandledInBulk: true,
  });
}
// ...
const [outbox, recovery, inbox, closures, watch] = await Promise.allSettled([
  runRegisteredOutbox(invocationStartedAt),
  // tarefas da AbacatePay sem mudança
]);
```

O lote continua na variável `OUTBOX_BATCH_SIZE`. O valor de produção (200) é decisão separada (GO R61), e o código não muda para isso.

## 5. Cenários de falha a cobrir

| Cenário | Comportamento esperado |
| --- | --- |
| Consumidor externo lento ou fora | Outbox para de reservar aos 30 s; a invocação termina antes de 60 s; o resto sai nos minutos seguintes |
| Função cortada no meio | Eventos em `processing` voltam em 5 min (janitor); handlers idempotentes; nada duplica |
| Invocação nova antes do fim da anterior | Advisory lock: a segunda não processa o outbox (`skipped_overlap`); as tarefas da AbacatePay seguem as próprias travas |
| Tarefa da AbacatePay lenta | Prazos próprios (35 s e 20 s); o outbox não consome esse tempo, porque roda em paralelo |
| Evento sem consumidor em massa | Descarte em bloco; não ocupa vaga |

## 6. Regressões obrigatórias na integração

- `src/app/api/cron/outbox/route.test.ts` (do #53), com a chamada nova.
- `scripts/security/outbox-budget-db.ts` (6/6).
- `scripts/security/outbox-capacity-db.ts` no runner (estratégias, regime sustentado, pane).
- As regressões do C3 do #53, sem mudança de contrato da AbacatePay.
- As provas sintéticas do #55: recebível particular sem duplicidade, guia sem duplicidade, nada na clínica errada.

## 7. Compatibilidade com o C3

As tarefas da AbacatePay não mudam. O prazo do outbox só limita a fatia de tempo do outbox na invocação compartilhada, ou seja, **protege** as tarefas da AbacatePay de serem cortadas por um outbox longo. O GO do C3 e o GO do R61 são independentes.

## 8. O que o #55 pede ao #53

1. Revisar este handoff (Gate R61-B).
2. Na integração (ordem #53 → #56 → #55): aplicar a mudança do §4 no `route.ts` do #53, ou aceitar que o #55 a aplique na reconciliação, depois do #53 na main.
3. Confirmar que nenhuma tarefa da AbacatePay depende de o outbox processar tudo na mesma invocação.
