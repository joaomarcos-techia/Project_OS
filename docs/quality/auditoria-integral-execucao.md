# Auditoria integral — execução de 28/09/2026

## Estado

**PARCIAL.** A execução automatizável deste lote foi concluída no candidato
atual. Ausência de execução é `NOT TESTED` ou `BLOCKED`; existência de teste ou
resultado histórico não é `PASS` atual. O estado não autoriza promoção para
produção porque os E2E autenticados de Preview e parte dos providers continuam
sem prova atual.

O canal externo Meta/WhatsApp é a única exclusão expressa e recebe
`ADIADO_WHATSAPP`. Os testes determinísticos internos continuam na regressão.

## Candidato e ambiente

| Campo | Valor sanitizado |
| --- | --- |
| Repositório | `C:\dev\ClinicaOS_V2` |
| Branch | `snapshot/estado-atual-2026-09-27` |
| Base | `7d6032dd98e03be53b1f86105dcdd9ce1c5079be` |
| Início medido | 28/09/2026 03:00 BRT |
| Node / pnpm | 22.16.0 / 11.17.0 |
| Estado inicial | `docs/prompts/auditoria-integral-testes-e2e-sem-whatsapp.md` já estava não rastreado; foi preservado |
| Operações externas | Asaas Sandbox com fixtures descartáveis e readback; chamadas Gemini de baixo custo; uma mensagem Resend para caixa de teste consentida |
| Produção | nenhuma leitura autenticada, escrita, migration, deploy, push ou merge |

Inventário estático recalculado: 154 documentos (incluindo este relatório), 54 páginas, 41 arquivos
`route.ts`, 58 specs Playwright, 44 deles `production-*`, uma suíte em
`security-e2e` e, após três regressões novas deste lote, 387 arquivos de teste
em `src/`. O runner Playwright descobre 94 casos; 55 arquivos têm `test.skip`
condicional, 5 usam espera fixa, 13 usam alguma asserção `status < 500` e não há
`only`/`fixme`. Essas ocorrências não foram convertidas em cobertura por contagem.

## Autoridade documental consultada até este checkpoint

Foram lidos `docs/README.md`, `docs/CURRENT-STATE.md`, `docs/VisãoGeral.md`,
`docs/CONVENTIONS.md`, `organizar_docs.md`, `docs/development/testing.md`,
`e2e/README.md`, os dois documentos de cobertura E2E, o checkpoint mais recente
de `docs/qorov2.md`, os specs corrigidos e os contratos/guards chamados por eles.
O inventário integral dos demais documentos continua em andamento.

Partes históricas já identificadas:

- `docs/CURRENT-STATE.md` retrata 18/08/2026;
- `docs/quality/e2e-coverage-audit.md` ainda usa contagens de 51/53 specs e diz
  que nenhum Playwright roda no CI;
- `docs/development/testing.md` afirma, em trechos diferentes, que o E2E entrou
  no CI e que não faz parte do CI;
- o código atual possui 19 crons e o CI versionado chama `test:e2e:ci` e
  `security:browser-session`.

## Baseline segura

