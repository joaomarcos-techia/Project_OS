# Track O — handoff final (reconciliado em 25/09/2026)

> **Inventário de engenharia consolidado em [§36 do qorov2](qorov2.md)** — o que foi construído,
> como, e o que está pendente. Detalhe por fatia em [docs/evidence/track-o.md](evidence/track-o.md).
> Histórico narrativo em [§35 do qorov2](qorov2.md). O handoff de 18/09 permanece como registro
> daquela sessão.

## Atualização de identidade — 23/09/2026

> Esta atualização substitui, para confirmação de e-mail, o estado chamado “final” abaixo. As
> tabelas de 18–21/09 permanecem como histórico das execuções feitas naquela versão; elas não provam
> a emenda de credencial. A evidência vigente começa nesta atualização.

A revisão adversarial encontrou um problema de autoridade no conserto de 22/09: o clique legítimo no
e-mail confirmava a caixa e também liberava a aba anônima que havia iniciado o cadastro. Como aquela
aba já tinha escolhido a senha, um terceiro podia iniciar o fluxo com o e-mail da vítima e esperar o
clique dela.

O worktree passou a usar este contrato:

- Admin `createUser` cria a conta sem senha, não confirmada, com binding Qoro exato e
  `password_state=pending`;
- o repositório gera o e-mail e o Resend transporta um link `recovery` mais um código de oito
  dígitos; templates do painel Supabase não participam;
- o token fica no fragmento; um GET sem credencial entrega uma ponte HTML `no-store`/`no-referrer`
  que autoenvia POST, mantendo token, tipo e referência fora do request target, access log e
  `Referer`;
- links antigos com query têm compatibilidade transitória, também sem consumo no GET. Esse ramo não
  consegue impedir o log do request target legado e deve ser removido depois do TTL dos e-mails já
  emitidos;
- o link termina em `/cadastro/confirmado` e apenas confirma o e-mail naquele aparelho;
- a aba iniciadora precisa do código para concluir o handoff, instalar a senha por CAS e abrir
  `/cadastro/plano`;
- HIBP é consultado no envio e novamente imediatamente antes do CAS;
- reenvio gira link e código; recovery separa grants `profile` e `pretenant`;
- o gate `ready-owned` exige marker Auth `set`, a mesma referência possuída no banco e credencial
  `completed`; uma conta apenas confirmada ou um estado parcial Auth→SQL não alcança draft, plano ou
  checkout;
- outro draft não pode girar uma referência pendente ainda viva nem provocar segundo e-mail; somente
  o reenvio deliberado da mesma sessão gira token e código;
- se o OTP foi consumido antes de uma falha transitória de claim/binding, um grant HMAC de 15 minutos
  em cookie HttpOnly permite à tela confirmada repetir a operação para o mesmo usuário, sem levar
  usuário ou referência à URL/DOM; antes do claim, essa referência assinada vence um marker Auth
  pendente antigo; depois do claim, a referência possuída no banco vence somente no reparo pendente —
  marker `set` divergente falha fechado;
- recovery cobre também `pretenant_orphan` e tem um único vencedor concorrente: profile consome
  `claims_version`, pré-tenant consome o epoch da credencial e órfão usa advisory lock mais releitura
  de `Auth.updated_at` imediatamente antes de trocar a senha;
- o lookup administrativo usa o filtro indexado do GoTrue e igualdade exata; legado markerless só é
  adotado depois de OTP/reserva ou login por senha conhecido, conforme o estado;
- marker Auth `set` divergente do banco falha fechado. Adoção por segundo draft usa o código da
  tentativa viva; se o Auth ficar à frente do commit SQL, o gate bloqueia tudo até um retry concluir a
  transferência sem escrever a senha outra vez;
- depois que um envio começou, resultado aceito, ofuscado ou incerto usa o mesmo envelope público
  `200`; o banco preserva o estado incerto, e a finalização do Resend aceita apenas combinações exatas
  de estado e ownership.

### Estado desta atualização

