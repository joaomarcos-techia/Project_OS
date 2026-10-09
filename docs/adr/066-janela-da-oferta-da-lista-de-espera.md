# ADR-066 — A janela de resposta da oferta da lista de espera só corre nas horas de envio

## Status

Accepted — implementado em código em 09/10/2026 (branch `fix/waitlist-offer-window-20261009`, PR
draft para `fix/post-merge-validation-20261001`, empilhado sobre o PR #31 da ADR-065). Sem
migration, sem coluna nova e sem mudança de env. A C14 não mudou: chave de envio, backoff,
`claimDue` e guard de send-time seguem como estão. Nenhuma escrita em DEV ou produção.

## Contexto

WAIT-001: quando um cancelamento libera uma vaga, `offerWaitlistForCancelledAppointment` grava
`offered_at` pelo relógio do banco na entrada escolhida e publica `scheduling.waitlist.offered`. O handler enfileira
um job `waitlist_offer` na C14.

- A janela de resposta era `offered_at` + 240 min (`WAITLIST_OFFER_TTL_MINUTES`).
- O cron `/api/cron/proactive-waitlist` roda `*/15 11-23 * * *` UTC (8h às 20h45 em São Paulo). A
  cada passada, ele primeiro devolve à fila as ofertas vencidas e repassa a vaga ao próximo
  candidato; só depois despacha os jobs `waitlist_offer`.
- O `claimDue` da C14 só reserva jobs entre 8h e 20h locais.

As 240 min corriam de madrugada, quando o convite não pode sair:

- **Cancelamento às 21h:** a oferta vencia à 1h. Na passada das 8h, a expiração a devolvia à fila e
  repassava a vaga antes do despacho. O job do primeiro candidato terminava `cancelled
  waitlist_offer_closed`: ele perdia a vez sem nunca ter sido convidado.
- **Oferta às 4h30:** o convite saía às 8h, e a oferta vencia às 8h30. Sobravam 30 minutos.
- **Oferta às 17h:** o convite saía na hora, mas a primeira passada do dia seguinte (8h) já devolvia
  a oferta. A resposta que chegou de noite não tinha como ser tratada, porque o aceite é feito pela
  equipe em `/agenda/lista-espera`.

A ADR-065 expôs `offerExpiresAt` no seam (`WaitlistOfferState`), que a C14 confere no envio, e
registrou este defeito em "Revisitar quando".

## Decisão

1. **O TTL da oferta corre só nas horas de envio:** das 8h às 20h, no fuso da clínica
   (`WAITLIST_OFFER_SEND_HOURS`). `waitlistOfferExpiresAt(offeredAt, timeZone)`, em
   `scheduling/waitlist-policy.ts`, soma as 240 min só dentro dessas horas. A função é pura e é a
   única implementação da janela. O fim é exclusivo (`isWaitlistOfferExpired`), como o prazo da C14.
2. **O seam e o cron usam a mesma regra.**
   - `getWaitlistOfferState` lê `clinics.timezone` e devolve `offerExpiresAt` por ela. A C14 segue
     conferindo `offerExpiresAt` no envio, sem mudança.
   - A varredura do cron (`findStaleWaitlistOffers`) aplica a mesma função, com o fuso de cada
     clínica.
   - O SQL só pré-filtra pelo TTL corrido (`offered_at <= agora − 240 min`). É uma condição
     necessária, porque a janela nunca fecha antes disso. A varredura ordena por `offered_at` e
     percorre páginas até reunir o limite de ofertas realmente vencidas. Entre clínicas com fusos
     diferentes, uma oferta mais antiga pode vencer depois de outra mais nova.
3. **O cron não passa mais o TTL:** chama `expireStaleWaitlistOffers({ limit })`. A constante saiu
   do `index.ts` do Scheduling, para ninguém recalcular a janela somando minutos.
4. **As horas de envio do Scheduling são as do `claimDue`.** O teste
   `proactive-jobs/infra/send-window.test.ts` prende `WAITLIST_OFFER_SEND_HOURS` a
   `SEND_WINDOW_START_HOUR` e `SEND_WINDOW_END_HOUR`, do mesmo jeito que o corte do dunning está
   preso ao `routeDunning` (ADR-065).
5. **`offered_at` continua sendo o instante da oferta.** A chave de envio e o backoff da C14 não
   mudam.

6. **O aceite também respeita o fim da janela.** Sob o lock da entrada, a ação lê o fuso e
   `clock_timestamp()` do banco. Antes da criação, rejeita oferta vencida e vaga passada; o `UPDATE`
   final repete os dois limites no SQL, para que uma execução demorada não conclua depois do prazo.
   O cron identifica a geração pelo instante e vaga ofertada, de modo que um scan antigo não libera
   uma oferta nova e uma segunda oferta da mesma entrada ganha outra chave de outbox. Uma vaga
   passada não é ofertada nem repassada. A varredura paginada alcança vencimentos de fusos distintos
   mesmo quando ofertas ainda abertas aparecem primeiro na ordenação.

### Exemplos (São Paulo)

| Oferta | O convite sai | A janela fecha | Antes |
| --- | --- | --- | --- |
| 10h | na passada seguinte (até 10h15) | 14h | 14h |
| 17h | na passada seguinte (até 17h15) | 9h do dia seguinte | 21h, devolvida na passada das 8h |
| 21h | 8h do dia seguinte | 12h do dia seguinte | 1h, devolvida às 8h sem convite |
| 4h30 | 8h | 12h | 8h30 |

## Alternativas descartadas

- **A janela começar quando o convite sai.** O Scheduling não sabe quando o convite saiu; isso é da
  C14. Seria preciso:
  - um comando novo no seam (a C14 escrevendo no Scheduling) ou um evento de volta;
  - uma coluna para o instante do convite (migration);
  - um prazo para o convite que nunca sai: kill-switch ligado, paciente sem consentimento ou
    suprimido, Meta recusando, número desconectado.

  Sem esse prazo, a vaga ficaria presa para sempre, e o cron expira mesmo com a mensageria desligada
  justamente para isso não acontecer. Com ele, volta um relógio que corre sem convite. Além disso,
  essa opção não resolve a oferta das 17h: a janela iniciada às 17h fecharia às 21h, e a passada das
  8h a devolveria antes de a clínica tratar a resposta da noite.
- **A expiração ignorar ofertas cujo convite ainda não saiu.** Tem o mesmo problema de saber se o
  convite saiu, e sozinha não basta. Às 8h15, a oferta das 21h, já convidada, teria 11 h corridas e
  venceria na hora. Precisaria também da janela a partir do convite, ou seja, da alternativa
  anterior.
- **A regra em SQL na varredura.** Seriam duas implementações da mesma janela: TypeScript no seam e
  SQL no cron. A tarefa pedia exatamente uma regra só.

## Consequências

- Cancelamento às 21h: o primeiro candidato recebe o convite às 8h, com as 4 h inteiras, até as 12h.
- Oferta diurna: nada muda.
- Ofertas já abertas passam a seguir a regra na próxima passada, sem backfill.
- A vaga fica mais tempo com quem foi ofertado à noite. Se ele não responder, o repasse acontece às
  12h, e não às 8h. É o preço de convidar o primeiro candidato de verdade.
- Se o convite atrasar por outro motivo (kill-switch, backoff de erro transitório, conta da Meta
  bloqueada), a janela continua correndo, como antes. A C14 continua sem enviar convite vencido
  (ADR-065).
- O seam faz uma leitura a mais (`clinics.timezone`), e só com a oferta aberta.

## Revisitar quando

- A C14 mudar a janela de envio. O `send-window.test.ts` falha.
- Houver janela por clínica, ou a equipe só tratar a lista de espera em dias úteis. Hoje a janela
  corre também no fim de semana, como o envio.
- O convite passar a ter confirmação de entrega usada pelo Scheduling. Aí a janela a partir do convite
  deixa de exigir um caminho novo entre os contextos.

## Evidência (09/10/2026)

Complemento na branch `fix/waitlist-offer-closure-20261009`, baseada no PR #32:

- O aceite agora verifica prazo e horário pelo relógio do banco sob o lock da entrada. O `UPDATE`
  final exige novamente `clock_timestamp() < offerExpiresAt` e vaga futura; se perder a corrida,
  a transação inteira reverte, inclusive a consulta recém-inserida.
- O cron usa uma chave por geração da oferta e só libera a geração que examinou. O scan pagina
  ofertas de clínicas em fusos distintos até reunir o limite de vencidas.
- Testes locais direcionados: 58/58 PASS. TypeScript e ESLint: exit 0. Build Next de produção
  isolado com variáveis sintéticas (`scripts/security/local-build.ts`): exit 0. Regressão Vitest:
  5.365/5.365 testes em 514 arquivos, exit 0. O inventário de Server Actions foi regenerado.
- Ainda falta prova da transação com banco DEV e E2E no Preview integrado; estes resultados locais
  não comprovam o envio real da oferta nem o aceite por uma pessoa.

- `waitlist-policy.test.ts`: oferta diurna, às 21h, de madrugada e às 17h; bordas às 7h59, 8h, 16h,
  19h59 e 20h; virada do ano; fuso de Manaus; fim exclusivo às 12h. Uma varredura de 48 h, de 15 em
  15 min, conta minuto a minuto, sem a regra: toda oferta ganha exatamente 240 min de horas de envio,
  e o último minuto da janela é de envio.
- `waitlist-offer-state.test.ts`: o seam devolve 12h para a oferta das 21h, usa o fuso da clínica (São
  Paulo quando falta) e só lê o fuso com a oferta aberta.
- `waitlist-store.test.ts`: às 8h, a varredura deixa a oferta das 21h e devolve a das 10h da véspera;
  às 12h em ponto, devolve a das 21h. Cada clínica conta no próprio fuso. O SQL pré-filtra por
  `agora − 240 min` e ordena por `offered_at, id`.
- `waitlist-expiry.test.ts`, com a varredura real e o repasse falso: a passada das 8h não repassa a
  oferta das 21h; a das 12h repassa. A das 17h passa pela primeira passada do dia e vence às 9h.
- `process.test.ts`: com a janela da regra real, às 8h o convite da oferta das 21h sai (`sent`), com a
  chave de envio de sempre.
- Mutação: com a regra antiga (`offered_at` + 240 min), 20 desses testes falham, todos de oferta
  noturna ou de fim de tarde. Os diurnos seguem passando.
- DEV, pelo launcher que fixa o projeto DEV e descarta as variáveis `*_PROD`:
  - leitura em `READ ONLY`: o DEV tem 0 entradas na lista de espera. A varredura nova (subconsulta
    do fuso, parâmetro de data, `ORDER BY`) roda no Postgres sem erro;
  - numa transação desfeita com `ROLLBACK`, duas ofertas de uma clínica de São Paulo, às 21h de
    08/10 e às 10h de 09/10. A varredura real, em instantes simulados de 09/10:
    - 8h e 11h59: nenhuma vencida;
    - 12h e 13h59: só a das 21h;
    - 14h: as duas.
  - o DEV tinha 0 entradas antes e continuou com 0 depois. Nada foi gravado.
- Gates locais em `e3948a75`, cada um no próprio comando e com o próprio exit code, todos 0:
  - typecheck;
  - lint;
  - `test:coverage`: 514 arquivos, 5.358 testes. Em `waitlist-policy.ts`, só ficam de fora a chave
    final, inalcançável depois do laço sem condição, e uma linha do `chooseWaitlistCandidate`, que já
    estava assim;
  - `security:inventory`, sem `--write`: a linha do `GET` do cron não mudou;
  - `arch:check`;
  - `check:observability`.
