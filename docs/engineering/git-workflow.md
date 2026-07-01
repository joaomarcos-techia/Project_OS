# Git Workflow

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Descreve o fluxo de git **que já está em uso** no ClinicaOS — não inventa processo novo. Duas regras duras são novas e explícitas: commits `docs:` e **"mudança arquitetural sem ADR = bloqueada"**.

---

## Branches

Trunk único: **`main`** (protegido por CI). Trabalho em branch curta a partir de `main`:

| Prefixo | Uso | Exemplo (do histórico real) |
|---|---|---|
| `feat/*` | Nova funcionalidade / camada | `feat/receituario-controle-especial`, `feat/c7-clinical` |
| `fix/*` | Correção | `fix/admin-clinicas-loading` |
| `hotfix/*` | Correção urgente direto de `main` | — |
| `docs/*` | Só documentação | — |

Merge em `main` via PR (ver abaixo). Deploy de produção = merge em `main` (Vercel). Migrations de prod são **manuais** e separadas do deploy (ver §CI).

---

## Commits — Conventional Commits

Formato: `tipo(escopo): descrição no imperativo`.

| Tipo | Quando |
|---|---|
| `feat` | Funcionalidade nova |
| `fix` | Correção de bug |
| `refactor` | Mudança interna sem alterar comportamento |
| `docs` | **Só documentação** (ex.: `docs(auth): update auth ADR`) |
| `test` | Testes |
| `chore` | Tooling, deps, config |
| `security` | Correção/endurecimento de segurança |

**Escopo** = camada (`c16`) ou contexto/área (`auth`, `clinical`, `billing`, `admin`, `ui`, `middleware`). Exemplos reais:

```
feat(clinical): receituário de controle especial (Fase 1) + endereço do paciente
docs(billing): C13 verificado em prod (round-trip real) + 2 fixes de deploy
fix(middleware): isenta /api/webhooks/* do gate de sessão
test(ai-agent): gate par.11.12 APROVADO — 50 mensagens adversariais com Gemini REAL
```

> 💡 Commits antigos com título bare (`C13`, `C15`) são legado pré-convenção. Novos commits seguem o padrão acima.

---

## Duas regras duras

1. **Documentação Automática.** Todo commit que muda comportamento documenta a si mesmo no lugar certo (ADR / CONVENTIONS / PROGRESS / comentário WHY / mensagem de commit). A tabela de roteamento vive em [ai-development.md](./ai-development.md#documentação-automática). Um `feat:` que altera arquitetura **sem** o ADR correspondente está incompleto.

2. **Mudança arquitetural sem ADR = bloqueada.** Se o PR muda uma decisão arquitetural (isolamento de tenant, outbox, encryption, ownership de dado, modelo de planos, etc.), ele **precisa** de um ADR novo ou de referência a um existente. Hoje isso é enforçado na **revisão de PR**; um check de CI ("PR tocou `src/contexts` ou `drizzle/migrations` sem ADR/CONVENTIONS?") é candidato ao 2º passo. Ver [decision-guide.md](./decision-guide.md).

---

## Pull Requests

Todo PR usa o [template](../../.github/pull_request_template.md) com: **Objetivo · Alterações · Testes · Riscos · Rollback**. Se cria/altera tabela, cola o **checklist anti-vazamento** do [CONVENTIONS.md](../CONVENTIONS.md) (categorias A/B/C do ADR-007 §10).

Antes de abrir, rode os gates locais (mesmos do CI):

```bash
pnpm typecheck && pnpm lint && pnpm arch:check && pnpm arch:db-check \
  && pnpm check:migrations && pnpm check:registry:strict && pnpm test && pnpm build
```

---

## CI (`.github/workflows/ci.yml`)

Roda em `push`/`pull_request` para `main`. Gates, em ordem:

`typecheck` → `lint` → `arch:check` (circular deps) → `arch:db-check` (origem de conexão) → `check:migrations` (anti-DROP) → `check:registry:strict` (catalog ⇔ registry) → `test` → `build`.

> ⚠️ **Dívida conhecida:** o CI usa `node-version: 20`, mas o runtime exige **22.x** (`package.json engines`). Alinhar para 22 é candidato ao 2º passo (achado A3 em [documentation-audit.md](../documentation-audit.md)).

### Migrations em produção — nunca automáticas

Schema change é evento crítico. `db:migrate:prod` roda em job **manual**, com backup antes (`pg_advisory_lock(4242)` + `SUPABASE_PROJECT_ENV=prod` explícito), logado em `super_admin_actions`. Procedimento completo: [runbooks/migrations.md](../runbooks/migrations.md).

---

## Veja também

- [decision-guide.md](./decision-guide.md) — quando um PR precisa de ADR/migration/evento.
- [ai-development.md](./ai-development.md) — regra de Documentação Automática.
- [CONVENTIONS.md](../CONVENTIONS.md) — checklist de nova tabela + anti-padrões.
- [../../.github/pull_request_template.md](../../.github/pull_request_template.md) — template de PR.
- [README.md](../README.md) — índice mestre.
