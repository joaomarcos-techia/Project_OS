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
- [x] 3. Restore test — restaurado no scratch/dashboard (prod ~vazio → 0 tenant é esperado)
- [x] 4. Backup diário (Action) verde + secrets configurados (2026-07-02)
- [x] 5a. Drill 1 (Sentry) — feito ao vivo (event id via /api/health/sentry-test)
- [x] 5b. Drill 2 (health degraded) — feito ao vivo (Gemini key faltando)
- [ ] 5c. Drill 5 (audit hash) + Drill 6 (prompt injection)
- [ ] 6. Production rehearsal

**Falta:** finalizar #2 (salvar a Alert Rule com env=production + garantir o canal de
notificação no Uptime) e fazer #5c/#6 (antes do 1º cliente). O resto está fechado.
