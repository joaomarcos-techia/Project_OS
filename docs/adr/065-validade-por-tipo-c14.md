# ADR-065 — Validade por tipo na fila C14

## Status

Accepted — implementado em código em 09/10/2026 (branch `fix/c14-validade-por-tipo-20261008`, PR
draft para `fix/post-merge-validation-20261001`). Sem migration, sem coluna nova e sem mudança de
env. Nenhuma escrita em DEV ou produção.

## Contexto

Nenhum caminho expirava um job `pending` da C14 (`ai_proactive_jobs`):

- `claimDue` não tinha corte por idade;
- o guard de send-time do lembrete só conferia se a consulta seguia `agendado|confirmado`;
- no DEV há um `remainder_link` em `pending` há 34 dias (o DEV não roda crons).

A ADR-063 decidiu **não** segurar a C14 com a WABA BLOCKED, e um dos motivos foi exatamente este:
liberar uma fila retida mandaria lembrete D-1 depois da consulta. Validade por tipo é a
pré-condição de qualquer "segurar" ou "reenviar quando a conta voltar a AVAILABLE".

O próprio retry já produzia o caso sem conta bloqueada nenhuma. O lembrete sai às 18h locais do
D-1, e o backoff do outbox (0 s, 30 s, 5 min, 30 min, 6 h) leva a 5ª tentativa para depois da
meia-noite. Os crons da C14 só rodam das 8h às 20h locais, então essa tentativa é reservada às 8h
do dia da consulta, com um corpo que diz "seu atendimento está agendado para **amanhã** às {{2}}".

## Decisão

1. **Cada tipo tem um prazo de envio**, `sendDeadline(type, payload, { timezone, createdAt })` em
   `proactive-jobs/application/validity.ts`. A função é pura (como `policy.ts`), e o `never` do
   switch obriga todo tipo novo a declarar o seu prazo.
2. **O prazo é calculado no send-time**, a partir do payload, do fuso da clínica e de
   `created_at`, nunca de `scheduled_for`, que o backoff reescreve. Por isso vale para os jobs que
   já estão na fila, sem coluna nem migration.
3. **O guard confere o prazo primeiro, antes de qualquer leitura.** Vencido, o job vira
   `cancelled` com um motivo estável `expired_<tipo>`: `expired_reminder`, `expired_dunning`,
   `expired_followup`, `expired_no_show_followup`, `expired_waitlist_offer`, `expired_deposit_link`
   e `expired_remainder_link`. O job nunca sai atrasado.
4. **`claimDue` não filtra por idade, de propósito.** O job vencido precisa ser reservado para ser
   fechado com o motivo. Filtrado no SQL, ele ficaria `pending` para sempre. O `claimDue` só passou
   a devolver `created_at`.
5. **A chave de envio (`job.id`) e o backoff não mudam.**

### Prazo por tipo

Os cortes por dia são dias-calendário no fuso da clínica (ADR-2): o job vale até a meia-noite
local que abre o dia do corte.

| Tipo | Vale até | Origem do dado | Por quê |
| --- | --- | --- | --- |
| `reminder` | a meia-noite local que abre o dia da consulta | payload `scheduledAt` | O corpo diz "amanhã às {{2}}". No dia da consulta, a mensagem aponta a data errada: é pior que não lembrar. É mais estrito que "até o início da consulta" pelo mesmo motivo. |
| `deposit_link` | `holdExpiresAt` | payload | "Você tem até {{3}} para pagar": depois do hold, o prazo do texto é falso e a vaga já voltou para a agenda. O `getPayableCharge` cobria parte disso (checkout vencido), mas devolvia `charge_not_payable`, o mesmo motivo de "já pago". |
| `waitlist_offer` | o que vier primeiro: o início do horário ou o fim da janela de resposta da oferta | payload `scheduledAt` e seam `offerExpiresAt` | Convite para um horário que já começou não tem como ser aceito. O status `offered` só muda quando o cron devolve a oferta à fila, então entre o vencimento e a próxima passada o `lookupWaitlistOffer` ainda dizia "aberta". |
| `dunning` | D+3: até o D+7. D+7: até o D+15 (dias de atraso sobre `dueDate`) | payload | Os dois estágios usam o mesmo template. Um D+3 atrasado sairia no mesmo dia do D+7, e o catch-up `[3, 7]` do `routeDunning` criava exatamente esses dois juntos. No D+15 o `routeDunning` passa o caso para revisão humana, e mensagem automática em cima de cobrança conduzida por uma pessoa são duas vozes. Um teste prende os cortes ao `routeDunning`. |
| `followup` | o fim do 7º dia depois de `returnDate` | payload | O corpo não cita data. Uma semana além do retorno ainda é pouco frente ao intervalo que o médico pediu, e "no seu último atendimento" segue verdadeiro. Depois disso, quem decide o contato é a clínica. |
| `no_show_followup` | o fim do 3º dia útil depois da falta | payload `noShowAt` | O job nasce para o 1º dia útil (ADR-057). Mais dois dias úteis absorvem a cauda do backoff, que a janela 8–20h empurra para o dia seguinte. Depois disso, "sua consulta consta como não realizada" já não aponta com clareza para aquela falta: em atendimento semanal, a sessão seguinte já está chegando. |
| `remainder_link` | `created_at` + 7 dias | coluna `created_at` | O payload não tem prazo, e o `scheduled_for` o backoff reescreve. Sete dias é a promessa de cobrança do restante (`REMAINDER_DUE_DAYS`, D58). O corte separa "a fila atrasou" (`expired_remainder_link`) de "foi pago antes do envio" (`charge_not_payable`), que é o desfecho esperado da espera de 2 h. |

