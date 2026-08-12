# C0 — Runbook de Validação

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> **Status: ✅ CONCLUÍDA em 2026-05-26.** Todos os checks marcados.
> Mantido como runbook re-executável — rode novamente após qualquer mudança estrutural na fundação (alteração em eslint/tsconfig/CI/env schema).

## Pré-requisitos

- [x] Node 20+ (`node -v`)
- [x] pnpm 11.17.0 (`pnpm -v`). Se faltar: `npm install -g pnpm@11.17.0`

## 0.1 — Setup base

- [x] `pnpm install` conclui em < 60s sem erros
- [x] `pnpm dev` sobe Next em < 5s
- [x] `http://localhost:3000/` mostra placeholder "ClinicaOS / Em construção (Camada 0)"
- [x] Console do navegador limpo (sem erros vermelhos)
- [x] `pnpm typecheck` → 0 erros
- [x] `pnpm build` → build válido (sem warnings críticos)

## 0.2 — Estrutura de pastas

- [x] `Get-ChildItem src/contexts -Directory` (PowerShell) ou `ls src/contexts` → 8 pastas exatas: identity, tenancy, patient, scheduling, clinical, financial, ai-agent, platform-admin
- [x] Cada `src/contexts/<X>/README.md` existe e tem responsabilidade clara em 1 frase
- [x] `Get-ChildItem src/lib` → env.ts + 7 subpastas (db, auth, outbox, audit, messaging, ai, pdf), cada uma com README dizendo "Cn preenche"
- [x] `src/app/(app)/`, `src/app/(admin)/`, `src/app/api/` existem com README placeholder
- [x] `src/components/ui/` e `src/components/shared/` existem (com .gitkeep)

## 0.3 — Env validation

- [x] `pnpm dev` sobe SEM `.env.local` (tudo opcional em C0)
- [x] Criar `.env.local` com `LOG_LEVEL=banana` → `pnpm build` falha com erro Zod legível mencionando `LOG_LEVEL`
- [x] Remover linha → volta a subir
- [x] `pnpm test src/lib/env.test.ts` → todos os testes passam
- [x] **TODO[C1] enforce check:** `Select-String -Path src/lib/env.ts -Pattern 'TODO\[C1\]'` retorna 4+ ocorrências (DATABASE_URL, DATABASE_URL_PROD, NEXT_PUBLIC_SUPABASE_*, etc)

## 0.4 — Boundaries lint

**4a. Cross-context import bloqueado:**
1. Criar `src/contexts/patient/_test-source.ts` com: `export const x = 1;`
2. Criar `src/contexts/financial/_test-consumer.ts` com: `import { x } from '@/contexts/patient/_test-source';`
3. `pnpm lint` → deve falhar com erro `boundaries/element-types`
4. Apagar os 2 arquivos

**4b. Circular dep bloqueada:**
1. Criar `src/lib/db/_a.ts`: `import './_b'; export const a = 1;`
2. Criar `src/lib/db/_b.ts`: `import './_a'; export const b = 2;`
3. `pnpm arch:check` → deve detectar circular
4. Apagar os 2 arquivos

**4c. console.log bloqueado em src/**:
1. Adicionar `console.log('foo')` em `src/app/page.tsx`
2. `pnpm lint` → erro `no-console`
3. Reverter

**4d. Lib não importa de context (regra defensiva):**
1. Em `src/lib/db/_test.ts`: `import x from '@/contexts/patient/README.md';` (qualquer import de context)
2. `pnpm lint` → erro boundaries (lib só importa de lib)
3. Apagar

## 0.5 — ADRs

- [x] `Get-ChildItem docs/adr` → 6 arquivos: 000-template.md + 001..005
- [x] Cada ADR tem as 5 seções: Status, Context/Date, Decision, Consequences, Alternatives
- [x] `Select-String -Path docs/adr/*.md -Pattern 'TBD|Status:\s*proposed|Status:\s*draft'` → vazio
- [x] ADR-001 referencia ADR-002 e ADR-003 na seção References

## 0.6 — Conventions

- [x] `docs/CONVENTIONS.md` existe
- [x] Tabela de naming bate com tsconfig.json (`paths: { "@/*": ["./src/*"] }`)
- [x] Matriz de imports do CONVENTIONS bate com regras em `eslint.config.mjs`

## 0.7 — CI

- [x] `.github/workflows/ci.yml` existe
- [x] Sintaxe YAML válida (abrir em editor ou rodar `Get-Content .github/workflows/ci.yml | ConvertFrom-Yaml` se yamllint disponível)
- [x] (Após `git init` + push) GitHub Action roda em < 3 min e passa em todos os jobs

## Gate final — pode avançar para C1?

Avança SE:
- [x] Todos os checks acima estão marcados
- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm arch:check && pnpm test && pnpm build` roda do zero sem erro
- [x] Você consegue, em 10 min, mostrar para alguém: setup, scripts, CI, e a pasta de contextos

NÃO avança se:
- [x] Algum teste de boundaries (0.4) deixou passar import que deveria bloquear
- [x] Existe `console.log` em `src/` que escapou
- [x] Algum ADR tem TBD ou Status diferente de `accepted`
- [x] Você está com vontade de "fazer só esse refactorzinho na estrutura" antes de C1 — sinal de que C0 não fechou
