# Inventário das worktrees locais do ciclo sem Actions (26/11/2026) e proposta de limpeza

Nenhuma worktree foi removida. Conferido por `git status`, `git branch --contains` e lista de processos; nenhum
outro agente local está ativo (`ListAgents`: nenhum). Todas usam `node_modules` por **junção** para outra pasta,
exceto a composição, que tem `node_modules` próprio instalado do lockfile dela (`pnpm install --frozen-lockfile`).

| Worktree | Branch local | SHA | Alterações não commitadas | Para que serve | `node_modules` |
| --- | --- | --- | --- | --- | --- |
| `C:/dev/wt64-comp` | `local/composicao-64-55` | `79ec69f4` (#64 `92363ef1` + #55 até `30b8625e`) | só o `local-build.adaptado-local.ts` temporário do build (apagado ao fim; o diff fica em `evidence/local-2026-11-26/build-adaptacao-local.diff`) | **base da integração final**: preservar | próprio (frozen lockfile) |
| `C:/dev/wt53-p0` | `local/hotfix-marco-civil-186` | `89a7bc5d` (#53 `1175b22c` + hotfix) | nenhuma | commit do hotfix para o #53 carregar | junção → `ClinicaOS_V2_pricing_depcheck_20261027` |
| `C:/dev/wt-mc-prod` | `local/hotfix-marco-civil-186-prod` | `93eae727` (`dddc650b` de Production + hotfix) | nenhuma | **o que vai para Production** (P0) | junção → mesma pasta |
| `C:/dev/wt-mc-main` | `local/hotfix-marco-civil-186-main` | `15980ef1` (main `5620a098` + hotfix) | nenhuma | só para a main futura; **não** é base de deploy | junção → mesma pasta |

Patches e evidências não estão só nas worktrees: os quatro commits estão em branches locais do repositório e os
patches ficam em `docs/convenios/patches/` do #55 (`hotfix-marco-civil-login-attempts-186-prod.patch`,
`hotfix-marco-civil-login-attempts-186.patch`, `56-s2-r42-shell-login-editor.patch`). As evidências estão em
`evidence/` do #55. No scratchpad da sessão ficam só ferramentas temporárias (`xmllint-full`, `shim-bsdtar`) e
cópias de scripts.

## Proposta de limpeza (executar só com a palavra do fundador)

| Worktree | Quando | Como | Risco | O que fica preservado |
| --- | --- | --- | --- | --- |
| `wt-mc-main` | já redundante (a main não é Production) | `cmd /c rmdir C:\dev\wt-mc-main\node_modules` (só a junção), depois `git worktree remove C:/dev/wt-mc-main` | baixo: a branch `local/hotfix-marco-civil-186-main` continua | branch e evidência `harness-main-15980ef1.txt` |
| `wt53-p0` | depois que o #53 carregar o hotfix | mesma sequência (junção primeiro, **nunca** `rm -rf`, que desce até o `node_modules` compartilhado) | baixo | branch `local/hotfix-marco-civil-186` |
| `wt-mc-prod` | depois do deploy de Production e do pós-voo de 01/12 | mesma sequência | baixo | branch `local/hotfix-marco-civil-186-prod` |
| `wt64-comp` | só depois do rebase final do #55 sobre o #64 mergeado | `git worktree remove C:/dev/wt64-comp` (o `node_modules` dela é próprio, sai com ela) | médio: é a base da integração; não remover antes | branch `local/composicao-64-55` |

Também redundante quando o #55 for mergeado: a worktree `.claude/worktrees/c11` (`integracao/c11-53-56-55`,
`fcddaad1`), que o fundador mandou manter até os merges.
