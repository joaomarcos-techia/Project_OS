# Runbook — Rotação de Segredos (Remediação F-02)

> **Status:** PREPARAÇÃO. Este runbook **não executa** rotação — ele inventaria os
> segredos, onde cada um é usado, a ordem de rotação e o impacto, para que a
> rotação real seja feita com confiança. Nenhum valor de segredo aparece aqui.

## Por que (F-02)

A auditoria pré-C6 (`docs/Relatorio.md`, F-02) encontrou os segredos reais do
ambiente dev em `.env.local`, dentro de uma pasta **sincronizada para a nuvem
(OneDrive)**: `C:\Users\...\OneDrive\Área de Trabalho\ClinicaOS_V2`. O arquivo é
(corretamente) gitignored, mas a sincronização OneDrive expõe master key de
cripto, senha super_admin, cron secret, senha do DB e tokens à cadeia de sync da
Microsoft.

## Ação imediata recomendada (antes da rotação)

1. **Tirar o repositório do caminho sincronizado** OU excluir `.env*` do sync do
   OneDrive (OneDrive → Configurações → Backup/escolher pastas; ou mover o repo
   para `C:\dev\ClinicaOS_V2`).
2. Confirmar que `.gitignore` cobre `.env.local` e todos `.env*` (exceto
   `.env.example`).
3. **Garantir que segredos de PROD ≠ DEV.** Os segredos atuais são de `qoro-dev`;
   nunca promover a master key/senha de dev para prod.

## Inventário de segredos (fonte: [src/lib/env.ts](../../src/lib/env.ts))

| Segredo | Onde é usado | Backend prod | Impacto de rotação |
|---|---|---|---|
| `DATABASE_URL` (senha embutida) | `src/lib/db/index.ts` (3 pools) | Vercel env / Supabase | Resetar senha do DB no Supabase → atualizar a URL nos envs. Reconectar pools (cold start). |
| `SUPABASE_SECRET_KEY` (service_role) | `src/lib/auth/supabase-admin.ts` (`createAdminClient`) | Vercel env | Rotacionar no Supabase (API keys). Invalida tokens admin antigos. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `ANON` | client + middleware + supabase-server | Vercel env (público) | Cliente; rotação no Supabase. |
| `LOGIN_HASH_PEPPER` (≥32) | `src/lib/auth/email-hash.ts` (HMAC do email em `login_attempts`) | Vercel env | Rotacionar invalida as janelas de rate-limit em voo (15min) — aceitável. Hashes antigos em `login_attempts` ficam órfãos (não revertem; é auditoria). |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | `src/lib/auth/rate-limit.ts` | Vercel env | Rotacionar token no Upstash. Fail-open (F-08) cobre a janela de troca. |
| `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` (≥12) | `scripts/seed-super-admin.ts` (bootstrap) | só dev/setup | Trocar a senha do super_admin via Supabase Auth (ou `--reset-mfa`). **Prioridade alta** — credencial de plataforma. |
| `CRON_SECRET` (≥32) | `src/app/api/cron/*` + healthcheck | Vercel env | Gerar novo (≥32 aleatório) e atualizar nos envs da Vercel. O cron passa a exigir o novo Bearer. |
| `CRYPTO_MASTER_KEY_V1` (32B base64) | `src/lib/crypto/secret-provider.ts` (`EnvSecretProvider`) | **Google Secret Manager** (`GcpSecretManagerProvider`) | **NÃO** rotacionar trocando o valor de V1 — isso torna ilegível todo ciphertext existente. Rotação correta = adicionar `CRYPTO_MASTER_KEY_V2` + `MASTER_KEY_VERSION=2` (novos writes em V2; reads escolhem pela version byte). Re-encrypt em massa é job ad-hoc (C16). |
| `CRYPTO_MASTER_KEY_V2` | idem (rotação) | GSM | Versão futura; ver acima. |
| `MASTER_KEY_VERSION` | versão ativa de escrita | env | Só sobe (1→2). |
| `CRYPTO_LOOKUP_SALT` (≥16B base64) | `hashForLookup` (cpf_hash/telefone_hash/contact_hash) | GSM | **NÃO** rotacionar sem re-hash de todos os lookups — quebraria `UNIQUE(clinic_id, cpf_hash)` e a busca. Tratar como imutável (ou job de re-hash em C16). |
| `GCP_PROJECT_ID`, `GCP_SECRET_MASTER_KEY_NAME`, `GCP_SECRET_LOOKUP_SALT_NAME` | `GcpSecretManagerProvider` (prod) | env (ponteiros) | Apontam para o GSM; não são segredos em si. |

## Compatibilidade com Google Secret Manager (prod)

Já suportada por `src/lib/crypto/secret-provider.ts`:
- `CRYPTO_SECRET_BACKEND=gcp` (default em prod) faz `getSecretProvider()` usar
  `GcpSecretManagerProvider`.
- A master key e o lookup salt vivem como secrets no GSM (mesmo encoding base64
  do backend env), nomeados por `GCP_SECRET_MASTER_KEY_NAME` /
  `GCP_SECRET_LOOKUP_SALT_NAME`; a versão da master key é lida por
  `accessSecretVersion(.../versions/<n>)`.
- **Em prod, `CRYPTO_MASTER_KEY_V*` e `CRYPTO_LOOKUP_SALT` ficam UNSET no env** —
  o checklist 5.7 já exige isso; a master key nunca em `.env` em prod.

## Ordem de rotação sugerida (quando for executar — fora deste runbook)

1. `SUPER_ADMIN_PASSWORD` (credencial de plataforma — primeiro).
2. `CRON_SECRET` (gera novo, atualiza Vercel, confirma cron 200).
3. `UPSTASH_REDIS_REST_TOKEN` (rotaciona no Upstash; fail-open cobre).
4. `SUPABASE_SECRET_KEY` + senha do `DATABASE_URL` (rotaciona no Supabase;
   atualiza envs; reinicia pools).
5. `LOGIN_HASH_PEPPER` (novo ≥32; aceita janela de rate-limit invalidada).
6. `CRYPTO_MASTER_KEY` → **só via V2** (aditivo) + job de re-encrypt (C16). Nunca
   sobrescrever V1.
7. `CRYPTO_LOOKUP_SALT` → tratar como imutável (re-hash é projeto à parte).

## Checklist de verificação pós-rotação (cada segredo)

- [ ] Novo valor setado no destino correto (Vercel env / GSM), nunca em
      `.env.local` de máquina que roda dev.
- [ ] App sobe (`pnpm build` / deploy) sem `[env] Invalid environment variables`.
- [ ] Fluxo dependente validado (login para pepper/Upstash; cron 200 para
      CRON_SECRET; decrypt de paciente para CRYPTO_*).
- [ ] Valor antigo revogado no provider.
