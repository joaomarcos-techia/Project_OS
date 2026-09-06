# Qoro v2 — Plano de Execução em Camadas (staff/principal, produção paga)

**Data:** 2026-08-19 · **Base:** `ClinicaOS_V2` @ `d414191` · **Decisão de pagamentos:** [ADR-049](adr/049-pagamentos-paciente-sinal.md)

Plano canônico para evoluir o Qoro para **plataforma de saúde mental que cobra clientes reais**. Execução **em camadas**; cada uma só libera a próxima **verde, endurecida e estabilizada**.

> **Precedência: Código > Banco > Testes > Documentação.** Divergiu? Atualize o plano/ADR **antes** de prosseguir.

---

## Estado da execução — CANÔNICO

> **Este bloco é o mapa vivo.** Quem abrir o repositório continua daqui. Toda implementação,
> decisão, descoberta, bug, gate, dependência externa ou mudança de plano entra aqui **durante** a
> execução, não no fim. ADR e Discovery Log continuam existindo e guardam o detalhe; este bloco
> guarda o **estado consolidado**.

**Última verificação contra o repositório e dependências controladas:** 2026-09-06 · branch `feat/qorov2-pagamentos`

**Versionamento (2026-08-27):** a 1.6c está nos commits publicados `15cb9c3` (código) e `3035383`
(registro da migration). O hardening financeiro/D49 está em `a7717e7`, com Preview Vercel verde, e
a matriz concorrente ampliada em `3112bb2`. A simulação de 30 dias e o fix D51 estão em `c480e44`;
os E2E controlados de timeout/retry e a antiga prova de POST perdido estão em `88e7a4a`. Depois da
migração para Checkout hospedado, o gate foi atualizado para provar `creation_unknown` sem retry cego. A migration
`0090` foi aplicada e verificada em dev e produção; o migrador gerou backup de 2.793.832 bytes,
adquiriu/liberou o advisory lock e registrou `DONE`.

O detector D52 está em `ca94839`: o `financial-reconcile` observa créditos `available` com 30+ dias
somente depois do horário da consulta, separa terminal/agenda vencida/vínculo ausente, emite métrica e
heartbeat e não move dinheiro. `smoke:payments-journey` provou terminal, consulta futura, replay e
dois tenants no banco DEV.

**Lote financeiro publicado em `8052de3`:** D24/D58, D50 e D27 estão implementados e enviados para
`feat/qorov2-pagamentos`. D24 usa Checkout hospedado restrito a PIX/cartão, com gerações diárias sobre uma única
dívida. As migrations `0091` e `0092` estão aplicadas em DEV; os smokes conectados passaram 5/5, com
cleanup zero. D50 persiste a intenção antes do estorno, não repete POST incerto e confirma por
read-back/webhook. D27 segue a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md), mantém o
fato clínico e compensa o ledger append-only. Lint, typecheck, build, 307 arquivos/2.790 testes,
migrations, registry e boundaries estão verdes. Após confirmação humana da rotação da credencial e da
atualização dos consumidores, `0091` + `0092` foram aplicadas em produção: backup pré-migration de
2.834.598 bytes, advisory lock 4242 adquirido/liberado e migrador `DONE`. A credencial DPAPI foi removida
imediatamente. A credencial seguinte, preparada para a verificação read-only, foi novamente publicada
no chat, removida sem leitura e rotacionada por confirmação humana. Com `DATABASE_URL_PROD` atualizada no
ambiente, a verificação independente passou **7/7** dentro de transação read-only: `_schema_version` e
journal, enums, tabelas/colunas, FORCE RLS/policies, grants append-only, índices/constraints e ausência
do advisory lock 4242. A Vercel concluiu o Preview do mesmo SHA com `success` às 12:10 BRT. O smoke
Playwright somente leitura passou **8/8 em 2,2 min**: 25 rotas autenticadas HTTP 200, rota dinâmica de
paciente renderizada, conversa vazia aceita, fronteiras públicas protegidas e navegação principal sem
erro. Auth state, relatório e resultados locais foram removidos; `financeiro.md` permaneceu fora do
commit.

**Incidente pós-rotação (29/08):** entre 11:30 e 11:31 BRT, quatro crons do deployment de produção
anterior falharam com `password authentication failed for user "postgres"`, pois ainda executavam com a
credencial antiga. Após o redeploy, `app.qoro.dev/api/health?strict=1` respondeu `200` com todas as seis
dependências `ok`; a consulta read-only aos heartbeats provou novas execuções `success` de
`proactive-dunning`, `proactive-followup`, `proactive-reminders` e `financial-reconcile` entre 11:45 e
11:46 BRT. O incidente está **RECUPERADO**; não foi causado pelos smokes locais.

