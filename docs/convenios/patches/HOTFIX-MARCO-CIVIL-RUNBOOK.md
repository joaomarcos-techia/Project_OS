# Hotfix Marco Civil — `login_attempts` por 186 dias (incidente operacional, separado do TISS)

## Estado em 27/11/2026, 05h UTC: PUBLICADO em Production; falta só a leitura depois do cron

Executado pela frente TISS, como executor único registrado no PR #66, por autorização expressa do fundador.
Evidência em `evidence/tiss-marco-civil-2026-11-27/`.

| Etapa | Resultado |
| --- | --- |
| Production antes | `dpl_HFDyevnCy4j2DTBupq9xatKqX65s`, `gitCommitSha` `dddc650b`, `source: cli` (metadados da Vercel) |
| Candidato | `079754d8` (PR #66): mesmo patch-id do `93eae727`; só `retention-policy.ts` e o teste; CI verde |
| Pré-voo (só leitura) | flags de aquisição sem mudança desde 16/11; `login_attempts` 228, o mais antigo de 10/08, 125 dentro dos 6 meses; health profundo, outbox e auth hook `ok`; impressão digital financeira tirada |
| Deploy | `vercel deploy --prod --skip-domain` de cópia limpa do SHA exato → `dpl_EEWp26xT2TZBdSH3nshw6wMaom75`, READY, `gitCommitSha` `079754d8`, 21 crons idênticos (mesmo hash) |
| Promoção | `vercel promote` → `app.qoro.dev` = `dpl_EEWp26xT2TZBdSH3nshw6wMaom75` (04:56 UTC) |
| Pós-voo (só leitura) | rotas, health e outbox iguais à linha de base; `subscriptions`, `invoices`, `plans`, `prices` e `login_attempts` com impressão digital **idêntica**; nenhuma escrita no banco de Production |
| Rollback | `vercel promote dpl_HFDyevnCy4j2DTBupq9xatKqX65s` |
| **Falta** | depois de 01/12 05:00 UTC: `node --use-system-ca prod-marco-civil-voo.mjs pos` (heartbeat `success`, mais antigo ainda 10/08, os 125 preservados). Só então o risco fica encerrado |

O #53 e o #64 precisam carregar o commit para o próximo deploy não reverter a regra. As seções abaixo são o
histórico do preparo.

**Horário limite: 01/12/2026 às 05:00 UTC (01/12, 02:00 em Brasília).** É quando o cron mensal
`/api/cron/data-retention` (`0 5 1 * *`, `vercel.json`) roda. Para ter margem, o deploy de Production com o hotfix
deve estar READY até **30/11/2026, 23:59 de Brasília**.

## Fatos conferidos em 26/11/2026

| Item | Estado | Como foi conferido |
| --- | --- | --- |
| **Production** | **`dddc650b`** (deploy `dpl_HFDyevnCy4j2DTBupq9xatKqX65s`, 24/11, Pix do #53, a partir do `cf712ab4`) | registro de deploy do próprio #53 (`8bf5e07a`, `GATE-B-DEPLOY-CONTROLADO.md`). Os deploys do #53 são feitos pela **Vercel CLI** e **não aparecem** na GitHub Deployments API, cujo último registro de Production é o `5620a098` (main, 09/11). A leitura direta da API da Vercel com o token do CLI não foi permitida nesta sessão: **confirmar no painel da Vercel antes de agir** |
| A main **não** é o que está em Production | `5620a098` está atrás de Production (não tem o billing do #53) | publicar main + hotfix **reverteria** o billing em Production. Não fazer |
| Regra publicada | `LOGIN_ATTEMPTS_DAYS = 90` | `src/lib/db/retention-policy.ts` em `dddc650b` (igual em main, #53 `1175b22c` e #64 `92363ef1`) |
| Hotfix nos HEADs atuais | **ausente** em main, #53, #64 e Production | a política, o teste, a rota do cron e o `vercel.json` são byte a byte iguais nos quatro |
| Tabela em Production | 228 registros; o mais antigo é de 10/08/2026; **125** (10/08–30/08) seriam apagados em 01/12 com 90 dias, **todos dentro dos 6 meses**; com 186 dias, 0 | transação `READ ONLY`, só agregados (`evidence/tiss-marco-civil-2026-11-26/leitura-preVoo-2026-11-26.json`) |
| Último run do cron | 01/11 05:00 UTC, `success`, `login_attempts` = 0 | `cron_heartbeats` (`leitura-run-2100Z.json`) |

## O patch

Uma linha de regra (90 → 186 dias), o comentário com a base legal e um teste do piso legal (≥ 184 e ≤ 200 dias).
Nenhuma migration, nenhuma variável de ambiente, nenhuma dependência nova; não depende do Next 16 nem do #64.

| Arquivo | Base | Commit local | Uso |
| --- | --- | --- | --- |
| **`hotfix-marco-civil-login-attempts-186-prod.patch`** | **`dddc650b` (Production)** | `93eae727` (branch local `local/hotfix-marco-civil-186-prod`, worktree `C:/dev/wt-mc-prod`) | **o que vai para Production** |
| `hotfix-marco-civil-login-attempts-186.patch` | #53 `1175b22c` | `89a7bc5d` (branch local `local/hotfix-marco-civil-186`) | o #53 carrega o commit |
| — | main `5620a098` | `15980ef1` (branch local `local/hotfix-marco-civil-186-main`) | só para a main quando ela receber o #53; **nunca** como deploy |

O diff é idêntico nos três; só muda o commit-base.

### Validação local (sem GitHub Actions)

Postgres 17 descartável com as migrations reais de cada base:

- **`dddc650b` + hotfix (`93eae727`)**: harness `login-attempts-retention-db.ts` (do #55, sem a parte do R42, que
  não existe nessa base) **4/4**. A regra de 90 dias apagaria 6 registros dentro dos 6 meses; a de 186, 0. A rota
  real `GET /api/cron/data-retention` respondeu 200, só os registros com 186 dias ou mais saíram e as outras 8
  políticas seguiram iguais (outbox, chaves de idempotência). `retention-policy.test.ts` 17/17. `tsc --noEmit` do
  projeto inteiro e eslint com código 0.
- #53 + hotfix (`89a7bc5d`) e main + hotfix (`15980ef1`): os mesmos 4/4 e 17/17. No #55: 5/5, com o R42.

## Como aplicar (dono do #53, com autorização do fundador)

Production é publicada pelo #53 por deploy controlado da Vercel (SHA exato, pré-voo e pós-voo), não pela main. O
hotfix segue o mesmo caminho:

1. No worktree do #53 (ou num novo a partir do `dddc650b`): `git cherry-pick 93eae727`, ou
   `git am docs/convenios/patches/hotfix-marco-civil-login-attempts-186-prod.patch`.
2. Validação local: `vitest run src/lib/db/retention-policy.test.ts` (17/17). O harness de banco está no #55.
3. Pré-voo (abaixo).
4. Deploy de Production do SHA exato `dddc650b + hotfix` pelo mesmo procedimento do Gate B. Isso exige
   autorização expressa do fundador, como todo deploy de Production. O deploy pela Vercel CLI **não dispara
   GitHub Actions**. Se a regra do #53 exigir CI oficial do SHA publicado, o push custa uma rodada da CI, e isso é
   decisão do fundador (o Actions está suspenso).
5. Pós-voo (abaixo).
6. Levar o commit para o #53 (e daí para o #64 e a main) para o próximo deploy não reverter o hotfix.

## Pré-voo

1. Confirmar no painel da Vercel que Production está no `dddc650b`. Se estiver em outro SHA, anotar e conferir que
   ele tem os mesmos `retention-policy.ts` e rota do cron; o patch aplica igual.
2. `node --use-system-ca prod-marco-civil-voo.mjs pre` (script em `evidence/tiss-marco-civil-2026-11-26/`,
   `READ ONLY`, só agregados): esperado `dentro_dos_6_meses` = 125 ou mais.
3. Conferir que o diff do deploy em relação ao que está em Production é **só** o hotfix
   (`git diff dddc650b <sha> --stat`: 2 arquivos).

## Pós-voo

1. Painel da Vercel: deploy de Production READY com o SHA do hotfix, **antes de 01/12 05:00 UTC**; no código desse
   SHA, `LOGIN_ATTEMPTS_DAYS = 186`.
2. Readbacks de sempre do Gate B (`/login`, health profundo, outbox, auth hook).
3. Depois de 01/12 05:00 UTC: `node --use-system-ca prod-marco-civil-voo.mjs pos`. Esperado: `PÓS-VOO OK`
   (heartbeat de 01/12 `success`, o mais antigo continua 10/08/2026 e `lote_que_90_dias_apagaria` ≥ 125).
4. Registrar a leitura em `evidence/`. O hotfix só vira "Production VERIFIED" depois dos passos 1 e 3.

## Contenção, se o deploy não sair a tempo

- **Não há chave para desligar só esta purga.** O `CRON_SECRET_DESTRUCTIVE` (rotas `destructive: true`) desligaria
  juntos `data-retention`, `patient-hard-delete` (exclusão LGPD diária, 03h UTC) e `billing-dunning`. Além de ser
  indiscriminado, mudar variável de ambiente na Vercel **só vale depois de um novo deploy**, então não poupa o
  deploy. Não recomendado.
- Desligar os cron jobs no painel da Vercel desliga **todos** os crons do projeto (outbox, lembretes, cobrança).
  Não recomendado.
- Se a purga rodar com 90 dias, os 125 registros só voltam por backup. O backup diário de Production do
  repositório (`.github/workflows/db-backup.yml`: `pg_dump` cifrado com GPG, artefato guardado por 30 dias) teve o
  **último sucesso em 25/11/2026 16:52 UTC**, e esse dump contém os 125 registros. O run de **26/11 não começou**
  ("recent account payments have failed or your spending limit needs to be increased"). **Enquanto o Actions
  estiver bloqueado, Production fica sem o backup diário do repositório.** É preciso conferir também, no painel do
  Supabase, o backup próprio do plano. Restaurar uma tabela é operação de Production e precisa de decisão do
  fundador. Registrar o incidente (data, contagem, causa) no dossiê.

## Riscos relacionados (fora do cron)

- `scripts/reset-prod-data.ts` (operação manual) lista `login_attempts` e `audit_events` entre as tabelas
  "transitórias" que apaga. Rodar esse reset hoje apagaria registros de acesso dentro dos 6 meses. Não rodar sem
  revisar essa lista (ver também o S5: com a trilha append-only, o reset precisa preservá-la).

## Risco restante

Enquanto o deploy não acontece, o risco é o mesmo de 25/11: em 01/12 05:00 UTC, 125 registros de acesso dentro dos 6
meses seriam apagados (Marco Civil, art. 15; requisito 84 da ANS). Depois do deploy, a regra de 186 dias só apaga o
que já passou dos 6 meses.
