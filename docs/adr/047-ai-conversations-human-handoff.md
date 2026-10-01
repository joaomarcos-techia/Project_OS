# ADR-047 — Painel de Conversas IA e intervenção humana

> **Verificação (2026-07-23)** — Decisão: ACTIVE (de facto) · Implementação: IMPLEMENTED
> ⚠️ ADR marcado `proposed` no texto, mas **em prod desde 2026-07-20** (route `/admin/conversas-ia` + painel tenant).
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** proposed
**Date:** 2026-07-20

## Context

Desde a C11 (ADR-022) o agente conversa com pacientes no WhatsApp e sabe escalar: `request_human_handoff` e o gatilho de `MAX_FALLBACKS` põem a conversa em `status='handoff'`, inserem uma linha em `ai_handoff_queue` e o agente **para de responder** ao próximo inbound.

O que não existia era o outro lado. Não havia superfície tenant alguma para ver essas conversas — só um viewer read-only de super-admin (`/admin/conversas-ia`, via `dbAdmin`). Na prática o handoff era um beco sem saída: o agente calava, o paciente ficava esperando, e ninguém da clínica tinha como assumir. Uma conversa escalada morria em silêncio.

Fechar esse buraco significa deixar um humano **falar com o paciente pelo painel**, o que traz três problemas que não existiam enquanto só a IA escrevia:

1. **Corrida agente × humano.** Se o humano responde com a conversa em `active`, o agente continua respondendo ao próximo inbound e o paciente recebe duas respostas de "a clínica".
2. **Janela de 24h da Meta.** A WhatsApp Cloud API só aceita texto livre até 24h após a última mensagem do paciente. A regra estava documentada em prosa (`docs/VisãoGeral.md`) e **nunca havia sido implementada**: o agente sempre mandou texto livre, os proactive-jobs sempre mandaram template, e nada nunca olhou o relógio. Fora da janela a Meta rejeita — e a rejeição chega *depois*, quando o operador já acha que respondeu.
3. **Autoria.** `ai_messages` só tinha `direction`. Nada distinguia "o agente respondeu" de "a secretária respondeu", e `model IS NULL` não serve como proxy: o agente grava `model=null` em vários fallbacks (pré-filtro clínico, quota estourada, kill-switch).

## Decision

Criar `/conversas` (lista) e `/conversas/[id]` (thread) no painel do tenant, com assumir / responder / devolver ao agente.

### Permissões

Duas novas, migration 0051: `view:conversations` (ler fila e thread) e `manage:conversations` (assumir, responder, devolver). Separadas porque ler o histórico é qualitativamente menos sensível que falar **com o paciente em nome da clínica**. Bundles: `owner`/`gestor`/`attendant` recebem as duas; `doctor` só `view`; `financial` nenhuma. `claims_version` bumpa sozinho — o trigger `trg_role_permissions_bump_claims_version` (0040, ADR-037) dispara no INSERT em `role_permissions`; nenhum bump manual.

### `handoff` é pré-condição para resposta manual

Nunca se envia com `status='active'`. Assumir a conversa **reusa `escalateToHuman`** — a mesma função da tool e do gatilho de fallback, já idempotente pela unique parcial de handoff aberto. O que se acrescenta é a auditoria, que o contexto ai-agent não escrevia.

Devolver ao agente (`handoff → active`) **resolve a linha da fila** (`resolved_at = now()`). Isso não é limpeza cosmética: o dedup de `escalateToHuman` é `ON CONFLICT (conversation_id) WHERE resolved_at IS NULL`, então uma linha aberta esquecida faria toda escalação futura daquela conversa cair no `DO NOTHING` — o status viraria `handoff` e a conversa nunca mais apareceria na fila.

Quem pode devolver (30/09/2026): quem assumiu, ou qualquer membro com `manage:conversations` quando **ninguém** assumiu — não há atendimento humano a atropelar. É o caso da recepção que respondeu pelo app WhatsApp Business (coexistência) e quer a IA de volta sem assumir no painel. Atribuída a outra pessoa, exige "Reatribuir para mim" antes.

### Janela de 24h — primeira implementação

`isWindowOpen(lastInboundAt, now)`, pura, em `internal/meta-window.ts`. Duas fronteiras decididas na direção segura: **sem inbound algum → fechada**; **exatamente 24h → fechada** (comparação estrita). Falso-negativo custa uma espera; falso-positivo custa uma mensagem rejeitada e um operador enganado.

