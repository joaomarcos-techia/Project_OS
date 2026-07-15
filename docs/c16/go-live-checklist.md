# C16 — Checklist de Fechamento (o que falta e como fazer)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice C16](./README.md) · [índice mestre](../../docs/README.md).

A **implementação** da C16 está pronta e em produção. Faltam **passos operacionais** (não-código) pra fechar 100% pelos critérios do plano. Cada item abaixo tem: **o que**, **como** (passo a passo) e **pronto quando**.

> ✅ **Já validados AO VIVO nesta rodada** (não precisa refazer): Sentry capturando erros (issues QORO-1/QORO-2) e o `/api/health` pegando dependência degradada (Gemini sem key → `degraded`/503, depois corrigido). Esses são o Drill 1 e o Drill 2 da FASE 13, feitos em produção.

---

## 1. Source maps no Sentry (stack traces legíveis)
**O que:** o build da Vercel não sobe os source maps → erros em prod aparecem minificados.
**Como:**
1. Pegue o token no `.env.sentry-build-plugin` local (`SENTRY_AUTH_TOKEN=sntrys_...`).
2. Vercel → Settings → Environment Variables → adicione **`SENTRY_AUTH_TOKEN`** (Production).
3. Redeploy. Nos logs deve aparecer "Uploading source maps" / "Creating release".
**Pronto quando:** um erro novo no Sentry mostra `arquivo.ts:linha` em vez de `bundle.js:...`.

## 2. Alertas (ser avisado sem ficar olhando)
**O que:** faltam as regras de alerta (o monitoramento existe; a notificação não).
**Como:**
- **Sentry** → Alerts → Create Alert → *Issues* → "new issue em `production`" e/ou ">N eventos/1h" → ação e-mail/Slack. (Regra: janela+threshold, nunca evento isolado — [alert-tuning.md](../runbooks/alert-tuning.md).)
- **Better Stack Uptime** → no monitor → On-call / Escalation → canal (e-mail/SMS/Slack). E confirme que os monitores de health têm o header `Authorization: Bearer <CRON_SECRET>` (senão 401).
**Pronto quando:** um erro forçado te notifica; e derrubar o health (ex.: tirar uma env) dispara o alerta de uptime.

### 2.a ⚠️ AÇÃO NOVA — monitor do `/api/health/auth-hook` (A1, 2026-07-15)
**Por quê:** essa rota era **anônima no código** até a remediação da auditoria de APIs —
só a doc a descrevia como autenticada (§5 desta lista, e §5.2 do
[production-readiness](../runbooks/production-readiness.md)). Se o monitor dela foi criado
sem o header, ele **passa a receber 401** e vai alarmar falso no próximo deploy.
**Como:** Better Stack → monitor do auth-hook → Request headers → `Authorization: Bearer <CRON_SECRET>`.
As rotas irmãs (`/api/health`, `/api/health/outbox`) já exigiam o header — se elas estão
verdes hoje, é só copiar a mesma config.
**Pronto quando:** o monitor do auth-hook volta 200 com o header e 401 sem ele.

### 2.b Saved search do `billing.webhook.verify` p95 (A2, 2026-07-15)
**Por quê:** o webhook do Asaas passou a **verificar o pagamento no provider** antes de
mudar estado (ADR-025 addendum). Isso põe uma chamada HTTP no caminho do webhook, com
teto de ~10s dentro de um `maxDuration` de 30s. O threshold está definido em
[slo.md §3.1](./slo.md); **o disparo depende deste item #2**.
**Como:** Better Stack → saved search em `kind:"metric" event:"billing.webhook.verify"` →
alerta quando **p95 de `duration_ms` > 5s por 5min**. Complementos úteis no mesmo canal:
`billing.webhook.error` (taxa de 500) e `billing.reconcile.divergence` (o reconcile achou
o que o webhook não refletiu — evento perdido **ou** forjado).
**Pronto quando:** o alerta dispara num teste forçado. **Severidade: investigação, não
pager** — a degradação aqui é fail-safe (nada é persistido, o Asaas re-entrega, o
reconcile diário corrige). Ver `runbooks/asaas-webhook-missing.md`.

## 3. Restore test (o bloqueador do plano) — agora em 1 comando
**O que:** provar que o backup **restaura** (backup não-testado = não é backup).
**Como (grátis, sem PITR):**
1. Tenha um dump: `pnpm db:backup:prod` (precisa `SUPABASE_PROJECT_ENV=prod` + `DATABASE_URL_PROD` com `?sslmode=require`).
2. Provisione um **scratch** (qualquer um):
   - Supabase: crie um projeto **free** `restore-test` e copie a connection string; **ou**
   - Postgres local: um banco vazio (`createdb clinicaos_restore_test`).
3. Rode:
   ```
   RESTORE_TARGET_URL="postgresql://.../scratch?sslmode=require" pnpm restore:test
   ```
   (o script pega o dump mais recente de `backups/`, restaura no scratch e imprime as contagens; erros de auth/rls no restore são **benignos** — o dump exclui os schemas do Supabase.)