### Contrato do Scheduling

- `WaitlistOfferState` ganhou `offerExpiresAt`: `offered_at` + TTL, só enquanto `offered`. O
  `offered_at` sobrevive ao `booked`. A mudança é aditiva (M14).
- O TTL de 240 min saiu do cron `/api/cron/proactive-waitlist` e foi para
  `scheduling/waitlist-policy.ts` (`WAITLIST_OFFER_TTL_MINUTES`). O cron e o seam usam a mesma
  constante, e o Scheduling continua dono de "quando a oferta caducou".

### Por que `cancelled` e não `failed`

O job vencido não foi recusado. A fila decidiu não enviá-lo, como faz com `suppressed`,
`no_consent` ou `already_paid`. O painel de recusas (EC-32) lê só `failed`, então um job vencido
não aparece lá (ver "Revisitar quando").

### Relação com a ADR-064 (reenvio por geração)

A ADR-064 (sessão "C14: retentativa real para falhas da Meta") entrou na base antes deste PR, com um
`resendDeadline` só para reenvio: hold do sinal, meia-noite local do dia da consulta no lembrete e
`scheduledAt` na oferta; os demais tipos tinham só o limite de tentativas. Ficou combinado **um
prazo só**, e a integração foi feita aqui:

- o `sendDeadline` substituiu o `resendDeadline` nos três usos: o bloco "1b" de `processOne`, a
  recusa síncrona (`decideAfterRefusal` recebe o prazo como entrada) e o handler do EC-32;
- o `resend-deadline.ts` saiu;
- o processor calcula o prazo uma vez por job, e o mesmo valor serve ao 1b, ao guard e à recusa;
- o handler lê o fuso (`getClinicTimezoneTx`) e o `created_at` do job (`lockJobBySendKeyTx`);
- dunning, followup, no-show e restante passaram a ter prazo também no reenvio.

O bloco 1b roda **antes** deste corte. Assim, um reenvio vencido continua `failed` com
`meta_<código>`, porque a causa foi a recusa da Meta. Só a geração 0 vencida vira `expired_<tipo>`.

## Alternativas descartadas

- **Coluna `expires_at` preenchida no enqueue.** Exigiria migration e backfill, e não cobriria os
  jobs já na fila sem um UPDATE em produção. O prazo deriva do que já existe.
- **Corte por idade no `claimDue`.** Deixaria o job vencido `pending` para sempre, sem motivo, e
  seria um corte único para tipos com janelas de horas (sinal) e de semanas (cobrança).
- **Lembrete "até o início da consulta".** Cobre o lembrete que chegaria depois da consulta, mas
  ainda mandaria "amanhã" no próprio dia.

## Consequências

- Jobs vencidos que já estão na fila fecham na próxima execução do processor, sem backfill. O
  `remainder_link` de 34 dias do DEV fecha como `expired_remainder_link` sem consultar o Payments.
- No `dunning`, um D+3 criado entre o D+7 e o D+14 (catch-up) é cancelado na hora, e só o D+7 sai.
- Segurar a fila (ADR-063) deixa de ser perigoso: soltá-la nunca envia fora da janela.
- O fuso da clínica passa a ser lido antes do guard. O cache é por lote e por clínica, então isso
  custa no máximo uma leitura a mais por clínica, nos lotes em que todos os jobs são cancelados.

## Revisitar quando

- A clínica precisar ver o job vencido. Um `expired_deposit_link` significa que o paciente nunca
  recebeu o link e perdeu a vaga. O painel do EC-32 precisaria ler `cancelled` com `expired_*`.
- `REMAINDER_DUE_DAYS` mudar no Payments. A constante não é pública, então
  `REMAINDER_LINK_VALID_DAYS` precisa ser ajustada à mão.
- Houver calendário de feriados. O `nextWeekday` conta feriado como dia útil, inclusive no prazo do
  `no_show_followup`.
- O TTL da oferta corre de madrugada, quando a mensagem não pode sair (8–20h). Uma oferta feita às
  21h vence antes das 8h do dia seguinte e é repassada sem que o primeiro candidato tenha sido
  avisado. Isso já acontecia antes desta ADR e não mudou aqui.

## Evidência (09/10/2026)

- `validity.test.ts`: as bordas exatas de cada tipo (último instante válido e primeiro vencido), a
  data local contra a UTC e os cortes do dunning presos ao `routeDunning`.
- `process.test.ts`: os 7 tipos dentro da janela seguem para o envio, e vencidos viram
  `cancelled` com `expired_<tipo>` sem ler estado nem enviar. Mais a oferta com a janela de
  resposta vencida no seam e o `remainder_link` de 34 dias.
- Os dois testes de integração (`remainder-link`, `no-show-followup`) agora usam relógio fixo.
- `waitlist-offer-state.test.ts`: o seam só devolve a janela com a oferta em `offered`.
- Gates locais em `917ef575`, cada um no próprio comando e com o próprio exit code, todos 0:
  - typecheck;
  - lint;
  - `test:coverage` (510 arquivos, 5.290 testes; `validity.ts` com 95% de linhas, só o ramo
    `never` de fora);
  - `security:inventory` (o `--write` só moveu o `GET` do cron da lista de espera da linha 33 para
    a 27);
  - `arch:check`;
  - `check:observability`.
- DEV, só leitura (`BEGIN READ ONLY`, o `sendDeadline` real aplicado à fila): havia **1** job não
  terminal, o `remainder_link` em `pending` havia 35 dias. Com esta regra ele fecharia como
  `cancelled expired_remainder_link`, vencido havia 28 dias. Nada foi gravado.
