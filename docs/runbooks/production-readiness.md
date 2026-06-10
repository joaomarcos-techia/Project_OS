# Runbook — Production Readiness (go-live do banco + sistemas externos)

> Checklist completo para deixar o ambiente de **produção** pronto. Faça na ordem.
> Cada `[ ]` é um passo verificável. Referências a runbooks específicos no fim.
>
> **Princípio de ouro:** segredos de PROD ≠ DEV. Nunca promova nenhuma key/senha
> de `qoro-dev` para prod (ver [secret-rotation.md](./secret-rotation.md)).

---

## 0. Estratégia de backup (responde "PITR é a única forma segura?")

**Não.** Há 3 camadas, da mais simples à mais robusta:

| Camada | O que cobre (RPO) | Custo | Quando |
|---|---|---|---|
| **Supabase daily backups** (incluso no Pro) | perda de até ~24h (snapshot diário, retenção 7d) | **incluso** no Pro (~$25/mês) | **agora** |
| **pg_dump próprio** (`pnpm db:backup:prod` + dump automático antes de cada `db:migrate:prod`) | snapshot pontual sob demanda | incluso (você roda) | **agora** |
| **PITR** (Point-in-Time Recovery) | perda de **segundos** (restaura qualquer instante) | **+~$100/mês** (add-on) | **quando tiver usuários pagantes** |

**Decisão recomendada (alinhada com você):** comece com **daily backups (Pro) +
pg_dump**. Isso é backup seguro — só não tem granularidade de segundos. RPO de até
24h é aceitável pré-lançamento. **Ative o PITR no primeiro punhado de clínicas
pagantes** (aí ele se paga). O [restore-test.md](./restore-test.md) vale para
qualquer camada — teste o restore trimestralmente.

- [ ] Plano Supabase prod = **Pro** (daily backups ligados por padrão).
- [ ] Conferir em Dashboard → Database → Backups que há snapshot diário.
- [ ] Agendar `pnpm db:backup:prod` (ou GitHub Action) para um dump extra periódico em storage frio.
- [ ] (Adiado) PITR quando houver receita.

---

## 1. Sistemas externos (todos) + para que servem

| Sistema | Papel | Obrigatório no go-live? |
|---|---|---|
| **Supabase** (projeto prod) | Postgres (dados+RLS) · Auth (login/JWT/MFA) · Storage (PDFs LGPD) | **Sim** |
| **Vercel** | Hospedagem do Next.js + **Cron** (outbox, hard-delete, audit-partitions) | **Sim** |
| **Upstash Redis** | Rate-limit de login (sliding window IP+email) | **Sim** (login depende; fail-open se cair) |
| **Google Secret Manager** | Master key de cripto + lookup salt em prod (`CRYPTO_SECRET_BACKEND=gcp`) | **Opcional** — alternativa: Vercel env (ver §4) |
| **Monitor de uptime** (UptimeRobot / BetterStack / Cronitor) | Alerta nos health endpoints | **Sim** (barato/grátis) |
| **Meta WhatsApp Cloud API** | Mensageria do agente IA | **Não** (C10, futuro) |
| **Provider de e-mail** (Resend/SES) | E-mail do export LGPD (hoje é stub) | **Não** (futuro) |

Configuração de cada um: §3 (Supabase), §4 (env/secrets), §5 (Vercel/cron), §6 (monitor).

---

## 2. Banco de produção — o que aplicar/criar (na ordem)

> Tudo abaixo é aplicado pelas **migrations** + alguns passos manuais no Dashboard.

### 2.1 Criar o projeto + aplicar migrations
- [ ] Criar projeto Supabase **prod** (região mais perto dos usuários — `sa-east-1`/São Paulo).
- [ ] Pegar a connection string (Session Pooler, porta 5432 para migrations) → `DATABASE_URL_PROD`.
- [ ] `pnpm check:migrations` (garante que nenhuma migration tem `DROP` não-aprovado).
- [ ] Rodar as migrations: `SUPABASE_PROJECT_ENV=prod` + `DATABASE_URL_PROD` setados, então `pnpm db:migrate:prod`.
  - Isso cria: **extensões** (pgcrypto, pg_trgm, btree_gist), **todas as tabelas**, **RLS (ENABLE+FORCE)** + policies, **triggers** (updated_at, claims_version, snapshot imutável), **partições do audit** (até 2027-04 + default), e os **seeds** embutidos (catálogo de 23 permissions, role bundles, `_reserved_slugs`, `_schema_version`).
  - O `db:migrate:prod` tira um `pg_dump` ANTES e cria `MIGRATION_FAILED.md` se algo falhar (não re-roda até você resolver).
- [ ] Procedimento de restore (se a migration falhar) em [migrations.md](./migrations.md).

### 2.2 Verificar RLS (a parte perigosa — não pule)
- [ ] Confirmar que **toda** tabela tenant-scoped tem RLS `ENABLE + FORCE` (a migration faz, mas verifique uma amostra: `clinics`, `patients`, `appointments`).
- [ ] Confirmar que role `anon` **não lê nada** (testes 2.6.1–2.6.8 do [c2-validation.md](./c2-validation.md)).

