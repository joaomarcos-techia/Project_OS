# ClinicaOS

Sistema operacional **anti-vazamento** para clínicas pequenas e médias brasileiras: gestão clínica + agente de IA no WhatsApp + cobrança automatizada + auditoria forense, num único produto SaaS multi-tenant.

**Stack:** Next.js 15 (App Router) · TypeScript strict · Postgres/Supabase + RLS · Drizzle ORM · Gemini · Meta Cloud API · Asaas · Vercel.

## Comece por aqui

- 📖 **Documentação (índice mestre):** [docs/index.md](./docs/index.md)
- 💻 **Rodar localmente:** [docs/development/setup.md](./docs/development/setup.md)
- 🧭 **Onboarding de dev (Dia 1/2/3):** [docs/development/onboarding.md](./docs/development/onboarding.md)
- 🏛️ **Arquitetura:** [docs/architecture/overview.md](./docs/architecture/overview.md) · [docs/architecture/context-map.md](./docs/architecture/context-map.md)
- 🛠️ **Como contribuir:** [docs/engineering/git-workflow.md](./docs/engineering/git-workflow.md)

## Gates principais

```bash
pnpm typecheck && pnpm lint && pnpm arch:check && pnpm test && pnpm build
```

CI: [.github/workflows/ci.yml](./.github/workflows/ci.yml). Convenções de commit/PR: [docs/engineering/git-workflow.md](./docs/engineering/git-workflow.md).

---

> Código e configuração definem a implementação; a documentação organiza sua memória. Toda mudança
> se documenta no lugar certo — ver [Documentação Automática](./docs/engineering/ai-development.md#documentação-automática).
