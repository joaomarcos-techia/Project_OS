# Prompt de continuidade — Qoro, frente "Otimização UI final" (estado de 19/11/2026, ciclo 6: P-28 corrigido, e2e oficial e sidebar)

> Cole este texto, inteiro, numa sessão nova de IA com acesso ao repositório e à máquina do
> fundador. Ele foi escrito para que quem o leia continue exatamente do ponto em que a frente parou.

---

Você vai continuar a frente **"Otimização UI final"** do **Qoro** (SaaS de gestão de clínicas
médicas; nome interno ClinicaOS). Responda **sempre em português do Brasil**; identificadores de
código ficam como estão. O fundador é quem decide política, merge e Production.

## 1. Onde o trabalho vive
- Repositório: `joaomarcos-techia/Project_OS`.
- Worktree desta frente: `C:\dev\Qoro_ui_otimizacao_final_20261114`. Trabalhe só nele. **Não toque** no
  checkout principal `C:\dev\ClinicaOS_V2` (tem alterações não commitadas de outra época) nem em
  worktrees de outros agentes.
- Branch: `ui/otimizacao-ui-final-20261114`. Base `e47ec2f0`, que é o redesign "Qoro App v5"
  (`ui/refactor-qoro-20261108`).
- PR desta frente: **#56, draft, só para a CI oficial. NÃO FAZER MERGE.** Ele leva 3 commits do PR #53
  (billing AbacatePay; um deles traz a migration 0136).
- Fonte de verdade: **`docs/otimização_ui_final.md`** no worktree, a começar pelo bloco
  "ESTADO ATUAL DA EXECUÇÃO".