| Comando | Exit | Resultado atual | Status |
| --- | ---: | --- | --- |
| `pnpm format:check` | 0 | árvore compatível com Prettier | PASS |
| `pnpm typecheck` | 0 | TypeScript sem erros antes e depois do lote | PASS |
| `pnpm lint` | 0 | ESLint integral sem erros na baseline | PASS |
| `pnpm check:migrations` | 0 | 3 migrations destrutivas aprovadas pelo registro existente | PASS |
| `pnpm check:observability` | 0 | 19 crons e 7 eventos de saved search | PASS |
| `pnpm check:registry:strict` | 0 | 67 eventos, 25 handlers e 42 `PRODUCER_AHEAD` allowlisted | PASS |
| `pnpm arch:check` | 0 | 1.182 arquivos, zero ciclo | PASS |
| `pnpm arch:graphs --check` | 0 | 56 elementos, 297 arestas, zero ciclo | PASS |
| `pnpm arch:db-check` | 0 | 1.261 arquivos, zero achado | PASS |
| `pnpm test:coverage` | 0 | 384 arquivos, 3.763 testes; linhas 51,58%, branches 81,92%, funções 57,65% | PASS na base; fotografia de cobertura anterior às regressões novas |
| `pnpm test` final | 0 | 387 arquivos, 3.771 testes, 112,49 s | PASS integral no candidato final |
| `pnpm security:inventory` | 1 → 0 | documento gerado estava velho; readback atual: 174 actions, 43 métodos, zero gap de rota | PASS após correção |
| `pnpm security:unit` | 0 | 28 arquivos, 332 testes | PASS |
| `pnpm security:tenant` | 0 | A→B e B→A negados; controle próprio permitido; teardown 0 | PASS |
| `pnpm security:build` | 0 | Next 15.5.24 compilou o candidato após AIT-007–AIT-010 | PASS |
| `pnpm build` | 0 | build normal de produção compilado, tipado e com 9 páginas estáticas geradas | PASS |
| `pnpm security:bundle` | 0 | 165 arquivos cliente, zero canário/segredo | PASS no build final |
| `pnpm security:http` | 0 | 12 vetores, 306 requests, 153 actions, 47 negativas 200; nenhum erro JS/Zod exposto | PASS no build final |
| `pnpm test:e2e:ci` | 0 | 6 PASS, 2 skips condicionais de Turnstile | PARTIAL; skip não conta como PASS |
| `pnpm security:browser-session` | 0 | 6/6 PASS | PASS no build final |
| `signup-regression.ts --browser` | 1 → 0 | 24 checks: Postgres descartável, SDK/HTTP, Redis/Auth sintéticos, Chromium e cleanup | PASS após AIT-010 |
| focados AIT-007–AIT-010 | 0 | ordem de auth, artefatos e host efetivo | PASS |
| `pnpm test:load` | 0 | 500 consultas, 5.000 jobs, 1.000 webhooks 2xx, 20 reconciliadores; zero deadlock; scratch removido | PASS |
| `pnpm payments:live-check` | 1 → 0 | primeira repetição encontrou DELETE 500 mas limpou tudo; final 18/18, três cobranças, webhook e customer limpos por readback | PARTIAL; refund pago não verificável |
| `pnpm billing:live-check` | 0 | assinatura `ACTIVE` relida, cancelada como `INACTIVE`; customer ausente após cleanup | PASS no Sandbox |
| `pnpm ai:live-check` | 0 | 15 tools reais, dois function calls esperados; custo medido de US$ 0,003358 | PASS live |
| `pnpm ai:adversarial` | 1 | 2/50 cenários executados; provider respondeu 429 também após espera/retry | BLOCKED por quota/rate limit |
| `pnpm email:live-check` | 1 → 0 | guarda recusou ambiente não classificado; repetição DEV para caixa consentida foi aceita pelo Resend | PARTIAL; recebimento no inbox não observado |
| probe Upstash DEV | 0 | host HTTPS allowlisted e `PING` autenticado respondeu `PONG`; nenhum valor impresso | PASS read-only |
| `pnpm test:auth-e2e` + readback | 0 | login, claims, refresh e revogação global; zero fixture SQL/Auth ao final | PASS DEV |

## Achados

