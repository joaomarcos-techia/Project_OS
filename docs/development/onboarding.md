# Onboarding de Desenvolvedor

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Trilha para alguém novo (ou "o eu do futuro daqui a 6 meses") sair do zero até contribuir com segurança. Meta: **entender o sistema apenas pela documentação**.

> ℹ️ Isto é onboarding de **quem desenvolve** o ClinicaOS. Não confundir com [onboarding-spec.md](../onboarding-spec.md), que é a *feature de produto* de cadastro de clínicas.

---

## Dia 1 — Rodar

Objetivo: app de pé na sua máquina.

1. Siga [setup.md](./setup.md) de ponta a ponta (pré-reqs → install → `.env.local` → migrations → seeds → `pnpm dev`).
2. Entre no app com o super_admin que você semeou.
3. Rode os gates locais (`pnpm typecheck lint test`) e confirme verdes.

✅ Checkpoint: `http://localhost:3000` abre e você loga.

---

## Dia 2 — Entender a arquitetura

Objetivo: ter o mapa mental. Leia **nesta ordem**:

1. [VisãoGeral.md](../VisãoGeral.md) **§1–§2** — o que é o produto, o problema anti-vazamento, e a filosofia arquitetural (bounded contexts, multi-tenant, defesa em 4 camadas, outbox). Não precisa decorar; precisa entender o *porquê*.
2. [architecture/context-map.md](../architecture/context-map.md) — os **8 bounded contexts** e como conversam via eventos. É o mapa de "quem depende de quem".
3. [CONVENTIONS.md](../CONVENTIONS.md) — as regras que o código obedece (naming, matriz de imports, RLS, threat model). É a lei que o lint enforça.
4. Folheie o [índice de ADRs](../adr/README.md) — não leia os 30; entenda que **toda decisão grande tem um ADR com o racional**. Leia ADR-001 (bounded contexts), ADR-002/007 (RLS) e ADR-003/011 (outbox) para pegar as fundações.
5. [PROGRESS.md](../PROGRESS.md) — o que já foi construído (C0–C16) e o que falta.

✅ Checkpoint: você consegue explicar por que "Scheduling emite `appointment.completed` e Financial reage" em vez de um JOIN.

---

## Dia 3 — Contribuir

Objetivo: sua primeira mudança segura.

1. Leia [engineering/git-workflow.md](../engineering/git-workflow.md) — branches, Conventional Commits, PR, gates de CI, e a regra **"mudança arquitetural sem ADR = bloqueada"**.
2. Leia [engineering/ai-development.md](../engineering/ai-development.md) — como trabalhar com Claude Code neste repo e a regra de **Documentação Automática** (toda mudança documenta a si mesma).
3. Antes de criar/mudar algo, passe pelo [engineering/decision-guide.md](../engineering/decision-guide.md) — o fluxograma "isto precisa de ADR? migration? evento?".
4. Faça a mudança numa branch `feat/*` ou `fix/*`, rode os gates locais, abra PR usando o template.

✅ Checkpoint: PR aberto, CI verde, documentação do que você mudou no lugar certo.

---

## Mapa rápido do repositório

```
src/
├── app/(app)/       → app das clínicas (app.qoro.dev)
├── app/(admin)/     → painel do fundador (admin.qoro.dev)
├── app/api/         → route handlers (cron, webhooks, health)
├── contexts/        → 8 bounded contexts (identity, tenancy, patient,
│                       scheduling, clinical, financial, ai-agent, platform-admin)
├── lib/             → db, auth, outbox, audit, messaging, ai, pdf, ...
└── components/      → ui (shadcn), forms, shared
drizzle/migrations/  → migrations versionadas (imutáveis após aplicar)
docs/                → esta documentação (comece em README.md)
```

Cada `src/contexts/*/README.md` e `src/lib/*/README.md` descreve a responsabilidade daquele módulo.

---

## Onde procurar quando…

| Preciso… | Vá para |
|---|---|
| Rodar / configurar | [setup.md](./setup.md), [environment.md](./environment.md) |
| Entender uma decisão | [adr/README.md](../adr/README.md) |
| Saber uma regra de código | [CONVENTIONS.md](../CONVENTIONS.md) |
| Operar em produção / incidente | [runbooks/README.md](../runbooks/README.md) |
| Saber o estado de uma camada | [PROGRESS.md](../PROGRESS.md) |
| Decidir se algo precisa de ADR | [engineering/decision-guide.md](../engineering/decision-guide.md) |

---

## Veja também

- [../README.md](../README.md) — índice mestre.
- [../architecture/context-map.md](../architecture/context-map.md) — mapa dos contextos.
- [../VisãoGeral.md](../VisãoGeral.md) — a fonte-da-verdade.
