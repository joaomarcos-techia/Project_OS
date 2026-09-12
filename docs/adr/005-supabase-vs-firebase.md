# ADR-005 — Supabase (Postgres) escolhido sobre Firebase

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-25

## Context

ClinicaOS V1 rodava em Firebase (Firestore + Auth + Functions + Hosting). Os problemas que motivaram V2 foram em grande parte ligados ao banco NoSQL:

- Isolamento de tenant via `where clinicId == X` manual em 537 lugares (sem RLS nativo)
- Queries cross-collection caras e sem JOIN (forçando duplicação massiva de dados)
- Modelagem ad-hoc para cada feature, sem schema enforcement
- Custo crescendo de forma não-previsível (cada read cobrado individualmente)

V2 precisa de: SQL relacional, schema enforcement, RLS nativo, custo previsível, e ainda ser administrado por solo founder (sem ops time).

## Decision

**Banco: Postgres via Supabase.** Inclui Supabase Auth + Storage + Realtime no mesmo pacote.

Stack:
- ORM: Drizzle (TypeScript-first, migrations versionadas em código, sem magic)
- Auth: Supabase Auth com custom claims hook injetando `clinic_id` e `role` no JWT
- Storage: Supabase Storage para PDFs clínicos, anexos de prontuário
- Realtime: usado conservadoramente (kanban consultório), não como fonte de verdade

Dois ambientes Supabase: `qoro-prod` (produção, plano Pro com PITR + backups) e `qoro-dev` (development, free tier). Sem Supabase CLI local — todo dev usa cloud `qoro-dev` para evitar drift entre versões.

## Consequences

- RLS Postgres nativo (ADR-002) resolve isolamento de tenant de uma vez.
- SQL relacional resolve dor de modelagem do V1 (`appointment` tem FK para `patient`, JOIN trivial dentro do mesmo contexto).
- Drizzle dá types ponta-a-ponta (schema → tipo TS sem geração manual).
- Lock-in moderado: Supabase Auth + Storage têm APIs proprietárias. Saída futura: substituir Auth por Lucia/Better-Auth (1-2 dias), substituir Storage por S3 (1 dia, padrão de mercado). Postgres é Postgres — totalmente portável.
- Custo previsível: plano Pro $25/mês cobre até ~100 clínicas (estimativa por size + connections). Team $599/mês cobre 1000+. Sem surpresa de "burst de leads custou $400".
- Single point of failure: Supabase down = sistema down. Aceito até C16 (Hardening) — solo founder não opera multi-region.

## Alternatives

- **Continuar Firebase + Firestore:** rejeitada — V1 morreu disso. RLS Firestore (`rules`) é frágil, sem JOINs, custo imprevisível.
- **Postgres self-hosted (DigitalOcean / Hetzner managed):** rejeitada — adiciona ops (backups, patches, scaling). Supabase resolve por $25/mês.
- **AWS RDS Postgres + Cognito Auth:** rejeitada — IAM AWS é complexo demais para solo founder; Cognito é menos pleasant que Supabase Auth.
- **PlanetScale (MySQL):** rejeitada — sem JSON nativo confortável, sem RLS, removeu free tier (instabilidade comercial).
- **Neon (Postgres serverless):** rejeitada na C0 — interessante (cold start rápido, branching), mas Supabase oferece o pacote completo (Auth + Storage) que cortaria 3 dependências. Reavaliar em v2.2.

## References

- `Documentação/PlanoAção.md` seções 1.1 (motivação V2), C1 (banco), C2 (RLS), C3 (Auth)
- ADR-002 (RLS) — dependente desta decisão
- ADR-001 (Bounded Contexts) — Supabase Postgres é o substrato físico do isolamento
