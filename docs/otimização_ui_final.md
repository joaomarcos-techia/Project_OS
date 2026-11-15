# otimização_ui_final

> Documento persistente da auditoria, do plano e da execução da otimização de UI/UX do Qoro.
> É a fonte única para continuar o trabalho: quem chegar sem contexto lê o bloco de estado
> logo abaixo, depois a seção 00, e segue o "Próximo passo exato".
>
> Criado em 14/11/2026 por um agente (Claude Code, Opus 5.5) a pedido do fundador, a partir do
> "PROMPT MESTRE — OTIMIZAÇÃO_UI_FINAL". Idioma: português do Brasil. Identificadores de código
> ficam como estão no repositório.

---

## ESTADO ATUAL DA EXECUÇÃO

- **Fase atual:** Fase 5 (implementação em lotes) com a auditoria da Fase 3 consolidada; P0 de
  ambiente auditados (00.5). Fundador autorizou (14/11, noite) commits e push desta branch e o
  UX-006 em DEV/Preview; Production segue NO-GO.
- **Lote atual:** Lote 1 concluído e versionado: UX-001, UX-002, UX-005 (piloto), UX-006, UX-007,
  UX-008, UX-009, UX-010, UX-017. Próximo: Lote 2 (validação no navegador + Dashboard, mobile,
  humanização, Caixa).
- **Último ID concluído:** UX-006 (`9710a207`); UX-017 completo (`4acd59f8`).
- **ID em andamento:** nenhum.
- **Último checkpoint:** 14/11/2026 ~23h — P0 auditados; 9 commits na branch.
- **Commits (sobre `e47ec2f0`):** `06af3f84` UX-001 · `f8f26cf9` UX-002 · `099f339e` UX-005/007 ·
  `4e39880f` UX-009 · `1df78a87` UX-010 · `15b060c1` UX-017 · `5d04e48f` UX-008 · `4acd59f8`
  UX-017 (convite) · `9710a207` UX-006 · + o commit deste documento. Fora do Git: `.env.local`
  (higienizado; Sentry desligado — 00.3), `.tmp/ui-audit/*` (scripts e evidências). Fora do
  worktree: `C:\dev\ClinicaOS_V2\.claude\launch.json`.
- **Testes executados (14/11):** regressão ampla 104 arquivos / 979 testes (antes de UX-010+);
  UX-010/017: 19 arquivos / 169; UX-006: agenda + contratos 18 / 142; convite 1 / 11; ESLint 0 em
  todos os arquivos tocados; `tsc --noEmit` 0 erro em três rodadas (25.2); `check:observability`
  OK; `security:inventory --check` **falha** (pré-existente, P-15).
- **Testes pendentes:** navegador: UX-006 (celular, teclado, 1 paciente sintético real), UX-010
  (tela de erro), `/conversas`, `/configuracoes/pagamentos` e `/equipe` (P-10/P-11); NVDA manual;
  suíte completa; e2e seguros (`login-and-navigation`, `authenticated-readonly-routes`).
- **Bloqueios:** `/admin/*` exige super_admin com MFA; Convênios TISS na PR #55; trava do Asaas
  depende do billing (P-13); limpeza de disco fora deste worktree depende do fundador (P-14).
- **Riscos ativos:** conflitos de integração listados no P-16; `.env.local` principal com Asaas de
  produção (00.5).
