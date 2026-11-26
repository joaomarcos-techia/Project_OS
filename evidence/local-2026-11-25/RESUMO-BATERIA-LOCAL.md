# Bateria local do #55 — sem GitHub Actions (25–26/11/2026)

**Máquina:** Windows 11, 7,7 GB de RAM, Node 22.23.4, PostgreSQL 17 local (descartável por harness), Chromium do
Playwright 1248. **SHA:** `ae49a69c` (gates) e `c8935bc5` (inventário regenerado + harnesses novos). Executor:
`scripts/ci/run-workflow-local.mjs` (lê o próprio YAML dos workflows). **Nenhum run de Actions disparado.**

## `ci.yml`

| Passo | Resultado | Duração | Observação |
| --- | --- | --- | --- |
| Auditoria de dependências (prod, high+) | PASS | 3 s | |
| Typecheck (repositório inteiro) | PASS | 72 s | |
| Lint (`eslint .`) | PASS | 82 s | |
| madge (ciclos) | PASS | 19 s | |
| Arch DB check | PASS | 7 s | |
| Migrations (anti-destrutivo) | PASS | 2 s | |
| Observabilidade | PASS | 2 s | |
| Registro de handlers | PASS | 10 s | |
| **Suíte completa com cobertura** | **PASS** | 377 s | com `TISS_XMLLINT_WASM_DIR` (pacote isolado 5.3.0, integridade = lockfile) |
| Inventário de segurança | PASS no `c8935bc5` | — | no `ae49a69c` estava desatualizado (process.env de 2 harnesses novos): regenerado |
| Isolamento de duas clínicas (Postgres local) | PASS | 10 s | |
| Isolamento de todas as tabelas do Convênios | PASS | 7 s | |
| Build de produção | PASS | 1.842 s | adaptação LOCAL não versionada: heap de 6 GB e CA do sistema (Avast intercepta TLS das fontes); allowlist de ambiente sem segredo, igual |
| Segredos no bundle | PASS | 17 s | `failures: []` |
| Fronteiras HTTP locais | PARTIAL | — | 1ª requisição depois do `next start` leva ~27 s aqui (limite do script: 15 s); com aquecimento local, as fronteiras passam até o autoteste do `/api/health/tiss-xsd`, que falha por ambiente: o `node_modules` compartilhado desta máquina não tem o `xmllint-wasm` (o build de produção ignora a pasta isolada). O motor está coberto pelos 524 testes TISS |
| E2E público (Playwright, `playwright.ci.config.ts`) | PASS | 71 s | 8 PASS, 2 SKIP condicionais (sem chave do Turnstile neste ambiente, como no desenho do spec) |

## Provas de banco

| Workflow | Resultado |
| --- | --- |
| `convenios-synthetic-db.yml` | 23/24 PASS; o 24º (R61-B, corte real aos 60 s) chama `node_modules/.bin/tsx` (atalho de Unix): provas 1 e 2 passaram, a 3 não roda no Windows (NOT RUN local; passou no runner Linux em ciclos anteriores) |
| `convenios-synthetic-db-legacy.yml` | todos PASS até a P15.6 (pré-auditoria, 141 s); a B6 rodou à parte: 5/5 |
| Harnesses novos deste ciclo | P0 + R42 5/5; P4.7-b 8/8; S4 6/6; S5 6/6 |

## XML/XSD (B7)

libxml2 38/38 (c1) e 14/14 (c2); .NET 38/38; Voa `--check` igual ao gravado; reprodução do falso positivo
confirmada (`b7/`).

## O que exige a CI oficial (quando o custo permitir)

Uma execução do `ci.yml` no SHA final do rebase (#53 → #56 → #55), as provas de banco no runner Linux (inclusive o
corte real do R61-B) e o autoteste do XSD no build com `pnpm install` completo.

## Composição local (#64 `92363ef1` = #53 + #56, + #55 `ae49a69c`) — commit LOCAL `aeda1e46`, não publicado

Executada em `C:/dev/wt64-comp` com o `node_modules` compartilhado desta máquina (`composicao/`).

| Passo | Resultado | Observação |
| --- | --- | --- |
| Lint, madge, arch DB, migrations, observabilidade, registro, inventário | PASS | |
| Isolamento de duas clínicas e do Convênios (Postgres local) | PASS | |
| Typecheck | FAIL (ambiente) | todos os 19 erros em `src/components/painel/rail-animations.tsx`: `react-useanimations` (dependência do #56) não está no `node_modules` compartilhado; nenhum erro em TISS, auth ou agenda |
| Suíte completa | 9.116 PASS, 1 FAIL, 3 SKIP (3 arquivos) | todos de ambiente: `painel-shell.test.tsx` (mesma dependência ausente), `gate-b-gpg-real.test.ts` (socket do gpg-agent no Windows), `release-archive.test.ts` (o `tar` do Git Bash não tem `--options`) |

Conclusão: a composição não introduz falha de código detectável localmente. Os 3 pontos só se resolvem com
`pnpm install` completo no runner Linux (CI oficial), que fica para quando o custo permitir.