| Gate | Estado | Critério para fechar |
| ---- | ------ | -------------------- |
| Implementação e testes locais focados | **PASS** | 238/238 em oito arquivos; inclui ready-owned, adoção parcial, recovery concorrente, resposta uniforme, repair grant, liveness, lookup exato e legado seguro |
| Suíte integral e TypeScript | **PASS** | 4.378/4.378 em 414 arquivos, 185,27 s; `tsc --noEmit`, exit 0 |
| Regressão HTTP/SQL do cadastro | **PASS** | `signup-regression.ts` 29/29, incluindo transferência de ownership; cleanup zero |
| ESLint completo e Next build de produção | **PASS** | ESLint exit 0; Next 15.5.24 otimizado, exit 0 |
| Segurança e inventário | **PASS** | inventário 180/49/16/254/9 e zero gaps; browser-session 7/7 em 45,5 s; tenant, bundle 174/0, HTTP 12/164/328, DB/arquitetura/migrations/observabilidade/registry, exit 0 |
| Prettier | **PASS** | `npx prettier --check .`, exit 0; o único desvio de baseline era uma quebra de linha num teste de WhatsApp e foi normalizado sem mudança de comportamento |
| E2E atual contra Supabase DEV + Resend | **PASS 5/5** | Chromium, 9,4 min contra `next dev`, um worker/zero retry; retenção E2E-only 15 min/64 entradas; cleanup Auth/DB/fixture/lock zero |
| E2E atual em Preview | **PASS 5/5** | 4,9 min no SHA `9608e1e`, no alias protegido da branch, Chromium, um worker/zero retry; fingerprint Auth + DB DEV; cleanup Auth/DB/fixture/lock zero |
| Merge e publicação | **PASS técnico** | PR #15 mesclado em `193ce31`; Vercel Production `Ready`; GET `/login` e `/cadastro` 200, sem escrita |
| Inbox real | **NOT TESTED** | pessoa confirma recebimento, conteúdo e link na caixa consentida |
| Aceitação de produto | **PENDENTE** | executar o runbook atualizado no Preview |
| Billing e provisionamento nos runners próprios | **PASS** | Asaas 6/6, cleanup 5/5; webhook/provisionamento 12/12, cleanup 2/2 |
| Billing pelo spec de confirmação | **FORA DO ALCANCE DO SPEC** | o spec para em `/cadastro/plano`; os PASS acima vêm de O-5/O-6 |

### Ordem segura para continuar

1. ~~Concluir ESLint/formato, build Next de produção, inventário e demais gates finais e registrar os
   números atuais.~~ **Concluído; resultados na tabela acima.**
2. ~~Revisar o diff, commitar e publicar a implementação sem misturar trabalho alheio.~~ **Concluído.**
3. ~~Executar o E2E 5/5 no Preview protegido, contra DEV, exigindo fingerprint e cleanup
   Auth/DB/fixture/lock zero.~~ **Concluído: 5/5 em 4,9 min no SHA `9608e1e`, um worker e zero retry.**