## 2. Leia nesta ordem antes de qualquer ação
1. `docs/otimização_ui_final.md`:
   - bloco **ESTADO ATUAL DA EXECUÇÃO** (o item "CICLO 6 (18–19/11/2026)" primeiro, depois o 5);
   - seção **00**: 00.1 ordem de leitura, 00.2 onde o trabalho vive, 00.3 ambiente local, 00.4 regras
     invioláveis, 00.5 segurança do ambiente;
   - seções **25.7, 25.9, 25.10 e 25.11**: regressão do Caixa, ciclo 3, sondas no Preview e a
     rodada de validação do ciclo 4 (varredura, desempenho, #418, triagem de alvos);
   - **26** decisões, **27** registro do que foi feito, **28** pendências (P-15 a P-24, com as
     linhas "status 17/11");
   - **31.R** (coordenação e conflitos com o TISS, 8 arquivos), **32** (AbacatePay e ordem de
     integração), **33** (achados de plataforma, segurança e acessibilidade: S-01, S-02, S-03, A-01,
     A-02, P-13, P-20).
2. Memória do projeto, em `C:\Users\joaom\.claude\projects\C--dev-ClinicaOS-V2\memory\`:
   - `qoro-otimizacao-ui-final.md`: como validar Preview, limites e armadilhas desta frente;
   - `s01-conversas-ia-admin.md` (PRs #57 e #58) e `trilha-plataforma-append-only.md` (PR #59);
   - `convenios-tiss-plano.md` (PR #55);
   - `preview-only-writes.md`, `dev-compartilhado-sem-ensaio-ddl.md`,
     `pnpm-run-purga-node-modules-em-worktree.md`, `ci-gates-rodar-local-antes-do-push.md`,
     `gate-exit-codes-nao-encadear.md`, `dev-local-avast-turbopack-sentry.md`.
3. `docs/design/CONTRACT.md` e `docs/design/COMPONENT-DECISIONS.md`: contrato visual e decisões que
   não se revertem.
4. Código citado na pendência que você for atacar. Em especial:
   - Caixa: `src/app/(app)/(shell)/caixa/caixa-view.tsx`, a função `run`, com chave de idempotência
     por operação, e `caixa-view.test.tsx`, bloco "idempotência do registro";
   - guarda de página: `src/lib/auth/page-guard.ts` (`requirePageUser`) e `page-guard.test.ts`, que
     tem um contrato estático;
   - tokens: `src/app/globals.css` e o contrato `src/app/contrast-tokens.test.ts`.
5. Ferramentas locais, fora do Git, em `.tmp/ui-audit/`:
   - `runtime-proof.ts`: prova assinada do Preview, sem login;
   - `run-payout-review.sh <url> <rótulo>`: e2e de repasses no Preview, 1 worker, 5 logins;
   - `ciclo3-probe.ts` e `final-probe.ts`: sondas de 1 login;
   - ciclo 4: `sweep-preview.ts` (39 rotas × 5 larguras), `perf-hydration-probe.ts`,
     `sidebar-probe.ts`, `doc418-probe.ts`, `doc418-fresh.ts`, `toolbar-check.ts`, `rodada-17nov.sh`;
   - evidências em `.tmp/ui-audit/evidence/2026-11-1{4,5,7}/`; o log da CI fica em `.tmp/ci/`.

## 3. Estado exato em que parou
- **Código:** igual ao `d9770192`. Ciclo 6:
  - `6e157eaa`: P-28 (confirmação administrativa antes da prova de recovery);
  - `46b7a689`: primeira mensalidade pela regra do servidor, estados "processando" e "recusado";
  - `58e0e6a5` e `d9770192`: respiro da sidebar e contorno da série muted (P-26).

  Sobre o ciclo 5 (`8cc52dad`). Depois disso, só documento.
- **Ferramentas do ciclo 6** (`.tmp/`, fora do Git):
  - `ui-audit/ui-fixture.ts create|cleanup`: conta sintética de UI no DEV, que substitui a `2E2_UI`;
  - `ui-audit/sidebar-rhythm.ts`: ritmo da sidebar em 11 viewports;
  - `e2e-diag/`: cópia diagnóstica do spec do cadastro;
  - `harness-charts/`: gráficos nos dois temas;
  - `ui-audit/run-signup-*.ts`: testes oficiais isolados, porque o spec é serial e para na primeira falha.
- **Ciclo 5 (18/11):** a referência é a prancha "Cadastro · 3. Checkout" do artefato do Claude Design (seção 25.12). Ferramentas em `.tmp/` (fora do Git): `harness/` (bancada com o componente e o CSS reais: `node .tmp/harness/build.mjs` e `npx tsx .tmp/harness/shot.ts <rótulo> <cenários>`), `e2e-visual/` (cópia local do `@code-flow` com capturas) e `ui-audit/run-signup-code-flow.ts` (e2e oficial com as travas do runner; lê só os `*_DEV` do checkout principal, como o fundador autorizou em 18/11).
- **Em aberto (ciclo 6):**
  - P-29: fluxos de confirmação pelo link falham desde antes do ciclo; dono do cadastro;
  - P-27: restaurar a `2E2_UI` exige coordenação com o #53;
  - checkout incorporado: decisão do fundador (seção 32);
  - P-28: levar a correção ao #53 e à `main`.
- **Commits do ciclo 4** (todos no PR #56; detalhes no bloco de estado e na seção 27):
  - `c9098ad8`: A-02, descrição nas 8 gavetas e diálogos;
  - `8f73258a`: P-19, chave do Caixa sobrevive ao reload da aba;
  - `6173fbea`: P-11, leituras do shell em paralelo e trial memoizado por requisição;
  - `046f7fa6`: UX-021, ações do cabeçalho na linha do título no celular, e texto de Documentos;
  - `82f98aab`: S-02, action sem sessão recebe 401 com `x-action-redirect`;
  - `2821e059`: chave do consentimento nasce no envio; migalhas, card do Dashboard, Repasses e
    lista de espera com alvo de 24 px;
  - `a2af7bbf`: navegação de mês dos Repasses quebra linha a 320 px;
  - `d91c439f`: foco volta a quem abriu o diálogo ou a gaveta (`useFocusReturn` em
    `components/ui/dialog.tsx`; `returnFocusRef` para item de menu).
- **CI:** verde no `cc1f1f1c` e no `82f98aab` (run `44114727352`), o último verde completo. Do `abcbef5f` em diante, reprovada no gate de auditoria por advisory externa sem correção (P-25; decisão do fundador). O resultado do HEAD final fica
  registrado no corpo do PR #56; confira com `gh pr checks 56` antes de afirmar qualquer coisa.
- **Validado no Preview `82f98aab`** (25.11): prova assinada, S-02 ao vivo (401), desempenho sem
  regressão e 0 referência ARIA quebrada, sidebar sem mudança necessária, varredura de 195 medições
  sem rolagem lateral nem controle sem nome, `payout-review` 13/13.
- **Em aberto desta frente:**
  - P-23: #418 intermitente (2 em 195 na varredura, 0 em 24 repetições), no R51; não suprimir;
  - P-24: "Entrar" do `/cadastro` com 23 px, depois da integração com o #53;
  - P-19, resto: outra aba ou outro aparelho exige `valorPagoEsperado` (domínio financeiro);
  - P-20: latência de Server Action no Preview (logs da Vercel/Supabase).
  - **P-25:** exceção temporária da GHSA-fc5q-39xc-vjpf (`picomatch` ≤ 4.0.7, sem versão
    corrigida em 17/11), aprovada pelo fundador e aplicada no `8d328fec` (igual ao `7e74f0cb` do #55).
    Quando sair o `picomatch` corrigido: tirar o `auditConfig` e fixar a versão em `overrides`, nos
    dois PRs.
- **Bloqueados:** os specs `production-*`, por política (Production NO-GO; só `--list`).
- **Integração** (heads de 17/11): UI × TISS `087380af` = 9 arquivos em conflito; UI × #53
  `bd776c15` = 7. Resolução na 31.R e na 32; a fórmula `l.valor - l.valorPago - l.valorGlosado`
  do TISS prevalece em `financeiro/page.tsx`.
- **Outras frentes, com donos próprios. Não mexa nelas:**
  - #53 (AbacatePay) e #55 (TISS, outro agente ativo);
  - #57 e #58 (S-01, leitura de conversas pelo suporte);
  - #59 (trilha da plataforma append-only).
- **Ordem de integração proposta, que não é autorização de merge:** #53 → #56 → #55. O #58 vai depois
  do #56; o #59, depois de #53 → UI → #55.

## 4. Próximas ações, nesta ordem
1. **Conferir o terreno:** `git status`, `log -8` e `fetch` no worktree; `gh pr checks 56`;
   memória livre da máquina. Se o documento divergir do código, investigue e registre na seção 27.
2. **Se a CI do HEAD não estiver verde:** leia o log do passo que falhou, corrija a causa (sem
   enfraquecer teste) e registre por SHA.
3. **P-23 (#418):** só reabrir com ocorrência nova e reproduzível. Se aparecer, rode
   `doc418-fresh.ts <preview> <rótulo> <rota> <n>` (com `MSYS_NO_PATHCONV=1`) na rota e procure
   componente de cliente com `window`, data ou acaso no render.
4. **Depois que o #53 entrar:**
   - rebase da UI, para os 3 commits dele saírem;
   - P-24 no `signup-frame`;
   - regenerar `docs/security/acoes.md`;
   - rodar os gates e o `payout-review` de novo;
   - coordenar o rebase do #55 com a resolução da seção 31.R.
5. **Esperam decisão de outros. Não implemente sem autorização:** P-19 (resto, contrato de
   servidor), UX-020 (coluna `source`), P-13 (bypass no `.env.local` deste worktree), política do
   S-01 (frente própria).

Não reabra o que já está validado (UX-006, modelos de receita, nomes do Caixa, A-02, S-02, sidebar)
sem regressão comprovada.

## 5. Regras invioláveis
- **Production NO-GO.** Escreva só no DEV ou no Preview, com dados sintéticos.
  - Nunca use credenciais live nem `E2E_TESTE_PROD_*`.
  - Nunca acesse o banco de Production.
  - Nunca rode os specs `production-*`; só `--list`.
- Não imprima segredos nem os copie para arquivos ou logs. O bypass do Preview
  (`VERCEL_AUTOMATION_BYPASS_SECRET`) existe só em `C:\dev\ClinicaOS_V2\.env.local` e é lido dentro
  do processo, como fazem os scripts de `.tmp/ui-audit/`. As contas de teste (`2E2_UI_*`) estão no
  `.env.local` do worktree.
- Não faça:
  - merge nem deploy;
  - push na `main`;
  - mudanças nos PRs #53, #55, #57, #58 e #59;
  - migrations, nem no DEV sem autorização específica;
  - mudança de contrato financeiro, de permissão ou de RLS;
  - desligar TLS;
  - contornar o rate limit;
  - desabilitar, pular ou enfraquecer teste.
- **Caixa:** preserve o invariante "a chave pertence à operação e só o sucesso a encerra". Sem
  resposta, a tela não afirma falha.
- Não altere `caixa-types.ts` (arquivo do billing). Um comentário com o nome antigo do botão ali fica
  para quem integrar.
- **Máquina com pouca RAM** (0,5–0,8 GB livres):
  - nada de `next dev` ou build local;
  - Vitest sempre com `--minWorkers=1 --maxWorkers=1`;
  - `npx`/`node` direto, porque `pnpm <script>` no worktree tenta apagar o `node_modules`
    compartilhado.
- **Login no Preview e no DEV:** 10 por IP a cada 15 min. Desde o ciclo 4 o TISS roda os e2e nos
  runners do GitHub, então o limite deste IP não é mais dividido; mesmo assim, espace as rodadas e
  prefira sondas de 1 login. O `payout-review` gasta 5 logins.
- **Push no #56 cancela a CI em andamento.** Não publique enquanto uma CI útil estiver rodando.
- **Commits:** em inglês, curtos, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ao fim de cada unidade de trabalho, atualize as seções 27 e 28 e o bloco de estado do documento.
  Reporte ao fundador com evidência por SHA: o que foi executado, passou, falhou e ficou bloqueado,
  com a causa de cada falha. Nunca diga "verde" por jobs parciais nem dê como aprovado o que não rodou.

## 6. Armadilhas já pagas
- Uma Server Action no Preview pode levar mais de 10 s. Teste que falha por tempo com a ação concluída
  depois é latência, não regressão: confira no trace (`N-trace.network`, corpo `1:{"ok":...}`) antes
  de classificar. Não aumente o timeout sem evidência.
- Com menu Radix aberto, o resto da página fica `aria-hidden` e o `getByRole` deixa de achar o
  gatilho. Meça antes de abrir. Grave o JSON da sonda mesmo quando uma etapa falhar.
- Em heredoc e `python -` chamados pela ferramenta, a barra invertida some, e heredocs longos com
  aspas podem quebrar no shell. Escreva o script num arquivo (scratchpad) e rode de lá.
- O Git Bash converte argumentos que começam com `/` em caminho do Windows (`/documentos` vira
  `C:/Program Files/Git/documentos`). Rode sondas com rota no argumento com `MSYS_NO_PATHCONV=1`.
- O `/tmp` do Git Bash não é o `/tmp` do Python nativo. Use caminhos relativos ao worktree, como
  `.tmp/...`.
- O `git` mostra o caminho do documento com escapes (`"docs/otimiza\303\247..."`), por causa dos
  acentos.
- Preview de um SHA: `gh api repos/joaomarcos-techia/Project_OS/deployments?sha=<sha>` e depois os
  `statuses`. Depois disso, `npx tsx .tmp/ui-audit/runtime-proof.ts <url>` confirma Preview, banco
  DEV e Asaas sandbox sem gastar login.