| ID | Tipo / severidade | Contrato e reprodução | Causa | Correção | Reteste atual |
| --- | --- | --- | --- | --- | --- |
| AIT-001 | drift documental / média | `security:inventory` deve fechar no source atual; o check saiu 1 somente por linhas antigas em `docs/security/acoes.md` | artefato gerado envelhecido | inventário regenerado sem alterar guards | PASS, exit 0, 174/43, zero gaps |
| AIT-002 | defeito de teste / alta | rotas autenticadas aceitavam 404/negativa e contagens não afirmadas; falta de link dinâmico virava `empty` e PASS | heading de ausência médica exigia fixture practitioner; Conversas mudou o link para `?conversation=` enquanto o teste procurava `/conversas/[id]` | exige HTTP 200, heading por rota, ausência de negativa/404 e converte a seleção atual no deep-link canônico | PASS DEV 2/2: 26 rotas + paciente/conversa reais; cleanup zero |
| AIT-003 | defeito de teste / crítica | sessão tenant em `/admin` só precisava não encontrar alguns textos | HTML bruto confundia o nome da rota com conteúdo; probes diretos perdiam cookie `Secure`; RSC Flight usa HTTP 200 para carregar fallback 404 | controle `/dashboard` 200; HTML exige 404/not-found/mesma URL; RSC exige `NEXT_HTTP_ERROR_FALLBACK;404`; cookie real é enviado aos handlers sem seguir redirect | PASS DEV 1/1; 11 páginas/deep-links + quatro handlers; cleanup zero |
| AIT-004 | defeito de teste / alta | qualquer tela diferente de “Nenhuma conta” era tratada como conectada; qualquer erro de login virava provável rate limit | classificador binário permissivo e `catch` genérico | dois marcadores exclusivos; estado desconhecido falha; autenticação propaga; chave inválida deve sumir do campo/HTML; cleanup preserva erro primário | código + typecheck/lint PASS; Asaas Sandbox NOT TESTED |
| AIT-005 | defeito de teste / alta | CRUD de modelo limpava apenas no fim feliz e dependia de `.listrow` | teardown não protegido e seletor de estilo | `data-testid` estável e cleanup sempre executado, agregando falha funcional e de limpeza | código + typecheck/lint PASS; Preview mutável NOT TESTED |
| AIT-006 | drift documental / média | contagens e afirmações sobre CI contradizem código e a própria documentação | checkpoints históricos apresentados como atuais | adendos desta execução; reconciliação integral em andamento | PARTIAL |
| AIT-007 | produto + gate / alta | request de Server Action com cookie inválido e sem payload respondeu `Cannot read properties of undefined (reading 'get')` antes da negativa | `cancelarSerieRecorrenteAction` lia `FormData` antes de autenticar; o gate HTTP aceitava qualquer envelope de erro | `requireUser` + permissão cached antes de entrada; domínio mantém permissão fresh; 2 regressões de ordem | 2/2 e `security:http` PASS |
| AIT-008 | segurança do harness / alta | `E2E_ARTIFACTS=0` ainda retinha trace/screenshot/vídeo; 40 specs tinham overrides, alguns com vídeo sempre ligado | política global permissiva e sobrescritas locais | padrão `off`; somente `E2E_ARTIFACTS=1` captura; overrides removidos; ratchet estático | 2/2 e Playwright local final PASS; regressão integral registrada abaixo |
| AIT-009 | produto + gate / alta | cookie inválido em `autosaveProntuario` devolveu ao cliente a lista estrutural do Zod (`invalid_type`, `expected`, `received`) | o adaptador validava o conteúdo antes de chamar o domínio, cuja autenticação vem primeiro | validação duplicada removida; domínio segue como fonte do schema; gate passou a reprovar detalhes Zod | regressão focal + `security:http` PASS |
| AIT-010 | produto / alta | a própria página em `http://127.0.0.1` recebia 403 `cross_site_origin` porque `next start` reconstruía `req.url` com `localhost` | a rota inferia a autoridade externa por `req.url`, e não pelo `Host` efetivamente solicitado | usa `Host` sanitizado pelo runtime, com fallback para a URL; teste cobre autoridades divergentes; orçamento Redis do harness é zerado entre famílias | 25 testes focais, jornada local 24/24 e gate HTTP PASS |
| AIT-011 | harness externo / alta | o smoke de pagamentos removia fixtures em best effort, sem provar o estado terminal, e aceitava qualquer `ASAAS_BASE_URL` | cleanup não integrava o resultado, não relia cada cobrança e só confiava no marcador da chave | host/path oficiais allowlisted; baixa manual desfeita; todas as cobranças, webhook e customer têm cleanup/readback obrigatório | final 18/18 PASS no Sandbox; 1 cenário pago `NOT TESTED` |
| AIT-012 | harness externo / alta | o smoke de billing aceitava endpoint configurável sem provar Sandbox e não limpava assinatura/customer | faltavam allowlist positiva e `finally` transacional do harness | somente host HTTPS oficial Sandbox e chave de homologação; assinatura termina `INACTIVE` e customer ausente | PASS no Sandbox com readback |
| AIT-013 | evidência externa / média | disponibilidade parcial de provider podia ser apresentada como suíte live verde | smokes felizes, quota adversarial e entrega final têm limites diferentes | resultados separados: Gemini funcional PASS; adversarial BLOCKED após 429; Resend aceitou a mensagem, mas inbox não foi observado | PASS/PARTIAL explícitos; nenhuma promoção inferida |
| AIT-014 | observabilidade / alta | o runner redigia seus IDs, mas o adapter emitia IDs completos em métricas e no `path` de erros 4xx/5xx | a segunda linha de sanitização cobre segredo/PII por chave, não identificador opaco em campo genérico | IDs do Asaas e `externalReference` são redigidos no call-site; URL real enviada ao provider não muda | 43/43 focados, build e 3.771/3.771 integrais; saída live sanitizada |

## Limites atuais

- Os quatro specs autenticados corrigidos ainda não foram executados contra um
  Preview isolado nesta revisão. Portanto não recebem `PASS` de navegador.
- O ciclo de conta Asaas pela UI ainda exige
  `E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`. Os adapters financeiros foram
  exercitados diretamente no Sandbox e limpos, mas isso não substitui o E2E
  autenticado da tela nem um checkout realmente pago.
- O Supabase Auth DEV passou login, custom claims, refresh e revogação global,
  com zero fixture SQL/Auth no readback. Isso não cobre o e-mail de cadastro.
- O Resend aceitou uma mensagem DEV para a caixa de teste consentida. A chegada
  ao inbox e o fluxo completo de cadastro continuam `NOT TESTED`; a jornada
  automatizada de cadastro usa fixtures de loopback. Storage não recebeu probe
  externo atual.
- Upstash DEV recebeu somente `PING` autenticado read-only e respondeu `PONG`;
  o teste não comprova as credenciais de Preview/PROD nem os dashboards.
