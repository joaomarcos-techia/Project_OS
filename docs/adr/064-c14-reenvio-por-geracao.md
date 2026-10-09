# ADR-064 — C14 reenvia de verdade, com uma chave de envio por geração

## Status

Accepted em código em 08/10/2026, após decisão do usuário sobre a nota de desenho:

- **código:** branch `fix/c14-retry-generations-20261008`, que vai entrar no PR #26;
- **migration 0118:** não aplicada em nenhum banco;
- **rollout:** nenhum.

Emenda o ADR C3 da review da C14 ("chave de envio estável = `job.id`") e completa o EC-32 (`84b3b413`).

## Contexto

A fila C14 (`ai_proactive_jobs`) enviava com `idempotencyKey = job.id`. Essa chave garantia no máximo
um envio por job e, por isso mesmo, nenhum reenvio. O código confirmou quatro problemas:

1. **A retentativa não reenviava.** `failed`, `unknown` e `pending` voltavam ao backoff com a mesma
   chave. A tentativa seguinte caía no `ON CONFLICT (clinic_id, idempotency_key)` do sender, que
   devolvia a linha antiga sem chamar a Meta.
   - O job queimava cerca de 6,6 h e terminava `meta_failed` ou `meta_unknown`.
   - O código da Meta ficava só em `outbound_messages.provider_response`.
   - O teste que "provava" a retentativa simulava um dedup `accepted` depois de `failed`, resposta que
     o sender nunca dá.
2. **`unknown` (timeout) não grava wamid**, e a reconciliação de callbacks só roda com wamid.
3. **`failed` revivia.** `advanceDeliveryStatus('failed', 'sent')` devolvia `sent`, e o painel do
   ADR-047 e o reenvio manual liam esse status.
4. **Reenviar exige chave nova**, e chave nova depois de `unknown` pode duplicar a mensagem.

## Decisão

### 1. Quem decide

- O **processor** decide sobre a resposta síncrona do envio que ele mesmo fez.
- O **handler do EC-32** decide sobre o callback `failed`.
- Os dois usam a mesma regra pura, `decideAfterRefusal` (`proactive-jobs/domain/resend.ts`).

### 2. Resposta síncrona (processor)

| `sendText` devolve | Job |
| --- | --- |
| `accepted`/`sent`/`delivered`/`read` | `sent` |
| `failed` deduplicado **com wamid** (aceito e recusado depois) | `sent`; a recusa é do handler |
| `failed` com código retentável, dentro das tentativas e do prazo | `pending` com **chave nova** + backoff |
| `failed` com código definitivo, sem código, fora das tentativas ou do prazo | `failed` **na hora**, `meta_<código>` ou `meta_failed` |
| `unknown`, novo ou deduplicado | `failed` **na hora**, `meta_unknown`; nunca chave nova |
| `pending` deduplicado (outra tentativa em voo ou morta) | backoff com a **mesma** chave (`meta_pending`) |
| exceção do sender | backoff com a **mesma** chave (`meta_error`) |

### 3. Callback `failed` (handler)

- O job é achado pela chave da geração **atual**. Chave de geração já substituída não acha nada, e
  por isso a reentrega do evento nunca reenvia duas vezes.
- `sent` ou `pending`: aplica a regra.
- `processing` com lease vivo: retry do outbox.
- `processing` com lease vencido: a tentativa morreu, e o handler decide por ela pelo mesmo critério
  do `claimDue`.
- Job terminal: no-op.

### 4. Geração de chave

- `ai_proactive_jobs.send_key uuid NULL` (migration 0118). NULL é a geração 0, cuja chave é o `id`,
  então jobs existentes e primeiros envios não mudam.
- Índice único parcial `(clinic_id, send_key) WHERE send_key IS NOT NULL`, para o handler achar o
  job pela chave.
- A chave nova (`randomUUID`) é gravada no **mesmo UPDATE** que devolve o job a `pending`:
  - no processor, guardado pelo lease;
  - no handler, com o job travado (`FOR UPDATE`) e o status e o token lidos.
- Gravada antes de qualquer envio que a use, a chave faz um crash só repetir a mesma geração, que o
  dedup do sender segura.

### 5. Códigos retentáveis

Tabela de erros da Cloud API, conferida em 08/10/2026:

- **Retentáveis:** 1, 2, 4, 80007, 130429, 131000, 131016, 131056, 131057 e 133004.
- **Definitivo:** todo o resto.
- Decisões do usuário:
  - **131048** (qualidade) e **131049** (a Meta manda esperar 24 h ou mais) são definitivos;
  - o código **1** ("pedido inválido ou erro de servidor") é retentável.

