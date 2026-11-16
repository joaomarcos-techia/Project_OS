# Prompt de continuidade — Qoro, frente "Otimização UI final" (estado de 16/11/2026, ~03h)

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
   - bloco **ESTADO ATUAL DA EXECUÇÃO** (o item "FECHAMENTO DO CICLO 3" primeiro);
   - seção **00**: 00.1 ordem de leitura, 00.2 onde o trabalho vive, 00.3 ambiente local, 00.4 regras
     invioláveis, 00.5 segurança do ambiente;
   - seções **25.7, 25.9 e 25.10**: regressão do Caixa, ciclo 3, sondas no Preview;
   - **26** decisões, **27** registro do que foi feito, **28** pendências (P-15 a P-21);
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
   - evidências em `.tmp/ui-audit/evidence/2026-11-1{4,5}/`; o log da CI fica em `.tmp/ci/`.

## 3. Estado exato em que parou
- **Código:** igual ao `5462c209`. A última mudança de lógica é a do `2761563c`.
- **Commits desta frente sobre `e47ec2f0`:** veja o bloco de estado e a seção 27. Do ciclo 3:
  - `f5388ec9`: Caixa, chave por operação;
  - `f3fd8648`: textos de Equipe e LGPD;
  - `2761563c`: sessão morta vai para `/login` em 17 páginas;
  - `05e4378c`: token âmbar ≥ 4,5:1;
  - `464aa0ba`: inventário de segurança;
  - `5462c209`: "Criar conta" com 24 px e descrição de Documentos;
  - depois disso, só documento.
- **Validado:** `payout-review-preview` **13/13 no `2761563c`**, no Preview com banco DEV e Asaas
  sandbox. Sondas de navegador no `05e4378c` e no `a1d64d11`: Dashboard, Financeiro em 5 larguras,
  login, Documentos, Equipe e LGPD.
- **Bloqueados:** os 6 specs `production-*`, por política (Production NO-GO; só `--list`), e o
  `mutation-flows`, pela RAM local (< 1 GB livre).
- **P-21 corrigido localmente em 16/11** (ver o bloco de estado do documento): título da Ajuda atualizado ao UX-008 e descrição duplicada do PIN do WhatsApp corrigida na tela. Local: 62/62, ESLint 0, `tsc` 0. **A CI não roda desde o `63caefd1`**: o GitHub recusa iniciar jobs por cobrança da conta (P-22); só o fundador resolve.
- **Último resultado real da CI do #56, antes da correção: VERMELHA** (P-21).
  - Passaram auditoria, typecheck, lint, arquitetura, migrations, observabilidade e registry.
  - Falharam 2 de 6742 testes. São asserções desatualizadas por mudanças intencionais desta frente
    em 14/11:
    1. `src/app/(app)/(shell)/documentação/page.test.tsx:57` espera "… | Ajuda Qoro". A página dá
       "… · Ajuda" (UX-008, `5d04e48f`).
    2. `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.test.tsx:764` espera o
       `aria-describedby` do PIN só com `…-pin-help`. O `Field` agora liga também `…-pin-hint`
       (UX-001, `06af3f84`).
  - Inventário, isolamento de tenant, build e e2e público ficaram **pulados**, portanto sem evidência.
- **Outras frentes, com donos próprios. Não mexa nelas:**
  - #53 (AbacatePay) e #55 (TISS, outro agente ativo);
  - #57 e #58 (S-01, leitura de conversas pelo suporte);
  - #59 (trilha da plataforma append-only).
- **Ordem de integração proposta, que não é autorização de merge:** #53 → #56 → #55. O #58 vai depois
  do #56; o #59, depois de #53 → UI → #55.

## 4. Próximas ações, nesta ordem
1. **Conferir o terreno:**
   - `git -C C:\dev\Qoro_ui_otimizacao_final_20261114 status`, `log -5` e `fetch`; compare com o
     bloco de estado. Se o documento divergir do código, investigue e registre na seção 27.
   - CI do #56: `gh pr checks 56 --repo joaomarcos-techia/Project_OS`.
   - Memória livre da máquina.
   - Pergunte ao fundador se há janela de máquina reservada a outro agente (ele já reservou para o
     AbacatePay); nessa janela, nada pesado.