As duas invariantes (status + janela) vivem juntas em `canReplyManually` (`internal/reply-policy.ts`), no idiom de `scheduling/state-machine.ts` — pura e testável sem banco. Ordem deliberada: **status antes de janela**, porque quem olha uma conversa `active` precisa ouvir "assuma primeiro", não "a janela expirou".

A UI desabilita campo e botão, mas isso é UX. A autoridade é o servidor: a action relê status e último inbound **sob `SELECT ... FOR UPDATE`**, não sobre o estado que a UI carregou — entre o render e o clique outro operador pode ter devolvido a conversa ao agente.

### Envio via outbox, nunca direto da action

```
action → idempotentMutation
           ├── INSERT ai_messages (out, sent_by_user_id, event_id = K)
           └── publishEvent('ai_agent.manual_reply.requested', idem = K)   [MESMA TX]
                          ↓
              worker → handler → messagingApiV1.sendText(idem = K)   [FORA de TX]
                          ↓
                   outbound_messages  UNIQUE(clinic_id, idempotency_key)
```

`K` é um UUID gerado na action e usado como chave nos três pontos, espelhando o que o agente já faz (`idempotencyKey: eventId`). O handler chama `sendText` **fora de qualquer transação** — `sendOutbound` abre as próprias TXs e `withTenant` não suporta aninhamento; é o mesmo motivo pelo qual o handler do agente usa `phase()` em vez de `ctx.tx`.

Fazer o envio na action exigiria ou segurar a TX durante o round-trip da Meta, ou commitar e depois enviar — deixando uma janela em que o processo morre e a mensagem fica no histórico sem nunca ter saído.

### `ai_messages` persistida ≠ entregue no WhatsApp

Distinção formal, porque a UI depende dela:

- **`ai_messages`** = a mensagem que o operador redigiu e o sistema aceitou. Intenção registrada.
- **`outbound_messages`** = estado operacional do envio.

A thread **nunca** marca "enviada" logo após a action. Deriva o selo de `outbound_messages` pela chave `K`: linha ausente ou `pending`/`unknown` → *Enviando…*; `accepted` → *Entregue ao WhatsApp*; `failed` → *Falha no envio*, visível. Sem isso o operador recebe falsa confirmação e assume que o paciente foi respondido.

### Autoria: `ai_messages.sent_by_user_id`

Coluna nova (0051), FK `profiles(id) ON DELETE RESTRICT`. `NULL` = agente, preenchido = humano.

Alvo `profiles` e não `auth.users` diretamente: `profiles` é a identidade canônica do tenant (mesmo alvo de `prontuarios.signed_by`, `appointments.doctor_id`) e **já encadeia** para `auth.users` via `profiles_id_auth_users_id_fk` (0003, CASCADE). Apontar para `profiles` herda essa integridade e ainda escopa a identidade ao tenant — `auth.users` é global.

`RESTRICT` e não `SET NULL` porque `NULL` **significa "foi o agente"**: anular a autoria não perderia informação, atribuiria a mensagem à IA. Precedente: `prontuarios.signed_by`. Não trava fluxo real — `profiles` usa soft-delete, e o único hard-delete do repo (`cancelClinicInvite`) atinge apenas convite pendente (`invite_accepted_at IS NULL`), que por definição nunca respondeu nada.

### Privacidade

DTOs explícitos em `types.ts`; a UI nunca recebe row. `patient_phone_encrypted`, `patient_phone_hash`, `collected_data_encrypted` (contém CPF) e `prompt_snapshot_encrypted` não são sequer selecionados. Telefone só aparece quando não há nome de paciente, sempre por `maskPhone`. Metadados do agente exibidos: `intent`, `toolCalls` (contagem), `model`, `latencyMs`, `costUsd` — nunca o snapshot do prompt: replay é ferramenta de engenharia, não de painel.

Auditoria e idempotência não recebem o texto: `idempotency_keys` guarda só `payload_hash` (não o payload), e o `result` — que vira `audit.after` e resposta em cache — é só `{ messageEventId }`.

### Poda de partição depende de uma invariante

`ai_messages` é particionada por mês em `created_at`. Toda leitura de thread usa `created_at >= conversation.started_at`, senão o planner varre as 13 partições para achar ~20 linhas.