Separadamente, o Preview registrou `Rendered more hooks than during the previous render` ao navegar pelo
redirect `/configuracoes → /configuracoes/agenda`, com recorrência reportada em 04/09. A auditoria não
encontrou hook condicional e o stack coincide com o bug oficial do App Router em redirects
([Next.js #78396](https://github.com/vercel/next.js/issues/78396), corrigido no upstream pelo sync de React
[PR #95368](https://github.com/vercel/next.js/pull/95368)). O shell agora liga diretamente à primeira
categoria autorizada e os E2E falham em qualquer `pageerror`. O commit `42cd114` chegou a deployment
Vercel `success`; o Preview pós-deploy passou 6/6 na navegação e 8/8/72 estados visuais sem `pageerror`.
**D60 está fechado**, com apenas monitoramento passivo de recorrência no Sentry, fora do lote financeiro.

**P8 carga concluído em 29/08:** `pnpm test:load` usa o build real e um PostgreSQL 17 TLS efêmero,
criado fora do workspace. O DEV fornece somente o schema por `pg_dump --schema-only`; todos os dados e
escritas são sintéticos e locais. Guardas exigem `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY`, recusam
Preview/produção/DEV compartilhado e bloqueiam qualquer HTTP externo; somente a chamada Meta é
substituída por provider falso auditável. O ensaio passou com 500 consultas, 5.000 jobs C14, 1.000
webhooks assinados, 5.000 eventos de outbox, reconcile concorrente, 100 amostras SQL, zero duplicata,
retry, falha ou deadlock e cleanup integral. Durante o ensaio, **D61** revelou que um `timestamptz` de
query SQL crua podia chegar como string PostgreSQL e ser rejeitado pelo payload Zod do job; a fronteira
agora normaliza `Date|string` para ISO e possui regressão direta.

O hardening D53 está em `281cd9c`: remove a senha do DOM depois que o submit captura os dados e após
erro, recolhe sua visibilidade e documenta o tratamento seguro de artefatos E2E. Lint, typecheck,
2.707 testes, build e gates arquiteturais/operacionais passaram; não houve migration nem mudança de
contrato.

O hardening D54/D55 em `8c0ae7a` corrige o round-trip da cobrança de assinatura: a rota global agora
reconhece o contrato real `200 + deleted:true`, cancela a invoice e reabre por CAS quando
`getPayment()` confirma que a mesma cobrança voltou a existir. `cancelled` continua terminal na
máquina genérica; a exceção fica confinada ao seam autoritativo, com timeline `invoice.restored`,
métrica e replay idempotente. Código, 73 testes focados, suíte integral, build e gates estão verdes; a
prova Sandbox real na conta alvo passou em 02/09 com delete, restore, replay e cleanup.

**Correção D63 + E2E Meta em 31/08:** o Checkout hospedado recusava o `customer` de paciente criado
apenas com nome/CPF e exigia também endereço completo. O menor ajuste removeu `customer` do
`POST /checkouts`; o pagador preenche os dados na página do Asaas e o gate local de CPF válido foi
preservado. O sandbox aceitou Checkouts `ACTIVE` de sinal e restante pela credencial da Clínica A.
O runner `payments:meta-e2e`, com opt-in e cleanup exato, publicou `link_ready`, roteou para os dois
jobs C14, refez o lookup no send-time e recebeu `accepted` + `providerMessageId` da Meta para dois
templates distintos. Replay: 0/0; fixture: zero pacientes, agendamentos, cobranças, gerações, jobs e
outbox residuais; dois outbounds cifrados permaneceram como evidência. O callback não marcou
`delivered/read`, mas em 02/09 o operador confirmou que as duas mensagens chegaram ao aparelho
consentido com seus links. Suíte após o ajuste:
**2.812/2.812 em 310 arquivos**; typecheck e lint focado verdes.

O primeiro passe do P9 executou oito cenários Playwright locais, somente leitura e sem artefatos
intencionais: os cinco cenários públicos passaram; os três autenticados não produziram aceite válido
(login permaneceu na tela, uma navegação dinâmica excedeu o timeout e outra não concluiu a troca de
rota). Durante o diagnóstico, o snapshot de falha reteve a senha ainda presente no DOM. O diretório de
resultados foi eliminado, não havia estado de autenticação persistido e o login passou a limpar o campo
logo após o submit capturar os dados e novamente após erro, recolhendo a visibilidade (**D53**). A credencial descartável precisa ser rotacionada e o
P9 autenticado repetido antes de qualquer classificação verde; não atribuir as três falhas a regressão
de produto sem nova execução isolada.

**Publicação do lote atual:** `git push` e `git ls-remote` confirmaram o commit
`281cd9cec11b1e782b5e56437d46e5db55ee525d` no remoto antes deste fechamento documental. O alias
Preview responde `302` pela proteção da Vercel,
portanto está alcançável; porém a sessão de navegador não estava disponível, o Vercel CLI não está
instalado e o GitHub CLI local não está autenticado. O SHA implantado não foi observável: deployment
do HEAD = **BLOCKED de evidência**, não `PASS` nem falha de código. `financeiro.md` é trabalho não
rastreado do usuário e deve permanecer fora de qualquer commit.

**Rollout P11/D77 + D78 em 05/09/2026:** os commits separados `175750b` (D78) e `940335e` (P11/D77),
o merge explícito da `origin/main` em `c5f759d` e o lote de validação chegaram ao remoto no SHA
`f2c1b60`. O GitHub confirmou o deployment Vercel desse mesmo SHA em estado terminal `success`; o
smoke canônico do Preview passou **6/6**, incluindo navegação autenticada sem `pageerror`, e a auditoria
ampla percorreu 26 rotas autenticadas com HTTP 200 mais a rota dinâmica disponível. Auth state e
artefatos foram removidos. A migration 0094 foi aplicada em produção pelo migrador protegido: backup de
**2.661.164 bytes**, advisory lock 4242 adquirido/liberado e `DONE`; a pós-verificação independente
passou **9/9** (schema version, journal, colunas, constraints, RLS/FORCE, grants, compatibilidade dos
dados e lock ausente).

A prova externa nova de D77 foi executada com uma fixture PIX sintética e tenant-scoped da Clínica A.
O PIX liquidou, houve exatamente **um** POST/refund, o replay não criou outro e o provider terminou
`CANCELLED`. Como exigido pelo P11, a intenção terminou `failed`, a cobrança continuou `paid` e o
crédito `available`; nenhum falso fechamento ocorreu. O readback/reconcile e o cleanup local exato
passaram, o manifesto foi removido e o histórico Sandbox foi preservado. O ramo externo de recusa
está **PASS**; o ramo externo de sucesso `DONE → refunded` continua **NOT TESTED**. O readback separado
da D50 também confirmou o refund original ainda `PENDING`, sem novo POST.

**D79 — correlação do refund Asaas corrigida em 06/09:** o readback da fixture revelou que
`POST /payments/{id}/refund` devolve a cobrança atualizada e o adapter tratava o `id` da cobrança como
`providerRefundId`. Como os itens de `GET /refunds` podem vir sem `id`, o reconciliador não encontrava
correspondência exata e também não acionava o fallback do baseline. O adapter agora retorna
`refundId=null` após o POST e a correlação autoritativa usa o baseline persistido + readback; intents
já gravadas com o id da cobrança também convergem por ausência de correspondência exata. Regressões
`CANCELLED` e `DONE` cobrem o formato real. Suíte 2.977/2.977, lint, typecheck, build e gates
arquiteturais/operacionais passaram. O commit executável `0181939` foi publicado na branch, a Vercel
terminou `success` no mesmo SHA e o Preview autenticado passou 6/6; artefatos removidos.

**D80 — autorização crítica do Sandbox segue cancelando em 06/09:** depois do rollout de D79, uma
nova fixture foi executada com saldo mínimo pré-validado e trava operacional antes do POST. O operador
já estava no painel; o runner só liberou o único refund autorizado após comando explícito. O provider
passou por `AWAITING_CRITICAL_ACTION_AUTHORIZATION` às 02:08:26 BRT e terminou `CANCELLED` às
02:09:37 BRT. O Qoro não repetiu POST, marcou `failed`, manteve cobrança `paid` e crédito
`available`; o readback final e o cleanup local passaram, preservando o histórico Sandbox. O runner
não observa a UI do Asaas, mas o operador confirmou depois que o painel mostrou sucesso ao aceitar o
código Sandbox. Mesmo assim, a API terminou em `CANCELLED` e o saldo continuou subindo: cada PIX de
teste foi creditado, enquanto nenhum refund chegou a `DONE` para ser considerado devolvido. Essa
confirmação humana reforça uma inconsistência entre a ação crítica exibida e o estado terminal do
provider; não prova que o refund foi concluído. Não criar nova fixture: o caminho `DONE` está
**BLOCKED** até diagnóstico do suporte/provedor.

**Readback independente D50 × D80 em 06/09/2026:** duas consultas somente leitura, executadas contra
a conta tenant-scoped da Clínica A, eliminaram a suspeita de mistura entre fixtures. A D50 continua
com cobrança `CONFIRMED`, `patient_charge=paid`, recebível `pago` em R$ 20, intenção única de R$ 10
em `confirmation_pending` e um único refund de R$ 10 `PENDING`. A D80 continua com cobrança
`RECEIVED` e um único refund de R$ 10 `CANCELLED`. Logo, o `CANCELLED` observado pertence à prova
D77/D80, não ao excedente D50. Nenhum POST, retry ou cleanup foi executado nesse readback.

**D72 — estado do estorno no Caixa publicado e revalidado em 06/09:** o app passou a consumir um
seam público tenant-scoped do Payments que reduz a intenção `excess` a quatro estados humanos:
aguardando, confirmado, cancelado sem devolução e falha. O contrato não expõe payment/refund id nem
erro bruto e a UI não oferece retry. Unit/UI 22/22, readback conectado DEV 1/1, E2E local autenticado
`/caixa` 200 com a fixture D50, zero `pageerror`, suíte 2.989/2.989, lint, typecheck, build, arquitetura
0 ciclos e gates operacionais verdes. O commit `b6f8194` está no remoto; o deployment Vercel
`ENo2AwGWJ69G6aXEoZeqEQfUrQQp` terminou `success` no mesmo SHA. O Preview passou no smoke canônico
6/6 e na prova D72 específica: `/caixa` HTTP 200, estado `PENDING` e R$ 10 visíveis, nenhum id do
provider e zero `pageerror`. Auth state e marcador do Playwright foram removidos.

**Camada 2 iniciada somente como spike 2.1.0 em 06/09:** a auditoria regulatória mostrou que “recibo
PDF” mistura comprovante não fiscal, recibo médico e documento fiscal. A [ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md)
foi aceita pelo fundador em 06/09: primeiro um comprovante não fiscal por baixa, mantendo Receita
Saúde (PF) e NFS-e/recibo de PJ como integrações separadas. Nenhum schema, endpoint ou PDF foi criado;
a revisão jurídico-contábil e os gates de Camada 1 da §22 continuam obrigatórios antes do código.

### D78 — Embedded Signup indisponível para conta externa e contrato do token Meta

**Estado em 05/09/2026: `CÓDIGO PUBLICADO NO PREVIEW` + `BLOQUEADO NA META`.** O resolver foi reescrito para
menor privilégio, a seleção de telefone deixou de aceitar posição em lista ambígua, rate limit e
indeterminação deixaram de virar "recusa" em qualquer etapa do connect, e a corrida entre os dois
canais do pop-up passou a ser modelada — inclusive o escape da fase `closing`, cujo deadlock foi
corrigido nesta revisão. O incidente **não está resolvido**: nenhuma conta sem App Role atravessou
`popup → login → code → FINISH → WABA/telefone → register → subscribed_apps → persistência` depois da
mudança. O estado externo continua `NOT TESTED`.

#### Causa raiz

São **duas causas independentes**, e confundi-las foi o que travou o diagnóstico anterior.

1. **Bloqueio externo (causa do erro que o cliente viu) — hipótese principal, NÃO confirmada.** O erro
   `Recurso indisponível` apareceu dentro do diálogo OAuth da Meta, antes de qualquer `code` ou evento
   `WA_EMBEDDED_SIGNUP`. A definição oficial de [níveis de acesso](https://developers.facebook.com/docs/graph-api/overview/access-levels)
   é literal: *"As permissões com acesso padrão só podem ser solicitadas de usuários que têm uma função
   no app solicitante"*. Isso explica a assimetria observada — conta interna com App Role passa, conta
   do cliente sem App Role é barrada — e o painel mostra `public_profile` em "Pronto para teste", ou
   seja, acesso **padrão**, num app em modo Live.

   A mesma mensagem genérica também é emitida por outras pendências de plataforma. **Nada disso está
   confirmado**: o repositório não observa o painel. Verificação da Empresa, Data Use Checkup e demais
   ações exigidas são **itens a verificar** no roteiro abaixo, não fatos apurados.
2. **Defeitos reais no código (independentes do bloqueio).** Mesmo com o login liberado, o connect
   falharia ou — pior — acertaria a conta errada:
   - `resolveWabaAndPhone()` caía em `GET /me/businesses → /{business-id}/owned_whatsapp_business_accounts`,
     caminho de **portfólio empresarial** que depende de `business_management`. A configuração ativa
     emite token de usuário do sistema com apenas os dois escopos WhatsApp, e no Graph API Explorer
     `/me/businesses` não devolveu dado útil para esse token;
   - a seleção de telefone terminava em `phones[0]` sempre que o `phone_number_id` do evento não fosse
     encontrado ou não existisse — registrando, assinando e persistindo um número que o cliente não
     escolheu;
   - qualquer falha de rede era convertida em "o token não alcança a WABA", transformando instabilidade
     da Meta em acusação de conta inexistente;
   - o veredito da tela era decidido no callback do SDK, sem esperar o `postMessage` do pop-up.

#### Hipóteses descartadas

| Hipótese | Veredito |
| --- | --- |
| Redirecionamento errado do Qoro / popup mal configurado | **Descartada.** A URL observada é o diálogo OAuth legítimo do SDK, com `config_id` correto, `display=popup`, `response_type=code`, domínio `app.qoro.dev` e fallback para `/configuracoes/whatsapp`. O erro é renderizado pela Meta, não pelo Qoro |
| O usuário cancelou | **Descartada como causa.** Era o sintoma do bug de diagnóstico: um callback sem `code` virava `CANCELLED` mesmo quando nenhum evento `WA_EMBEDDED_SIGNUP` havia chegado |
| Faltam `whatsapp_business_management` / `whatsapp_business_messaging` | **Descartada.** Ambos foram aprovados em 11/08/2026 e são os únicos escopos da configuração ativa |
| `business_management` é obrigatório para Embedded Signup | **Descartada para este produto.** A [App Review de Solution Partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review) exige Advanced Access aos dois escopos WhatsApp e **não lista `business_management`**; o [sample oficial de Tech Provider](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/README.md) diz "At minimum, request: `whatsapp_business_management`, `whatsapp_business_messaging`" |
| `/me/business_users` substitui `/me/businesses` | **Descartada.** Ele respondeu no Explorer, mas devolve associações usuário-do-sistema↔portfólio, semântica diferente de WABA. Trocar um pelo outro seria inventar contrato a partir do nome do endpoint |
| `public_profile` é necessária para o perfil do WhatsApp (foto/bio/site) | **Descartada.** [Business Profiles](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-2e0565c0-6b03-4ced-ae8e-bf6534ef1125) usa `whatsapp_business_management`. `public_profile` é do usuário Facebook e o repositório não a consome; ela importa apenas por ser exigida pelo próprio diálogo de login |

#### Decisão 1 — resolução da WABA por menor privilégio

Adotada a **opção 1 (menor privilégio)**, com a descoberta que a Meta documenta para este tipo de
token, e não com o fallback de portfólio.

A doc [WABAs / manage-accounts](https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts/)
diz, sobre o token devolvido pelo Embedded Signup: *"Each object in the `granular_scopes` array
identifies the IDs of every WABA that has granted your app a given permission (`scope`)"*. O próprio
`debug_token` — que o connect já chamava para validar escopos — carrega a lista de WABAs concedidas,
sem `business_management`.

- `waba_id` do evento `FINISH`/`FINISH_ONLY_WABA` é **obrigatório**. Ausente ⇒ falha específica,
  sanitizada e auditada (`stage: signup_incomplete`), sem chamar a Meta e sem persistir nada;
- `validateTokenScopes()` devolve `MetaTokenGrant { wabaIds }`, extraído de
  `granular_scopes[scope=whatsapp_business_management].target_ids`;
- `GET /me/businesses` e `/{business-id}/owned_whatsapp_business_accounts` foram **removidos**.
  `REQUIRED_SCOPES` continua com os dois escopos WhatsApp e o runtime **não exige `business_management`**;
- a doc diz que a WABA mais recente vem primeiro em `target_ids`. **Essa ordem não é usada para
  escolher nada** — a lista serve só como allowlist.

**O que cada verificação prova, e o que não prova.** Não são "duas provas independentes" em todos os
casos:

| Situação | Verificações efetivas | O que fica sem prova |
| --- | --- | --- |
| `target_ids` presente | allowlist do token **e** `GET /{waba-id}/phone_numbers` | — |
| `target_ids` vazio ou ausente | apenas `GET /{waba-id}/phone_numbers` | O id continua vindo do evento no navegador. A chamada prova que o token **alcança** aquele asset; não prova que o cliente o **selecionou** |

O `target_ids` vazio foi observado em campo e não corresponde à forma documentada. Quando ele falta, o
gate de allowlist é pulado — nunca invertido: a ausência da lista jamais autoriza uma WABA, apenas
deixa de recusá-la antecipadamente.

#### Decisão 2 — seleção de telefone: nunca por posição

O contrato anterior era `(preferPhoneId && phones.find(...)) || phones[0]`. O `||` colapsava dois casos
distintos em "pega o primeiro". O contrato novo:

| Entrada do evento | Números na WABA | Resultado |
| --- | --- | --- |
| `phone_number_id` presente e encontrado | qualquer | usa a correspondência **exata** |
| `phone_number_id` presente e **não** encontrado | qualquer | falha (`account`). Nunca substitui pelo primeiro |
| sem `phone_number_id` | zero | falha (`account`) — WABA sem número |
| sem `phone_number_id` | exatamente um | usa esse número |
| sem `phone_number_id` | mais de um | falha (`phone_ambiguous`) — o operador refaz escolhendo |

Entradas sem `id` são descartadas **antes** de contar, para não fabricar ambiguidade. Nenhuma dessas
falhas chega a `register`, `subscribed_apps` ou persistência — coberto por teste parametrizado.

#### Decisão 3 — classificação de falha do Graph: o status HTTP não decide sozinho

A revisão anterior deste documento dizia que "só uma NEGATIVA autoritativa do provedor (4xx)" contava.
**Isso estava errado e foi corrigido.** `429 Too Many Requests` é rate limit temporário pelo
[RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585#section-4), e a Meta transporta semântica
transitória no corpo Graph mesmo respondendo `400`. A regra antiga vivia duplicada no connect e na
sonda de saúde, e marcava canal quebrado durante um pico de tráfego.

Existe agora **um único classificador**, `classifyGraphFailure()`, usado pelo connect e pela sonda. Ele
recebe o sinal sanitizado (`graphStatus`, `graphCode`, `graphSubcode` — nunca token, URL com segredo ou
corpo cru) e é **conservador por construção**: nada é negativa a menos que a documentação oficial diga
que é.

| Sinal | Classe | Fonte oficial |
| --- | --- | --- |
| `error.code` 4, 17, 341 | `rate_limited` | Graph API — [Handling errors](https://developers.facebook.com/docs/graph-api/guides/error-handling) |
| `error.code` 80007, 130429, 133016 | `rate_limited` | Cloud API — [Error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes), tabela Throttling |
| HTTP `429` | `rate_limited` | [RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585#section-4) |
| `error.code` 2, 131016, 133004 | `indeterminate` | Graph API "Handling errors"; Cloud API "temporarily unavailable" |
| `error.code` 0, 3, 10, 33, 102, 190, 200–299, 131005 | `denied` | Graph API "Handling errors"; Cloud API, tabela Authorization errors; 33 = "The business phone number has been deleted" |
| `error.code` 100 **com** `error_subcode` 33 | `denied` | [Marketing API error reference](https://developers.facebook.com/docs/marketing-api/error-reference/) — token sem a permissão de usuário do sistema |
| HTTP `401`, `403` | `denied` | Semântica HTTP: negativas de autorização |
| HTTP `404` | `denied` (falha funcional da etapa) | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5): o servidor não encontrou representação atual, e o status também pode ocultar a existência do recurso. **Não prova falta de permissão** — prova que o asset não está acessível por esta requisição. Fica fora de indeterminação porque o efeito prático é o mesmo (a etapa falhou), mas a causa não é reportada como "permissão negada" |
| HTTP `400` sem código documentado | `indeterminate` | A Meta usa `400` para quase tudo, inclusive throttling — a classe não prova nada |
| HTTP `5xx`, timeout, reset (`graphStatus: null`) | `indeterminate` | Sem resposta conclusiva |

Ordem de avaliação: rate limit e transitório **vencem** a classe HTTP, porque a Meta devolve alguns
deles com `400` — e um `429` carregando código da faixa de permissão continua sendo rate limit.

Consequência deliberada: `error.code` 100 **sem** subcode deixou de ser negativa. É o preço da regra
conservadora, e o custo é baixo — a resolução falha do mesmo jeito, nada é registrado, assinado ou
persistido; só a mensagem passa a ser "a Meta não respondeu de forma conclusiva" em vez de acusar a
conta. A verificação anti-sequestro forte (allowlist de `granular_scopes`) não depende de HTTP nenhum.

**A classificação vale em TODAS as etapas do connect.** Correção posterior: ela estava aplicada só ao
resolver de WABA e à sonda, então `429`, throttling no corpo, timeout e `5xx` na troca de code, na
validação de escopos, no `POST /register` e no `POST /subscribed_apps` continuavam chegando à tela como
"a Meta recusou". Agora ela vive dentro do próprio `graphFetch`, que é o único ponto por onde todas as
chamadas passam.

| Classe | Etapa reportada no connect | Sonda de saúde |
| --- | --- | --- |
| `denied` | **preserva a etapa funcional** (`authorization`, `permissions`, `account`, `phone_registration`, `webhook_subscription`) | `failed` |
| `rate_limited` | `provider_rate_limited` | `unknown` |
| `indeterminate` em `GET` | `provider_unavailable` | `unknown` |
| `indeterminate` em `POST`/`DELETE` | `provider_outcome_unknown` | `unknown` |

A separação por método é o ponto crítico. Num `GET` a indeterminação é inofensiva e a tela pode afirmar
que nada foi alterado. Num `POST /register` ou `POST /subscribed_apps`, timeout ou `5xx` deixam o
resultado externo **desconhecido**: a operação pode ter sido aplicada do outro lado. Não existe
read-back nessas etapas, então a tela **não** promete "nada foi alterado" e **não** pede para repetir na
hora — o mesmo princípio de POST indeterminado já adotado em pagamentos. Não foi implementado retry
automático. Ela também **não** manda reabrir a tela: sem conexão persistida, `loadWhatsappStatus()` não
tem o que sondar e nada diria sobre o estado do lado da Meta. A orientação é conferir o número no
WhatsApp Manager ou acionar o suporte.

Rate limit afirma menos do que a versão anterior deste documento dizia. O `429` prova throttling, mas o
[RFC 6585](https://www.rfc-editor.org/rfc/rfc6585#section-4) não garante genericamente que todo `POST`
assim classificado deixou de ser executado do outro lado. A mensagem passou a afirmar só o que é
verificável localmente — **a conexão não foi salva** — e a orientar a aguardar.

A distinção chega aos três lugares: mensagem na tela (`META_FAILURE_MESSAGES`), auditoria
(`recordConnectionFailure({ errorStage })`) e log/observabilidade
(`messaging.whatsapp.connection_failed`).

#### Decisão 4 — corrida entre os dois canais e limite de correlação

O Embedded Signup usa **dois canais independentes**: o callback do `FB.login` e o `postMessage` do
pop-up. A ordem não é garantida, e o código decidia o veredito no callback — então um callback sem
`code` que chegasse antes de um `FINISH` deixava a tela em `SIGNUP_NOT_STARTED` para sempre.

**Limite de correlação, registrado explicitamente.** O `attempt.id` protege **apenas** o que o Qoro
consegue amarrar a uma tentativa: o callback do `FB.login` (capturado no closure daquela chamada) e os
timers. O `postMessage` **não é correlacionável** — a documentação oficial não expõe, em
`FINISH`/`FINISH_ONLY_WABA`/`CANCEL`, nenhum identificador que também esteja disponível no callback do
SDK (o `session_id` aparece só no formato de erro reportado). **Não se afirma que mensagens antigas são
invalidadas pelo `id`**; elas não são.

A contenção vem do **single-flight**, não da correlação:

- só existe uma tentativa por vez. `launchSignup()` retorna imediatamente se a fase não for `idle` —
  guarda **programática**, porque um clique duplo dispara os dois handlers antes do re-render e o
  atributo `disabled` sozinho não barraria o segundo;
- enquanto a tentativa está ativa, PIN, "Conectar WhatsApp" e "Reconectar WhatsApp" ficam desabilitados;
- o `postMessage` só é aceito na fase `running`. Com o desfecho já conhecido (`closing`) ou sem
  tentativa (`idle`), é descartado;
- a liberação exige **os dois canais quiescentes**: o callback do SDK retornou **e** passou
  `SIGNUP_QUIESCE_MS` (3 s) desde o desfecho. Só então uma nova tentativa pode começar.

Risco residual, declarado: se o pop-up de uma tentativa sobreviver à liberação e emitir um evento
**depois** de a tentativa seguinte começar, não há como distingui-lo. Não existe mecanismo oficial que
elimine isso; o que a implementação garante é que nenhuma tentativa nova começa antes de a anterior
estar terminal e quiescente.

Timers, todos nomeados, cancelados no desmonte e ao iniciar nova tentativa:

| Constante | Valor | Papel |
| --- | --- | --- |
| `SIGNUP_EVENT_GRACE_MS` | 1,5 s | Callback voltou sem `code`: espera um evento antes de decidir. Qualquer evento resolve e cancela o timer |
| `SIGNUP_QUIESCE_MS` | 3 s | Desfecho conhecido: janela em que um `postMessage` atrasado ainda é descartado |
| `SIGNUP_ABANDON_MS` | 10 min | Timeout explícito, ativo em `running` **e** em `closing`. Único caminho que libera sem os dois canais quiescentes — existe porque um pop-up morto pelo sistema pode nunca acionar o callback do SDK. Sem desfecho, encerra com `SIGNUP_TIMED_OUT`; **com** desfecho já registrado, apenas destrava e preserva a mensagem original |

**Resposta da Server Action.** Ela é descartada por `attempt.id` antes de qualquer efeito — nem
`setError`, nem `router.refresh()`, nem escrita de estado. Mas o que **garante** que uma resposta
atrasada nunca encontre uma tentativa mais nova não é o id: é o `pending` da transição, que trava PIN e
botões enquanto a action não responde, mesmo depois de o abandono ter liberado a fase. Quando a
resposta chega, a transição já terminou. A checagem por id é defesa em profundidade, não a garantia
principal — e é isso que o teste prova: com a action em curso e a fase já liberada, `FB.login` continua
sendo chamado exatamente uma vez.

**Correção do deadlock em `closing`.** A revisão anterior deste documento afirmava que o abandono já
cobria essa fase — **não cobria**: `beginClosing()` cancelava o timer, e a liberação exige
`callbackReturned`. Um `CANCEL`, `ERROR` ou `FINISH` sem `waba_id` seguido de um callback que nunca
retorna travava PIN e botões até um reload da página. O timer deixou de ser cancelado ali e passou a
valer nas duas fases; todos os timers guardam `attempt.id`, então nenhum timer antigo libera ou suja
uma tentativa nova. Três testes com timers falsos cobrem os três eventos terminais, e a mutação que
reintroduz o cancelamento faz 5 testes falharem.

Ordens cobertas por teste: `code`→FINISH, FINISH→`code`, sem-`code`→FINISH, FINISH→sem-`code`,
sem-`code`→nada, sem-`code`→CANCEL, CANCEL→sem-`code`, erro reportado nas duas ordens, evento `ERROR`,
clique duplo, relançamento bloqueado com janela pendente, CANCEL antes do callback travando até o
callback + quiescência, callback atrasado da tentativa anterior, `postMessage` fora da fase ativa e
abandono. Dois testes são verificados por mutação: removendo o cleanup do desmonte, 13 falham;
removendo a guarda de single-flight, o teste de clique duplo falha.

#### Decisão 5 — contrato de `ERROR`/`CANCEL`: ambíguo na fonte oficial

Registro de incerteza, porque a documentação oficial é **inconsistente entre páginas** e a versão em
uso não pode ser fixada a partir do repositório:

- a página de [implementação](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
  modela o campo como `event: '<FLOW_FINISH_TYPE>'` e lista, na mesma enum, `FINISH`,
  `FINISH_ONLY_WABA`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, `FINISH_OBO_MIGRATION`,
  `FINISH_GRANT_ONLY_API_ACCESS`, `CANCEL` **e `ERROR`**;
- a mesma página mostra o erro reportado chegando como `event: 'CANCEL'` com
  `error_message`/`error_code`/`session_id`/`timestamp`, e o abandono como `event: 'CANCEL'` com
  `current_step`;
- a página de [erros do fluxo](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors/)
  exibe `version: 3` no payload de `CANCEL`; a de implementação não exibe `version` em nenhum exemplo.

**A afirmação anterior deste documento — "não existe evento `ERROR` publicado" — estava errada** e foi
removida. As duas formas são suportadas de propósito, e o código não depende de `version`. Os `FINISH_*`
de outros fluxos (app do WhatsApp Business, migração OBO, grant-only) não pertencem a esta configuração
e não são tratados.

Desfechos que a tela distingue, sem reproduzir o texto cross-origin do pop-up:

| Código na tela | Condição observável |
| --- | --- |
| `SIGNUP_NOT_STARTED` | callback sem `code` e **nenhum** `WA_EMBEDDED_SIGNUP` dentro da janela de tolerância |
| `CANCELLED` | `CANCEL` sem `error_message`/`error_code` (desistência humana) |
| `META_SIGNUP_ERROR` | `CANCEL` com `error_message`/`error_code`, ou `ERROR`. Só a referência curta é exibida, sanitizada para `[A-Za-z0-9_-]{,32}` |
| `SIGNUP_INCOMPLETE` | `FINISH`/`FINISH_ONLY_WABA` sem `waba_id` |
| `AUTHORIZATION_MISSING` | `FINISH` válido, mas o `FB.login` não devolveu `code` |
| `SIGNUP_TIMED_OUT` | `SIGNUP_ABANDON_MS` expirou **sem** desfecho — o pop-up nunca acionou o callback do SDK. Com desfecho já registrado, o abandono apenas destrava e não substitui a mensagem |

A mensagem de `SIGNUP_NOT_STARTED` afirma apenas o que é observável — que nenhum evento chegou — e pede
que o operador informe o aviso caso o pop-up tenha exibido algum. O Qoro **não** lê aquela janela.

#### Decisão 6 — compatibilidade do payload da Server Action

`wabaHint`/`phoneHint` foram renomeados para `wabaId`/`phoneNumberId`. Decisão: **manter a quebra, sem
aliases**.

A [doc de Server Actions do Next.js](https://nextjs.org/docs/app/guides/server-actions) é explícita:
*"Each Server Action is identified by the action ID that is part of its build artifacts. New
deployments typically generate new IDs (Next.js rotates them at most every 14 days, even when the
source is unchanged), so a client still running the previous build may invoke an action ID that no
longer exists."* A chamada de uma aba antiga falha na resolução do **id**, antes de o payload ser
desserializado — aliases no schema nunca seriam alcançados. Aceitá-los criaria um segundo contrato
permanente sem resolver nada.

A recomendação da própria doc (*"Surface the error as a retry path in the UI rather than a hard failure,
so a refresh recovers the user"*) já está atendida: a falha cai no `catch` do connect, que exibe
`CONNECTION_FAILED` com "Tente novamente" e libera nova tentativa. A janela de risco é mínima — o fluxo
sempre parte de um pop-up novo — e recarregar a página resolve.

#### Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/contexts/messaging/internal/meta-onboarding.ts` | `MetaTokenGrant`; `validateTokenScopes` devolve as WABAs de `granular_scopes`; `resolveWabaAndPhone` com allowlist + `waba_id` obrigatório; remoção de `/me/businesses` e `/owned_whatsapp_business_accounts`; `pickPhone()` sem escolha por posição; `listWabaPhones()` delega a classificação; **classificação única dentro de `graphFetch`** (`classifySignal`/`classifyGraphFailure` + `failureStage`), cobrindo todas as etapas do connect e separando mutação de leitura; `graphFetch` extrai `error.code` e `error_subcode`; `outcomeFromGraphError` usa o mesmo classificador |
| `src/contexts/messaging/actions.ts` | `wabaHint`/`phoneHint` → `wabaId`/`phoneNumberId`; falha `signup_incomplete` antes de qualquer chamada Meta; repasse do grant ao resolver |
| `src/contexts/messaging/errors.ts` | estágios `signup_incomplete`, `phone_ambiguous`, `provider_unavailable`, `provider_rate_limited`, `provider_outcome_unknown`; `MetaConnectError` carrega `graphCode` e `graphSubcode` |
| `src/contexts/messaging/internal/channel-health.ts` | comentário canônico alinhado: negativa é a **documentada**, não "todo 4xx" |
| `src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx` | máquina `idle/running/closing` com single-flight; `SIGNUP_EVENT_GRACE_MS`, `SIGNUP_QUIESCE_MS`, `SIGNUP_ABANDON_MS` ativo também em `closing` (correção do deadlock); `attempt.id` em todos os timers, e a resposta da Server Action descartada por id antes de qualquer efeito; timers cancelados no desmonte e em nova tentativa; desfecho terminal não sobrescrito; PIN e botões travados durante a tentativa; CANCEL com/sem erro; `ERROR` suportado; sanitização da referência da Meta |
| `src/app/(app)/(shell)/configuracoes/whatsapp/wa-types.ts` | mensagens dos cinco estágios novos, com `provider_outcome_unknown` sem prometer "nada foi alterado" |
| `+5 arquivos de teste` | `meta-onboarding.test.ts`, `meta-health-probe.test.ts`, `connect-tenant.test.ts`, `whatsapp-connect.test.tsx`, `wa-types.test.ts` |

Sem migration, sem mudança de schema, sem alteração no painel Meta, sem chamada externa mutável.

#### Gates — execução de 05/09/2026 (worktree `feat/qorov2-pagamentos`)

| Gate | Comando | Resultado |
| --- | --- | --- |
| Testes focados (Meta + UI) | `vitest run meta-onboarding.test.ts meta-health-probe.test.ts connect-tenant.test.ts whatsapp-connect.test.tsx wa-types.test.ts` | ✅ **199/199 em 5 arquivos** (exit 0) |
| Revalidação focada após merge | 19 arquivos de D78, P11 e conflitos da `main` | ✅ **323/323** (exit 0) |
| Suíte integral | `pnpm test:coverage` | ✅ **2.975/2.975 em 318 arquivos**, thresholds atendidos (exit 0) |
| Typecheck | `pnpm typecheck` | ✅ sem erro |
| Lint integral | `pnpm lint` | ✅ sem erro |
| Ciclos | `pnpm arch:check` | ✅ nenhum ciclo |
| Snapshots de arquitetura | `pnpm arch:graphs --check` | ✅ em dia (54 elementos · 293 arestas · 0 ciclo · 67 eventos) |
| Fronteira de DB | `pnpm arch:db-check` | ✅ 1.130 arquivos, 0 achados |
| Migrations | `pnpm check:migrations` | ✅ nenhuma operação destrutiva não aprovada |
| Observabilidade | `pnpm check:observability` | ✅ 18 crons coerentes |
| Registry | `pnpm check:registry:strict` | ✅ catálogo (67) ⇔ registry (25) |
| Build | `pnpm build` | ✅ compilação otimizada concluída; etapa webpack em 2,4 min (exit 0) |
| Diff | `git diff --check` + releitura | ✅ limpo; sem segredo, log de debug ou teste desabilitado |
| Formatação | `pnpm format:check` + check normalizado do lote | ⚠️ o gate integral continua vermelho no baseline (128 arquivos, sobretudo CRLF/artefatos). Nos 60 arquivos formatáveis do lote integrado, cinco divergências já existiam no parent da branch e foram formatadas localmente; nenhum arquivo novo permanece divergente |
| **E2E Meta externo** | conta sem App Role | 🔴 **`NOT TESTED`** — a autorização operacional foi concedida, mas ainda depende do desbloqueio na Meta e de uma conta externa disponível. Nenhum mock substitui esta prova |

Os testes usam `fetch` e Server Action mockados: provam **regressão local**, não o provider.

Separação e integração: `175750b` (D78), `940335e` (P11/D77) e `c5f759d` (merge explícito de
`origin/main`, sem rebase). O lote foi publicado em `f2c1b60`, teve deployment Vercel terminal
`success`, Preview 6/6 e migration 0094 em produção com pós-check 9/9. Nenhuma chamada Meta foi feita;
o teste Asaas D77 executou um único `POST /refund` e passou depois somente por readback desse estorno.

#### Corrigido em código vs. dependente da Meta

**Corrigido em código (fechado):**

- fallback incompatível com o token de usuário do sistema, removido; runtime não exige
  `business_management`;
- `waba_id` obrigatório, validado por allowlist do token (quando disponível) + `/phone_numbers`;
- telefone nunca escolhido por posição em lista ambígua; id inexistente falha em vez de cair no primeiro;
- classificador único de falha do Graph, agora dentro do `graphFetch` e portanto ativo em **todas** as
  etapas do connect (troca de code, escopos, resolução, `/register`, `/subscribed_apps`) e na sonda:
  `429`, códigos de throttling, `5xx`, timeout e `400` sem código documentado deixaram de virar
  "recusa";
- mutação indeterminada (`POST`/`DELETE`) separada de leitura indeterminada: `provider_outcome_unknown`
  não promete "nada foi alterado" e não pede repetição imediata — sem retry automático;
- deadlock da fase `closing` corrigido: o abandono cobre `running` e `closing`, destrava sem
  substituir o desfecho já registrado e não deixa timer vivo no desmonte;
- single-flight do Embedded Signup: uma tentativa por vez, PIN e botões travados, guarda programática
  contra clique duplo, liberação só com os dois canais quiescentes;
- corrida callback/`postMessage` modelada; três timers nomeados, cancelados no desmonte e em nova
  tentativa; limite de correlação do `postMessage` documentado em vez de mascarado;
- nenhuma persistência, registro ou assinatura após qualquer falha (teste parametrizado);
- tela distingue cinco desfechos observáveis sem reproduzir texto cross-origin.

**Dependente da Meta / App Review (aberto):**

- Advanced Access de `public_profile` (hoje "Pronto para teste") para que uma conta sem App Role
  consiga ver o diálogo de login;
- verificar no painel se há pendência de Verificação da Empresa, Data Use Checkup ou outra ação
  exigida — **nenhuma delas está confirmada**;
- `whatsapp_business_manage_events` permanece sem uso no repositório e **não deve entrar na análise**;
- `business_management` **não deve ser solicitada**: o código final não consulta portfólio. Ela só
  passaria a fazer sentido se o produto voltasse a consultar o portfólio empresarial, e pedir permissão
  sem uso atual demonstrável prejudica o App Review;
- reteste com conta externa sem App Role.

#### Roteiro de painel para o operador

1. **Diagnosticar antes de submeter.** Em *Painel do app → Análise do app → Permissões e recursos*,
   anote o nível de cada permissão: toda permissão exigida pelo diálogo de login precisa estar em
   **Acesso avançado** para usuários sem função no app, inclusive `public_profile`. Depois, percorra
   separadamente e anote o estado de cada item, sem presumir nenhum: **Verificação da Empresa**,
   **Data Use Checkup**, e a lista de ações pendentes exibida na Caixa de entrada do painel.
2. **Concluir o Advanced Access do fluxo realmente implementado.** Solicitar Acesso avançado apenas
   para `public_profile` e manter os dois escopos WhatsApp já aprovados. **Não** incluir
   `business_management` nem `whatsapp_business_manage_events`.
3. **Justificativa e vídeo.** Gravar a jornada real: clínica em `/configuracoes/whatsapp` → Conectar →
   login → seleção de WABA/número → tela conectada. Chamadas de teste demonstráveis:
   `GET /{waba-id}/phone_numbers` e `POST /{waba-id}/subscribed_apps` com o token do Embedded Signup.
4. **Não presumir efeito automático.** Adicionar uma permissão à análise **não** altera a configuração
   ativa `2444333529395515` nem tokens já emitidos. A configuração só deve ser tocada **depois** da
   aprovação, e apenas se o código passar a exigir a permissão nova — hoje ele não exige.
5. **Desbloqueio temporário do cliente (opcional).** Adicionar o perfil pessoal do cliente como App Role
   **Tester**, pedir que aceite o convite, testar e **remover a função depois**. Isso só prova o caminho
   com função no app; não substitui o reteste externo. **Nunca** solicitar senha, código de autenticação
   ou token ao cliente.

#### Roteiro de reteste externo

Executar com uma conta **sem nenhuma função no app** e registrar cada etapa separadamente. Só declarar
D78 resolvido se as sete passarem:

| # | Etapa | Evidência esperada |
| --- | --- | --- |
| 1 | popup abre e mostra o login | diálogo OAuth com o `config_id` da configuração ativa |
| 2 | login conclui sem `Recurso indisponível` | avança para as telas do Embedded Signup |
| 3 | `code` emitido | a tela entra em conexão; se não, o código exibido diz qual desfecho ocorreu |
| 4 | evento `FINISH` com `waba_id` | conexão prossegue; se faltar, a tela mostra `SIGNUP_INCOMPLETE` |
| 5 | WABA/telefone resolvidos | sem falha de `account`, `phone_ambiguous` ou `provider_unavailable` |
| 6 | `register` + `subscribed_apps` | sem falha de `phone_registration`/`webhook_subscription` |
| 7 | persistência | tela em "WhatsApp conectado" com número mascarado |

Se a etapa 2 falhar de novo com a mesma mensagem, a causa é externa e o código não é o bloqueio; se
falhar da etapa 3 em diante, há evidência nova de produto — e agora a tela informa **qual** desfecho
ocorreu, em vez de dizer "cancelada". Contexto e brief original:
[handoff D78](handoff-meta-embedded-signup.md), incluído no mesmo lote para preservar o link.

### Sub-fases da Camada 1

| Sub-fase | Estado | Confirmado por |
| --- | --- | --- |
| 1.0 Adapter Asaas | ✅ | `src/lib/payments/asaas/index.ts` + 26 testes |
| 1.1 Credencial por clínica | ✅ | migration 0081 aplicada; `clinic_payment_accounts` com grant por coluna |
| 1.2 Política de sinal | ✅ | migration 0082; `payments/policy.ts` (funções puras) |
| 1.3 Charges + hold | ✅ | migrations 0083–0085; cron `/api/cron/payments-deposit` |
| 1.4 Webhook do paciente | ✅ **corrigido e provado no negócio (D47–D48)** | `0089` aplicada; grants/RLS validados; E2E no Preview criou sinal de R$ 75,00, recebeu `PAYMENT_RECEIVED` real do Asaas e confirmou a consulta |
| 1.5a Falta / cancelamento / estorno | 🟡 **D77 CANCELLED PASS; DONE BLOCKED** | P11 reutiliza `patient_refund_intents`, nunca fecha no 2xx, trata `CANCELLED` como falha e só projeta `refunded` após `DONE`/pagamento `REFUNDED`; migration 0094 aplicada em DEV/PROD, smoke DEV 7/7, Preview 6/6 e pós-check PROD 9/9 verdes. Duas provas pós-rollout fizeram exatamente um refund cada, sem duplicata, convergiram para `CANCELLED → failed/paid/available` e tiveram cleanup local exato. D79 corrigiu a correlação; D80 bloqueia nova tentativa até diagnóstico do Asaas |
| **1.5b Restante** | ✅ **runtime completo** — 1.5b.1 · 1.5b.2 · 1.5b.3a · 1.5b.3b | migration 0088; `credit-store` + 2 handlers; `remainder-charge` + `remainder-scan`; seam `getAppointmentBalance` |
| 1.6a Link no WhatsApp | ✅ | migration 0087; fila C14 tipo `deposit_link`; cron próprio |
| 1.6b Status do sinal na agenda | ✅ | `AppointmentSummary.depositStatus`; `DepositStatusBadge`; sem migração |
| **1.6c Entrega do link do RESTANTE** | ✅ **IMPLEMENTADA E ENTREGUE** | migration 0090; job/cron `remainder_link`; lookup no send-time; template próprio; Meta aceitou e o operador confirmou a chegada ao aparelho |
| 1.H Hardening | 🟡 **EM EXECUÇÃO** | D13 RLS ✅ 5/5 · RLS/concorrência financeira ✅ 10/10 · jornada banco+worker + D52 ✅ 13/13 · POST indeterminado contido ✅ · simulação 30 dias ✅ · restore + carga P8 ✅ · D54/D55 externo ✅ · Playwright Preview read-only ✅ · matriz visual pós-deploy ✅ 8/8/72 estados · Product Acceptance técnico-normativo ✅ 150/150 · D27 externo ✅ · D60/D70 publicados/revalidados ✅ · D77 código/DEV/PROD/Preview ✅ e provider `PARTIAL` · D50 aguarda provider |
| 1.S Stabilization | ✅ **CONCLUÍDA — P10** | D73 worker órfão ✅ · D74 gate de POST alinhado ao Checkout ✅ · D75 isolamento dos harnesses ✅ · C14 9/9 ✅ · Financial 10/10 ✅ · jornada 13/13 ✅ · simulação 30 dias ✅ · lint/typecheck/build ✅ · 2.816/2.816 testes ✅ · arquitetura/operacionais ✅ · diff/formatação/segredos revisados ✅ · commit executável `4883372` publicado/deployado ✅ · Preview autenticado 6/6 sem `pageerror` ✅ |

**A Camada 1 NÃO terminou.** A **1.S/P10 está concluída** e o corretivo **P11/D77** está verde em
código, bancos DEV/PROD e Preview. A nova prova Sandbox confirmou `PENDING → CANCELLED` sem falso
fechamento e o cleanup local passou; o ramo externo `DONE` segue `NOT TESTED`. Também falta o
fechamento externo da **1.H/D50**. O E2E real do sinal passou no Preview até
`charge → pagamento sandbox → webhook Asaas → crédito → CONFIRMADO`. Em 31/08, a entrega do link foi
exercitada até o aceite real da Meta para sinal e restante: conexão ativa, templates distintos,
`providerMessageId`, jobs terminais e replay zero; em 02/09 o operador confirmou a chegada das duas
mensagens ao aparelho. Os três ramos financeiros e parte substancial da matriz destrutiva/de concorrência de
1.H já passaram de forma controlada contra banco e worker; ainda faltam os casos residuais listados
abaixo e as dependências externas. Portanto o aceite integral da camada continua parcial
(D32), sem apagar a evidência real já obtida. A **1.6c está integralmente verde**; sua antiga lacuna
externa de recebimento foi fechada pela confirmação humana.

### Gates — resultado REAL da última execução completa

Executados novamente em **2026-09-06** após o achado D79. A migration `0094`
foi aplicada em produção com backup e advisory lock; o pós-check read-only passou 9/9. O smoke conectado
de dinheiro foi repetido contra DEV e terminou 7/7 com cleanup zero. Os resultados Financial 10/10 e
jornada 13/13 abaixo são evidências anteriores preservadas, não execuções desta rodada. Lint, typecheck,
suíte integral, build e checks arquiteturais/operacionais foram repetidos no worktree integrado.

| Gate | Comando | Resultado |
| --- | --- | --- |
| Lint | `pnpm lint` | ✅ |
| Typecheck | `pnpm typecheck` | ✅ |
| Testes | `pnpm test:coverage` | ✅ **2.977/2.977** (318 arquivos), incluindo o formato real do POST de refund, correlação por baseline, contrato terminal D50/D77, compatibilidade pré-0094, concorrência e regressão integral |
| Build | `pnpm build` | ✅ exit 0 |
| Ciclos | `pnpm arch:check` | ✅ 0 ciclos (1.058 arquivos) |
| dbAdmin allowlist | `pnpm arch:db-check` | ✅ 0 findings (1.130 arquivos) |
| Snapshots de acoplamento | `pnpm arch:graphs --check` | ✅ 54 elementos · 293 arestas · 0 ciclos · 67 eventos |
| Migrations | `pnpm check:migrations` | ✅ nenhuma destrutiva não aprovada |
| Catálogo ⇔ registry | `pnpm check:registry:strict` | ✅ catalog 67 ⇔ registry 25; 42 producer-ahead |
| Observabilidade | `pnpm check:observability` | ✅ 18 crons coerentes e 6 eventos cobertos por buscas salvas |
| Worker/Smoke C14 | `pnpm smoke:c14` | ✅ 9/9, incluindo tenant removido → `skipped_missing_clinic`; banco dev, fixtures removidas, sem envio Meta |
| RLS/concorrência financeira | `pnpm smoke:payments-financial` | ✅ 10/10 em evidência anterior, banco dev, fixtures removidas; não repetido nesta rodada |
| Jornada banco+worker | `pnpm smoke:payments-journey` | ✅ 13/13 em evidência anterior, incluindo timeout/retry e detector D52 cross-tenant, dois usuários sintéticos removidos, sem Asaas/Meta; não repetido nesta rodada |
| Contenção de POST indeterminado | `pnpm smoke:payments-post-recovery` | ✅ provedor local aceitou 1 `POST /checkouts` e perdeu a resposta; Qoro preservou 1 dívida/1 geração `creation_unknown`, 0 links/eventos e 0 POST duplicado; cleanup zero |
| Simulação 30 dias | `pnpm test:simulation` | ✅ 30 agendamentos · 38 cobranças · 62 webhooks · 3 ticks · zero retry/falha · cleanup zero, sem Asaas/Meta |
| Matriz focada de ciclo de vida | `pnpm vitest run <7 arquivos>` | ✅ 138/138: falha indeterminada de provider, send-time, pagamento tardio, reagendamento, Asaas fora e retry Meta |
| Webhook de assinatura D54/D55 | `pnpm vitest run <4 arquivos>` | ✅ 73/73: `deleted:true`, restore, pago fora de ordem, CAS e replay |
| Restore isolado | `pnpm restore:test backups/prod-pre-migration-2026-08-27T04-49-51.sql` | ✅ PostgreSQL local descartável na porta 55439: 117 tabelas, 83 policies, âncoras 3/41/48/1095; servidor parado e diretório removido após a prova |
| Carga P8 scratch-only | `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY pnpm test:load` após `pnpm build` | ✅ 500 consultas; C14 5.000/5.000, P99 2,35s; webhook 1.000/1.000 `2xx`, P99 235,73ms; outbox 5.000 uma vez, P99 1,47s; reconcile 20/20, P99 36,14ms; SQL P99 3,18ms; zero deadlock/duplicata/retry/falha; PostgreSQL parado e temp removido |
| Playwright Preview somente leitura | `e2e/login-and-navigation.spec.ts` + auditoria autenticada ampla, `E2E_AUTH_REUSE=1`, `E2E_MUTATION=0` | ✅ **6/6** no smoke canônico e **2/2 executados + 1 skip esperado** na auditoria ampla: 26 rotas estáticas HTTP 200, paciente/conversas sem dados aceitos; estado autenticado e artefatos temporários removidos |
| Asaas ao vivo | `pnpm payments:live-check` | ✅ 12/12 reexecutados em 2026-08-28, incluindo reconfiguração sem duplicar e limpeza ok + **1 declarado não-verificado** (estorno de PIX/cartão exige pagamento real) |
| Checkout/gerações DB | `pnpm smoke:payments-checkout-db` | ✅ 5/5 em DEV: RLS/grants, claim idempotente, dívida única, cross-tenant, ativação/send-time; cleanup zero |
| D50/D27/D77 DB | `pnpm smoke:payments-money-db` | ✅ **7/7 em DEV**: estrutura/RLS/grants, intenção concorrente, `CANCELLED` sem falso fechamento, `DONE` atômico + replay, D50 exato, disputa/reversão e perda/cross-tenant; cleanup zero |
| P11 focado | `pnpm vitest run <7 arquivos>` | ✅ **104/104**: migration, closeout, webhook, reconciliador, descoberta de tenants, handler e intents antigos sem os contadores da 0094 |
| Migration PROD `0094` | `SUPABASE_PROJECT_ENV=prod pnpm db:migrate:prod` + verificação read-only | ✅ backup **2.661.164 bytes** · advisory lock adquirido/liberado · `DONE` · pós-check **9/9**: version/journal, colunas, constraints, RLS/FORCE RLS, grants, dados existentes e lock ausente |
| D77 externo pós-rollout | runner guardado de PIX na Clinic A Sandbox | ✅ **CANCELLED PASS / DONE BLOCKED**: duas fixtures isoladas liquidaram PIX e fizeram exatamente 1 refund cada, sem segundo POST no replay. Ambas terminaram `CANCELLED`; intenção `failed`, cobrança `paid` e crédito `available`. A última usou trava pré-POST com operador no painel e ficou 71 s em autorização crítica. O painel informou sucesso ao operador, mas a API cancelou o refund e o saldo continuou subindo com os PIX creditados. Readback/reconcile e cleanup local passaram; histórico Sandbox preservado |
| D79 correlação do refund | `asaas/index` + `excess-refund` | ✅ adapter não confunde mais o id da cobrança com refund; fallback do baseline aceita id armazenado sem correspondência; regressões `CANCELLED` e `DONE` + suíte 2.977/2.977 verdes |
| D50 focado + status preservado | `pnpm vitest run <6 arquivos>` + `STATUS_CLINICA_A_D50` | ✅ **29/29**; pagamento/webhook reais, R$ 10 alocados, um único POST parcial de R$ 10 e intenção `confirmation_pending`. Readback independente de 06/09 confirmou pagamento `CONFIRMED`, `patient_charge=paid`, recebível R$ 20 pago, duas baixas/R$ 20, baseline zero e exatamente um refund de R$ 10 ainda `PENDING`; nenhum POST/cleanup. A consulta separada da D80 retornou `RECEIVED` + refund `CANCELLED`, provando que os estados não estão misturados |
| D62 tenant + Financial + replay | `PROCESS_RETAINED_CLINICA_A_PATIENT_CHARGEBACK_RISK` | ✅ **3 fatos processados / replay 0 de 3**; conta vinculada por fingerprint, nenhuma fila alheia tocada, compensação ligada à baixa, `chargeback_loss` única, saldo reaberto e atendimento preservado |
| Cleanup D62 | `CLEANUP_RETAINED_CLINICA_A_PATIENT_CHARGEBACK` | ✅ preflight exato, provider `REFUNDED/DONE`, 16 linhas sintéticas removidas em transação, zero mutação no provider, auditoria de webhook preservada, manifesto removido e zero resíduo da fixture |
| Webhook global D54/D55/D66 | `pnpm billing:delete-restore-e2e` + verificador read-only | ✅ conta vinculada por fingerprint; `qoro dev` ativo com 7 eventos/`NON_SEQUENTIALLY`; `PAYMENT_DELETED → cancelled → PAYMENT_RESTORED → open`; replay idempotente e cleanup provider+banco |
| Rollback por clínica | `pnpm vitest run policy deposit-charge deposit-scan remainder-charge` | ✅ **55/55**: `enabled=false` não cria sinal/restante e o scanner seleciona somente clínicas habilitadas |
| Migrations PROD `0091` + `0092` | `pnpm db:migrate:prod` + verificação read-only | ✅ backup 2.834.598 bytes · lock adquirido/liberado · `DONE` · sem sentinel · pós-verificação **7/7**: versions/journal, enums, tabelas/colunas, RLS/policies, grants, índices/constraints e lock ausente |
| `pnpm format:check` | — | ❌ **vermelho na baseline** (128 arquivos pré-existentes, **D9**). Todos os arquivos tocados neste lote passam no check direcionado |

Migrations **0081–0094** aplicadas e verificadas no banco de **dev**. A `0094` passou o smoke conectado
7/7, incluindo RLS/grants, concorrência, estados terminais, replay e isolamento cross-tenant. Após a rotação da credencial,
`0091` e `0092` foram aplicadas juntas em produção com backup, advisory lock e `DONE`; o arquivo DPAPI
foi removido. A verificação SQL pós-migration independente passou 7/7 em transação read-only. Para a
publicação de P11, a `0094` também foi aplicada em produção com backup de 2.661.164 bytes, advisory lock,
`DONE` e pós-verificação read-only 9/9. A migration `0093` foi integrada a esta branch a partir da `main`; o
histórico `0081–0092` também foi reconciliado e publicado na `main` pelo commit `93da840`.
Antes da aplicação, a `0090` foi
validada sem persistência: banco populado (2 jobs), `up → rollback → up` verde e modelo vazio temporário
aceitou `remainder_link`. Em 27/08, a `0090` também foi aplicada e verificada em **produção** com backup
pré-migration e advisory lock; `pg_enum`, `_schema_version` e o cast do novo valor retornaram verdes.
PostgreSQL não oferece `down` aditivo seguro para enum; rollback operacional reverte o código e deixa
o valor inerte, sem recriar tipo/tabela.

**Isolamento e concorrência financeira provados no banco de dev** por
`pnpm smoke:payments-financial` (**10/10**, fixtures removidas): `patient_credits` usa ENABLE+FORCE
RLS; A não lê, insere nem altera B; `authenticated` não apaga ledger; oito grants concorrentes geram
um crédito; duas alocações consomem uma vez; sobrealocação cai no CHECK; crédito alocado não é
liberado; duas liberações produzem um terminal. Tudo terminou com resíduo zero.
O equivalente para `clinic_payment_accounts` (**D13**) passou no 1.H: smoke real no banco DEV com
**5/5** checks provou ENABLE+FORCE RLS, leitura própria, invisibilidade cross-tenant, bloqueio de
alteração da conta alheia, segredo sem grant e cleanup com zero resíduos.

O **E2E controlado da jornada** passou por `pnpm smoke:payments-journey` (**13/13**) com Postgres e
worker reais, sem Asaas/Meta: A falta reteve o crédito e não criou restante; B conciliou dois webhooks
concorrentes em uma baixa, alocou o restante e fechou o ledger em R$ 200; C aceitou um único
fechamento concorrente e projetou cobrança, crédito e agenda como `refunded`; D correu pagamento
contra expiração do hold sem ressuscitar a vaga nem duplicar dinheiro; dois inserts de restante
produziram uma cobrança/um `link_ready`; a clínica A não conciliou a cobrança da B; e um lock real
forçou o `statement_timeout`, devolveu o evento ao outbox como `pending` observável e o retry criou um
único recebível. O detector D52 encontrou crédito terminal e agenda vencida em dois tenants, ignorou
uma consulta futura mesmo com crédito antigo, repetiu o mesmo resultado e deixou os quatro créditos
de prova intocados. O teste revelou e corrigiu o **D49** no lote anterior. Dois usuários Auth e todas
as fixtures foram removidos, resíduo zero.

A **contenção de POST indeterminado** também passou no banco DEV por
`pnpm smoke:payments-post-recovery`, com um provedor HTTP local controlado: ele aceitou o primeiro
`POST /checkouts` e derrubou o socket antes da resposta. Como o contrato público do Checkout não
oferece busca por referência nem idempotency-key, o Qoro preservou a dívida e sua única geração como
`creation_unknown`, não inventou `providerCheckoutId`/link, não publicou `created`/`link_ready` e não
fez outro POST nas duas reentradas. Resultado: **1 POST · 1 `patient_charge` · 1 geração unknown · 0
eventos · 0 duplicata**, sem chamada ao Asaas/Meta e com fixture/usuário removidos e resíduo zero.

O **Clinic Simulation** passou por `pnpm test:simulation` no banco DEV com o worker real e paralelismo
4: 30 dias/agendamentos em ordem mista, 38 cobranças, 62 entregas webhook incluindo duplicadas e fora
de ordem, 8 atendimentos concluídos, 8 faltas, 7 estornos e 7 expirações. Os 8 recebíveis terminaram
quitados, o ledger fechou em R$ 800,00, e não restaram cobrança duplicada, órfão, hold, evento ativo ou
fixture. A primeira execução revelou o **D51** (`pago` sem `paid_at`); após a correção, a repetição
processou tudo em 3 ticks, sem retry/falha, e removeu clínica e usuário sintéticos com resíduo zero.

### O que foi fechado no hardening de 27/08

| Entrega | Evidência real | Arquitetura preservada |
| --- | --- | --- |
| D49 — restante recebido não baixava o Caixa | unitário 7/7 + jornada banco/worker; `a7717e7` | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1: `financial` continua dono do ledger |
| Concorrência financeira e multi-tenant | `smoke:payments-financial` 10/10 + `smoke:payments-rls` 5/5, cleanup zero | [ADR-007](adr/007-rls-implementation-patterns.md) + [ADR-011](adr/011-outbox-audit-idempotency-patterns.md) |
| Jornada A/B/C, corrida pagamento×hold e isolamento A→B | `smoke:payments-journey` 13/13, banco e worker reais | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §§4 e 7 + ADR-051 |
| Banco lento e retry pós-`statement_timeout` | evento voltou a `pending`, erro observável, 2 tentativas e 1 recebível | ADR-011: lease/retry/idempotência existentes, sem fila paralela |
| POST de Checkout aceito com resposta perdida | `smoke:payments-post-recovery`: 1 POST, 1 dívida/geração `creation_unknown`, 0 links/eventos e 0 duplicata, cleanup zero | ADR-011 + [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md): intenção/lease antes da rede e reconciliação explícita, sem retry cego |
| D51 — recebível já pago sem `paid_at` | unitário 13/13 + simulação 30 dias; `c480e44` | ADR-051: valor bruto + pagamento comprovado/alocado |
| D52 — crédito antigo permanecia invisível em `available` | `ca94839`; route 3/3 + jornada DEV 13/13: terminal, agenda vencida, futuro, replay e cross-tenant | ADR-051 §5: detector no reconcile existente, somente leitura, sem decidir destino do dinheiro |
| D53 — senha permanecia no DOM e podia entrar no snapshot de erro Playwright | artefatos locais removidos, auth storage ausente; helper 3/3 + regressão de login 10/10 | hardening local do login/teste; limpa após captura do submit e após erro, sem novo contrato/ADR nem armazenar/repetir a credencial |
| D54/D55 — delete/restore da assinatura não fechavam o round-trip | route + decisão pura + sincronizador 73/73; round-trip Sandbox real `open → cancelled → open`, replay e cleanup passaram | Billing segue dono da invoice; `getPayment` decide, CAS/audit impedem duplicata e nenhuma aresta genérica `cancelled → open` foi aberta |
| Operação acumulada | `test:simulation`: 30 agendamentos, 38 cobranças, 62 webhooks, 3 ticks, ledger R$ 800 e zero órfão/hold/fixture | ADR-049/051; não chamou Asaas/Meta |
| Entrega do restante 1.6c | unit/integration/contract, `smoke:c14` 9/9, 2.816 testes, migration 0090 | ADR-011 + [ADR-020](adr/020-messaging-provider-patterns.md): mesma C14/Meta, lookup no send-time, sem LLM |

### Plano de fechamento — pendências, execução e teste de aceite

Esta é a **fila única** para terminar 1.H e 1.S. Um item só muda para verde com a evidência indicada;
mock, deploy bem-sucedido ou leitura de código não substituem comportamento externo quando ele é o
objeto do teste.

| Ordem | Pendência / autoridade | Como deve ser feita | Teste/evidência ainda pendente | Referência |
| --- | --- | --- | --- | --- |
| P0 | ✅ **Publicar/observar o lote** — repetido em 29/08 | Commit executável `8bf193e` confirmado no remoto e deployment Vercel terminal `success`, casado ao mesmo SHA. O Preview read-only foi reexecutado com uma única sessão e passou 8/8 em 1,8 min; 25 rotas estáticas responderam 200, rotas dinâmicas e navegação permaneceram íntegras, e o auth state/artefatos gerados foram removidos. `financeiro.md` permaneceu fora do commit | **PASS:** Git remoto, Vercel e smoke Preview observados no HEAD com P8/D61; repetir somente após novo lote executável | §0.3 DoD; [handoff](handoff-qorov2.md); D56; D61 |
| P1 | ✅ **Meta real entregou sinal e restante** | Em 31/08 a Clínica A estava ativa/verificada no banco DEV/Preview. O runner controlado criou Checkouts reais, publicou os eventos próprios, gerou `deposit_link` e `remainder_link`, resolveu os links no send-time e recebeu `accepted` + `providerMessageId` para dois templates distintos. Replay encontrou zero jobs e o cleanup local/provider foi confirmado. Em 02/09 o operador confirmou que ambas as mensagens chegaram ao aparelho com os links | **PASS:** aplicação → C14 → Meta → aparelho, templates distintos, jobs terminais e at-most-once. Os links estavam expirados quando abertos porque o runner já havia cancelado os Checkouts no cleanup; isso é esperado e não prova pagamento pelo link | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.6; [ADR-011](adr/011-outbox-audit-idempotency-patterns.md); [ADR-020](adr/020-messaging-provider-patterns.md); [runbook C14](runbooks/c14-validation.md); D63/D64 |
| P2 | ✅ **Webhook global e round-trip de restauração provados na conta alvo** | Em 02/09, após autorização explícita, o runner verificou por fingerprint que a credencial global e a fixture D50 pertencem à mesma conta Sandbox alvo; criou `qoro dev` na rota global do Preview, com token/bypass, API v3, sete eventos e `NON_SEQUENTIALLY`. A mesma cobrança sintética percorreu `open → cancelled → open` por eventos reais `PAYMENT_DELETED` e `PAYMENT_RESTORED` | **PASS:** readback do webhook, entrega provider→Preview, duas linhas de dedup, replay sem nova transição e cleanup exato no provider+banco. Pós-check confirmou coexistência com o webhook tenant de 12 eventos/`SEQUENTIALLY`. O mesmo Sandbox em dois papéis continua concessão exclusiva de teste | [runbook de assinatura](runbooks/asaas-webhook-assinatura.md); D20, D36, D46, D54, D55, D65, D66; §20.5 |
| P3 | ✅ **Rotação da chave sandbox não será executada** — decisão final do fundador em 03/09 | A credencial é exclusiva do Sandbox e o fundador aceitou conscientemente o risco residual. Isso deixa de ser pendência da Camada 1; o valor continua proibido em código, diff, log e documentação. Reabrir somente se a conta deixar de ser descartável, for compartilhada, promovida ou usada como evidência de longa duração | **DECISÃO ENCERRADA, não é teste nem bloqueio.** Continuam obrigatórios fingerprint da conta e separação absoluta de produção | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.1; [runbook da conta](runbooks/payment-account-connect.md) |
| P4 | **D24 — somente PIX/cartão no sinal e restante** — código + DEV/PROD ✅; pagamento externo ✅; estorno PIX assíncrono revelou D77 | Checkout `DETACHED` usa somente `PIX` + `CREDIT_CARD`. O PIX histórico da conta anterior continua `NOT COMPLETED`, sem reintroduzir credenciais. Em 04/09 uma prova isolada na conta atual confirmou cobrança `PIX` de R$ 10 em `RECEIVED`. O único refund foi aceito, aguardou ação crítica e terminou `CANCELLED`; o pagamento continua recebido e o saldo era suficiente | **PASS:** criação/pagamento PIX. **FAIL externo:** nenhum valor foi devolvido; não repetir POST sem nova autorização. O risco crítico D77 está corrigido em código/DEV pelo P11, mas a proteção só entra em produção após migration 0094, publicação e revalidação | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a/D24; [estornos Asaas](https://docs.asaas.com/docs/estornos); D57/D58/D76/D77; §20.1 |
| P5 | ✅ **D27 — jornada tenant completa e fixture removida** | Em 01/09 a fixture real de restante de R$ 10 foi paga por cartão na conta alvo. Depois do suporte disparar o chargeback, o provider terminou `REFUNDED/DONE`, a rota tenant marcou a `patient_charge` `refunded/lost` e publicou `requested`, `in_dispute`, `lost`. Em 02/09 o runner vinculou a fixture a um fingerprint da conta e executou somente esses handlers | **PASS:** identidade/proveniência, Asaas → Preview, dedup, Payments, compensação ligada à baixa, `chargeback_loss`, saldo reaberto, fato clínico preservado e replay 0/3. O cleanup autorizado validou as contagens, removeu 16 linhas sintéticas em uma transação, não chamou o provider, preservou o audit de webhook e terminou sem resíduo da fixture | [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md); ADR-011; [eventos Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas); D62, D68; §20.2 |
| P6 | **D50 — estorno parcial enviado; provider ainda `PENDING`** | Em 01/09 o Checkout de R$ 20 foi pago por cartão e o webhook tenant marcou a charge `paid`. O Financial alocou somente R$ 10 ao saldo e publicou o excedente. Uma única intenção, baseline zero, executou um único POST parcial de R$ 10. Readback independente em **06/09** confirmou pagamento `CONFIRMED`, `patient_charge=paid`, recebível `pago` em R$ 20, duas baixas somando R$ 20, uma intenção `confirmation_pending` de R$ 10, baseline zero e um único refund `PENDING` de R$ 10; D80 foi consultada separadamente e é a fixture `CANCELLED` | **PASS:** pagamento, webhook, correlação, valor exato, persist-before-POST, ausência de duplicata, fingerprint e separação entre contas/fixtures. **Pendente exclusivamente no provider/suporte:** aguardar o refund existente; nunca repetir POST. Quando virar `DONE`, fazer readback → ledger → replay → cleanup. D72 está publicado e distingue esses estados no Caixa; isso não confirma a devolução enquanto o provider permanecer `PENDING` | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1; [estornos Asaas](https://docs.asaas.com/docs/estornos); D50/D72; §20.3 e §20.9 |
| P7 | ✅ **Detector de crédito `available` órfão** — `ca94839` | O reconcile existente faz scan cross-tenant somente leitura: 30+ dias e consulta já vencida/vínculo ausente; agrega por clínica/status, emite `financial.reconcile.orphan_credit_detected` e inclui contagens no heartbeat. Não libera, retém, aloca ou estorna dinheiro | Unit 3/3 + DEV 13/13: terminal cancelado/faltou, agenda vencida, consulta futura excluída, replay idêntico, dois tenants e cleanup zero. Ao alertar, suporte investiga pelo runbook; destino econômico continua exigindo regra aprovada | [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §5; [runbook](runbooks/payment-account-connect.md) |
| P8 | ✅ **Carga e restore em volume** | Restore real e carga usam PostgreSQL 17 local descartável. `test:load` extrai somente o schema DEV, sobe app real no scratch TLS, substitui Meta antes da rede, bloqueia demais HTTP externos e exige confirmação/guards fail-closed. Nenhuma escrita foi feita em DEV, Preview ou produção | **PASS:** restore 117 tabelas/83 policies e zero resíduo; carga 500 consultas, 5.000 jobs C14, 1.000 webhooks, outbox 5.000, reconcile 20 chamadas e 100 queries. Todos os SLOs verdes, zero deadlock/duplicata/retry/falha e cleanup integral | §10 Performance; §16 Migração; `test:load`; `restore:test`; D61; R10 em [riscos](architecture/risks.md) |
| P9 | ✅ **Product Acceptance técnico-normativo publicado e revalidado** — D53/D56/D60/D70/D71 | Em 04/09 o agente cruzou o fluxo real do Qoro com CFM/ANPD e executou 150 testes focados de Agenda, prontuário, autorização, isolamento, templates e pagamentos. A auditoria encontrou D60 recorrente e D70; ambos foram corrigidos e publicados em `42cd114`. O deployment terminou `success`, a navegação Preview passou 6/6 e a matriz pós-deploy passou 8/8/72 estados esperando headings reais e capturando `pageerror`. Auth state e capturas foram removidos. Teste humano de usabilidade deixa de ser encenado pelo fundador e passa a ser observação da clínica piloto | **PASS técnico-normativo:** código, suíte integral, build/gates e Preview verdes. Manter monitoramento passivo do Sentry. A validação humana de percepção não bloqueia iniciar 1.S; bloqueia avançar da clínica piloto para ondas seguintes se revelar problema alto/médio | §0.2; §15; CFM/ANPD; [ADR-049](adr/049-pagamentos-paciente-sinal.md) §7; D53/D56/D60/D70/D71; [guia E2E](../e2e/README.md) |
| P10 | ✅ **1.S concluída** — D73/D74/D75 | D73 encerra observavelmente eventos preservados cujo tenant já não existe, sem violar o audit do outbox; D74 substitui o contrato obsoleto de recuperação `/payments` pela contenção real de `POST /checkouts` indeterminado; D75 impede que harnesses globais confundam audit órfão com concorrência ativa. C14 9/9, Financial 10/10, jornada 13/13, contenção POST e simulação 30 dias passaram com cleanup zero. ADR-049/050/051, Discovery e runbooks foram reconciliados | **PASS completo:** lint, typecheck, 2.816/2.816 testes em 311 arquivos, build, 0 ciclos, db-check, grafos, migrations, registry, observabilidade, diff, formatação e varredura do conteúdo adicionado. O commit executável `4883372` foi confirmado no remoto, teve deployment Vercel `CZJqTEXXeMoKYa9zwTfxBDGDGpwr` terminal `success` e smoke Preview autenticado 6/6 sem `pageerror`; auth state/artefato removidos. D50 continua dependência externa `PENDING`, sem novo POST | §0.3 DoD; §18 Rollout; ADR-049 §9; D73–D75 |
| P11 | 🟡 **D77 — CANCELLED PASS; DONE BLOCKED** | `deposit_closeout` reutiliza `patient_refund_intents`: persiste antes do POST, grava baseline+contadores no claim atômico, não repete resposta incerta, trata `PENDING`/em progresso como não terminal e `CANCELLED` como falha. Só `DONE` ou pagamento `REFUNDED` confirma; intenção, `patient_charge.closed` e `patient_credit.released` fecham na mesma transação. D79 corrige a correlação pelo baseline quando o id salvo não encontra refund | **PASS código/DEV/PROD/Preview + CANCELLED externo:** 0094/pós-check 9/9, money smoke 7/7 e rollout P11 verdes. D79 está em `0181939`: 2.977/2.977, deployment `success` e Preview 6/6. Duas provas pós-rollout terminaram `CANCELLED → failed/paid/available`, cada uma com um único refund, replay sem duplicata e cleanup. Na última, operador e POST foram sincronizados; D80 exige suporte antes de nova tentativa. D50 segue `PENDING` | [ADR-049](adr/049-pagamentos-paciente-sinal.md) §1.5a; [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md) §2.1; D76–D80; migration 0094 |

### Testes explicitamente não verdes / não executados

| Teste | Estado atual | Para ficar verde |
| --- | --- | --- |
| Playwright read-only | ✅ **PASS Preview `f2c1b60`: smoke canônico 6/6 + auditoria autenticada ampla 2/2** | 26 rotas estáticas responderam 200, rota dinâmica disponível renderizou, navegação principal não produziu `pageerror`; auth state e resultados removidos |
| `test:load` | ✅ **PASS local scratch-only em 29/08** | repetir após mudança relevante em C14, webhook, outbox/reconcile, schema ou SLO; exige build atual, PostgreSQL 17 local e confirmação exata |
| `pnpm restore:test` em volume | ✅ **PASS em scratch local descartável** | repetir somente quando houver novo dump/migration relevante; o alvo de 28/08 foi parado e removido |
| Checkout Asaas PIX + cartão (D24) | **PASS pagamento real; D77 `CANCELLED` PASS / `DONE` BLOCKED** | A fixture anterior terminou `CANCELLED` e revelou D77. Após o rollout, duas provas PIX isoladas liquidaram e geraram exatamente um refund cada; os replays não duplicaram, cobrança/crédito permaneceram abertos ao terminar `CANCELLED` e o cleanup local passou. D80 bloqueia nova fixture até diagnóstico do Asaas |
| `smoke:payments-money-db` (D50/D27/D77) | ✅ **PASS DEV 7/7; PROD 0094 verificada 9/9** | P11 repetiu estrutura/RLS, concorrência, `CANCELLED`, `DONE` atômico/replay, D50, disputa e perda com cleanup zero; produção confirmou schema version/journal, colunas, constraints, RLS/FORCE, grants, dados e lock |
| E2E Meta `deposit_link` | ✅ **PASS até o aparelho** | Checkout real, `link_ready`, job, lookup, template de sinal, provider message id e replay 0 foram provados; o operador confirmou a mensagem e o link no aparelho. O link expirou após o cleanup intencional |
| E2E Meta `remainder_link` | ✅ **PASS até o aparelho** | mesmo encadeamento real com template distinto de restante e cobrança pagável no send-time; o operador confirmou a mensagem e o link no aparelho. O link expirou após o cleanup intencional |
| `PAYMENT_RESTORED` da assinatura | ✅ **PASS externo na conta alvo** | `qoro dev` foi criado com os sete eventos canônicos; a mesma cobrança passou por delete/restore, a mesma invoice por `open → cancelled → open`, replay não duplicou e o runner limpou provider+banco |
| Estorno real do sinal pago por PIX/cartão | **Cartão PASS; PIX D77 `CANCELLED` PASS / `DONE` BLOCKED** | duas provas pós-rollout criaram um refund cada, sem repetição no replay, e terminaram `CANCELLED` mantendo cobrança `paid` e crédito `available`; cleanup local passou. A segunda foi sincronizada com o operador. Não criar outra fixture antes do diagnóstico D80 |
| Product Acceptance por persona | **TÉCNICO-NORMATIVO PASS local + Preview; usabilidade humana DEFERRED para piloto** | D60/D70 publicados e revalidados; manter observação passiva do Sentry. Na onda 1 colher percepção real de dono/secretária/médico/paciente, sem pedir ao fundador que finja experiência clínica |
| `pnpm format:check` global | **FAIL na baseline (D9)** | PR exclusivamente mecânico; nenhuma mudança semântica; toda suíte depois |

POST indeterminado e banco lento estão verdes em E2E controlado com banco; Asaas indisponível,
Meta indisponível/backoff e estados obsoletos no send-time estão verdes na matriz focada. Transporte
real Asaas e entrega real Meta continuam separados desses E2E controlados.

### Backlog conhecido — não incorporar por acidente no fechamento de 1.H

| Item | Estado e execução correta |
| --- | --- |
| D2 — `arch:check` sem tsconfig | Abrir mudança isolada de tooling: adicionar `--ts-config tsconfig.json`, comparar o grafo antes/depois, atualizar CI/docs e exigir 0 ciclos. `arch:graphs` mitiga hoje, mas não fecha o discovery |
| D9 — 128 arquivos fora do Prettier | PR exclusivamente mecânico, separado de produto/pagamentos; formatar, revisar ausência de mudança semântica e rodar suíte/build/grafos completos |
| D23 — transferir sinal no reagendamento | Hoje o sistema estorna e recobra, o que evita duplicidade. Transferência exige vínculo A→B e decisão sobre janela/taxa; desenhar para 2.x em ADR próprio, sem reabrir 1.5a |
| D29 — autoridade de valor/vencimento da assinatura | Decidir Qoro ou Asaas como autoridade antes de qualquer handler de `PAYMENT_UPDATED`; acompanhar [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8) |
| D42 — assinatura da Clínica A não provisionada | Conta Asaas de paciente e assinatura SaaS são fluxos distintos. Provisionar pela saga/onboarding de Billing e validar `billing_customers` + `subscriptions`; não “corrigir” conectando outra chave de paciente |
| Track O — onboarding self-serve | **Auditoria de escopo feita em 01/09:** o runtime atual de convite/join não possui seleção, gate ou dashboard por especialidade; a bifurcação existia apenas no roadmap e foi removida. O produto permanece único, preservando especialidade somente como dado clínico/operacional. Antes de implementar O-1/O-2/O-3/O-4, ainda é obrigatório ADR/scope freeze próprio e gates `O.H`/`O.S`; não misturar onboarding em 1.H |
| Camadas 2–4 | Permanecem congeladas até `1.H ✅ + 1.S ✅`. A ordem continua: recibo → spike Memed → integração/template/recuperação → P2/P3, cada uma com `.H/.S` |

### Dependências externas — validação comportamental (atualizado em 2026-09-01)

| # | O quê | Estado |
| --- | --- | --- |
| E1 | Template `deposit_link` aprovado na Meta + `META_TEMPLATE_DEPOSIT_LINK_ID` | **PASS até o aparelho** — conexão ativa, destinatário consentido, template real, provider message id, job `sent`, replay zero e recebimento confirmado pelo operador |
| E2 | `PAYMENT_RESTORED` no webhook de **assinatura** (conta do Qoro) | **PASS externo em 02/09** — webhook global `qoro dev` configurado na conta alvo com sete eventos, delete/restore real, invoice reaberta por CAS, replay idempotente e cleanup provider+banco |
| E3 | `APP_BASE_URL` por ambiente na Vercel (Preview ≠ Production) | **PASS comportamental para o webhook de paciente** — webhook ativo na rota Preview; `0089` aplicada. Além do contrato e da validação RLS, uma cobrança criada pelo Qoro recebeu `PAYMENT_RECEIVED` real do sandbox, gravou dedup/crédito uma vez e projetou agenda `Confirmado` + `Sinal pago`. Isso não valida o webhook global de assinatura (E2) nem a entrega Meta (E1/E5) |
| E4 | Rotacionar a chave sandbox do Asaas que passou pelo chat | ✅ **ENCERRADO POR DECISÃO, SEM ROTAÇÃO** — em 03/09 o fundador decidiu não executar por se tratar de conta Sandbox descartável e aceitou o risco residual. Não é pendência nem bloqueio. Reabrir se a conta for compartilhada, deixar de ser descartável ou sustentar evidência de longa duração |
| E5 | Template `remainder_link` aprovado + `META_TEMPLATE_REMAINDER_LINK_ID` + destinatário controlado | **PASS até o aparelho** — pipeline real usou template próprio, lookup no send-time, provider message id, replay zero e recebimento confirmado pelo operador |

#### Ações exclusivamente manuais / decisões do fundador

| Ação | Por que não pode ser automatizada | Estado |
| --- | --- | --- |
| Indicar destinatário controlado para os templates Meta já aprovados | O telefone pertence à pessoa real e exige consentimento de cobrança | ✅ **FEITO em 31/08** — variável local presente, em E.164 e com consentimento confirmado pelo fundador; o valor não foi exposto. A conexão ativa do tenant continua sendo gate separado |
| Rotacionar a chave sandbox do Asaas exposta no chat | Revogação exige autoridade da conta; o código não deve escolher ou exibir a nova chave | ✅ **NÃO EXECUTAR POR DECISÃO DO FUNDADOR (E4)** — risco residual do Sandbox aceito em 03/09; reabrir somente nas condições registradas em P3 |
| Resolver o PIX da conta Sandbox anterior | A conta antiga exigia ação humana e depois deixou de ser a conta-alvo | **ENCERRADO COMO `NOT COMPLETED`:** o operador confirmou que nada foi estornado, removeu webhook/chaves e não localizou mais a cobrança. Não recuperar nem recolocar essa credencial. Se útil, criar amanhã uma fixture PIX nova na conta atual |
| Autorizar os estornos das provas PIX na conta Sandbox atual | A confirmação de ação crítica exige interação humana autenticada no painel do titular | **EXECUTADO, MAS O PROVIDER CANCELOU:** na primeira prova, o operador informou o código recebido no celular. Na prova pós-D79, o runner foi pausado antes do único POST com o operador já no painel; depois, o operador confirmou que a interface mostrou sucesso ao aceitar o código Sandbox. Mesmo assim, a API terminou `CANCELLED` e o saldo continuou subindo porque os PIX foram creditados sem refund `DONE`. Readback, replay e cleanup local passaram. Não repetir nem criar fixture antes do diagnóstico D80 |
| Alinhar o webhook global de assinatura no ambiente correto | O secret efetivo do runtime Preview só pode ser alterado por quem possui acesso ao projeto Vercel | ✅ **FEITO E PROVADO:** chave/token/Preview alinhados; `qoro dev` criado na conta alvo; readback, delete/restore, replay e cleanup passaram |
| Observar usabilidade por persona na clínica piloto | Julgamento de percepção exige secretária/médico/paciente reais; web, agente e Playwright não podem fabricar experiência vivida | **DEFERRED PARA A ONDA 1, não é ação manual agora nem bloqueio de 1.S.** O aceite técnico-normativo e sua prova pós-deploy foram executados pelo agente |
| Rotacionar novamente a senha do banco de produção e atualizar todos os consumidores | A credencial usada na migration foi rotacionada corretamente, mas a sucessora foi publicada no chat antes da verificação; continuar com ela seria risco crítico | ✅ **CONFIRMADO PELO FUNDADOR**; a credencial exposta não foi usada, o DPAPI foi removido sem leitura e o env atualizado foi usado somente em transação read-only |
| Verificação read-only de `0091` + `0092` em produção | Era necessário provar o estado posterior sem inferi-lo do `DONE` | ✅ **7/7** — versions/journal, enums, tabelas/colunas, FORCE RLS/policies, grants, índices/constraints e advisory lock liberado |

**Evidência atual válida:** `payments:live-check` real contra Sandbox; identidade sanitizada por
`GET /myAccount`; contrato do webhook tenant e probes do Preview; consultas tenant-scoped da Clínica A.
As evidências anteriores de recurso global, `404`, reativação e retry pertencem à conta Sandbox antiga
e não validam a conta alvo. Em 01/09, a credencial global atual, a chave sandbox da clínica e a chave
tenant persistida convergiram; no momento da notificação, o Checkout D50 ainda não tinha sido pago. Logo, a nova notificação da
conta antiga não foi produzida pela execução local atual e só pode ser saneada pelo titular daquela
conta, removendo o recurso legado e suas reentregas.

**Auditoria corretiva read-only de 01/09:** a comparação de identidade foi repetida com o e-mail alvo
explícito, sem divulgá-lo no log. As três credenciais retornaram `TARGET`. Tanto a credencial global
quanto a tenant listaram exatamente o mesmo e único recurso: `Qoro — cobranca de paciente`, rota tenant
do Preview, 12 eventos, `enabled=true`, `interrupted=false`, API v3, `SEQUENTIALLY` e bypass presente.
Isso contradiz o texto “sincronização pausada há 7 dias” visto pelo operador; a API prova o estado atual
do recurso, enquanto os detalhes de tentativas/HTTP estão disponíveis somente em **Integrações → Logs de
Webhooks**. A chegada dos eventos D62 ao banco prova entrega recente, mas não substitui a leitura do log
específico exibido na UI. Até comparar nome, endpoint, horário e HTTP desse item, o texto do painel fica
registrado como divergência operacional, não como webhook comprovadamente pausado.

O histórico anterior de `invalid_object`, inclusão de `apiVersion: 3`, upsert por URL, D47/D48 e
migration `0089` permanece válido como origem das correções do webhook de paciente. Ele não deve ser
usado para inferir qual conta recebe hoje um evento: para isso valem somente a identidade read-only e o
contrato atual descritos acima. E3 está verde para a rota tenant; E2 continua pendente para o recurso
global da conta alvo.

### Discoveries que ainda governam decisões

| # | Assunto | Estado |
| --- | --- | --- |
| D2 | `arch:check` roda sem `--ts-config` (enxerga menos arestas que o real) | aberto — `arch:graphs` cobre com tsConfig |
| D9 | `format:check` vermelho na baseline (128 arquivos) | aberto — PR de formatação isolado |
| D13 | RLS cross-tenant de `clinic_payment_accounts` sem teste (exige banco) | **resolvido no 1.H** — `pnpm smoke:payments-rls` ✅ 5/5 no banco DEV, fixtures removidas e resíduo 0 |
| D19 | Bloqueio da 1.5b | **encaminhado** → ADR-051 |
| D24 | Estorno só funciona para PIX/cartão; boleto não compensa dentro do hold de 24h | **resolvido em código/DEV/PROD e provado externamente em 30/08** — Checkout restringe os métodos, e a falta de idempotência do provider é contida por intenção/lease local antes do POST. Migration 0091, smoke DEV 5/5 e pós-verificação PROD 7/7 verdes; pagamentos reais PIX/cartão correlacionados. Cartão terminou `REFUNDED`; o PIX da conta antiga não foi estornado e foi encerrado como `NOT COMPLETED`, sem reintroduzir a credencial |
| D23 | Reagendamento devolve o sinal (não transfere) — brecha: remarcar em cima da hora escapa da taxa | encaminhado — decisão de produto/ADR próprio em 2.x; hoje estornar+recobrar evita duplicidade |
| D27 | `PAYMENT_CHARGEBACK_REQUESTED` e `PAYMENT_RECEIVED_IN_CASH_UNDONE` sem tratamento | **resolvido em código/banco e provado provider → webhook tenant → Payments → Financial em 02/09** — a fixture D62 terminou `REFUNDED/DONE` e `refunded/lost`; `requested`, `in_dispute`, `lost` foram processados uma vez. O ledger ganhou uma única compensação ligada à baixa e uma `chargeback_loss`, o saldo foi reaberto, o atendimento permaneceu `atendido` e o replay processou zero. Cleanup autorizado removeu 16 linhas sintéticas sem mutar o provider e deixou zero resíduo da fixture |
| D29 | Ninguém tem autoridade declarada sobre valor/vencimento de cobrança de assinatura | backlog — [issue #8](https://github.com/joaomarcos-techia/Project_OS/issues/8). **Não implementar sync de `amount`/`dueDate` sem decidir A ou B: fazer isso é escolher B por omissão** |
| D30 | Config do webhook de assinatura só existia no painel | mitigado — [runbook](runbooks/asaas-webhook-assinatura.md) é a cópia versionada |
| D31 | Mapa `job type → suppression purpose` estava duplicado | **resolvido** — `suppressionPurposeFor` é fonte única. `deposit_link` → `reminder`. **Não duplicar de novo** |
| D32 | **Regra de processo:** sub-fase verde não prova jornada verde | vigente — ver abaixo |
| D33 | `appointment-completed.ts` (cria TODO recebível do Caixa) não tinha nenhum teste | **resolvido no 1.H** — além dos 13 testes originais, a varredura confirmou teste direto em todos os 13 handlers de Payments/Financial/Scheduling/Billing; os 5 gaps receberam 16 testes focados |
| D34 | ADR-051 D6 mandava o Payments calcular o saldo; pagamento em dinheiro na recepção não apareceria | **resolvido** — saldo vem do `financial`; sub-fase dividida em 3a/3b para caber no §0.6 |
| D35 | O link do **restante** era criado e não entregue; a copy do sinal não serve depois do atendimento | **resolvido integralmente em 02/09 (1.6c)** — `remainder_link` usou fila C14, lookup no send-time e template próprio; Meta retornou `accepted`/message id, replay zero e o operador confirmou a chegada ao aparelho (E5) |
| D36 | Webhook sandbox de assinatura precisa entregar `PAYMENT_RESTORED` no ambiente controlado | **resolvido externamente em 02/09** — `qoro dev` foi criado na conta alvo com sete eventos e `NON_SEQUENTIALLY`; delete/restore real fez a mesma invoice `open → cancelled → open`, com replay e cleanup verdes (D66) |
| D37 | Bypass da proteção do Preview | **resolvido na borda** — probe real: sem bypass, `302 /sso-api`; com bypass, `405` da rota do Qoro (o teste usou `GET` de propósito em endpoint somente `POST`). Isso não prova que a variável recém-adicionada já esteja disponível ao processo do deploy atual |
| D38 | Evento penalizado veio da conta sandbox de clínica | **bloqueante externo** — `ASAAS_CLINIC_SANDBOX_KEY` encontra o webhook; ele não prova assinatura e não pode usar a rota global |
| D39 | Reativação via API não corrige causa-raiz | **vigente** — `PUT interrupted=false` funciona, mas a fila voltou a interromper no retry; corrigir rota/token antes de reativar novamente |
| D40 | Preview está atrás do código local | **resolvido** — remoto `b0074e3` contém `/configuracoes/pagamentos` e `/api/webhooks/asaas/patient/<ref>`; a UI já persistiu a conta da Clínica A |
| D41 | Auto-registro de paciente não carregava bypass | **resolvido em código** — Preview anexa o segredo server-to-server; ausência falha antes do POST; Production nunca recebe o query param. O erro posterior já alcançava a API do Asaas e tinha outra causa, fechada em **D44** |
| D49 | Restante pago virava crédito, mas não baixava o recebível já existente | **resolvido no 1.H** — aplicação atômica limitada ao saldo atualiza `valor_pago`, ledger e evento; unitários e E2E banco+worker 7/7 verdes |
| D50 | Baixa manual pode tornar um link do restante maior que o saldo atual | **resolvido em código/banco; prova externa chegou ao provider** — pagamento/webhook reais, R$ 10 alocados e um único estorno parcial de R$ 10 solicitado com baseline zero. O saldo Sandbox já está suficiente, mas o refund continua `PENDING`; a hipótese de “Ações críticas” foi retirada. Solicitar diagnóstico ao suporte e depois observar confirmação → ledger → replay → cleanup, sem repetir POST |
| D51 | Atendimento totalmente coberto por créditos falhava ao criar o recebível `pago` sem `paid_at` | **resolvido no 1.H** — handler grava `paid_at` atomicamente quando o status inicial é `pago`; unitário 13/13 e simulação real de 30 dias verdes |
| D52 | ADR-051 §5 exige tratar crédito `available` órfão; a simulação terminou sem órfãos, mas não provava estados envelhecidos fora do cenário modelado | **resolvido como detector em `ca94839`** — `financial-reconcile` observa 30d + consulta vencida, agrega terminal/agenda ativa/vínculo ausente e alerta sem mover dinheiro. Route 3/3 + jornada DEV 13/13; operação no runbook |
| D53 | Snapshot de falha do Playwright podia reter a senha digitada porque o formulário mantinha o campo preenchido durante/depois da tentativa de login | **corrigido em código; proteção verificada** — artefatos locais e auth storage foram eliminados; o formulário limpa a senha no tick seguinte à captura e após erro. A credencial atual foi aceita pelo Supabase sem ser impressa. As novas execuções permaneceram sem artefatos autenticados retidos |
| D54 | `PAYMENT_RESTORED` não reabria a invoice apesar do runbook exigir isso | **resolvido em código e provado no Sandbox alvo** — a máquina genérica mantém `cancelled` terminal; o sincronizador reabre somente quando `getPayment` confirma a mesma cobrança viva/pagável, por CAS, timeline e métrica. A prova real reabriu a mesma invoice e o replay não duplicou |
| D55 | Webhook global ignorava o contrato real `GET 200 + deleted:true` já descoberto no D20 | **resolvido em código e provado no Sandbox alvo** — pagamento deletado não é materializado nem guiado pelo status antigo; a rota localizou a invoice, aplicou `{ exists:false }`, recebeu restore e concluiu o round-trip real com cleanup |
| D56 | Os specs read-only tratavam `/configuracoes` como tela e esperavam “Sugestões” na primeira categoria, mas a rota é um redirect e o link pertence à categoria Produto | **resolvido nos contratos E2E em 28/08** — o inventário usa `/configuracoes/agenda`; a jornada aceita o heading da primeira categoria, entra explicitamente em Produto e só então abre Sugestões. Preview read-only 8/8 com sessão única e regressão local 2.717/2.717; nenhuma mudança de produto |
| D57 | Checkout Asaas restringe PIX/cartão, mas não preserva a idempotência atual de criação | **resolvido em código/DEV/PROD e provado externamente em 30/08.** Intenção + lease local antecedem o POST, timeout não repete criação e `checkoutSession` correlaciona o payment autoritativo no webhook. O runner correlacionou pagamentos reais PIX/cartão após o único passo humano do reCAPTCHA e agora exige readback terminal do cleanup |
| D58 | Checkout expira em no máximo 24h, mas o restante atual promete 7 dias | **resolvido em código/DEV/PROD em 29/08.** Gerações idempotentes de até 24h preservam 7 dias sobre a mesma `patient_charge`; somente a atual fornece link e a renovação publica `link_ready` controlado. Unit, migration 0091 DEV+PROD, smoke 5/5 e pós-verificação 7/7 verdes |
| D59 | Rotação da senha de produção deixou Functions antigas autenticando com a credencial revogada | **recuperado em 29/08** — Sentry registrou falhas nos quatro crons às 11:30–11:31 BRT; após atualizar o env e redeployar, health estrito respondeu 200/tudo `ok` e heartbeats read-only provaram `success` dos quatro jobs às 11:45–11:46. Não foi falha das queries nem dos smokes locais |
| D60 | Preview registrou `Rendered more hooks than during the previous render` ao navegar pelo redirect de `/configuracoes`, com recorrência reportada em 04/09 | **resolvido, publicado e revalidado** — nenhum hook condicional foi encontrado e o stack `Router/useMemo` coincide com o bug oficial Next.js #78396 corrigido no upstream pelo React sync #95368. O shell deriva pela permissão e liga diretamente à primeira categoria, sem passar pela página que apenas redireciona. O deployment `42cd114` terminou `success`; Preview 6/6 na navegação e 8/8/72 na matriz visual, sem `pageerror`. Manter observação passiva do Sentry, sem misturar ao Financial |
| D61 | Candidatos de reminder de SQL cru podiam entregar `scheduled_at` como string PostgreSQL em vez de `Date`, fazendo o job falhar como `invalid_payload` somente no runtime real | **resolvido no P8 em 29/08** — a fronteira `listReminderCandidates` aceita `Date|string`, valida e sempre publica ISO UTC; valor inválido falha alto. Regressão direta 3/3, C14 real 5.000/5.000 no scratch e suíte 2.797/2.797 verdes |
| D62 | Fixture de chargeback global não provava a jornada tenant | **RESOLVIDO E LIMPO em 02/09, sem mocks** — a cobrança `remainder` tenant-scoped da Clínica A pagou, foi alocada, recebeu chargeback e terminou `REFUNDED/DONE` + `refunded/lost`. Os três fatos monotônicos atravessaram os handlers financeiros reais; a perda reabriu o saldo com ledger append-only, sem alterar o fato clínico. Replay 0/3. O cleanup revalidou a evidência e a conta, removeu 16 linhas da fixture em transação, preservou os eventos de webhook e não chamou o provider |
| D63 | Checkout hospedado rejeita `customer` de paciente sem endereço completo | **resolvido em 31/08** — probe sandbox isolou o contrato: com customer nome/CPF, HTTP 400 pediu endereço/número/CEP/bairro/cidade; sem `customer`/`customerData`, Checkout `ACTIVE`. Sinal, restante e renovação agora deixam o pagador preencher a página hospedada, preservam o gate local de CPF e não enviam PII no POST. 92 testes focados + suíte 2.812/2.812; [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md) emendada |
| D64 | Health local da conexão Meta pode usar credenciais de app diferentes das que emitiram o token tenant | **descoberto em 31/08; não bloqueia envio** — `debug_token` local falhou por app mismatch, mas Graph confirmou telefone `CONNECTED` e uma subscribed app; o E2E real recebeu dois `accepted`. Alinhar app id/secret por ambiente para o health não produzir falso negativo, sem trocar o token tenant |
| D65 | Probe vazio do webhook global provava token, mas não que o runtime Preview consultava a mesma conta Asaas do webhook | **RESOLVIDO em 01/09** — aliases `_DEV` efetivos foram copiados para os nomes canônicos do Preview. O runner atravessou `getPayment`, persistiu a invoice `open` e só então avançou ao DELETE real; provider e DEV foram limpos |
| D66 | Asaas aceitou DELETE na conta Sandbox anterior, mas não houve `PAYMENT_DELETED` observável | **RESOLVIDO NA CONTA ALVO em 02/09** — a evidência antiga continuou invalidada; o novo runner verificou fingerprint, criou `qoro dev` com contrato exato e recebeu `PAYMENT_DELETED` + `PAYMENT_RESTORED`. A invoice foi cancelada/reaberta, replay não duplicou e a fixture foi removida |
| D67 | Webhook de paciente existente não convergiu após a ampliação do contrato D27/D50 | **RESOLVIDO em 01/09** — reparação guardada confirmou conta, `webhook_ref`, host/rota e estado; atualizou `Qoro — cobranca de paciente` para os 12 eventos canônicos, `SEQUENTIALLY`, ativo/não interrompido. O recurso global `qoro dev` foi removido naquele momento por autorização, mas a correção posterior da conta global mostrou que ele deverá ser recriado separadamente para Billing |
| D68 | Estado do webhook foi inferido da identidade da conta e o histórico misturava duas contas | **CORRIGIDO em 02/09** — a auditoria da conta alvo confirmou exatamente um webhook tenant, 12 eventos, `enabled=true`, `interrupted=false`, além da entrega D62. PIX/alertas/401 pertenciam à conta antiga e nunca foram somados ao aceite. O operador confirmou que o PIX antigo não foi estornado e removeu webhook e chaves API dessa conta. Os manifests v2 agora guardam fingerprint não reversível da conta e os runners abortam se a identidade divergir |
| D69 | O verificador amplo encontrou linhas órfãs de round-trip anteriores | ✅ **RESOLVIDO E LIMPO EM DEV em 03/09** — autorização separada recebida. O dry-run confirmou exatamente 4 `checkout_sessions` + 4 `tenant_provisioning`, ambas sem `clinic_id`, zero clínica ativa e somente a FK esperada. Após backup local ignorado pelo Git, a exclusão ocorreu sob advisory lock e transação; foram removidas exatamente 4 + 4 linhas. O pós-check e o verificador amplo retornaram `historicalRoundtripRows=0` e `billingRoundtripActiveFixtures=0` |
| D78 | Conta externa recebe `Recurso indisponível` no OAuth do Embedded Signup; o fallback local pressupõe `/me/businesses`, mas a configuração emite token de usuário do sistema | **CÓDIGO CORRIGIDO em 05/09; BLOQUEADO NA META** — menor privilégio: `waba_id` do evento obrigatório, conferido contra a allowlist do próprio token (`debug_token → granular_scopes.target_ids`) e contra `/{waba-id}/phone_numbers`; `/me/businesses` removido e `business_management` **não** exigida no runtime. Telefone nunca é escolhido por posição. Classificação de falha do Graph agora vive dentro do `graphFetch` e vale em **todas** as etapas do connect: negativa documentada preserva a etapa funcional, rate limit vira `provider_rate_limited`, indeterminação em `GET` vira `provider_unavailable` e em `POST`/`DELETE` vira `provider_outcome_unknown` — sem prometer "nada foi alterado" nem repetir mutação às cegas. Embedded Signup é **single-flight** (o `postMessage` não é correlacionável) e o deadlock da fase `closing` foi corrigido: o abandono de 10 min cobre `running` e `closing`, destravando sem substituir o desfecho. Gates locais verdes (199/199 focados · revalidação integrada 323/323 · suíte 2.975/2.975). Falta o externo: Advanced Access de `public_profile` e verificação separada de Verificação da Empresa/Data Use Checkup no painel, mais reteste com conta sem App Role — `NOT TESTED`. Contexto: [handoff D78](handoff-meta-embedded-signup.md) |
| D42 | Clínica A não possui assinatura provisionada | **confirmado em dev** — não há linha em `billing_customers` nem em `subscriptions`. Conectar a conta Asaas que recebe pagamentos de pacientes não provisiona a assinatura que a clínica paga ao Qoro; são contextos e donos do dinheiro distintos |
| D43 | Falha do auto-registro virava apenas `webhookConfigured=false` | **resolvido em código** — a nova tentativa devolve etapa, motivo e código seguros para a tela e para `payments.webhook.configure_failed`: configuração do Qoro, conta Asaas, banco/cripto, comunicação ou `POST /webhooks` recusado com HTTP/códigos sanitizados. Reenviar a mesma chave já configurada não cria webhook duplicado |
| D44 | `POST /webhooks` devolvia `HTTP 400 invalid_object` | **resolvido em código e provado no sandbox** — o adapter omitia `apiVersion`, campo obrigatório do contrato v3 atual. O payload agora envia `apiVersion: 3`; teste de contrato cobre o JSON completo e `pnpm payments:live-check` aceitou e removeu o webhook sintético |
| D45 | Reconexão ainda repetia `POST /webhooks` para uma rota já cadastrada | **resolvido em código e provado com `assaasapi`** — reprodução controlada confirmou `HTTP 400 invalid_object` com “já existe uma configuração para os eventos com os mesmos atributos”. O adapter agora lista, identifica a mesma origem+rota sem depender da query de bypass e converge por `PUT`, inclusive sob corrida GET→POST. O live check criou e reconfigurou o mesmo ID sem duplicar |
| D46 | Token do webhook global diverge entre local e Preview | **resolvido operacionalmente em 31/08** — após alinhar o secret/redeployar, o `POST {}` autenticado atravessou a proteção e devolveu `400` de payload, não `401`. Readback Asaas: ativo, não interrompido, sete eventos, `NON_SEQUENTIALLY` e alias Preview. A prova de restore permanece D36 |
| D47 | `patient_webhook_events` era somente leitura para a role real do webhook | **resolvido e provado no Preview** — a `0086` dizia “service_role-only”, mas `markDepositPaid()` usa `withTenant`, que faz `SET LOCAL ROLE authenticated`. A `0089` adicionou somente `INSERT` + policy tenant-scoped e manteve `UPDATE`/`DELETE` revogados. Validação conectada com rollback passou; deploy `ed83c90` passou; E2E controlado devolveu `unknown_charge` e replay `ignored`, com dedup exatamente 1 e limpeza 0 resíduos. No E2E real, `PAYMENT_RECEIVED` gravou dedup e moveu a cobrança para `paid` sem erro de permissão |
| D48 | Webhook habilitado continuava sem entregar após os 401/500 anteriores | **resolvido operacionalmente no sandbox e causa comprovada** — `enabled=true` e `interrupted=false` não removem a penalização de entrega. `POST /webhooks/{id}/removeBackoff` devolveu 204; em seguida o Asaas entregou os eventos pendentes e a cobrança criada pelo Qoro foi conciliada. O webhook permanece apontando para o Preview, com bypass, token próprio e `PAYMENT_RECEIVED` habilitado |

### D32 — jornada, não componente

1.3, 1.4 e 1.5a fecharam **todas verdes** e o mecanismo não funcionava de ponta a ponta: nada
entregava o link ao paciente. Daqui para frente, ao fechar qualquer trecho da Camada 1, valide o
**encadeamento**, não só a peça:

```
agenda → política → charge → link_ready → fila → WhatsApp → paciente → pagamento → webhook → confirmação
```

Ramos de aceite, **em código**: **A (falta)** ✅ · **B (comparecimento)** ✅ *desde a 1.5b* ·
**C (cancelamento)** ✅

A jornada do ramo B, agora completa:

```
atendido → financial cria lançamento BRUTO (200) e aplica o crédito (100) → parcial, saldo 100
        → scan do restante pergunta o saldo AO FINANCIAL → cobra 100 → link_ready → WhatsApp
        → paciente paga → webhook → credit.granted → financial dá baixa → saldo 0, pago
```

> ⚠️ **O E2E real do caminho feliz do sinal foi executado em 26/08/2026, mas o aceite integral da
> Camada 1 continua parcial.** Evidência: agendamento de R$ 150,00 → cobrança única de R$ 75,00 →
> `Sinal pendente` → confirmação sandbox `RECEIVED_IN_CASH` → webhook real `PAYMENT_RECEIVED` →
> cobrança `paid` + crédito único `available` de R$ 75,00 → agenda `Confirmado` + `Sinal pago`.
> O trecho aplicação → Meta foi executado para sinal e restante, com templates distintos, aceite do
> provider, at-most-once, replay zero e cleanup; a chegada das duas mensagens ao aparelho foi
> confirmada pelo operador. Os ramos A/B/C e os cenários de concorrência também passaram no banco+worker; os itens
> ainda abertos estão na fila P1–P11 acima.

### Handoff

Para continuar em outra sessão, use **[docs/handoff-qorov2.md](handoff-qorov2.md)** — prompt
auto-suficiente com processo, restrições, o que falta na Camada 1 e as ondas seguintes.

Para tratar apenas o incidente de onboarding Meta D78, use o prompt
**[docs/handoff-meta-embedded-signup.md](handoff-meta-embedded-signup.md)**.

### Próximo passo

O rollout de **P11/D77** está concluído: 0094 em produção, SHA publicado, deployment observado e Preview
revalidado. A prova PIX tenant-scoped demonstrou `POST aceito → PENDING → CANCELLED`, exatamente um
refund, replay sem segundo POST, cobrança `paid`, crédito `available` e cleanup local exato. O achado
D79 de correlação foi corrigido, publicado em `0181939` e revalidado no Preview 6/6. Uma nova prova
com operador já posicionado no painel voltou a terminar `CANCELLED`, apesar da trava antes do único
POST; D80 está bloqueado no provedor. O próximo passo é abrir diagnóstico no suporte do Asaas com os
horários e estados sanitizados, sem criar outra fixture. Em paralelo, P6/D50 continua aguardando seu
refund anterior sair de `PENDING`; não repetir esse POST.

**1.H — Hardening.** Sem adicionar feature:
provar que a Camada 1 aguenta o mundo real.

Cenários a executar e **registrar aqui com o resultado real**:

| Grupo | Cenários |
| --- | --- |
| Concorrência | ✅ dois workers/cron concorrente · ✅ duplo webhook/pagamento · ✅ grant/alocação/liberação concorrentes · ✅ pagamento no instante em que o hold expira |
| Idempotência | ✅ webhook duplicado/replay · ✅ refund/close duplicado · ✅ lease/retry/link obsoleto em unit/integration · ✅ POST indeterminado contido com provedor local + banco · ✅ retry pós-timeout no E2E banco |
| Crédito (novo, 1.5b) | ✅ crédito duplicado · ✅ alocado duas vezes · ✅ liberado após alocação bloqueado · ✅ restante pago alocado (D49) · ✅ restante criado duas vezes no banco real |
| Multi-tenant | ✅ `clinic_payment_accounts` 5/5 · ✅ `patient_credits` no smoke 10/10 · ✅ `ref` forjada/token inválido em contrato · ✅ conciliação A→cobrança B no banco real |
| Ciclo de vida | ✅ cobrança paga/cancelada antes do send-time · ✅ job obsoleto · ✅ reagendamento/recovery · ✅ pagamento tardio; unit/integration + jornada DB |
| Externo | ✅ Asaas fora em contrato · ✅ Meta fora/retry em worker · ✅ banco lento controlado · ✅ troca/reenvio de credencial em contrato |
| Cobertura | **D33 ✅** — 13/13 handlers auditados possuem teste direto; 5 gaps receberam 16 testes de projeção financeira, metering e cancelamento por ciclo de vida |
| Produto | ✅ **E2E controlado dos três ramos + D52 com banco/worker 13/13** · ✅ POST indeterminado contido · ✅ simulação de 30 dias; transporte real Asaas e Meta permanecem evidências externas separadas |

Depois: **1.S**. A implementação da Camada 2 só começa com `1.H ✅ + 1.S ✅`; discovery/ADR
reversíveis podem antecipar dúvidas regulatórias sem alterar runtime ou contornar gates externos.

---

## 0. Método, restrições e gates

### 0.1 Ordem inviolável
Entender → projetar (ADR) → **congelar (ADR/Scope Freeze)** → implementar → testar → endurecer (.H) → estabilizar (.S) → observar → liberar. Nunca inverter.

### 0.2 Portão de aceite padrão — gates de PRIMEIRA CLASSE
Sub-fase só é "verde" com **todos**:
```
FUNCIONAL        lint · typecheck · test · build · test:e2e
ARQUITETURA      arch:check · arch:db-check · check:migrations · check:registry:strict
COMPLEXIDADE     arch:graphs --check verde: 0 ciclos + zero acoplamento novo não commitado (§11)
REGRESSÃO        baseline de testes verde (2295 em 24/08; o número sobe — o que vale é zero regressão) + Regression Matrix (§0.4)
ANTI-ESCOPO      nenhuma mudança fora do gap mapeado (§0.5)
SCOPE FREEZE     nenhum requisito novo incorporado na camada (§0.8)
BUDGET           ≤25 arquivos · ≤1500 linhas · ≤2 contexts, senão split (§0.6)
ARQ. PROTEGIDA   integra a outbox/RLS/audit/idempotência/flags/eventos/multitenancy (§0.7)
ADR FREEZE       arquitetura da camada = ADR aprovado; mudança exige ADR complementar (§0.9)
OBSERVABILIDADE  metrics.emit + check:observability + Sentry/Better Stack (§8)
SEGURANÇA        Security Gates (§9)
PERFORMANCE      SLOs (§10)
CHAOS            serviços externos (§12)
FINANCEIRO       Financial Integrity — fecha contábil (§13)
OPERAÇÃO REAL    Clinic Simulation 30 dias consistente (§14)
PRODUTO          Product Acceptance por persona (§15)
MIGRAÇÃO         vazio/populado/volume + up/down/up (§16)
DOCS VIVAS       ADR + docs + fluxograma + runbook (§17)
```

### 0.3 Definition of Done (global)
```
[ ] ADR criado/atualizado (+ ADR freeze)   [ ] Observabilidade (log+métrica+alerta+painel)
[ ] Impact + Regression Matrix             [ ] Security review
[ ] Anti-escopo + Scope freeze respeitados [ ] Performance (SLO)
[ ] Budget respeitado (senão split)        [ ] Chaos validado
[ ] Complexidade: 0 ciclos novos           [ ] Financial Integrity (fecha contábil)
[ ] Arquiteturas protegidas                [ ] Clinic Simulation 30d
[ ] Código atrás de feature flag           [ ] Product Acceptance por persona
[ ] Unit·Integration·Contract·Smoke·E2E    [ ] Migração (vazio/populado/volume, up/down/up)
[ ] Rollback + rollout progressivo         [ ] Docs vivas (ADR/docs/fluxo/runbook)
```

### 0.4 REGRA ABSOLUTA — Impact & Regression Matrix
Toda feature declara **quais domínios podem regredir** + teste específico por domínio. Modelo (sinal): Agenda/Financeiro/Billing/WhatsApp/IA/Relatórios.

### 0.5 ANTI-ESCOPO — proibido construir
Se não resolve um **gap mapeado**, **não se faz**. Proibido: refatorar sem necessidade direta · trocar arquitetura por preferência · reescrever módulo estável · nova dependência sem justificativa/ADR · abstração para problema inexistente · mexer em fluxo não impactado · mudar naming convention global · mudar design system sem ADR · mover arquivo por estética.
> **Toda linha alterada aponta para um gap. Sem gap → sem mudança.**

### 0.6 BUDGET DE MUDANÇA (menor PR possível)
Estimar antes: **arquivos · linhas · contexts**. Excedeu **qualquer** limite → **split**:
```
> 25 arquivos   ou   > 1500 linhas   ou   > 2 bounded contexts
```

### 0.7 ARQUITETURAS PROTEGIDAS (não remover, não contornar)
| Mecanismo | Onde vive | Regra |
|---|---|---|
| Outbox / Domain Events | `lib/outbox`, `schema/infra/outbox.ts` | cross-context via evento |
| RLS / Multi-tenancy | `lib/db/rls.ts`, `withTenant`, `tenantIdRef` | tudo tenant-scoped; `dbAdmin` só allowlist |
| Audit Trail | `lib/audit` | ações sensíveis auditadas |
| Idempotency | `lib/idempotency`, `external_reference` | handlers idempotentes |
| Feature Flags (global) | `platform_settings` (`lib/platform-settings`) | kill-switch de plataforma; allowlist de chaves; escrita só por super-admin auditada |
| Gate por clínica | **coluna booleana no schema do próprio domínio**, default `false` (ex.: `clinic_deposit_policy.enabled`) | feature nova nasce off por clínica |
> Burlar qualquer um exige **ADR próprio aprovado** — nunca como efeito colateral.
> **Não existe flag genérica por tenant** (D1, Camada -1). Criar uma exige ADR próprio, e só se justifica quando houver clínicas suficientes para rollout percentual significar algo. Até lá, o gate por clínica é a coluna do domínio.

### 0.8 SCOPE FREEZE + Discovery Log
Iniciada a camada, **nenhum requisito novo entra nela**. Todo achado vai para o **Discovery Log** (`docs/discovery-log.md`) e é movido para **próxima camada** ou **backlog**. Exceção única: **bug crítico · vulnerabilidade crítica · risco financeiro crítico** (entra com registro + mini-ADR).

### 0.9 ADR FREEZE
Após o ADR **aprovado**, a arquitetura da camada **não muda durante a implementação**. Mudança de arquitetura exige **ADR complementar** aprovado — não redesenho no meio do caminho.

### 0.10 Proibido concluir se
Código sem teste · migration sem validação em volume · endpoint sem teste · fluxo sem E2E · feature sem observabilidade · domínio afetado sem regressão · **mudança fora do anti-escopo/scope-freeze** · **budget estourado sem split** · **ciclo novo de dependência** · **arquitetura protegida burlada** · **integridade financeira não fecha** · warning · TODO sem justificativa · `.H` ou `.S` não executados.

---

## 1. Decisões travadas
Asaas · Modelo B (conta da clínica, BYO, cifrada, write-only) · **link sem token** · sinal 50% configurável (PIX/cartão, 1ª+retorno) · hold 24h · cancelamento ≥24h estorna · restante por link/presencial · trial admin 14d / self-serve 7d · preço fundador só admin · **produto único, sem módulos por especialidade**. Especialidade continua sendo dado clínico/operacional do profissional e da clínica, nunca gate comercial ou bifurcação do onboarding. Detalhe financeiro: [ADR-049](adr/049-pagamentos-paciente-sinal.md).

---

## 2. Sequência
```
CAMADA -1  Architecture Review (C4 + grafos + riscos + ADRs) ..... ✅ CONCLUÍDA
CAMADA 0   Baseline ...................................... ✅ CONCLUÍDA
CAMADA 1   1.0 adapter·1.1 credencial·[O-1]·1.2 política·1.3 charges+hold·
           1.4 webhook·1.5 falta/restante·1.6 UI·1.H hardening·1.S stabilization
CAMADA 2   P1 (recibo · [2.2.0 spike Memed] Memed · template · recuperação) · 2.H · 2.S
CAMADA 3   P2 (conselho genérico + O-2 + pacote/mensalidade) · 3.H · 3.S
CAMADA 4   P3 (backlog)
ADIADO     CRM/UTM/reativação · repasse
```
**Nenhuma camada libera a próxima sem `.H` E `.S` verdes.**

---

## 3. CAMADA -1 — Architecture Review
**Objetivo:** entender o sistema inteiro antes de tocar código (reforça anti-escopo §0.5).
**Mapear:** contexts (**12** — `feedback` é o 12º) · dependências · eventos · crons (15) · webhooks · integrações · RLS · flags · tabelas.
**Entregue em `docs/architecture/`** (padrão do repo; o rascunho dizia `/docs/arquitetura`):
- **[C4](architecture/c4.md)** (Mermaid, níveis 1–3) + inventário medido.
- **`dependency-graph.mmd`**, **`event-flow.mmd`**, **`context-map.mmd`**, **`arch-metrics.json`** — **gerados** por `pnpm arch:graphs`, versionados, com `--check` (modelo lockfile) para **diffar antes×depois**.
- **[Riscos](architecture/risks.md)** — 11 itens, incl. flag por clínica inexistente (R1) e `arch:check` sem tsconfig (R2).
- **ADRs necessários** listados em `risks.md`; achados adiados em [`discovery-log.md`](discovery-log.md).
**Resultado:** 52 elementos · 264 arestas · **0 ciclos** · 57 eventos (43 sem consumidor, allowlist `PRODUCER_AHEAD`). Nenhum refactor; zero mudança em `src/`.

---

## 4. CAMADA 0 — Baseline ✅
lint ✅ · typecheck ✅ · **1966 testes** ✅ · build ✅ @ `d414191`.

---

## 5. CAMADA 1 (P0) — Cobrança de paciente + sinal
Arquitetura no [ADR-049](adr/049-pagamentos-paciente-sinal.md). Testes **funcionais** por sub-fase; **gates transversais (§8–§17) valem para cada uma**.

- **1.0 Adapter:** ✅ **CONCLUÍDA (24/08)** — `src/lib/payments/asaas` + `createAsaasClient(credential)`; breaker por credencial; client do Qoro singleton com leitura tardia de env. Sem migração, zero comportamento novo. 11 call-sites repontados, +5 testes de fábrica, `onboarding` perdeu uma exceção `boundaries`. Gates: 257 arquivos / **2295 testes** ✅ · build ✅ · arch:check/db-check/graphs ✅ · registry/migrations/observability ✅.
- **1.1 Credencial:** ✅ **CONCLUÍDA (24/08)** — `clinic_payment_accounts` (migration **0081**), chave cifrada por tenant e **fora do grant de `authenticated`** (write-only pelo Postgres, não por convenção); context `payments`; painel `configuracoes/pagamentos` + entrada em Gestão; **validação no Asaas (`GET /myAccount`) ANTES de gravar** — Asaas fora do ar não grava; desconectar APAGA a chave; audit na mesma tx. **Auto-config do webhook MOVIDA para 1.4** (o endpoint só existe lá; registrar antes deixaria o webhook interrompido na conta do cliente). +28 testes.
- **1.2 Política:** ✅ **CONCLUÍDA (24/08)** — `clinic_deposit_policy` (migration **0082**), uma linha por clínica, `enabled` default `false` = **o gate por clínica do D1**. Regras em funções PURAS (`payments/policy.ts`): `resolveDepositAmount` devolve `null` em todo caso duvidoso (não cobrar é o modo de falha seguro) e `isRefundableCancellation` compara com a antecedência mínima. CHECKs impedem estado morto (percentual 1..100, janela 0..720h, ao menos um escopo quando ligada). Consent `politica_cancelamento` no enum (a UI de consentimentos NÃO o exibe — é aceite de fluxo, não toggle da ficha). Escrita pelo caminho tenant + RLS + audit com a política ANTERIOR. +25 testes. **Flag off = comportamento idêntico** (nada consome a política ainda).
- **1.3 Charges+hold:** ✅ **CONCLUÍDA (24/08; Checkout corrigido por D63 em 31/08)** — D15 resolvido por [ADR-050](adr/050-identidade-de-pagamento-do-paciente.md); D16 (gatilho) resolvido com **cron-scan**. **Entregue e verde:** `patient_charges` (migration **0083**, dupla trava de idempotência: `UNIQUE(appointment_id, kind)` + `external_reference` determinístico), contratos de evento `payments.patient_charge.{created,failed}` (allowlist producer-ahead) e **resolvedor de client Asaas por clínica** com cache invalidado por `key_version` — é ele que preserva o circuit breaker por conta. O seam `patientApiV1.getPaymentIdentity` continua exigindo nome + CPF (`null` ⇒ não cobra), mas sinal, restante e renovação usam Checkout hospedado e, após D63, **não enviam `customer` nem PII**: o pagador completa os dados na página do Asaas. O mapa `patient_payment_customers` (migration **0084**) permanece histórico/dormente, sem remoção destrutiva. A intenção/lease nasce antes de `POST /checkouts`; falha indeterminada vira `creation_unknown` e bloqueia retry cego, enquanto 4xx é poison pill e a descrição permanece genérica. **Gatilho:** cron `/api/cron/payments-deposit` a cada 15 min (padrão de reminder/dunning; **auto-curável** nos casos retry-safe — `creation_unknown` exige reconciliação, não novo POST). O mesmo tick faz as duas pontas: cobra os agendamentos novos e **expira os holds vencidos**, cancelando pela máquina de estados CONGELADA (`applyTransition`, que já devolve a vaga à lista de espera) com motivo próprio `deposit_expired`. **Hold na agenda** = colunas aditivas `deposit_status`/`hold_expires_at` (migration **0085**) com CHECK `pending ⇔ tem prazo` — é ele que impede a varredura cancelar consulta de quem PAGOU. Ownership R3 respeitado: o Payments publica, o Scheduling projeta. Migrations **0081–0085 aplicadas em dev e verificadas no banco**.
- **1.4 Webhook:** ✅ **CONCLUÍDA (24/08)** — `/api/webhooks/asaas/patient/[ref]` com **23 testes espelhando os 23** do webhook de assinatura. `ref` é **endereço, não segredo**, e **não é o `clinic_id`** (id de tenant em URL pública vira oráculo de enumeração); **404 para todo ref que não resolve**, sem distinguir inexistente de sem-token. Token POR CLÍNICA, gerado por nós (32 bytes), cifrado, validado constant-time; trocar de conta invalida o anterior. `getPayment` com a chave DAQUELA clínica decide — o corpo só traz ids. Dedup em tabela própria por `(clinic_id, asaas_event_id)`: os emissores são N contas e nada garante ids únicos entre elas. Conciliação **monotônica** (`WHERE status='pending'`) na mesma tx do dedup e do evento. Pago → `agendado→confirmado` via `applyTransition`; **pagamento sobre agendamento já cancelado NÃO ressuscita a vaga** (registra e deixa para o estorno da 1.5). Auto-config do webhook (adiada da 1.1) é best-effort **com falha visível**: `webhook_configured_at` nulo vira aviso na tela. Migration **0086**.
- **1.5a Falta e estorno:** ✅ **CONCLUÍDA (25/08)** — ramos **A** (falta) e **C** (cancelamento) de ponta a ponta, sem migração. `no_show`/`cancelled` estavam livres no registry e ganharam handlers **DETACHED** no Payments (o corpo fala com o Asaas; chamada externa dentro da TX do worker prende conexão do pool). **Retenção é derivada, não gravada**: "sinal retido" é `patient_charges.paid` + agendamento morto — um status `retained` mentiria no dia em que a agenda for reaberta (`recovery-policy: faltou → agendado`). Adapter ganhou `refundPayment` e `cancelPayment`, ambos **sem retry** (POST sem idempotency-key nativa) e ambos precedidos de `getPayment` — a mesma doutrina do `findPaymentByExternalReference`. Um evento novo (`payments.patient_charge.closed`, com `outcome`) em vez de três, porque o consumidor e a coluna são os mesmos. `cancelledAt` entrou **opcional** no contrato de `cancelled`: a janela é regra de ANTECEDÊNCIA e julgá-la pelo relógio do worker faria o paciente perder o sinal por atraso de fila nossa. Corrigiu **D22** (cobrança presa em `pending` após o hold vencer, com link ainda pagável) e **D23** (reagendamento cobrando sinal duas vezes). **+62 testes** (2436 → **2498**); `payments:live-check` **11/11**, com o estorno de sinal pago por PIX/cartão honestamente marcado `n/v` — exige pagamento real na página do Asaas, e a contagem final reporta o não-verificado junto do verde. A verificação ao vivo achou **três defeitos que mock nenhum pegaria**: cobrança apagada responde **200 com `deleted: true`**, não 404 (**D20**); o estorno **só funciona para PIX e cartão**, então sinal pago em boleto não tem devolução automática (**D24**, guarda `REFUNDABLE_BILLING_TYPES`); e a faxina do próprio script **mentia**, deixando webhook para trás com `ok` na tela (**D25**). De quebra, corrigiu o **D26**: `APP_BASE_URL` com barra no fim gerava `https://host//api/webhooks/...` e o webhook nasceria apontando para lugar nenhum.
- **Correção posterior da 1.5a (D77, publicada em 05/09):** a prova externa mostrou
  `POST 2xx → autorização crítica → CANCELLED`, sem devolução. P11 ampliou a intenção D50 com o propósito
  `deposit_closeout` e contadores de baseline na migration 0094. O 2xx apenas deixa a intenção em
  `confirmation_pending`; `PENDING`, `REFUND_REQUESTED` e `REFUND_IN_PROGRESS` não fecham nem repetem
  POST. `CANCELLED` falha observavelmente, e somente refund `DONE` ou pagamento autoritativamente
  `REFUNDED` fecha a cobrança/libera o crédito, tudo na mesma transação tenant-scoped. Intents criados
  antes da 0094 continuam conciliáveis. Focados 104/104, suíte integrada 2.975/2.975 e smoke DEV 7/7 passaram.
  A 0094 foi aplicada em produção com pós-check 9/9, e o Preview passou 6/6 em `f2c1b60`. A nova prova
  Sandbox fez exatamente um refund e não o duplicou no replay; o provider terminou `CANCELLED`, o
  estado local permaneceu `paid`/`available` e o cleanup passou. Em 06/09, D79 corrigiu a confusão entre
  id da cobrança e id do refund; 2.977/2.977 testes e os gates passaram. `DONE` externo segue `NOT TESTED`.
- **1.5b Restante:** ✅ **CONCLUÍDA EM RUNTIME (25/08; endurecida em 27/08)** — arquitetura em [ADR-051](adr/051-conciliacao-sinal-e-recebivel.md). `financial` é a **fonte da verdade** (`lancamentos` = obrigação), `patient_charges` é **instrumento de cobrança**, e o sinal pago vira **crédito antecipado**. O recebível nasce pelo valor **BRUTO** (200), o crédito entra como `valorPago` (100) e o status vira `parcial`. A entrega Meta real é pendência da 1.6c/P1, não lacuna de runtime da 1.5b.
  - **1.5b.1 ✅ CONCLUÍDA (25/08)** — `payments` + `financial`. Migration **0088** (`patient_credits`, no **financial**). Tabela nova porque `payment_transactions.lancamento_id` é NOT NULL: baixa não existe sem lançamento, e o sinal é pago ANTES dele. **Sem FK para `patient_charges`** — o id é chave de idempotência opaca de outro context; FK amarraria a tabela financeira ao modelo físico do Payments, o acoplamento que o D1 recusa. Idempotência por `UNIQUE (clinic_id, patient_charge_id)`. Dois eventos **próprios do crédito**: `payments.patient_credit.granted` (publicado por `markDepositPaid` na MESMA tx do `charge.paid`) e `.released` **com `disposition` explícita** (`refunded` | `retained`) — os dois desfechos são economicamente opostos e inferir isso do nome do evento acoplaria o Financial ao vocabulário do gateway. `billingType` do `getPayment` vira código do catálogo (`pix`/`cartao_credito`; qualquer outro ⇒ `null`, porque baixa com forma inventada corrompe a conciliação). **Retenção agora fecha o crédito** — e isso NÃO contradiz a 1.5a: na `patient_charges` "retido" segue derivado, mas um crédito `available` é promessa sobre dinheiro futuro e deixá-lo assim faria um lançamento posterior absorver dinheiro já retido como taxa de falta. Handler tolera crédito inexistente (`not_found`) — é a janela de deploy, e lançar prenderia o evento em retentativa. **+58 testes.** Migration aplicada e verificada em dev (15 colunas, RLS enabled+forced, 5 constraints).
  - **1.5b.2 ✅ CONCLUÍDA (25/08)** — **`financial` sozinho, 1 context, sem migração e sem evento novo**. A Parede 1 do D19 caiu sem cron-scan: o handler de `scheduling.appointment.completed` continua **único dono** e apenas passou a ler créditos da **própria** tabela. Fluxo: `listAvailableCredits` → `allocateCreditsTo` (função PURA) → lançamento com `valor` **BRUTO** e `valorPago` = crédito aplicado → `allocateCredit` + linha em `payment_transactions` (a baixa fica no ledger, com a forma de pagamento de origem). Tudo na **mesma transação** do insert: se a alocação falhar, o lançamento cai junto — o oposto deixaria recebível dizendo "R$ 100 pagos" com o crédito ainda `available`, livre para ser contado de novo. Criada `statusAoCriar` porque `calcStatusPagamento(200, 0)` devolve **`parcial`**, não `pendente` — armadilha real, já que a maioria dos atendimentos não tem sinal. `allocateCreditsTo` nunca aloca além do valor do lançamento (invariante 4), o que cobre reajuste de valor para baixo depois do sinal pago. **Achado D33: o handler não tinha NENHUM teste** — é ele que cria todo recebível do Caixa. **+24 testes** (13 do handler, 11 das funções puras).
  - **1.5b.3 ✅ CONCLUÍDA (25/08)** — **dividida em duas, porque a versão do ADR estourava o §0.6**. O ADR-051 previa `payments` + `scheduling`, calculando `valor − créditos`. Ao implementar ficou claro que isso está **errado**: o saldo tem de vir do **Financial**. Se o Payments calculasse por conta própria (valor do procedimento menos o que ELE recebeu), um pagamento feito **em dinheiro na recepção** e lançado no Caixa não apareceria — e o paciente receberia link cobrando algo que já pagou. Consultar o Financial leva a **3 contexts**, daí a divisão:
    - **1.5b.3a** — `financial` (1 context): seam `financialApiV1.getAppointmentBalance` — só recebível `pendente`/`parcial` (terminais não têm saldo a perseguir); `null` significa **não cobrar**. +7 testes.
    - **1.5b.3b** — `payments` + `scheduling` (2 contexts): read-model `listRemainderCandidates` (regra de AGENDA apenas — `atendido`, com paciente, na janela; **quanto falta é conta do Financial**), caso de uso `createRemainderCharge` e varredura `runRemainderScan`, acopladas ao cron `payments-deposit` já existente (3ª metade do mesmo tick; nenhum cron novo, contagem segue 17). `UNIQUE(appointment_id, kind)` + `external_reference` `remainder:<id>` + geração/lease persistidos antes da rede impedem dívida e POST duplicados. Publica **apenas `link_ready`**, nunca `charge.created`: aquele faz a agenda segurar vaga, e o restante é cobrado DEPOIS do atendimento — não há vaga a segurar. **+26 testes.**
    - **Por que scan e não handler**, mesmo com o gatilho livre: a varredura roda **depois** de o lançamento existir. Um segundo handler de `appointment.completed` correria com o faturamento e perguntaria o saldo antes de haver recebível — respondendo "nada a cobrar" para todo atendimento.
    - **Reuso em vez de nova exceção**: `listClinicsWithDepositEnabled` passou a ser exportada pelo `deposit-scan` em vez de duplicada — copiar a query exigiria uma segunda exceção de `dbAdmin` na allowlist, e allowlist de bypass de RLS é o último lugar onde vale duplicar código. O lint pegou isso.
  - **1.5b.4** — absorvida pela 1.5b.1 (o crédito do restante usa o MESMO `patient_credit.granted`).
- **1.6a Link no WhatsApp:** ✅ **CONCLUÍDA (25/08)** — o elo que faltava desde a 1.3: a cobrança nascia, o `invoice_url` ficava guardado, e **ninguém o entregava**; o hold vencia e o paciente perdia a consulta sem nunca ter recebido como pagar — anti-no-show que produzia no-show. Entra na **fila C14** (`deposit_link`, migration **0087**) em vez de abrir caminho paralelo: lease, backoff, janela 8-20h, supressão, consentimento, dedup e at-most-once no Meta já estavam resolvidos lá. **A IA segue read-only em cobrança** — não há LLM em ponto nenhum do caminho. Evento próprio `payments.patient_charge.link_ready` (o `created` já é do Scheduling, e os dois fatos são diferentes: `invoiceUrl` é nullable, então pode haver cobrança **sem** link). **O link não viaja no payload nem no job**: é resolvido no send-time por `paymentsApiV1.getPayableCharge`, que devolve `null` se a cobrança já foi paga/estornada/expirada — a guarda mora no seam, não no chamador. O typecheck expôs um mapeamento de propósito de supressão **duplicado** entre política e envio; virou função única (`suppressionPurposeFor`), porque divergir faria bloquear por um propósito e registrar outro, e o opt-out do paciente nunca casaria. `deposit_link` reusa o propósito `reminder`: é transacional (o paciente marcou e perde a vaga se não pagar), **não** é dívida — e propósito novo nasceria sem os opt-outs já registrados. **Dependência externa declarada:** o template precisa ser aprovado na Meta (`META_TEMPLATE_DEPOSIT_LINK_ID`); sem ele o job falha visível, nunca cai para texto livre.
- **1.6b Status na agenda:** ✅ **CONCLUÍDA (25/08)** — **sem migração**: as colunas existem desde a **0085**, e mesmo assim a recepção não via nada, porque `toAppointmentSummary` não as mapeava. Mesmo formato do **D32** — camada de baixo correta, produto inexistente, dado parando no meio do caminho. `AppointmentSummary` ganhou `depositStatus` + `holdExpiresAt`, e a agenda um `DepositStatusBadge` **ao lado** do status, não no lugar dele: o sinal é dimensão ORTOGONAL (a 0085 é explícita nisso), e um agendamento pode estar `agendado` com sinal pago. `none` **não renderiza nada** — sinal desligado é o caso da maioria das clínicas, e rótulo em toda consulta treinaria o operador a não olhar a região da tela justamente quando importa. `pending` é âmbar e carrega o prazo no `title`: é o único estado em que a recepção ainda pode agir, porque a vaga vira cancelamento sozinha quando ele passa. 1 context (`scheduling` + app). **+12 testes**, incluindo a trava contra o mapeamento manual esquecer campo de novo.
- **1.6c Entrega do link do restante:** ✅ **IMPLEMENTADA (27/08, D35)** — o mesmo
  `payments.patient_charge.link_ready` agora roteia `deposit → deposit_link` e
  `remainder → remainder_link`; tipos realmente desconhecidos continuam no
  `proactive.deposit_link.skipped_kind`. A migration aditiva **0090** amplia o enum da fila C14 e o
  cron `/api/cron/proactive-remainder-link` reivindica o novo tipo, reutilizando lease, janela 8–20h,
  retry/backoff, dedup, suppression, consentimento e a idempotency key estável do job. O payload do
  restante carrega apenas ids + valor: **não guarda `invoiceUrl` nem hold**. Imediatamente antes de
  montar a mensagem, o worker chama `paymentsApiV1.getPayableCharge`; retorno `null` cancela com
  `charge_not_payable`, cobrindo paga, estornada, cancelada, expirada ou sem link. O builder tem branch
  explícita e template `remainder_link` próprio, que diz que o atendimento já ocorreu e não fala em
  garantir/reservar horário. `suppressionPurposeFor` segue fonte única; o restante reutiliza `billing`
  e o respectivo consentimento/opt-out. Nenhuma IA/LLM entrou no fluxo e não houve nova fila, mecanismo
  Meta ou evento.
  - **Regression Matrix:** Payments ✅ (seam preservado) · WhatsApp/C14 ✅ · AI Agent/messaging ✅
    (infraestrutura apenas, sem LLM) · Financial ✅ indireto/inalterado · Scheduling ✅ origem
    inalterada · multi-tenancy ✅ (`clinicId` do worker + seam tenant-scoped).
  - **Evidência:** Unit ✅ · Integration controlada ✅
    (`link_ready → remainder_link → getPayableCharge → template → send`) · Contract/Worker Smoke ✅
    (2.816 testes/311 arquivos; `smoke:c14` 9/9; todos os gates verdes) · **E2E real Meta =
    PASS até o aparelho**: Checkout real, evento, job, lookup, template próprio, message id,
    replay zero, cleanup local/provider e recebimento confirmado pelo operador. Não houve mock
    classificado como E2E real.

**1.H HARDENING:** 🟡 concorrência, idempotência, multi-tenant, banco lento, POST indeterminado, Financial
Integrity, Simulation, carga, restore isolado, Playwright read-only, Meta, D27, restore global e o
Product Acceptance técnico de P9 estão verdes conforme a matriz canônica. Resta somente o estado
terminal externo da D50; a percepção humana fica para a clínica piloto. P3 foi encerrado por decisão
consciente sobre o Sandbox. Aceite continua sendo cada cenário com evidência real +
Security/Chaos/Financial/Load/Simulation verdes.

**1.S STABILIZATION:** ✅ **CONCLUÍDA (P10)**. D73–D75 foram corrigidos;
C14/Financial, jornada, contenção de POST e simulação terminaram com cleanup zero. `lint`, `typecheck`,
2.816/2.816 testes em 311 arquivos, `build` e gates arquiteturais/operacionais estão verdes. O diff, a
formatação e a varredura de segredos do conteúdo adicionado foram revisados. O commit executável
`4883372` foi publicado, chegou a deployment terminal `success` e passou 6/6 no Preview autenticado,
sem `pageerror`; auth state e artefato foram removidos. Load e
restore só se repetem com mudança de volume/schema relevante; não houve migration neste lote. Aceite:
zero bug alto aberto, nenhuma evidência pendente tratada como verde, rollback por clínica provado e
suíte 100% verde.

#### Checklist P10 / 1.S — evidência do lote de 04/09

- [x] Scope freeze respeitado: somente D73–D75, sem feature, migration, dependência ou chamada externa.
- [x] Budget respeitado: 18 arquivos rastreados, 324 adições/167 remoções e 2 áreas (`outbox` + Payments/harnesses).
- [x] D73: tenant removido termina `skipped`, mantém audit e emite métrica; `smoke:c14` 9/9.
- [x] D74: `POST /checkouts` indeterminado preserva uma dívida/geração `creation_unknown`, sem link, evento ou retry cego.
- [x] D75: jornada 13/13 e simulação de 30 dias não confundem audit órfão com tenant concorrente; cleanup zero.
- [x] Financial 10/10 e simulação com 30 agendamentos, 38 cobranças, 62 webhooks e 3 ticks.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` (2.816/2.816) e `pnpm build`.
- [x] `arch:check`, `arch:db-check` e `arch:graphs --check`: 0 ciclos e 0 findings.
- [x] `check:migrations`, `check:registry:strict` e `check:observability`.
- [x] ADR-049/050/051, Discovery Log, handoff e runbooks reconciliados.
- [x] Diff revisado, Prettier dos 18 arquivos verde, `git diff --check` verde e zero padrão de segredo no conteúdo adicionado.
- [x] Commit e push do lote: `4883372`; arquivos locais do usuário ficaram excluídos.
- [x] Deployment Vercel `CZJqTEXXeMoKYa9zwTfxBDGDGpwr` terminal `success` para o mesmo SHA.
- [x] Smoke autenticado no Preview do mesmo SHA 6/6, sem `pageerror`; auth state/artefato removidos.
- [x] P10/1.S concluído após código, gates, publicação e observação do Preview.

#### Checklist P11 / D77 — evidência local/DEV de 05/09

- [x] Scope freeze respeitado: correção do fechamento prematuro do estorno; nenhum novo POST Asaas,
  mudança de Meta, UI ou regra de valor.
- [x] Budget respeitado: 23 arquivos do lote, menos de 1.500 linhas líquidas e apenas Payments mais
  integração indireta com Financial/outbox existente; nenhuma dependência nova.
- [x] Migration 0093 da `main` integrada; migration 0094 aditiva registrada em DEV e produção.
- [x] Intenção `deposit_closeout` persistida antes do POST; baseline e contadores gravados no claim
  atômico; somente um worker pode submeter.
- [x] Resultado incerto não repete POST; `PENDING`/em progresso não fecham; `CANCELLED` falha;
  somente refund `DONE` ou pagamento `REFUNDED` confirma.
- [x] Confirmação da intenção, fechamento da cobrança, evento `closed` e liberação do crédito na mesma
  transação tenant-scoped.
- [x] Webhook tenant e cron fazem readback autoritativo; o cron descobre intenção em voo mesmo com a
  política de sinal desligada.
- [x] Compatibilidade com intents D50 anteriores à 0094: contadores nulos não impedem confirmação por
  refund id, total `DONE` ou status `REFUNDED`; `CANCELLED` sem id/contadores permanece pendente em vez
  de produzir falso terminal.
- [x] Unit/contract/integration focados: 104/104; após o merge, regressão integral: 2.975/2.975 em
  318 arquivos e revalidação combinada D78/P11/conflitos: 323/323 em 19 arquivos.
- [x] DEV conectado revalidado: `smoke:payments-money-db` 7/7, cleanup zero e sem Asaas/Meta.
  Financial 10/10 e jornada banco+worker 13/13 permanecem evidência anterior e não foram repetidos.
- [x] `lint`, `typecheck`, `build`, ciclos, dbAdmin, grafos, migrations, registry estrito,
  observabilidade e `git diff --check` verdes.
- [x] Histórico 0081–0092 reconciliado e publicado na `main` em `93da840`; arquivos locais do usuário
  continuam fora do lote.
- [x] 0094 em produção: backup 2.661.164 bytes, advisory lock 4242 adquirido/liberado, migrador `DONE`
  e pós-verificação independente 9/9.
- [x] Commit local P11 `940335e`; D78 separado em `175750b`; `origin/main` integrado por merge
  `c5f759d`, sem reescrever histórico.
- [x] Push confirmado no SHA `f2c1b60`; deployment Vercel do mesmo SHA terminal `success`; smoke
  canônico Preview 6/6 e auditoria autenticada ampla 2/2, com artefatos removidos.
- [x] Fixture PIX tenant-scoped criada após o rollout: pagamento liquidado, um refund, baseline zero,
  replay sem segundo POST e proteção não terminal comprovada (`paid` + crédito `available`).
- [x] O refund D77 saiu de `PENDING` para `CANCELLED`; readback/reconcile provou `failed → paid`, crédito
  `available`, um único refund e cleanup local exato, preservando o histórico do provider.
- [x] D79: o adapter deixou de persistir o id da cobrança como refund; fallback por baseline funciona
  quando o id antigo não encontra correspondência. Regressões `CANCELLED` e `DONE` passaram.
- [ ] **BLOCKED D80:** provar externamente `DONE → refunded` somente depois de o suporte Asaas
  explicar/liberar a autorização crítica. A tentativa sincronizada também terminou `CANCELLED`;
  não criar nova fixture nem repetir POST.

**Gate independente da Camada 1:** D50 continua com um único refund externo `PENDING`; quando o provider
confirmar `DONE`, executar somente readback, ledger, replay e cleanup, sem repetir o POST.

#### Checklist corretivo 1.S / D72 — estado humano do estorno no Caixa

- [x] Payments mantém a leitura tenant-scoped e expõe somente estado sanitizado, valor e
  identidade do atendimento; nenhum id/erro bruto do Asaas atravessa o contrato público.
- [x] `pending`, `submitting` e `confirmation_pending` são exibidos como aguardando confirmação.
- [x] `confirmed`, `failed/refund_cancelled` e demais falhas possuem branches humanas explícitas.
- [x] O Caixa compõe o seam público sem JOIN cross-context nem nova regra financeira.
- [x] Testes unitários/UI focados: 22/22; leitura conectada DEV da fixture D50: 1/1.
- [x] E2E local autenticado: `/caixa` 200, copy/valor visíveis, zero id interno e zero `pageerror`.
- [x] Suíte integral 2.989/2.989, lint, typecheck, build e gates arquiteturais/operacionais.
- [x] Commit `b6f8194`, push, deployment Vercel `success`, smoke autenticado Preview 6/6 e prova D72
  específica `/caixa` PASS; auth state/artefato removidos.

Este corretivo não altera migration, webhook, refund, ledger ou estado externo. Ele torna visível a
diferença que o readback D50 × D80 já provou e nunca oferece “tentar novamente” como atalho perigoso.

**E2E de aceite:** `agenda(on)→aceita política→link 50%→paga→webhook→CONFIRMADO`; A(falta)=retido/restante não criado · B(comparece)=restante conciliado · C(cancela a tempo)=estornado.

---

## 6. Track O — Onboarding self-serve
Mesmos gates + `O.H`/`O.S`. **Decisão de produto de 01/09/2026:** Qoro terá uma experiência única; o onboarding não pergunta módulo/especialidade, não exibe especialidade “em breve” e não roteia para dashboards diferentes. Isso não remove CRM/especialidade profissional, procedimentos, templates clínicos nem a lista de especialidades informada pelo agente. **O-1** wizard (atribuição do Qoro→média/mês→email+senha→plano→verificação→entrou; trial **7d**; preço **padrão**). **O-2** onboarding concluído→dashboard único, com dependências a confirmar na auditoria própria do Track O. **O-3** tour. **O-4** Central de Documentação (Asaas/WhatsApp).

---

## 7. Camadas 2–4 (mesmos gates + `.H`/`.S`)
- **P1:** **2.1.0 spike regulatório de documento de pagamento** → 2.1 comprovante/recibo conforme
  [ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md) · **2.2.0 SPIKE Memed** (validar
  **contrato · custos · requisitos regulatórios · dependência comercial** ANTES de qualquer código —
  integração externa não começa sem o spike passar) → 2.2 Memed · 2.3 template psiquiátrico · 2.4
  recuperação falta/retorno · **2.H·2.S**.
- **P2:** conselho genérico (fundação; psicologia clínica desacoplada) · pacote/mensalidade · O-2 · **3.H·3.S**.
- **P3:** NPS · modalidade online · convênio/TISS · NFS-e (parceiro) · psicologia clínica completa.
- **Adiado:** CRM/UTM/reativação · repasse.

---

## 8. Gate — Observabilidade
`metrics.emit` + `check:observability` (drift) + Sentry/Better Stack. Eventos P0: `payments.account.{connected,disconnected}` (1.1) · `payments.patient_charge.{created,paid,refunded,failed}` · `payments.deposit.expired` · `scheduling.appointment.confirmed_after_payment` · `payments.webhook.{received,invalid_token,verify,duplicate}`. Alertas + painel "saúde do pagamento".

## 9. Gate — Segurança
RLS · cross-tenant · permission escalation · **webhook forgery (espelhar os 23)** · rate limiting · sensitive data exposure · LGPD (consent do sinal, hard-delete cobre `patient_charges`). Reusa `arch:db-check`, `lib/auth/*`, cripto.

## 10. Gate — Performance & Carga
> **Exigível a partir de 1.4** (antes disso não há endpoint novo para medir). Ferramenta: **`autocannon`** (npm) — `k6` descartado por ser binário fora do npm. Alvo obrigatório: scratch isolado; **nunca Preview, produção ou DEV compartilhado**. Estado atual: restore e `test:load` P8 passaram em PostgreSQL local descartável, com app real, Meta falso e guards fail-closed.

**SLOs:** API P95<500ms · P99<1s · webhook<2s · job<30s · query<100ms.
**Load (`test:load` via autocannon):** appointment 500 · webhook 1000 · WhatsApp 5000 · reconcile em lote · outbox saturado → sem erro/deadlock/race. Resultado de 29/08: todos os SLOs passaram; repetir após mudança relevante de runtime/schema/SLO.

## 11. Gate — Complexidade
Nenhuma alteração pode aumentar acoplamento, ciclos ou fan-in/out excessivo. Ferramenta: **`pnpm arch:graphs --check`** (Camada -1) — usa o `madge` já instalado e calcula fan-in/out por elemento. **`dependency-cruiser` foi CORTADO**: regra declarativa de dependência já é feita pelo `eslint-plugin-boundaries`, e uma segunda config das mesmas regras só cria divergência. **Exigível desde 1.0. Aceite:** `--check` verde (0 ciclos; nenhuma aresta nova sem o diff do snapshot commitado no mesmo PR).

## 12. Gate — Chaos Testing
Simular e validar os mecanismos **existentes**: Asaas indisponível (circuit breaker do adapter) · Gemini indisponível (`lib/ai/circuit-breaker.ts`) · WhatsApp indisponível (outbox retry) · banco lento · timeout de webhook (backstop `billing-reconcile`) · falha parcial de worker. Validar: retry · circuit breaker · fallback · **consistência ao voltar**.

## 13. Gate — Financial Integrity (crítico)
Nenhum cenário gera: **cobrança duplicada · estorno duplicado · recebimento negativo · divergência Asaas↔Qoro · divergência agenda↔financeiro.** Toda transação **fecha contábil**. Valida: ledger append-only (`payment_transactions`), estorno=lançamento novo, `UNIQUE(appointment_id)`, `external_reference` idempotente, `billing-reconcile` (somatório Asaas = somatório Qoro por clínica/período).

## 14. Gate — Clinic Simulation (Operação Real) — NET-NEW
> **Exigível no `1.H`** — antes de 1.3–1.5 não existe `patient_charges`, webhook de paciente nem handler de `no_show`: não há o que simular. Sem dependência nova (tsx + seeds + `worker:once`, no molde dos `smoke:*`).

Harness `test:simulation` (reusa seeds + geradores de evento) simulando **30 dias de operação**: agendamentos, faltas, pagamentos, cancelamentos, reembolsos, webhooks (inclusive duplicados/out-of-order). **Validar consistência final** (Financial Integrity §13 + agenda↔financeiro + sem órfão/hold preso). Pega bugs que só aparecem com eventos acumulados.

**Resultado 2026-08-27: ✅ VERDE.** `pnpm test:simulation` executou 30 agendamentos/38 cobranças/62
webhooks no Postgres DEV e drenou o worker real em 3 ticks com paralelismo 4. A execução inicial
encontrou o D51; a repetição após o fix fechou 8 recebíveis/R$ 800,00 de ledger sem retry, falha,
duplicata, órfão ou hold preso e confirmou cleanup com resíduo zero. Não houve chamada ao Asaas/Meta.

## 15. Gate — Product Acceptance
Percorrer a jornada como **secretária·médico·dono·paciente**: nº de cliques · clareza · tempo · chance de erro humano. *(Usabilidade real exige usuário real → confirmada na piloto da Fase 2 do rollout §18.)*

**Estado atual em 04/09/2026:** `PASS técnico-normativo`. D60/D70 foram publicados no commit
`42cd114` e reobservados no Preview. A parte que pode ser avaliada objetivamente pelo agente foi executada:

- **critérios clínico-documentais:** prontuário cronológico, identificação/autoria, guarda, sigilo e
  acesso do paciente foram confrontados com o
  [Código de Ética Médica do CFM — Documentos médicos](https://portal.cfm.org.br/etica-medica/codigo-2010/codigo-de-etica-medica-res-1931-2009-capitulo-x-documentos-medicos/);
- **privacidade e separação de papéis:** dado de saúde foi tratado como dado pessoal sensível e os
  fluxos foram avaliados contra autorização server-side, minimização e proteção de acesso, conforme
  [FAQ da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes)
  e o
  [Guia de Segurança da Informação da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/anonimizado___guia_orientat-_seg_da_inf_p_atpp.pdf);
- **fluxo operacional inferido:** recepção identifica/cadastra paciente e administra agenda; médico
  atende e registra/conclui o fato clínico; dono configura e supervisiona financeiro/permissões;
  paciente recebe comunicação/Checkout. Não existe uma única norma pública que determine os cliques
  internos de toda clínica; esta sequência é inferência de produto, não alegação regulatória;
- **automação:** 150/150 testes focados passaram para Agenda, conclusão clínica, validação de
  prontuário, criptografia/ownership, permissões, navegação de Configurações e mensagens de sinal/
  restante. O Preview passou 8/8 projetos visuais, cobrindo 72 estados (9 rotas × 4 viewports × 2
  temas), agora esperando o heading real e falhando em qualquer `pageerror`;
- **observação real já disponível:** o operador confirmou anteriormente as mensagens Meta de sinal e
  restante no aparelho. O D50 aparece no Caixa como exceção aguardando estorno; o provider continua
  `PENDING`. O corretivo D72 distingue espera, confirmação, cancelamento sem devolução e falha e foi
  publicado/revalidado no Preview: 6/6 canônico + `/caixa` específico PASS, sem id do provider ou
  `pageerror`.

Achados: D60 (corrida App Router em Link → redirect) e D70 (dia do Dashboard fora do fuso da clínica)
foram corrigidos e publicados; D71 corrigiu o falso verde do harness visual. O E2E autenticado do
Preview percorreu Agenda, Caixa, Financeiro, Configurações, Produto e Sugestões 6/6 sem `pageerror`.
A matriz pós-deploy passou 8/8/72 e a inspeção confirmou Dashboard no fuso e Configurações canônica.
Artefatos e auth state foram removidos; resta apenas monitoramento passivo de recorrência no Sentry.

**Limite honesto:** pesquisa web, código e navegador permitem aceite técnico/normativo; não provam que
uma secretária ou médico real considera a tela intuitiva. Essa percepção será colhida na onda 1 com a
clínica piloto e bloqueia somente a expansão para as ondas seguintes. O fundador não precisa encenar
um processo clínico que não domina para permitir o início de 1.S.

## 16. Gate — Migração
Validar em **vazio · populado (`seed:dev`) · volume (restore anonimizado)**, com **Up→Down→Up** + consistência. Reusa `check:migrations`, `db:backup:prod`, `restore:test`.

**Estado atual:** 0090 verde em vazio, populado e `up → rollback operacional → up`; aplicada em dev e
produção com backup/lock. P8 restaurou o dump em PostgreSQL local descartável e a carga usou o schema
DEV atual em scratch TLS, ambos sem resíduo. Enum aditivo do PostgreSQL não tem `down` destrutivo
seguro; rollback mantém o valor inerte e recua o código, sem recriar enum/tabela.

## 17. Gate — Documentação Viva
Concluído só com: **ADR · docs · fluxograma · runbook (`docs/runbooks/`)** atualizados.

## 18. Rollout progressivo
**Ondas nominais, por clínica** — não percentuais (D1: não há flag por tenant, e com uma piloto "25%" não quer dizer nada):
```
onda 0  clínica interna de testes
onda 1  1 clínica piloto (psiquiatra)
onda 2  próximas clínicas, lista explícita
onda 3  todas
```
Cada onda = ligar a coluna do domínio (`clinic_deposit_policy.enabled = true`) nas clínicas **nomeadas** da onda. Avanço só com observabilidade sem anomalia + zero incidente por N dias.
**Rollback = `enabled = false` na clínica** — efeito imediato, sem deploy, sem migração reversa.

---

## 19. Rastreabilidade, riscos e rollback
**Gap→camada→validação:** no-show → 1.3–1.5 (E2E A/B/C + §13 + §14) · gateway → 1.0–1.4 (webhook espelhado + §10 + §12) · recibo → 2.1 · controlado → 2.2 (após spike §7) · psiquiátrico → 2.3 · psicólogo bloqueado → 3.1 · onboarding → O-1.
**Riscos:** refactor do adapter (1.0 isolada) · fricção do sinal (flag/%) · credencial de terceiro (cifra+write-only+papel+audit) · webhook forjado (A2) · concorrência/carga (§10+§12+1.H) · integridade financeira (§13) · **Memed estourar cronograma (spike §7 antes de integrar)** · scope creep (§0.8 freeze).
**Rollback:** flag desliga; migrações aditivas; reverter = desligar flag + reverter migração + recuar onda.

---

## 20. Guia prático de fechamento financeiro e início do TISS — 28/08/2026

Esta seção traduz as decisões e pendências acima em ações executáveis. Ela não transforma teste
pendente em teste verde e não autoriza, por si só, mutação no Asaas/Meta, migration ou deploy.

### 20.1 Sinal e restante somente por PIX ou cartão — decisão tomada (D24)

**Regra de negócio:** o paciente poderá pagar o sinal e o restante por **PIX ou cartão de crédito**.
Boleto não deve aparecer.

O código atual ainda cria a cobrança com `billingType: UNDEFINED`. Isso deixa o Asaas escolher os
meios habilitados na conta e, portanto, não impõe a regra “somente PIX/cartão”. O endpoint atual de
cobrança recebe um único `billingType`; trocar `UNDEFINED` por `PIX` eliminaria o cartão, e trocar por
`CREDIT_CARD` eliminaria o PIX. Desabilitar boleto manualmente na conta também não é uma trava de
produto: afeta outros usos da conta e pode divergir entre clínicas.

A direção técnica foi validada contra o
[Checkout Asaas](https://docs.asaas.com/reference/criar-novo-checkout), que recebe a lista
`billingTypes` e permite declarar `PIX` e `CREDIT_CARD`. Em 28/08, o spike no sandbox criou um
Checkout `ACTIVE` com os dois meios exatos, link hospedado e `chargeTypes: ["DETACHED"]`; o cleanup
cancelou o recurso e confirmou `CANCELED`.

O spike também provou o risco que impede uma troca direta: duas chamadas com a mesma
`externalReference` criaram dois Checkouts distintos. Além disso, `GET /checkouts/{id}` e uma
listagem por `externalReference` retornaram 404, coerentes com o índice oficial atual, que documenta
somente criação e cancelamento. O evento de Checkout transporta `checkout.id`, enquanto o fluxo do
Qoro hoje persiste `payment.id`, valida o estado com `getPayment` e localiza a cobrança por
`provider_payment_id`. Logo, isso exige um recorte próprio, não uma troca de literal:

1. **D24a — intenção e adapter:** persistir uma intenção tenant-scoped antes do POST, protegida por
   lease/estado terminal; adicionar `createCheckout`/`cancelCheckout` ao seam de Payments e testes de
   contrato. Um timeout depois do POST deve ficar observável para reconciliação humana/automatizada,
   nunca disparar nova criação cega;
2. **D24b — identidade e webhook:** guardar `provider_checkout_id` separado de
   `provider_payment_id`; aceitar `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e
   `CHECKOUT_EXPIRED` no parser mínimo, deduplicar por `event.id` e verificar a fonte autoritativa
   disponível antes de qualquer transição. O E2E sandbox pago precisa provar como obter e correlacionar
   o `payment.id` e o `billingType` efetivo — não assumir pelo payload;
3. **D24c — troca do fluxo:** fazer sinal e restante criarem Checkout via o novo seam, preservar hold,
   link no send-time, closeout/cancelamento, estorno, multi-tenancy e todos os eventos internos; só
   então remover `UNDEFINED` deste fluxo;
4. atualizar a [ADR-049](adr/049-pagamentos-paciente-sinal.md) e o runbook da conta com o contrato
   provado;
5. executar migrations aditivas em vazio, populado e `up → down → up` quando suportado, todos os
   gates, regressão do sinal/restante e o E2E sandbox controlado;
6. manter assinatura SaaS e demais usos de `generateInvoice` inalterados.

**Prova externa executada em 30/08:** `payments:checkout-e2e` automatizou criação, seleção de método,
preenchimento sintético, consulta por `payments?checkoutSession=...`, confirmação sandbox, validação e
limpeza. O operador resolveu somente o reCAPTCHA e clicou em pagar. O cartão criou uma cobrança
`CREDIT_CARD` correlacionada e terminou `REFUNDED`. O PIX criou uma cobrança `PIX` correlacionada,
foi confirmado pelo endpoint Sandbox e terminou `RECEIVED`; o primeiro estorno foi recusado durante a
curta janela de indisponibilidade do provider e a solicitação posterior foi aceita, mas sua execução
ficou `AWAITING_CRITICAL_ACTION_AUTHORIZATION`. Portanto, pagamento real por ambos os métodos é
`PASS`; cleanup do PIX é `PARTIAL`, não verde, até a autorização e o readback terminal.

**Nova prova isolada na conta atual em 04/09:** após a remoção das credenciais da conta antiga, o mesmo
runner foi executado com as variáveis DEV efetivas e guard de host Sandbox. O Checkout foi criado nessa
conta, gerou uma cobrança `PIX` de R$ 10 correlacionada e o pagamento foi confirmado como `RECEIVED`.
O readback guardou somente o fingerprint não reversível da conta e a identidade técnica da fixture em
`.playwright/asaas-pix-refund-fixture.json`, ignorado pelo Git. A primeira tentativa de estorno recebeu
`invalid_action`; uma única repetição guardada, depois de confirmar pagamento e ausência de refund, foi
aceita. O readback seguinte encontrou exatamente um estorno de R$ 10 em
`AWAITING_CRITICAL_ACTION_AUTHORIZATION`. O operador informou no painel o código recebido no celular,
e o readback posterior — já com saldo disponível muito acima de R$ 10 — encontrou esse único refund
em `CANCELLED`, enquanto a cobrança permaneceu `RECEIVED`. Pela semântica oficial, o valor não foi
devolvido. Não executar outro POST sem autorização específica. Esta é uma prova direta do provider,
não uma `patient_charge` tenant-scoped; o pagamento PIX está provado, mas o resultado assíncrono
revelou o risco crítico D77 no closeout comum.

No PowerShell, com a chave sandbox já configurada no `.env.local`:

```powershell
# Cartão — os dados fictícios são preenchidos pelo runner.
$env:ASAAS_CHECKOUT_E2E = 'ALLOW_SANDBOX_PAYMENT'
$env:ASAAS_CHECKOUT_E2E_INTERACTIVE = '1'
$env:ASAAS_CHECKOUT_E2E_METHOD = 'CREDIT_CARD'
pnpm payments:checkout-e2e

# PIX — repetir depois que o primeiro processo terminar.
$env:ASAAS_CHECKOUT_E2E_METHOD = 'PIX'
pnpm payments:checkout-e2e

Remove-Item Env:ASAAS_CHECKOUT_E2E, Env:ASAAS_CHECKOUT_E2E_INTERACTIVE, Env:ASAAS_CHECKOUT_E2E_METHOD
```

O operador não informa cartão, CPF, endereço ou valor. Ele apenas resolve o reCAPTCHA na janela e
clica em pagar. Se nenhum pagamento surgir, o Checkout é cancelado; se surgir uma cobrança pendente,
ela é removida; se o Sandbox a liquidar, o runner faz um único POST de estorno, sem retry cego, e
consulta novamente a cobrança e os estornos. Estados intermediários não contam como limpeza. Se o
Asaas retornar `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, o operador abre a ação pendente no painel
Sandbox, usa o código de teste oficial `000000` e confirma; depois o estado final é verificado pela API.

**Aceite:** nenhuma cobrança de paciente criada pelo Qoro oferece boleto; PIX e cartão continuam
funcionando de ponta a ponta; o comportamento da assinatura SaaS do Qoro não muda.

### 20.2 Chargeback — recomendação clínica e financeira (D27)

**Decisão confirmada pelo fundador em 28/08/2026.**

**Recomendação:** um chargeback altera o estado do **dinheiro**, não reescreve o fato clínico. Não
apagar prontuário, não voltar atendimento concluído para “não atendido” e não cancelar
automaticamente uma consulta apenas porque a contestação começou.

| Estado observado | Regra recomendada |
| --- | --- |
| `PAYMENT_CHARGEBACK_REQUESTED` / `IN_DISPUTE` | marcar o valor como **em disputa**, impedir que seja contado/alocado novamente e abrir alerta para a clínica; não enviar novo link nem acusação automática ao paciente |
| disputa perdida / `PAYMENT_REFUNDED` | registrar movimento compensatório append-only e reabrir/reduzir o recebível pelo valor efetivamente perdido; o pagamento original continua no histórico |
| disputa ganha / reversão confirmada pelo Asaas | retirar o bloqueio ou registrar a recomposição uma única vez, sem criar um segundo pagamento e sem duplicar crédito |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE` | tratar como reversão efetiva, não como disputa: compensar o ledger e reabrir/reduzir o recebível imediatamente |

Se a consulta ainda não ocorreu, a agenda continua existindo e a tela deve mostrar uma pendência
financeira para decisão humana. O sistema não deve cobrar novamente enquanto a disputa estiver
aberta, pois a clínica pode ganhar a contestação e produzir cobrança dupla. A defesa do chargeback é
uma ação humana: reunir consentimento, comprovação da prestação do serviço, comunicações e demais
evidências permitidas. Dados clínicos sensíveis não devem ser enviados automaticamente ao gateway;
usar somente o mínimo necessário após revisão humana. O Asaas documenta os
[estados do chargeback](https://docs.asaas.com/docs/chargeback), o
[fluxo dos eventos](https://docs.asaas.com/docs/webhook-para-cobrancas) e a
[abertura de disputa com evidências](https://docs.asaas.com/reference/criar-disputa-de-chargeback).

**Implementação de 29/08:** a [ADR-052](adr/052-risco-e-reversao-de-pagamento-do-paciente.md) fixou
estados, eventos, ownership e ledger. A rota consulta `GET /payments/{id}`, projeta
`patient_charges.dispute_status` monotonicamente e publica
`payments.patient_payment.risk_changed`. O Financial impede alocação durante a disputa; no ganho,
libera o bloqueio sem duplicar receita; na perda, registra `patient_credit_adjustments` e uma
`payment_transactions(kind=refund)` ligada à baixa original, reduzindo somente `valor_pago`. A
migration 0092 faz backfill apenas 1:1; linha histórica ambígua abre conciliação manual. Unit,
contrato, handlers, webhook, lint, typecheck e build passaram. A 0092 está aplicada em DEV e produção;
smoke DEV 5/5 e pós-verificação PROD 7/7 estão verdes. Chargeback sandbox real é evidência externa
posterior.

**Fixture criada em 30/08 e relida em 31/08:** o runner controlado criou uma nova cobrança sandbox
`CREDIT_CARD` de R$ 10,00. O readback autoritativo confirmou `CONFIRMED`, `deleted=false`, sem
chargeback e sem estorno. O `payment.id` está somente em
`.playwright/asaas-chargeback-fixture.json`, ignorado pelo Git; não foi impresso na documentação.

**Retorno do Asaas e readback da fixture global histórica em 01/09:** o time de Integrações informou que
disparou todos os eventos de chargeback testáveis dessa cobrança. Somente
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` não pode ser simulado porque depende do retorno de uma adquirente
real. A consulta autoritativa terminou
`CREDIT_CARD`, `REFUNDED`, `chargeback.status=DONE` e um estorno. Passando esse objeto real pelo
classificador do Qoro com `PAYMENT_REFUNDED`, o resultado foi `lost`. Assim, a prova externa do
**provider + contrato de normalização** ficou verde, mas ainda não fechava D62 naquele momento.

**Limite da fixture (D62):** ela foi criada com a chave sandbox global do runner. A comparação
sanitizada de hashes mostrou que essa chave não é a credencial ativa da conta Asaas conectada à
Clínica A. Logo, pedir o chargeback desta cobrança é útil para provar que o provider consegue produzir
o estado real, mas não fecha a projeção tenant-scoped porque não existe `patient_charge` vinculado nem
entrega pela rota `/api/webhooks/asaas/patient/[ref]`. Não adicionar eventos de chargeback ao webhook
global de assinatura: são contas, contratos e donos do dinheiro diferentes.

**Como concluir a evidência externa:** o Asaas não expõe uma API para criar o chargeback inicial no
Sandbox. A própria matriz de testes do provider orienta enviar o id de uma cobrança paga em cartão ao
time de Integrações para solicitar o fluxo; o endpoint `POST /chargebacks/{id}/dispute` serve apenas
para contestar um chargeback que já foi registrado. Logo, a execução controlada é:

1. **concluído:** criar um novo Checkout sandbox `CREDIT_CARD`, resolver o reCAPTCHA e não estornar;
2. **concluído:** enviar o `payment.id` ao suporte; o Asaas disparou todos os eventos possíveis no
   Sandbox, exceto a espera de reversão dependente da adquirente;
3. **concluído:** readback final `REFUNDED` + chargeback `DONE`; classificador do Qoro = `lost`;
4. **concluído:** webhook `Qoro — cobranca de paciente` atualizado por API para o contrato canônico
   de 12 eventos; legado pausado removido e readback final validado (D67);
5. **concluído:** uma cobrança de cartão pelo fluxo real da Clínica A foi criada e vinculada a
   `patient_charges`; o Asaas disparou o chargeback desse segundo payment;
6. **concluído em 02/09:** webhook real, dedup, ledger append-only, saldo reaberto somente na perda,
   fato clínico imutável e replay zero foram provados;
7. **pendente com autorização destrutiva própria:** limpar a fixture tenant-scoped após preservar a
   evidência. A fixture global histórica não deve ser recriada.

**Atualização tenant-scoped de 01/09:** a segunda cobrança, vinculada à `patient_charge` da Clínica A,
também recebeu os disparos do suporte. O Asaas terminou `REFUNDED` + chargeback `DONE`; a rota tenant
persistiu `PAYMENT_CHARGEBACK_REQUESTED` (duas notificações com IDs distintos),
`PAYMENT_CHARGEBACK_DISPUTE` e `PAYMENT_REFUNDED`. O Payments convergiu para `refunded/lost` e publicou
três fatos monotônicos: `requested`, `in_dispute`, `lost`. Em 02/09 o runner processou somente esses
três itens pelos handlers reais: todos terminaram `processed`, `attempts=1`; surgiu exatamente uma
compensação `refund` ligada à baixa original e uma `chargeback_loss`; o recebível voltou a `pendente`
com `valorPago=0`, e o agendamento permaneceu `atendido`. A segunda passagem processou zero eventos e
manteve exatamente o mesmo ledger. O Financial está provado; falta apenas cleanup autorizado.

Isso exige outro reCAPTCHA de cartão e deixa uma cobrança paga intencionalmente aberta até o Asaas
processar a solicitação. Não reutilizar a cobrança do teste anterior, pois ela já terminou estornada.

### 20.3 Excedente pago — decisão tomada: estorno parcial (D50)

Se o paciente pagar um link antigo por valor maior que o saldo atual, devolver **somente o excedente**.
Exemplo: link de R$ 100,00, saldo atual de R$ 60,00 → aplicar R$ 60,00 e estornar R$ 40,00.

O código impede `valorPago > valor`, expõe `unappliedAmount` e agora executa o destino econômico pelo
seguinte fluxo:

1. travar o recebível e calcular `aplicado = mínimo(pago, saldo)` e `excedente = pago - aplicado`;
2. persistir uma intenção de estorno com chave idempotente antes da chamada externa;
3. chamar o estorno parcial pelo `value` exato — capacidade prevista no
   [contrato de estorno do Asaas](https://docs.asaas.com/reference/estornar-cobranca);
4. em timeout, consultar pagamento/estornos antes de qualquer nova tentativa; não fazer retry cego;
5. após confirmação autoritativa, registrar o movimento compensatório no ledger e liberar somente o
   crédito excedente;
6. se o gateway recusar ou não houver saldo disponível, manter o valor observável e abrir tarefa
   humana, sem apagar crédito nem fingir sucesso.

**Implementação de 29/08:** `patient_refund_intents` é persistida antes do POST; somente o vencedor
`pending → submitting` chama o Asaas. A baseline de estornos é lida antes do envio. Resposta incerta
fica `confirmation_pending` e nunca repete POST; webhook e cron consultam
`GET /payments/{id}/refunds`. Só a confirmação publica `payments.patient_refund.confirmed`, e o
Financial registra `excess_refund` append-only sem reduzir a parte legitimamente alocada. Recusa 4xx
fica `failed`, mantém pendência humana e emite métrica sanitizada. Unitários cobrem valor exato,
timeout, replay, 4xx, estorno negado, read-back e handlers; a regressão integral passou 2.790/2.790.
A 0092 e o smoke DB já passaram em DEV, e a produção foi migrada/verificada. PIX/cartão reais foram
pagos no Sandbox, mas essa prova isolada não exercita a intenção D50 nem o valor parcial. Falta uma
jornada integrada `patient_refund_intents → POST parcial → readback/webhook → ledger`; não classificar
o estorno integral de cleanup do runner como aceite do excedente.

**Execução externa iniciada em 01/09:** o harness operacional local e não versionado
`scripts/tmp-run-patient-excess-refund-e2e.ts`, com opt-in e guardas DEV/Sandbox/tenant, criou a
precondição real sem tocar a fixture D62: Checkout de restante por
R$ 20 e baixa manual posterior de R$ 10. O primeiro passe não recebeu `APP_BASE_URL` no shell e
reverteu integralmente antes do POST; a repetição criou uma única fixture e gravou o manifesto em
`.playwright/asaas-patient-excess-refund-fixture.json`. O pagamento headless parou na UI hospedada
antes de enviar cartão: o Web Component manteve os campos ocultos; o navegador controlado da sessão
também estava indisponível. Readback posterior provou que as três credenciais locais atuais convergem
para a conta tenant correta. O operador pagou a mesma fixture por cartão; o Asaas terminou
`CONFIRMED`, o webhook tenant marcou a charge `paid` e o Financial alocou R$ 10 dos R$ 20 recebidos.
O evento de excedente criou exatamente uma intenção de R$ 10 com baseline zero e um único POST; o
provider devolveu um refund id, mas `GET /payments/{id}/refunds` continua retornando `PENDING`. Duas
retomadas fizeram somente GET/readback e não repetiram POST. A consulta sanitizada de `/finance/balance`
confirmou inicialmente saldo Sandbox insuficiente sem expor o valor. O operador adicionou saldo e o
readback confirmou que agora é suficiente, porém dois ciclos completos de polling continuaram
retornando o mesmo refund `PENDING`. Em 03/09, outro status read-only confirmou pagamento
`CONFIRMED`, recebível `pago` em R$ 20, duas baixas somando R$ 20, uma única intenção de R$ 10 com
baseline zero e o mesmo refund `PENDING`. O estado local correto permanece `confirmation_pending` até
o Asaas devolver `DONE`; o pedido de diagnóstico já foi enviado ao suporte. Depois, o runner processa
confirmação, ledger, replay e cleanup.

### 20.4 Banco scratch — o DEV atual não serve

O banco DEV compartilhado **não** pode ser usado como scratch. O ensaio previsto cria até 5.000 jobs,
pressiona pool/locks, executa cleanup e testa restore; isso pode atrasar ou corromper o trabalho diário
e também contamina a medição.

Pode ser chamado de “DEV” apenas se for **outra instância descartável**, isolada do DEV atual. Opções
aceitáveis: projeto/branch de banco dedicado no Supabase ou Postgres local/Docker dedicado. Um schema
separado dentro do mesmo banco não isola pool, CPU, locks ou I/O e não satisfaz o gate.

Implementação final de `test:load`:

1. exigir build atual e `LOAD_TEST_CONFIRM=LOCAL_SCRATCH_ONLY`;
2. validar que a origem do schema não coincide com produção, não possui sinal de produção/Preview e
   usa TLS; usar essa origem somente em `pg_dump --schema-only`;
3. criar diretório temporário, certificado próprio, cluster PostgreSQL 17 TLS e banco com prefixo
   `clinicaos_load_`, todos locais e descartáveis;
4. restaurar o schema e inserir apenas fixtures sintéticas;
5. iniciar `next start` real com ambiente allowlisted, segredos sintéticos, Asaas desligado e preload que
   intercepta somente Meta `/messages`; qualquer outro HTTP externo falha alto;
6. executar os volumes/concorrência, exigir respostas `2xx` concluídas — não apenas requests iniciados —
   e validar estado persistido, leases, attempts, dedup e IDs do provider;
7. medir P95/P99 e comparar com os SLOs do §10;
8. no `finally`, encerrar app/SQL, parar PostgreSQL e remover somente o temp validado.

**Evidência de 28/08:** um cluster PostgreSQL 17 local e isolado foi criado fora do workspace, o dump
`prod-pre-migration-2026-08-27T04-49-51.sql` foi restaurado por `restore:test`, e as âncoras retornaram
117 tabelas, 83 policies, 3 clínicas, 41 pacientes, 48 agendamentos e 1095 eventos de auditoria. Os
erros de objetos exclusivos do Supabase (`auth`, `extensions` e roles gerenciadas) foram tolerados pelo
runbook; as âncoras obrigatórias passaram. O servidor foi parado, a porta ficou indisponível e o
diretório foi removido, portanto nenhum dado restaurado permaneceu na máquina.

**Evidência de carga de 29/08:** 500 candidatos produziram 500 jobs; 50 foram enviados pelo endpoint real
e os 4.950 restantes pelo worker C14 real. Total: 5.000 mensagens, 5.000 outbounds, 5.000 chamadas Meta
falsas únicas, `attempts=1`, replay concorrente sem novo envio, zero cancelado/retry/falha. Os 1.000
webhooks Meta assinados terminaram `2xx` e criaram 1.000 quarentenas (P95 125,14ms; P99 235,73ms).
Outbox: 5.000/5.000 `skipped`, uma tentativa cada, 12/12 crons `2xx`, P99 1,47s. Reconcile: 20/20
`2xx`, P95 33,45ms e P99 36,14ms. SQL: 100 amostras, P95 2,22ms e P99 3,18ms. C14 P99 de batch
2,35s. Zero deadlock. O servidor foi parado e o diretório temporário removido.

**Ação manual:** nenhuma para repetir o P8 na máquina já preparada. É necessário ter PostgreSQL 17
local e um build atual; o operador apenas fornece a confirmação exata. Não apontar o comando a outro
banco nem copiar credenciais para argumentos/logs.

### 20.5 Como provar o webhook global de assinatura (`PAYMENT_RESTORED`)

Um `HTTP 200`, o painel mostrar `enabled=true` ou `interrupted=false` **não provam** a restauração. A
prova é o mesmo pagamento atravessar os dois estados no Asaas e a mesma invoice atravessar os dois
estados no Qoro.

O bloqueio de código **D54** foi corrigido: `cancelled` continua terminal na máquina genérica, mas o
sincronizador reabre por CAS quando `getPayment()` confirma que a mesma cobrança voltou a existir em
estado pagável. Se ela já estiver paga ou vencida por entrega fora de ordem, o caminho único existente
aplica `paid`/`overdue` depois da reabertura. O D55 também foi fechado: remoção com
`200 + deleted:true` é tratada como `{ exists:false }`, sem confiar no status antigo.

Código: 73/73 focados, suíte integral, build e gates verdes. A prova externa também foi concluída em
02/09:

> **Correção de escopo em 01/09:** os retestes descritos nos parágrafos seguintes até D66 foram
> executados com a credencial da conta Sandbox anterior. Permanecem como histórico técnico do runner,
> mas não são evidência de aceite da conta alvo atual. A repetição válida começa somente depois de
> recriar o webhook global `qoro dev` na conta alvo. Essa repetição válida foi concluída em 02/09.

Reteste de borda em 31/08: após o redeploy informado pelo operador, um POST `{}` com token e bypass chegou
à aplicação e retornou `400` por payload inválido. Isso prova que Vercel e autenticação do webhook foram
atravessados; `401` não reapareceu. O readback da API confirmou um único webhook `qorodev` no alias
estável do Preview, `enabled=true`, `interrupted=false`, `NON_SEQUENTIALLY` e exatamente os sete eventos
canônicos. A configuração da borda está **PASS**.

O probe autoritativo seguinte encontrou **D65**: três corpos `PAYMENT_CREATED`, cada um referenciando uma
cobrança real já consultável pela chave sandbox local, passaram pela autenticação do Preview e retornaram
`500`. Assim, o runtime publicado possui a env obrigatória, mas sua `ASAAS_API_KEY`/`ASAAS_BASE_URL` não
consegue consultar a mesma conta sandbox. As duas fixtures antigas foram canceladas/removidas no Asaas e
apagadas do DEV com verificação de resíduo. O runner `billing:delete-restore-e2e` agora cria e limpa sua
própria fixture, aguarda a geração assíncrona da cobrança até o timeout controlado e limpa provider +
banco mesmo em falha. Duas repetições após o redeploy também devolveram `500`, agora classificado de
forma segura como `estágio=verification`; portanto a falha acontece no `getPayment`, antes da
transação de banco. A inspeção sem expor valores confirmou que `ASAAS_API_KEY_DEV` e
`ASAAS_BASE_URL_DEV`, efetivas nos scripts locais, diferem de seus nomes canônicos. Na Vercel Preview,
`NODE_ENV=production` faz o runtime ler somente os nomes canônicos.

**Reteste em 01/09:** depois de copiar os valores efetivos e redeployar, o bootstrap do runner passou
por `getPayment`, criou a invoice `open` e avançou ao DELETE; D65 está resolvido. O Asaas aceitou a
exclusão, mas nenhum `PAYMENT_DELETED` chegou em 90 segundos nem durante a observação adicional. Não
houve linha tardia em `processed_webhooks`. O readback da mesma conta confirmou novamente o único
webhook no Preview com bypass, `enabled=true`, `interrupted=false`, `apiVersion=3`, sete eventos e
`NON_SEQUENTIALLY`. A fixture foi removida do provider e do DEV. Esse novo bloqueio é D66: a API não
expõe logs de entrega; somente a tela `Integrações → Logs de Webhooks` distingue evento não gerado de
tentativa recusada/timeout.

**Prova válida de 02/09 na conta alvo:** após autorização explícita, o runner leu o manifesto D50 v2,
comparou fingerprints e confirmou que a credencial global consulta uma cobrança da mesma conta. Em
seguida criou `qoro dev` na rota global do Preview com bypass, token, `apiVersion=3`, ativo/não
interrompido, `NON_SEQUENTIALLY` e exatamente os sete eventos abaixo. A mesma cobrança sintética
percorreu `PAYMENT_DELETED → invoice cancelled → PAYMENT_RESTORED → invoice open`. A segunda passagem
não criou transição, invoice ou processamento duplicado. O `finally` removeu a cobrança no provider e
a fixture no banco; o pós-check encontrou zero fixture ativa. Um readback independente confirmou que
existem exatamente dois webhooks na conta alvo: global 7/não sequencial e paciente 12/sequencial.

O mesmo pós-check encontrou 4 `checkout_sessions` e 4 `tenant_provisioning` órfãos de execuções
históricas, sem clínica/subscription/billing customer correspondente. Eles não foram criados pelo
round-trip atual: o preflight iniciou com zero fixture ativa e o cleanup exato terminou em zero. Em
03/09, o D69 recebeu autorização separada e removeu exatamente essas oito linhas em DEV após backup,
lock e transação; o verificador amplo confirmou zero resíduo histórico. Isso não altera o `PASS` da
prova original.

1. escolher **um** ambiente controlado e seu banco correspondente; usar alias estável;
2. alinhar o `ASAAS_WEBHOOK_TOKEN` do runtime com o `authToken` do webhook da conta Asaas do Qoro;
3. se for Preview protegido, colocar o bypass da Vercel na URL configurada no Asaas, sem expor o
   segredo em log/evidência;
4. configurar somente `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PAYMENT_REFUNDED`, `PAYMENT_DELETED` e `PAYMENT_RESTORED`, com `NON_SEQUENTIALLY`;
5. confirmar com POST sem token que a resposta é o `401 invalid token` do Qoro, não HTML/redirect da
   Vercel;
6. criar uma assinatura/cobrança sandbox descartável vinculada a uma clínica e invoice sintéticas;
7. excluir a cobrança no Asaas; exigir entrega `PAYMENT_DELETED` HTTP 200, linha em
   `processed_webhooks` e invoice `cancelled`;
8. restaurar **a mesma cobrança**; exigir `PAYMENT_RESTORED` HTTP 200, segunda linha de dedup e a mesma
   invoice `open`;
9. reenviar/reprocessar o mesmo evento e provar que não nasce outra transição, invoice ou evento
   financeiro;
10. registrar timestamps e ids sanitizados do log de entrega, estado no banco, audit/outbox e
    resultado do reconcile; remover a fixture e verificar resíduo zero.

| Evidência | Resultado exigido |
| --- | --- |
| painel Asaas | ambas as entregas retornaram HTTP 200 |
| `processed_webhooks` | um registro por event id; replay não aumenta cardinalidade |
| `invoices` | mesma linha: `open → cancelled → open` |
| auditoria/outbox | uma transição por fato, nenhuma duplicata |
| reconcile seguinte | sem divergência Asaas↔Qoro |

Esse teste muta sandbox e banco. Foi executado com autorização explícita e conta/ambiente controlados;
um POST inventado diretamente na rota não substituiria a prova, pois o handler consulta o Asaas como
fonte da verdade.

### 20.6 Quais testes bloqueiam o quê

| Pendência | Fecha Camada 1 / rollout financeiro? | Impede discovery TISS? | Motivo |
| --- | --- | --- | --- |
| D24 PIX/cartão implementado e provado | **código/DB/pagamento externo PASS; D77 `CANCELLED` PASS e `DONE` BLOCKED** | não | boleto foi removido e os dois métodos pagaram. Duas provas pós-rollout fizeram um refund cada, sem duplicata e com proteção/cleanup; ambas terminaram `CANCELLED`. A última foi sincronizada. D80 requer suporte antes de novo teste |
| D27 chargeback confirmado, implementado e testado | ✅ **código + DB DEV/PROD + provider sandbox + webhook/Payments/Financial tenant + cleanup PASS** | não | D62 atravessou perda, compensação, saldo reaberto, fato clínico preservado e replay 0/3; 16 linhas sintéticas foram removidas sem mutação do provider e sem resíduo da fixture |
| D50 estorno do excedente + sandbox | **código/DB/pagamento/webhook/POST parcial PASS; confirmação provider pendente** | não | saldo já está suficiente, mas o Asaas mantém um único refund de R$ 10 em `PENDING`; a hipótese de “Ações críticas” foi retirada. Suporte deve diagnosticar o refund existente antes de ledger/replay/cleanup |
| `PAYMENT_RESTORED` real (D54/D55) | ✅ **PASS externo de Billing/assinatura** | não | `qoro dev` foi criado na conta alvo; delete/restore, invoice cancelada/reaberta, replay e cleanup foram provados pelo runner |
| E2E Meta de sinal/restante | ✅ **PASS até o aparelho** | não | transporte aplicação → C14 → Meta, message ids, jobs terminais, replay e chegada das duas mensagens com links foram confirmados. Os links expiraram depois do cleanup intencional |
| `test:load` em app scratch | ✅ **PASS; não é mais pendência** | não | carga local descartável mediu C14/webhook/outbox/reconcile/SQL, SLOs, dedup e deadlocks; cleanup integral |
| Product Acceptance técnico-normativo | ✅ **PASS local + deployment + Preview** | não | 150/150 focados, deployment `42cd114` `success`, navegação autenticada 6/6 sem `pageerror` e matriz visual pós-deploy 8/8/72 estados |
| Usabilidade humana por persona | **não para iniciar 1.S; sim para expandir após a onda piloto** | não | percepção de secretária/médico reais não pode ser fabricada pelo agente nem pelo fundador; colher na clínica piloto |
| rotação da chave sandbox exposta | **risco aceito temporariamente pelo fundador** | não | não bloqueia o sandbox, mas continua pendente por higiene operacional; templates, conexão e destinatário já permitiram o E2E real até `accepted` |

Portanto, os pendentes **não impediram** ADRs, D24/D27/D50 nem impedem iniciar um spike documental de
TISS. O refund D50 ainda precisa chegar a estado terminal no provider. D60/D70 já foram publicados e
reobservados, então 1.S pode começar; a percepção humana será validada na clínica piloto e bloqueia a
expansão do rollout, não o começo da estabilização.

### 20.7 O que falta para fechar o financeiro

**Diagnóstico atualizado em 06/09/2026:** D24/D58, D50 e D27 estão completos em código, tipagem, unitários,
contratos, regressão e banco DEV. `0091` + `0092` estão aplicadas em DEV e seus smokes conectados
passaram 5/5 com cleanup zero. Após a rotação da credencial, o migrador aplicou `0091` + `0092` em
produção com backup de 2.834.598 bytes, advisory lock adquirido/liberado e `DONE`. A verificação SQL
pós-migration passou 7/7 em transação read-only. P11/D77 também está completo em código, DEV e rollout:
0094 aplicada em produção com backup de 2.661.164 bytes e pós-check 9/9; `f2c1b60` publicado/deployado;
Preview 6/6; 104/104 focados e smoke DEV 7/7. A prova PIX pós-rollout chegou a `CANCELLED`, preservou
`paid`/`available` e teve cleanup local exato. D79 corrigiu a correlação real do refund; a regressão
integral atual passou 2.977/2.977. Uma segunda tentativa pós-rollout, sincronizada com o operador,
também terminou `CANCELLED`; o ramo externo `DONE` permanece `BLOCKED` pelo D80.

| Bloco | Estado real | O que falta para ficar verde |
| --- | --- | --- |
| **D24/D58 — somente PIX/cartão por 7 dias** | **Código + DB DEV + PROD + pagamentos externos verdes para criação/pagamento.** Checkout hospedado, intenção/lease, correlação, gerações e renovação implementados; smoke 5/5 e pós-verificação 7/7. Em 04/09 a conta atual confirmou `PIX/RECEIVED` | as provas de refund terminaram `CANCELLED`, sem devolução. As duas pós-rollout demonstraram proteção, replay e cleanup; a última foi sincronizada com o operador. Não repetir antes de diagnóstico do suporte D80 |
| **D50 — excedente após baixa manual** | **Código + DB DEV/PROD + pagamento/webhook/POST parcial verdes.** Readback independente de 06/09: pagamento `CONFIRMED`; cobrança `paid`; recebível `pago` em R$ 20; duas baixas somando R$ 20; uma intenção `confirmation_pending` de R$ 10 com baseline zero; um único refund de R$ 10 ainda `PENDING`. D80 foi consultada à parte e retornou `RECEIVED` + `CANCELLED`; não há mistura. D72 está publicado e mostra o estado humano no Caixa | o pedido de diagnóstico já foi enviado ao suporte. Aguardar o refund D50 existente virar `DONE`; então o runner faz somente readback → confirmação → ledger → replay → cleanup. Não repetir POST. A visibilidade Preview passou 6/6 + prova `/caixa` específica; isso não transforma `PENDING` em devolução |
| **D27 — chargeback/dinheiro desfeito** | ✅ **Código + ADR-052 + DB DEV/PROD + provider sandbox + webhook/Payments/Financial tenant + cleanup verdes.** O provider terminou `REFUNDED/DONE`; a rota tenant marcou a cobrança `refunded/lost`; os três fatos reais de risco foram processados uma vez | nada funcional. O ledger provado continha compensação `refund`, `chargeback_loss`, saldo reaberto, atendimento preservado e replay 0/3; o cleanup removeu 16 linhas sintéticas, preservou audit de webhook e deixou zero resíduo da fixture |
| **D77 — confirmação terminal do estorno do sinal** | ✅ **Código + DB DEV/PROD + Preview verdes; `CANCELLED` externo PASS.** Intenção antes do POST, claim concorrente, baseline, webhook/cron readback e fechamento atômico implementados. Duas provas pós-rollout criaram um refund cada, não duplicaram no replay, terminaram `failed/paid/available` e foram limpas localmente. D79 corrige a correlação do formato real | `DONE → refunded` está bloqueado pelo D80: a tentativa com runner pausado e operador no painel também foi cancelada. Abrir suporte; não repetir POST nem criar nova fixture |

#### Decisão D58 confirmada — prazo do restante

O código atual dá **7 dias** ao link do restante (`REMAINDER_DUE_DAYS = 7`). O Checkout hospedado do
Asaas aceita `minutesToExpire` entre 10 e **1.440 minutos**, portanto no máximo **24 horas**. Trocar
`UNDEFINED` por Checkout sem decidir isso reduziria silenciosamente uma regra de 7 dias para 1 dia.

**Decisão confirmada em 29/08:** preservar os 7 dias e modelar gerações de Checkout sem criar outra
`patient_charge`. Cada geração dura no máximo 24 horas, tem identidade/lease/estado próprios e
substitui o link anterior. A dívida local e o recebível continuam únicos; a renovação diária publica
um novo `payments.patient_charge.link_ready`, cuja deduplicação inclui a geração. Links de gerações
anteriores nunca são retornados por `getPayableCharge`. Não haverá redução silenciosa da promessa,
nova cobrança local ou retry cego de `POST /checkouts`.

#### Ordem de execução atual

1. **concluído:** autorização recebida; `0092` aplicada em DEV e `smoke:payments-money-db` verde 5/5,
   com cleanup zero;
2. **concluído por confirmação humana:** senha de produção rotacionada e consumidores atualizados;
3. **concluído:** backup + migrador com advisory lock aplicaram `0091` e `0092`; `DONE`, lock liberado,
   credencial efêmera removida e nenhum sentinel criado;
4. **concluído:** nova rotação confirmada e verificação de produção 7/7 em transação read-only;
5. **concluído e repetido em 31/08:** lint, typecheck, **2.812/2.812 testes em 310 arquivos**, build,
   arquitetura sem ciclos, migrations, registry e observabilidade verdes; o Checkout hospedado foi
   corrigido por D63 e o runner Meta passou até `accepted`, com replay e cleanup verificados;
6. **concluído:** commit executável `8bf193e` enviado à branch; Vercel terminal `success` e Preview
   read-only 8/8 em 1,8 min no mesmo SHA, com 25 rotas estáticas HTTP 200 e artefatos autenticados
   gerados pela execução removidos;
7. **concluído:** P8 `test:load` scratch-only passou em todos os volumes/SLOs, sem duplicata, retry,
   falha, deadlock ou resíduo; D61 foi corrigido e coberto;
8. **concluído até a fronteira do provider:** fixture D50 paga, webhook observado, R$ 10 alocados e
   um único refund parcial de R$ 10 enviado; estado `PENDING`, manifesto preservado e D62 intocada;
9. **ação externa já encaminhada:** a mensagem sobre o refund D50 `PENDING` foi enviada ao suporte;
   aguardar o retorno/estado terminal sem repetir POST. **Ação humana final:** concluir Product
   Acceptance. As duas mensagens Meta chegaram ao aparelho com links; o chargeback D62 não depende
   mais do suporte. O PIX antigo pertence à conta Sandbox anterior e fica `NOT COMPLETED`;
10. **concluído em 02/09:** o runner vinculou o manifesto D62 a um fingerprint não reversível da
    conta Asaas; processou `requested → in_dispute → lost` pelos handlers reais, tocando zero eventos
    alheios; criou exatamente uma compensação ligada à baixa, reabriu R$ 10, preservou o atendimento e
    provou replay com zero reprocessamento;
11. **concluído em 02/09:** com autorizações separadas, o cleanup D62 removeu 16 linhas sintéticas sem
    mutar o provider e terminou sem resíduo; o runner criou `qoro dev` na conta alvo, provou
    `PAYMENT_DELETED → PAYMENT_RESTORED`, replay e cleanup. O pós-check confirmou os dois webhooks;
12. **pendente técnico externo:** quando o refund D50 sair de `PENDING`, retomar somente readback,
    ledger, replay e cleanup;
13. **concluído em 03/09:** D69 recebeu autorização própria. Dry-run identificou exatamente quatro
    `checkout_sessions` e quatro `tenant_provisioning` históricos, sem clínica ativa; backup local,
    advisory lock, transação e pós-check removeram 4 + 4 e confirmaram zero resíduo;
14. **concluído localmente e no Preview em 04/09:** Product Acceptance técnico-normativo executou
    150/150 testes, publicou D60/D70 em `42cd114`, passou 6/6 na navegação autenticada e 8/8/72 na
    matriz visual pós-deploy sem `pageerror`; artefatos autenticados foram removidos;
15. **concluído em 05/09:** P11/D77 foi separado de D78 e integrado com a `main` sem reescrever histórico,
    publicado na branch em `f2c1b60`, recebeu migration PROD 0094 com pós-check 9/9 e passou no Preview
    6/6; a nova prova PIX fez um único refund e provou replay sem duplicata;
16. **concluído em 06/09:** o refund D77 terminou `CANCELLED`; readback/reconcile preservou cobrança
    `paid` e crédito `available`, e o cleanup local exato removeu a fixture/manifesto. D79 corrigiu a
    correlação errada do id da cobrança devolvido pelo POST; commit `0181939`, deployment `success`,
    Preview 6/6 e gates locais 2.977/2.977 verdes;
17. **bloqueado externamente em 06/09 (D80):** a nova fixture com operador sincronizado também terminou
    `CANCELLED`, com um único refund, replay seguro e cleanup local. Abrir suporte Asaas com timestamps
    sanitizados; não criar outra fixture;
18. iniciar 1.S. A usabilidade humana passa para a clínica piloto e não
    deve ser encenada pelo fundador.

#### O que não bloqueia a implementação do Financial

- **D54/D55 + `PAYMENT_RESTORED`:** Billing da assinatura que a clínica paga ao Qoro. Código,
  credencial, webhook e prova externa estão verdes; não bloqueia mais a Camada 1;
- **E2E Meta de sinal/restante:** está verde até o aparelho e não bloqueia mais o fechamento;
- **Product Acceptance por persona:** a parte técnico-normativa foi executada pelo agente. A percepção
  de uso por pessoas reais pertence à clínica piloto, não é pré-requisito para implementar os três
  gaps financeiros nem para iniciar 1.S; bloqueia expandir o rollout se revelar problema relevante;
- **reCAPTCHA e saldo:** não são mais lacunas — o operador pagou a fixture D50 e adicionou saldo
  suficiente. D77 `CANCELLED` foi reconciliado e limpo; o bloqueio externo atual é D50 ainda
  `PENDING` e o bloqueio D80 da prova D77 `DONE`.

#### Critério objetivo de fechamento

O **código e os bancos DEV/PROD** do Financial de pagamentos do paciente cobrem D24, D50, D27 e D77:
0091/0092 e 0094 estão aplicadas em produção; o pós-check da 0094 passou 9/9. O corretivo D77 foi
publicado em `f2c1b60`, teve deployment Vercel `success` e Preview 6/6. Portanto, código, banco e rollout
estão verdes; o closeout continua parcial somente na fronteira externa porque `CANCELLED` foi provado,
mas `DONE → refunded` está bloqueado no provider após repetição sincronizada.
O pagamento real PIX/cartão foi provado. O cleanup PIX da conta Sandbox anterior não ocorreu e ficou
`NOT COMPLETED` depois da remoção do webhook e das chaves antigas. Provider, webhook tenant, Payments,
Financial, replay e cleanup do chargeback D62 foram provados sem mocks. Billing restore e Meta também
estão verdes. A **Camada 1 inteira** só fecha depois da prova externa `DONE` de D77 e do estado
terminal/cleanup da D50; a 1.S, D60/D70 e o Product Acceptance técnico já estão
publicados/revalidados. A percepção humana é gate
para expandir além da clínica piloto. Carga não é mais bloqueio.

O corretivo D72 está implementado, publicado e revalidado: o Caixa distingue estorno aguardando
confirmação, confirmado, cancelado sem devolução e falha, sem expor ids do provider e sem adicionar
qualquer ação de retry. O Preview passou 6/6 e a prova específica de `/caixa` passou com a D50. Isso
melhora a operação, mas não transforma `PENDING` em `DONE` nem fecha os dois gates externos acima.

### 20.8 TISS: o que pode começar agora e qual “sistema” está citado

O documento atual **não cita um fornecedor/intermediário de TISS**. O sistema externo nomeado é a
**Memed**, mas ela aparece na Camada 2 para prescrição digital; não é a integração TISS descrita no P3.
Se existe outro fornecedor pretendido, o nome precisa ser informado antes de desenhar o contrato.

O TISS é o padrão obrigatório da ANS para troca de informações na saúde suplementar e envolve
componentes organizacional, conteúdo/estrutura, terminologia/TUSS, segurança/privacidade e comunicação.
A fonte de versão deve ser a página oficial do
[Padrão TISS da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss)
e a [versão vigente de julho de 2026](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-julho-2026).
A TUSS deve vir da [fonte oficial da ANS](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/codigos-da-tuss),
não de uma lista fixa inventada no código.

Pode começar **agora**, sem quebrar o scope freeze, um **TISS-0 — spike somente leitura/documental**:

1. listar operadoras reais da clínica piloto, contratos, portais e fluxos atuais;
2. identificar as guias realmente necessárias: consulta, autorização, lote, protocolo, glosa/recurso e
   demonstrativos — sem assumir que todas entram na primeira versão;
3. fixar versões TISS/TUSS, XML/XSD/WSDL, certificado e requisitos de segurança aplicáveis;
4. comparar duas estratégias: integração direta por operadora versus fornecedor/clearinghouse;
5. mapear somente os dados necessários entre paciente, profissional, agendamento, procedimento e
   recebível, preservando LGPD, RLS e multi-tenancy;
6. produzir ADR, contrato, riscos, custos, dependências comerciais e plano de testes com arquivos XML
   oficiais/sanitizados;
7. dividir a entrega em uma primeira operadora/guia controlada, sem “integração universal” no primeiro
   PR.

**Ações manuais necessárias para o spike:** informar o nome do fornecedor, se houver; quais operadoras
e tipos de guia a clínica usa; fornecer exemplos anonimizados e acesso/documentação contratual por
canal seguro. O restante do discovery pode ser automatizado e documentado.

A implementação de produto TISS continua no P3 e, pela regra atual, só começa depois de `1.H` e `1.S`
verdes e das Camadas 2/3 precedentes. O **discovery** pode avançar em paralelo; o código TISS não deve
ser usado para desviar esforço dos bloqueios financeiros acima.

### 20.9 Ações manuais restantes — roteiro claro

Esta seção contém somente as ações que exigem conta, pessoa ou julgamento humano. Toda prova técnica
posterior — consulta de API/banco, dedup, estado terminal, cleanup e atualização deste documento — fica
com o agente.

#### A. Resíduo PIX da conta Sandbox anterior

O PIX criado em 30/08 pertence à conta Sandbox anterior. Em 02/09 o operador confirmou que **nenhum
valor foi estornado**; portanto, a aprovação visual anterior nunca foi aceita como prova financeira.
O operador apagou o webhook e as chaves API da conta antiga. Essas credenciais não devem ser
reintroduzidas no Qoro apenas para consultar a fixture.

O operador tentou localizar novamente a cobrança no painel antigo e não a encontrou. O cleanup
histórico fica registrado como `NOT COMPLETED`: não recriar webhook/chaves e não repetir a operação
nessa conta. Se for útil provar PIX novamente, criar amanhã **outra fixture**, tenant-scoped, na conta
alvo atual, vinculada ao fingerprint correto e com pagamento/cleanup próprios. Esse novo teste não deve
reutilizar nem ser apresentado como continuação do pagamento antigo.

Em 01/09 o operador recebeu outra notificação de falha do webhook da conta antiga. Quando a
notificação chegou, a execução D50 estava interrompida antes do pagamento, portanto não havia evento capaz de causar essa
notificação. Um `GET /myAccount` read-only, sem expor identidade, confirmou que `ASAAS_API_KEY_DEV`,
`ASAAS_CLINIC_SANDBOX_KEY` e a chave tenant gravada da Clínica A apontam todas para a conta correta.
O status read-only específico da fixture confirmou ainda que o Checkout não gerou pagamento e que
nenhuma intenção de estorno existe. Logo, a execução local atual não está roteando a cobrança pela
credencial antiga nem produziu o alerta. O último registro informado na conta antiga, às 03:00, recebeu
`401 Unauthorized`. O texto genérico do Asaas não distingue as duas origens possíveis do código neste
projeto: a aplicação responde `invalid token` quando `asaas-access-token` diverge; a Vercel também pode
responder 401 antes da aplicação quando o bypass está ausente/inválido. Para classificar, registrar nome
do webhook, host/path sem query e corpo/resposta sanitizada. Como esse webhook legado não integra a conta
alvo, a correção segura era removê-lo/desabilitá-lo — não ensinar o runtime atual a aceitar seu token.
Em 02/09 o operador removeu o webhook e as chaves API antigas. Não recolocar essas chaves no Qoro para
investigar; a validação residual será apenas visual no painel.

#### A.1 Autorizar e limpar a nova prova PIX da conta atual

Em 04/09 o agente criou, com autorização, uma fixture totalmente nova usando as variáveis DEV atuais.
Ela não depende da conta antiga e não reutiliza qualquer webhook ou chave removida. O readback provou:

1. fingerprint da credencial atual igual ao registrado no manifesto local;
2. Checkout e cobrança correlacionados;
3. `billingType=PIX`, valor de R$ 10 e pagamento `RECEIVED`;
4. exatamente um refund de R$ 10 inicialmente em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`;
5. nenhum segundo POST permitido.

O operador abriu a ação crítica e informou o código recebido no celular — o fluxo efetivo daquela
conta, em vez do token genérico de Sandbox. A API então mudou o único refund para `CANCELLED`, manteve
a cobrança `RECEIVED` e não devolveu o valor. Um `GET /finance/balance` confirmou saldo disponível
muito superior ao estorno, eliminando insuficiência de saldo como causa. O manifesto ignorado
`.playwright/asaas-pix-refund-fixture.json` foi preservado com o estado terminal. Não repetir o POST sem
autorização específica. Esta orientação histórica foi cumprida pelo rollout/reteste de D77 e foi
substituída pelo bloqueio D80: não criar nova fixture nem repetir POST antes do diagnóstico do Asaas.

#### A.2 Prova pós-rollout D77 e correção D79

Em 06/09, uma fixture tenant-scoped adicional passou pelo fluxo P11 publicado: PIX liquidado, baseline
zero, exatamente um refund e replay sem segundo POST. Após solicitar a ação crítica humana, o refund
terminou `CANCELLED`. O reconciliador marcou a intenção `failed`, manteve cobrança `paid` e crédito
`available`; a retomada read-only confirmou o mesmo estado e removeu a fixture/manifesto local,
preservando o histórico Sandbox.

Essa retomada revelou D79: a resposta do `POST /refund` é o pagamento atualizado, não um objeto de
refund, e o adapter antigo persistia o id do pagamento. O `GET /refunds` real pode devolver item sem
id; assim, uma intenção com id incorreto nunca encontrava match e o fallback antigo não rodava. O
adapter agora grava `null` e o reconciliador usa baseline quando não existe correspondência exata,
inclusive para intents antigas. Regressões para `CANCELLED` e `DONE`, suíte 2.977/2.977, lint,
typecheck, build e gates arquiteturais/operacionais passaram. O commit `0181939` foi enviado à branch,
o deployment do mesmo SHA terminou `success` e o Preview passou 6/6.

Uma nova tentativa controlada foi executada depois desse rollout. O runner validou saldo, criou a
fixture, liquidou o PIX e pausou antes do POST. Com o operador já no painel, liberou exatamente um
refund: `AWAITING_CRITICAL_ACTION_AUTHORIZATION` às 02:08:26 BRT e `CANCELLED` às 02:09:37 BRT.
Replay não criou outro refund; readback/reconcile manteve `failed/paid/available` e o cleanup local
passou. Como o runner não observa a UI do Asaas, a confirmação visual veio do operador: o painel
mostrou sucesso ao aceitar o código Sandbox. Ainda assim, a API encerrou o refund como `CANCELLED`, e
o saldo continuou subindo com os PIX pagos porque nenhum estorno chegou a `DONE`. D80 bloqueia nova
tentativa até diagnóstico do suporte; `DONE` externo segue `BLOCKED`.

#### B. Provar o round-trip do webhook global de assinatura

**Correção de conta em 01/09:** o operador confirmou qual é a conta Sandbox alvo e trocou
`ASAAS_API_KEY_DEV` local e no Preview. Um `GET /myAccount` sanitizado comprovou que a credencial
global, `ASAAS_CLINIC_SANDBOX_KEY` e a chave tenant gravada para `clinica-a` agora resolvem para a
mesma conta alvo. A evidência anterior de `qorodev` e das três tentativas de DELETE pertence à conta
anterior; não pode ser usada como aceite da configuração atual.

Na conta alvo, o webhook de paciente está verde: rota `/patient/<ref>` no Preview, bypass presente,
token aceito, API v3, `SEQUENTIALLY`, ativo/não interrompido e 12 eventos. O webhook global `qoro dev`
havia sido removido durante D67 por autorização anterior, quando ainda era tratado como legado. A
correção posterior da conta mostrou que o fluxo de Billing precisa desse segundo recurso na mesma conta
Sandbox de teste.

Execução autorizada e concluída em 02/09:

1. ✅ `qoro dev` criado em `/api/webhooks/asaas`, com token global do Preview, bypass,
   `NON_SEQUENTIALLY` e os sete eventos canônicos;
2. ✅ readback confirmou exatamente dois webhooks: global 7/não sequencial e tenant 12/sequencial,
   sem sobrepor rotas ou contratos;
3. ✅ `billing:delete-restore-e2e` recebeu `PAYMENT_DELETED`, cancelou a invoice, recebeu
   `PAYMENT_RESTORED`, reabriu a mesma invoice, provou replay e limpou provider+banco;
4. esta convergência de contas permanece restrita ao Sandbox. Produção continua exigindo separar a conta
   que recebe a assinatura do Qoro da conta que recebe pagamentos dos pacientes da clínica.

#### C. Confirmar a entrega final do E2E Meta de sinal e restante

O número conectado na Meta é o **remetente**. O destinatário controlado e consentido já foi salvo em
`.env.local` em 31/08. O valor atual usa E.164 com `+`, formato válido; o runner deve normalizá-lo para
dígitos antes de chamar a Meta, sem imprimir o número.

A conexão da Clínica A foi confirmada ativa/verificada e o E2E controlado foi executado em 31/08. Os
dois fluxos completos (`deposit_link` e `remainder_link`) criaram Checkout real, publicaram
`link_ready`, passaram pela C14, resolveram a cobrança no send-time, escolheram templates distintos e
receberam `accepted` com message id da Meta. O replay reivindicou zero jobs e o cleanup deixou zero
resíduo local/provider. As linhas de saída permanecem apenas como evidência cifrada.

Em 02/09 o operador confirmou que as **duas mensagens chegaram ao aparelho consentido, ambas com
link**. A prova real de entrega está `PASS`. Os links estavam expirados ao serem abertos porque o runner
já havia cancelado os Checkouts no cleanup; esse resultado é esperado, impede reutilizar uma cobrança
de teste e não invalida o link que foi resolvido no send-time. O teste não tentou pagar pelo WhatsApp.

Para uma configuração futura, não publicar o telefone no chat e salvar:

```dotenv
META_E2E_RECIPIENT_E164=+5511999999999
```

O número deve estar em E.164 e pertencer a uma pessoa que consentiu com os dois envios. O teste válido percorre
`link_ready → C14 → lookup no send-time → template aprovado → Meta → telefone`, separadamente para
`deposit_link` e `remainder_link`; um envio direto pelo utilitário de template não substitui esse E2E.

#### D. Concluir a confirmação e o cleanup da fixture D50

A fixture integrada já atravessou o fluxo real da Clínica A:

1. cobrança de restante/Checkout Sandbox de **R$ 20**;
2. baixa manual sintética posterior de **R$ 10** no recebível;
3. pagamento por cartão confirmado e webhook tenant observado;
4. R$ 10 alocados ao recebível e excedente calculado em R$ 10;
5. exatamente uma intenção/um POST parcial de R$ 10, baseline zero;
6. saldo Sandbox adicionado e confirmado como suficiente;
7. refund do Asaas ainda `PENDING`; novo readback em 06/09 manteve o mesmo estado e confirmou que
   pagamento, baixa, intenção e refund continuam coerentes e únicos;
8. manifesto local ignorado pelo Git em
   `.playwright/asaas-patient-excess-refund-fixture.json`; em 02/09 ele foi atualizado para v2 com
   fingerprint não reversível após a conta atual reler exatamente o mesmo pagamento;
9. cobrança D62 de chargeback preservada e não modificada.

A ação humana específica da D50 é pedir ao suporte Asaas que diagnostique/conclua o refund `PENDING`
da **conta alvo**, enviando o ID somente no canal seguro. A tentativa de autorização vista na **conta
antiga** não resultou em estorno PIX; o webhook e as chaves dessa conta foram removidos e não devem ser
recriados. Não repetir o estorno da D50, não criar outro Checkout D50 e não cancelar o refund pelo
painel. Informar somente `refund D50 concluído` ou a resposta sanitizada do suporte.

Depois, o agente fará somente readback/reconcile, processará o evento confirmado, exigirá ajuste
append-only/replay zero e limpará os recursos locais/provider. Procedimento oficial:
[acompanhar estornos](https://docs.asaas.com/docs/refunds). O saldo adicionado permanece necessário
também para estornar os R$ 10 restantes durante o cleanup integral da fixture.

#### E. Produzir um chargeback sandbox real

O Asaas não permite iniciar chargeback por um endpoint público de simulação. O endpoint de disputa só
contesta um chargeback que já existe. A prova isolada do provider já terminou:

1. ✅ uma cobrança global de cartão foi paga e entregue ao suporte;
2. ✅ o Asaas disparou todos os eventos possíveis no Sandbox, exceto
   `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, que depende da adquirente em produção;
3. ✅ o readback final mostrou `CREDIT_CARD`, `REFUNDED`, chargeback `DONE` e um estorno;
4. ✅ o classificador real do Qoro devolveu `lost`;
5. ✅ o webhook de paciente da Clínica A foi atualizado para os 12 eventos canônicos e permanece
   ativo/não interrompido na conta alvo;
6. ✅ a credencial global foi corrigida para essa mesma conta Sandbox. O antigo `qorodev` pertence à
   conta anterior e sua evidência foi invalidada; o novo `qoro dev` global foi criado e provado
   separadamente para Billing em 02/09.

Essa prova confirma o provider e o contrato de normalização, mas não atravessa a projeção financeira
tenant-scoped: a fixture global não possui `patient_charge` da Clínica A. Para fechar D62 foi
necessário:

1. ✅ fixture tenant-scoped criada: `remainder`, R$ 10, vinculada a `patient_charge` e recebível;
2. ✅ pagamento manual por cartão concluído; Asaas `CONFIRMED`, cobrança/geração `paid`;
3. ✅ handlers reais processaram somente os dois eventos próprios: crédito `allocated`, uma transação
   `payment` e recebível `pago`/R$ 10;
4. ✅ o `payment.id` foi enviado ao suporte e os eventos testáveis foram disparados;
5. ✅ o provider terminou `REFUNDED/DONE`; o webhook tenant persistiu os eventos e o Payments marcou
   `refunded/lost`;
6. ✅ em 02/09, os três fatos de risco foram processados em ordem pelos handlers reais. O Financial
   criou exatamente uma compensação `refund` ligada à baixa original, uma `chargeback_loss`, reabriu o
   saldo para R$ 10 e manteve o atendimento `atendido`;
7. ✅ a segunda passagem processou zero eventos e reconheceu os três como já processados; exatamente
   um ajuste complementar e duas transações (`payment` + `refund`) permaneceram no ledger;
8. ✅ **cleanup controlado concluído:** o runner revalidou provider, conta, estado financeiro, replay e
   contagens; removeu 16 linhas sintéticas em uma transação, preservou `patient_webhook_events`, não
   chamou o provider, removeu o manifesto somente após o pós-check e terminou com zero resíduo da
   fixture.

A fixture global anterior já terminou `REFUNDED` e não deve ser recriada nem reenviada como se ainda
estivesse `CONFIRMED`. A fixture tenant-scoped foi encerrada e seu manifesto local removido depois do
cleanup. A mensagem enviada ao suporte foi:

> Olá, Helen. Criamos uma nova cobrança em cartão no ambiente Sandbox pelo fluxo real da Clínica A e
> ela está vinculada à cobrança de paciente do Qoro. Solicito a simulação controlada dos eventos de
> chargeback possíveis no Sandbox para o `payment.id` enviado abaixo em canal seguro. Já sabemos que
> `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` depende da adquirente em produção; precisamos validar os demais
> estados pela rota tenant-scoped e pela projeção financeira. Por favor, avise quando os disparos forem
> concluídos. Não há impacto em produção.

O id deve ser inserido no canal seguro do suporte, nunca neste documento.

#### F. Observação humana por persona na clínica piloto — não executar agora

O aceite técnico/normativo que podia ser automatizado foi executado em 04/09 e está registrado na
§15. O fundador não precisa fingir ser secretária ou médico nem aprender um processo clínico interno
para liberar 1.S. O roteiro abaixo fica preservado para a **onda 1**, quando usuários reais poderão
avaliar clareza, tempo e chance de erro. Achado alto ou médio nessa onda impede expandir para a onda 2;
não invalida retroativamente os testes objetivos já verdes.

Executar no Preview, com uma clínica e dados controlados. Usar uma conta própria para cada perfil e não
compartilhar senha entre personas. Cronometrar do início ao fim e registrar `PASS` ou `FAIL`, resultado
esperado, resultado observado e uma captura sanitizada apenas quando houver falha.

Product Acceptance **não é outro teste automatizado**. Unitários, integração, Playwright e E2E provam
que o sistema executa os contratos; este gate responde se uma pessoa consegue trabalhar sem conhecer o
código, sem instruções do desenvolvedor e sem interpretar estados ambíguos. As quatro personas podem ser
representadas pela mesma pessoa, desde que ela troque de conta/papel e avalie cada jornada separadamente.
O paciente não precisa ter login no Qoro: sua interface é a mensagem consentida e o Checkout hospedado.

**Preparação única, estimativa de 30–45 minutos:**

1. usar o Preview publicado e a Clínica A, nunca produção nem dados de paciente real;
2. ter contas controladas de dono, secretária e médico, cada uma com seu papel real — não compartilhar
   uma conta administrativa para “simular” permissões;
3. criar um paciente sintético com telefone consentido e um procedimento de valor fácil de conferir;
4. abrir uma folha de registro com horário inicial, número de cliques aproximado e dúvidas encontradas;
5. não usar a fixture D50 nem repetir seu estorno. Se o roteiro criar cobrança própria, identificá-la e
   limpá-la somente depois de terminar a experiência do paciente;
6. executar a sequência **dono → secretária → médico → paciente**, pois ela forma uma única história
   operacional e evita quatro cenários desconectados.

| Persona | Jornada humana mínima | O que precisa ser julgado |
| --- | --- | --- |
| Dono | abrir Dashboard; configurar procedimento e política em Configurações/Pagamentos; revisar equipe; criar ou acompanhar consulta; conferir Caixa e Financeiro; revisar assinatura e auditoria | se encontra as configurações sem ajuda, entende sinal/restante/estorno e distingue cobrança do paciente da assinatura do Qoro |
| Secretária | localizar/cadastrar paciente; criar, remarcar e cancelar uma consulta controlada; observar estado do sinal na Agenda; abrir conversa e orientar o paciente sem acessar funções exclusivas do dono | número de passos, clareza dos estados, prevenção de duplicidade e respeito às permissões |
| Médico | abrir a própria Agenda/Consultório; localizar o paciente; iniciar e concluir o atendimento controlado; conferir que o restante nasce depois da conclusão, sem editar configurações financeiras restritas | foco clínico, ausência de distração financeira e permissões corretas |
| Paciente | receber o template consentido de sinal; abrir o link e identificar PIX/cartão; observar confirmação; após atendimento, receber o template de restante; conferir que a copy não fala em reservar horário nem duplica mensagem | compreensão, confiança, link correto/atual, acessibilidade móvel e ausência de mensagem indevida |

**Passo a passo do dono:**

1. entrar sem URL direta e localizar sozinho Agenda, Pacientes, Configurações/Pagamentos e Financeiro;
2. conferir o procedimento e explicar, com suas próprias palavras, qual valor é sinal, qual é restante e
   qual cobrança é a assinatura da clínica com o Qoro;
3. revisar a política de cobrança e o estado da integração, sem alterar secrets durante o aceite;
4. confirmar que consegue acompanhar a consulta e o recebimento, e que as informações críticas não
   dependem de conhecer nomes internos como `patient_charge` ou `remainder`;
5. marcar `FAIL` se valor, destinatário do dinheiro, estado da cobrança ou diferença entre assinatura e
   pagamento do paciente não ficarem claros.

**Passo a passo da secretária:**

1. localizar ou cadastrar o paciente sintético e criar uma consulta pelo fluxo normal;
2. conferir na Agenda se o sinal aparece uma única vez e com estado compreensível;
3. remarcar uma consulta controlada e cancelar outra, verificando que a interface explica a consequência
   financeira antes de confirmar e não duplica cobrança;
4. localizar a conversa/status necessário para orientar o paciente sem precisar abrir o banco ou pedir
   ajuda ao dono;
5. tentar acessar uma função deliberadamente restrita ao seu papel e confirmar bloqueio claro, sem vazamento
   de dados ou ação parcial.

**Passo a passo do médico:**

1. localizar a consulta em sua própria Agenda/Consultório e confirmar que não vê agenda clínica alheia;
2. abrir o paciente correto, iniciar e concluir o atendimento sintético pelo fluxo habitual;
3. conferir que a conclusão clínica permanece concluída independentemente do pagamento posterior;
4. observar que o restante nasce somente depois do atendimento, com valor coerente, sem exigir que o médico
   decida regra financeira;
5. confirmar que configurações financeiras/administrativas não ficam editáveis se o papel não as possuir.

**Passo a passo do paciente:**

1. no aparelho consentido, ler a mensagem sem contexto adicional e dizer quem cobra, por quê e quanto deve;
2. abrir o link **antes do cleanup** e verificar HTTPS, valor, clínica e opções PIX/cartão em tela móvel;
3. no sinal, conferir que a mensagem fala em garantir o horário; depois do atendimento, conferir que a
   mensagem do restante fala somente no valor pendente e não em reservar/perder vaga;
4. confirmar que não recebeu mensagem duplicada e que nenhum link de outra clínica/paciente apareceu;
5. o pagamento Sandbox completo é opcional para este julgamento de copy/navegação porque provider, webhook
   e entrega Meta já têm E2E real verde. Se for repetido, deve usar fixture nova e cleanup próprio — nunca a
   D50 pendente.

**Como decidir o resultado:**

- `PASS`: a persona concluiu sem ajuda, entendeu estados/valores e viu somente o que seu papel permite;
- `FAIL` bloqueante: acesso cross-tenant/indevido, HTTP 5xx, ação impossível, valor ou paciente errado,
  cobrança/mensagem duplicada, destinatário errado ou link antigo;
- observação média: exige correção ou aceite explícito do dono antes do rollout;
- observação baixa: pode ir ao backlog, desde que não mude dinheiro, permissão, dado clínico ou decisão do
  usuário.

Falha de autorização, HTTP 5xx, cobrança duplicada, mensagem para destinatário errado, valor errado ou
link antigo é severidade **alta** e impede o aceite. Texto confuso, excesso de cliques e hierarquia ruim
são defeitos de produto e também devem ser registrados, mesmo quando o fluxo tecnicamente conclui.

Modelo de registro:

```text
Persona:
Cenário:
Data/hora e ambiente:
Tempo:
Resultado: PASS | FAIL
Esperado:
Observado:
Categoria: produto | código | ambiente | provedor
Severidade: alta | média | baixa
Evidência sanitizada:
```

Quando as quatro linhas estiverem preenchidas, enviar os resultados sem senhas, tokens, telefone,
links de pagamento ou dados clínicos. O agente classifica os achados, automatiza o que for reproduzível
e atualiza o gate P9; o julgamento humano não é substituído pelo Playwright 8/8.

Resposta curta suficiente para devolver o aceite:

```text
Dono: PASS|FAIL — __ min — observação:
Secretária: PASS|FAIL — __ min — observação:
Médico: PASS|FAIL — __ min — observação:
Paciente: PASS|FAIL — __ min — observação:
Houve acesso indevido, valor errado, duplicidade ou HTTP 5xx? sim|não
```

**Em linguagem simples:** Product Acceptance é usar o Qoro como um cliente real usaria, sem olhar o
código e sem o agente dizer onde clicar. Não procura apenas erro técnico; verifica se nomes, estados,
permissões, mensagens e sequência de trabalho fazem sentido. Uma pessoa pode executar as personas uma
de cada vez com contas controladas. Se concluir cada roteiro e entender o resultado, marca `PASS`; se
ficar perdida, interpretar um valor errado ou conseguir acessar algo proibido, registra `FAIL`. Esse
aceite leva aproximadamente 30–45 minutos e é gate de lançamento, não de compilação.

#### G. Resultado das autorizações técnicas de 02–03/09

| Ação | Peso | O que muda | O que ela bloqueia |
| --- | --- | --- | --- |
| cleanup destrutivo da fixture D62 | **CONCLUÍDO / PASS** | removeu somente 16 linhas sintéticas tenant-scoped de DEV depois de preservar as contagens/evidências; não chamou Asaas | higiene concluída; audit de webhook preservado e zero resíduo da fixture |
| recriar/provar webhook global `PAYMENT_DELETED → PAYMENT_RESTORED` | **CONCLUÍDO / PASS** | criou configuração externa na conta Sandbox alvo, alinhou token/bypass e executou cobrança global controlada com cleanup | aceite externo do Billing/assinatura fechado; D54/D55/D66 verdes |
| cleanup dos órfãos históricos D69 | ✅ **CONCLUÍDO / PASS em DEV** | autorização recebida em 03/09; dry-run conferiu 4 `checkout_sessions` + 4 `tenant_provisioning`, `clinic_id` nulo, zero clínica ativa e FK esperada. Backup local ignorado pelo Git foi gravado antes da transação com advisory lock | exclusão exata 4 + 4; pós-check e verificador amplo confirmaram `historicalRoundtripRows=0`, `billingRoundtripActiveFixtures=0` e dois webhooks canônicos ainda íntegros |

As três ações autorizadas terminaram verdes. A limpeza D69 não tocou Asaas, produção, clínica ativa,
assinatura, cobrança de paciente ou eventos de webhook. O backup operacional está em
`backups/d69-dev-orphans-2026-09-04T00-12-43.json` (timestamp UTC, arquivo local ignorado pelo Git).

## 21. Track O — arquitetura segura do cadastro autônomo

> **Estado em 02/09/2026: DESENHO PROPOSTO PARA DISCOVERY; NÃO IMPLEMENTADO.** Esta seção é o plano
> canônico do self-service, materializado como [ADR-053 Proposed](adr/053-cadastro-autonomo-seguro.md).
> Ela não afirma que as rotas, tabelas, regras WAF, Turnstile, Google Ads ou Checkout recorrente já existem. O onboarding atual por convite continua descrito em
> [onboarding-spec.md](onboarding-spec.md). Implementar este track exige ADR próprio, scope freeze,
> migrations e autorização para mudar APIs públicas/infraestrutura.

### 21.1 Decisão arquitetural

A ideia de um token aleatório de cerca de 15 minutos é útil contra adivinhação e replay, mas **não é
proteção contra DDoS, botnet ou criação massiva de sessões**. A arquitetura recomendada separa quatro
identidades:

1. **atribuição de marketing:** identifica campanha/clique, nunca autoriza uma ação;
2. **sessão anônima de cadastro:** bootstrap curto, com autoridade mínima e sem tenant;
3. **identidade verificada:** usuário do Supabase Auth após confirmar o e-mail;
4. **sessão autenticada do produto:** só recebe acesso ao tenant depois do provisionamento confirmado.

O token anônimo não deve ir em `?token=...`. O backend cria 32 bytes aleatórios, guarda somente o HMAC
e devolve o valor bruto em cookie `__Host-qoro_signup`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
sem `Domain`, com 15 minutos de inatividade e no máximo 60 minutos absolutos. O cookie é exclusivo de
`app.qoro.dev`; a landing não recebe cookies de autenticação ou cadastro. Após a verificação do e-mail,
o token é consumido e a sessão PKCE do Supabase passa a ser a autoridade. A documentação oficial do
Supabase confirma que SSR usa PKCE e que o código de troca é curto e de uso único:
[Password Auth](https://supabase.com/docs/guides/auth/passwords) e
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Essa ordem evita criar clínica, assinatura, configurações e milhões de registros caros para e-mails
que nunca foram provados. Também evita que uma credencial anônima, ainda que forte, consiga iniciar
pagamentos ou decidir o tenant.

### 21.2 Fluxo visual completo

```text
Google Ads / acesso orgânico
        ↓
qoro.dev/comecar                 ponte de atribuição; não cria tenant/sessão no banco
        ↓  destino fixo + gclid/UTMs allowlisted + Google linker
app.qoro.dev/cadastro
        ↓
WAF/DDoS → limites edge → risco simples → desafio somente se necessário
        ↓
POST /api/signup/sessions        cookie host-only + HMAC no servidor
        ↓
e-mail + senha → Supabase Auth   resposta genérica; Qoro não guarda senha
        ↓
confirmação de e-mail / PKCE
        ↓
sessão anônima é consumida; usuário autenticado e verificado
        ↓
dados mínimos da clínica + escolha do plano resolvido no servidor
        ↓
intenção idempotente → Checkout recorrente hospedado do Asaas
        ↓
Asaas envia webhook autenticado e idempotente
        ↓
worker/saga de provisionamento
        ↓
transação: clinic + owner/profile + assinatura + configurações mínimas
        ↓
outbox pós-commit → e-mail/auditoria/tarefas de onboarding
        ↓
onboarding operacional único → dashboard
```

**Mudança em relação à ordem inicialmente proposta:** nome/e-mail podem ser coletados antes, mas a
clínica definitiva nasce somente depois de e-mail verificado e do estado de billing aceito pelo
backend. **Decisão de 02/09:** o trial self-service de sete dias começa somente quando o backend cria a
intenção idempotente e confirma por readback no Asaas que a assinatura recorrente esperada existe para
o customer, plano, valor e vencimento corretos, em estado não terminal. O redirect do navegador nunca
confirma billing. A primeira parcela pode vencer ao fim do trial; exigir sua liquidação antes eliminaria
o próprio teste grátis. Webhook e reconcile continuam autoritativos para transições posteriores.

### 21.3 Ponte de atribuição para Google Ads

Usar um endereço estável `https://qoro.dev/comecar` é recomendado para o CTA da landing e para a URL
final das campanhas. Ele não deve aceitar `next`, `redirect` ou URL de destino fornecida pelo usuário:
sempre leva a `https://app.qoro.dev/cadastro`. Assim não vira open redirect.

O endpoint/página deve:

- preservar somente `gclid`, `_gl`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e
  `utm_term`, com tipos e tamanhos máximos; descartar todo parâmetro desconhecido;
- disparar o evento de clique no Google tag conforme consentimento e redirecionar com `302/303`;
- não criar `signup_sessions`, enviar e-mail ou escrever PII em cada acesso — crawlers e
  pré-visualizadores também abrem links;
- configurar medição entre `qoro.dev` e `app.qoro.dev` com o linker. O Google recomenda preservar o
  GCLID em redirects e configurar cross-domain quando landing e conversão ficam em hosts/domínios
  diferentes: [website conversions](https://support.google.com/google-ads/answer/7521212) e
  [cross-domain measurement](https://developers.google.com/tag-platform/devguides/cross-domain);
- respeitar a decisão de consentimento antes de armazenamento/uso publicitário:
  [Consent Mode](https://developers.google.com/tag-platform/security/guides/consent).

Métricas e conversões recomendadas:

| Marco | Uso | Google Ads |
| --- | --- | --- |
| `cta_signup_clicked` | diagnóstico da landing | microconversão, não otimizar campanha só por ela |
| `signup_started` | funil após criação válida da sessão | secundária |
| `email_verified` | intenção qualificada | secundária |
| `signup_completed` | tenant provisionado | **primária inicial**, para produzir sinal suficiente à primeira campanha |
| `subscription_activated` | billing confirmado | secundária de valor; torna-se primária quando houver volume confiável |

**Decisão de 02/09:** configurar inicialmente `signup_completed` como a única ação primária e
`subscription_activated` como secundária. Quando a campanha tiver volume de ativações suficiente para
aprendizado estável, promover `subscription_activated` e rebaixar `signup_completed`; nunca manter as
duas como definições primárias concorrentes da mesma jornada.

Nunca enviar a Google nome, e-mail, telefone, CPF/CNPJ, dados clínicos, token de sessão ou URL de
Checkout. Um GCLID é identificador publicitário pseudônimo: se futuramente for necessário importá-lo
server-side, guardar cifrado, com consentimento, acesso restrito e retenção definida; para a primeira
versão, preferir o linker/tag do Google e não criar outra base de dados de marketing.

### 21.4 Responsabilidade por camada

| Camada | Obrigação | O que ela não substitui |
| --- | --- | --- |
| DNS | DNSSEC quando suportado, domínio/contas protegidos por MFA, inventário de subdomínios e remoção de CNAME órfão | WAF e autorização |
| CDN/Firewall Vercel | mitigação volumétrica, WAF, bloqueio de assinaturas/bots evidentes, limites por IP/JA4 e body/rota | limites por e-mail/token e regra de negócio |
| Rate limiting | limites multidimensionais em Redis/Upstash, `429` + `Retry-After`, quotas globais de custo | validação, CAPTCHA, autenticação |
| Bot protection | desafio adaptativo validado no backend; cooldown de alto risco | rate limit e e-mail verificado |
| Reverse proxy/Next | HTTPS/HSTS, headers, CORS restrito, origem/Fetch Metadata, body e timeout | autorização do serviço e RLS |
| Backend | Zod estrito, estado da máquina, idempotência, plano/preço server-side, erros genéricos | WAF e banco |
| AuthN/AuthZ | Supabase Auth, e-mail verificado, sessão/epoch, RBAC e step-up MFA | isolamento de linha no banco |
| Application services | saga de cadastro/billing e boundaries `onboarding → tenancy/identity/billing` | decisões pelo frontend |
| Postgres | constraints, transações, RLS/FORCE RLS, grants mínimos, pool/timeout e outbox | validação da entrada externa |
| Observabilidade | métricas, auditoria sanitizada, alertas de abuso/custo/falha | controle preventivo |

O firewall de plataforma já cobre parte do DDoS, enquanto regras WAF controlam o tráfego que alcança
funções e serviços cobrados. Referência oficial:
[Vercel Firewall](https://vercel.com/docs/vercel-firewall) e
[WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

### 21.5 Modelo de dados da sessão de cadastro

Criar uma tabela global de plataforma, não tenant-scoped, acessível somente por um serviço mínimo
allowlisted conforme [ADR-010](adr/010-security-definer-patterns.md). Ela não recebe grants diretos de
`anon`/`authenticated`; o navegador sempre passa pelos endpoints do onboarding.

```text
signup_sessions
  id uuid pk
  token_hash text unique not null          HMAC-SHA256; nunca token bruto
  status enum not null                     initiated | identity_pending | email_verified |
                                           details_complete | checkout_pending |
                                           provisioning | completed | expired | blocked | failed
  auth_user_id uuid unique null            preenchido somente após e-mail verificado
  email_hash text null                     HMAC normalizado; nunca usado para enviar e-mail
  owner_name text null                     curto e temporário
  clinic_name text null                    curto e temporário
  selected_plan_id uuid null               FK; preço nunca vem do cliente
  attribution jsonb null                   somente chaves allowlisted e limitadas
  risk_level smallint not null default 0
  failed_attempts smallint not null default 0
  row_version integer not null default 1
  idle_expires_at timestamptz not null
  absolute_expires_at timestamptz not null
  consumed_at timestamptz null
  completed_at timestamptz null
  created_at / updated_at timestamptz

signup_billing_intents
  id uuid pk
  signup_session_id uuid unique not null
  idempotency_key text unique not null
  provider_customer_id text null
  provider_checkout_id text unique null
  provider_subscription_id text unique null
  status enum not null                     creating | pending | confirmed | failed | cancelled
  provider_status text null                código sanitizado
  lease_token / lease_expires_at / attempts
  created_at / updated_at / confirmed_at
```

Não guardar senha, PAN, CVV, token Turnstile, token PKCE, raw IP, raw e-mail em contador, dados clínicos
ou corpo bruto de webhook. Nome do owner/clínica é staging de curta duração; limpar sessões expiradas
em lote pequeno. O pagamento hospedado coleta dados do pagador; Qoro guarda apenas referências e
status necessários. O Asaas documenta Checkout recorrente e recomenda idempotência pelo id do evento:
[Asaas Checkout](https://docs.asaas.com/docs/asaas-checkout).

Índices mínimos: `token_hash`, `auth_user_id`, `status + idle_expires_at`, `email_hash + created_at`,
`provider_checkout_id`, `provider_subscription_id` e idempotency key. Constraints impedem `completed`
sem `auth_user_id`, plano e billing confirmado. A criação final de `clinics` + profile owner + billing é
uma única transação; I/O Supabase/Asaas fica fora dela e usa saga/compensação/outbox.

### 21.6 Ciclo de vida do token

- **Geração:** `crypto.randomBytes(32)` (256 bits), base64url; CSPRNG obrigatório.
- **Armazenamento:** somente HMAC-SHA256 com segredo versionado; comparação em tempo constante.
- **Escopo:** iniciar/ver o próprio draft e solicitar criação da identidade; não autoriza pagamento,
  tenant, papel ou acesso ao dashboard.
- **Expiração:** 15 min de inatividade, 60 min absolutos. Atividade válida renova somente o idle TTL.
- **Uso único:** CAS por `status + row_version`; ao verificar e-mail, preencher `consumed_at` e apagar o
  cookie anônimo.
- **Tentativas:** contador transacional pequeno, além dos buckets Redis; excedeu, `blocked` + cooldown.
- **Replay:** token consumido/expirado devolve resposta genérica `410`; não reabre estado.
- **Rotação:** nova sessão gera novo token/hash e invalida o anterior; rotação de segredo aceita apenas
  versão anterior por janela curta, sem prolongar TTL.
- **Refresh:** recarregar a página usa o mesmo cookie e retorna o estado sanitizado.
- **Várias abas:** compartilham cookie; toda escrita exige `row_version`. A aba perdedora recebe `409`
  e recarrega, sem duplicar e-mail, checkout ou tenant.
- **Outro dispositivo:** o token não é transferido. O link pode confirmar o e-mail; para continuar no
  segundo aparelho, autenticar-se e criar uma nova sessão ligada ao mesmo `auth_user_id`. Não pôr token
  de cadastro na URL para “facilitar”.
- **Expirou:** limpar staging/atribuição segundo retenção; usuário verificado pode retomar autenticado,
  usuário não verificado começa de novo sujeito aos mesmos limites.

### 21.7 Rate limiting multidimensional

Reutilizar Upstash e o padrão atual de `src/lib/auth/rate-limit.ts`. O algoritmo principal da aplicação
deve ser **sliding window**, porque evita a rajada na fronteira de duas janelas e já é a convenção do
projeto. No edge, usar o algoritmo disponível no plano Vercel; token bucket é bom para permitir bursts
curtos com reposição contínua, fixed window é aceitável como primeira barreira barata e leaky bucket é
mais útil quando a saída precisa de cadência constante. Nenhum algoritmo substitui quotas por custo.

Limites iniciais, todos configuráveis e sujeitos a ajuste por telemetria:

| Endpoint/ação | Dimensões | Limite inicial |
| --- | --- | --- |
| `GET /comecar` | WAF IP/JA4 | 120/min; não escreve banco |
| criar sessão | IP + cookie dispositivo + global | 5/15 min/IP, 3/15 min/dispositivo, cap global por minuto |
| enviar identidade | IP + sessão + HMAC(e-mail) | 10/15 min/IP, 5/sessão, 3/h/e-mail |
| reenviar verificação | IP + sessão + HMAC(e-mail) | 10/h/IP, 3/h/sessão e e-mail, cooldown 60 s |
| consultar sessão | IP + token | 60/15 min/token; payload constante e pequeno |
| salvar clínica/plano | usuário + sessão | 30/15 min, CAS obrigatório |
| criar Checkout | usuário + sessão + global | 3/h/sessão, 2/h/usuário; uma intenção ativa |
| login atual | IP + HMAC(e-mail) | preservar 10/15 min e 5/15 min existentes |
| password reset atual | IP + HMAC(e-mail) | preservar 10/h e 3/h existentes |
| envio futuro por telefone | IP + HMAC(E.164) + usuário | 3/h e 5/dia por telefone; uma finalidade por vez |
| webhook Asaas | token/contrato + event id | não depender só de IP; body/timeouts e circuit próprios |

IP sozinho falha contra botnet e prejudica NAT de clínicas. E-mail/telefone sozinhos permitem atacar
terceiros. Por isso a decisão usa interseção de sinais e respostas genéricas. O “dispositivo” é um
cookie aleatório host-only, não fingerprint invasivo; pode ser apagado e nunca vira identidade. IPv6
continua normalizado por `/64`. Buckets de e-mail, telefone e IP usam HMAC rotacionável e TTL, nunca o
valor em claro.

Para criação de sessão, e-mail/SMS e Checkout — operações com amplificação de custo — indisponibilidade
do Redis deve falhar de forma **fechada ou fortemente degradada**, com um orçamento local mínimo e
circuit global. O fail-open genérico atual é aceitável para UX em rotas menos custosas, mas não para um
endpoint anônimo capaz de criar milhões de registros ou e-mails. Supabase possui limites próprios, que
são uma última barreira e não substituem os do Qoro:
[Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### 21.8 Bot protection adaptativa

Não mostrar CAPTCHA para todos. Um classificador simples e determinístico soma sinais já disponíveis:
velocidade por IP/sessão/e-mail/dispositivo, tokens inválidos ou repetidos, falhas de schema, origem
cross-site, assinatura WAF/bot e repetição de ações de custo. Não usar raça, localização clínica,
conteúdo do nome ou fingerprint oculto.

```text
risco baixo     → prossegue sem desafio
risco moderado  → Turnstile; token validado uma vez no backend
risco alto      → 429/cooldown; não cria sessão, usuário, e-mail ou Checkout
```

Turnstile é a recomendação inicial por custo e integração simples, mas só vale após validação server-side;
os tokens expiram em cinco minutos e são single-use:
[validação oficial](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
Usar chaves de teste oficiais em unit/integration e chaves separadas por ambiente. Proof-of-work e um
motor antifraude externo ficam opcionais; só entram se métricas mostrarem abuso distribuído que
WAF+limites+desafio não contêm.

### 21.9 Validação, XSS, CSRF e manipulação de parâmetros

**Frontend:** apenas UX — máscara, mensagens, força de senha e progresso. Tudo pode ser ignorado.

**Backend obrigatório:** Zod `.strict()`, normalização canônica, enums allowlisted, limites de tamanho,
datas/UUIDs válidos, rejeição de campos extras e body global pequeno (por exemplo 16 KiB no cadastro).
Plano, preço, duração do trial, role `owner`, `clinic_id`, status de pagamento e redirect vêm do
servidor. Drizzle/queries parametrizadas; SQL dinâmico jamais concatena entrada. A OWASP recomenda
validar tipo, tamanho, faixa, formato e content type e usar `413` para corpo excessivo:
[REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).

React escapa texto por padrão; não usar `dangerouslySetInnerHTML` com nome da clínica. Validar output,
CSP, `X-Content-Type-Options`, HSTS, `frame-ancestors` e política de Referer complementam a defesa XSS.
Validação não substitui rate limit: uma requisição pode ser perfeitamente válida e ainda assim ser
repetida um milhão de vezes.

Como `qoro.dev` e `app.qoro.dev` são same-site, `SameSite` sozinho não protege a aplicação se a landing
for comprometida. Cookies de autenticação/cadastro devem ser host-only; toda mutação em
`app.qoro.dev` valida `Origin`, Fetch Metadata e token CSRF/custom header conforme o mecanismo escolhido.
Webhooks ficam explicitamente fora da regra CSRF e usam autenticação própria. Referência:
[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

### 21.10 Autenticação e recuperação

- Supabase Auth continua dono de senha/hash. Qoro nunca persiste ou loga senha. O provider usa bcrypt;
  habilitar política de senha forte e bloqueio de senhas vazadas quando disponível:
  [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security).
- Exigir e-mail verificado antes de dados de clínica, Checkout e provisionamento. Produção usa SMTP
  próprio, SPF/DKIM/DMARC, templates sem revelar se a conta já existe e redirect allowlisted.
- Senha-alvo: mínimo de 12 caracteres e máximo razoável (ao menos 64), permitir password managers e
  paste; não inventar perguntas secretas. Configuração final precisa respeitar os recursos do Supabase.
- Sessão definitiva usa PKCE, cookies `Secure`/host-only, access token curto, refresh token rotacionado,
  logout/revogação e o `claims_version` já existente. Não compartilhar cookie via `Domain=.qoro.dev`.
- Login, signup e recuperação devolvem mensagens equivalentes para conta existente/inexistente e
  latência aproximada, impedindo enumeração. O Supabase já retorna sucesso genérico em recuperação.
- MFA AAL2 permanece obrigatório para `super_admin`. Para self-service, exigir step-up TOTP antes de
  trocar owner/roles, billing, conta Asaas, Meta, exportações e ações destrutivas; tornar MFA obrigatório
  para owner/gestor/financial após período de adoção é melhoria recomendada, não bloqueio do primeiro
  cadastro. Referência: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa).

Recuperação de senha nunca autentica automaticamente o usuário após a troca, revoga sessões conforme a
política e aplica os limites atuais. Respostas devem permanecer anti-enumeração:
[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

### 21.11 Autorização e isolamento multi-tenant

```text
Supabase user verificado
        ↓ vínculo criado pelo provisionador, nunca pelo browser
clinic_id + profile ativo
        ↓
role/permissions/claims_version
        ↓
service layer resolve tenant pela sessão
        ↓
withTenant → SET LOCAL app.current_clinic → RLS/FORCE RLS
        ↓
recurso com clinic_id e constraints/FKs compatíveis
```

Regras obrigatórias:

- nunca aceitar `clinic_id`, owner id, role, preço ou permission como autoridade do payload;
- `signup_sessions` é global pré-tenant e não consulta dados clínicos; somente a saga privilegiada
  allowlisted pode criar o primeiro vínculo;
- depois do provisionamento, todos os recursos tenant-scoped têm `clinic_id`, RLS/FORCE RLS,
  grants mínimos e índices; `withTenant` e autorização server-side permanecem obrigatórios;
- `dbAdmin`/service role fica no backend e somente nas seams do onboarding; nunca em repository
  genérico ou cliente. Seguir [ADR-007](adr/007-rls-implementation-patterns.md),
  [ADR-008](adr/008-identity-patterns.md) e [ADR-010](adr/010-security-definer-patterns.md);
- recursos filhos sensíveis devem usar constraints compostas ou validação transacional que impeça
  relacionar `clinic_id=A` com pai de `clinic_id=B`;
- cache, idempotency key, Storage path, outbox e métricas operacionais incluem o tenant resolvido no
  servidor, não o informado pelo cliente.

Vulnerabilidades a testar: trocar UUID de paciente/consulta na URL, enviar `clinic_id` B no JSON,
reutilizar idempotency key entre clínicas, relacionar um pai B por FK, usar sessão de usuário desativado,
consultar view sem `security_invoker`, acessar Storage com path de B e chamar a seam global diretamente.
Todas devem retornar `403/404` sem confirmar a existência do recurso. Grants e RLS são camadas distintas;
a documentação do Supabase exige ambos:
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### 21.12 Proteção do banco e divisão síncrono/fila

Obrigatório:

- Transaction Pooler no runtime, limites baixos por função e `statement_timeout`; não abrir uma conexão
  por etapa do wizard;
- nenhuma escrita no banco antes de WAF/limite/risco; uma sessão por token e uma intenção de billing por
  sessão mediante unique constraints;
- CAS `status + row_version` para múltiplas abas/workers e advisory/row lock somente no trecho curto;
- janitor com lotes `SKIP LOCKED` apaga sessões/drafts expirados e métricas agregadas; não fazer `DELETE`
  sem limite em horário de pico;
- índices dos lookups e TTL, payload máximo, outbox idempotente e backoff com dead-letter/alerta;
- circuit breakers globais para e-mail, Auth e Asaas quando erro/latência ultrapassar limiar;
- teste de carga em scratch, não em DEV compartilhado/produção.

**Síncrono:** validar request/risco/token, criar intenção local, salvar draft mínimo, consultar estado,
criar Checkout uma vez e devolver URL. **Assíncrono:** e-mails quando o provider permitir, provisionar
após webhook, compensar falhas, métricas/conversões, expirar sessões e reconciliar provider. O usuário
recebe `202` + status/poll quando a ação depende de I/O externo; não se mantém transação SQL aberta.

Redis/Upstash guarda contadores/TTL/circuitos, não a fonte da verdade de identidade/pagamento. Queda do
cache não pode liberar operações caras ilimitadas. Postgres mantém sessão, intenção, estados e
idempotência durável.

### 21.13 Pagamento, assinatura e webhook

O alvo self-service não repete o checkout atual de convite que transporta PAN/CVV pela Server Action.
Para o novo fluxo, usar página hospedada/tokenização oficial e manter Qoro fora do caminho dos dados de
cartão:

```text
browser autenticado pede Checkout
  → backend resolve plan/price/trial no banco
  → persiste signup_billing_intent + lease/idempotency
  → cria/reutiliza Checkout recorrente Asaas
  → browser abre URL hospedada
  → Asaas envia webhook ao backend
  → backend autentica token, valida schema e relê estado autoritativo se necessário
  → event id dedup + state machine monotônica
  → provisiona tenant somente no estado de negócio aceito
```

O callback `successUrl` serve para UX, nunca para confirmação. O webhook valida segredo em comparação
constante, limita body, rejeita evento inválido, persiste o `event.id` antes do efeito, aceita replay sem
duplicar e tolera ordem diferente pela leitura do provider/máquina monotônica. Não registrar payload
bruto com PII. Falha temporária retorna status que provoque retry; poison pill é observável e não trava
eventos válidos. Seguir [ADR-011](adr/011-outbox-audit-idempotency-patterns.md) e o padrão já aplicado
ao Asaas. Concorrência entre callback, polling e webhook é resolvida por CAS/unique; somente o webhook
ou reconcile autoritativo ativa assinatura.

Falha de pagamento mantém `checkout_pending/failed`, não cria tenant ativo e oferece retry sobre uma
nova geração/intenção controlada. Falha depois de recurso externo usa saga compensável e reconcile;
nunca “desfaz” silenciosamente um tenant já usado. Produção deve manter separadas a conta Asaas que
recebe a assinatura do Qoro e as contas BYO que recebem pagamentos de pacientes.

### 21.14 Idempotência obrigatória

| Operação | Chave/constraint |
| --- | --- |
| criar sessão | nonce do dispositivo/request + bucket curto; token/hash único |
| registrar identidade | `signup_session_id:identity:v1`; `auth_user_id` e e-mail canônico únicos no Auth |
| reenviar e-mail | `signup_session_id:verification:<janela>` + cooldown |
| salvar clínica/plano | `signup_session_id + row_version`; update, não nova linha |
| criar customer/Checkout/assinatura | uma `signup_billing_intent` ativa + key estável + lease |
| processar webhook | `provider + event.id` unique; efeito financeiro/provisionamento com key própria |
| criar tenant/owner | `signup_session_id` unique na tabela de provisionamento + transação única |
| publicar e-mail/outbox | idempotency key de domínio; at-most-once onde o provider exige |

`Idempotency-Key` do cliente deve ser UUID aleatório, limitado em tamanho e escopado à sessão/usuário;
o banco guarda hash, request fingerprint e resultado. A mesma chave com payload diferente retorna
`409`; retry igual devolve a resposta anterior. A chave do cliente complementa, mas não substitui
constraints e estado do domínio.

### 21.15 Endpoints recomendados

| Endpoint | Autoridade | Limite/idempotência | Validação e ataques | Resposta |
| --- | --- | --- | --- | --- |
| `GET qoro.dev/comecar` | público | WAF; sem escrita | parâmetros allowlisted, destino fixo; open redirect/bot click | `302/303` para cadastro |
| `POST /api/signup/sessions` | público | IP/device/global; desafio adaptativo | Origin, body vazio/pequeno; session flood | `201`, cookie; `429`/`403` |
| `GET /api/signup/session` | cookie bootstrap | token bucket/sliding por token | HMAC, TTL, status; enum/replay | `200`; `410` genérico |
| `POST /api/signup/identity` | cookie bootstrap | IP/token/e-mail; idempotente | Zod, e-mail/senha não logados, CSRF; spam/enumeração | sempre `202` quando formato válido |
| `POST /api/signup/verification/resend` | cookie bootstrap | cooldown + IP/e-mail | mesma resposta para existente/inexistente | `202`; `429` |
| `GET /auth/callback` | state/PKCE do Supabase | IP + uso único | state/redirect allowlisted; login CSRF/replay | `303`; erro sanitizado |
| `PUT /api/signup/clinic` | usuário verificado | user/session + CAS | nomes/tamanhos; não aceita tenant/role | `200`; `409`; `422` |
| `PUT /api/signup/plan` | usuário verificado | user/session + CAS | `planId` ativo; preço/trial server-side | `200`; `409`; `422` |
| `POST /api/signup/billing/checkout` | usuário verificado | 2/h + key + intenção/lease | plano do banco, destino fixo; payment abuse | `200/201` com URL hospedada; `409/429` |
| `GET /api/signup/status` | usuário verificado | user/session | retorna apenas próprio estado | `200`; `404` genérico |
| `POST /api/webhooks/asaas` | token Asaas, não sessão | event id + body/timeout | auth, schema, replay, out-of-order | `200` duplicado/válido; `400/401/503` |
| `POST /api/auth/logout` | autenticado | user/IP; idempotente | Origin/CSRF | `204` |
| `POST /api/auth/forgot-password` | público | limites atuais IP/e-mail | anti-enumeração | `202` sempre |
| `POST /api/auth/reset-password` | recovery grant | limites atuais + nonce | senha forte, grant single-use, CSRF | `204`; `400/429` |

Não criar um endpoint público `signup/complete` que aceite “payment=true”, `tenant_id`, role ou preço.
“Complete” é uma transição interna do worker após identidade e billing autoritativos.

### 21.16 Observabilidade e privacidade

Métricas mínimas, sem labels de alta cardinalidade:

- `signup.session.started|blocked|expired|consumed`;
- `signup.challenge.required|passed|failed`;
- `signup.identity.requested|verified|failed`;
- `signup.checkout.created|reused|failed`;
- `signup.billing.confirmed|failed`;
- `signup.provision.completed|failed|compensated`;
- `signup.rate_limited{endpoint,dimension}` e latência p50/p95/p99;
- pool/conexões, query timeout, fila, dead-letter, sessões ativas e tenants criados por plano/canal;
- funil `click → started → verified → checkout → completed`, com fonte/campanha de cardinalidade limitada.

Logs estruturados guardam timestamp, request/trace id, endpoint, decisão, motivo estável, duração,
ambiente, status e HMAC temporário de IP/e-mail quando necessário para incidente. IP bruto, e-mail,
telefone, CPF/CNPJ, nome, senha, token/cookie, GCLID, PAN/CVV, link de Checkout e payload bruto nunca
entram em log/Sentry. Mascarar headers/corpos antes da captura; sampling de falhas repetidas e retenção
por finalidade. Auditoria de negócio registra ator, transição, sessão/provisionamento internos e
resultado, não segredo.

LGPD: finalidade explícita, minimização, consentimento separado para analytics/ads, retenção curta do
staging, canal para acesso/exclusão, contratos com operadores, criptografia TLS e backups, segregação
tenant e least privilege. Dados de saúde não pertencem ao cadastro comercial. Security storage pode
existir sem consentimento publicitário; analytics/ads obedecem a decisão separada.

Alertas: pico de bloqueios/sessões, taxa de verificação despencando, custo de e-mail, Checkout por
usuário, webhook atrasado, provisionamento preso, pool > limiar, 5xx/latência, cross-tenant negado e
reconcile divergente. Dashboard não exibe raw IP; investigação privilegiada, temporal e auditada.

### 21.17 Ameaças e defesas

| Ameaça | Defesas obrigatórias |
| --- | --- |
| DDoS volumétrico | Vercel platform firewall/CDN, WAF, limites edge e circuit de custo; token não conta |
| spam/criação massiva distribuída | limites IP+JA4+device+e-mail+global, desafio adaptativo, e-mail verificado e tenant só após billing |
| brute force/credential stuffing | limites IP+e-mail, senha vazada, respostas genéricas, MFA/step-up e alertas |
| enumeração de usuário | `202` uniforme, mensagem/latência equivalentes, HMAC nos contadores |
| replay/roubo do token | 256 bits, HMAC, cookie HttpOnly host-only, TTL, CAS, consumo e rotação |
| abuso de e-mail/SMS | cooldown e quotas por destinatário/IP/sessão/global; fila/circuit; template fixo |
| payload malicioso/injection | Zod strict, limites, Drizzle parametrizado, content type e body size |
| XSS | escaping, sem HTML do usuário, CSP e sanitização quando rich text existir |
| CSRF/login CSRF | cookie host-only, Origin/Fetch Metadata, token/header CSRF, PKCE state; webhook separado |
| open redirect/SSRF | destinos e hosts fixos/allowlisted, sem `next` livre, redirect externo desabilitado |
| manipular plano/preço/status | resolução server-side e webhook/reconcile autoritativo |
| duplicar customer/assinatura/tenant | intenção persist-before-I/O, unique, lease, CAS, event id e outbox |
| Tenant A acessar B | sessão resolve tenant, RBAC server-side, `withTenant`, RLS/FORCE, grants e testes A/B |
| saturar Postgres/sessões | edge antes do DB, pool/timeout, índices/TTL, batch janitor, cap global e scratch load |
| recuperação de senha abusiva | resposta genérica, limites, token single-use, não auto-login, revogação de sessão |
| webhook falso/fora de ordem | token, schema, body cap, event id, leitura autoritativa e máquina monotônica |

### 21.18 Obrigatório para lançar versus melhoria futura

**Obrigatório de segurança/consistência antes do self-service:** ADR/ameaças; WAF e limites
multidimensionais; sessão anônima com cookie host-only/HMAC/TTL/uso único; e-mail verificado; validação
backend; CSRF/origin; respostas anti-enumeração; Checkout hospedado; webhook e idempotência; tenant
criado pelo servidor; RLS/FORCE/grants; saga/reconcile; janitor; logs redigidos; unit/integration/E2E e
carga adversarial scratch; runbook/alertas/rollback.

**Obrigatório de produto/marketing antes da primeira campanha, mas não controle de segurança:** ponte
`/comecar` sem open redirect, Google tag/linker entre os hosts, consentimento, conversões definidas e
Tag Assistant/diagnóstico real. Um hit no redirect não é sucesso de cadastro.

**Opcional/melhoria futura:** proof-of-work; fornecedor antifraude/device intelligence; MFA obrigatório
para todos os papéis; passkeys; importação server-side de conversões/GCLID; score sofisticado/ML;
Redis multi-region dedicado; verificação de domínio/e-mail corporativo; SSO empresarial. Nenhum entra
“por segurança” sem métrica, ameaça e custo operacional que o justifiquem.

### 21.19 Plano de implementação e gates

Dividir o Track O; não fazer um PR gigante:

1. **O-0 — ADR e contratos:** decisão do trial/gate de billing, threat model, estados, eventos,
   ownership, retenção e rollback. Citar ADR-007/008/010/011 e esta seção;
2. **O-1 — atribuição:** `/comecar`, parâmetros allowlisted, consentimento, linker, métricas e testes de
   open redirect; nenhuma sessão no banco;
3. **O-2 — bootstrap seguro:** migration `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit fail-closed,
   risk gate/Turnstile e janitor;
4. **O-3 — identidade:** Supabase `signUp`, e-mail confirmado/PKCE, anti-enumeração, recovery e vínculo
   single-use com a sessão;
5. **O-4 — clínica/plano:** draft mínimo autenticado, plano server-side, sem módulos/especialidade;
6. **O-5 — billing:** intenção/lease, Checkout recorrente hospedado, webhook/reconcile e falhas;
7. **O-6 — provisionamento:** tenant/owner/config em transação, saga/outbox, compensação e retomada;
8. **O-7 — onboarding operacional:** checklist único, tour/documentação e dashboard;
9. **O.H/O.S:** adversarial, carga scratch, Product Acceptance e rollout gradual/kill switch.

Testes mínimos por slice:

- **unit:** entropia/hash/TTL/rotação, estado/CAS, schemas, parâmetros Google, risco/limites, copy e erros;
- **integration DB:** expiração, múltiplas abas, concorrência, event replay/out-of-order, intenção única,
  saga/compensação, janitor, RLS/grants e ataques A→B;
- **contract:** Supabase Auth/PKCE, SMTP, Turnstile Siteverify, Asaas Checkout/webhook e Google linker;
- **E2E controlado:** orgânico e Ads-tagged, e-mail real de teste, refresh/outra aba/expiração, plano,
  Checkout Sandbox, webhook, provisionamento, login/dashboard e retry sem duplicata;
- **adversarial:** API direta sem frontend, token replay, CSRF/cross-site, payload extra/oversized,
  `clinic_id` forjado, open redirect, enumeração, burst/distribuição e Redis/provider degradado;
- **load/restore:** somente scratch descartável, com limites, cleanup e contagem zero de resíduo;
- **manual:** Turnstile/WAF/Supabase SMTP e URLs, Google Ads/GA4/consent/linker, Asaas Sandbox e
  Product Acceptance. Mocks não viram prova externa.

Gates do repositório continuam obrigatórios: lint, typecheck, suíte inteira, build, arquitetura sem
ciclos, banco/RLS, migrations up/down/scratch, registry, observabilidade, security/adversarial, smoke
onboarding e Playwright. Cada slice documenta `PASS | FAIL | BLOCKED | NOT TESTED`; deploy verde não
prova e-mail, Ads, Turnstile, Asaas ou isolamento tenant.

### 21.20 Checklist antes de produção

- [ ] ADR do Track O aceita a regra de trial/billing, estados, ownership, retenção e compensação.
- [ ] Nenhum token/senha/PAN/CVV/PII aparece em URL, log, Sentry, analytics ou `step_state`.
- [ ] WAF/DDoS e regras por rota publicados e observados; limites app IP/token/e-mail/device/global.
- [ ] Redis down e provider down foram testados; operações de custo não ficam ilimitadas.
- [ ] Turnstile moderado/alto validado server-side, single-use, com chaves por ambiente.
- [ ] Supabase exige confirmação de e-mail, SMTP próprio, redirects exatos e política de senha/vazada.
- [ ] Cookies de app são host-only/Secure/HttpOnly quando aplicável; Origin/CSRF/Fetch Metadata testados.
- [ ] Checkout é hospedado; plano/preço/trial vêm do servidor; callback do browser não ativa assinatura.
- [ ] Webhook autenticado, idempotente, out-of-order safe e reconciliável; secrets rotacionáveis.
- [ ] Tenant/owner nascem uma vez em transação; browser nunca escolhe `clinic_id`/role.
- [ ] RLS/FORCE/grants/role runtime e ataques A→B passaram em banco real autorizado.
- [ ] Índices, constraints, pool, timeouts, janitor, outbox, dead-letter e cleanup passaram em scratch.
- [ ] Respostas e tempo não enumeram usuários; login/reset/signup têm `429` e `Retry-After`.
- [ ] Métricas, alertas, runbooks, redaction, auditoria e retenção LGPD foram revisados.
- [ ] `/comecar` tem destino fixo; GCLID/UTMs/linker sobrevivem sem transportar PII ou auth.
- [ ] Consentimento e conversões Google foram testados com Tag Assistant e campanha controlada.
- [ ] Unit, integration, contract, adversarial, load e E2E estão verdes; externos são rotulados honestamente.
- [ ] Rollback/kill switch impede novos cadastros sem derrubar login/tenants existentes.
- [ ] Product Acceptance owner e jornada de aquisição foram assinados antes do rollout amplo.

**Decisões humanas concluídas em 02/09:** (a) o trial começa após criação idempotente e readback
server-side da assinatura recorrente correta no Asaas; a primeira cobrança pode vencer ao fim dos sete
dias; (b) a primeira campanha otimiza somente `signup_completed`, mantendo
`subscription_activated` secundária até haver volume para uma troca explícita. O próximo gate é validar
no Sandbox o contrato do Checkout recorrente hospedado e fechar o threat model O-0 antes de pedir
autorização para migration/API/infra. Não misturar módulos por especialidade nem reutilizar o convite de
14 dias como autorização anônima.

---

## 22. Camada 2 — 2.1 documento de pagamento: spike regulatório

**Estado em 06/09/2026:** `2.1.0 DISCOVERY CONCLUÍDO; 2.1A APROVADA`; código de PDF **não iniciado**.
A investigação produziu a [ADR-054](adr/054-documento-de-pagamento-e-recibo-fiscal.md), aceita pelo
fundador em 06/09 para comprovante não fiscal por baixa. Isso prepara a Camada 2 de forma reversível;
não declara a Camada 1 encerrada, não contorna D50/D80 e não dispensa a revisão jurídico-contábil.

### 22.1 Por que “recibo PDF” não é um requisito suficiente

O nome antigo mistura comprovante operacional, recibo de despesa médica e documento fiscal. A Receita
Federal informa que, desde 01/01/2025, médicos, psicólogos, dentistas, fisioterapeutas,
fonoaudiólogos e terapeutas ocupacionais que prestam como pessoa física devem usar o Receita Saúde.
Seu [Manual 2.1](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/orientacao-tributaria/receita-saude-2.1.pdf)
determina emissão na data do pagamento e um recibo por parcela. A
[orientação de despesas médicas](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/malha-fiscal/antecipacao/despesas-medicas)
exige descrição do serviço, nome/endereço/CPF ou CNPJ do prestador, responsável pelo pagamento,
beneficiário, data e assinatura quando não for documento fiscal.

O modelo atual tem `payment_transactions` append-only por movimento, clínica com CNPJ opcional,
paciente com CPF cifrado e relações de responsável financeiro. A tabela de transações **não possui
status**: `kind = 'payment'` é a baixa criada pelo Financial quando o valor recebido é reconhecido e
alocado. O modelo não registra a natureza PF/PJ do emitente nem um snapshot do pagador efetivo por
transação, razão social, assinatura/numeração fiscal ou vínculo com Receita Saúde/NFS-e. Inferir esses
dados ou um estado inexistente produziria um documento enganoso.

### 22.2 Caminho recomendado

1. **2.1A — comprovante não fiscal:** gerar um comprovante por baixa `kind = 'payment'`, com aviso claro
   de que não substitui Receita Saúde, NFS-e ou documento fiscal. Ele atende conciliação/atendimento ao
   paciente sem prometer validade tributária inexistente.
2. **2.1B — documento fiscal:** tratar Receita Saúde (prestador PF) e NFS-e/recibo de PJ como
   integrações próprias, depois de confirmar contrato, identidade legal, delegação, cancelamento e
   retenção. Não usar scraping nem API presumida.
3. Capturar/confirmar o **pagador real** no ato do recebimento; não presumir que seja o paciente,
   responsável cadastrado, titular do cartão ou usuário logado. Beneficiário e pagador permanecem
   distintos.
4. Fazer snapshot imutável por `payment_transaction`. Estorno cria compensação/referência; nunca
   reescreve o documento histórico como se o pagamento não tivesse existido.
5. Gerar e baixar somente no servidor, com sessão, RBAC financeiro, `clinic_id` derivado do usuário,
   RLS, auditoria, rate limit e sem URL pública previsível. CPF/endereço nunca entram em logs/Sentry.

### 22.3 Decisão de produto

- [x] **Aprovada em 06/09/2026:** 2.1A como “Comprovante de pagamento — não fiscal”, deixando Receita
  Saúde e NFS-e como integrações separadas.
- [x] **Rejeitada para este slice:** exigir recibo médico/fiscal já na 2.1. Esse caminho exige primeiro
  definir PF/PJ,
  provedor fiscal, identidade legal do emitente, pagador, beneficiário, assinatura/numeração,
  cancelamento e retenção.

O nome e a copy “não fiscal” ainda passam por revisão jurídico-contábil antes do rollout. A aprovação
não autoriza chamar o comprovante de “recibo fiscal”.

### 22.4 Contrato e testes planejados para 2.1A

- **fonte da verdade:** um movimento positivo `payment_transactions.kind = 'payment'` já persistido
  como baixa pelo Financial; a tabela não tem coluna `status` e nunca se aceita confirmação enviada
  pelo browser;
- **idempotência:** um snapshot por `clinic_id + payment_transaction_id + version`, protegido por
  constraint e concorrência;
- **multi-tenancy:** rota deriva tenant da sessão e o banco prova A → B negado;
- **privacidade:** snapshot mínimo/cifrado, download autenticado, `Content-Disposition`, cache privado,
  logs redigidos e sem dado clínico desnecessário;
- **reversão:** comprovante referencia a compensação e não oculta o histórico;
- **unit:** copy não fiscal, moeda/data, parcela, pagador diferente do beneficiário e estorno;
- **integration DB:** snapshot, replay, concorrência, RLS/FORCE, grants e ledger append-only;
- **contract/PDF:** texto extraído, metadados, nome de arquivo, ausência de ids/secrets e render visual;
- **E2E:** dono/financeiro gera, baixa e repete; perfil sem permissão e tenant cruzado recebem negação;
- **gates:** lint, typecheck, suíte, build, arquitetura, DB, migration, observabilidade, segurança e
  Playwright. Produção/migration/deploy continuam exigindo autorização específica.

### 22.5 Auditoria do terreno e split obrigatório

A infraestrutura de PDF já está implementada com `@react-pdf/renderer` 4.5.1 e funções puras em
`src/lib/pdf`; `/relatorios/pdf` fornece o padrão Node autenticado com rate limit, `no-store` e
`Content-Disposition`. Portanto, 2.1A não adiciona engine nem dependência. O README dessa biblioteca,
que ainda dizia “vazio”, foi reconciliado neste spike.

O bloqueio real é dado e autoridade: o Financial conhece baixa/recebível/paciente, Tenancy expõe
nome/endereço/CNPJ opcional e Patient possui identidade e responsável financeiro, mas não há snapshot
do pagador efetivo. `patientApiV1.getPaymentIdentity` é deliberadamente restrito à cobrança Asaas e
não será reaproveitado por conveniência. Como o Checkout hospedado coleta o pagador fora do Qoro,
paciente, responsável cadastrado e titular do cartão continuam identidades não intercambiáveis.

2.1A será executada em dois lotes, sem misturar com D72:

1. **2.1A.1 contrato/snapshot — Financial + Patient:** seam documental estreito, confirmação explícita
   do pagador, snapshot cifrado/minimizado e idempotência por baixa/versão. A aplicação compõe o perfil
   público existente de Tenancy sem alterar seus internals.
2. **2.1A.2 render/entrega — Financial + app/lib:** renderizador puro, rota Node, RBAC financeiro, rate
   limit, auditoria, headers seguros, estado de compensação e ação no Caixa.

Cada lote precisa confirmar sua própria estimativa `≤25 arquivos`, `≤1500 linhas` e `≤2 contexts`
antes do código.

### 22.6 Checklist 2.1.0

- [x] fontes oficiais atuais da Receita Federal verificadas;
- [x] diferença PF/PJ, pagamento/parcela, pagador/beneficiário e Dmed registrada;
- [x] modelo atual auditado contra os campos mínimos;
- [x] engine PDF, rota de referência, rate limit, RBAC e seams existentes auditados;
- [x] ausência de `payment_transaction.status` e de pagador persistido registrada sem inferências;
- [x] execução proposta em 2.1A.1/2.1A.2 para respeitar o budget por lote;
- [x] ADR-054 criada e aceita para 2.1A;
- [x] arquitetura, ameaças, privacidade, idempotência e matriz de testes propostas;
- [x] decisão humana: 2.1A aprovada e recibo fiscal integral rejeitado para este slice;
- [ ] revisão jurídico-contábil da copy e do enquadramento da primeira clínica piloto;
- [ ] código, migration, testes, E2E e rollout — não iniciados; aguardam os gates da Camada 1 e a
  revisão jurídico-contábil definida acima.