- O adversarial Gemini permanece `BLOCKED`: 2/50 cenários rodaram e o provider
  respondeu 429 no primeiro pedido seguinte e no retry após 30 segundos.
- O teste de carga é local e isolado. Ele prova concorrência, latência e cleanup
  no scratch, não capacidade ou configuração do deploy.
- As 44 ferramentas `production-*` não foram executadas. Seus resultados
  históricos não foram reaproveitados.
- Turnstile teve 6 cenários públicos aplicáveis e 2 skips condicionais; o par
  ausente permanece `NOT TESTED` neste ambiente sintético.
- WhatsApp externo, App Review, WABA, perfil, template, envio e callbacks estão
  `ADIADO_WHATSAPP`. Os testes internos determinísticos seguem no denominador da
  regressão de código.

## Continuação independente — 29/09/2026

O candidato foi sincronizado logicamente com a `main`
`5c6f5503d4a356b19bd594a00c3079b63613d74a` (PRs #20–#23 presentes), preservando
o trabalho não commitado. Não houve push, deploy, migration ou escrita em
produção neste lote.

### Resultados adicionais

| Área | Evidência executada | Veredito |
| --- | --- | --- |
| Inventário de 75 arquivos | [`e2e-75-files-inventory.md`](e2e-75-files-inventory.md), 75 linhas classificadas com decisão e referências | PASS para o inventário; nenhuma limpeza arbitrária |
| Inbox Resend | inspector/API e runner `email:inbox-check`; provider aceitou e permitiu localizar a mensagem | PARTIAL; conteúdo final da caixa depende de `E2E_RESEND_INBOX_ADDRESS`, ausente |
| `/admin` positivo | jornadas focadas executadas com credenciais DEV de super_admin | PASS 12/12 |
| `/admin` negativo | owner DEV sintético, 11 páginas/deep-links, RSC e quatro handlers | PASS 1/1 em 50,2 s; cleanup SQL/Auth zero |
| Shell autenticado read-only | owner practitioner, paciente e conversa cifrados, todos sintéticos | PASS 2/2: 26 rotas estáticas + dois deep-links; cleanup 0/0/0/0 |
| Gemini 48 | fonte original confirmada como índices 3–50; 3–12 executados | 10 PASS; 38 BLOCKED. O cenário 13 recebeu a resposta de quota diária gratuita do provider; não foi classificada como dinheiro |
| Turnstile | dois condicionais com chaves oficiais de teste e secret somente no shell | PASS 2/2: aceito e recusado |
| Storage DEV externo | operações próprias, negações anônima/role/cross-tenant, signed URL + expiração e teardown | PASS; cleanup exato |
| Checkout PIX/cartão Sandbox | runner do checkout hospedado, um por método, com cleanup | BLOCKED pelo reCAPTCHA; nenhum pagamento/refund foi inventado como PASS |
| `production-*` | 44 arquivos exatos, 47 casos, invocados por caminhos relativos | 44 skipped e 3 bloqueios de pré-condição; zero cenário funcional PASS |
| WhatsApp real | configuração externa/banco/código comparados | BLOCKED: Meta aponta callback do app compartilhado para PROD e o número autorizado pertence ao DEV; nenhuma mensagem externa foi enviada atravessando ambientes |
| RBAC DEV | fixtures distintas owner/gestor/doctor/attendant/financial | bundle PASS; matriz UI 5 × 15 PASS; grant/revoke PASS com revogação da sessão antiga nas duas transições; cleanup zero |

A primeira invocação das 44 suítes usou caminhos absolutos do Windows e o
Playwright respondeu “No tests found”; ela foi descartada. A repetição válida
usou os 44 caminhos relativos e produziu o consolidado acima. Três casos
(`production-dashboard-financial-rbac`, `production-dashboard-operational-a` e
`production-whatsapp-settings-rbac`) falharam antes do produto porque o alvo
não era `app.qoro.dev`; os demais ficaram nos opt-ins declarados.

### RBAC: falha do teste e bloqueio externo

O novo `dev-rbac-matrix.spec.ts` cria cinco identidades Auth distintas, uma por
role tenant, e compara permissões efetivas com `role_permissions`. Essa parte
passou. A injeção programática inicial de cookie estava incompleta porque não
criava o seletor de geração exigido pelo middleware; o spec passou a usar o
login real.

Durante a matriz de 75 navegações, o Supabase DEV alternou entre `ENOTFOUND`,
connect timeout e `UND_ERR_SOCKET` em `getClaims()`. Isso redirecionou a sessão
para `/login`. O teste também tinha um falso verde: numa rota permitida, só
afirmava ausência de “Sem acesso”, condição também verdadeira na tela de login.
Agora exige que o pathname permaneça exatamente na rota solicitada. A execução
foi interrompida por estar inválida e o teardown foi confirmado: uma clínica,
cinco usuários Auth e cinco profiles sintéticos removidos; zero resíduos. A
As tentativas no modo dev permaneceram inválidas: uma excedeu o evento `load`
apesar de a rota responder 200 e outra perdeu a conexão quando o próprio Next
reiniciou por limite de memória. O harness passou a aguardar
`domcontentloaded`, mantendo status, pathname e conteúdo obrigatórios, e deixou
de aguardar a navegação duas vezes no clique de login. O build atual terminou
com exit 0 e a repetição contra `next start` percorreu as 75 combinações de cinco
roles por quinze áreas: **PASS 1/1**. Permitidos e negados foram comparados ao
bundle efetivo lido do banco, e o readback final confirmou zero resíduos.

O cenário dinâmico foi então executado isoladamente. O owner concedeu
`manage:procedures`, a sessão já aberta do usuário foi recusada por
`CLAIMS_OUTDATED`, e uma nova autenticação liberou a rota. Após a remoção da
permissão, a sessão renovada também foi recusada pelo mesmo controle. Resultado:
**PASS 1/1** em aproximadamente cinco minutos. O readback final confirmou zero
clínicas e zero perfis sintéticos residuais.

### Correção: confirmação visual de cancelamento

O estado financeiro já impedia um segundo cancelamento, mas a experiência tinha
três lacunas: o diálogo não fechava explicitamente ao concluir; o estado final
`cancelled` não possuía confirmação persistente; e a repetição idempotente
aparecia como erro vermelho. A tela agora:

- fecha o diálogo quando a Server Action retorna sucesso ou erro e revela o
  alerta fora dele;
- mostra “Assinatura cancelada” de forma persistente, inclusive após reload;
- trata `subscription_already_cancelled` e `cancellation_already_scheduled`
  como confirmação idempotente, sem chamar o Asaas novamente;
- mantém “Manter assinatura” para cancelamento agendado e “Reativar assinatura”
  para o estado final.

O spec antigo de produção dizia que cancelamento em trial deveria ficar oculto;
isso contradizia a implementação vigente. Ele foi convertido em probe read-only:
owner abre/fecha a confirmação, doctor é negado e nenhuma mutação é enviada.

Validação da correção: 47/47 testes focados em quatro arquivos, TypeScript exit
0, ESLint exit 0, `diff --check` exit 0 e inventário de segurança exit 0 (180
actions, 49 métodos de rota, 262 acessos `process.env`, zero item não resolvido).

### Bloqueios que continuam reais

- leitura final do inbox consentido;
- ação humana do reCAPTCHA para produzir pagamento PIX/cartão e então refund;
- credenciais/opt-ins específicos das suítes de produção, sem reutilizar contas
  reais;
- app Meta de teste com callback DEV para comprovar WhatsApp → IA → resposta;
- crédito final da conversão no Google Ads depois de a campanha ser ativada.

## Incidentes Sentry recebidos em 30/09/2026

Os doze eventos foram reavaliados contra o código e o banco atuais. O rótulo
`environment=production` do Sentry não foi usado como prova de produção: três
eventos vieram de `127.0.0.1`, e os eventos Vercel de cron apontavam um deployment
de Preview. O resultado por grupo é:

| Issues | Classe | Veredito e evidência atual |
| --- | --- | --- |
| `7761306993`, `7761312693`, `7761464180` | sessão Auth viva após o profile sintético ser removido | **BUG CORRIGIDO EM CÓDIGO.** As páginas de conversas agora usam `pageGate`, que redireciona sessão inválida, e o polling de handoff devolve fila vazia quando `getCurrentUser()` não encontra identidade. Testes focados cobrem página, detalhe, ausência de profile, negação e tenant efetivo. |
| `7740190698`, `7741708113` | migration ausente em releases antigas | **HISTÓRICO / NÃO REPRODUZIDO.** Readback PROD atual: 107 migrations, coluna `signup_sessions.billing_attempt_state` presente, tabela `onboarding_progress` presente e três policies. |
| `7742558376`, `7760226767`, `7760239586`, `7760239795` | backend do transaction pooler contaminado como read-only | **RECORRÊNCIA CONFIRMADA, RECUPERADA AGORA.** Os quatro jobs depois gravaram heartbeat `success`; 48/48 amostras atuais deram `transaction_read_only=off`, `default_transaction_read_only=off` e `pg_is_in_recovery=false`. A varredura de `src/`, `scripts/` e migrations não encontrou `SET default_transaction_read_only=on` nem `SET SESSION CHARACTERISTICS ... READ ONLY`; um ratchet automatizado impede introduzi-los. Isso não prova que nenhum cliente externo volte a contaminar o pool. |
| `7750368284`, `7762094898`, `7762110440` | timeout de conexão PostgreSQL | **TRANSIENTE / RECUPERADO.** Os dois últimos ocorreram no mesmo deployment/instância Vercel em intervalo de três minutos; o primeiro era DEV antigo. O health estrito atual de `app.qoro.dev` retornou HTTP 200 com banco e subsistemas `ok`; o heartbeat posterior de `outbox` é `success`. Não foi adicionado retry cego do cron, pois repetir o handler inteiro pode duplicar efeitos externos. |

Heartbeats observados por leitura: `outbox` e `signup-sessions-cleanup` em
30/09, `proactive-dunning` e `proactive-waitlist` em 29/09, todos com
`last_status=success`. Nenhuma escrita ou chamada destrutiva foi realizada.

### Telas de configurações do tenant

`tenant-settings-screens.spec.ts` foi reexecutado contra o build local e o
Supabase DEV com owner descartável: **3/3 PASS** em 2,3 minutos. A prova baixou
o CSV real de auditoria e travou suas colunas, carregou a fila LGPD e criou,
recarregou e excluiu um modelo de receita. O readback final confirmou zero
clínicas, profiles e templates da fixture.

A primeira tentativa era inválida por configuração do harness: o login
canônico gravou os cookies para `localhost`, mas o runner abria o request
seguinte em `127.0.0.1`. O middleware corretamente redirecionou a requisição
sem cookie para `/login`. Depois de manter um único host, os mesmos três casos
passaram sem alterar produto ou expectativa.

## Adendo — revalidação de 30/09/2026

| Área | Execução real | Estado |
| --- | --- | --- |
| Regressão local | TypeScript e ESLint exit 0; Vitest 431 arquivos / 4.496 testes; Next 15.5.24 build exit 0 | **PASS deste checkout** |
| Playwright CI local | 8 casos coletados; 6 executados e aprovados; 2 condicionais deliberadamente skipados; exit 0 em 26,3 s | **6 PASS + 2 SKIP**, sem promover os skips a PASS |
| Incidentes `NO_PROFILE`/journal/Supavisor | 5 arquivos, 19 testes | **PASS** |
| Migrations source ↔ PROD | 105 locais × 107 no banco; 13 hashes locais ausentes e 15 hashes remotos desconhecidos | **FAIL**: `0105–0106` aplicadas no banco não existem nesta branch/main |
| `payments-account-lifecycle` Preview | chave inválida exercitada; ciclo mutável encontrou conta já conectada | **1 PASS + 1 PRECONDITION BLOCKED** |
| Resend inbox | mensagem entregue e recuperada no inbound address consentido; nonce validado sem expor conteúdo | **PASS ponta a ponta do transporte** |
| Cadastro por e-mail | cinco contratos locais executados; Preview antigo devolveu 403 no bootstrap | **PASS local; BLOCKED no Preview desatualizado** |
| Redefinição de senha | UI → Resend recebido → link → HIBP → conta TOTP/AAL1 → senha concluída | **PASS DEV; bug `insufficient_aal` corrigido** |
| Convite de equipe | inicial recebido → reenvio recebido → link antigo negado → aceite/tenant → replay negado → cleanup | **PASS DEV local; BLOCKED no Preview desatualizado** |
| Gemini 3–50 | 3–29 executados; 28 passou após timeout, 29 passou após dois retries 429 e 30 recebeu três 429 consecutivos | **27 PASS, 1 BLOCKED, 20 NOT RUN** |
| `production-*` | anônimo, RLS read-only, RLS rollback e preço fundador executados | **4 PASS, 40 SKIP, 3 PRECONDITION BLOCKED** em 47 casos |
| Google Ads sem campanha | gates `comecar` 27/27, `conversao` 2/2 e `seguranca` 20/20 | **PASS local; atribuição final BLOCKED** |
| Asaas PIX | criação PENDING → confirmação Sandbox → readback RECEIVED | **PASS até pagamento** |
| Refund PIX | integral recusado; parcial aceito e lido como `AWAITING_CRITICAL_ACTION_AUTHORIZATION` | **BLOCKED antes de DONE** |
| Asaas cartão | cartão oficial Sandbox → `CONFIRMED` | **PASS até pagamento** |
| Refund cartão | provider respondeu 400 `invalid_action` | **BLOCKED** |

O diagnóstico anterior “checkout e pagamento exigem necessariamente reCAPTCHA”
ficou obsoleto: a documentação oficial e a execução confirmaram pagamento PIX
por endpoint exclusivo do Sandbox e cartão por dados oficiais de teste. Isso não
fecha o refund, que exige autorização crítica e só conta como concluído em
`DONE`. Os webhooks permaneceram habilitados e não interrompidos; nenhuma
entrega específica foi promovida a 2xx sem log de delivery.

A decomposição das 44 suítes, com pré-condição e resultado por arquivo, está em
[`production-44-execution.md`](production-44-execution.md). Ela registra 44/44
arquivos e 47 casos, sem converter os 40 skips ou os três bloqueios de alvo em
PASS.

### Remaining risk

- integrar numa única linha de código as migrations e o hosted checkout hoje
  dispersos entre este checkout, `origin/main` e a branch `integration`;
- publicar o source atual num Preview isolado e repetir cadastro/convite recebidos;
- reexecutar Gemini 30–50 quando o provider deixar de responder 429;
- concluir refund PIX/cartão no Sandbox após autorização crítica;
- executar os 40 casos de produção ainda skipados com fixtures e credenciais
  dedicadas, sem reutilizar contas reais;
- comprovar a causa externa do Supavisor read-only e uma mitigação estrutural de
  `CONNECT_TIMEOUT` além de timeout, observabilidade e próxima execução do cron;
- crédito final no Google Ads com campanha ativa;
- WhatsApp inbound → tenant → IA → outbound → recebimento real, sob trabalho do
  agente concorrente.

### Fronteira de integração final

Este fechamento foi validado no worktree em `5c6f550`. `origin/main` está em
`39902ba` e acrescenta o PR #24 (`d95a692`). Esse PR e esta rodada modificam em
comum a action, o teste e o E2E de redefinição de senha, além de
`docs/qorov2.md` e `docs/security/acoes.md`. A mesclagem não foi feita na árvore
compartilhada porque ela também contém trabalho concorrente de WhatsApp. O estado
publicado permanece diferente do estado validado; a integração precisa ocorrer
em worktree limpo e ser seguida pela regressão integral.

## Adendo — e-mail recebido e identidade real em 30/09/2026

O endereço inbound do Resend foi configurado depois da fotografia acima. A nova
prova não se limita à listagem de enviados: `email:inbox-check` esperou o evento
`delivered`, leu a mensagem na API de recebidos e conferiu um nonce presente no
corpo enviado e recebido. O inspector falha em eventos terminais negativos.

Dois fluxos de identidade foram atravessados em DEV:

| Fluxo | Cadeia executada | Resultado |
| --- | --- | --- |
| Recovery de conta com TOTP | formulário → Resend recebido → link real → HIBP → grant one-time → CAS → fallback Admin após `insufficient_aal` → login | **PASS**, senha da fixture preservada e cleanup completo |
| Convite de equipe | criação → Resend recebido → reenvio recebido → rotação → `/convite` → aceite → tenant → replay | **PASS local**, cleanup Auth/profile/idempotência completo |

O convite expôs que o auto-send do Supabase consumia o OTP antes do callback do
Qoro e terminava em `/login`. A implementação passou a gerar somente o hash,
usar template versionado e enviar pelo Resend; o clipboard segue como fallback.
Os testes focados de template, delivery, inspector e reset passaram **38/38**.
O TypeScript passou e o inventário regenerado fechou em 180 actions e 49 métodos,
sem gaps. O mesmo runner contra o Preview já existente não concluiu porque esse
deployment ainda não contém o source atual; seu estado permanece **BLOCKED**, e
não foi reinterpretado como falha do código local nem como PASS remoto.

O corpus Gemini avançou para **27 PASS (3–29)**. O cenário 28 passou depois de
um timeout e o 29 passou depois de dois retries por HTTP 429. O cenário 30 ficou
**BLOCKED — provider 429**; a execução recebeu três 429 consecutivos e saiu com
código 1. Os cenários 31–50 permanecem **NOT RUN**. O denominador original de
48 foi preservado.

## Adendo — Preview isolado e Gemini atual em 01/10/2026

A integração foi reconstruída num worktree limpo sobre `origin/main`, recebeu
as migrations 0105–0106 e o source auditado, e foi publicada no Preview da
branch `integration/2e2-final-20260930`. O fluxo
`payments-account-lifecycle` foi reexecutado com uma fixture exclusiva em DEV:
o runner criou tenant e owner, comprovou Database/Auth no mesmo projeto,
recusou uma chave inválida sem devolvê-la ao browser, conectou e desconectou a
conta Sandbox e removeu clínica/Auth com readback zero. Resultado funcional:
**2/2 PASS em 39,9 s**.

O modelo configurado anteriormente, `gemini-2.5-flash`, passou a devolver HTTP
404 com a indicação do próprio provider de que não estava disponível para esta
conta. A aplicação foi atualizada para `gemini-3.8-flash`, incluindo default,
tabela de custo, fixtures, scripts e documentação. O corpus original foi
reexecutado sem mocks: **48/48 PASS**, zero resposta final insegura, 48 chamadas
reais e custo calculado de **US$ 0,096410**. Evidências:
`C11_ADVERSARIAL_3_29.md`, `C11_ADVERSARIAL_30_30.md` e
`C11_ADVERSARIAL_31_50.md`.

O smoke C11 falhou primeiro porque percorria a fila global em lotes e eventos
antigos de outros tenants ocupavam os slots. A correção limita cada tick ao
evento priorizado da própria fixture. A repetição passou **18/18** e o readback
terminou com zero clínicas de smoke residuais.

### Regressão integrada final do worktree

`npx vitest run` terminou com **433 arquivos e 4.507 testes PASS** em 270,56 s.
ESLint integral, TypeScript, Prettier e o build Next 15.5.24 terminaram com exit
0; o build gerou 18 páginas estáticas. O inventário regenerado passou no
readback com 180 actions e 49 métodos.

O Playwright CI falhou primeiro por `ECONNRESET` usando um build isolado antigo.
Essa falha não foi descartada: ela revelou que `playwright.ci.config.ts` ainda
forçava `retain-on-failure`/`only-on-failure` e ignorava `E2E_ARTIFACTS=0`. O
config foi alinhado à política global e o ratchet passou a ler os dois configs
(**2/2 PASS**). Depois de executar `local-build.ts`, a suíte pública terminou
com **6 PASS + 2 SKIP condicionais**, exit 0 em 29,6 s. O readback do diretório
de resultados encontrou somente `.last-run.json`, sem trace, screenshot ou
vídeo.

## Adendo — refund e reexecução de produção em 01/10/2026

| Área | Evidência atual | Veredito |
| --- | --- | --- |
| Refund cartão Sandbox | pagamento `CONFIRMED`, um refund terminal e replay HTTP 400 sem segunda devolução | **PASS** |
| Refund PIX Sandbox | pagamento `RECEIVED`, um refund em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`; manifesto preservado | **BLOCKED** até aprovação no painel + `DONE` |
| `production-*` | 44 arquivos/47 casos coletados no host correto; três specs isolados passaram e a fronteira anônima ficou sem conversa fixture | **3 PASS, 4 PRECONDITION BLOCKED, 40 SKIP** por caso |
| Supavisor atual | 48/48 conexões graváveis, dois backends, zero recovery/read-only; p95 2,6 s | **PASS atual**, causa histórica externa desconhecida |
| Cron/DB defensivo | 23/23 em ratchet de sessão, pool, deadline e captura do cron | **PASS de mitigação**, sem retry estrutural do tick inteiro |

O coletor de `production-team-lifecycle` deixou de carregar um storage state
inexistente antes do `skip`; a repetição sem opt-in terminou em um skip e exit 0.
A decomposição vigente substitui a contagem histórica de quatro passes, pois
`production-unauthenticated-boundary` não pôde executar sem uma conversa real.

## Adendo — integração WhatsApp e regressão final em 01/10/2026

As branches de Embedded Signup v4 e coexistência foram integradas na branch de
auditoria sem tocar a `main`. O conflito único do journal manteve 0105–0107. O
readback DEV confirmou a 0107, a suíte direcionada passou 268/268, o build Next
passou e a regressão global passou 4.576/4.576 em 442 arquivos.

No Preview consolidado, `whatsapp-profile.spec.ts` obteve **2 PASS + 4 SKIP**:
a conexão de coexistência havia sido desconectada após o teste real do outro
agente. Por isso, não há nova prova externa Meta nesta rodada. Na landing, os
gates de conversão passaram e a navegação real gerou request de conversão; a
atribuição final permanece bloqueada enquanto a campanha estiver inativa.

O CI inicialmente falhou no audit de dependências antes dos testes por duas
advisories high em `brace-expansion` 5.0.9. A resolução transitiva foi atualizada
para 5.0.11; `pnpm audit --prod --audit-level high` passou em seguida.

Na reexecução, o build passou, mas `security:http` detectou que
`fetchOpenHandoffs` devolvia uma lista vazia sem sessão. Isso evitava o erro
`NO_PROFILE`, porém convertia uma negativa em sucesso implícito. A action agora
devolve resultado discriminado e o watcher limpa seu estado sem toast. Os testes
direcionados passaram 20/20; o build isolado e a repetição dos gates passaram
com 177 arquivos de bundle local/175 no CI, sem segredo, e 328 requests HTTP,
dos quais 52 respostas `200` continham negativa explícita. O CI final passou
4.577/4.577 testes em 442 arquivos e o E2E público passou 6 casos, com dois
skips condicionais declarados.