Isso é **correto conforme a invariante** de que nenhuma mensagem da conversa é anterior ao `started_at` dela — não por construção do banco. Verificado em 2026-07-20: `started_at` só é escrito pelo DEFAULT da coluna, nada no código o atualiza, e conversa "reaberta" é linha nova (a unique parcial só cobre `status='active'`). **A invariante é uma dependência, não uma garantia**: um backfill/import futuro que insira mensagem anterior ao `started_at` faria esta poda esconder histórico silenciosamente. Guardada por asserção no smoke (6.1) — que já pegou o erro uma vez, quando o próprio seed backdateava a mensagem sem backdatear a conversa.

## Consequences

- O módulo "Conversas IA" sai de `soon: true` para `href: '/conversas'`. O `badge: '4'` hardcoded foi removido (não simular contagem).
- `ai_agent.manual_reply.requested` entra no catálogo do outbox **com handler** — não vai para a allowlist `PRODUCER_AHEAD`.
- O contexto ai-agent passa a escrever `audit_events` (via `idempotentMutation`), o que não fazia.
- `messagingApiV1` ganha `getOutboundStatuses` — leitura do estado de entrega sem cruzar schema de contexto.
- `returnToAgent` pode falhar com `ActiveConversationConflictError` quando já existe outra conversa **ativa** com o mesmo contato (duas ativas tornariam `findOrCreateConversation` ambíguo no próximo inbound). Antes esse caso vazava um `23505` cru para a tela.
- Fora da janela de 24h **não há saída pelo painel**: o campo fica bloqueado e o operador é informado de que o paciente precisa escrever primeiro. Não existe fluxo de template arbitrário por clínica (os proactive-jobs usam templates fixos), e inventá-lo era escopo próprio.
- Métricas novas: `ai_agent.conversations.listed`, `ai_agent.conversation.opened`, `.assumed`, `.returned`, `ai_agent.manual_reply.queued`, `.sent`, `.rejected`, `.blocked`, `.send_failed`, `ai_agent.handoff.returned`, `.return_conflict`.
- **Saída:** a migration é aditiva. Reverter é `DROP CONSTRAINT` + `DROP COLUMN sent_by_user_id` + `DELETE` das duas permissions (o trigger rebumpa `claims_version`) e o módulo volta a `soon: true`.

## Alternatives

- **Derivar autoria de `model IS NULL`:** rejeitada — o agente grava `model=null` em pré-filtro clínico, quota e kill-switch, então a leitura seria simplesmente falsa. Também não diria *quem* respondeu.
- **`UNIQUE(event_id)` em `ai_messages` como barreira de idempotência:** impossível. Unique em tabela particionada exige a partition key; `UNIQUE(event_id, created_at)` permitiria duplicata. A garantia mora em `idempotency_keys.UNIQUE(key)`, na mesma TX do INSERT.
- **`sent_by_user_id` sem FK** (como `created_by` e `ai_handoff_queue.assigned_to`, que de fato não têm nenhuma): rejeitada — aceitaria uuid órfão numa coluna que é trilha de quem falou com o paciente.
- **`ON DELETE SET NULL`:** rejeitada — `NULL` já significa "agente"; anular converteria mensagem humana em mensagem de IA no histórico.
- **Enviar direto da Server Action (`sendText`):** rejeitada — ou segura a TX durante o round-trip externo, ou abre janela de mensagem persistida e nunca enviada.
- **Paginação por cursor:** rejeitada — o repo não tem cursor em lugar nenhum, e a chave de ordenação aqui é mista (bool `handoff` + timestamp + id), o que tornaria o cursor composto e frágil. Offset + `TablePager` com tie-breaker por `id` é determinístico e reusa o primitivo existente.
- **Permitir resposta manual com `status='active'`:** rejeitada — é exatamente a corrida agente × humano que motiva o ADR.

## References

- [ADR-022](022-ai-agent-foundation.md) — fundação do agente, saga multi-fase, LLM fora de TX.
- [ADR-003](003-outbox-pattern.md) / [ADR-011](011-outbox-audit-idempotency-patterns.md) — outbox, idempotência, at-least-once.
- [ADR-012](012-encryption-strategy.md) — cifra per-tenant.
- [ADR-037](037-server-authoritative-session.md) — `claims_version` como auth-epoch; bump automático em `role_permissions`.
- [ADR-043](043-messaging-retention-not-partitioning.md) — retenção e particionamento de mensagens.
- [ADR-044](044-clinical-content-encryption.md) — conteúdo clínico não vaza para `audit_events`.
- `docs/VisãoGeral.md:434` — a regra de 24h da Meta, até aqui só em prosa.
- `scripts/smoke-conversas.ts` — RLS cross-tenant, cifra, privacidade, corrida e a invariante de `started_at`.