4. Confira se `clinics/patients/appointments/audit_events` batem com a ordem de grandeza de prod.
5. **Derrube o scratch** (contém PII).
**Pronto quando:** o `pnpm restore:test` imprime as contagens e elas batem. Registre a data em `docs/runbooks/restore-test.md`.

## 4. Backup automático (RPO ≤ 24h sem PITR)
**O que:** garantir dumps recorrentes sem depender de você lembrar.
**Como:** já existe a Action [.github/workflows/db-backup.yml](../../.github/workflows/db-backup.yml). Só configure os secrets:
1. GitHub → repo → Settings → Secrets and variables → Actions → New secret:
   - `DATABASE_URL_PROD` = connection string de prod (com `?sslmode=require`).
   - `BACKUP_PASSPHRASE` = senha forte (guarde no cofre — é a chave pra descriptografar).
2. Dispare manual uma vez: aba **Actions** → "Daily DB Backup (prod)" → Run workflow.
3. Baixe o artifact `db-backup` e teste: `gpg -d prod-*.sql.gpg > dump.sql` → `RESTORE_TARGET_URL=... pnpm restore:test dump.sql`.
**Pronto quando:** a Action roda verde e o artifact cifrado aparece. (Alternativa paga: Supabase **Pro $25/mês** já dá backup diário automático no dashboard — mais simples, sem CI.)

> **Sobre PITR ($100/mês):** NÃO é necessário. Seu alvo de DR é **RPO ≤ 24h** ([disaster-recovery.md](../runbooks/disaster-recovery.md)), e backup diário (Action grátis ou Supabase Pro) já atende. PITR só quando o negócio exigir RPO de minutos.

## 5. Demais drills da FASE 13 ([failure-drills.md](../runbooks/failure-drills.md))
- **Drill 1 (Sentry) e Drill 2 (health degraded):** ✅ já feitos ao vivo.
- **Drill 3/4 (restore):** = item 3 acima.
- **Drill 5 (audit export + hash):** rode o export de audit de uma clínica (painel admin) e confira o hash numa 2ª execução do mesmo período.
- **Drill 6 (prompt injection):** já há `docs/audits/C11_ADVERSARIAL_50.md` (50 testes). Reforce mandando ~10 mensagens adversariais no WhatsApp e confirmando que a IA nunca aconselha clinicamente / nunca vaza cross-tenant.

## 6. Production rehearsal ([production-rehearsal.md](../runbooks/production-rehearsal.md))
**O que:** ensaio de 1 dia com uma **clínica fake** antes do 1º cliente pagante.
**Como:** siga os 8 passos do runbook (Cadastro → WhatsApp → Agenda → IA → Financeiro → Export LGPD → Delete → Restore), observando Sentry/Better Stack/`/api/health`. É manual/interativo (usa Meta+Asaas sandbox).
**Pronto quando:** os 8 passos completam sem erro bloqueante e o isolamento multi-tenant se mantém.

---

## Resumo (marque conforme fizer)
- [x] 1. `SENTRY_AUTH_TOKEN` na Vercel + redeploy — source maps confirmados legíveis (2026-07-02)
- [~] 2. Alerta no Sentry (Alert Rule → Issues → env=production) + escalation/canal no Uptime — **finalizar**
- [ ] 2.a Header `Authorization: Bearer` no monitor do `/api/health/auth-hook` — **antes do próximo deploy** (a rota virou autenticada; sem o header o monitor alarma falso)
- [ ] 2.b Saved search do `billing.webhook.verify` p95 > 5s/5min (threshold já em `slo.md` §3.1)
- [x] 3. Restore test — restaurado no scratch/dashboard (prod ~vazio → 0 tenant é esperado)
- [x] 4. Backup diário (Action) verde + secrets configurados (2026-07-02)
- [x] 5a. Drill 1 (Sentry) — feito ao vivo (event id via /api/health/sentry-test)
- [x] 5b. Drill 2 (health degraded) — feito ao vivo (Gemini key faltando)
- [ ] 5c. Drill 5 (audit hash) + Drill 6 (prompt injection)
- [ ] 6. Production rehearsal

**Falta:** finalizar #2 (Alert Rule com env=production + canal no Uptime + os dois
sub-itens 2.a/2.b da auditoria de APIs) e fazer #5c/#6 (antes do 1º cliente). O resto
está fechado.

> **Nota sobre o 5c (Drill 5 — audit hash):** o export de auditoria mudou na auditoria de
> APIs (B6). Ao rodar o drill, o comportamento esperado agora é: período > 12 meses → **422**
> com mensagem; período que estouraria 5000 eventos → **422** (antes saía um PDF truncado
> em silêncio com o `sha256` atestando o período inteiro). O hash de duas execuções do
> mesmo período continua tendo de bater.