### 6. Tentativas e prazo

- **Tentativas:** o limite e o backoff de hoje, com até 5 envios por job (+30 s, +5 min, +30 min,
  +6 h), ticks de 15 min e janela 8–20 h.
- **Prazo** (`application/resend-deadline.ts`, no fuso da clínica):
  - `deposit_link`: `holdExpiresAt`;
  - `reminder`: meia-noite local do dia da consulta, porque o corpo diz "agendado para amanhã às
    {{2}}" e, no próprio dia, mentiria;
  - `waitlist_offer`: `scheduledAt`;
  - demais tipos: só o limite de tentativas.
- O prazo é conferido ao agendar o reenvio e de novo quando o reenvio é reivindicado, porque a janela
  8–20 h pode empurrá-lo para depois do prazo. Vencido, o job fecha `failed` com a recusa que o
  motivou, em vez de sumir sob `charge_not_payable` ou `appointment_inactive`.
- **Integração com a validade por tipo:** a sessão "C14: validade por tipo"
  (`fix/c14-validade-por-tipo-20261008`) traz `sendDeadline(type, payload, { timezone, createdAt })`,
  que vale para todo envio e para os 7 tipos. Quem integrar por último faz a troca mecânica:
  - troca `resendDeadline` por `sendDeadline` nos dois chamadores (o bloco 1b de `processOne` e o
    handler) e apaga `resend-deadline.ts`;
  - `decideAfterRefusal` já recebe o prazo pronto;
  - o 1b continua ANTES do corte `expired_<tipo>`, então um reenvio vencido segue `failed` com
    `meta_<código>`;
  - o handler passa a ler `created_at` em `lockJobBySendKeyTx`.

### 7. Status do envio

- Ordem total: `unknown < pending < accepted < sent < failed < delivered < read`.
- O status gravado é o máximo, então não depende da ordem dos callbacks.
- `failed` vence `sent`. Entrega confirmada nunca é reescrita.

### 8. Contrato

- `OutboundResult.errorCode`, opcional: o código da recusa síncrona (`error.code` do corpo HTTP), só
  para `failed` sem wamid, inclusive no dedup. Só a C14 o usa.
- `failed_reason` pode ser:
  - `meta_<código>`;
  - `meta_failed` (sem código);
  - `meta_unknown` (sem confirmação, pode ter chegado);
  - `meta_pending`;
  - `meta_error`.
- Job `pending` com `meta_<código>` significa reenvio agendado.
- Métricas:
  - `proactive.job.retried` com `resend: true` e `stage` (`send` ou `delivery`);
  - `proactive.job.failed` com `why` (`not_retryable`, `attempts_exhausted`, `past_deadline` ou
    `invalid_payload`).

## Garantia resultante (substitui a C3)

- No máximo um envio aceito por **chave**. O dedup do sender não mudou.
- Chave nova só depois que a Meta **recusou** a atual, com erro HTTP com código ou callback `failed`.
  Nunca depois de `unknown`, `pending` ou exceção.
- Logo, no máximo uma mensagem entregue por job e no máximo 5 envios por job.
- Risco aceito: um callback contraditório para o mesmo wamid (`failed` e depois `delivered`), que a
  Meta não emite.

## Alternativas descartadas

- **O sender reenviar a linha `failed` com a mesma chave.** Mudaria a IA e a resposta manual (o
  reenvio do ADR-047 depende de `failed` estável) e apagaria o histórico por tentativa.
- **Um job sucessor por reenvio, sem migration.** Uma mensagem viraria N linhas, e o admin, a tela da
  clínica e o merge de paciente teriam de juntar a cadeia.
- **Chave derivada (`uuidv5(job, n)`) sem gravar.** O handler não conseguiria voltar da chave ao job.
- **Reenviar depois de `unknown`.** Pode duplicar.

## Consequências

- **Rollout:** a 0118 precisa ser aplicada antes do deploy, porque `claimDue` lê `send_key`. A
  numeração assume a 0116 (saúde da WABA, ADR-063) e a 0117 (tipo da mensagem).
- **WABA BLOCKED** (131042/141006): a recusa é definitiva e não há reenvio. Segurar a fila enquanto a
  conta estiver bloqueada continua sendo decisão do ADR-063.
- **Fora do escopo:**
  - **Reconciliar `unknown`:** enviar o id do envio em `biz_opaque_callback_data`, que a Meta devolve
    no webhook de status. Isso mexe no contrato do provider e no parser.
  - **Prazo do primeiro envio:** nesta branch a geração 0 continua sem prazo, como antes. O prazo
    vem com a validade por tipo.
  - **Reprocessar a fila antiga do outbox do DEV.**
