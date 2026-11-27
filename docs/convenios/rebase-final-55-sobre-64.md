# Rebase final do #55 sobre o #64 — roteiro reproduzível (26/11/2026)

**Ordem definitiva:** #64 (comercial: #53 + #56) é mergeado primeiro; depois o #55. Este roteiro **não** foi
executado contra o remoto: nada foi publicado e nenhum Actions rodou. Ele vem da composição local
`local/composicao-64-55`, que é o ensaio do mesmo resultado.

## Pré-condições

1. #64 mergeado na `main` com a 0168 promovida ao journal pelo dono.
2. Hotfix do Marco Civil já carregado pelo #53/#64 (`93eae727`/`89a7bc5d`); se não, o #55 já traz os 186 dias e
   o conflito em `retention-policy.ts` se resolve pela versão do #55 (mesmo valor, comentário mais completo).
3. Não usar o Next 16 experimental: o #55 entra sobre o candidato comercial validado.
4. **Atualização de 27/11:** o #64 continua em `92363ef1`, a base da composição verde #65 (`444c0103`). Se o #64
   mudar, refazer a composição sobre o SHA novo antes do rebase e rodar de novo os gates abaixo.
5. **PR #67** (outra frente, dependências da `main`, inclui Vitest 4 e `vitest.config.ts`): se entrar antes do #55,
   o rebase regenera o `pnpm-lock.yaml` a partir do `package.json` resolvido (não mesclar lockfile na mão) e roda a
   suíte inteira no Vitest 4. O piso de cobertura de branches dele (58%) vale também para o #55.
6. Os commits locais de 27/11 sobre o `37650d74` (S5: selagem das partições da 0171 e verificador do catálogo)
   entram no rebase junto com o resto. Eles ainda não têm CI oficial.

## Conflitos esperados (vistos na composição) e a resolução

| Arquivo | Resolução reproduzível |
| --- | --- |
| 6 arquivos de UI + `scripts/security/local-build.ts` | pela composição c11 (`2e8480f6`); o #64 não mudou esses arquivos além do que já vem do #56/#53 |
| `caixa-view.tsx` | versão do #64 (fuso da clínica) |
| `scripts/arch-db-check.ts` | união das listas de arquivos permitidos |
| `drizzle/migrations/meta/_journal.json` + `0159` | o journal da c11 (168 entradas; 0159 `eb00a4e3…`); depois a 0168 do #64 |
| `docs/security/acoes.md` | **gerado**: aceitar qualquer lado e rodar `inventory.ts --write` |
| testes S2 do `prontuario-editor.test.tsx` | passar `timeZone="America/Sao_Paulo"` (o #56 exige; correção `aed8f210` da composição) |
| shell, login e editor do #56 | **sem conflito**: o merge aplica S2 e R42 sozinho (`56-s2-r42-shell-login-editor.patch` é o mesmo resultado) |

## Gates depois do rebase (local primeiro, CI oficial só com autorização de custo)

- `pnpm install --frozen-lockfile` no worktree do rebase (nunca o `node_modules` de outra branch: foi a causa do
  typecheck "falho" da composição de 25/11);
- `ci.yml` local (`scripts/ci/run-workflow-local.mjs`), com `tar.exe` do Windows à frente no PATH quando rodar em
  Git Bash no Windows (o `release-archive` do #64 espera bsdtar no Windows);
- provas de banco: `convenios-synthetic-db.yml` e `-legacy.yml` locais, mais as candidatas 0169–0171
  (`manifesto-migrations-2026-11-26.md`);
- build com a adaptação local registrada (`evidence/local-2026-11-26/build-adaptacao-local.diff`) ou, sem
  adaptação, no runner Linux.

## O que só a CI oficial prova (quando o custo permitir)

Uma rodada do `ci.yml` no SHA final, as provas de banco no Linux (inclusive o corte real do R61-B, que não roda no
Windows) e o E2E autenticado no Preview (S2, P1.13, R42, P4.7). **OFFICIAL CI: NOT RUN — COST CONTROL.**