### 2.3 Ativar o Auth Hook (MANUAL no Dashboard — sem isso, login não injeta claims)
- [ ] Dashboard → **Authentication** → **Sessions** → **Access Token TTL = 900** (15 min). *(Default é 3600; 900 reduz a janela de replay pós-logout — D12.)*
- [ ] Dashboard → **Authentication** → **Hooks** → **Custom Access Token** → habilitar, Function = **`custom_access_token_hook`** (criada pelas migrations 0003/0004/0006).
- [ ] Validar: `GET https://<prod>/api/health/auth-hook` → deve confirmar o hook OK.

### 2.4 MFA + super_admin
- [ ] Dashboard → Authentication → garantir **MFA (TOTP) habilitado** (super_admin exige AAL2).
- [ ] Seed do super_admin: `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` (≥12) no shell, `pnpm seed:super-admin`.
- [ ] Primeiro login do super_admin → enrolar MFA (fluxo `/login/mfa`).

### 2.5 Storage (export LGPD)
- [ ] Criar o bucket `lgpd-exports`: `pnpm seed:lgpd-bucket` (bucket privado; URLs assinadas com TTL).

---

## 3. Variáveis de ambiente (setar na Vercel — projeto prod)

Fonte da verdade: [src/lib/env.ts](../../src/lib/env.ts). Gere segredos **novos** para prod.

**Sempre:**
- [ ] `DATABASE_URL` = connection string prod (**Transaction Pooler, 6543** — runtime do app).
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `ANON_KEY` legado)
- [ ] `SUPABASE_SECRET_KEY` (service_role)
- [ ] `NODE_ENV=production`
- [ ] `CRON_SECRET` = aleatório ≥32 chars (`openssl rand -base64 32`). Compartilhado com os crons + health.
- [ ] `LOGIN_HASH_PEPPER` = aleatório ≥32 chars.
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (do projeto Upstash prod).

**Cripto — escolha UM backend:**
- [ ] **Opção simples (recomendada no lançamento):** `CRYPTO_SECRET_BACKEND=env` + `CRYPTO_MASTER_KEY_V1` (32 bytes base64: `openssl rand -base64 32`) + `CRYPTO_LOOKUP_SALT` (≥16 bytes base64) **nas env vars da Vercel** (encriptadas em repouso, NÃO em arquivo `.env`).
- [ ] **Opção robusta (upgrade futuro):** `CRYPTO_SECRET_BACKEND=gcp` + `GCP_PROJECT_ID` + `GCP_SECRET_MASTER_KEY_NAME` + `GCP_SECRET_LOOKUP_SALT_NAME` (secrets no Google Secret Manager; `CRYPTO_MASTER_KEY_*`/`CRYPTO_LOOKUP_SALT` ficam UNSET). Ver [secret-rotation.md §GSM](./secret-rotation.md).

> ⚠️ `CRYPTO_LOOKUP_SALT` e `CRYPTO_MASTER_KEY_V1` são **imutáveis na prática**: trocar o salt quebra todos os lookups; trocar a master key V1 torna ilegível todo dado cifrado. Rotação só via V2 aditivo. **Defina uma vez, guarde com cuidado.**

**Opcional/tuning** (têm default sensato): `OUTBOX_BATCH_SIZE`, `OUTBOX_PARALLELISM`, `OUTBOX_*`, `MASTER_KEY_VERSION`, `LOG_LEVEL`.

- [ ] Após setar tudo: `pnpm build` (ou deploy) sem erro `[env] Invalid environment variables`.

---

## 4. Vercel + Crons

> **F-01/F-03/F-09 (remediação forense 2026-06-10):** o agendamento agora é
> 100% **versionado** em [vercel.json](../../vercel.json) — antes o outbox e o
> reconcile frequente dependiam de agendador externo invisível ao repo.

- [ ] Deploy do branch para `main` (produção).
- [ ] Confirmar que os 6 crons de [vercel.json](../../vercel.json) estão ativos (Vercel → Project → Settings → Cron Jobs):
  - `/api/cron/outbox` — `* * * * *` (motor event-driven; F-01).
  - `/api/cron/patient-hard-delete` — `0 3 * * *` (LGPD hard-delete/anonimização após 30d — ADR-021).
  - `/api/cron/audit-partitions` — `0 4 1 * *` (provisiona partições do audit).
  - `/api/cron/cash-flow-rollup` — `30 3 * * *` (agregado diário do caixa).
  - `/api/cron/financial-reconcile` — `*/15 * * * *` (safety-net R4 ≈15min; F-03).
  - `/api/cron/data-retention` — `0 5 1 * *` (purge outbox terminal >30d + login_attempts >90d; F-09).
- [ ] Os crons usam o `CRON_SECRET` automaticamente (Vercel injeta o Bearer).
- [ ] **Verificar o plano Vercel = Pro.** Crons de alta frequência (1min/15min)
  exigem Pro; no Hobby o deploy com este `crons[]` é rejeitado. (Item 7 do
  INSUFFICIENT_EVIDENCE da auditoria — confirmação assinada no go-live.)