4. ~~Registrar a prova automatizada na
   [matriz de evidência](evidence/track-o.md#emenda-de-identidade--23092026) e no
   [§37 do qorov2](qorov2.md#378-evidência-válida-para-esta-emenda) e concluir o merge técnico com os
   checks finais verdes.~~ **Concluído no PR #15, merge `193ce31`.**
5. executar a
   [aceitação humana](runbooks/aceitacao-humana-cadastro.md#1-cadastro-e-handoff-entre-aparelhos),
   incluindo a inspeção da mensagem numa caixa consentida, e registrar o veredito. Essa etapa não
   bloqueia o merge autorizado, mas continua pendente até o fluxo poder ser chamado de aceito como
   produto e não deve ser substituída por cadastro em produção.

O novo E2E deve provar, sem imprimir token ou código: link no celular não avança a aba; conta
`pending` não acessa plano/checkout; código incorreto e tentativa anterior falham; reenvio da mesma
sessão produz link e código novos; outro draft não gira o link vivo nem recebe mensagem; senha não
autentica antes do handoff e autentica depois; F5 exige redigitar e-mail/senha; legado seguro e
limpeza sem resíduo também são exercitados. Os cinco cenários estão **PASS** em DEV e Preview.

Limite assumido: um scanner que apenas faz GET não consome o OTP, mas um scanner capaz de executar
JavaScript pode executar a ponte. O risco continua registrado; reenvio rotativo e handoff por código
reduzem o impacto, mas não autorizam chamá-lo de eliminado.

## Estado final

**Atualização de 21/09:** [revalidação e correções](evidence/track-o-revalidacao-2026-09-21.md).
A releitura encontrou retomada perdida após F5, validação incompleta na reconciliação de billing,
troca de plano depois da reserva e falhas nos próprios runners de Sandbox/sessão. Foram corrigidas
com regressões; o relatório separa
execuções atuais das históricas e detalha as ações ainda necessárias. O aceite humano continua
pendente, assim como crédito Ads e as configurações administrativas ainda inacessíveis.

| Fatia | Resultado | Onde a prova está |
| ----- | --------- | ----------------- |
| **O-1** | **PASS** (publicado, ligado e com requisição de conversão emitida) | `qoro/scripts/verificar-comecar.mjs` 27/27 + navegador |
| **O-5** | **PASS** | Sandbox 6/6 + cleanup 5/5; webhook/reconciliação/compensação 12/12 + cleanup 2/2 |
| **O-6** | **PASS em SCHEMA** | 12/12 contra 105 migrations reais; C1 adicional prova compensação externa após perda de CAS |
| **O-7** | **PASS** | 13/13 em schema real + **5/5** E2E autenticado, sem skip |
| **O.H** | **PASS** | carga geral + carga Track O 8/8 + chaos 59/59 |
| **O.S** | **PASS** | kill switch 9/9 + simulação + Preview + CI |

## Histórico da entrega original (18–20/09)

### O-1 — a ponte existe

`/comecar` em `C:\dev\qoro`. O destino é **constante**; não existe parâmetro de destino. Isso elimina
a classe de open redirect por construção — 17 vetores recusados sem nenhum filtro, porque não há host
vindo de fora. Só os cinco UTM da allowlist atravessam; `clinic_id`, `role`, `price`, `trial` e
`token` são descartados. **Atribuição não é autorização.**

O linker cross-domain foi configurado na landing. A medição independente posterior encontrou
`_gl` no clique da âncora, mas não no encaminhamento automático. O app não tem tag receptora:
atribuição da assinatura e crédito final no Ads continuam sem prova, como registra o §36.8.

Provado no navegador com a ponte apontada para o Preview: a URL capturada carregava
`?utm_source=google-ads&utm_medium=cpc&utm_campaign=clinicas-sp`, com hífen preservado e sem nenhum
parâmetro proibido.

### O-7 — o E2E autenticado, e o 500 que ele achou

5/5 contra o Preview com sessão real, sem skip. Na PRIMEIRA execução anterior à migration 0104 houve
`500 em /dashboard`: a leitura de `onboarding_progress` estava no layout do shell, por onde passa toda
página autenticada. Um tour derrubava agenda, consultório e caixa. Corrigido com degradação observável;
depois da migration, cinco testes passaram em três execuções seguidas.

### Carga e chaos

Carga específica do Track O: 8/8, 0 deadlock, todos os SLOs existentes respeitados sem afrouxar
nenhum. Chaos de Redis: 59/59, incluindo o caso que responde ao §27 — `fail-open NÃO é barra-livre`.

## Bugs desta sessão

| Bug | Como apareceu | Correção |
| --- | ------------- | -------- |
| `500 em /dashboard` no Preview | E2E autenticado, primeira execução | leitura do onboarding degrada e reporta |
| classe de regex degenerada recusando hífen | inspeção de bytes do arquivo | comparação por código + 2 regressões |
| dois testes de tour passando no vazio | leitura crítica do próprio verde | skip anotado quando a máquina não está viva |
| lint da landing vermelho em `main` | baseline antes de tocar no repo | supressão justificada no shim do gtag |
| asserção de carga global demais | falhou contra as próprias fixtures | escopada ao que nasce do provisionamento |

## Bloqueios, e como desbloquear

| Bloqueio | Por quê | Como desbloquear |
| -------- | ------- | ---------------- |
| **`security:browser-session`** | falha anterior de captura RSC, corrigida | **PASS 7/7 em 21/09**, incluindo controles que precisam detectar vazamento e corpo ilegível |
| **Product Acceptance humano** | exige julgamento de produto | roteiro completo em [runbooks/aceitacao-humana-cadastro](runbooks/aceitacao-humana-cadastro.md) — rodar no Preview, com Sandbox |

Google Ads está configurado e a requisição de conversão sai de `/comecar`. A regra órfã de firewall
também não aparece mais: GET e POST em `/api/lead` devolvem 404 sem `X-Vercel-Mitigated`. O app ainda
não possui tag Google; medir a assinatura final continua sendo uma tarefa separada.

**Resolvidos em 19/09/2026:**

- **o cadastro autônomo aberto em produção** — as duas flags estavam só em Preview, e uma cópia da
  `SIGNUP_IDENTITY_ENABLED` tinha ido parar no projeto Vercel da landing, onde nada lê env;
- **`/comecar` publicado** na landing, no estado desligado (200, `noindex`, fora do sitemap, sem link para o app);
- os 2 skips do E2E de tour — DEV (banco do Preview) migrado, spec 5/5 sem skip em quatro execuções;
- o journal do drizzle parado na 0102, que faria `db:migrate` pular a 0103 e a 0104 em silêncio;
- **produção migrada** de 96 para 105, com backup pré-migration, advisory lock e leitura de
  conferência — ver a seção de produção na matriz de evidência.

## Ordem de release

1. ~~commitar a feature da landing + `/comecar`~~ — **feito** (`df44192`, publicado: `qoro.dev/comecar`
   responde 200 no estado desligado, fora do sitemap, com `noindex`);
2. ~~aplicar as migrations do Track O ao banco DEV~~ — **feito** (103 → 105);
3. ~~mesclar o PR #9~~ — **feito** (`7dbfa5d`);
4. ~~aplicar as migrations ao banco de PRODUÇÃO~~ — **feito** (96 → 105, com backup e advisory lock);
5. ~~abrir o cadastro autônomo em produção~~ — **feito** em 19/09/2026 22:30 UTC;
6. ~~ligar `PONTE_ATIVA` na landing (`src/lib/comecar.ts`, `false` → `true`)~~ — **feito**
   (`13a2fea`; medido em 20/09: `qoro.dev/comecar` responde 200 com o link de fallback para
   `app.qoro.dev/cadastro`, que é o que o verificador exige no estado ligado);
7. ~~dar **entrada** ao funil~~ — **feito** em 20/09 (`1338f90`): todo CTA leva ao cadastro e o
   formulário de diagnóstico saiu da aquisição. Medido em produção: 8 / 5 / 4 links para `/comecar`
   em `/`, `/precos` e `/para/psiquiatria`, e 0 `wa.me` nas três — com o canal da LGPD intacto na
   política de privacidade;
8. rodar o roteiro de aceitação humana — **pendente**.

### O passo 5, e a variável que estava no projeto errado

O cadastro ficou fechado mais tempo do que devia por uma razão banal e difícil de enxergar: as duas
flags existiam **só em Preview** no projeto `project-os`, e uma cópia de `SIGNUP_IDENTITY_ENABLED`
tinha sido criada no projeto **da landing**, onde nada lê variável de ambiente — o `src` inteiro da
landing não tem um `process.env` sequer. Uma variável no projeto errado não dá erro: ela simplesmente
não faz nada, e parece feita.

O que fechou o diagnóstico foi comparar os **nomes** das variáveis entre Preview e Production no
projeto do app. A diferença era exatamente três: as duas flags e o `VERCEL_AUTOMATION_BYPASS_SECRET`
(que é de Preview por desenho). Todo o resto — Asaas, Turnstile, Upstash, Supabase — já estava lá.
Diffar nomes de configuração entre ambientes é mais barato que ler log de aplicação, e teria
encontrado isto em um minuto.

Estado final medido depois do redeploy:

| Verificação                                | Antes                          | Depois                     |
| ------------------------------------------ | ------------------------------ | -------------------------- |
| `/login`                                    | 200                            | 200 (app sobe, env válida) |
| `/dashboard` anônimo                        | 307                            | 307                        |
| `/cadastro`                                 | 200 "Cadastro indisponível"    | 200, funil aberto          |
| `POST /api/signup/draft` sem sessão         | **503** `{"error":"unavailable"}` | **403** `{"error":"blocked"}` |
| `POST /api/signup/sessions` (navegador)     | —                              | **201**                    |
| `GET /api/signup/sessions/me` (1ª visita)   | —                              | **410**, como esperado     |

O `503 → 403` é a prova exata de que o portão abriu: `unavailable` é a flag desligada; `blocked` é a
recusa de origem para uma requisição sem sessão. A segunda é a defesa normal funcionando.

**Uma sessão anônima foi criada em produção** pela verificação no navegador: `status=initiated`, sem
respostas, sem usuário, sem assinatura, com TTL ocioso de 15 min e absoluto de 60 min. O janitor
`signup-sessions-cleanup` está `success` e roda a cada 10 min — é ele que a remove. Nenhum dado
pessoal foi inserido e o funil não foi avançado além da primeira tela.

**A partir daqui há dinheiro real em jogo.** O cadastro aberto cria assinatura de verdade no Asaas de
produção no passo de checkout. O `ASAAS_API_KEY` de Production tem 94 dias e já atende clientes
pagantes; o webhook de assinatura responde 401 sem token no alias estável, que é a recusa correta.

## Atualização de billing — 26/09/2026

O contrato direto que pedia CPF no Qoro e criava assinatura `UNDEFINED` foi substituído por Checkout
recorrente hospedado. O defeito observado era real: a própria rota considerava o readback da
assinatura direta suficiente e provisionava imediatamente; o E2E de confirmação terminava em
`/cadastro/plano`, então o botão final nunca havia sido exercitado.

Estado atual:

- 0105–0106 aplicadas e relidas em DEV e produção; em produção houve backup de 2.741.328 bytes,
  advisory lock 4242 adquirido/liberado, journal em 0106, constraints/RLS/grants conferidos, zero
  estado inválido e zero lock residual;
- Checkout real criado no Sandbox, com dados do pagador e cartão coletados no domínio do Asaas;
- o primeiro E2E do Preview encontrou o limite real de 30 caracteres em `items[].name`; o nome técnico
  foi separado da descrição, um probe externo passou de 400 para 200 e o recurso foi cancelado;
- rerun externo no Preview: **5/5 PASS**; o cenário principal chegou ao Asaas Sandbox e provou no DEV
  `checkout_pending` sem customer/assinatura, com cleanup exato ao final;
- o primeiro CI detectou as três rotas fora do inventário de segurança; o mapa foi atualizado para os
  guards atuais e o gate local terminou com zero `REVIEW_REQUIRED` (14/14 testes focados);
- o rerun do CI no commit `6ec03d0` terminou completamente verde no run `36274393423`: 4.399 testes
  com cobertura, inventário de segurança, isolamento entre tenants, build Next, bundle e E2E público;
  Vercel, Semgrep e Snyk também passaram;
- retorno de sucesso faz polling autoritativo e só libera dashboard após readback e provisionamento;
- cancelado/expirado encerra o Checkout antes de liberar nova tentativa;
- conclusão automatizada ficou bloqueada no reCAPTCHA do Asaas. O roteiro humano deve concluir o
  cartão de teste no Preview e observar o redirecionamento ao dashboard;
- a primeira conclusão humana criou cobrança e assinatura reais no Sandbox, mas o retorno ficou preso:
  o polling consumia o limite de escrita, o filtro `checkoutSession` omitiu a cobrança e a assinatura
  já expunha o vencimento do ciclo seguinte. O corretivo está no PR #18, com testes locais e readback
  externo. O reteste da mesma tentativa passou: status 200, assinatura/trial publicados,
  `signup.provisioned`, sessão renovada e dashboard 200. O gate é **PASS em DEV/Preview**;
- o gate de schema de produção está fechado. O PR #18 permanece sem merge/publicação até autorização
  explícita do owner; o Preview com banco DEV continua sendo o alvo do roteiro humano.

## Handoff adicional — retorno e webhooks de Preview (28/09/2026)

Branch de trabalho: `integration/estado-completo-atual-2026-09-27`. A alteração permanece fora de
`main` até autorização do owner.

O retorno 404 após “Acompanhar pedido” foi causado por callbacks construídos com `APP_BASE_URL` de
uma branch antiga. Checkout e webhook de paciente agora resolvem a origem do deployment atual com
`VERCEL_BRANCH_URL`/`VERCEL_URL`, com regressões para hostname divergente. A rota de criação faz
readback antes de devolver uma URL pendente, provisiona pagamento já concluído e recicla Checkout
expirado somente após encerramento autoritativo.

O E2E de confirmação foi reduzido ao seu contrato: Supabase, Resend, confirmação, código, handoff e
plano. Ele não chama mais o Asaas. Os avisos de remoção eram efeito do cancelamento do Checkout no
cleanup; o aviso de webhook interrompido vinha de uma fila persistente apontando para um Preview
antigo. O adapter agora atualiza a mesma fila quando só o hostname muda. Depois do deploy, o `PUT` foi
executado no webhook Sandbox existente; ainda falta observar uma entrega real 2xx na próxima cobrança
de paciente para fechar a entrega do evento, sem criar uma cobrança apenas para esse teste.

Validação local do estado: **4.429/4.429 testes em 420 arquivos**, TypeScript, ESLint, Prettier e build
otimizado, todos com exit 0. O deployment e o readback externo estão registrados no fechamento abaixo.

Fechamento de 28/09: `568110b` foi publicado com Vercel `Ready`; o alias estável serviu
`/cadastro/pagamento` com HTTP 200 e pathname reconhecido. O webhook Sandbox existente foi atualizado
para a origem atual e uma segunda execução idempotente confirmou o reuso do mesmo recurso. Depois da
correção, o owner criou uma nova conta com sucesso no Preview. Permanecem fora dessa evidência os itens
subjetivos do roteiro (tour, checklist e ajuda) e a atribuição final no painel do Google Ads. A branch
continua fora de `main` até autorização explícita.

## Handoff adicional — O-7 e fila Sandbox (28/09/2026)

O owner aceitou o checklist, recusou o tour automático e pediu uma Central de Ajuda com hierarquia
próxima à documentação do Asaas. No estado atual do branch, `not_started` não abre modal. O tour só
passa a `in_progress` pelo botão “Iniciar tour guiado” em `/documentacao`; refresh, múltiplas abas,
conclusão e reabertura continuam apoiados no estado persistido.

A ajuda agora tem busca, começo recomendado, categorias, navegação lateral responsiva, artigos em
coluna de leitura, índice local e anterior/próximo. Não houve dependência nova nem alteração no
checklist.

A pendência operacional do webhook foi encerrada contra DEV/Sandbox: `PAYMENT_RECEIVED` e
`PAYMENT_RECEIVED_IN_CASH_UNDONE` novos chegaram do Asaas ao Preview e foram persistidos em
`patient_webhook_events`; o readback terminou habilitado e não interrompido, e a fixture externa foi
removida. `removeBackoff` respondeu 400 e foi registrado separadamente, sem ser promovido a verde;
as duas entregas posteriores provaram que ele não bloqueava a fila.

Gates locais: 4.434/4.434 testes em 422 arquivos, TypeScript, ESLint integral e build otimizado, todos
com exit 0. Continua pendente somente o julgamento visual da ajuda no Preview e a atribuição final do
Google Ads depois que o owner ativar a campanha. A branch continua fora de `main`.
