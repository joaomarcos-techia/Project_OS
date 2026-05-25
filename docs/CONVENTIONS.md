# Convenções ClinicaOS

Este documento é a lei viva do projeto. Edita junto com o PR que muda a convenção. Não decide caso novo aqui — vira ADR primeiro, depois rebaixa o resumo aqui.

## Naming (congelado em C0)

| Camada | Convenção | Exemplo |
|---|---|---|
| Arquivos | `kebab-case` | `tenant-context.ts`, `agent-config.ts` |
| Pastas | `kebab-case` | `src/contexts/ai-agent/` |
| Identificadores TS | `camelCase` | `clinicId`, `createdAt` |
| Tipos / Componentes | `PascalCase` | `CreatePatientRequest`, `PatientCard` |
| Constantes env | `SCREAMING_SNAKE` | `DATABASE_URL`, `LOG_LEVEL` |
| Tabelas DB | `snake_case` plural | `patients`, `appointments`, `outbox_events` (decisão C1) |
| Colunas DB | `snake_case` | `clinic_id`, `created_at`, `deleted_at` |
| Foreign keys | `<entity>_id` | `patient_id`, `clinic_id` |
| Server Actions | verbo no início | `createPatient`, `confirmPayment` |
| DTOs | sufixo `Request`/`Response` | `CreatePatientRequest`, `PatientResponse` |
| Eventos outbox | `<entity>.<verb>` lowercase | `patient.created`, `appointment.completed` |

Drizzle converte `snake_case` ↔ `camelCase` automaticamente entre DB e TS.

## Imports e path aliases

- **Path alias `@/*` → `src/*`** sempre. Proibido `../../../foo` (lint: `import/no-relative-parent-imports` em arquivos `src/contexts/`).
- **Matriz de imports** (enforced por `eslint-plugin-boundaries` em `eslint.config.mjs`):

| FROM \ TO | context | lib | app | component |
|---|---|---|---|---|
| **context** | ❌ | ✅ | ❌ | ❌ |
| **lib** | ❌ | ✅ | ❌ | ❌ |
| **app** | ✅ | ✅ | ✅ | ✅ |
| **component** | ❌ | ✅ | ❌ | ✅ |

- **Cross-context** será permitido SOMENTE via `@/contexts/<X>` (resolvendo no `index.ts` do contexto) e somente para chamadas explícitas em `api.ts` ou tipos de evento em `events.ts`. Estrutura definitiva entra quando o primeiro contexto materializar (C2 com tenancy).
- **`internal/`** (futuro): tudo dentro de `src/contexts/<X>/internal/` é privado ao contexto. Override de boundary precisa de `// eslint-disable-next-line boundaries/element-types -- <razão>` com motivo escrito.

## Estrutura de pasta de um contexto (definida quando o primeiro contexto for materializado em C2)

Placeholder esperado:
```
src/contexts/<name>/
├── README.md          # responsabilidade
├── index.ts           # re-export de api.ts e events.ts (superfície pública)
├── api.ts             # funções tipadas que outros contexts chamam
├── events.ts          # tipos de eventos emitidos (schemas Zod)
├── types.ts           # DTOs públicos
├── schema.ts          # schema Drizzle (re-export central em src/lib/db/schema/)
└── internal/          # tudo privado: services, repos, handlers, use-cases
```

Hoje (C0) só existe `README.md`. Resto entra com a primeira camada do contexto.

## Convenções "a definir" (com camada de origem)

| Convenção | Camada que define | O que será |
|---|---|---|
| Schema DB (tipos, defaults, índices) | C1 | Drizzle schema, helpers de RLS, `withTenant` |
| RLS policies | C2 | Helper `defaultTenantPolicy(tableName)` |
| Custom claims JWT, Roles | C3 | Auth hook Supabase, `requireClinicId()` |
| Outbox eventos cross-context | C4 | `emitEvent(tx, ...)`, schemas Zod por evento |
| Audit log | C4 | `auditLog(tx, ...)` síncrono na mesma TX |
| Idempotency keys | C4 | Header `idempotency-key`, tabela `idempotency_keys` |
| Encryption per-tenant (dados de paciente) | C5 | KMS key por clínica |
| Server Actions error handling | C5+ | Padrão `Result<T> = {ok,data} \| {ok:false,code,message}` |
| Erros tipados (AppError hierarchy) | quando 2º consumidor real aparecer (PlanoAção 1.4) | Hierarquia de classes |
| Logger estruturado (Pino + correlation) | C16 | Structured JSON logs com `req_id`, `clinic_id`, `user_id` |

## Comentários e documentação no código

- Default: **NÃO escreva comentários.** Bom naming substitui.
- Escreva quando: WHY não-óbvio (invariante escondida, workaround de bug específico, restrição externa).
- Nunca: explicar O QUE (já está no código), referenciar PR/issue (vive no git), declarar "TODO: refatorar depois" (PlanoAção 1.5: 3 TODOs na semana = pare e refatore).

## Testes

- Vitest unit, co-localizado: `foo.ts` + `foo.test.ts` lado a lado.
- Integration tests **não mockam DB** (PlanoAção). Rodam contra `qoro-dev`.
- E2E: só em C16, se necessário. MVP solo founder não justifica antes.

## Anti-padrões proibidos (sinais de hidra)

- 🚫 `src/lib/utils.ts` genérico — vira lixeira inevitavelmente. Use `src/lib/<topic>/`.
- 🚫 `src/types/index.ts` central — tipos vivem perto do código que os usa.
- 🚫 `JOIN` SQL cross-context.
- 🚫 `console.log` em código de produção (lint: `no-console` exceto `warn`/`error`).
- 🚫 `import { X } from '@/contexts/other/internal/...'` — lint barra.
- 🚫 Versão `^` em libs críticas (Next, React, Drizzle, Supabase) — fixar exato.
- 🚫 Comentário "TODO refatorar" sem data ou contexto. Se for premissa pra camada futura, escreva `TODO[Cn]: ...`.