### 4.1 Fallback: agendador externo (apenas se Hobby)
Se o projeto estiver no **Hobby** (cron máx. 1x/dia), remova `outbox`,
`financial-reconcile` e `data-retention` do `crons[]` e aponte um agendador
externo para as rotas, com header `Authorization: Bearer <CRON_SECRET>` (a rota
aceita origem não-Vercel — `x-vercel-cron` é não-fatal; só o Bearer é o gate):
  - **cron-job.org** (grátis, 1 min): URL + Custom Header `Authorization: Bearer <CRON_SECRET>`.
  - **Upstash QStash**: schedule `* * * * *` → destino a URL, header Authorization.
  - **GitHub Actions** (`schedule: "*/5 * * * *"` — mínimo ~5 min; só se 5 min for tolerável).
- [ ] **ALARME PAREADO obrigatório (F-01):** todo agendador externo precisa do
  monitor §5.1 em `GET /api/health/outbox?strict=1` — é ele que detecta
  (`pending_age` > 5min → 503) se o agendador parar em silêncio.
- [ ] Defina o `CRON_SECRET` igual no Vercel **e** no agendador externo.
- [ ] Valide: o health `GET /api/health/outbox?strict=1` (com Bearer) deve mostrar `pendingCount` baixo/estável.

---

## 5. Monitoramento — o que monitorar e como

Todos os health endpoints exigem `Authorization: Bearer <CRON_SECRET>` (por isso abrir no browser dá **401 — é esperado**, não bug).

### 5.1 Outbox/DLQ (o mais importante — integridade de eventos)
- **URL:** `https://<prod>/api/health/outbox?strict=1`
- **Header:** `Authorization: Bearer <CRON_SECRET>`
- **Comportamento:** retorna **503** quando degradado (evento `failed`, worker travado, etc.); **200** quando saudável.
- **Config no monitor (UptimeRobot / BetterStack / Cronitor):**
  - [ ] Novo monitor HTTP(s), URL acima.
  - [ ] Adicionar **Custom HTTP Header**: `Authorization: Bearer <CRON_SECRET>`. *(Header customizado é plano pago em alguns; BetterStack/Cronitor/Healthchecks suportam.)*
  - [ ] Alertar quando status **≠ 200**.
  - [ ] Intervalo: 5 min.

### 5.2 Auth Hook (sem ele, ninguém loga)
- **URL:** `https://<prod>/api/health/auth-hook` (mesmo header Bearer).
- [ ] Monitor com o mesmo padrão; alerta se ≠ 200.

### 5.3 Crons rodando
- [ ] Vercel → Cron Jobs → conferir execuções verdes. Opcional: ping de dead-man-switch (Healthchecks.io) no fim do cron de outbox.

### Teste local rápido (responde o 401)
O 401 no browser é porque ele não manda o Bearer. Teste mandando o header:

**Windows PowerShell** (`curl` é alias do Invoke-WebRequest — use `curl.exe`):
```powershell
curl.exe -H "Authorization: Bearer SEU_CRON_SECRET" "http://localhost:3000/api/health/outbox?strict=1"
```
ou, nativo (lança em 503 no PS 5.1 — use só pra checar saudável):
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health/outbox?strict=1" -Headers @{ Authorization = "Bearer SEU_CRON_SECRET" }
```

**bash/macOS/Linux:**
```bash
curl -H "Authorization: Bearer SEU_CRON_SECRET" "http://localhost:3000/api/health/outbox?strict=1"
```
(o `CRON_SECRET` está no `.env.local`). Deve voltar `200` com `{ok:true, degraded:false, ...}`.

---

## 6. Verificação pré-lançamento (smoke manual em prod)
- [ ] Login do super_admin → MFA → `/dashboard`.
- [ ] Criar 1 clínica + 1 usuário de clínica (via seed ou SQL) e fazer login como ele.
- [ ] Criar 1 paciente → confirmar que `cpf_encrypted` no banco NÃO contém o CPF em claro (criptografia ativa).
- [ ] `GET /api/health/outbox?strict=1` (com Bearer) → 200, `degraded:false`.
- [ ] `GET /api/health/auth-hook` → OK.
- [ ] RLS: logado na clínica A, não enxergar dados da B.

---

## 7. Operação contínua (referências)
- Migrations: [migrations.md](./migrations.md) · Rotação de segredos: [secret-rotation.md](./secret-rotation.md)
- Restore/PITR: [restore-test.md](./restore-test.md) · Retenção de audit: [audit-retention.md](./audit-retention.md)
- Mudou bundle de uma role? rode `pnpm bump-role-claims <role>` (ver §abaixo).

### Quando rodar `bump-role-claims`
**Só** quando você mudar o **bundle de permissões de uma ROLE** na tabela
`role_permissions` (decisão de plataforma sua — ex.: "atendente não tem mais
`edit:agenda`"). NÃO é por solicitação de cliente. Mudanças por-usuário
(promover alguém, override individual) são detectadas **automaticamente** pelos
triggers de `claims_version` — nada a fazer.