2. **P-21: já corrigido; falta a evidência da CI.** Quando a P-22 for resolvida, confirme que a CI do #56 rodou inteira e registre o resultado por SHA. Se ainda houver falha, o roteiro original vale:
   - Confirme a intenção:
     - o título sem "Qoro" segue `src/app/page-titles.test.ts`;
     - hint e ajuda do PIN têm textos diferentes; se forem iguais, o certo é corrigir o componente,
       não o teste.
   - Atualize **só** as duas expectativas, sem enfraquecer. Rode os dois arquivos com
     `npx vitest run <arquivos> --minWorkers=1 --maxWorkers=1`. Faça push e deixe a CI rodar inteira.
   - Registre o resultado **por SHA**, passo a passo, inclusive os passos que só então vão rodar.
     Se o inventário reprovar: `npx tsx scripts/security/inventory.ts --check`; revise o diff antes
     do `--write`, e nenhuma superfície pode ficar em `REVIEW_REQUIRED`.
3. **A-02** (gavetas e diálogos sem descrição, com `aria-describedby` pendurado):
   - Corrija só nos arquivos que nem o #53 nem o #55 alteram; confira com `git diff` contra os heads
     deles.
   - `new-appointment-drawer`, `prescription-drawer` e `fornecedores-view` ficam para depois da
     integração.
   - Para cada um: descrição curta e útil, ou `aria-describedby={undefined}`. Teste e confira no
     navegador.
4. **Login:** a sonda viu 2 pares de controles sobrepostos. Um é o botão "Mostrar senha", que fica
   dentro do campo de propósito; identifique o outro.
5. **Auditoria item a item de gavetas, diálogos e menus** (25.8), no Preview, em janela combinada.
   Verifique teclado, foco ao abrir e fechar, nome acessível, `Esc` e celular.
6. **UX-021** (cabeçalho no celular de Conversas e Documentos): prepare a proposta para decisão de
   design. Não implemente.
7. **Esperam decisão de outros. Não implemente sem autorização:**
   - S-02: middleware com 307 no POST de action;
   - P-19: duplicação de parcial depois de recarregar; contrato `valorPagoEsperado`, do domínio
     financeiro;
   - UX-020: coluna `source` nos pagamentos; sem migration e sem inferir o histórico;
   - P-13: credenciais live no checkout principal; proposta de pôr o bypass do Preview no
     `.env.local` deste worktree.
8. **Depois que o #53 entrar:**
   - rebase da UI, para os 3 commits dele saírem;
   - regenerar `docs/security/acoes.md`;
   - rodar os gates e o `payout-review` de novo;
   - coordenar o rebase do #55 com a resolução da seção 31.R. O único conflito com regra financeira
     é `financeiro/page.tsx`, onde fica a fórmula com `valorGlosado`.

Não reabra o que já está validado (UX-006, modelos de receita, nomes do Caixa) sem regressão comprovada.

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
- **Login no Preview e no DEV:** 10 por IP a cada 15 min, dividido com o TISS. Combine a janela por
  mensagem antes de cada rodada (`ListAgents` mostra a sessão do TISS). Avise quando terminar e
  espace as rodadas em 15 min. O `payout-review` gasta 5 logins.
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
- Em heredoc e `python -` chamados pela ferramenta, a barra invertida some. Use `os.sep`/`sep` ou o
  editor.
- O `/tmp` do Git Bash não é o `/tmp` do Python nativo. Use caminhos relativos ao worktree, como
  `.tmp/...`.
- O `git` mostra o caminho do documento com escapes (`"docs/otimiza\303\247..."`), por causa dos
  acentos.
- Preview de um SHA: `gh api repos/joaomarcos-techia/Project_OS/deployments?sha=<sha>` e depois os
  `statuses`. Depois disso, `npx tsx .tmp/ui-audit/runtime-proof.ts <url>` confirma Preview, banco
  DEV e Asaas sandbox sem gastar login.
