# Setup — Rodando o ClinicaOS localmente

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](../README.md) · faz parte do [onboarding de dev](./onboarding.md).

Do zero ao app rodando. Se você é novo no projeto, siga na ordem — cada passo assume o anterior.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Fonte |
|---|---|---|
| Node.js | **22.x** | `package.json` → `engines.node` |
| pnpm | **11.17.0** | `package.json` → `packageManager` |
| PostgreSQL client (`psql`, `pg_dump`) | 17 | Necessário só para migrations/validação. No PATH. |
| Conta Supabase | — | Projeto `qoro-dev` (Postgres + Auth + Storage) |

> O CI e o runtime rodam em Node **22.x** (`.github/workflows/ci.yml` e `package.json`). Use a mesma versão localmente.

Recomendado: gerencie a versão do Node com o `.nvmrc` do repo (`nvm use`).

---

## 2. Clonar e instalar

```bash
git clone <repo> qoro && cd qoro
pnpm install --frozen-lockfile
```

---

## 3. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha **no mínimo** o bloco "MÍNIMO PARA BOOTAR" do `.env.example` (Database + Supabase). O contrato completo e o racional de cada variável estão em [environment.md](./environment.md); a fonte da verdade é `src/lib/env.ts` (valida no boot — o build/dev falha cedo e explica o que falta).

💡 Muitas variáveis são exigidas só **em runtime** pela feature correspondente (guards `assert*RuntimeReady`), não no boot. Dá para rodar o app e navegar sem preencher Gemini/Asaas/Meta.

---

## 4. Banco de dados

Aplica todas as migrations Drizzle no `qoro-dev`:

```bash
pnpm db:migrate:dev
```

Detalhes, rollback e troubleshooting: [runbooks/migrations.md](../runbooks/migrations.md).

> Depois de ativar o Custom Access Token Hook (passo manual do Supabase Dashboard), valide com [runbooks/c3-validation.md](../runbooks/c3-validation.md). O hook é pré-requisito para login funcionar.

---

## 5. Seeds (dados de dev)

```bash
pnpm seed:super-admin      # cria o super_admin (usa SUPER_ADMIN_EMAIL/PASSWORD do .env.local)
pnpm seed:plans            # planos (Solo/Clínica/Pro) — necessário para billing/onboarding
pnpm seed:dev              # clínica + usuários de teste
```

Outros seeds úteis por área: `seed:clinic-user`, `seed:c9` (financeiro), `seed:c15` (admin), `seed:*-bucket` (Storage). Ver a lista completa em `package.json` → `scripts`.

Para zerar dados de dev: `pnpm reset:dev`.

---

## 6. Rodar

```bash
pnpm dev            # http://localhost:3000
```

Rotas principais: `/(app)` = app das clínicas e `/(admin)` = painel do fundador — **os dois em `app.qoro.dev`** (o subdomínio `admin.qoro.dev` nunca foi provisionado; ver [PROGRESS §D7](../PROGRESS.md)). Ver [architecture/context-map.md](../architecture/context-map.md) e VisãoGeral §2.4.

---

## 7. Gates locais (rode antes de commitar)

Os mesmos checks do CI (`.github/workflows/ci.yml`):

```bash
pnpm typecheck          # tsc --noEmit (strict, 4 flags)
pnpm lint               # ESLint (boundaries + no-restricted-*)
pnpm arch:check         # madge — circular deps
pnpm arch:db-check      # guard de origem de conexão (AST)
pnpm check:migrations   # gate anti-DROP destrutivo
pnpm check:registry:strict   # catalog ⇔ handler registry
pnpm test               # Vitest
pnpm build              # sanity
```

Convenções de commit/branch/PR: [engineering/git-workflow.md](../engineering/git-workflow.md).

---

## 8. Validação por camada (opcional)

Cada camada tem um smoke test e um runbook de validação:

```bash
pnpm smoke:c4   # outbox/audit/idempotency
pnpm smoke:c5   # patient (encryption/LGPD)
pnpm smoke:c9   # financial
# ... c6, c7, c8, c10, c11, c12, c13, c14
```

Índice dos runbooks de validação: [runbooks/README.md](../runbooks/README.md).

---

## Problemas comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Login/painel travando ~5 min | Acesso ao Supabase saturado (não é bug) | Fail-fast já existe em `db/index.ts` + `supabase-server.ts`; exige restart do dev |
| `[env] Invalid environment variables` | `.env.local` incompleto | Leia a mensagem — ela lista o que falta. Compare com `.env.example` |
| `next build` quebra em prod, dev OK | `*/` acidental em comentário CSS (cssnano) | Ver `admin.css`; dev não minifica |
| Login não autentica | Auth Hook não ativado no Dashboard | Seguir [runbooks/c3-validation.md](../runbooks/c3-validation.md) passo 1 |

---

## Veja também

- [onboarding.md](./onboarding.md) — trilha Dia 1/2/3 para um dev novo.
- [environment.md](./environment.md) — cada variável de ambiente explicada.
- [../engineering/git-workflow.md](../engineering/git-workflow.md) — como commitar/abrir PR.
- [../runbooks/README.md](../runbooks/README.md) — procedimentos operacionais.