- **Próxima ação exata:** (1) subir o servidor (00.3) e validar no navegador UX-006 (criar 1
  paciente sintético "Teste UI Cadastro Rápido" na clínica "teste final"), UX-010 e as rotas de
  P-10/P-11 com `.tmp/ui-audit/hydration-probe.ts` (10 cargas cada em 375 e 1440) e
  `conversas-probe.ts`; (2) UX-011 Dashboard; (3) UX-014 humanização (Equipe, Conversas, Ficha,
  LGPD); (4) UX-012 cabeçalho no celular; (5) UX-015 Caixa (só proposta até coordenar com a #55);
  (6) UX-019 modelos de receita; (7) seção 31 TISS e handoff AbacatePay.
- **Arquivos que devem ser lidos para continuar:** este documento; `docs/design/CONTRACT.md`;
  `docs/design/COMPONENT-DECISIONS.md`; `docs/ui/PLANO-FINALIZACAO-REDESIGN-QORO.md`;
  `src/components/ui/field.tsx`; `src/app/(app)/login/actions.ts`.
- **Skills necessárias para a próxima ação:** R7 Impeccable (`operate`, `critique`, `audit`,
  `harden`, `clarify`), R4 `heuristic-evaluation`, `form-design`, `error-handling-ux`,
  `accessibility-audit`, R11 UX Writing (ver seção 04 para caminhos).

---

## 00. Instruções para retomada de contexto

### 00.1 Ordem de leitura

1. O bloco **ESTADO ATUAL DA EXECUÇÃO** acima.
2. Esta seção inteira (ambiente, regras e armadilhas).
3. A seção 23 (plano de implementação por lotes) e a 27 (o que já foi feito).
4. A intervenção em andamento (seções 21/22/31) e as decisões ligadas a ela (seção 26).
5. Só então o código.

Nunca reinicie a auditoria do zero por perda de contexto. Se o documento divergir do código,
investigue a divergência e registre a reconciliação na seção 27 antes de seguir.

### 00.2 Onde o trabalho vive

| Item | Valor |
| --- | --- |
| Repositório | `joaomarcos-techia/Project_OS` (nome público do produto: **Qoro**; nome interno: ClinicaOS) |
| Worktree deste trabalho | `C:\dev\Qoro_ui_otimizacao_final_20261114` |
| Branch | `ui/otimizacao-ui-final-20261114` (sem upstream; nada publicado) |
| Base | `origin/ui/refactor-qoro-20261108` em `e47ec2f0` (redesign "Qoro App v5", 42 commits à frente da `main`, sem PR) |
| `main` na data | `5620a098` (PR #54) |
| Ordem de integração conhecida | PR #53 (billing AbacatePay, rascunho) → branch de UI → esta branch. A branch de UI carrega 3 commits do billing (`6cccfc01`, `35d09d4b`, `311e5dd0`) e só entra depois da #53 |
| Convênios TISS | PR #55 (rascunho, "do not merge"), branch `feat/convenios-tiss-20261110`, worktree `C:\dev\Qoro_convenios_tiss_20261110`, **outro agente com trabalho não commitado**. Não tocar nesse worktree |
| Commits e push | Só com pedido explícito do usuário |

### 00.3 Ambiente local seguro (como subir o app)

1. **Dependências:** o worktree tem `node_modules` próprio, instalado com
   `pnpm install --frozen-lockfile` (o lockfile da branch de UI difere do da `main`; a junção usada
   antes não tinha `react-useanimations`). Não use junção para outro `node_modules`.
2. **`.env.local` higienizado** (fora do Git), gerado a partir do `.env.local` da pasta principal:
   banco **DEV** (`DATABASE_URL` = `DATABASE_URL_DEV`, pooler 6543), `SUPABASE_SECRET_KEY` do DEV,
   **Asaas sandbox** (`ASAAS_*` ← `ASAAS_*_DEV`), nenhuma variável `*_PROD`, sem WhatsApp
   (`META_*`), sem e-mail (`RESEND_*`), sem IA (`GEMINI_API_KEY`), sem Sentry,
   `APP_BASE_URL=http://localhost:3100`, Turnstile com as chaves `_LOCAL`, e a conta de teste de UI
   (`2E2_UI_EMAIL`/`2E2_UI_PASSWORD`, clínica "teste final" no DEV). **Nunca** copie o `.env.local`
   da pasta principal sem higienizar: nele `ASAAS_API_KEY` sem sufixo é a chave de **produção**.
3. **Certificado TLS:** o Avast desta máquina intercepta HTTPS. O shell do usuário tem
   `NODE_EXTRA_CA_CERTS` apontando para o certificado do Avast, mas o processo iniciado pelo
   painel de preview não herda essa variável: sem correção, toda chamada ao Supabase falha com
   `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. A correção adotada é `NODE_OPTIONS=--use-system-ca`
   (confia no repositório do Windows; **não** desliga a verificação de TLS).
4. **Servidor:** `C:\dev\ClinicaOS_V2\.claude\launch.json`, configuração `qoro-ui-otimizacao`
   (`cd /d C:\dev\Qoro_ui_otimizacao_final_20261114 && set NODE_OPTIONS=--use-system-ca && node
   node_modules\next\dist\bin\next dev --turbopack --port 3100`). Node 22.23.4, Next 15.5.28.
   Validação TLS ligada (nunca `NODE_TLS_REJECT_UNAUTHORIZED=0`). Sentry desligado só aqui:
   `NEXT_PUBLIC_SENTRY_DSN=` e `SENTRY_DSN=` vazios no `.env.local` (INC-01, 19.1).
   - Depois de editar arquivos compartilhados do shell com o servidor no ar, **reinicie antes de
     validar**: o Turbopack pode devolver 500 "module factory is not available" na primeira
     requisição.
   - **Memória:** a máquina tem 7,7 GB e, em 14/11, só ~0,45 GB livres com o servidor no ar. Com
     webpack, o primeiro build do `/dashboard` passou de 10 minutos; com **Turbopack**, o primeiro
     build de uma rota leva 1–3 minutos. Use Turbopack.
   - **Fontes:** o Turbopack não consegue baixar as fontes do Google atrás do Avast (nem com
     `SSL_CERT_FILE`) e usa fonte substituta. As fotos da varredura recuperam a tipografia real
     porque o navegador da varredura carrega as famílias do Google Fonts e sobrepõe as variáveis
     `--font-inter`, `--font-manrope`, `--font-hanken`, `--font-dm-sans`, `--font-plex`. Ao olhar a
     tela no painel de preview (sem essa sobreposição), lembre que a fonte está errada.
   - **Playwright + tsx:** scripts injetados como texto (`addInitScript({ content })`) e
     `window.__name` definido antes, porque o `tsx` embrulha funções em `__name(...)`. Espere por
     `load`, não `networkidle` (HMR e Turnstile mantêm a rede ocupada). No Git Bash, argumentos
     que começam com `/` viram caminho do Windows: para filtrar rotas, rode pelo PowerShell ou
     prefixe com `MSYS_NO_PATHCONV=1`.
5. **Varredura de telas:** `npx tsx .tmp/ui-audit/sweep.ts <pasta-de-saída> [rotas]` (somente
   leitura; faz login com a conta de UI e visita cada rota em 1440, 1024, 768, 375 e 320 px,
   gravando fotos, erros de console/hidratação, rolagem lateral, alvos pequenos e controles sem
   nome). Não rode outra automação logada ao mesmo tempo: o logout de uma derruba a outra.
   - **Sessão:** o Supabase gira o refresh token a cada renovação. Reaproveitar o estado salvo
     logo após o login fazia todo contexto seguinte cair em `/login` (aconteceu na varredura
     parcial de 14/11: só a medição de 1440 px do `/dashboard` valeu). O script grava o estado
     mais recente depois de cada medição logada; resultados com `finalUrl` = `/login` numa rota
     logada indicam sessão perdida, não defeito da tela.
   - **CSP:** a varredura usa `bypassCSP` para carregar as fontes reais; violações de CSP do app
     só aparecem nas sondas sem essa opção (ex.: `conversas-probe.ts`).
6. **Evidências:** `.tmp/ui-audit/evidence/<data>/` (ignorado pelo Git, durável no disco).
   Scripts auxiliares em `.tmp/ui-audit/`: `sweep.ts`, `sweep-report.cjs`, `conversas-probe.ts`,
   `db-phases.ts`, `static-audit.cjs`, `field-usage.cjs`, `page-titles.cjs`, `apply-titles.cjs`,
   `ui-strings.cjs`.

### 00.5 Segurança do ambiente — auditoria P0 (14/11/2026, noite)

Somente leitura; nenhum valor de segredo foi impresso, copiado ou registrado.

**P0.1 — Asaas de produção no ambiente local**

| Item | Achado |
| --- | --- |
| Como o código escolhe a conta | `src/lib/payments/asaas/index.ts`: `createAsaasClient({ apiKey, baseUrl? })`. Cobrança de **paciente** (`contexts/payments/actions.ts:91`, `lib/payments/account-store.ts`) usa a chave da **clínica** (cifrada no banco) e **não** passa `baseUrl` → vale `env.ASAAS_BASE_URL`. O cliente da **plataforma** (`envClient`, linha ~1502) usa `env.ASAAS_API_KEY` + `env.ASAAS_BASE_URL`; também `health-probes.ts` e `admin/_lib/services/health.service.ts` leem `ASAAS_API_KEY` |
| Padrão quando ausente | `src/lib/env.ts`: `ASAAS_BASE_URL` sem valor → `https://sandbox.asaas.com/api/v3` (seguro por omissão) |
| Trava de ambiente | **Não existe.** Nada impede `ASAAS_BASE_URL` de produção fora da Vercel Production (`VERCEL_ENV` existe no `env.ts`, mas não é usado para isso) |
| `.env.local` por worktree | Só 2 têm `.env.local`: `C:\dev\ClinicaOS_V2` (**`ASAAS_BASE_URL` de produção + `ASAAS_API_KEY` = chave de produção + 12 variáveis `*_PROD`**) e este worktree (sandbox, 0 variáveis de produção). Nenhum worktree tem `.env`, `.env.development*` ou `.env.production*` |
| Risco concreto | Um `next dev` rodado em `C:\dev\ClinicaOS_V2` chama o **Asaas de produção** com dados do banco DEV: o cliente da plataforma usaria a conta real; chaves de clínica do DEV iriam à API de produção (sandbox recusa, mas uma chave real gravada no DEV seria usada de verdade). Não há evidência de cobrança real feita por isso |
| Este worktree | Seguro: `ASAAS_*` ← `ASAAS_*_DEV` (sandbox), sem chaves de produção; todo o tráfego Asaas daqui vai para `sandbox.asaas.com` |
| Proteção proposta (P-13, **não aplicada aqui**) | No `env.ts` (que a PR #53 também altera — 54 linhas), recusar no boot `ASAAS_BASE_URL` com host `api.asaas.com` quando `VERCEL_ENV !== 'production'`, salvo opt-in explícito para scripts de produção (que já usam `*_PROD` + `SUPABASE_PROJECT_ENV=prod`); mensagem: "ASAAS_BASE_URL aponta para produção fora da Vercel Production — use o sandbox". Testes: `env.test.ts` com os 4 casos (produção/preview/dev × URL de produção/sandbox). Encaminhar ao agente do billing/payments; convenção recomendada para o `.env.local` principal: variáveis **sem sufixo = sandbox**, produção só com `_PROD` |
| Separação de gateways | Asaas = cobrança de pacientes (chave por clínica) e, na `main`, assinatura SaaS legada; AbacatePay = assinatura SaaS (PR #53); TISS = convênios. As telas desta frente não misturam os três (seção 31/32) |

**P0.2 — Credenciais de produção no disco**

| Item | Achado |
| --- | --- |
| Quem lê `*_PROD` | Só scripts (`scripts/*prod*.ts`, `scripts/_env.ts`, `load-test*.ts`, `restore-test.ts`, `storage-encrypted-backup.ts`, probes `*-dev.ts`) e specs `e2e/production-*`. O runtime do app (`src/`) não lê `DATABASE_URL_PROD` nem `SUPABASE_SECRET_KEY_PROD` |
| Trava dos scripts | `scripts/_env.ts`: scripts de produção exigem `SUPABASE_PROJECT_ENV=prod`; scripts de DEV **recusam** rodar com ele ligado |
| Trava dos e2e | `playwright.config.ts` usa `127.0.0.1:3000` sem `E2E_BASE_URL`; cada `production-*.spec.ts` exige uma variável de autorização própria (ex.: `E2E_PRODUCTION_CLINIC_PROFILE=ALLOW_SYNTHETIC_CLINIC_A`); o CI roda só `public-surface.spec.ts` |
| Herança por processos | Um `next dev` em `C:\dev\ClinicaOS_V2` carrega as 12 variáveis `*_PROD` em `process.env` (o app não as usa, mas ficam disponíveis a qualquer código do processo) |
| Duplicatas no `.env.local` principal | `META_TEMPLATE_LANG` (linhas 61 e 91, valores iguais); `E2E_TESTE_PROD_PASSWORD_DOCTOR` (152 e 155, iguais); **`E2E_TESTE_PROD_EMAIL_DOCTOR` (151 e 154, valores diferentes — vale a 154, a última no dotenv; a 151 é letra morta)** |
| Ação | Nenhuma alteração no `.env.local` principal (usado por scripts do fundador e de outros agentes). Recomendação no P-13 |

**P0.3 — Disco** (inventário `/.tmp/ui-audit/disk-inventory.ps1` → `evidence/2026-11-14/disco.tsv`; `robocopy /L` sem seguir junções)

Livre: 22 GB no início do dia → **17,7 GB** no inventário → **17,9 GB** após a limpeza autorizada. Store do pnpm: 5,0 GB.

| Diretório | Espaço | Ativo? | Compartilhado? | Seguro remover? | Ação proposta |
| --- | --- | --- | --- | --- | --- |
| `Qoro_billing_abacatepay_20261107\dist` | 10,3 GB | sim (PR #53, hoje) | não | **não decidir aqui** | perguntar ao agente do billing se `dist` é saída regenerável |
| `.next` de 12 worktrees de branches já na `main` (main 2,09; 2e2_integration 1,9; o4 1,87; pricing_validation 1,81; integrate 1,79; pricing_plan_integration 1,75; whatsapp_profile_ui 1,57; ai_convenios 1,55; hotfix-meta-body 1,36; cancel 0,23; signup_code_funnel 0,23; reset 0,2) | ~16,3 GB | não (último commit set/out) | não (diretório físico) | provável, com autorização | apagar só `.next` (cache regenerável), um por um, depois de confirmar que nenhum servidor usa a pasta |
| `node_modules` físicos (main 1,95; pricing_depcheck 0,74 — alvo de várias junções; signup_email_fix 0,74; meu 0,74; o3b/plan_change/signup_v4/ai_convenios/hotfix ~0,7 cada) | ~7 GB | variado | **sim** (main e pricing_depcheck são alvo de junções) | **não** sem mapear quem aponta para cada um | manter |
| Worktrees de branches já na `main` sem commits locais (ex.: `c14-*`, `cancel`, `reset`, `o3b_preview`, `plan_change_fix`, `waitlist`, `2e2_integration`, `integrate`) | 0,2–3,6 GB cada | não | alguns via junção | **não automaticamente**: quase todos têm "4 alterados" = os 4 vídeos de pentest apagados em 09/11 (blobs no Git) | proposta para o fundador: listar e remover com `git worktree remove` só os confirmados, sem `--force` |
| `ClinicaOS_V2_audit_20261009` (3 commits só locais), `pricing_depcheck` (6 só locais) | 1,7 / 0,9 GB | não | pricing_depcheck é alvo de junção | **não** | manter |
| Meu `.next\cache\webpack` (rodadas webpack abandonadas) | 0,16 GB | — | não | sim | **removido** (servidor parado; diretório físico sem links internos) |

Observação: a coluna "ativo" do inventário marca o checkout principal como ativo porque a busca de processos por prefixo de caminho também casa com `C:\dev\ClinicaOS_V2_*`; não usar esse sinal sozinho.

**P0.4 — Git deste worktree**

Branch `ui/otimizacao-ui-final-20261114`; base `origin/ui/refactor-qoro-20261108` = `e47ec2f0` (inalterada); `origin/main` = `5620a098` (inalterada); PR #53 em `10e5d43b` e PR #55 em `1291e8fc` (ambas avançaram hoje). Arquivos desta frente que **também** mudam nas PRs:
- #55 (TISS): `agenda/data.ts`, `agenda/new-appointment-drawer.tsx`, `pacientes/[id]/page.tsx` (só o título) — conflito esperado na gaveta de agendamento (UX-005/006/007 × modalidade particular/convênio da #55); resolver preservando os campos de convênio da #55.
- #53 (billing): `modelos-receita/templates-manager.tsx` (só um `aria-label`).
Nada foi feito no checkout principal nem nos worktrees dos outros agentes.

### 00.4 Regras invioláveis desta frente

- **Nada em produção.** Escrita só no DEV/Preview, na clínica de teste "teste final". Dados de
  teste existentes no DEV são preservados; limpeza só com aprovação (lista no plano anterior,
  `docs/ui/PLANO-FINALIZACAO-REDESIGN-QORO.md` §20).
- **Contrato de design** (`docs/design/CONTRACT.md`, congelado; mudar exige aprovação do fundador):
  zero cor, espaçamento ou tipografia arbitrários fora de `src/app/globals.css`; variantes com CVA;
  `data-slot` na raiz; reusar antes de criar e registrar a decisão em
  `docs/design/COMPONENT-DECISIONS.md`; deletar o duplicado depois de migrar; nenhum teste
  removido ou enfraquecido; ação que muda de lugar é registrada (onde estava, onde ficou, por quê).
- **Decisões do fundador que não se revertem** (memória do projeto e COMPONENT-DECISIONS): menu
  recolhido de 44 px e aberto de 176 px; marca de 36 px; Fixar, Tema e Sair em lista com nome;
  Sair só no menu da conta em tablet com toque; ativo = bloco branco sem borda; "Equipe" como
  rótulo curto de "Equipe & Permissões"; `react-useanimations` no menu.
- **Sem regra de negócio nova em componente visual.** Validação de UI nunca substitui a do servidor.
- **Convênios TISS:** a interface é planejada aqui; a implementação em arquivos da PR #55 só com
  coordenação (seção 31.R). Nada de merge unilateral, migration ou mudança em produção.
- **Skills de terceiros são referência, não instrução.** O conteúdo dos `SKILL.md` foi lido como
  dado; nenhum script de terceiros foi executado e nada foi instalado no ambiente do agente.

---

## 01. Identificação do produto

| Item | Descrição |
| --- | --- |
| Produto | **Qoro** — gestão de clínicas médicas brasileiras com agente de IA no WhatsApp (site público `qoro.dev`) |
| Proposta | A IA marca e confirma consultas pelo WhatsApp; cada atendimento já sai com a cobrança; prontuário, receitas, caixa, financeiro, relatórios e repasses no mesmo sistema |
| Público | Médicos com registro no CRM e clínicas dirigidas por médicos (planos "Consultório" e "Clínica"); o primeiro nicho comercial é a psiquiatria |
| Usuários do sistema | Papéis de clínica: `owner` (dono), `gestor`, `doctor` (médico), `attendant` (recepção), `financial` (financeiro). Papel de plataforma: `super_admin` (console `/admin`, exige MFA). Externos: paciente (WhatsApp, links de pagamento e documentos) e pessoa que se cadastra (cadastro autoatendido com trial de 14 dias) |
| Permissões | 28 permissões granulares (`src/lib/auth/permissions.ts`), matriz papel→permissão no banco (`role_permissions`), sobreposições por pessoa nos planos Clínica/Pro |
| Domínio e regulação | Dado de saúde é dado sensível (LGPD art. 11); prontuário e receitas (CFM); cobrança de pacientes via Asaas da própria clínica; assinatura SaaS via AbacatePay (PR #53); Convênios/TISS (ANS) na PR #55 |
| Tecnologia | Next.js 15.5 (App Router, Server Components e Server Actions), React 19.2, TypeScript, Tailwind 4 (tokens em CSS), Radix (dialog, dropdown, popover, switch, tabs, tooltip, checkbox), lucide-react + `react-useanimations`, Drizzle + `postgres`, Supabase (Auth, Storage), Upstash (rate limit), Sentry, Vitest + happy-dom, Playwright |
| Restrições | Contrato de design congelado; decisões do fundador sobre o menu; nada em produção; PRs paralelas (#53 billing, #55 TISS); memória do projeto: marca pública é "Qoro", copy não promete "multa por falta" |

---

## 02. Estado atual do sistema

### 02.1 Arquitetura de interface

- **Grupos de rota:** `src/app/(app)` (público e autenticação) → `(app)/(shell)` (app da clínica,
  com o menu lateral `PainelShell`) e `src/app/(admin)/admin` (console da plataforma, `AdminShell`).
- **Middleware** (`src/middleware.ts`, 168 linhas): sessão, redirecionamentos de autenticação.
- **Gate de página:** `pageGate`/`page-guard.ts` exige a permissão de cada tela; o menu
  (`src/components/painel/modules.ts`) espelha o gate com `requires` (item some quando a pessoa não
  pode abrir) e `modules.test.ts` confere a correspondência.
- **Fronteiras de erro:** `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`,
  `(app)/(shell)/error.tsx`, `(admin)/admin/error.tsx`, `dashboard/error.tsx`.
- **Carregamento:** `loading.tsx` em 14 rotas (agenda, agenda/importar, caixa, configurações e 4
  subpáginas, consultório, dashboard, documentos, equipe, financeiro, fornecedores, modelos de
  receita, relatórios, convite); `route-loading-coverage.test.tsx` cobre a regra.

### 02.2 Design system

| Camada | Onde | Observação |
| --- | --- | --- |
| Tokens | `src/app/globals.css` (3.113 linhas) | Três camadas: `:root` (DS v2 legado), `qorov2` (telas de autenticação, Hanken + Inter) e **`app-v5`** (app da clínica e `/admin`: Inter no corpo, Manrope nos títulos e números; primária `#1A1ED5`; tinta `#0A0C25`; fundo do trilho `#EEF0F5`). Os tokens v5 valem em `body:has([data-qoro-shell='tenant'])` e `[data-qoro-tokens='app-v5']` |
| Primitivos | `src/components/ui/` (53 arquivos) | `button`, `field`, `input`, `select`, `combobox`, `date-field`, `checkbox`, `switch`, `segmented`, `option-card-group`, `textarea`, `dialog`, `drawer`, `confirm-dialog`, `destructive-action`, `popover`, `dropdown-menu`, `tooltip`, `tabs`, `nav-tabs`, `link-segmented`, `breadcrumbs`, `page-header`, `panel-card`, `card`, `data-table`, `table*`, `filter-bar`, `empty-state`, `page-skeleton`, `skeleton`, `spinner`, `alert`, `badge`, `status-badge`, `stat-card`, `metric-strip`, `stats-inline`, `bar-chart`, `stacked-bar`, `breakdown-list`, `summary-list`, `entity-cell`, `avatar`, `toaster`/`use-toast`, `use-action-feedback` |
| Shell | `src/components/painel/painel-shell.tsx`, `modules.ts`, `rail-animations.tsx`; `src/components/shared/shell-chrome.tsx`, `page-layout.ts`, `route-error.tsx`, `page-no-access.tsx` | Menu por grupos (Operação, Clínico, Gestão, Administração), filtrado por permissão, gaveta no celular com foco preso |
| Testes de contrato | `src/app/design-contract.test.ts`, `design-system-preset.test.ts`, `destructive-actions-migration.test.ts`, `field-accessibility.test.ts`, `motion-and-hit-targets.test.ts`, `route-loading-coverage.test.tsx`, `ui-content-consistency.test.ts` | Linha de base em 14/11: 34 arquivos, 224 testes, todos passando |

### 02.3 Dependências relevantes para UX

- Sem biblioteca de formulários (estado local + Server Actions + `useActionFeedback`).
- Sem biblioteca de gráficos (`bar-chart`, `stacked-bar`, `breakdown-list` próprios).
- Datas no fuso da clínica: `src/lib/datetime/clinic-calendar.ts` (data civil × instante; usar
  sempre que uma data for renderizada).
- PDFs com `@react-pdf/renderer`.

---

## 03. Inventário completo

### 03.1 Rotas e telas

Legenda de "Estados": L = `loading.tsx` próprio; E = fronteira de erro própria (todas herdam a
da raiz e, no shell, `(shell)/error.tsx`); "—" = sem estado próprio além do herdado.
Status da análise: ver a matriz de cobertura (03.4).

| ID | Rota | Tela | Perfil (permissão do gate) | Função | Estados | Componentes principais |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | `/` | Raiz | público | Redireciona conforme sessão | E | — |
| T02 | `/login` | Entrar | público | Login com e-mail e senha, recuperação inline | — | `LoginFrame`, formulário, Turnstile na recuperação |
| T03 | `/login/mfa` | Segundo fator | sessão AAL1 | Código TOTP | — | formulário |
| T04 | `/reset-password` | Nova senha | link de recuperação | Definir nova senha | — | `LoginFrame` |
| T05 | `/auth/auth-error` | Erro de autenticação | público | Explica link inválido | — | — |
| T06 | `/cadastro` | Cadastro (perfil, dados, senha) | público | Cadastro autoatendido em etapas | — | `SignupFrame`, `OptionCardGroup`, Turnstile |
| T07 | `/cadastro/verificacao` | Verificação de e-mail | cadastro em curso | Código enviado por e-mail | — | — |
| T08 | `/cadastro/confirmado` | E-mail confirmado | cadastro em curso | Retomada | — | — |
| T09 | `/cadastro/continuar` | Continuar cadastro | cadastro em curso | Retomada segura em outro aparelho | — | — |
| T10 | `/cadastro/plano` | Escolha do plano | cadastro em curso | Plano e ciclo | — | — |
| T11 | `/cadastro/pagamento` | Pagamento | cadastro em curso | Checkout hospedado | — | — |
| T12 | `/oferta-preview` | Prévia da oferta | interno | Prévia de preços | — | — |
| T13 | `/convite` | Convite | link de convite | Aceitar convite da equipe | L | — |
| T14 | `/join`, `/join/[token]` | Ativação de conta convidada | token | Assistente de ativação (dados, senha, CRM) | — | `join-wizard` (27 campos) |
| T15 | `/documentos/[id]/pdf`, `/prescricoes/[id]/pdf` | PDF de documento/receita | sessão + permissão | Visualizar PDF | — | — |
| T16 | `/dashboard` | Início | todos os papéis | Resumo do dia, "Precisa de você", indicadores | L, E | `PageHeader`, `StatCard`, `bar-chart`, `PanelCard` |
| T17 | `/agenda` | Agenda | `view:agenda` | Calendário, novo agendamento, sinal | L | `agenda-calendar`, `new-appointment-drawer`, `Drawer` |
| T18 | `/agenda/ausencias` | Ausências médicas | `manage:availability` | Bloqueios de agenda | — | `DataTable`, formulário |
| T19 | `/agenda/lista-espera` | Lista de espera | `view:agenda` | Ofertas de vaga | — | `waitlist-manager` |
| T20 | `/agenda/importar` | Importar histórico | `import:agenda` | Importação JSON | L | formulário de arquivo |
| T21 | `/consultorio` | Consultório | `view:consultorio` | Fila do dia, check-in, atendimento | L | `consultorio-board`, `waiting-card`, `attending-panel` |
| T22 | `/pacientes` | Pacientes | `view:patient` | Lista, busca, novo paciente | — | `DataTable`, `FilterBar`, formulário |
| T23 | `/pacientes/[id]` | Ficha do paciente | `view:patient` | Dados, histórico, documentos, LGPD | — | cartões, formulários, `DestructiveAction` |
| T24 | `/pacientes/[id]/prontuarios/[pid]` | Prontuário | `view:prontuario` | Editor, assinatura | — | `prontuario-editor` |
| T25 | `/documentos` | Documentos | `view:prescription` | Receitas e documentos | L | `DataTable` |
| T26 | `/modelos-receita` | Modelos de receita | `create:prescription` | Modelos | L | formulário |
| T27 | `/financeiro` | Financeiro | `view:financial` | Lançamentos, filtros por tipo | L | `link-segmented`, `DataTable` |
| T28 | `/financeiro/fornecedores` | Fornecedores | `view:financial` | Cadastro de fornecedores | L | formulário |
| T29 | `/caixa` | Caixa | `view:financial` (`operate:caixa` para operar) | Fila de cobranças do dia, recebimento | L | `caixa-view`, `cash-item-card` |
| T30 | `/conversas` | Conversas IA | `view:conversations` | Conversas do agente, fila de atendimento humano | — | lista |
| T31 | `/conversas/[id]` | Conversa | `view:conversations` | Histórico, assumir, responder | — | `conversa-actions` |
| T32 | `/relatorios` | Relatórios | por relatório | Ocupação, faltas, receita | L | `bar-chart`, `breakdown-list` |
| T33 | `/relatorios/repasses` | Repasses | `view:financial` | Repasse por profissional | — | tabelas |
| T34 | `/equipe` | Equipe & Permissões | `manage:employees` | Convites, papéis, permissões | L | `DataTable`, `ConfirmDialog` |
| T35 | `/configuracoes` | Configurações (índice) | por categoria | Hub de categorias | L | — |
| T36 | `/configuracoes/perfil` | Perfil da clínica | `manage:settings` | Dados da clínica (CNPJ, endereço) | — | formulário |
| T37 | `/configuracoes/horarios` | Horários | `manage:availability` | Grade de atendimento | — | formulário |
| T38 | `/configuracoes/procedimentos` | Procedimentos | `manage:procedures` | Catálogo e preços | L | formulário |
| T39 | `/configuracoes/recursos` | Recursos | `manage:settings` | Salas e recursos | L | formulário |
| T40 | `/configuracoes/pagamentos` | Pagamentos | `manage:settings` | Conta Asaas, sinal antecipado | — | formulário de credencial |
| T41 | `/configuracoes/whatsapp` | WhatsApp | `manage:settings` | Conexão Meta, perfil público, saúde de envio | — | editor de perfil (1.956 linhas na pasta) |
| T42 | `/configuracoes/agente` | Agente de IA | `manage:agent` | Comportamento do agente | — | formulário |
| T43 | `/configuracoes/assinatura` | Assinatura | `manage:settings` | Plano SaaS, cobrança | L | `ConfirmDialog` |
| T44 | `/configuracoes/lgpd` | LGPD | `manage:settings` | Exportação, retenção | — | formulários |
| T45 | `/configuracoes/auditoria` | Auditoria | `view:audit` | Exportar trilha | — | formulário de período |
| T46 | `/configuracoes/sugestoes` | Sugestões | todos | Enviar sugestão | L | formulário |
| T47 | `/documentacao`, `/documentação` (+ `[topic]`) | Ajuda | todos | Central de ajuda | — | artigos |
| T48 | `/account/security` | Segurança da conta | sessão | Senha e MFA | — | formulário |
| T49 | `/admin` | Console da plataforma — visão geral | `super_admin` + MFA | Saúde da plataforma | E | `AdminShell` |
| T50 | `/admin/clinicas`, `/admin/clinicas/[id]` | Clínicas | `super_admin` | Gestão de clínicas, cadastros pendentes | — | tabelas, formulários |
| T51 | `/admin/billing` | Cobrança SaaS | `super_admin` | Assinaturas | — | — |
| T52 | `/admin/config` | Configuração da plataforma | `super_admin` | Flags e avisos | — | formulários |
| T53 | `/admin/audit`, `/admin/saude`, `/admin/metricas`, `/admin/feedbacks` (+`[id]`), `/admin/conversas-ia` | Console | `super_admin` | Operação da plataforma | — | tabelas |
| T54 | rota inexistente | Página não encontrada | público | 404 | — | `not-found.tsx` |

**Convênios TISS (somente na PR #55; não existem nesta branch):**

| ID | Rota | Tela | Perfil | Função | Situação (seção 31.A) |
| --- | --- | --- | --- | --- | --- |
| C01 | `/convenios` | Painel de Convênios | `view:financial` (agir: `manage:financial`) | Totais por natureza de valor, o que falta faturar, pendências por responsável, por operadora | implementada (PR #55), não habilitada para usuários reais |
| C02 | `/convenios/atendimentos` | Atendimentos por convênio | idem | Atendimentos e guias de origem | implementada |
| C03 | `/convenios/solicitacoes` (+`[requestId]`) | Solicitações SP/SADT | idem | Autorizações | implementada (parcial: conector bloqueado) |
| C04 | `/convenios/guias` (+`[guideId]`) | Guias | idem | Etapas, pendências, responsável | implementada |
| C05 | `/convenios/lotes` (+`[batchId]`) | Lotes | idem | Gerar e validar XML, protocolo, pagamentos, glosas | implementada |
| C06 | `/convenios/conciliacao` | Conciliação | idem | Pagamentos da operadora × guias; coparticipações | implementada |
| C07 | `/convenios/repasses` | Repasses | idem | Repasse de convênio | implementada |
| C08 | `/convenios/carteirinhas` | Carteirinhas | edição de paciente | Carteirinhas dos pacientes | implementada |
| C09 | `/convenios/configuracao` (+`operadoras/[insurerId]`) | Configuração | `manage:financial` | Operadoras, planos, contratos, credenciamento, importação | implementada (`config-ui.tsx`, 1.985 linhas) |
| C10 | Agenda: `billing-mode-dialog`, `insurance-billing-fields` | Modalidade e convênio no agendamento | `edit:agenda` | Particular × convênio, plano, carteirinha | implementada na PR #55 |
| C11 | Consultório: `attending-panel`, `waiting-card` | Pendências de convênio no atendimento | `view:consultorio` | Sinalizar guia/autorização | implementada na PR #55 |

### 03.2 Entradas (inputs) por tela — contagem estática

Contagem feita por script sobre o código (`<Input>`, `<select>`, `Combobox`, `DateField`,
`Checkbox`, `Switch`, `Segmented`, `OptionCardGroup`, `Textarea`). Total: **381 controles em 81
formulários; 147 envolvidos por `Field`**. Atributos de apoio: `autoComplete` 43, `inputMode` 37,
`type` específico (email/tel/number/date/time/password/search/url) 53, `aria-invalid` **4**,
`aria-describedby` **15**. Telas com mais campos: `/join/[token]` (27), `/pacientes/[id]` (30),
`/consultorio` (23), `/agenda` (21), `/pacientes` (20), `/cadastro` (16).
Detalhe campo a campo: seção 12.

### 03.3 Saídas (outputs) por tela

Indicadores e gráficos (`/dashboard`, `/relatorios`, `/relatorios/repasses`), listas e tabelas
(`DataTable` em 4 telas; listas próprias nas demais), PDFs (receitas, documentos, guias TISS),
exportações (auditoria CSV, LGPD), mensagens de resultado (`useActionFeedback`, `toast`),
estados de integração (WhatsApp/Meta, Asaas, AbacatePay). Análise: seção 13.

### 03.4 Matriz de cobertura

Estados: NÃO_INICIADO · EM_ANALISE · ANALISADO · PLANEJADO · IMPLEMENTADO · VALIDADO · BLOQUEADO ·
NÃO_APLICÁVEL. "Analisado" nunca vale como "validado".

| Tela | UI | UX | Psicologia | Humanização | Acessibilidade | Mobile | Estados | Testes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T02–T05 Autenticação | ANALISADO | IMPLEMENTADO (UX-002) | ANALISADO | PLANEJADO (UX-003, UX-014) | IMPLEMENTADO (título) / PLANEJADO (UX-017, UX-018) | ANALISADO | IMPLEMENTADO (erro de serviço) | IMPLEMENTADO (unitários) |
| T06–T12 Cadastro | BLOQUEADO (cadastro fechado no ambiente local) | NÃO_INICIADO | NÃO_INICIADO | NÃO_INICIADO | IMPLEMENTADO (título) | BLOQUEADO | ANALISADO (tela "indisponível") | NÃO_INICIADO |
| T13–T14 Convite/ativação | ANALISADO (estados de erro) | ANALISADO | NÃO_INICIADO | PLANEJADO (UX-017) | PLANEJADO (UX-017) | ANALISADO | ANALISADO | NÃO_INICIADO |
| T16 Dashboard | ANALISADO | PLANEJADO (UX-011) | ANALISADO | ANALISADO | PLANEJADO (UX-011, UX-018) | PLANEJADO (UX-011) | ANALISADO | NÃO_INICIADO |
| T17–T20 Agenda | ANALISADO | IMPLEMENTADO (UX-005 piloto, UX-007) / PLANEJADO (UX-006) | ANALISADO | IMPLEMENTADO (aviso de sucesso) | IMPLEMENTADO (UX-001, UX-005) | PLANEJADO (UX-012) | IMPLEMENTADO | IMPLEMENTADO (unitários) |
| T21 Consultório | ANALISADO (vazio) | NÃO_INICIADO (sem massa com fila do dia) | NÃO_INICIADO | ANALISADO | ANALISADO | ANALISADO | ANALISADO (vazio) | NÃO_INICIADO |
| T22–T24 Pacientes/prontuário | ANALISADO | ANALISADO | ANALISADO | PLANEJADO (UX-014) | ANALISADO | ANALISADO | ANALISADO | NÃO_INICIADO |
| T25–T26 Documentos | ANALISADO | ANALISADO | NÃO_INICIADO | ANALISADO | ANALISADO | ANALISADO | ANALISADO | NÃO_INICIADO |
| T27–T29 Financeiro/Caixa | ANALISADO | PLANEJADO (UX-015) | ANALISADO | PLANEJADO (UX-015) | ANALISADO | ANALISADO | ANALISADO | NÃO_INICIADO |
| T30–T31 Conversas | ANALISADO | VALIDADO no local (UX-009) | ANALISADO | PLANEJADO (UX-014) | ANALISADO | PLANEJADO (UX-016) | VALIDADO no local (UX-009) | IMPLEMENTADO (unitários + 3 sondas) |
| T32–T33 Relatórios | ANALISADO | ANALISADO | ANALISADO | ANALISADO | ANALISADO | PLANEJADO (UX-012) | ANALISADO | NÃO_INICIADO |
| T34 Equipe | ANALISADO | ANALISADO | NÃO_INICIADO | PLANEJADO (UX-014) | ANALISADO | ANALISADO | EM_ANALISE (hidratação 1× em 10, P-10) | NÃO_INICIADO |
| T35–T46 Configurações | ANALISADO | ANALISADO | NÃO_INICIADO | ANALISADO | ANALISADO | ANALISADO | ANALISADO (Pagamentos: erro de conexão sob carga, 19.1) | NÃO_INICIADO |
| T47 Ajuda | ANALISADO | ANALISADO | NÃO_APLICÁVEL | ANALISADO | ANALISADO | ANALISADO | ANALISADO | NÃO_INICIADO |
| T48 Segurança da conta | ANALISADO | NÃO_INICIADO | NÃO_INICIADO | ANALISADO | ANALISADO | ANALISADO | NÃO_INICIADO | NÃO_INICIADO |
| T49–T53 Console admin | BLOQUEADO | BLOQUEADO | BLOQUEADO | EM_ANALISE (código) | BLOQUEADO | BLOQUEADO | BLOQUEADO | NÃO_INICIADO |
| T54 404 | ANALISADO (deslogado vai ao login) | ANALISADO | NÃO_APLICÁVEL | ANALISADO | ANALISADO | ANALISADO | NÃO_APLICÁVEL | NÃO_INICIADO |
| C01–C11 Convênios | ver 31.S.6 | | | | | | | |

---

## 04. Registro das skills

### 04.1 Política adotada

- Todos os repositórios foram verificados pela API do GitHub em 14/11/2026 (existência, licença,
  último push, commit `HEAD`, caminho do `SKILL.md`).
- **Instalada = NÃO para todas.** Motivo: instalar no ambiente do agente tornaria instruções de
  terceiros carregáveis em sessões futuras, e várias skills dependem de scripts ou binários
  externos (o Impeccable baixa um executável no primeiro uso; o UI UX Pro Max roda um buscador em
  Python; o React Doctor roda pacotes via `npx`). O próprio prompt mestre manda não executar
  scripts desconhecidos sem verificar procedência. A leitura foi feita diretamente do `SKILL.md`
  (texto), tratada como referência. Se o fundador quiser a instalação, ela fica como pendência
  (seção 28).
- **Lida = SIM** só quando o arquivo foi efetivamente lido nesta rodada; "LEITURA PARCIAL" quando
  foram lidos o resumo, os títulos e as regras (leitura condensada); "VERIFICADA" quando só a
  existência foi confirmada (leitura prevista para o lote indicado).
- Cópias de leitura (texto) ficaram no scratchpad da sessão, que é temporário; a fonte
  verificável é o repositório + caminho + commit abaixo.

### 04.2 Repositórios principais

| Skill | Fonte (repositório · caminho · commit) | Instalada | Lida | Aplicação | Evidência |
| --- | --- | --- | --- | --- | --- |
| R1 UI UX Pro Max | `nextlevelbuilder/ui-ux-pro-max-skill` · `.claude/skills/ui-ux-pro-max/SKILL.md` · `d643997c82` (MIT) | NÃO | LEITURA PARCIAL | Checklist de prioridade (acessibilidade e interação antes de estética); ferramenta de busca **não executada** (script Python) | 04.4 |
| R2 Frontend Design | `anthropics/skills` · `skills/frontend-design/SKILL.md` · `1780c5e5a5` (licença no próprio arquivo) | NÃO | SIM (71 linhas) | Escrita de interface (verbo + objeto, ação com o mesmo nome do início ao fim, erro diz o que houve e como sair, vazio convida a agir); evitar etiquetas em caixa alta, numeração decorativa e "kit de cartões" | 06, 10 |
| R3 Design Agent Skills | `podo/design-agent-skills` · `skills/*/SKILL.md` (170) · `e04dbc882c` (MIT) | NÃO | VERIFICADA | Catálogo de "stubs" que apontam para o repositório original de cada skill (tabela 04.3) | 04.3 |
| R4 Designer Skills | `Owl-Listener/designer-skills` · 111 `SKILL.md` · `9a6930cf84` (MIT) | NÃO | 63 lidas (tabela 04.3) | Heurísticas, formulários, erros, estados, IA, leis de UX, Gestalt | 06–18 |
| R5 Humanizer | `blader/humanizer` · `SKILL.md` · `b48c832f0f` (MIT) | NÃO | LEITURA PARCIAL | Marcas de texto artificial (encenação, ritmo por regra, inflação, formatação por regra); aplicado como checklist de revisão de copy | 10 |
| R6 Human Grade Frontend | `edmondyv/human-grade-frontend-design` · `skills/human-grade-frontend-design/SKILL.md` · `c1df43538e` (MIT) | NÃO | LEITURA PARCIAL | Teste de convergência ("isto é o padrão de IA?"). **Conflito registrado:** a skill proíbe Inter e system-ui; o app v5 usa Inter no corpo por decisão aprovada e por ser superfície operacional (o modo Operate do Impeccable permite sans familiares). Não aplicada nesse ponto | 05, 26 |
| R7 Impeccable | `pbakaus/impeccable` · `.claude/skills/impeccable/SKILL.md` + `reference/{operate,craft-floor,critique,audit,harden,clarify,onboard,adapt,polish}.md` · `1995764b49` (Apache-2.0) | NÃO | SIM (núcleo + 9 referências; condensado) | Modo **Operate** para o app (consistência e escaneabilidade acima de expressão; movimento 150–250 ms só para estado; esqueleto em vez de spinner; vazio que ensina; modal não é a primeira opção); piso de qualidade; auditoria em 5 dimensões; `harden` (textos longos, erros de rede, 401/403/404/500); `clarify` (o que falhou, por quê, como sair). Launcher/binário **não executado** | 06–19 |
| R8 Taste Skill | `Leonxlnx/taste-skill` · `skills/taste-skill/SKILL.md` · `f6b76575f9` (MIT) | NÃO | LEITURA PARCIAL | Voltada a páginas de marketing (fotos, cenas, "deal" de seções). Aplicado só: bordas laterais iguais e verificação em 1440/1024/768/390. Resto não se aplica a app operacional | 17 |
| R9 Fluid Design | `kemiljk/fluid-design` · `skills/fluid-design/SKILL.md` · `667d1189f3` (MIT) | NÃO | LEITURA PARCIAL | Molas e gestos interrompíveis: relevante só para gaveta e arrastar no celular; nada a adotar sem demanda | 17 |
| R10 Emil Design Engineering | `emilkowalski/skills` · `skills/emil-design-eng/SKILL.md` · `0f2e23b32b` (MIT) | NÃO | LEITURA PARCIAL (estrutura + regras) | Não animar ações de teclado; UI < 300 ms (gaveta/modal até 500 ms); nunca `ease-in`; nunca animar de `scale(0)`; popover nasce da origem; tooltip sem atraso depois do primeiro | 17, 18 |
| R11 UX Writing | `content-designer/ux-writing-skill` · `SKILL.md` · `98cacde4ba` (MIT) | NÃO | SIM (condensado) | Padrões: títulos em frase nominal e caixa de frase; botão `[Verbo] [objeto]`; erro `[o que falhou]. [por quê]. [o que fazer]`; validação inline `[campo] [requisito]` | 10, 12 |
| R12 Humanize Text | `gregorymm/humanize-text` · `skills/humanize-text/SKILL.md` · `f5dcf25e33` (MIT) | NÃO | LEITURA PARCIAL | Avaliação de copy de UX quanto a sinais de texto gerado; usado como segunda passada na revisão de mensagens | 10 |

### 04.3 Skills específicas por categoria

**R3 — catálogo; cada linha é o repositório original verificado:**

| Skill (R3) | Original verificado | Licença | Instalada | Lida | Aplicação |
| --- | --- | --- | --- | --- | --- |
| ui-craft | `educlopez/ui-craft` | MIT | NÃO | VERIFICADA | Lote 6 (polimento) |
| hallmark | `Nutlope/hallmark` | MIT | NÃO | VERIFICADA | Lote 6 |
| make-interfaces-better | `jakubkrehel/make-interfaces-feel-better` · `skills/make-interfaces-feel-better/SKILL.md` | MIT | NÃO | LEITURA PARCIAL | Formato de achado (severidade, local, antes/depois, por quê) adotado na seção 24 |
| distinctive-frontend | `Zambudio/buenchollo-app` · `.agents/skills/distinctive-frontend/SKILL.md` | sem licença | NÃO | VERIFICADA | Não aplicada (sem licença declarada) |
| design-for-ai | `ryanthedev/design-for-ai` | sem licença | NÃO | VERIFICADA | Não aplicada (sem licença declarada) |
| styleseed | `bitjaru/styleseed` · `skills/styleseed/SKILL.md` | MIT | NÃO | VERIFICADA | Lote 6 |
| awesome-design-skills | `bergside/awesome-design-skills` (67 SKILL.md) | MIT | NÃO | VERIFICADA | Catálogo; sem aplicação direta |
| huashu-design | `alchaincyf/huashu-design` · `SKILL.md` | MIT | NÃO | VERIFICADA | Lote 6 |
| wireframer / wireframe-skill / claude-wireframe-skill | `agilek/wireframer-skill` (sem licença) · `yhassy/wireframe-skill` (MIT) · `Magdoub/claude-wireframe-skill` (MIT) | — | NÃO | VERIFICADA | Wireframes ASCII das propostas TISS (31.S) usam a técnica sem depender das skills |
| color-expert | `meodai/skill.color-expert` · `SKILL.md` | CC-BY-4.0 | NÃO | VERIFICADA | Lote 2 (tokens de status) |
| fixing-accessibility | `ibelick/ui-skills` · `skills/fixing-accessibility/SKILL.md` | MIT | NÃO | LEITURA PARCIAL | Formato de achado de acessibilidade (trecho exato, por que importa, correção) |
| wcag-audit-patterns | `wshobson/agents` · `plugins/accessibility-compliance/skills/wcag-audit-patterns/SKILL.md` | MIT | NÃO | LEITURA PARCIAL | Automação cobre 30–50%; teste manual obrigatório (seção 25) |
| wcag-ai-skill | `Raze-Systems/wcag-ai-skill` · `.agents/skills/wcag-2.2/SKILL.md` | sem licença | NÃO | LEITURA PARCIAL | Lista de critérios WCAG 2.2 usada como índice (não reproduzida) |
| dark-pattern-audit | `SidKH/skills` · `dark-pattern-audit/SKILL.md` | sem licença | NÃO | LEITURA PARCIAL | Roteiro de busca (preço, assinatura, trial, cancelamento, consentimento, pré-seleção, CTA enganoso) aplicado na seção 20 |
| design-tokens-skill | `ilikescience/design-tokens-skill` · `SKILL.md` | MIT | NÃO | VERIFICADA | Lote 2 |
| extract-design-system | `arvindrk/extract-design-system` | MIT | NÃO | VERIFICADA | Não necessária (tokens já extraídos em `globals.css`) |
| work-with-design-systems | `natdexterra/work-with-design-systems` · `SKILL.md` | MIT | NÃO | VERIFICADA | Lote 2 |
| figma-variables-tokens-generator | `Shanmus4/figma-variables-tokens-generator` | Apache-2.0 | NÃO | VERIFICADA | Não aplicável (sem Figma no fluxo; o canvas de referência é do Claude Design) |
| design-motion-principles | `kylezantos/design-motion-principles` · `skills/design-motion-principles/SKILL.md` | MIT | NÃO | VERIFICADA | Lote 7 |
| motion-design-skill | `lottiefiles/motion-design-skill` · `skills/motion-design/SKILL.md` | MIT | NÃO | VERIFICADA | Lote 7 |
| gsap-skills / motion / framer-motion-skills / animate-skill / css-animation-skill / animate-css-skill / wiggle-claude-skill | `greensock/gsap-skills` (MIT) · `motiondivision/ai-kit` (sem licença) · `C-Jeril/framer-motion-skills` (MIT) · `delphi-ai/animate-skill` (sem licença) · `neonwatty/css-animation-skill` (MIT) · `msrbuilds/animate-css-skill` (sem licença) · `talknerdytome-labs/wiggle-claude-skill` (NOASSERTION) | — | NÃO | VERIFICADA | **Não aplicáveis por decisão:** o app não usa GSAP nem Framer Motion e o prompt veda dependência pesada sem benefício; movimento segue em CSS (seção 17) |
| figma-official-skills / google-stitch-skills | `figma/mcp-server-guide` (sem licença) · `google-labs-code/stitch-skills` (Apache-2.0) | — | NÃO | VERIFICADA | Não aplicáveis (sem Figma/Stitch no fluxo) |
| mobile-app-design / mobile-app-ui-design / apple-hig-skills / material-3-skill / swiftui-design-skill | `awesome-skills/mobile-app-design` (sem licença) · `ceorkm/mobile-app-ui-design` (sem licença) · `raintree-technology/hig-doctor` (MIT) · `hamen/material-3-skill` (MIT) · `wholiver/swiftui-design-skill` (MIT) | — | NÃO | VERIFICADA | App nativo não existe; aplicadas só as convenções de toque e alvo (44 px) via R4 `fitts-law` |
| excalidraw-diagram | `coleam00/excalidraw-diagram-skill` | sem licença | NÃO | VERIFICADA | Não aplicada |
| react-doctor | `millionco/react-doctor` · `skills/react-doctor/SKILL.md` | NOASSERTION | NÃO | LEITURA PARCIAL | Roda pacote externo via `npx` (**não executado**); critérios de hidratação e render aplicados manualmente (seção 19) |

**R4 — Designer Skills (caminho `<plugin>/skills/<nome>/SKILL.md` no commit `9a6930cf84`):**

| Grupo | Skills lidas nesta rodada (SIM, condensado) | Aplicação |
| --- | --- | --- |
| Avaliação e pesquisa | `heuristic-evaluation`, `usability-test-plan`, `user-flow-diagram`, `empathy-map`, `user-persona`, `journey-map`, `jobs-to-be-done`, `service-blueprint`, `metrics-definition`, `test-scenario` | Nielsen 0–4 por tela; hipóteses de persona marcadas como hipótese (seção 13 do prompt); JTBD por papel |
| Interação | `form-design`, `error-handling-ux`, `loading-states`, `feedback-patterns`, `state-machine`, `navigation-patterns`, `information-architecture`, `search-ux`, `onboarding-design`, `micro-interaction-spec`, `interfaces-that-feel`, `conversational-ux`, `platform-conventions` | Regras de formulário (coluna única, rótulo persistente, erro sob o campo, validar no blur), faixas de espera (<100 ms nada; 100 ms–1 s sutil; 1–10 s claro; >10 s progresso), estados exaustivos, IA por tarefa |
| Leis de UX e Gestalt | `hicks-law`, `fitts-law`, `jakobs-law`, `millers-law`, `teslers-law`, `doherty-threshold`, `peak-end-rule`, `zeigarnik-effect`, `von-restorff-effect`, `serial-position-effect`, `law-of-proximity`, `law-of-similarity`, `law-of-figure-ground`, `law-of-closure`, `law-of-common-region`, `law-of-continuity`, `aesthetic-usability` | Seção 09 |
| Visual e sistema | `visual-hierarchy`, `layout-grid`, `typography-scale`, `color-system`, `spacing-system`, `readable-measure`, `responsive-design`, `dark-mode-design`, `data-visualization`, `design-token`, `component-spec`, `motion-system`, `icon-system`, `theming-system`, `pattern-library`, `localization-design`, `animation-principles`, `critique-composition`, `critique-typography`, `critique-color`, `critique-visual-hierarchy` | Seções 07, 14, 16, 17 |
| Pedidas e inexistentes | `cognitive-walkthrough` (**INDISPONÍVEL**: não existe no repositório; substituída pelo passo a passo de tarefa do `heuristic-evaluation` e do Impeccable `critique`); `colour-system` = grafia alternativa de `color-system` (não é skill separada) | — |
| Pedidas e ainda não lidas | `interview-script`, `survey-design`, `affinity-diagram`, `card-sort-analysis`, `diary-study-plan`, `behavioural-analytics`, `qual-quant-triangulation`, `research-repository`, `summarize-interview`, `click-test-plan`, `prototype-strategy`, `illustration-style`, `ux-writing` (lida), `gesture-patterns` | Plano de validação com usuários (seção 25.6), sem pesquisa real disponível |

**Complementares (verificados; leitura prevista quando a categoria for trabalhada):**
`arez-xd/ux-ui-design-taste` (MIT), `madebymustafa/design-taste` (MIT, 24 skills),
`rgranet/designlint-skill` (MIT), `sandipmandalgit/design_taste` (MIT), `mager/frontend-design`
(sem licença), `PracticalSwan/agent-skills` (MIT, 253), `Emmraan/agent-skills` (MIT, 181),
`notmehul/skills` (NOASSERTION, 48), `NousResearch/hermes-agent` (MIT, 186),
`rshankras/claude-code-apple-skills` (MIT, 184), `SkillMedev/skills` (MIT, 482),
`markj81/ux-writing` (sem licença), `ghaida/intent` (CC0, 18), `glebis/humane-agentic-design`
(MIT, 21), `wondelai/skills` (MIT, 196), `travisjneuman/.claude` (MIT, 184). Todos acessíveis em
14/11/2026. Status: VERIFICADA, Instalada NÃO, Lida NÃO.

### 04.4 Como as skills mudaram o diagnóstico (resumo)

1. **Modo Operate (R7)** definiu o critério estético do app: precisão e consistência acima de
   expressão; a marca aparece nos detalhes, não em campos de cor ou animação de entrada.
2. **`form-design` e `error-handling-ux` (R4) + `clarify` (R7) + UX Writing (R11)** guiaram a
   auditoria de campos e mensagens: rótulo persistente, erro ligado ao campo, mensagem com causa e
   saída. Daí os achados UX-001 e UX-002.
3. **`loading-states` + `doherty-threshold` (R4)** deram as faixas de espera usadas para julgar
   telas lentas e o retorno do menu.
4. **`dark-pattern-audit` (R3→SidKH)** organizou a revisão de trial, assinatura, cancelamento e
   cobrança (seção 20).
5. **R2 e R6** serviram de teste de convergência; o conflito de fonte foi registrado e resolvido a
   favor do contexto operacional (seção 26, D-03).

---

## 05. Referência visual — qoro.dev

### 05.1 O que foi observado (medido no navegador em 14/11/2026)

| Aspecto | Observação |
| --- | --- |
| Tipografia | Uma família só: **Manrope**. H1 69 px, peso 600, tracking −0,04 em; H2 44 px, 600, −0,035 em; corpo 16 px / 25,6 px; parágrafo com largura máxima de 540 px (~60 caracteres) |
| Cor | Texto em azul-marinho `#14162F`; campo de marca **`#1A1ED5`** (painel do topo com raio de 36 px); fundo branco; CTA principal em pílula branca sobre o azul, secundário em azul translúcido |
| Movimento | Tokens curtos: entrada 140 ms, saída 200 ms, pressão 90 ms, curva `cubic-bezier(.2,.8,.2,1)`; rolagem de letras no hover do CTA com rótulo `sr-only` e animação `aria-hidden` (acessível) |
| Estrutura | Pular para o conteúdo; menu Como funciona · Especialidades · Preços · Segurança · Conteúdo; seções com uma ideia cada |
| Conteúdo e confiança | Rótulo "Exemplo ilustrativo" em toda tela simulada; calculadora com "premissas à vista para você poder discordar delas" e aviso "não é resultado medido nem promessa"; quadro "O que ela faz / O que ela nunca faz"; segurança com medidas concretas (AES-256, TLS 1.3, isolamento por clínica, trilha de auditoria); tarifas de terceiros ditas no preço |
| Mobile (375 px) | Menu em ícone, CTAs empilhados em largura total, painel do topo recuado; sem rolagem lateral (medido: `scrollWidth` = 375) |

### 05.2 O que se aplica ao app

- **A mesma marca:** o app v5 já usa `#1A1ED5` como primária e Manrope nos títulos e números.
  Manter.
- **Honestidade como padrão de interface:** separar exemplo de dado real, mostrar premissa e
  origem de números, dizer o que o sistema não faz. No app isso vira: rótulo de período e origem
  em cada indicador; "planejado" nunca parecer "disponível"; sucesso só depois da confirmação.
- **Tempos de movimento curtos** (90–200 ms) e curva de saída rápida: compatíveis com o modo
  Operate e com R10.
- **Linguagem direta, em caixa de frase, verbo + objeto.**

### 05.3 O que evitar ao levar a referência para o app

- O campo de cor cheia (painel azul de 36 px de raio) é recurso de página de venda; no app, a
  primária fica restrita a ação principal, seleção e estado (R7 Operate: cor de destaque não é
  decoração).
- Títulos de 44–69 px e tracking agressivo não servem a telas de trabalho: o app mantém a escala
  fixa em rem e a razão 1,125–1,2 entre degraus.
- Telas simuladas e números de vitrine (big number + rótulo pequeno) não entram como padrão de
  dashboard (R7 craft-floor: "hero-metric template" é recusado).

### 05.4 Como a identidade do app difere do site

O site **persuade**; o app **opera**. O app herda a marca (cor, Manrope, tom de voz honesto) e se
diferencia pela densidade útil, pelo cinza do trilho (`#EEF0F5`) como segunda camada neutra, pela
tipografia de corpo em Inter para leitura longa de dados e por cor usada só com significado.
Observação: o prompt mestre pede "personalidade visual distinta da Qoro", mas o sistema auditado
**é** o produto Qoro; a leitura correta (seção 3 do prompt: "se o sistema já possui identidade de
marca, aproveite e evolua") é manter a marca e diferenciar o modo de uso. Decisão D-02 (seção 26).

### 05.5 Por que isso favorece o usuário

Quem chega do site reconhece o produto (Lei de Jakob aplicada à própria marca); a cor com
significado reduz a busca visual (Von Restorff só onde há prioridade); números com origem e período
evitam decisão errada em dashboard; e a honestidade do site, levada à interface, sustenta a
confiança em telas financeiras e clínicas.

---

## 06. Diagnóstico global

> Achados sistêmicos com evidência. Cada um vira intervenção nas seções 21–23. Os achados por
> tela entram nas seções 07–21 à medida que a auditoria dinâmica é lida.

| # | Achado | Evidência | Impacto | Intervenção |
| --- | --- | --- | --- | --- |
| G-01 | **Erros de formulário não ficam ligados ao campo — e quase nunca ficam perto dele.** (a) `Field` mostrava dica e erro em `<p>` sem `id`, sem `aria-describedby` nem `aria-invalid` no controle. (b) Só **7 dos 147** `Field` recebem `error=` (2 arquivos); **16 formulários** guardam um único texto de erro (`useState<string \| null>` + `setError`) e mostram uma falha por vez, longe do campo (novo agendamento, Caixa, convite da equipe, gavetas do consultório, painéis de pagamentos, fornecedores) | `src/components/ui/field.tsx`; contagem estática em 14/11: 381 controles, 147 em `Field`, 28 com `hint=`, 7 com `error=`, `aria-invalid` em 4 lugares, `aria-describedby` em 15; lista dos 16 formulários em UX-005 | Leitor de tela anuncia o campo sem o erro nem a dica (WCAG 1.3.1, 3.3.1, 3.3.3); a pessoa corrige um campo, envia, recebe o próximo erro (descoberta sequencial) | UX-001 (P1, feito) e UX-005 (P2) |
| G-02 | **Falha do serviço de login aparece como senha errada.** `loginAction` devolve "Email ou senha inválidos." para qualquer erro do `signInWithPassword`, inclusive falha de rede | `src/app/(app)/login/actions.ts` (bloco `if (error \|\| !data.user)`); log do servidor local em 14/11: `TypeError: fetch failed` seguido de `auth.login.failed reason=invalid_credentials` | A pessoa acha que errou a senha, tenta de novo, cai no limite de tentativas e pode trocar a senha sem necessidade; o suporte não distingue queda de erro de senha (métrica poluída) | UX-002 (P1) |
| G-03 | **Mensagens de sistema com variações e termos técnicos.** Três versões de "sessão expirada"; "tente novamente" × "tente de novo"; "Email" × "E-mail"; "Profile inválido. Contate o administrador." (inglês, sem saída); "no maximo" sem acento; mensagens de desenvolvedor ("id ausente.", "patientId ausente.", "parâmetros ausentes.") que podem chegar a um toast | `grep` das mensagens `error: '…'` em `src/app` e `src/contexts` (14/11) | Inconsistência quebra o aprendizado (Jakob/consistência, Nielsen 4); mensagens técnicas não dizem o que fazer (Nielsen 9) | UX-003 (P2) |
| G-04 | **Tons de status fora do contrato de tokens.** `Badge` `teal` e `violet` usam `oklch(...)` literal no `className` | `src/components/ui/badge.tsx` linhas 25–27 | Contrato §1 (zero cor fora de `globals.css`); tons sem significado documentado no app v5 (o TISS usa 7 tons para status) | UX-004 (P3) e UX-TISS-005 |
| G-06 | **Todas as abas com o mesmo título "Qoro".** O layout raiz define `title: 'Qoro'` sem modelo e só 5 páginas definiam título próprio, com três separadores diferentes (`|`, `·`, `—`) | `src/app/layout.tsx`; varredura de 14/11: `document.title` = "Qoro" em `/login`, `/cadastro`, `/reset-password`, `/convite`, `/join`, `/auth/auth-error` | WCAG 2.4.2 (nível A): leitor de tela anuncia "Qoro" em toda navegação; abas e histórico indistinguíveis | UX-008 (P1, feito) |
| G-07 | **Atualizações automáticas sem limite de concorrência.** Refresh de `/conversas` a cada 10 s e consulta de handoffs a cada 20 s disparavam mesmo com a anterior em andamento | INC-01 (19.1): renders de 3–35 s e `POST` de 9–28 s sobrepostos | Carga autoinfligida no pool e no servidor; tela mais lenta justamente quando o servidor já está lento | UX-009 (P1, feito) |
| G-05 | **Datas formatadas fora do calendário da clínica no TISS.** `shortDate` usa `toLocaleDateString('pt-BR')` sem fuso | PR #55, `src/app/(app)/(shell)/convenios/_lib/access.tsx` | Data de protocolo/pagamento pode aparecer com um dia de diferença perto da meia-noite (servidor em UTC × navegador em BRT) e divergir entre servidor e cliente | UX-TISS-006 (P1) |

---

## 07. Interface e composição visual

Base: varredura completa de 14/11 (39 rotas × 5 larguras, 195 fotos em
`.tmp/ui-audit/evidence/2026-11-14/varredura-completa/`; pranchas em `…/mini/prancha-*.png`),
conta "teste final" (papel dono), fontes reais injetadas no navegador.

**Visão geral.** O app v5 é coeso: mesma moldura, mesma tipografia, mesma paleta, tabelas e
listas consistentes, nenhuma rolagem lateral em nenhuma largura. O problema não é estética; é
**prioridade**: quase tudo é um cartão com título do mesmo peso (padrão "kit de cartões" do R2/R7
`craft-floor`), então a ordem vertical é o único sinal de importância — e em várias telas a ordem
põe o que exige ação depois do que está zerado.

| Tela | Classificação | Motivo principal | IDs |
| --- | --- | --- | --- |
| Dashboard | Reestruturação parcial | "Precisa de você" (ações pendentes, ex.: Meta limitando mensagens, 3 conversas à espera) vem no 3º bloco à direita no desktop e abaixo da dobra no celular, depois de 4 indicadores zerados; `h1` é a saudação, não o nome da tela | UX-011 |
| Agenda | Ajuste de componentes | Cabeçalho com 4 ações quebra em 3 linhas no celular; gaveta de novo atendimento (UX-005/006/007) | UX-012, UX-006 |
| Consultório | Nenhuma alteração visual agora | Estado vazio claro; revisar com dados (fila cheia) — pendente de massa de teste com atendimentos do dia | — |
| Pacientes (lista) | Nenhuma alteração | Tabela clara, busca no topo, ação principal visível; CPF mascarado | — |
| Ficha do paciente | Ajuste de componentes | Cartão de identidade ocupa a primeira tela do celular; subtítulo com jargão ("governança do cadastro"); "Conceder" no consentimento LGPD | UX-014 |
| Caixa | Ajuste de componentes | Item sem paciente tem como título a ausência ("Sem paciente vinculado") e a descrição truncada; duas ações de pagamento lado a lado sem diferença explícita ("Confirmar pagamento" × "Pagou em dinheiro") | UX-015 |
| Financeiro | Padronização | Filtro de status exige "Filtrar" (decisão registrada: sem JavaScript novo); resto consistente | — |
| Conversas IA | Ajuste de componentes | "SLA vencido há 5 d" (jargão); aviso "N conversas aguardam atendimento" aparece na própria tela de Conversas e cobre a lista no celular | UX-014, UX-016 |
| Equipe & Permissões | Ajuste de componentes | Contagem exibe "Super admin 0 — fora do tenant" para a clínica (papel da plataforma e jargão) | UX-014 |
| Configurações (hub e subpáginas) | Nenhuma alteração estrutural | Hub por categorias claro; subpáginas consistentes | — |
| Documentos | Nenhuma alteração | Lista e filtros claros | — |
| Relatórios / Repasses | Refinamento visual | Período em segmentado quebra em 2 linhas no celular; taxa de faltas com amostra pequena é honesta ("de consultas com desfecho") | UX-012 |
| Login / senha / convite | Refinamento | Links do rodapé com 20 px de altura; `/convite` sem token diz "Você foi convidado" antes do erro | UX-017 |
| `/auth/auth-error`, `/join` | Ajuste de componentes | Sem `h1` (`auth-error`); sem `main` (`join`) | UX-017 |
| Erro de rota (shell) | Ajuste de componentes | "Algo deu errado." genérico e promessa "a equipe foi notificada" | UX-010 |
| Console admin | BLOQUEADO | Exige super_admin + MFA (P-01) | — |

## 08. Experiência do usuário

EM_ANALISE — fluxos prioritários a documentar (objetivo, entrada, etapas, interações, esforço,
hesitação, erros possíveis, alternativas, resultado esperado × real, recuperação, fluxo proposto):
F1 login e recuperação; F2 novo agendamento (recepção); F3 check-in e atendimento (consultório);
F4 cadastro de paciente; F5 receber no Caixa; F6 lançamento no Financeiro; F7 convidar membro da
equipe; F8 conectar WhatsApp; F9 configurar pagamentos (Asaas); F10 cadastro autoatendido até o
checkout; F11–F20 Convênios (seção 31).

## 09. Psicologia e leis de UX

EM_ANALISE — registro por problema: princípio, situação atual, esforço imposto, alternativa,
como verificar. Já identificado: G-02 viola a recuperação de erro e a regra do pico-fim (o
momento de entrar é o primeiro "pico" do dia; uma falha mal explicada vira a memória do produto).

## 10. Humanização

Linguagem interna ou técnica encontrada na interface (varredura e código, 14/11) → UX-014:

| Onde | Hoje | Proposta | Por quê |
| --- | --- | --- | --- |
| Equipe › contagem por papel | "Super admin 0 — fora do tenant" | remover o card (papel da plataforma não pertence à equipe da clínica) | "tenant" é jargão; o papel não é da clínica |
| Conversas › prazo | "SLA vencido há 5 d" | "Esperando há 5 dias" (com o prazo combinado no detalhe) | "SLA" não é vocabulário da recepção |
| Ficha › subtítulo | "Visão operacional, histórico clínico e governança do cadastro." | "Dados, histórico e documentos do paciente." | "governança" é jargão |
| Ficha › LGPD | botão "Conceder" ao lado de "Tratamento de dados de saúde — Não consentido" | "Registrar consentimento" | quem consente é o paciente; a equipe registra |
| Login (erro de credencial) | "Email ou senha inválidos." | "E-mail ou senha incorretos." | grafia do resto do produto (UX-003) |
| Fronteira de erro | "Algo deu errado." | ver UX-010 | erro sem causa nem saída concreta |
| `/convite` sem token | "Você foi convidado." + "Criar senha de acesso" antes de "Convite inválido ou expirado" | abrir pelo problema: "Este convite não vale mais" + o que fazer | a primeira frase contradiz o estado |

Padrões adotados (R2, R11, R7 `clarify`):
- Botão: `[Verbo] [objeto]` em caixa de frase ("Salvar perfil", "Confirmar pagamento" — o app já
  segue esse padrão na maioria dos botões).
- Erro: `[o que falhou]. [por quê, se ajudar]. [o que fazer]`, sem culpar a pessoa e sem código
  técnico como única explicação.
- Vazio: o que vai aparecer aqui + a próxima ação.
- Sucesso: só o que foi comprovado ("Pagamento registrado", não "Cobrança realizada" quando só
  houve pedido interno).

## 11. Facilitação de uso

EM_ANALISE.

## 12. Formulários e entradas

EM_ANALISE — análise campo a campo por formulário (finalidade, necessidade, dependências, ordem,
rótulo e ajuda, validação, mensagem, envio, salvamento parcial, perda de dados, mobile,
acessibilidade, confirmação e cancelamento). Regra sistêmica: UX-001.

## 13. Outputs e visualização de dados

EM_ANALISE.

## 14. Dashboards

EM_ANALISE — Início (`/dashboard`), Relatórios, Repasses, Painel de Convênios (31.C).

Primeiras medições do `/dashboard` (varredura parcial de 14/11, 1440 px, conta "teste final"):
- Título da aba "Dashboard · Qoro" (UX-008 ok).
- `h1` = "Boa noite, teste final" (saudação com o nome da clínica). O nome da tela não está no
  `h1`, ao contrário do padrão registrado em COMPONENT-DECISIONS ("o nome da tela segue como
  `<h1>`"). A conferir com o leitor de tela: a saudação como cabeçalho principal não diz onde a
  pessoa está.
- `h2` na ordem: Consultas hoje · Resumo financeiro do dia · Próximos na agenda · Precisa de você ·
  Faturamento recebido · Atividade recente. "Precisa de você" (ações pendentes) vem em 4º; avaliar
  subir a prioridade (pico-fim / Von Restorff só para o que exige ação).
- Links de ação com 20 px de altura: "Abrir a agenda" (91×20), "Abrir o Financeiro" (110×20),
  "Ver o dia inteiro" (97×20) — abaixo de 24×24 (WCAG 2.5.8) se não estiverem em linha de texto.
- Sem rolagem lateral; sem controles sem nome; sem erros de console.

## 15. Acessibilidade

Critério: WCAG 2.2 AA. Achados sistêmicos G-01 (UX-001, feito) e G-06 (UX-008, feito).

Resultado da varredura automática (14/11, 39 rotas × 5 larguras) — automação cobre só parte
(R3→`wcag-audit-patterns`: 30–50%); teclado, foco e NVDA continuam no plano 25.4:

| Verificação | Resultado |
| --- | --- |
| Rolagem lateral (320–1440) | **0 ocorrências** |
| `h1` por tela | 1 em todas, exceto `/auth/auth-error` (0) → UX-017 |
| Landmark `main` | presente em todas, exceto `/join` → UX-017 |
| Título da aba | depois do UX-008: nome da tela em todas (ex.: "Dashboard · Qoro", "Entrar · Qoro") |
| Controles sem nome | 1 real: campo de texto sem rótulo em `/modelos-receita` (a confirmar no código, UX-017). Os de Configurações eram **falso positivo** (Checkbox do Radix dentro de `<label>` com texto, que dá nome e amplia o alvo); o script foi corrigido |
| Alvos < 24 px | links de ação do Dashboard ("Abrir a agenda" 91×20, "Abrir o Financeiro" 110×20, "Ver o dia inteiro" 97×20), rodapé do login ("Termos de Uso", "Política de Privacidade" 20 px), link "Configurações" do caminho de navegação (99×21), interruptor do sinal em Pagamentos (38×22, zona do billing) → UX-018 |
| Imagens sem `alt` | 0 |
| Erros de console | violação de CSP `connect-src` ao buscar `data:,` (P-09); mensagens da proteção do Turnstile no login; aviso de hidratação de atributo em `/equipe` 1× em 10 cargas (P-10) |

Observação: o `h1` do Dashboard é a saudação ("Boa noite, teste final"); o leitor de tela não ouve
onde está (ver UX-011).

## 16. Design system

EM_ANALISE — G-04; inventário de componentes em 02.2.

## 17. Responsividade

Larguras medidas: 320, 375, 768, 1024, 1440 (celular com `isMobile` + toque). **Nenhuma rolagem
lateral** em 39 rotas. Padrões encontrados no celular:
1. **Ações do cabeçalho empilham.** Agenda (Lista de espera, Ausências médicas, ⋮, Novo
   atendimento), Financeiro, Conversas, Documentos e Relatórios gastam de 2 a 3 linhas de botões
   antes do conteúdo (25–35% da primeira tela a 375 px) → UX-012.
2. **Ordem do Dashboard.** No celular, os 4 indicadores (zerados num dia sem consultas) ocupam a
   primeira tela; "Precisa de você" só aparece no fim dela → UX-011.
3. **Avisos sobre o conteúdo.** O aviso de conversas à espera cobre o primeiro item da lista de
   Conversas a 375 px → UX-016.
4. Menu: barra com marca, nome da clínica e "Menu" (gaveta com foco preso) — já validado no plano
   anterior; sem mudança.

## 18. Estados e microinterações

| Estado | Observado | Ação |
| --- | --- | --- |
| Vazio | Agenda ("Nenhum atendimento neste dia" + o que fazer), Consultório ("Nada na agenda de hoje"), Dashboard ("Agenda livre hoje", "Sem recebimento no período") — orientam bem | manter; compactar no Dashboard (UX-011) |
| Carregando | `loading.tsx` em 14 rotas; menu com linha de carregamento por item | manter |
| Erro de rota | "Algo deu errado. O erro foi registrado e a equipe foi notificada…" + ref + "Tentar novamente" — genérico, e a promessa de notificação não vale onde o Sentry está desligado | UX-010 |
| Erro de formulário | erro único fora do campo em 16 formulários | UX-005 |
| Atualização automática | refresh de Conversas e consulta de handoffs sem limite de concorrência | UX-009 (feito) |
| Sucesso | toasts com o que aconteceu ("Atendimento agendado — Maria em 14/11/2026 às 09:00") | data legível feita no UX-005 |

## 19. Qualidade e performance

Observado: primeiro build de rota no `next dev` desta máquina leva 1–4 min (ambiente, não
produção). EM_ANALISE: hidratação (#418 histórico, ver plano anterior §11), layout shift.

### 19.1 INC-01 — `/conversas` no servidor local (evento Sentry `7590707702`, 14/11/2026 18h50)

**Origem e escopo.** Evento de `development` em `http://localhost:3100/conversas`, release
`e47ec2f0` (HEAD deste worktree, com as alterações não commitadas por cima). O servidor é o desta
frente (PID do `next` deste worktree na porta 3100). Investigação inicial feita pelo agente
AbacatePay (DNS, TCP 6543, `SELECT 1` em transação só de leitura: PASS; 5,3 s isolado; falha
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` no Node). Nenhum indício de produção nem de AbacatePay.

**Resultado:** **NÃO REPRODUZIDO APÓS REINÍCIO — CAUSA HISTÓRICA AINDA INDETERMINADA.** O payload do
evento não está acessível a este agente; sem ele, a etapa exata do timeout de 18h50 não pode ser
afirmada. Às 18h50 a varredura desta frente visitava `/conversas` para descobrir o primeiro link
de conversa (espera por `networkidle`, que nunca chega nessa tela por causa do refresh de 10 s,
com teto de 120 s), com o servidor compilando rotas e a máquina com 50–450 MB de RAM livre.

**Medições por etapa (sem credenciais; mesmas opções de `src/lib/db/index.ts`):**

| Etapa | Ocioso | Sob carga | Observação |
| --- | --- | --- | --- |
| Inicialização do Next (Turbopack) | — | "Ready" ~60 s | primeira subida |
| Compilação da rota `/conversas` | — | 11,7 s / 34,2 s (cache frio após reinício) | só na primeira visita |
| DNS do pooler | 1–307 ms | 59–470 ms | primeira resolução mais lenta |
| TCP 6543 | 173–422 ms | 175–180 ms | ≈ 1 ida e volta (~175 ms) |
| Negociação SSL (SSLRequest) | 172–354 ms | 173–176 ms | 1 ida e volta |
| Handshake TLS 1.3 | 182–260 ms | 185–209 ms | emissor **Supabase Inc**: o Avast **não** intercepta o Postgres |
| 1ª transação (conexão + autenticação + `BEGIN READ ONLY; SELECT 1; COMMIT`) | 2,2–3,1 s | 2,3–2,6 s | |
| Transação em conexão já aberta | 0,52–1,0 s | 0,52–0,55 s | 3 idas e voltas; `withTenant` ≈ 5 (~0,9 s) |
| 3 transações em paralelo | 2,2–2,8 s | 2,2–4,3 s | rodada 1 de `/conversas` |
| Render de `/conversas` (servidor, rota já compilada) — **antes** da correção | — | 3,3 / 13,9 / 14,3 / 20,6 / 34,6 s | `POST` concorrentes de 9–28 s |
| Render de `/conversas` — **depois** da correção (UX-009) | — | 6,4 / 7,8 / 8,5 / 8,9 / 10,7 s (Sentry ligado) e 5,8 / 6,2 / 6,9 / 8,7 / 9,6 s (Sentry desligado) | variância caiu; Sentry não explica a diferença |

Arquivos de evidência (fora do Git): `.tmp/ui-audit/evidence/2026-11-14/conversas-probe-{1,2,3}.json`;
scripts `.tmp/ui-audit/db-phases.ts` e `.tmp/ui-audit/conversas-probe.ts`.

**O que foi isolado:**
1. **TLS do Node não é a causa do Postgres.** A aplicação conecta com `ssl: 'require'` (TLS sem
   verificação de CA), e o certificado recebido é o da Supabase. A falha de certificado afeta só
   HTTPS (Supabase Auth, túnel do Sentry) e já está tratada com `NODE_OPTIONS=--use-system-ca`
   (validação TLS **ligada**; `rejectUnauthorized` conferido como verdadeiro). `NODE_USE_SYSTEM_CA=1`
   e a flag funcionaram no Node 22.23.4, mas neste shell a chamada passou até sem nenhuma das duas,
   ou seja, a interceptação do Avast varia por processo; mantida a flag.
2. **O banco responde no contexto real da aplicação.** Login (grava `login_attempts` no DEV, como
   em qualquer login), `/conversas`, rodada 1 e 2 e a conversa selecionada (só `SELECT`; a métrica
   `ai_agent.conversation.opened` é linha de log) carregaram em 3 sondas, sem erro de banco, sem
   `lock_timeout`, sem `CONNECT_TIMEOUT`.
3. **Defeito de UI que amplificava a carga (corrigido — UX-009).** `ConversationAutoRefresh`
   disparava `router.refresh()` a cada 10 s e `HandoffWatcher` chamava `fetchOpenHandoffs()` a cada
   20 s **sem esperar a chamada anterior**. Cada refresh de `/conversas` refaz o gate de permissão
   e 5 transações `withTenant`; no ambiente lento (renders de até 35 s, `POST` de até 28 s) as
   chamadas se sobrepunham e disputavam o mesmo pool (máx. 6) e o mesmo processo. Depois da
   correção: no máximo 1 refresh por vez (medido), renders de 5,8–10,7 s.
4. **Ruído no Sentry compartilhado (coordenação — ver 28, P-07).** `sentry.server.config.ts`,
   `sentry.edge.config.ts` e `src/instrumentation-client.ts` têm DSN de **reserva fixo no código**
   (`NEXT_PUBLIC_SENTRY_DSN ?? SENTRY_DSN ?? 'https://…'`), `environment: process.env.NODE_ENV` e
   `onRequestError = Sentry.captureRequestError`. Resultado: qualquer servidor local sem DSN
   reporta ao Sentry compartilhado, inclusive renders abortados pelo navegador (`Error: aborted`,
   `ECONNRESET`, digest `2313178152`) e erros de recarga do Turbopack. Mitigação local aplicada:
   `NEXT_PUBLIC_SENTRY_DSN=` e `SENTRY_DSN=` vazios no `.env.local` deste worktree (o `??` mantém a
   string vazia → `enabled: false`); conferido: nenhum envio a `/monitoring` depois do reinício.
5. **500 durante a validação = artefato do Turbopack.** Na segunda sonda, a primeira visita deu
   500 com "module factory is not available" (digest `1432440976`) logo depois de editar arquivos
   do shell com o servidor no ar (recarga a quente). Não é o incidente; some com o reinício.
   Regra: ao validar depois de editar arquivos compartilhados, reiniciar o servidor.

**Hipóteses para o evento de 18h50 (não comprovadas):** (a) render abortado quando a varredura
desistiu da espera por `networkidle` e navegou (mesmo padrão do `Error: aborted` reproduzido);
(b) `connect_timeout` de 10 s estourado com a máquina sem memória e o processo do Next compilando.
Para fechar: ler o payload do evento (título, `transaction`, stack) — pedido ao agente que tem
acesso ao Sentry (P-08).

**Reprodução da classe (b), em outra rota (14/11, varredura completa, entre ~20h e ~21h):** em
`/configuracoes/pagamentos` a 375 px o servidor lançou `Error: write CONNECT_TIMEOUT
undefined:undefined` (repassado ao console pelo modo de desenvolvimento, `resolveErrorDev`); o
`undefined:undefined` é o driver `postgres` formatando um socket que ainda não tinha conectado, não
URL vazia. A tela caiu na fronteira de erro do shell ("Algo deu errado… ref: 1586846154";
foto `.tmp/ui-audit/evidence/2026-11-14/mini/pagamentos_375.png`). Nas outras 4 larguras a mesma
rota renderizou. Condições: servidor compilando rotas novas, varredura logada em curso, pouca RAM
livre. Conclusão: **neste ambiente, abrir conexão nova pode passar de 10 s sob carga** — isso torna
a hipótese (b) plausível para o evento de 18h50, mas não a comprova. O log do servidor daquele
momento não ficou disponível (o buffer do painel de preview estava tomado pelos avisos de fonte do
Turbopack). Efeito para a pessoa: a mensagem genérica da fronteira de erro (ver UX-010).

**SSR e hidratação na rota:** nenhuma mensagem de hidratação nem erro de página nas 3 sondas;
título e `h1` corretos. Erros de console encontrados que **não** são da rota: violação de CSP
`connect-src` ao buscar `data:,` (origem a identificar — P3, seção 15) e mensagens `%c%d` da
proteção do Turnstile na tela de login. Nada aponta para o R51/#418.

## 20. Privacidade e confiança

EM_ANALISE — roteiro de `dark-pattern-audit` (preço, trial, cancelamento, consentimento,
pré-seleção, CTA enganoso) sobre cadastro, plano, assinatura e cobrança; LGPD na ficha e em
Configurações › LGPD.

---

## 21. Plano de ação por tela

Ver a tabela da seção 07 (classificação e IDs por tela). Intervenções novas abertas pela
varredura de 14/11, no formato do prompt, em ordem de prioridade:

### UX-010 — Fronteira de erro específica e honesta (P2)
**Status:** IMPLEMENTADO e TESTADO (14/11/2026). Título "Não conseguimos carregar esta tela
agora." como `h2`; container `role="alert"`; texto com ou sem código conforme haja `digest`
("informe o código abaixo ao suporte" só quando o código aparece); "Código para o suporte: …";
sem "Algo deu errado" nem "a equipe foi notificada"; títulos/textos próprios de quem chama
(Dashboard) preservados. Teste novo `route-error.test.tsx` (3). Falta: foto da tela de erro.
**Arquivo:** `src/components/shared/route-error.tsx` (usado por `(shell)/error.tsx` e afins).
**Hoje:** "Algo deu errado. O erro foi registrado e a equipe foi notificada. Tente novamente — se
persistir, recarregue a página." + "ref: <digest>" + "Tentar novamente".
**Depois:** título "Não conseguimos carregar esta tela agora"; texto "Pode ser uma instabilidade
momentânea. Tente de novo; se continuar, recarregue a página ou informe o código <ref> ao
suporte."; sem prometer notificação (vale também onde o Sentry está desligado). Manter o `ref` e
o botão. **Critérios:** texto novo; `ref` copiável; teste do componente atualizado (procurar o
texto antigo em `e2e/` e nos testes antes). **Riscos:** baixo.

### UX-011 — Dashboard pela próxima ação (P2)
**Arquivo:** `src/app/(app)/(shell)/dashboard/page.tsx` (709 linhas) e componentes da pasta.
**Hoje:** saudação como `h1`; ordem Indicadores → Consultas hoje / Resumo financeiro → Próximos
na agenda / **Precisa de você** → Faturamento / Atividade.
**Depois:** "Precisa de você" logo abaixo do cabeçalho quando tiver itens (some quando vazio);
cartões zerados em forma compacta (uma linha) em vez de cartão grande com estado vazio; `h1`
"Dashboard" (visualmente pode continuar a saudação como subtítulo — decisão registrada em
COMPONENT-DECISIONS antes); no celular, alertas antes dos indicadores.
**Pendência de descoberta:** ler a página para confirmar quais blocos vêm de `withQueryFallback`
(o vazio-por-timeout não pode virar "tudo zerado" sem aviso). **Riscos:** médio (tela mais vista;
e2e de dashboard). **Validação:** fotos antes/depois em 1440 e 375; NVDA lê "Dashboard".

### UX-012 — Cabeçalho de página no celular (P2)
**Arquivos:** `src/components/ui/page-header.tsx`, `src/components/shared/shell-chrome.tsx`;
telas: Agenda, Financeiro, Conversas, Documentos, Relatórios.
**Depois:** abaixo de 768 px, só a ação principal fica visível; as secundárias vão para um menu
"Mais ações" (Radix DropdownMenu já existe em `components/ui/dropdown-menu.tsx`). Nada some: o
menu lista todas, com o mesmo destino e a mesma permissão. Registrar em COMPONENT-DECISIONS
(ação que muda de lugar). **Critérios:** cabeçalho em 1 linha a 375 px; teclado abre o menu;
leitor de tela anuncia "Mais ações".

### UX-014 — Linguagem interna exposta (P2)
Tabela da seção 10. Cada troca: `grep` do texto em `src/` e `e2e/` antes; atualizar testes que
procuram o texto. O card "Super admin" em Equipe: confirmar no código se a contagem vem de uma
lista de papéis (`ROLES`) e filtrar `super_admin` da exibição (sem mexer em permissão).

### UX-015 — Caixa: título e ações de pagamento claros (P2)
**Arquivos:** `src/app/(app)/(shell)/caixa/cash-item-card.tsx`, `caixa-view.tsx` (TISS também
altera esses arquivos — coordenar, 31.R).
**Depois:** título = descrição da cobrança quando não há paciente ("Sem paciente vinculado" vira
metadado); ações: confirmar o que cada uma faz antes de renomear (ler o fluxo de "Confirmar
pagamento"); proposta inicial "Registrar pagamento" (abre a escolha do meio) e "Recebi em
dinheiro". **Riscos:** médio (financeiro; labels de negócio — registrar a decisão).

### UX-016 — Aviso de conversas na própria tela de Conversas (P3)
**Arquivo:** `src/app/(app)/(shell)/_painel/handoff-watcher.tsx`.
**Depois:** não mostrar o toast de resumo quando a rota atual já é `/conversas` (o badge e a
lista já informam); no celular, toast acima da barra de navegação sem cobrir o primeiro item.

### UX-017 — Estrutura semântica pontual (P3)
**Status:** IMPLEMENTADO e TESTADO (commits `15b060c1` e `4acd59f8`): `h1` (visualmente oculto,
o título visível segue no `Alert`) em `/auth/auth-error`; `main` em `src/app/(app)/join/layout.tsx`
(cobre `/join` e `/join/[token]` sem tocar no `join-wizard.tsx`, que muda na #55 — conferido que
nem o `JoinEntry` nem o assistente têm outro `main`, então não há landmark duplicado);
`aria-label` na busca de `/modelos-receita`; `/convite` sem token: sem "Você foi convidado", o
cabeçalho passa a ser o problema e o alerta diz o que fazer (estado válido intacto: o e2e
`production-team-lifecycle` continua achando "Criar senha de acesso").

### UX-019 — Modelos de receita no padrão de formulário (P2)
**Arquivo:** `src/app/(app)/(shell)/modelos-receita/templates-manager.tsx`.
**Problema:** a tela ficou fora da migração: classes do DS antigo (`stack`, `cardblock`,
`wrap-pad`), `style={{ maxWidth: 760 }}` (largura fixa fora dos tokens) e campos do formulário
de modelo com **placeholder como único rótulo** ("Nome *", "Categoria (opcional)" e os campos da
lista de medicamentos) — o rótulo some ao digitar (R4 `form-design`; WCAG 3.3.2).
**Alteração:** `Field` com `htmlFor` e rótulo persistente em cada campo; layout com os
utilitários e tokens do v5; manter comportamento (salvar, duplicar, excluir) e textos de negócio.
**Critérios:** `field-accessibility.test.ts` cobre os campos novos; foto antes/depois; nenhum teste
existente enfraquecido.

### UX-018 — Alvos de toque abaixo de 24 px (P3)
Links de ação do Dashboard e do rodapé do login, link do caminho de navegação; interruptor do
sinal em Pagamentos (zona do billing — depois do merge da #53). Aumentar a área clicável (padding
ou `min-h-(--hit-target)`), sem mudar o visual do texto.

## 22. Plano de ação por componente

### UX-001 — `Field` liga dica e erro ao controle

**Prioridade:** P1 · **Status:** PENDENTE · **Categoria:** Acessibilidade / Formulários
**Tela:** todas com formulário · **Rota:** todas · **Perfil afetado:** todos

**Arquivos envolvidos:** `src/components/ui/field.tsx`; testes `src/components/ui/field.test.tsx`
e `src/app/field-accessibility.test.ts`.

**Problema identificado:** o erro e a dica são parágrafos soltos; o controle não aponta para eles e
não informa estado inválido.

**Evidências:** G-01.

**Impacto:** quem usa leitor de tela ouve "Telefone, editável" e não ouve "Informe o DDD"; ao
voltar ao campo com erro, nada indica que ele está inválido.

**Skills aplicadas:** R4 `form-design`, `accessibility-audit`; R3→`fixing-accessibility`;
R7 `audit`.

**Alteração necessária:** quando `htmlFor` existir, `Field` gera `${htmlFor}-hint` e
`${htmlFor}-error`, coloca o `id` no parágrafo correspondente e, se o filho for um único elemento
React, mescla `aria-describedby` (preservando o que já existir) e aplica `aria-invalid` quando há
erro (sem sobrescrever um `aria-invalid` explícito). Filhos compostos ficam como estão e entram
numa lista de exceções do teste.

**Como implementar:**
1. Em `field.tsx`, calcular `hintId`/`errorId` a partir de `htmlFor`.
2. Renderizar `id` no `<p>` de erro e no de dica.
3. Se `Children.only` for possível (`isValidElement(children)`), `cloneElement` com
   `aria-describedby` = junção de (existente, `errorId` ou `hintId`) e `aria-invalid`.
4. Não usar contexto React (o `Field` também é usado em Server Components).
5. Testes: dica liga; erro substitui a dica e liga; `aria-invalid` só com erro; preserva
   `aria-describedby` existente; filho composto não quebra.

**Antes:** erro visível só pela cor e posição. **Depois:** erro anunciado junto com o campo.

**Critérios de aceitação:** testes acima verdes; `field-accessibility.test.ts` continua verde;
nenhuma mudança visual (comparação de foto de um formulário antes/depois); leitor de tela (NVDA)
anuncia o erro ao focar o campo.

**Dependências:** nenhuma. **Riscos:** baixo (atributos ARIA). **Validação:** vitest + NVDA manual.
**Status de execução:** IMPLEMENTADO e TESTADO (14/11/2026). Falta: NVDA manual e foto antes/depois.

**Resultado e evidências:**
- `field.tsx`: ids `${htmlFor}-hint`/`${htmlFor}-error` (ou `useId` quando não há `htmlFor`);
  `cloneElement` só quando o filho é o controle (`props.id === htmlFor`), mesclando
  `aria-describedby`, aplicando `aria-invalid` com erro e `aria-required` quando `required` e o
  controle não tem `required`; atributos do chamador nunca são sobrescritos; em `group`, a
  descrição vai no `fieldset`. Sem contexto React: `useId`, `cloneElement` e `isValidElement`
  existem no build `react-server` (conferido em `node_modules/react/cjs/react.react-server.development.js`),
  então o `Field` continua servindo em Server Components (ex.: `configuracoes/lgpd/lgpd-work-queue.tsx`).
- Testes novos em `field.test.tsx` (6): dica liga; erro substitui a dica, liga e marca inválido
  (consulta por `description` no Testing Library); preserva atributos do chamador; anuncia
  obrigatoriedade; não toca em wrapper; grupo descrito. Resultado: 4 arquivos, 20 testes, 0 falha.
- Nenhuma classe CSS mudou (sem efeito visual esperado).

### UX-002 — Login distingue falha do serviço de senha errada

**Prioridade:** P1 · **Status:** PENDENTE · **Categoria:** Erros / Humanização / Confiança
**Tela:** T02 · **Rota:** `/login` · **Perfil afetado:** todos

**Arquivos envolvidos:** `src/app/(app)/login/actions.ts`; testes da action de login (localizar o
arquivo de teste existente antes de editar — pendência de descoberta).

**Problema identificado:** qualquer erro do Supabase Auth vira "Email ou senha inválidos.".

**Evidências:** G-02.

**Impacto:** ver G-02. Também mistura "Email" com "E-mail" usado no restante da tela.

**Skills aplicadas:** R4 `error-handling-ux`; R7 `harden` (erros de rede e 5xx) e `clarify`;
R11 (padrão de erro).

**Alteração necessária:** classificar o erro: falha de rede, 5xx ou erro "retryable" do Auth →
"Não conseguimos falar com o serviço de login agora. Sua senha não foi conferida; tente de novo em
alguns instantes." e métrica `reason: 'auth_unavailable'`. Credenciais inválidas seguem com a
mensagem genérica (sem revelar se o e-mail existe), corrigida para "E-mail ou senha incorretos.".
Sem mudança no limite de tentativas, no captcha nem na ordem das verificações.

**Como implementar:** usar o predicado exportado pelo `@supabase/supabase-js`/auth-js para erro de
fetch repetível (conferir o nome exato na versão instalada, 2.106.2) e o `status` do erro; manter o
ramo de captcha antes; ajustar o teste existente e cobrir os dois ramos novos.

**Critérios de aceitação:** credencial errada → mensagem genérica (inalterada no sentido); serviço
fora → mensagem de indisponibilidade; métrica com o motivo certo; e2e `login-and-navigation`
segue verde (conferir se ele depende do texto antigo).

**Dependências:** nenhuma. **Riscos:** médio (área de autenticação; exige revisão cuidadosa da
ordem dos ramos e do anti-enumeração). **Validação:** vitest da action + teste manual no servidor
local com o Supabase inacessível.

**Status de execução:** IMPLEMENTADO e TESTADO (14/11/2026). Falta: teste manual no navegador
com o Auth inacessível. A troca de "Email ou senha inválidos." por "E-mail ou senha incorretos."
ficou para o UX-003 (mantém este lote sem mudança de texto já coberto por teste).

**Resultado e evidências:**
- Novo `src/lib/auth/auth-availability.ts`: `isAuthServiceUnavailable(error)` (verdadeiro para
  `AuthRetryableFetchError`, `status` 0 e qualquer 5xx; falso para 400/422/429, captcha e nulo) e
  `AUTH_UNAVAILABLE_MESSAGE` ("Não conseguimos conectar ao serviço de login agora. Sua senha não foi
  verificada; tente de novo em alguns instantes.").
- `login/actions.ts`: o ramo novo vem **depois** do captcha e **antes** de
  `recordLoginAttempt`; não conta tentativa (mesmo raciocínio já documentado para o captcha),
  emite `auth.login.failed` com `reason: 'auth_unavailable'` e um `logger.warn` sem PII
  (`status`, `name`). Limite de tentativas, captcha e ordem das verificações intactos;
  credencial errada (400) segue com a mensagem genérica (anti-enumeração preservada).
- Testes: 4 casos novos na action (rede, 503, 500 e credencial 400) + 4 no predicado. Resultado:
  5 arquivos, 50 testes, 0 falha; `check:observability` OK.
- Observação do caso real (14/11): sem a correção de CA (00.3), o login local devolvia
  "Email ou senha inválidos." para uma falha de TLS — exatamente o cenário corrigido.

### UX-003 — Mensagens de sistema padronizadas

**Prioridade:** P2 · **Status:** PENDENTE · **Categoria:** Humanização / Consistência
**Arquivos:** os que contêm as mensagens de G-03 (listar com `grep` antes de editar); catálogo
único proposto em `src/lib/ui/messages.ts` (criar só depois de registrar em COMPONENT-DECISIONS).
**Alteração:** uma versão por situação — sessão expirada ("Sua sessão expirou. Entre de novo para
continuar."), limite ("Muitas tentativas. Aguarde alguns minutos e tente de novo."), "E-mail" com
hífen em todo texto visível, "Profile inválido…" → "Não encontramos o seu perfil nesta clínica.
Peça ao administrador para revisar o seu acesso.", acento em "no máximo", mensagens de
desenvolvedor trocadas por "Não conseguimos abrir este registro. Recarregue a página." onde
puderem chegar à tela.
**Riscos:** e2e que procuram texto exato — rodar `grep` nos specs antes de trocar cada frase.

### UX-005 — Erro no campo certo, todos de uma vez (padrão para os 16 formulários)

**Prioridade:** P2 (P1 no novo agendamento, pela frequência) · **Status:** EM_ANDAMENTO — piloto
no novo agendamento IMPLEMENTADO e TESTADO em 14/11/2026 (`validarNovoAtendimento` pura; erros
por campo; foco no primeiro inválido; "Informe data e hora." virou "Informe a data." /
"Informe a hora."; aviso de sucesso com `dd/mm/aaaa`); 15 formulários pendentes ·
**Categoria:** Formulários / Acessibilidade / Esforço

**Formulários afetados (erro único em `useState<string | null>` + `setError`):**
`(admin)/admin/clinicas/[id]/export-form.tsx`, `agenda/new-appointment-drawer.tsx`,
`caixa/caixa-view.tsx`, `caixa/payout-review-form.tsx`,
`configuracoes/pagamentos/asaas-fees-panel.tsx`, `configuracoes/pagamentos/deposit-policy-form.tsx`,
`configuracoes/pagamentos/payment-account-panel.tsx`, `consultorio/attending-panel.tsx`,
`consultorio/consultorio-board.tsx`, `consultorio/document-drawer.tsx`,
`consultorio/prescription-drawer.tsx`, `consultorio/sign-dialog.tsx`,
`documentacao/restart-tour.tsx`, `equipe/invite-drawer.tsx`,
`financeiro/fornecedores/fornecedores-view.tsx`, `src/components/ui/destructive-action.tsx`
(caminhos sob `src/app/(app)/(shell)/` salvo indicação).

**Problema:** a validação de interface devolve só o primeiro erro, num texto fora do campo.
Exemplo real (novo agendamento, linhas 77–99): "Selecione o paciente." → corrige → "Selecione o
procedimento." → corrige → "Selecione o profissional." → "Informe data e hora.".

**Impacto:** descoberta sequencial (até 4 envios para descobrir 4 faltas); o erro não fica ao
lado do campo nem ligado a ele; em gaveta longa no celular o texto de erro pode ficar fora da área
visível. Princípios: Nielsen 9, R4 `form-design` ("erro diretamente abaixo do campo; resumo no topo
se houver vários"), Lei de Proximidade.

**Alteração necessária (padrão):** validação de interface devolve um mapa `{ campo: mensagem }`;
cada `Field` recebe `error={erros.campo}`; no envio com erros, o foco vai para o primeiro campo
inválido; erros de servidor que não são de campo continuam num `Alert` acima das ações. Validação
no `blur` só depois da primeira tentativa de envio (não punir quem ainda está digitando).
**Nenhuma regra nova:** as mesmas condições de hoje, só reorganizadas; o servidor continua
validando tudo.

**Como implementar (piloto no novo agendamento):**
1. Em `new-appointment-drawer.tsx`, trocar `error: string | null` por
   `fieldErrors: Partial<Record<'paciente'|'procedimento'|'profissional'|'dataHora'|'intervalo'|'quantidade', string>>`
   + `formError: string | null` (erro do servidor, `res.message`).
2. Função pura `validateNovoAtendimento(estado)` no mesmo arquivo (ou em `agenda/`), com os mesmos
   textos de hoje, testável sem DOM.
3. Passar `error` para cada `Field` (os `Field` já têm `htmlFor`; o UX-001 liga o texto ao campo).
4. Focar o primeiro campo com erro após o envio (`document.getElementById(id)?.focus()`).
5. Testes: função pura (cada combinação) + teste do componente (envio vazio mostra os 4 erros de
   uma vez, foco no primeiro). Atualizar testes existentes que procuram o texto antigo no lugar
   antigo (`agenda/page.test.tsx` e afins — conferir com `grep`).
6. Repetir o padrão nos demais formulários, um por commit, começando por `equipe/invite-drawer.tsx`
   e `caixa/caixa-view.tsx` (alto risco operacional).

**Critérios de aceitação:** envio vazio mostra todos os erros de uma vez, cada um sob o seu campo;
foco no primeiro inválido; leitor de tela anuncia o erro ao focar; nada muda no que é aceito ou
recusado; e2e `authenticated-readonly-routes` e testes da agenda verdes.

**Riscos:** médio — `caixa` e `equipe` são zonas sensíveis (financeiro; billing tem a
`equipe/page.tsx`, não o `invite-drawer.tsx`). **Dependências:** UX-001 (feito).

### UX-006 — "Cadastrar novo paciente" sem perder o agendamento

**Prioridade:** P1 · **Status:** IMPLEMENTADO e TESTADO (14/11/2026, commit `9710a207`; aprovado
pelo fundador para DEV/Preview com o backend existente). Falta validar no navegador (celular,
teclado, leitor de tela, criação real de 1 paciente sintético na clínica de teste).
**Como ficou:** botão "Cadastrar novo paciente" (só com `create:patient`, flag
`AgendaData.canCreatePatient`) abre `agenda/quick-patient-form.tsx` dentro da gaveta: Nome e CPF
(obrigatórios pelas regras atuais) e Telefone opcional; "Cadastrar e selecionar" chama
`agenda/quick-patient-actions.ts` → `criarPacienteRapido`, adaptador fino sobre `createPatient`
(mesmo esquema, permissão fresca, clínica da sessão, idempotência, auditoria). Uma chave de
idempotência por abertura (clique duplo/nova tentativa devolvem o mesmo paciente); CPF duplicado
vira erro no campo CPF; falha de conexão explica que tentar de novo não duplica; Enter nos campos
salva o paciente (não envia o agendamento — o formulário rápido não é `<form>` aninhado);
"Cancelar" volta à busca. Nenhum campo do agendamento é tocado. Testes: 6 (ação) + 7
(formulário) + 3 (gaveta). Inventário de segurança: a ação nova entra na regeneração do
`docs/security/acoes.md` na integração (P-15).
**Categoria:** Fluxo / Esforço / Perda de dados
**Tela:** T17 Agenda › Novo atendimento · **Arquivo:**
`src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx` (link na linha ~191, `href="/pacientes?novo=1"`).

**Problema:** o link leva para outra página. Tudo o que já foi escolhido na gaveta (tipo,
procedimento, profissional, data, hora, salas, observações) se perde, e a pessoa precisa voltar
à Agenda, reabrir a gaveta e refazer.

**Impacto:** é o caso mais comum da recepção: paciente novo liga para marcar. Retrabalho de 6 a 8
campos, troca de contexto e risco de marcar o horário errado ao refazer (Lei de Tesler — o
sistema empurra a complexidade para a pessoa; Zeigarnik — a tarefa fica aberta sem retomada).

**Alteração necessária (opções, em ordem de preferência):**
1. **Cadastro rápido dentro da gaveta:** "Paciente novo" abre, no mesmo lugar, os campos
   mínimos que a ação de criar paciente já aceita (nome e telefone, confirmar no código quais são
   obrigatórios), cria o paciente com a **mesma Server Action** de `/pacientes` e já o seleciona;
   o resto da ficha fica para depois. Sem regra nova.
2. Se a ação de criar exigir mais dados do que cabe na gaveta: guardar o rascunho do agendamento
   (estado da gaveta) e voltar para a Agenda com a gaveta reaberta e o paciente recém-criado
   selecionado (`/pacientes?novo=1&voltar=agenda` + rascunho em `sessionStorage`).

**Pendência de descoberta antes de implementar:** ler o formulário de novo paciente em
`src/app/(app)/(shell)/pacientes/` (campos obrigatórios e a Server Action usada) e a permissão
exigida (`create:patient`); se a pessoa não tiver `create:patient`, o link/ação não aparece.

**Critérios de aceitação:** criar paciente sem sair da gaveta e sem perder nenhum campo já
preenchido; paciente aparece selecionado; permissão respeitada; teclado e celular OK.
**Riscos:** médio (fluxo mais usado). **Dependências:** UX-005 no mesmo arquivo (fazer juntos).

### UX-007 — Catálogo de procedimentos vazio sem saída

**Prioridade:** P2 · **Status:** IMPLEMENTADO e TESTADO (14/11/2026; `AgendaData.canManageProcedures`
opcional, calculado de `manage:procedures` em `agenda/data.ts`; 2 testes) · **Categoria:** Estados
vazios / Humanização
**Tela:** T17 · **Arquivo:** `new-appointment-drawer.tsx` (linha ~202).
**Problema:** "Nenhum procedimento cadastrado. Cadastre ao menos um (catálogo de procedimentos)
para criar atendimentos." é texto puro; o botão de enviar fica desabilitado e não há caminho.
**Alteração:** com `manage:procedures`, link "Cadastrar procedimento" para
`/configuracoes/procedimentos`; sem a permissão: "Peça a quem administra a clínica para cadastrar
os procedimentos." A gaveta precisa receber a permissão do servidor (a página da Agenda já
resolve permissões; confirmar o nome da prop).
**Critérios:** a pessoa sabe o que fazer em qualquer papel; nenhum link para tela sem acesso.

### UX-008 — Título próprio em cada tela

**Prioridade:** P1 · **Status:** IMPLEMENTADO e TESTADO (14/11/2026) · **Categoria:** Acessibilidade
(WCAG 2.4.2, nível A) / Orientação

**Problema e evidência:** G-06.

**O que foi feito:**
- `src/app/layout.tsx`: `title: { default: 'Qoro', template: '%s · Qoro' }`.
- `export const metadata: Metadata = { title: '…' }` em 48 `page.tsx` (público, shell, console
  admin), com o mesmo nome do cabeçalho visível. **Ficha e prontuário não levam o nome do
  paciente** ("Ficha do paciente", "Prontuário"): a aba e o histórico do navegador ficam visíveis
  em tela compartilhada (dado sensível, LGPD art. 11).
- `layout.tsx` novos, só com o título, onde o `page.tsx` é componente de cliente (`/login`,
  `/login/mfa`) ou muda numa PR paralela — billing #53: `/cadastro/plano`, `/equipe`,
  `/configuracoes/assinatura`, `/configuracoes/pagamentos`, `/configuracoes/whatsapp`,
  `/admin/billing`; TISS #55: `/financeiro`. Assim a integração não tem conflito textual.
- Títulos antigos normalizados para o modelo: "Central de ajuda", "`<tópico>` · Ajuda",
  "Guia não encontrado", "Prévia da proposta de preços", "Acompanhamento do pagamento",
  "Verificar proteção do cadastro".
- Contrato novo: `src/app/page-titles.test.ts` (3 testes) — modelo no layout raiz; toda `page.tsx`
  com título próprio ou herdado de layout da pasta; nenhum título repete "Qoro".

**Validação:** `page-titles.test.ts` 3/3; contratos de UI (12 arquivos, 84 testes) verdes;
ESLint 0 problemas nos 74 arquivos alterados; no navegador, `/conversas` mostrou "Conversas IA ·
Qoro". **Pendente:** conferir o título de todas as rotas na varredura e o anúncio no NVDA.

### UX-009 — Uma atualização automática por vez

**Prioridade:** P1 · **Status:** IMPLEMENTADO, TESTADO e VALIDADO no servidor local (14/11/2026) ·
**Categoria:** Performance percebida / Confiabilidade

**Arquivos:** `src/app/(app)/(shell)/conversas/_components/conversation-auto-refresh.tsx` (+teste),
`src/app/(app)/(shell)/_painel/handoff-watcher.tsx` (+teste). Nenhum deles muda na #53 ou na #55
(conferido por `git diff` nas duas branches).

**Problema e evidência:** G-07 e INC-01 (19.1).

**O que foi feito:** o auto-refresh chama `router.refresh()` dentro de `startTransition` e pula o
tique enquanto `isPending`; o vigia de handoffs guarda `inFlight` e só consulta de novo depois que
a anterior voltar (sucesso ou erro). Intervalos (10 s e 20 s), visibilidade da aba, toasts e
contador do menu inalterados.

**Testes:** 3 novos (auto-refresh: não começa outro com o anterior pendente; volta quando termina;
vigia: não consulta de novo antes da resposta) + os existentes: 8 arquivos, 69 testes, 0 falha.
**Validação no navegador:** sonda 3 — no máximo 1 refresh simultâneo; renders de 5,8–10,7 s
(antes 3,3–34,6 s).

### UX-004 — Tons de status em tokens

**Prioridade:** P3 · **Status:** PENDENTE · **Categoria:** Design system
**Arquivos:** `src/components/ui/badge.tsx`, `src/app/globals.css`.
**Alteração:** criar `--tone-teal-*` e `--tone-violet-*` (bg, fg, borda, ponto) nas camadas claro
e escuro do v5 com contraste AA medido; trocar os `oklch(...)` literais; documentar o significado
de cada tom (seção 16).

---

## 23. Plano de implementação

Ordem por dependência (revisar quando a auditoria terminar):

| Lote | Conteúdo | IDs | Pré-requisito |
| --- | --- | --- | --- |
| 1 | Correções críticas e de base | UX-001 (feito), UX-002 (feito), UX-005 piloto + UX-006 + UX-007 no novo agendamento | nenhum |
| 2 | Tokens e componentes fundamentais | UX-004 + achados de DS da auditoria | Lote 1 |
| 3 | Navegação e estruturas | a definir (inclui UX-TISS-001 na integração) | auditoria completa |
| 4 | Formulários e fluxos principais | a definir | Lote 2 |
| 5 | Dashboards e dados | a definir | Lote 2 |
| 6 | Telas secundárias | a definir | Lote 4 |
| 7 | Humanização e refinamentos | UX-003 + demais | Lote 4 |
| 8 | Microinterações | a definir | Lote 6 |
| 9 | Revisão visual integral | todas | todos |

Após cada lote: testes do lote + contratos de UI + typecheck dos arquivos tocados; fotos antes e
depois; atualizar 27, 29 e o bloco de estado.

## 24. Critérios de aceitação

Globais (prompt §30) e por intervenção (em cada ID). Formato de achado adotado (R3→
`make-interfaces-feel-better`): severidade, local `arquivo:linha`, antes/depois, princípio violado.

## 25. Plano de testes

- 25.1 Unitários e de contrato: `npx vitest run <arquivos>`; contratos de UI listados em 02.2.
- 25.2 Tipos e lint: `npx tsc --noEmit -p tsconfig.json` e `npx eslint <arquivos>`.
  **Linha de base válida (este worktree):** `tsconfig.json` com `include` = `next-env.d.ts`,
  `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`, `incremental: true`, `skipLibCheck: true`;
  `src/components/painel/rail-animations.tsx` **participa** da checagem (`react-useanimations`
  instalado pelo `pnpm install --frozen-lockfile` deste worktree). Três rodadas em 14/11, cada uma
  com **código de saída 0 e 0 erros** (`evidence/2026-11-14/tsc.log` às 21h30; `tsc-2.log` depois de
  UX-010/017; `tsc-3.log` depois de UX-006 e do convite). Nada foi excluído nem filtrado.
  Os "19 erros conhecidos de `rail-animations.tsx`" citados no plano anterior
  (`docs/ui/PLANO-FINALIZACAO-REDESIGN-QORO.md` §15) eram de **outro ambiente**: o worktree
  `Qoro_ui_refactor_20261108`, cuja junção de `node_modules` não tinha o pacote. Não se aplicam
  aqui.
- 25.3 Varredura visual: `.tmp/ui-audit/sweep.ts` (5 larguras) antes e depois de cada lote.
- 25.4 Acessibilidade manual: teclado (Tab, Shift+Tab, Enter, Espaço, Esc), foco visível, NVDA no
  Windows nas telas de formulário, zoom de 200% e 400% (reflow), movimento reduzido.
- 25.5 E2E seguros: `login-and-navigation`, `authenticated-readonly-routes`, `public-surface`
  contra o servidor local; nenhum `production-*`.
- 25.6 Validação com usuários: plano de teste de usabilidade por papel (hipóteses da seção 08),
  sem pesquisa real disponível hoje.

## 26. Riscos e decisões

| ID | Decisão | Motivo | Alternativa descartada |
| --- | --- | --- | --- |
| D-01 | Trabalhar em branch nova sobre `ui/refactor-qoro-20261108` | É a branch de UI ativa (v5, sem PR); a `main` não tem o redesign | Base na `main` (conflitaria com 42 commits de UI) ou commit direto na branch de UI (perderia o isolamento) |
| D-02 | Manter a marca Qoro no app e diferenciar pelo modo de uso | O sistema auditado é o próprio Qoro | Criar identidade "distinta da Qoro" (contradiz §3 e §32.U do prompt) |
| D-03 | Inter no corpo do app continua | Decisão aprovada do v5; superfície operacional (R7 Operate) | Trocar fonte por recomendação de R6 |
| D-04 | Não instalar skills de terceiros; ler como referência | Segurança (scripts/binários), persistência indevida de instruções | Instalar no ambiente do agente |
| D-05 | Ambiente local com `.env.local` higienizado e `--use-system-ca` | Nada em produção; Avast intercepta TLS | Usar o `.env.local` principal (Asaas de produção) ou desligar TLS |
| D-06 | Prompt mestre vale como aprovação do fundador para reestruturar apresentação e fluxos; mudar o **contrato** de design continua exigindo aprovação explícita | O contrato diz que mudar o contrato exige aprovação; o prompt autoriza redesenhar a experiência | Tratar o prompt como licença para mudar o contrato |

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Conflito com a #53 (billing) na integração | média | alto | Ordem: #53 → UI → esta branch; não tocar `cadastro/plano/*`, `configuracoes/assinatura` e `equipe/page.tsx` sem coordenação (zona do billing) |
| Conflito com a #55 (TISS) | alta | alto | Nenhum arquivo de `convenios/` editado aqui; propostas TISS documentadas; integração por rebase do #55 sobre a UI (decisão do agente TISS em `docs/convenios/menu-convenios.md`) |
| E2E dependentes de texto | média | médio | `grep` em `e2e/` antes de trocar copy |
| Mudança em autenticação (UX-002) | baixa | alto | Testes dos dois ramos; revisão de anti-enumeração |

## 27. Registro de implementação

| Data | ID | Alteração | Testes | Evidência |
| --- | --- | --- | --- | --- |
| 14/11/2026 | — | Worktree e branch criados; ambiente local seguro; documento criado | linha de base vitest 224/224 | este arquivo |
| 14/11/2026 | UX-001 | `Field` liga dica/erro/obrigatoriedade ao controle | 4 arquivos, 20 testes, 0 falha; ESLint/Prettier OK | `src/components/ui/field.tsx`, `field.test.tsx` |
| 14/11/2026 | UX-002 | Login distingue serviço fora do ar de senha errada | 5 arquivos, 50 testes, 0 falha; `check:observability` OK | `src/lib/auth/auth-availability.ts` (+teste), `src/app/(app)/login/actions.ts` (+teste) |
| 14/11/2026 | UX-005 (piloto), UX-007 | Novo agendamento: todos os erros de uma vez, no campo; foco no primeiro inválido; catálogo vazio com saída; data `dd/mm/aaaa` no aviso de sucesso; `Combobox` repassa `aria-describedby`/`aria-invalid` e mostra borda de erro | 6 arquivos, 40 testes, 0 falha (inclui contratos de design e conteúdo) | `agenda/new-appointment-drawer.tsx` (+teste), `agenda/data.ts` (`canManageProcedures`), `components/ui/combobox.tsx` |
| 14/11/2026 | UX-008 | Título próprio em todas as telas | `page-titles.test.ts` 3/3; contratos 84/84; ESLint 74 arquivos OK | ver ficha UX-008 |
| 14/11/2026 | INC-01 / UX-009 | Incidente de `/conversas` investigado; pollers com uma chamada por vez; Sentry desligado só neste ambiente local | 69 testes; 3 sondas no servidor real | seção 19.1 |
| 14/11/2026 | Auditoria | Varredura completa: 39 rotas × 5 larguras, 0 falha; achados nas seções 07, 10, 15, 17, 18, 21 | — | `.tmp/ui-audit/evidence/2026-11-14/varredura-completa/` |
| 14/11/2026 | UX-010, UX-017 (parcial) | Fronteira de erro honesta e anunciada; `h1` em `/auth/auth-error`; `main` em `/join`; nome na busca de modelos | 19 arquivos, 169 testes; ESLint 0; **`tsc --noEmit` 0 erro** (duas rodadas: 21h30 e depois destas edições) | `route-error.tsx` (+teste), `auth-error/page.tsx`, `join/layout.tsx`, `templates-manager.tsx` |
| 14/11/2026 | P0.1–P0.4 | Auditoria de Asaas live, credenciais de produção, disco e Git (00.5); limpeza do meu `.next/cache/webpack` (17,73 → 17,89 GB livres) | — | 00.5 |
| 14/11/2026 | Commits | `06af3f84` UX-001 · `f8f26cf9` UX-002 · `099f339e` UX-005/007 · `4e39880f` UX-009 · `1df78a87` UX-010 · `15b060c1` UX-017 · `5d04e48f` UX-008 · `4acd59f8` UX-017 (convite) · `9710a207` UX-006 | cada commit com seus testes verdes | `git log` |
| 14/11/2026 | UX-017 (convite), UX-006 | Convite sem token abre pelo problema; cadastro rápido de paciente na gaveta | convite 11/11; agenda + contratos 18 arquivos, 142 testes; ESLint 0 | ver fichas |

## 28. Pendências e bloqueios

| # | Pendência | Tipo | Quem destrava |
| --- | --- | --- | --- |
| P-01 | Ver `/admin/*` logado (super_admin + MFA) | bloqueio de credencial | fundador autorizar o uso de `SUPER_ADMIN_*_DEV` ou ver junto |
| P-02 | Ver telas com papéis diferentes de `owner` (médico, recepção, financeiro) | conta de teste | criar contas de teste por papel na clínica "teste final" (escrita no DEV; pedir aprovação) |
| P-03 | Rodar Convênios TISS localmente (branch da #55, migrations 0144+ no DEV) | coordenação | agente TISS / fundador |
| P-04 | Instalar skills de terceiros, se desejado | decisão | fundador |
| P-05 | Pesquisa real com usuários (entrevistas, analytics) | inexistente | fundador |
| P-06 | UX-006 (cadastro rápido de paciente na gaveta de agendamento) exige uma Server Action nova sobre `createPatient` (Nome + CPF obrigatórios; `requireFreshPermission(CREATE_PATIENT)` já existe no domínio) e atualização do inventário de segurança | aprovação | fundador |
| P-07 | **Sentry compartilhado recebe erros de desenvolvimento.** Arquivos: `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts`. Contrato: DSN de reserva fixo no código + `environment: NODE_ENV` + `onRequestError = captureRequestError`. Evidência: INC-01 (evento `7590707702` veio do `localhost` deste worktree). Impacto: falsos incidentes (renders abortados pelo navegador, recarga do Turbopack) e Preview marcada como `production`. Proposta: DSN só por variável (sem reserva no código); `environment` a partir de `VERCEL_ENV` com `NODE_ENV` de reserva; filtrar `Error: aborted`/`ECONNRESET` de requisição cancelada pelo cliente. Regressões: produção continua reportando (variável presente na Vercel Production), testes de `sentry-scrub`. **Não alterado aqui:** os mesmos arquivos estão modificados no worktree do TISS e a #53 trata o ambiente do Sentry | coordenação | agente AbacatePay (#53) com o agente TISS |
| P-08 | Ler o payload do evento `7590707702` (título, `transaction`, stack) para fechar a causa histórica do INC-01 | acesso ao Sentry | agente com acesso ao Sentry |
| P-09 | Origem do `fetch('data:,')` bloqueado pela CSP (`connect-src`) visto nas sondas | descoberta | esta frente (Lote 2) |
| P-10 | Aviso de hidratação de **atributo** em `/equipe` (375 px): 1× na varredura, 0× em 2 visitas seguidas (`hydration-probe.ts`); texto completo não capturado (a varredura corta em 300 caracteres). Rodar a sonda com mais repetições e guardar o diff | investigação | esta frente |
| P-11 | `/equipe` não terminou de carregar em 10 min numa visita isolada (sem `GET /equipe` no log e sem erro), e carregou em ~11 s nas duas seguintes. Mesmo padrão de instabilidade de conexão do INC-01; sem causa isolada | investigação | esta frente |
| P-12 | Massa de teste com fila do dia no Consultório e atendimentos de hoje na Agenda, para auditar esses estados com dados (escrita no DEV, clínica de teste) | aprovação | fundador |
| P-13 | **Trava do Asaas de produção fora da Production** (00.5, P0.1): proposta pronta; aplicar no `env.ts` exige coordenação com a PR #53 | coordenação | agente do billing/payments |
| P-14 | Limpeza de disco fora deste worktree (00.5, P0.3): `.next` de ~12 worktrees já na `main` (~16 GB), `dist` de 10,3 GB no worktree do billing, worktrees integrados | decisão | fundador (e agente do billing para o `dist`) |
| P-15 | Regenerar `docs/security/acoes.md` (`inventory.ts --write`) no commit de integração depois da #53 — o portão `security:inventory --check` falha nesta branch desde a base (ações do billing) e agora inclui `criarPacienteRapido` (UX-006) | integração | esta frente, no merge |
| P-16 | Conflitos previstos na integração com a #55: `agenda/new-appointment-drawer.tsx`, `agenda/data.ts`, `pacientes/[id]/page.tsx`; com a #53: `modelos-receita/templates-manager.tsx` | integração | esta frente + agentes TISS e billing |

## 29. Estado de execução

Ver o bloco **ESTADO ATUAL DA EXECUÇÃO** no topo (fonte única). Histórico de fases:

| Data | Fase | Resultado |
| --- | --- | --- |
| 14/11/2026 | 1 Descoberta | 64 páginas na branch de UI + 13 de Convênios na #55; papéis e permissões; DS e contratos mapeados |
| 14/11/2026 | 2 Estudo | 12 repositórios principais, 38 originais do R3, 63 skills do R4 e 16 complementares verificados; leitura registrada em 04 |
| 14/11/2026 | 3 Auditoria | em andamento (rotas públicas medidas; logadas na varredura) |
| 14/11/2026 | 5 Lote 1 | UX-001, UX-002, UX-005 (piloto), UX-007, UX-008, UX-009 implementados e testados |
| 14/11/2026 | INC-01 | `/conversas`: não reproduzido após reinício; causa histórica indeterminada; defeito de concorrência corrigido (19.1) |

## 30. Protocolo de continuidade

1. Ler o bloco de estado e a seção 00.
2. `git -C C:\dev\Qoro_ui_otimizacao_final_20261114 status` e `git log -5`: conferir que o código
   bate com a seção 27.
3. Subir o servidor (00.3) só se a próxima ação precisar ver a tela.
4. Continuar do "Próxima ação exata". Ao terminar uma unidade de trabalho: atualizar 27, a
   intervenção (status e evidências), a matriz 03.4 e o bloco de estado — **antes** de começar a
   próxima.
5. Antes de encerrar uma sessão ou quando o contexto estiver grande: atualizar o bloco de estado
   com arquivos modificados, testes rodados, pendências e o próximo passo exato.
6. Divergência entre documento e código: investigar, reconciliar, registrar.

---

## 31. Convênios TISS (subseção específica)

EM_ANALISE — preenchimento na Fase 3 (inventário C01–C11 em 03.1; diagnóstico; arquitetura
proposta; especificações por tela; intervenções UX-TISS-001…; matriz de cobertura; coordenação).
Fatos já levantados:

- **Situação real (plano mestre TISS, 14/11):** 65 de 117 tarefas; **nenhuma capacidade em
  produção** e nada ligado para usuários reais (bloqueio B10); conector com operadora bloqueado
  (B5); interface de guias, lotes e conciliação implementada e testada na #55.
- **Menu:** o agente TISS deixou pronto o ponto de integração (`docs/convenios/menu-convenios.md`
  na #55): item "Convênios" no grupo Gestão, depois de Financeiro, `requires: VIEW_FINANCIAL`;
  aplicar depois do merge da branch de UI na `main` e do rebase do #55.
- **Regra de exibição:** ver o item não é poder operar. Operar exige assinatura paga e verificável,
  plano que inclui Convênios, `manage:financial`, módulo habilitado na clínica e clínica ativa; no
  trial a página mostra o recurso como contratável e nada é operado.
- **Navegação interna atual:** 9 abas planas (Painel, Atendimentos, Solicitações, Guias, Lotes,
  Conciliação, Repasses, Carteirinhas, Configuração) em `convenios/_lib/tabs.tsx`.
- **Pontos fortes já presentes:** o painel separa Faturado, Recebido, Glosa em aberto ("ainda pode
  ser revertida"), Glosa definitiva, A receber e Recebido sem conciliar; o lote diz "Enviar não é
  receber"; a conciliação diz "o paciente paga só a coparticipação, nunca o valor da consulta".
