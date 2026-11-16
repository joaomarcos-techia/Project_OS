# ADR-075 — Trilha da plataforma append-only no banco, fim da sessão de suporte registrado e leitor com alerta

## Status

Accepted — decidido pelo fundador em 16/11/2026, ao fim da Fase 1 da frente da trilha da
plataforma ("Aprovar pacote").

- **Parte 1 (este PR):** barreira no banco como migration **candidata 0165, fora do journal e
  NÃO aplicada** em DEV ou produção; exceção no gate `check:migrations`; `reset:prod` deixa de
  apagar a trilha.
- **Parte 2 (PR próprio, depois do #57 e combinado com a frente S-01):** fim da sessão de suporte
  registrado, leitor no console e check no `/api/health`. Sem migration.

Numeração: 073 é do #57 e 074 do #58; 067–072 estão em outras branches abertas. Migrations: main
0135; #53 0136–0142 e a candidata 0159; #55 0143–0158 e 0160–0164. Por isso a candidata é 0165.
Número e `when` definitivos saem na autorização de aplicação.

## Contexto

`super_admin_actions` é a trilha forense da plataforma. Ela registra a sessão de suporte, os exports
e, desde o #57 (ADR-073), cada abertura do texto de uma conversa no console
(`ai_conversation.content_viewed`), gravada na mesma transação da leitura, fail-closed. A ADR-011 a
declara append-only, mas só a RLS garantia isso, e a Fase 1 (16/11, só leitura de código e git)
mediu três lacunas.

**1. A trilha pode ser alterada e apagada.**

- A RLS (FORCE, políticas só de SELECT e INSERT) só alcança `authenticated`.
- O dono da tabela, `postgres`, é o papel do `DATABASE_URL` (dbAdmin, dbWorker, scripts e
  migrador) e tem BYPASSRLS: altera, apaga e esvazia.
- O `service_role` (BYPASSRLS) tem UPDATE e DELETE explícitos (`0010_c4_hardening.sql:81`) e
  provavelmente TRUNCATE, REFERENCES e TRIGGER herdados do default ACL do Supabase, que a 0045 só
  limpou de `anon` e `authenticated`. Não verificado no banco.
- A política de INSERT só pede `is_super_admin()`, que é `app_role` no JWT (0006), sem AAL2 e sem o
  epoch da ADR-037. Pela Data API, um token de super_admin grava linha com qualquer ator, clínica,
  payload e `created_at`. Nenhum código usa esse caminho.
- Não havia gatilho. Nenhum código altera ou apaga a trilha (todos os escritores fazem INSERT pelo
  dono). O único DELETE era o do `reset:prod`.

**2. O fim da sessão de suporte some.** Só o botão grava `impersonate_stop`, e com
`target_clinic_id` nulo. O vencimento (1 h) não grava nada. O novo início revoga a sessão anterior
sem registro e também marca as já vencidas com a hora do novo início. O `/logout` nem encerra a
sessão: o cookie `qoro_imp` fica, e a mesma conta, entrando de novo dentro da hora, retoma a sessão
sem um novo `impersonate_start`. `impersonation_sessions` não serve de prova: é mutável e some em
cascata quando a clínica é apagada.

**3. Ninguém lê nem é alertado.** Nada no produto lê a trilha. A métrica `super_admin.action` é só
uma linha de log, e nenhum alerta sobre ela foi exercitado. O caminho de alerta que funciona é o
monitor do Better Stack sobre `/api/health?strict=1` (ADR-060).

## Decisão

### 1. Barreira no banco (parte 1)

Candidata `docs/security/migrations/0165_super_admin_actions_append_only.candidate.sql`:

- **Só o dono tem privilégio.** `REVOKE ALL` de PUBLIC, anon, authenticated e service_role, e de
  `qoro_runtime` quando ela existe. As políticas de RLS ficam como estão. Isso fecha também a forja
  e a leitura pela Data API.
- **Gatilhos BEFORE em ENABLE ALWAYS.** Um de linha para UPDATE e DELETE e um de comando para o
  esvaziamento. A função é SECURITY INVOKER, com `search_path` fixo, e devolve 42501 com a operação
  na mensagem. ALWAYS faz a barreira valer também com `session_replication_role = replica`.
- **Sem válvula por GUC.** Qualquer sessão consegue setar um GUC. A saída é DDL do dono, que fica
  no histórico de migrations, no log do banco e na checagem da parte 2.
- **`reset:prod` preserva a trilha.** `super_admin_actions` saiu de `TRANSIENT_TABLES`. Com a
  barreira, o DELETE abortaria o reset inteiro. Sem ela, apagaria o registro do próprio reset.
- **Gate `check:migrations`.** TRUNCATE como evento de um CREATE TRIGGER não é comando. A isenção
  vale só para o statement que define o gatilho.

### 2. Fim da sessão de suporte (parte 2)

- `impersonate_start` passa a levar `impersonationId` e `ttlSeconds`. O app gera o id antes, sem
  mudar a assinatura de `superAdminAction`.
- Todo fim explícito grava `impersonate_stop` com a clínica e um `reason` (`manual`, `superseded`
  ou `logout`), na mesma transação da revogação e só se a sessão ainda estava ativa.
- O novo início revoga só a sessão ativa, não as vencidas.
- O logout encerra a sessão de suporte: revoga, apaga o cookie e grava. Depois de sair, voltar
  exige um novo TOTP.
- O vencimento não grava. O fim é início + TTL, derivado só da trilha. Eventos antigos sem id são
  correlacionados por ator, clínica e `created_at` igual a `started_at`.
- Não mudam: as assinaturas de `superAdminAction`, `recordImpersonationAudit` e
  `superAdminAuditedRead`, nem a ação `impersonate_mutation`.

### 3. Leitor e alerta (parte 2)

- **Leitor** só de leitura em `/admin/audit`: filtros por ator, ação, clínica e período; payload
  mostrado só pelas chaves de uma lista fechada por ação; uma visão de sessões (início, fim
  registrado ou derivado, motivo, mutações e aberturas de conversa). Sem export. Abrir o leitor não
  gera evento: é metadado da equipe, não dado de paciente.
- **Check `platform_audit` no `/api/health`**, no padrão da ADR-060:
  - degrada se `_schema_version` registra a barreira, mas os gatilhos não estão em ALWAYS ou o corpo
    da função mudou (detecção do bypass por DDL);
  - degrada por volume: `ai_conversation.content_viewed` acima de 40 por hora por ator ou de 80 por
    hora no total, um ator em mais de 2 clínicas na hora, ou mais de 10 `impersonate_start` em 24 h.
    Os limiares são constantes, sem dado real por trás; recalibrar em 2 a 4 semanas.

## Alternativas consideradas

- **Só REVOKE.** Deixa dbAdmin, scripts e migrador alterarem a trilha, que é o caminho de escrita
  mais exposto a bug.
- **Só gatilho.** Deixa a forja e a leitura pela Data API.
- **Ancoragem externa** (hash encadeado ou cópia WORM). É a única defesa contra o dono com DDL. Fica
  para uma frente própria, junto com `audit_events`, que tem o mesmo risco
  (`auditoria-sem-hash-chain`) e ainda partições e retenção.
- **Schema e dono próprios, com função SECURITY DEFINER.** Muda todos os escritores para pouco ganho
  sobre a barreira.
- **Varredura em cron para o vencimento.** Pede cron novo e idempotência para registrar o que já é
  derivável.
- **Alerta por Sentry, resumo por e-mail ou limite rígido por hora.** São, nessa ordem, caminho não
  exercitado, cron novo e um bloqueio do suporte justamente no incidente.

## Consequências

- Nenhum escritor do app muda. Toda tentativa de alterar, apagar ou esvaziar a trilha devolve 42501.
  Corrigir um registro errado passa a ser um evento novo, nunca um UPDATE.
- A restauração por `pg_dump --clean` (DROP + COPY) continua funcionando. O gatilho e o ALWAYS vão
  no dump de schema, inclusive com `--no-acl`.
- Continua possível: DDL do dono; INSERT pelo dono com `created_at` retroativo (forçar `now()`
  quebraria a restauração por COPY); MAINTAIN do dono (PG17).
- **Aplicação.** CREATE TRIGGER e ENABLE ALWAYS seguram SHARE ROW EXCLUSIVE na trilha até o COMMIT do
  migrador, então a 0165 entra como a última entrada da publicação, com `lock_timeout`. No DEV, só
  com autorização específica e depois da 0163 e da 0164 do #55. Em produção, depois da cauda
  #53 → #55. Nos dois casos o motivo é o mesmo: o migrador do Drizzle pula em silêncio um `when`
  menor que o último aplicado.
- Pré-voo só leitura antes de aplicar: `relacl` e dono da tabela, gatilhos e atributos dos papéis.
  A reversão do cabeçalho da candidata restaura o estado das migrations 0010/0028; o ACL herdado do
  Supabase volta pelo `relacl` do pré-voo.

## Verificação

- `scripts/security/super-admin-actions-append-only-db.ts`: 10 provas em Postgres descartável, com
  o dono simulado como no Supabase (sem superuser, com BYPASSRLS) e o pior ACL herdado. Roda no job
  `.github/workflows/platform-audit-synthetic-db.yml`; o resultado fica no PR.
- `src/lib/db/migration-safety.test.ts`: a isenção do gate e a candidata sem `destructive-approved`.
- `src/lib/operations/reset-prod-data.test.ts`: a trilha fora da lista do reset.
- Não verificado: o ACL real em DEV e produção; se a Data API expõe `public`; se o `postgres` do
  Supabase consegue ligar `session_replication_role` (o harness simula o pior caso).
