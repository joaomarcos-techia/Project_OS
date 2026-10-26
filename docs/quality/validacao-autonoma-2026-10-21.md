# Validação autônoma do candidato da nova oferta — 21/10/2026

**Checkpoint mais recente (25–26/10):** [prontidão da oferta, evidência externa da landing e inventário de integrações](prontidao-oferta-2026-10-25.md). A landing corrigida passou 4/4 no deployment imutável `fa8b67c`, enquanto `qoro.dev` continua com promessa incompatível; os estados abaixo são históricos conforme a data de cada prova.

**Checkpoint independente de 24/10 (prevalece sobre a fotografia inicial abaixo):** `HEAD inicial=c37820ce`, worktree limpo; [PR do app #42](https://github.com/joaomarcos-techia/Project_OS/pull/42) draft, aberto, mergeable e com Vercel/Snyk/Semgrep aprovados. O grafo confirma que os commits do [PR #41](https://github.com/joaomarcos-techia/Project_OS/pull/41) estão incorporados ao #42, mas #39, #40 e #41 continuam abertos; não há rollout do novo checkout na `main` do app. A [landing em produção](https://qoro.dev/precos) respondeu HTTP 200 e já anuncia Consultório R$ 197, Clínica R$ 397, até **10 profissionais** e **equipe ilimitada** (também em `C:\dev\qoro\src\data\planos.ts:79,126`). O app em `origin/main` ainda tem apenas `solo` R$ 149, `clinica` R$ 349 e `pro` R$ 699 (`scripts/seed-plans.ts:15-26`) e cadastro autônomo de **7 dias** (`src/contexts/onboarding/trial.ts:5`). O candidato do #42 limita Clínica a **5 médicos e 3 logins de equipe** (`src/contexts/billing/proposed-offer.ts`, [spec](../specs/precos-2026-preview.md)); portanto nem mesmo publicar o candidato como está reconciliaria a promessa da landing. O [PR da landing #1](https://github.com/joaomarcos-techia/landing_page/pull/1) está `CONFLICTING` porque sua simulação antiga foi superada pela `main` da landing; não é o alvo correto para a conferência visual. **FAIL de consistência comercial entre produção e candidato**, medido; não atribuir PASS de prontidão aos checks verdes dos PRs. Não houve alteração de produção nesta verificação. Inspeção visual em navegador permanece BLOCKED: a superfície de automação retornou zero navegadores/apps disponíveis. O fluxo anual pago e seus limites seguem no checkpoint de 23/10 ao fim deste relatório.

**Correção preparada, ainda sem rollout:** [PR draft da landing #3](https://github.com/joaomarcos-techia/landing_page/pull/3), commits `1158ab4` e `faf838e`, alinha **5 médicos/3 logins** e prepara **14 dias desde a criação da conta** em home, preços, páginas verticais, blog, metadados, `llms.txt` e imagem social. O PNG foi regenerado e inspecionado; saíram dele números de clínicas/NPS sem prova neste repositório. `npm run typecheck`, `npm run lint` e `npm run build` saíram com código 0; o build incluiu `/comecar` 27/27, conversão 2/2 e 20 checks de segurança. O HTML gerado em `dist/precos/index.html` contém limites e trial novos e não contém as frases antigas. O PR está draft e **não altera `qoro.dev`**. O CTA da landing pública ainda conduz ao checkout legado; a publicação exige alinhamento do app, migrações e contrato.

**Candidato:** `integration/pricing-plan-sync-20261018`, HEAD inicial `303c1de4`, Draft PR #42 sobre `preview/payment-settings-pricing-20261015` (a base do PR ainda não é `main`). **Alvos:** build Next isolado em Windows/Node 22; Preview do app em `project-os-git-integration-prici-c5e6c6-clinic-os-v2-s-projects.vercel.app`; PostgreSQL/Auth do projeto DEV. Não houve escrita em produção, merge, migration, novo Checkout, envio de mensagem nem cobrança nesta rodada. Os dois Checkouts Sandbox pagos e seus readbacks estão registrados no [§71](../qorov2.md); não foram repetidos aqui.

`PASS` abaixo significa execução e asserção nesta rodada. `SKIP` é condicional declarado pela suíte; `NOT RUN` não recebe resultado funcional. Comandos externos foram executados com variáveis carregadas somente no processo, sem registrar seus valores. Os artefatos autenticados do Playwright ficaram desativados (`E2E_ARTIFACTS=0`). Os códigos de saída foram capturados antes de qualquer filtragem.

| Área / cenário | Estado | Evidência e limite |
| --- | --- | --- |
| Regressão unitária e de integração | **PASS** | `npx vitest run --reporter=dot --silent`: **5.584/5.584** em 531 arquivos no primeiro checkpoint; após as duas correções de tour, **5.589/5.589** em 531 arquivos, exit 0. Não substitui provider nem navegador externo. |
| Tipos, lint e formatação | **PASS** | `npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos alterados e `git diff --check`: exit 0. O lint integral e o Prettier foram repetidos após o ajuste final do gate HttpOnly. |
| Build Next otimizado | **PASS** | `npx tsx scripts/security/local-build.ts`: exit 0, Next 15.5.24, 19 páginas estáticas. Usa ambiente sintético; não é um deploy. |
| Migrações e arquitetura de banco | **PASS** | `npx tsx scripts/check-migration-safety.ts`: exit 0, 3 migrations destrutivas com aprovação histórica registrada; `npx tsx scripts/arch-db-check.ts`: 1.534 arquivos, zero achado, exit 0. Não aplicou migrations. |
| Observabilidade | **PASS** | `npx tsx scripts/check-observability-drift.ts`: 21 crons e 12 eventos de busca salva coerentes, exit 0. |
| Inventário de Server Actions e rotas | **PASS após correção de drift** | `npx tsx scripts/security/inventory.ts --check` falhou porque `docs/security/acoes.md` estava desatualizado. O `--write` regenerou somente linhas/contagens; novo `--check` exit 0, sem guarda ausente ou regressão de rota. |
| Isolamento tenant em banco | **PASS** | `npx tsx --conditions=react-server scripts/security/tenant-isolation.ts`: leituras/escritas/deletes A→B e B→A negadas, controle próprio aceito e fixture removida, exit 0. |
| Sessão HttpOnly no Chromium, build produção isolado | **PASS após correção do harness** | `npx playwright test --config=playwright.httponly.config.ts`: **7/7**, exit 0. Cobriu cookie legado, OTP server-side, rotação, refresh concorrente e inspeção de bearer em browser. O primeiro run teve 4 PASS/3 FAIL porque o harness servia HTTP com `APP_BASE_URL` de produção; o intermediário teve 5 PASS/2 FAIL por redirecionamento do Next à porta interna. O harness agora usa TLS local em memória e reescreve apenas esse `Location` interno. A proteção HTTPS do app não foi relaxada. |
| Gate HTTP das Server Actions | **PASS** | `npx tsx scripts/security/local-http.ts`: exit 0, 12 vetores de health, 174 actions, 348 requests, CSP aplicada e CSRF nativo recusado. As 64 negativas com HTTP 200 foram identificadas como envelopes de erro do React, não aceitas pelo código de status apenas. |
| Bundle cliente | **PASS** | `npx tsx scripts/security/bundle-check.ts`: 180 arquivos cliente examinados, zero falha, exit 0. |
| Superfície pública do Preview | **PASS** | `e2e/public-surface.spec.ts` em Chromium contra Preview: **9/9**, exit 0, 34,9 s. Inclui retorno público de pagamento, 23 rotas protegidas sem sessão, fronteira admin, CSP e formulário público. Não autentica um cliente nem paga. |
| Sessões de cadastro no Preview | **PASS parcial** | `e2e/signup-session-api.spec.ts`: **8 PASS, 2 SKIP**, exit 0, 8,8 s. Validou draft anônimo DEV, cookie HttpOnly/Secure, rejeição de entrada, origin e risco; os dois cenários de Turnstile dependem de `E2E_TURNSTILE_MODE` no deployment e não foram exercitados. |
| Repasse, autorizações e proposta no Preview/DEV | **PASS** | `e2e/payout-review-preview.spec.ts` com prova assinada de ambiente, opt-in DEV e artefatos desligados: **10/10**, exit 0, 5,6 min. Reembolso R$ 50 sobre R$ 150 suspendeu repasse; revisão sob teto R$ 75, versões, RBAC, tenant, sessão revogada, consentimentos, preço único, duas regras, permissões em lote e limites da proposta passaram. Readback de limpeza: **0 clínicas, 0 usuários, 0 linhas** da fixture. Não compra médico extra nem testa renovação SaaS. |
| Entitlement financeiro da conta DEV | **PASS** | `e2e/advanced-financial-entitlement-preview.spec.ts` com credencial de teste em variável de ambiente: **1/1**, exit 0, 14,1 s. A UI mostra a política financeira permitida e não oferece o antigo preço por meio. Isso não prova o entitlement de cada plano da oferta 2026. |
| O-7 dashboard e Ajuda autenticados | **PASS após duas correções** | `e2e/onboarding-o7.spec.ts` em Chromium contra o Preview do commit `9e4a5279`: **5/5**, exit 0, 1,4 min. Cobriu dashboard, documentação, 404, início voluntário, persistência do pulo após reload e convergência entre duas abas. O primeiro run deu **3 PASS/2 FAIL**: o estado `in_progress` foi gravado, mas a janela não abriu. Após corrigir a navegação, o segundo run deu **3 PASS/2 FAIL**: “Pular” fechava antes de persistir. Ambos foram mantidos como falhas observadas. O estado da conta DEV foi restaurado com guarda exata de `skipped`/versão 10 para `not_started`/versão 11; a fixture temporária foi removida. |
| Shell autenticado do Preview | **PASS** | `e2e/authenticated-readonly-routes.spec.ts --grep 'todas as rotas estáticas'`: **1/1**, exit 0, 1,5 min. As **28 rotas** do inventário responderam 200, exibiram o título esperado e não mostraram login, acesso negado ou página inexistente. Prova de renderização, não de cada ação interna. |
| Deep-links autenticados | **PASS após fixture isolada** | A primeira execução de `e2e/authenticated-readonly-routes.spec.ts --grep 'rotas dinâmicas'` terminou exit 1 em 16,5 s: o paciente abriu, mas `/conversas` não tinha fixture. O teste não aceitou o estado vazio como prova. Criamos no DEV uma conversa e mensagem sintéticas na clínica da conta E2E, sem publicar evento ou enviar WhatsApp; a repetição abriu `/pacientes/[id]` e `/conversas/[id]`, **1/1**, exit 0, 20,1 s. Cleanup por ID e tenant exatos, readback **0 conversa**. O `error-context.md` local da primeira falha foi removido. |
| Fronteira sem autenticação da produção publicada | **2 PASS, 1 SKIP** | `e2e/production-unauthenticated-boundary.spec.ts` contra `app.qoro.dev`, leitura: exit 0, 10,5 s. **28** rotas protegidas redirecionaram ao login com HSTS, CSP, `nosniff` e frame deny; **5** deep-links clínicos reais também redirecionaram. O terceiro caso foi SKIP porque não há conversa de produção para a fixture. Mede a versão publicada, não o candidato do PR. |
| Catálogo de assentos no DEV | **PASS somente leitura** | `scripts/probe-offer-seats-dev.ts`: cinco planos 2026, apenas dois de entrada ativos, preços, migrations 0122–0123 e RLS/guard conferidos, exit 0. Não testa convite, aceite nem compra de médico extra. |
| Prazo do trial no DEV | **PASS somente leitura após correção do probe** | `scripts/probe-offer-trial-dev.ts`: **2/2** assinaturas da oferta com prazo estrito e **6** legadas sem ele, coluna/default e migration 0124, exit 0. O probe anterior exigia zero assinaturas estritas e falhou após os Checkouts pagos; corrigimos a separação por coorte, sem mudar o produto ou o banco. |
| Inventário Playwright | **PASS como inventário, não execução** | `node -r dotenv/config node_modules/@playwright/test/cli.js test --list`: **159 casos em 70 arquivos**, exit 0. Sem as variáveis DEV, a primeira listagem falhou na pré-condição de `dev-rbac-matrix`; a repetição carregou o ambiente de processo. A listagem não é PASS de nenhum desses 159 casos. |
| Compra Consultório/Clínica já paga | **PASS histórico; NOT RUN nesta rodada** | O §71 registra dois readbacks **1/1 por plano** após pagamento humano no Sandbox, assinatura/invoice e replay sem duplicata. Não houve nova cobrança nesta data. O E2E de 10 casos acima criou somente fixtures financeiras DEV, sem contratar a oferta nova. |
| Landing Preview, build e atribuição Ads | **PASS local; BLOCKED externo** | Na branch `preview/pricing-2026-10` do Draft PR #1, `npm run typecheck`, `npm run lint`, gate da proposta com `--experimental-strip-types` e `npm run build`: exit 0. O build gerou **54 rotas**, ponte **27/27**, conversão **2/2**, **20** checks de segurança; emitiu 17 avisos informativos de artigos sem `FAQPage` e deixou o worktree limpo. A primeira invocação isolada do gate da proposta, sem o flag de Node exigido pelo script, falhou com `ERR_UNKNOWN_FILE_EXTENSION`; a invocação correta passou. GET externo de `/precos-preview` com o bypass disponível retornou **302 para `vercel.com`**. O controle do Chrome foi interrompido antes da navegação porque não conseguiu identificar com segurança a URL atual. A renderização externa segue sem prova; crédito final da conversão exige campanha ativa. |
| Suite Playwright completa e `production-*` | **NOT RUN nesta rodada** | Inventário de 159 casos; várias suítes `production-*` exigem mutações/fixtures e opt-ins próprios. Não habilitamos mutação em produção para obter verde. O [relatório anterior das 44](production-44-execution.md) é histórico e não foi promovido a PASS atual. |
| Checkout anual, médico extra, franquia IA e repasse mensal | **BLOCKED por implementação** | A [validação da oferta](../runbooks/validacao-nova-oferta-2026-10.md) descreve os contratos ausentes. Não existe E2E funcional de uma função ainda não implementada. |
| Trial real vigente, passagem dos 14 dias e JWT pré-tenant antigo | **NOT RUN / depende de nova jornada** | O §71 prova uma conta recém-criada e dois pagamentos de trial envelhecido, mas não mede a transição temporal de uma conta real nem reproduz externamente o 401 na corrida de provisionamento. Preparar fixture DEV controlada e novo Checkout Sandbox; observar Auth, assinatura e acesso antes/depois. |

## Defeitos e correções desta rodada

1. **Probe de trial desatualizado, severidade baixa.** Depois das duas compras Sandbox, a asserção `strict = 0` tornou-se falsa mesmo com o produto correto. A consulta agora separa planos 2026 dos contratos legados e exige `2/2` com prazo estrito e `0/6` legados alterados. O primeiro run falhou; a repetição passou.
2. **Gate de navegador sem HTTPS, severidade média para a qualidade da evidência.** O build sintético usa `NODE_ENV=production`; a rota de confirmação recusa `APP_BASE_URL` HTTP, retornando 503 antes do fake Auth. Um proxy TLS somente local, com certificado efêmero em memória, preserva a regra de produção. O Next gerou dois redirects para a porta interna; o proxy reescreve apenas o `Location` desse origin local. O primeiro run 4/7, o intermediário 5/7 e o final **7/7** foram mantidos como fatos distintos.
3. **Inventário de segurança envelhecido.** A documentação gerada apontava offsets e seis acessos de ambiente antigos. Foi regenerada e o `--check` voltou a exit 0, sem mudança de autorização no produto.
4. **Porta do tour na Ajuda sem efeito visual, severidade média.** O usuário escolhia iniciar, o banco passava a `in_progress`, mas o layout compartilhado mantinha a janela ausente após `router.refresh()`. A navegação completa para `/dashboard` lê o estado persistido e leva ao primeiro passo; a ação recusada ou falha de rede agora exibe erro. O E2E exige a navegação e passou no Preview.
5. **Pulo do tour fechava antes da persistência, severidade média.** O diálogo sumia imediatamente e um reload podia reabri-lo porque a Server Action ainda não tinha gravado `skipped`. Agora a janela só fecha após confirmação de estado terminal pelo servidor; se a ação falhar, permanece aberta e mostra erro. Os testes dirigidos cobrem resposta atrasada e falha, e o O-7 comprovou persistência após reload e convergência em duas abas. A tentativa intermediária **3 PASS/2 FAIL** permanece registrada.

## Próximas provas e decisão de publicação

Antes de vender a nova tabela, implementar e testar em DEV/Sandbox: compra recorrente de médico extra e limite de assentos, anual por dez mensalidades, política mensurada da franquia de IA e relatório mensal de repasses. Fazer E2E de trial ainda vigente e expirado, primeiro vencimento e renovação, webhook automático, falha/replay, mudança de plano e reentrada com JWT pré-tenant. O app e a landing devem anunciar apenas contratos realmente compráveis. Isso é trabalho de engenharia, não uma tarefa manual do usuário.

Intervenção humana remanescente: concluir Checkouts Sandbox novos quando reCAPTCHA/cartão hospedado exigir pessoa; conferir a UI das duas prévias com SSO; ativar a campanha antes de exigir crédito final no Ads; validar comercial/juridicamente termos de preço, uso justo e cobrança Meta. Repetir pagamentos apenas em fixtures novas e após confirmar projeto DEV e conta Sandbox. Nenhuma etapa pendente autoriza alterar o contrato de desconto vitalício.

## Revalidação adicional — 21/10/2026, 05h31–05h32 UTC

Worktree isolado `integration/pricing-plan-sync-20261018` em `c25f2000`, sem alteração de código ou de produção. A prova assinada de `assertPreviewRuntimeIsDev` confirmou que Auth e banco do Preview do PR #42 apontavam para o projeto DEV; exit 0. As credenciais foram carregadas somente no processo e seus valores não foram registrados.

| Prova | Resultado medido | Limite |
| --- | --- | --- |
| Turnstile no Preview, token inventado sem `Origin`, runner declarado `reject-invalid` | **FAIL 0/1**, exit 1: esperado 401, observado 201. | O modo declarado não corresponde ao comportamento do deployment. A documentação anterior já registrava o Preview com a secret de teste `always-pass`; o resultado é compatível com ela. Não classificar como falha da proteção de produção sem medir sua configuração. |
| Turnstile no mesmo Preview, token dummy com modo `always-pass` | **PASS 1/1**, exit 0: a operação abriu sessão. | Não prova recusa de token inválido. Para fechar o cenário negativo, usar outro deployment Preview com secret real ou de teste `always-fail`, declarar `reject-invalid` e repetir o caso; nunca mudar a secret de produção. |
| Catálogo/cotas da oferta no DEV, somente leitura | `scripts/probe-offer-seats-dev.ts`: **PASS**, exit 0; cinco planos, dois de entrada ativos, preços exatos, 0122–0123, trigger e RLS forçada. | Não compra assento nem valida convite/aceite. |
| Trial da oferta no DEV, somente leitura | `scripts/probe-offer-trial-dev.ts`: **PASS**, exit 0; 2/2 contratos da oferta com prazo estrito e seis contratos legados sem ele. | Não atravessa os 14 dias nem valida renovação ou primeiro vencimento. |
| Troca de plano isolada no Asaas Sandbox — Pix | `scripts/security/subscription-plan-change-sandbox.ts`: **PASS**, exit 0; upgrade R$ 197→397, repetição sem segunda cobrança, downgrade R$ 397→197; parcela e recorrência relidas. Cobrança não paga, assinatura e customer da fixture removidos com readback. | Não usa UI, banco ou webhook Qoro; não fecha o round trip integrado do item 4. |
| Troca de plano isolada no Asaas Sandbox — cartão | Mesmo runner: **PASS**, exit 0; upgrade, repetição, downgrade e limpeza confirmados. | Prova a conta Sandbox usada nesta execução, não a configuração de tokenização de outra conta. |
| Renderização externa da landing Preview | **BLOCKED**. O controle do Chrome parou automaticamente porque não conseguiu determinar a URL atual com confiança suficiente; nenhuma navegação ou clique na landing foi executado. | O build local e o gate da landing continuam provas distintas. Abrir `/precos-preview` pela sessão SSO da Vercel e executar a matriz do runbook. |

A primeira tentativa do runner Sandbox terminou antes de qualquer chamada ao provider porque faltou a condição Node `react-server` (`server-only` recusou o import). Os dois runs seguintes usaram `--conditions=react-server` e passaram; a falha de invocação não representa defeito do produto. Nenhum Checkout novo, webhook ou pagamento real foi criado nesta revalidação. Os dois cenários de Turnstile não são simultaneamente comprováveis sob a mesma secret de teste `always-pass`.

## Continuação da integração — 21/10/2026, branch `integration/pricing-plan-sync-20261018`

Este checkpoint prevalece sobre totais de teste e afirmações de ausência de implementação nos checkpoints anteriores; não altera a evidência histórica. Nenhuma escrita em produção ou contrato com desconto vitalício foi feita. A migration **0127** foi aplicada apenas ao DEV para permitir `SELECT` autenticado do catálogo global de assentos com RLS forçada; `anon` continua sem acesso. O readback de grant/policy passou. O preço de 3–5 médicos segue inativo no DEV neste checkpoint.

| Frente | Estado medido | Evidência e limite |
| --- | --- | --- |
| Regressão integral anterior às últimas alterações | **PASS histórico desta rodada** | `npx vitest run --reporter=dot --silent`: **5.591/5.591 em 531 arquivos**, exit 0. Novos testes de relatório/cadastro foram adicionados depois; exigir repetição integral antes do commit final. |
| Assentos no banco descartável | **PASS** | `scripts/security/signup-provision-db.ts`: **14/14**, exit 0; último assento, reserva de downgrade, limite de escrita do trial após 14 dias e retorno quando ativo. Não mede o Preview publicado. |
| Assentos no DEV e RLS | **PASS somente leitura** | `scripts/probe-offer-seat-access-dev.ts` e `scripts/probe-offer-plan-overview-dev.ts`: exit 0; leitura autenticada de `plan_seat_limits` e dois contratos novos. Não houve ativação de 3–5. |
| Mudança de médicos no Asaas Sandbox isolado | **PASS técnico, não integrado** | `scripts/security/subscription-plan-change-sandbox.ts` para Pix e cartão: 197→397→544→397, repetição sem segunda cobrança; cleanup/readback da fixture. Não passou por UI, webhook e banco Qoro. |
| Relatório mensal de repasses | **PASS unitário; E2E NOT RUN** | `/relatorios/repasses` implementado a partir do histórico de conclusão, snapshots e revisão. Os testes dirigidos de relatório e página passaram, inclusive owner com CRM, escopo do médico, gestor, negação pré-leitura, suspensão e mês local. Falta publicar Preview e executar o caso real adicionado ao E2E de repasse. |
| Plano extra fora do cadastro inicial | **PASS unitário; E2E NOT RUN** | `signup-draft.test.ts` passou com plano de 3 médicos ativo na lista e recusa de `planId` adicional enviado diretamente. O grupo dirigido relatório + cadastro somou **52/52**, exit 0. Antes de ativar extras no DEV, publicar esta guarda no Preview. |
| Prévia visual da landing | **PASS local; externo BLOCKED por SSO** | `npm run typecheck`, `npm run lint`, `npm run build` exit 0; Vite preview local em desktop e mobile foi renderizado e inspecionado. O deployment externo ainda respondeu redirect SSO com a credencial de bypass do projeto app, que não vale para a landing. |
| Build Next após relatório novo | **PASS** | `npx tsx scripts/security/local-build.ts`: exit 0; Next compilou, checou tipos, gerou 19 páginas estáticas e incluiu `/relatorios/repasses`. É build local, não deployment. |

Decisões recém-confirmadas: ciclo mensal↔anual muda no próximo vencimento, sem prorrata; referência de 500 conversas de IA/médico gera aviso e mantém serviço; competência do repasse é o mês de conclusão da consulta. O código do anual e a contagem/aviso comerciais de IA ainda **não** foram implementados. Não confundir a proteção técnica de custo da IA com essa política comercial. Os dois planos de entrada no DEV não autorizam a publicação da landing ou uma migração em produção.

**Reteste após o checkpoint:** a primeira suíte integral com o relatório novo teve 5.598 PASS e 1 FAIL: a página considerava apenas `role=doctor` e ocultava o relatório de owner com CRM. A implementação passou a usar `getCurrentPractitioner`, o mesmo critério da agenda. Os testes dirigidos passaram e a suíte integral repetida terminou com **exit 0** (saída suprimida no último run; não atribuir a ele uma contagem de casos). `npx tsc --noEmit`, lint integral e o build Next otimizado terminaram com exit 0. O inventário de segurança precisou de regeneração documental de linhas e acessos a ambiente; `--check` repetido terminou com exit 0, 195 actions e 53 métodos. O build da landing repetido passou com ponte 27/27, conversão 2/2 e 20 checks de segurança. A inspeção externa em navegador continua pendente até o deployment deste commit; o controle de navegador disponível não ofereceu superfície IAB/Chrome nesta sessão.

## Continuação de 22/10/2026 — relatório mensal e autorização

O Preview do commit `3e5bdf7e` foi acessado em Chromium com sessão DEV. A proposta `/oferta-preview` respondeu HTTP 200 em desktop (1440 px) e mobile (375 px), exibiu 14 dias desde a criação do Auth e não teve overflow horizontal; só a parte pública da proposta foi capturada em `dist/quality/pricing-preview/`. A inspeção externa da landing continua bloqueada pelo SSO específico daquele projeto.

O E2E `e2e/payout-review-preview.spec.ts` passou os dez cenários anteriores, mas o novo caso mensal terminou **10 PASS/1 FAIL** em três tentativas consecutivas, todas com limpeza de fixture (`0` clínicas, `0` usuários Auth, `0` linhas). Nas duas primeiras, o helper do teste usava sessão/expectativa de Caixa desatualizada após mudanças de plano e overrides. Na terceira, o browser mostrou um **defeito de produto**: o atendente, que recebe `view:financial` no bundle padrão da migration 0003, via o consolidado de repasses de outros médicos. A evidência foi a tabela com nome do profissional e valor após acesso direto a `/relatorios/repasses`; não foi inferida por ausência de erro.

O relatório e seu link em `/relatorios` agora exigem `manage:financial` para a visão consolidada. Quem é profissional sem essa permissão continua limitado aos próprios repasses, mesmo que tenha `view:financial`. Os testes dirigidos das duas páginas passaram **10/10**; `npx tsc --noEmit`, ESLint e Prettier dos arquivos alterados terminaram com exit 0. O build otimizado concluiu com exit 0 e 19 páginas estáticas. A regressão integral `npx vitest run --reporter=dot --silent` passou **5.604/5.604 em 533 arquivos**, exit 0. **Ainda não marcar a correção como E2E PASS:** é preciso o novo deployment Preview e a repetição de 11/11.

## Reteste do Preview e ativação controlada de assentos — 22/10/2026

O commit `b04c8413` do Draft PR #42 chegou ao Preview. O spec `e2e/payout-review-preview.spec.ts`, com `E2E_PAYOUT_REVIEW_MUTATION=dev`, `E2E_ARTIFACTS=0`, prova assinada de Auth/banco DEV e Chromium, passou **11/11**, exit 0, após a correção de RBAC. A clínica sintética mostrou o consolidado ao owner e ao financeiro com `manage:financial`; o médico viu apenas o próprio valor revisado de R$ 40; o atendente não recebeu link nem acesso direto; a outra clínica não viu linhas. A execução limpou as fixtures e releu **0 clínicas, 0 usuários Auth e 0 linhas**. Isso substitui o bloqueio E2E do checkpoint acima, preservando as três tentativas anteriores com FAIL.

O script guardado `scripts/activate-offer-extras-preview-dev.ts` ativou **somente no DEV** `clinica_2026_3`, `_4` e `_5`: exit 0, três variantes alteradas, sem escrita em produção. Antes da escrita, verificou projeto DEV, desigualdade com a URL de produção, migrations 0122–0127 e catálogo exato; tomou advisory lock. Depois, `scripts/probe-offer-seats-dev.ts`, `scripts/probe-offer-plan-overview-dev.ts` e `scripts/probe-payout-review-fixture-residue-dev.ts` passaram com exit 0: cinco planos ativos no DEV, preços/cotas corretos, duas assinaturas 2026 legíveis e nenhuma fixture órfã.

O novo caso 12 usa apenas uma clínica/assinatura sintética do DEV, sem ID de assinatura Asaas e **sem clicar em contratar**. Um primeiro run terminou **0 PASS/1 FAIL** porque o seletor do teste confundiu o card-resumo do plano atual com o card do catálogo; cleanup zerado. Após restringir o seletor aos cards com formulário de alteração, o caso isolado passou **1/1**, exit 0, e a suíte inteira repetida passou **12/12 em 5,7 min**, exit 0. A tela autenticada mostrou Clínica com 2/3/4/5 médicos, equipe até três e R$ 397/544/691/838 por mês; a assinatura foi restaurada e o readback final registrou `clinics=0`, `users=0`, `rows=0`. **A compra do terceiro médico pela UI, o pagamento proporcional, o webhook e a atualização da cota após pagamento continuam NOT RUN**; o teste de catálogo não os substitui.

O probe de navegador da proposta pública respondeu HTTP 200 em 1440 e 375 px, conferiu os 14 dias e ausência de overflow. A opção adicional de ler o catálogo autenticado foi tentada com as duas contas DEV existentes: a primeira pertence à tabela legada, e a segunda não tem assinatura provisionada. Esses dois runs falharam por **fixture inadequada**, não demonstram defeito do produto nem PASS de contratação. O caso 12 acima forneceu a prova de UI para uma assinatura 2026 isolada. A landing externa permanece **BLOCKED**: GET redireciona ao SSO da Vercel e, nesta sessão, o controle de navegador não disponibilizou nenhum browser/tab (`apps=[]`, `browsers=[]`). A renderização local já havia sido inspecionada, mas não substitui o deployment protegido.

| Frente após este reteste | Estado | Próxima prova necessária |
| --- | --- | --- |
| Relatório mensal de repasses, RBAC e tenant | **PASS Preview/DEV** | Sem nova prova para este diff; os 12 casos acima cobrem a regressão. |
| Catálogo de 2–5 médicos e cotas na assinatura | **PASS UI Preview/DEV** | Compra paga e atualização de cota permanecem separadas. |
| Médico extra contratado pelo Qoro | **PARTIAL** | Fixture 2026 com assinatura real Sandbox, Checkout proporcional, pagamento humano, webhook, readback e cleanup. |
| Anual e troca mensal↔anual | **NOT RUN por implementação ausente** | Saga para próximo vencimento, conciliação de cobranças pendentes e E2E Sandbox. A [API oficial do Asaas](https://docs.asaas.com/reference/atualizar-assinatura-existente) aceita `cycle=YEARLY`, mas altera por padrão só as cobranças futuras; cobranças já geradas ficam inalteradas. A troca não pode apenas gravar `billing_cycle` localmente. |
| Franquia/aviso de IA | **PARTIAL após a continuação de 22/10** | Medição por paciente/janela de 24 horas, referência por médico e avisos passaram no DEV/Resend e na UI semeada do Preview, como detalhado abaixo. Falta a cadeia externa Meta → IA → contador e a observação do custo real. |
| Turnstile negativo | **BLOCKED por configuração do Preview** | Secret de teste que rejeita em deployment Preview isolado; o Preview atual usa `always-pass` e responde 201 a token dummy. |
| Landing Preview protegida | **BLOCKED por SSO/navegador** | Inspeção humana em desktop/mobile conforme runbook; build local não basta. |
| Trial de 14 dias transcorridos externamente | **PARTIAL** | Banco descartável 14/14 e Checkout/DEV medidos; falta jornada externa de expiração, renovação e pagamento tardio. |

Não houve cobrança adicional, alteração no Asaas, migração ou escrita em produção neste reteste. A campanha com desconto vitalício permanece fora da família de preços nova; nenhuma troca dela foi solicitada.

**Gates finais do diff:** `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check` nos arquivos alterados e `git diff --check`: exit 0. O build isolado `npx tsx scripts/security/local-build.ts` terminou com **exit 0**, Next 15.5.24 compilado e **19/19 páginas estáticas** geradas, incluindo `/configuracoes/assinatura` e `/relatorios/repasses` no mapa de rotas. Depois de trocar as asserções de presença da fixture por erros explícitos, o caso 12 foi repetido isoladamente: **1/1 PASS, exit 0**, readback final zerado. A regressão Vitest **5.604/5.604** pertence ao commit de produto `b04c8413`; esta continuação alterou somente E2E, probe e documentação, sem mudar `src/`.

## Continuação de 22/10/2026 — referência comercial de IA

**Decisão aplicada na branch, sem deploy de produção:** uma resposta efetiva da IA conta uma conversa de referência por paciente identificado, ou por hash de telefone se ainda não identificado, em janela móvel de 24 horas. A janela atravessa a virada do mês. A referência mensal é de 500 por médico contratado; ao cruzar 80% e 100%, a assinatura mostra aviso e um evento entrega e-mail ao titular, sem corte da IA ou cobrança de excedente. A proteção técnica de custo em 60 minutos continua separada e pode produzir fallback. O contador mensal usa mês civil UTC. Uma resposta cujo evento só for processado em outro mês entra no mês do processamento; isso limita seu uso como base financeira e requer observação de atraso real antes de qualquer cobrança por uso.

| Prova | Estado medido | Limite |
| --- | --- | --- |
| Handler, avisos e UI | **PASS local dirigido:** 51/51 antes da correção do produtor e 44/44 após ela, exit 0; cobre replay, janela, concorrência modelada, 80/100%, erro do Resend, ausência de titular e texto sem cobrança. | Testes de componente/handler não substituem a entrega real. |
| PostgreSQL DEV + Resend de teste | **PASS integrado:** `scripts/smoke-ai-usage-preview-dev.ts`, exit 0, 10 asserções; primeira resposta, repetição na janela, virada de mês, nova janela, replay tardio, duas respostas concorrentes, 80/100%, entrega e leitura do aviso de 80% no inbox Resend. Cleanup da clínica, ledger e outbox: 0 resíduos; usuário Auth sintético excluído e relido. | A fixture invoca o handler registrado diretamente; não prova mensagem Meta/Gemini nem o cron de Preview. |
| Assinatura no Preview/DEV | **PASS UI:** commit `8f4cf626`, caso 12 isolado **1/1** (58,1 s) e suíte `e2e/payout-review-preview.spec.ts` **12/12** (5,6 min), exit 0. A tela mostrou 799 sem alerta, 800 com aviso de 80% e 1.000 com aviso de 100% para dois médicos; prova assinada do runtime DEV antes da escrita; cleanup `clinics=0`, `users=0`, `rows=0`. | A contagem foi semeada na fixture para testar apresentação. Não prova Meta, Gemini ou o cron no Preview. |
| Preview com conversa real | **NOT RUN:** ainda falta executar resposta da IA por número consentido e seguir o evento até o contador e aviso. | Não converter prova DEV do handler ou UI semeada em PASS da cadeia externa. |

**Recusa síncrona da Meta encontrada na revisão:** antes desta correção, o produtor marcava `outcome=replied` depois de chamar `messagingApiV1.sendText`, embora o método pudesse retornar `status=failed` sem lançar exceção. Isso inflaria a referência mensal de uma resposta que a Meta recusou. Agora apenas `accepted`, `sent`, `delivered` ou `read` mantêm `replied`; `pending`, `unknown` e `failed` não consomem a referência. A prova unitária cobre essa classificação e o consumer ignora o outcome não aceito. O aceite não comprova entrega final ao paciente, que continua dependendo do callback da Meta e do E2E externo. O fluxo de recusa do provedor ainda merece prova integrada específica; este checkpoint não a substitui.

O primeiro smoke da implementação falhou com `now.getUTCFullYear is not a function`: o driver retornou o relógio SQL como string. O handler passou a normalizar e validar esse valor. Depois, a prova foi repetida com cleanup zerado; a verificação de janela atravessando mês foi acrescentada e a execução final acima passou. Após a correção do produtor, os testes dirigidos passaram **44/44 em quatro arquivos**, e a regressão integral passou **5.628/5.628 em 535 arquivos**, exit 0. `npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos alterados e `git diff --check` passaram com exit 0. O build isolado `npx tsx scripts/security/local-build.ts` também terminou com exit 0: Next 15.5.24 compilado, 19/19 páginas estáticas geradas. A validação externa continua separada.

**Borda de identidade revalidada em 22/10:** o runner `scripts/smoke-ai-usage-preview-dev.ts` foi ampliado e executado contra PostgreSQL DEV com **14/14 asserções**, exit 0. Dois pacientes identificados que usam o mesmo telefone contaram separadamente após fechar a conversa anterior; um paciente em dois telefones e um contato anônimo identificado depois não duplicaram a janela. A tentativa inicial de inserir duas conversas simultaneamente no mesmo número falhou na restrição de uma conversa ativa por contato, antes da asserção; não era falta de paciente nem defeito de contabilização. O aviso de 80% chegou ao inbox Resend de teste. Cleanup relido: zero clínica, ledger e outbox da fixture; TypeScript de scripts, ESLint e Prettier do runner passaram. A nova prova usa handler e dados sintéticos, portanto **não** fecha o E2E Meta → IA → contador.

**Bug confirmado no upgrade de assentos, 22/10:** a mesma fixture foi estendida para mudar de 1 para 2 médicos depois de 400/500 usos e cruzar 800/1000 no mesmo mês. Antes da correção, o consumer emitiu `outbox.key_collision` (exit 1) porque a chave idempotente distinguia apenas clínica, mês e percentual; o outbox detectou que o segundo aviso de 80% tinha outro payload e reverteu a transação. A chave do evento e a do e-mail agora incluem o limite vigente. A repetição no DEV terminou **17/17 asserções**, exit 0: dois eventos de 80% e dois e-mails com 400/500 e 800/1000 recebidos/lidos no inbox Resend de teste; cleanup relido com zero resíduos. Os testes dirigidos passaram **19/19**; regressão integral **5.629/5.629 em 535 arquivos**, TypeScript app/scripts, ESLint, Prettier e `git diff --check` passaram com exit 0. O build Next isolado gerou **19/19 páginas estáticas**, exit 0. A mudança de plano dessa fixture é sintética, sem Asaas, e não substitui o E2E de compra de médico extra.

**Worker real no DEV, 22/10:** o runner publicou um evento sintético `ai_agent.conversation.completed` no outbox e chamou `runOutboxEventsNow` apenas com a chave da fixture. O worker processou **1/1**, atualizou o contador e finalizou a linha como `processed`; a repetição processou **0** e não duplicou uso. A execução completa passou **22/22 asserções**, exit 0, incluindo leitura de dois avisos no inbox Resend e cleanup zerado. Isso prova publicação → worker → metering no DEV; a entrada Meta, a resposta do modelo e o envio WhatsApp continuam **NOT RUN** neste Preview.

**Regressão do Preview após `c83516fe`, 22/10:** Vercel, Semgrep e Snyk passaram no PR #42. `e2e/payout-review-preview.spec.ts`, Chromium, 1 worker, prova assinada do ambiente DEV e artefatos autenticados desligados: **12/12 PASS**, exit 0, 5,8 min. A execução cobriu estorno/revisão, RBAC/tenant, consentimentos, regras, permissões em lote, proposta, relatório e cotas de 2–5 médicos. Readback de cleanup: `clinics=0`, `users=0`, `rows=0`. Os avisos da tela usaram contagem semeada; contratação paga e cadeia Meta → IA continuam sem E2E neste deployment.

**Prova de ciclo Asaas Sandbox, 23/10:** `scripts/security/subscription-plan-change-sandbox.ts` com `SANDBOX_CYCLE_PROBE=1`, host Sandbox e fixture BOLETO não paga: **PASS, exit 0**. Na mesma assinatura, mensal R$ 397 → anual R$ 3.970 → mensal R$ 397; em cada passo o readback confirmou `cycle`, valor recorrente, valor e vencimento da cobrança pendente. O runner removeu cobrança, assinatura e cliente sintéticos e confirmou zero cobranças abertas. O cliente `updateSubscription` agora transmite `cycle` quando solicitado; teste dirigido **58/58**, app e scripts TypeScript exit 0. As duas primeiras tentativas não alcançaram o provedor: faltavam respectivamente a condição Node `react-server` e as variáveis mínimas do ambiente. **Limite:** só contrato do Asaas, sem saga local, Checkout, webhook, UI ou anual contratável. A troca mensal/anual aprovada para o próximo vencimento continua **PARTIAL**.

**Gates do patch de ciclo, 23/10:** `npx vitest run --reporter=dot --silent` **5.630/5.630 em 535 arquivos**, `npx tsc --noEmit` app/scripts, `npx eslint .`, Prettier dos arquivos alterados e `git diff --check`: todos exit 0. `npx tsx scripts/security/local-build.ts`: Next 15.5.24, **19/19 páginas estáticas**, exit 0. Não houve deploy de produção.

**Trial 2026 vencido em fixture, Preview/DEV/Asaas Sandbox, 23/10 ~09:54 UTC:** o modo `SAAS_POST_TRIAL_OFFER=2026` de `scripts/asaas-post-trial-preview-e2e.ts` terminou **PASS, exit 0** em duas execuções; a segunda afirmou por readback o intervalo exato de **14 dias** e `enforce_trial_deadline=true`. Antes do pagamento, a clínica `active` teve escrita recusada como `pending_payment`. Após a simulação oficial de uma parcela PIX R$ 197, o webhook real do Asaas chegou ao Preview e o DEV mostrou invoice única `paid`, assinatura/clínica `active`, período avançado e escrita liberada. Replay não duplicou nem avançou de novo. Cleanup: webhook DELETE 200/GET 404, assinatura e customer excluídos/relidos, clínica DEV removida sem resíduo. **Limite:** o tempo foi avançado apenas na fixture; não é espera real de 14 dias, nem cadastro/Checkout/UI completos. Nenhuma conta ou cobrança de produção foi tocada.

O modo legado do mesmo runner permaneceu como default e não foi repetido depois dessa extensão, para evitar outro pagamento Sandbox sem necessidade; seu resultado anterior continua histórico, não é novo PASS desta rodada.

## Médico extra: pagamento integrado no Preview — 23/10/2026, ~10:25 UTC

**PASS delimitado:** `e2e/extra-doctor-payment-preview.spec.ts` contra o Preview do
commit `20c05ae1`, com prova assinada de Auth/PostgreSQL DEV e conta Asaas
Sandbox: **1/1, exit 0, 40,1 s**. Titular e clínica sintéticos partiram de
`clinica_2026_2` a R$ 397/mês. A UI criou uma única solicitação de terceiro
médico e a cobrança proporcional com valor igual ao registrado no DEV. Após
escolher PIX e confirmar pelo simulador oficial do Sandbox, um webhook pago do
provedor foi observado; banco, valor recorrente e parcela futura no Asaas
convergiram para `clinica_2026_3`, três vagas médicas e R$ 544/mês. Uma invoice
paga e um histórico foram relidos. O link da tela **“Já pagou? Atualizar
assinatura”** renovou o JWT desatualizado e mostrou R$ 544; replay do evento
não duplicou mudança ou invoice. Webhook, assinatura, customer e fixture DEV/Auth
foram removidos com readback de zero resíduos.

As três execuções anteriores falharam por dois seletores ambíguos do teste e,
entre eles, revelaram que recarregar com claims antigas levava ao login. O link
explícito usa a rota existente de renovação; a invalidação server-side permanece.
Os gates depois dessa alteração: Vitest **5.631/5.631 em 535 arquivos**, build
Next **19/19 páginas estáticas**, TypeScript app/scripts, ESLint integral e
Prettier dos arquivos alterados: exit 0.

**Ainda não é PASS do Checkout hospedado:** o pagamento foi simulado pela API
oficial do Sandbox após a escolha de PIX; ninguém atravessou o reCAPTCHA e a
tela de pagamento. A recusa do pagamento, o downgrade no vencimento e o anual
seguem sem E2E integrado desta rodada. A landing externa continua bloqueada
pelo SSO, embora `npm run build` e a renderização local desktop/mobile tenham
passado nesta sessão sem overflow. Nenhuma migração ou escrita em produção foi
feita.

**Segunda prova do terceiro médico, 23/10:** a mesma fixture isolada foi
recriada e removida em execução **1/1 PASS, exit 0, 52,9 s de teste**. Antes de
simular o pagamento oficial, um evento autenticado alegou
`PAYMENT_RECEIVED` enquanto a API do Asaas ainda devolvia `PENDING`; plano,
cota, invoice paga e histórico permaneceram inalterados. Depois do pagamento
Sandbox, webhook real, valor recorrente e UI convergiram como acima; replay
não duplicou registros. Cleanup DEV/Auth: zero resíduos. Esse caso prova o
readback contra uma notificação precoce, não recusa de cartão ou Checkout
hospedado.

A prova foi repetida após exigir explicitamente `status=PENDING` no readback
anterior à notificação: **1/1 PASS, exit 0, 41,1 s de teste**, cleanup zero.

**Downgrade após upgrade pago, 23/10:** o titular da fixture acionou na UI a
volta de três para dois médicos. A execução **1/1 PASS, exit 0, 47,8 s de
teste** encontrou a segunda solicitação `scheduled`, mas manteve plano,
cota e preço em três médicos/R$ 544 no DEV e R$ 544 na recorrência do Asaas
antes do vencimento. Cleanup zero. A aplicação pelo cron e a próxima
parcela de R$ 397 ainda não tinham sido executadas nesse checkpoint.

**Vencimento simulado na fixture, 23/10 ~11:07 UTC:** o mesmo E2E criou upgrade
pago e downgrade agendado pela UI. Um runner separado verificou novamente o
slug, Auth/DB DEV, conta Asaas Sandbox, IDs, plano, valor e data futura da
fixture; sincronizou a recorrência e a parcela emitida pelo caminho real
`syncProviderPlanChange` e chamou `applyScheduledPlanChange` somente para essa
solicitação com relógio controlado. O E2E releu no DEV `applied`,
`clinica_2026_2`, duas vagas e R$ 397; no Asaas, recorrência de R$ 397; e na
UI autenticada, R$ 397/mês após renovar a sessão. **1/1 PASS, exit 0, 1,5 min de
teste; cleanup DEV/Auth e Sandbox: zero resíduos.** TypeScript de scripts,
ESLint e Prettier dos arquivos alterados também passaram. As duas tentativas
anteriores falharam no próprio runner: uma antes de carregar o ambiente DEV,
outra ao tratar como `Date` o timestamp retornado como texto pelo SQL; as
fixtures foram limpas e a correção passou na execução final. Isto prova a
transição funcional no tempo simulado; **não** é observação do cron real
disparando no vencimento nem passagem de um mês no relógio externo.

**Remoção e restauração da cobrança proporcional, 23/10 ~11:12 UTC:** a fixture
foi repetida com `PAYMENT_DELETED` e `PAYMENT_RESTORED` assinados pelo webhook
temporário do Asaas Sandbox. O teste apagou somente a cobrança que ele mesmo
criara; no DEV a invoice passou a `cancelled`, mas a solicitação continuou
`pending_payment` e a vaga não foi liberada. Após `restore` da **mesma** cobrança,
um novo evento real fez a invoice voltar a `open`, e o readback do Asaas mostrou
`PENDING`. O pagamento oficial posterior aplicou o upgrade uma vez, seguido de
replay idempotente e downgrade no vencimento simulado. **1/1 PASS, exit 0, 1,7
min de teste; cleanup zero.** Esse resultado mede a recuperação após
restauração; não define o que fazer se a cobrança for removida e nunca voltar.

**Risco remanescente:** a remoção autoritativa cancela a invoice e preserva a
solicitação de upgrade `pending_payment`. A prova externa acima confirmou que
a mesma cobrança pode ser restaurada e paga com concessão correta da vaga;
liberar automaticamente a reserva na remoção quebraria esse caminho. Quando
a cobrança nunca for restaurada, a solicitação ainda impede outra troca de
plano. Esse estado permanente e sua recuperação continuam **NOT RUN** e exigem
regra explícita antes da nova oferta. A landing externa permaneceu
**BLOCKED** pelo SSO: o navegador conectado não disponibilizou nenhuma aba ou
browser nesta sessão; a renderização local anterior não vira prova do Preview.

## Checkout anual no cadastro — checkpoint de 23/10/2026

**Código do candidato:** `c3c9265d` no app, branch
`integration/pricing-plan-sync-20261018`; cópia da landing `d481c71` na branch
`preview/pricing-2026-10`. Ambos são Previews, sem merge ou publicação da nova
oferta em produção.

**Implementado nesta branch, sem publicação em produção:** a escolha mensal/anual
no cadastro da oferta 2026 persiste em `signup_sessions.selected_billing_cycle`.
O servidor resolve o valor no catálogo e cria Checkout Asaas `YEARLY`, restrito
a cartão. Só provisiona após readback de ciclo, valor, vencimento e customer;
se o trial absoluto acabou, exige também pagamento confirmado. O legado segue
mensal. A retomada de uma assinatura pendente mostra a verificação em vez de um
erro genérico ou uma segunda cobrança. Pix anual não foi habilitado.

**Evidência local:** `npx vitest run --reporter=dot --silent` passou
**5.644/5.644 em 535 arquivos, exit 0**. `npx tsc --noEmit`,
`npx tsc -p tsconfig.scripts.json --noEmit`, `npx eslint .` e
`npx tsx scripts/check-migration-safety.ts` passaram com exit 0. Depois da
última alteração de UI, a regressão integral foi repetida: **5.644/5.644 em
535 arquivos, exit 0**. A prova com todas as migrations reais em Postgres
descartável foi repetida: **15/15, exit 0**. Uma tentativa intermediária de
acrescentar provisionamento anual no mesmo harness terminou **15/16, exit 1**:
o runner insere `auth.users` no SQL descartável, mas o código 2026 consulta a
data de criação pela sessão do GoTrue, que não existe naquele harness. Essa
asserção da fixture foi retirada; não foi promovida a PASS. Os testes unitários
de provisionamento anual passaram, mas a prova Auth + banco + Asaas exige o
Preview. Nenhuma dessas provas locais cobrou no Asaas externo.

O build otimizado `npx tsx scripts/security/local-build.ts` foi repetido após
os ajustes da UI: **exit 0**, compilação, tipos Next, 19 páginas estáticas e
traces concluídos. `npx tsc -p tsconfig.scripts.json --noEmit`, ESLint integral,
Prettier dos arquivos alterados, `git diff --check`,
`npx tsx scripts/check-migration-safety.ts` e o inventário de segurança
regenerado com `--write` e validado com `--check` passaram com exit 0.

**DEV:** o probe guardado encontrou o projeto DEV esperado, versão `0127`,
ledger Drizzle 128/129 e coluna anual ausente. Depois,
`node -r dotenv/config --import tsx scripts/db-migrate-dev.ts` executou com
exit 0; `npx tsx scripts/probe-signup-billing-cycle-dev.ts` confirmou
`0128-signup-billing-cycle`, ledger **129/129**, default mensal e CHECK válido,
exit 0. Nenhuma migration foi aplicada em produção.

**Ainda PARTIAL:** Checkout anual na UI do Preview → cartão Sandbox → evento
externo → primeira cobrança/invoice, renovação anual e troca mensal↔anual no
próximo vencimento não foram provados nesta etapa. A prova isolada do Asaas
descrita acima mede somente a API do provedor. A landing continua sem
publicação da nova oferta. A cópia da prévia da landing foi alinhada e enviada
à branch `preview/pricing-2026-10` em `d481c71`; `npm run typecheck`,
`npm run lint`, `npm run build` (incluindo 27/27 ponte, 2/2 conversão e 20 gates
de segurança) e o gate da proposta passaram com exit 0. GET externo do Preview
devolveu **302** para o SSO da Vercel; inspeção visual externa permanece
**BLOCKED**, sem converter build local em prova do Preview.

## Preparação do Checkout anual no Preview — 23/10/2026, 17h24 UTC

O app foi publicado **somente em Preview** a partir de `bf43ff09`; o deployment
exato `project-72elr0chu-clinic-os-v2-s-projects.vercel.app` ficou `success`.
Antes de qualquer escrita da fixture, a prova assinada de
`assertPreviewRuntimeIsDev(..., { requireSandboxAsaas: true })` confirmou Auth e
banco do projeto DEV, URL do Asaas Sandbox e presença da chave do provider,
exit 0. A prova não identifica o ambiente da chave; a página hospedada
subsequente confirmou a criação na conta Sandbox. O
controle contra o deployment anterior, sem as duas novas flags, foi recusado
antes de criar conta, exit 0 da asserção negativa. A rota não expõe chave nem
URL do provider. O teste da rota exige 404 em ambiente de produção; não houve
sondagem desse endpoint em produção nesta rodada.

`@prepare-offer-checkout` no Chromium, com `E2E_OFFER_PLAN_CODE=consultorio_2026`
e `E2E_OFFER_BILLING_CYCLE=annual`, executou **1/1 PASS em 57 s, exit 0**.
Percorreu cadastro, Resend, confirmação, seleção anual, leitura do catálogo,
draft e abertura do Checkout hospedado; o recibo da fixture sintética ficou em
`.playwright/offer-checkouts-pending.json` ignorado pelo Git. O Checkout
Sandbox respondeu HTTP 200 e sua página exibiu **R$ 1.970**, recorrência
**Anual** e primeira cobrança em **23/10/2026**. A opção Pix não apareceu na
tela lida. O prazo do Checkout é **60 minutos** desde a criação; a URL efêmera
não foi versionada. **Pagamento, webhook, provisionamento, primeira invoice e
acesso continuam NOT RUN**, aguardando cartão/reCAPTCHA manual no Sandbox.
Uma consulta pontual `GET /payments?checkoutSession=...` às 17h27 UTC retornou
HTTP 200 com **zero pagamentos**; não foi interpretada como sucesso financeiro.

Depois da proteção de ambiente, a regressão integral foi **5.646/5.646 em 535
arquivos, exit 0**; prova dirigida da rota/guarda **22/22**, TypeScript, lint,
Prettier, inventário `--check` e build Next otimizado também terminaram exit 0.
O cadastro público no Preview abriu sessão HTTP 201 e renderizou a primeira
etapa em desktop 1440 px e celular 390 px sem overflow horizontal. A landing
externa ainda direcionou ao login da Vercel mesmo com o bypass do projeto app;
continua **BLOCKED** para inspeção visual externa.

O login da mesma conta sintética pendente foi validado sem imprimir credenciais:
Auth DEV emitiu sessão HTTP 200 para o usuário esperado; a UI do Preview
redirecionou `/login` → `/cadastro/continuar` (POST 303), com mensagem de
cadastro recuperado e clínica ainda não criada. A primeira observação após
apenas cinco segundos permaneceu em `/login`; aguardar dez segundos mostrou o
destino final, portanto a espera curta não foi classificada como defeito.
Esse controle não prova ainda a liberação após pagamento.

## Regressão e inspeção adicionais — 23/10/2026, 17h42 UTC

No deployment exato de `bf43ff09`, `e2e/payout-review-preview.spec.ts`
executou **12/12 PASS em 5,9 min, exit 0**. O spec confirmou estorno parcial e
suspensão do repasse, revisão com teto, negação por papel e tenant, versões
sucessivas, sessão revogada, preço único, consentimentos de WhatsApp separados,
persistência de regras, permissões em lote, relatório mensal e catálogo de
2–5 médicos. O `afterAll` registrou `cleanup=ok` e resíduo **0 clínicas,
0 usuários, 0 linhas**. O teste 12 apenas lê as variantes de médico extra:
`purchaseNotStarted=true`, sem atribuir PASS à compra paga.

A landing compilada da branch `preview/pricing-2026-10` foi servida localmente e
aberta em Chromium a **1440 e 390 px**: `/precos-preview` respondeu HTTP 200,
mostrou Consultório e Clínica e teve `body.scrollWidth === innerWidth` nas duas
larguras. A calculadora interativa passou **7/7**: 1/3 = R$ 197/R$ 1.970,
2/3 = R$ 397/R$ 3.970, 3/1 = R$ 544/R$ 5.440, 5/3 = R$ 838/R$ 8.380;
6 médicos, 4 logins de equipe e 0 médicos foram recusados. Isto é
**PASS local**, não inspeção externa do Preview protegido por SSO. Sem sessão,
`/oferta-preview` no app leva a `/login`, como a rota exige; a inspeção
autenticada anterior continua sendo a evidência do conteúdo do app.

O PR #42 no commit documental `0af508d1` terminou com Vercel, Semgrep e Snyk
**PASS**. Um novo `GET /payments?checkoutSession=...` no Asaas Sandbox às
17h42 UTC respondeu HTTP 200, **zero pagamentos**: checkout criado não é
checkout pago. O E2E `@verify-offer-checkout` permanece **NOT RUN**.

A troca de ciclo de uma assinatura ativa continua **PARTIAL por implementação**.
`requestPlanChange` lê o destino no ciclo atual e só agenda upgrade/downgrade
de plano; `syncProviderPlanChange` sincroniza valor, não periodicidade;
`advanceBillingPeriod` deriva o período do `price_id` local no momento do
pagamento. Uma cobrança anual paga antes da troca local poderia abrir apenas
um mês. O [Asaas documenta](https://docs.asaas.com/reference/atualizar-assinatura-existente)
que alterar a assinatura afeta por padrão cobranças futuras e não corrige
as já emitidas sem tratamento explícito. A prova isolada do provider não
fecha essa corrida; não oferecer a troca mensal↔anual pela UI ainda.

## Bloqueio do checkout anual no Preview — 23/10/2026, 17h50 UTC

Antes do pagamento da fixture anual, o login da conta sintética foi repetido no
deployment exato `project-72elr0chu-clinic-os-v2-s-projects.vercel.app`. O draft
e o plano responderam HTTP 200, mas `POST /api/signup/checkout/status` respondeu
**503 `unavailable` em três tentativas**, embora o Checkout ainda estivesse sem
pagamento. A sessão no banco DEV permanecia viva em `checkout_pending`, associada
ao mesmo Checkout; o Asaas Sandbox respondeu HTTP 200 com zero pagamentos para
ele, e a mesma busca pelo cliente local retornou `null` sem erro. Uma tentativa
de abrir diretamente o retorno de sucesso não concedeu acesso ao dashboard.
Esse controle confirma **falha de disponibilidade no Preview, não bypass de
pagamento**. Pagamento humano foi suspenso para não prender uma conta paga.

A rota agora emite `signup.checkout.status.unavailable` com etapa enumerada
(`configuration`, `origin`, `identity`, `rate_limit`, `completion` ou
`unexpected`) e, na etapa de conclusão, motivo enumerado. A métrica não inclui
usuário, email, Checkout, corpo do provedor ou texto da exceção. A causa raiz
do 503 **ainda não foi identificada**: será preciso reproduzir no novo Preview
e ler essa métrica nos Logs da Vercel. O teste de rota passou **10/10** e a
regressão integral anterior à instrumentação das duas etapas iniciais passou
**5.648/5.648 em 535 arquivos, exit 0**. Não atribuir PASS ao checkout anual
antes de obter 202 pendente e, após o pagamento, provisionamento confirmado.

## Conciliação do cadastro anual pago após expiração — 23/10/2026, 21h04 UTC

**Resultado: PASS funcional para Consultório anual no Preview/DEV/Sandbox; webhook de assinatura não isolado como prova causal.** O pagamento foi concluído pelo usuário no Checkout hospedado do Asaas Sandbox. Antes da correção, o banco DEV conservava a sessão `checkout_pending`, mas os TTLs idle e absoluto tinham vencido após uma hora. O Auth já estava confirmado; `/cadastro/continuar` não reencontrava o rascunho e `POST /api/signup/checkout/status` retornava 401. A assinatura paga ficava sem clínica no Qoro. O HTTP 503 anterior teve causa separada: comparação enum/text em SQL, corrigida no commit `226b72c1`.

O commit `03e1d064` permite **somente a conciliação financeira** do Checkout hospedado já vinculado ao mesmo usuário Auth e ao HMAC do mesmo e-mail, quando há `auth_attempt_state=completed`, `consumed_at`, `billing_attempt_state` pendente/ativo, tentativa de cobrança e ID do Checkout. Não reabre a edição do draft nem cria outra tentativa de pagamento. A entrada expirada aponta para `/cadastro/pagamento?resultado=pending`; a conclusão ainda exige readback do provedor e provisionamento transacional. O inventário de segurança foi regenerado.

Evidência desta rodada: `npx vitest run` **5.652/5.652 em 535 arquivos, exit 0**; `npx tsc --noEmit` exit 0; `npx eslint .` exit 0; `npx tsx scripts/security/inventory.ts --check` exit 0; `npx tsx scripts/security/local-build.ts` exit 0. O deployment do commit `03e1d064` no PR #42 ficou Ready. `node --import tsx --require dotenv/config scripts/run-signup-confirmation-e2e.ts`, com `E2E_SIGNUP_VERIFY_OFFER=1`, plano `consultorio_2026`, ciclo `annual`, alvo Preview, projeto Supabase DEV fixado pelo guard e artefatos autenticados desligados: **1/1 PASS, exit 0, 1,1 min**. A mesma fixture paga foi reutilizada; não houve segundo Checkout nem cobrança.

O E2E autenticou via UI, recebeu `POST /api/signup/checkout/status` 200 `provisioned`, retornou ao dashboard HTTP 200, repetiu a confirmação com 200 e conferiu no banco DEV um único tenant ativo, plano e preço anual corretos, trial absoluto, uma invoice paga e consumo único do draft. O readback no Asaas Sandbox confirmou a assinatura `ACTIVE`/`YEARLY`/cartão e o pagamento `CONFIRMED` ou `RECEIVED`, associados ao mesmo Checkout, assinatura e valor. Durante a troca de sessão após o primeiro 200 houve um polling adicional 401; `/auth/session-refresh` respondeu 307 e o dashboard abriu. Isso não invalidou o estado final, mas a resposta intermediária fica registrada para observação de UX. O teste não prova que o webhook, por si só, criou a invoice: a confirmação autenticada também faz readback e provisiona. Renovação após um ano e troca mensal↔anual de contrato existente continuam PARTIAL. A clínica/conta paga permanecem como fixture isolada no DEV/Sandbox; não apagar parcialmente sem rotina de cleanup transacional.

Busca de runtime da Vercel no Preview do projeto `project-os`, 23/10 das 17h às 21h UTC: `requestPath:/api/webhooks/asaas` retornou **zero** entradas; `requestPath:*asaas*` retornou 18 entradas, todas de rotas de cobrança de paciente. O CLI saiu com código 0 nas duas consultas. Isso não prova ausência de entrega em outro ambiente nem o estado da configuração do Asaas; mantém a causalidade do webhook SaaS como **NOT TESTED**. A tentativa de consultar somente leitura `GET /v3/webhooks` da conta Sandbox foi bloqueada pela revisão automática da ferramenta antes de executar (`blocked by policy`); nenhuma configuração externa foi alterada. Consulte o painel Sandbox conforme o guia manual antes de afirmar que a assinatura anual foi recebida pelo webhook.
