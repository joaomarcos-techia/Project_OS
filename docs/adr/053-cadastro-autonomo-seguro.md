# ADR-053 — Cadastro autônomo seguro e atribuição de aquisição

- **Status:** Proposed
- **Data:** 2026-09-02
- **Contextos:** onboarding, identity, tenancy e billing, entregues em slices de no máximo dois
  bounded contexts
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-008](008-identity-patterns.md), [ADR-010](010-security-definer-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md) e
  [onboarding canônico](../onboarding-spec.md)
- **Plano detalhado:** [Qoro v2 §21](../qorov2.md#21-track-o--arquitetura-segura-do-cadastro-autônomo)

## Contexto

O onboarding atual começa em convite criado pelo super-admin. A aquisição futura deve permitir que um
visitante de `qoro.dev` inicie o cadastro em `app.qoro.dev`, verifique a identidade, escolha plano,
configure a assinatura e seja provisionado sem intervenção humana. A superfície é pública e pode ser
chamada diretamente por bots; validações de frontend e um token aleatório não contêm DDoS, spam,
enumeração, abuso de e-mail/pagamento ou criação massiva de tenants.

O fluxo também precisa preservar atribuição de Google Ads sem compartilhar cookies de autenticação
entre subdomínios, expor PII ao marketing ou usar o hit de um crawler como conversão de negócio.

## Decisão proposta

1. `qoro.dev/comecar` será uma ponte de atribuição com destino fixo para
   `app.qoro.dev/cadastro`. Ela aceita somente parâmetros Google/UTM allowlisted, não cria sessão no
   banco e nunca aceita um redirect arbitrário.
2. A sessão anônima será apenas bootstrap: token CSPRNG de 256 bits em cookie `__Host-`, host-only,
   `HttpOnly`, `Secure` e `SameSite=Lax`; banco guarda somente HMAC, TTL, estado, tentativas e CAS.
   Token anônimo não autoriza billing, tenant, role ou dashboard e não aparece na URL.
3. Supabase Auth continua dono da senha/sessão. E-mail confirmado e PKCE substituem a autoridade
   anônima antes de dados de clínica, plano e billing. Respostas públicas não enumeram contas.
4. WAF/edge e Upstash aplicam limites multidimensionais por IP, sessão, HMAC de e-mail/telefone,
   cookie de dispositivo não invasivo, usuário, endpoint e orçamento global. Operações anônimas com
   amplificação de custo falham fechadas/degradadas quando o limiter distribuído está indisponível.
5. Bot protection é adaptativa: baixo risco sem desafio, risco moderado com Turnstile validado no
   backend e alto risco com cooldown/bloqueio antes de qualquer escrita ou I/O caro.
6. Plano, preço, trial, role e estado de pagamento são resolvidos no servidor. O self-service usa
   Checkout recorrente hospedado/tokenização oficial; PAN/CVV nunca atravessam o backend do Qoro.
7. Browser callback não confirma pagamento. Webhook autenticado, event id, máquina monotônica,
   intenção/lease e reconcile autorizam o provisionamento idempotente.
8. A clínica definitiva e o owner nascem uma vez, em transação, após identidade verificada e gate de
   billing aceito. O frontend nunca fornece `clinic_id` como autoridade. Recursos posteriores seguem
   `withTenant`, RLS/FORCE RLS, grants mínimos e constraints tenant-safe.
9. Marketing e segurança não compartilham cookies. Google linker/consentimento preservam atribuição.
   A primeira campanha usa somente `signup_completed` como conversão primária e mantém
   `subscription_activated` secundária; a troca futura é explícita e nunca torna o redirect conversão
   de negócio.
10. A implementação será dividida em O-1–O-7 conforme §21; este ADR não autoriza migration, regra WAF,
    integração Google/Turnstile, mudança de API pública ou deploy.
11. O trial de sete dias começa somente depois de uma intenção idempotente e de readback server-side
    confirmarem no Asaas a assinatura recorrente esperada — customer, plano, valor e vencimento — em
    estado não terminal. A primeira cobrança pode vencer ao fim do trial; callback do navegador não
    concede acesso.

## Decisões de negócio registradas em 02/09/2026

1. Trial: assinatura recorrente criada de forma idempotente e confirmada por readback server-side;
   não método informado pelo browser e não primeira cobrança liquidada.
2. Ads: `signup_completed` é a única conversão primária inicial; `subscription_activated` permanece
   secundária até haver volume suficiente para uma troca explícita.

## Gate técnico ainda necessário para aceitar o ADR

1. Confirmar disponibilidade/contrato do Checkout recorrente hospedado no ambiente real antes de
   remover o checkout por convite existente. Os fluxos coexistem durante a migração.

## Consequências

### Positivas

- bots não criam tenants ou recursos financeiros antes de provar identidade e passar gates de custo;
- token roubado tem autoridade curta, single-use e não vaza por URL/Referer;
- pagamento, plano e isolamento tenant permanecem autoritativos no backend/banco;
- aquisição pode ser medida entre landing e app sem acoplar analytics à autenticação;
- replay, múltiplas abas e callbacks fora de ordem são resolvidos por estado/unique/CAS.

### Custos e riscos

- exige migration global pré-tenant, janitor, limiter fail-closed e observabilidade própria;
- requer configuração manual coordenada em Vercel, Supabase, Turnstile, Google e Asaas;
- e-mail confirmado e Checkout externo aumentam passos; métricas devem medir abandono sem reduzir os
  controles silenciosamente;
- saga precisa reconcile/compensação para recursos externos órfãos;
- o fluxo por convite atual transporta cartão pela Server Action e não deve ser copiado para o
  self-service.

## Alternativas rejeitadas

- token em query string como proteção principal: vaza e não limita abuso volumétrico;
- criar tenant antes de verificar e-mail/billing: amplifica custo e lixo no banco;
- aceitar `payment=true`, preço, role ou `clinic_id` do browser: quebra autoridade e multi-tenancy;
- CAPTCHA obrigatório para todos: aumenta abandono sem substituir limites;
- IP como único sinal: falha em botnet e pune redes NAT;
- compartilhar cookie em `.qoro.dev`: aumenta o impacto de comprometimento da landing;
- encaminhar cartão pelo backend: amplia escopo e risco sem necessidade quando há Checkout hospedado;
- um endpoint público `signup/complete`: permite tentar pular a máquina de estados.

## Evidência necessária para Accepted

- contrato do provider para o gate de trial e decisão das duas questões de negócio;
- threat model e matriz endpoint/limites aprovados;
- proof de Checkout recorrente hospedado no Sandbox sem PAN/CVV no Qoro;
- desenho de migration, grants/RLS, cleanup, idempotência, saga/reconcile e rollback revisado;
- plano de testes unit, integration DB, contract, adversarial, load scratch, E2E e Product Acceptance;
- responsáveis pelas configurações manuais e pelos alertas/runbooks definidos.

---

## Emenda de 18/09/2026 — contrato executado de O-5 e O-6

O ADR segue **Proposed**: a barra de aceite exige prova de Checkout no Sandbox, e ela não foi
executada. O que esta emenda faz é registrar o contrato que já existe em código, para que a prova
externa, quando acontecer, teste o que de fato foi construído — e não uma intenção.

### 1. O pagamento é hospedado, mas não é o objeto "Checkout" do Asaas

O adapter expõe `createCheckout`, usado pelo sinal do paciente (D24/D57). Ele é **avulso**: tem
`value`, `minutesToExpire` e callbacks, e não tem ciclo. Assinatura recorrente por aquele objeto
exigiria estender o contrato do provedor a partir de suposição, e isso é inventar contrato externo.

O caminho escolhido usa o que o adapter já prova: `createSubscription` **sem cartão**
(`billingType: 'UNDEFINED'`). O Asaas emite as faturas do ciclo e hospeda o pagamento na página dele;
quem paga escolhe PIX, boleto ou cartão lá. O Qoro nunca vê meio de pagamento — que é a invariante
que importava. `nextDueDate` cai no fim do trial, então a primeira cobrança vence depois dos sete
dias e não precisa estar liquidada para o trial começar (decisão de 02/09, §21.20).

### 1.a Medido no Sandbox em 18/09/2026: o documento é obrigatório

A pergunta aberta foi fechada contra o sandbox real (`sandbox.asaas.com`), com o adapter de produção.
A matriz isola a variável — `billingType` foi o mesmo nas duas pontas:

| CPF/CNPJ no customer | `billingType` | `POST /subscriptions`        |
| -------------------- | ------------- | ----------------------------- |
| presente             | `UNDEFINED`   | **aceita**                    |
| presente             | `BOLETO`      | **aceita**                    |
| ausente              | `BOLETO`      | `400` `["invalid_object"]`    |
| ausente              | `UNDEFINED`   | `400` `["invalid_object"]`    |

**Veredito: `DOCUMENT_REQUIRED_BY_PROVIDER`, variável isolada `cpfCnpj`.** Não é o tipo de cobrança,
não é o valor, não é o host.

**Mudança mínima aplicada.** O funil passa a pedir CPF/CNPJ na tela do plano, imediatamente antes da
ativação. Três decisões de privacidade acompanham, e nenhuma delas é opcional:

1. **Não persiste antes do tenant.** O documento atravessa a requisição em memória e só descansa em
   `billing_customers.document_encrypted`, cifrado por `encryptForTenant(clinicId, …)` no
   provisionamento. Guardá-lo em `signup_sessions` colocaria identificador nacional numa tabela
   pré-tenant — e não haveria sequer chave de tenant para cifrar com. **Nenhuma migration.**
2. **Validado no servidor**, com dígitos verificadores (`src/lib/validation/document.ts`), incluindo a
   recusa de repetidos como `111.111.111-11`, que passam no módulo 11 e são o que se digita para
   preencher campo. Documento inválido é `422` antes de reservar tentativa ou chamar o provedor.
3. **Fora de log, telemetria e URL.** `cpfcnpj` já está em `SENSITIVE_KEYS`, então sanitização de
   payload, auditoria e Sentry o redigem por chave. Ele nunca entra em query string, em `step_state`,
   em métrica ou na resposta da rota — há teste para a resposta.

O que **não** mudou: o documento é dado da própria pessoa, não uma afirmação de autoridade. Plano,
preço, ciclo, trial, `clinic_id` e papel continuam decididos no servidor, e o corpo da rota segue
`.strict()` — mandar `planId` junto do documento é `400`.

### 2. `creation_unknown` é estado, não erro

O Asaas não aceita `Idempotency-Key` em POST. Um timeout depois do POST deixa indeterminado se a
assinatura existe. O contrato executado:

| Situação                     | Estado gravado     | O que pode acontecer depois            |
| ---------------------------- | ------------------ | -------------------------------------- |
| 4xx conhecido                | `failed`           | nova tentativa é permitida             |
| timeout / 5xx / circuito     | `creation_unknown` | **só reconciliação**, nunca nova criação |
| readback confirmado          | `active`           | provisionamento                        |

A reserva (`reserveSignupBillingAttempt`) aceita partir de "sem tentativa" ou de `failed`, e recusa
`creation_unknown` e `active`. Não é uma checagem defensiva: é a diferença entre "tente de novo" e
"não toque nisso até conferir do outro lado". A saída de `creation_unknown` é
`reconcileSignupSubscription`, que pergunta por `externalReference` e **não cria nada**.

### 3. Readback antes do trial

`HTTP 200` com um `id` não prova valor nem estado. Antes de ativar, o servidor lê a assinatura no
provedor e confere estado `ACTIVE` e valor igual ao do catálogo. Divergência cancela a assinatura,
compensa o customer criado na tentativa e marca `failed`. O trial começa a partir dessa confirmação.

### 4. O tenant nasce de um `DELETE`

O provisionamento não ganhou coluna nem estado novo. O claim de O-6 é
`DELETE FROM signup_sessions ... RETURNING`, dentro da mesma transação que cria clínica, owner,
config, customer e subscription. Duas abas serializam no `FOR UPDATE`; a perdedora não encontra linha
para apagar, o claim lança e a transação inteira desaparece — inclusive a clínica.

Três propriedades caem de graça: não existe estado "provisionando" para ficar preso; a PII do funil
(`owner_name`, `clinic_name`, `email_hash`) some no mesmo commit; e não houve migration para O-6.

O núcleo `provisionTenantCoreTx` passou a receber o claim como parâmetro. O caminho do convite
(ADR-027) usa o mesmo núcleo com o claim guardado por `version` e **não mudou de contrato**.

### 5. Defeito encontrado ao desenhar a 0103

O janitor apagava qualquer linha vencida. Com a 0103, isso apagaria também a linha que guarda a
assinatura já criada no Asaas — o Qoro perderia o único vínculo com uma cobrança que continua
existindo. `purgeExpiredSignupSessions` passou a excluir linhas com `asaas_subscription_id` e a emitir
`signup.session.subscription_retained`. Linha órfã é barata; assinatura órfã cobra alguém todo mês.

### 6. O que o browser não decide

Corpo de `POST /api/signup/checkout` é **vazio por contrato**, e corpo com conteúdo é recusado com
`400` em vez de ignorado — ignorar ensina o cliente a mandar plano e preço. Plano, valor, ciclo,
trial, `clinic_id`, papel e slug são resolvidos no servidor a partir do draft verificado. A resposta
não devolve `clinicId` nem id de assinatura.

### 6.a Métricas emitidas

Nomes estáveis, sem PII e sem identificador de provedor — o que a operação precisa para conciliar
sem que o log vire fonte de dado sensível.

| Evento                                          | Quando                                              | O que olhar                              |
| ----------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| `signup.billing.subscription_active`            | assinatura confirmada por readback                  | volume esperado do funil                 |
| `signup.billing.customer_compensated`           | customer da tentativa apagado após 4xx               | deve acompanhar `declined`               |
| `signup.billing.customer_compensation_failed`   | compensação falhou                                   | **órfão no provedor** — conciliar à mão  |
| `signup.billing.subscription_compensated`       | assinatura cancelada por CAS perdido/readback ruim   | raro; recorrente indica disputa real     |
| `signup.billing.subscription_compensation_failed` | cancelamento falhou                                | **cobrança órfã** — prioridade alta      |
| `signup.billing.reconcile_not_found`            | `creation_unknown` sem assinatura do outro lado      | libera decisão de nova tentativa         |
| `signup.billing.reconciled`                     | `creation_unknown` resolvido para `active`           | o timeout tinha criado mesmo             |
| `signup.provisioned`                            | tenant nasceu                                        | par com `subscription_active`            |
| `signup.session.subscription_retained`          | janitor deixou linha vencida com assinatura          | **> 0 exige conciliação**                |

O par que mais importa é `subscription_active` versus `provisioned`: divergência persistente entre os
dois significa gente com assinatura e sem clínica — exatamente o caso mais caro do produto.

### 7. Prova de Sandbox executada em 18/09/2026

Runner `scripts/security/signup-billing-sandbox.ts`, adapter de produção, host `sandbox.asaas.com`,
artefato em `dist/track-o-sandbox/asaas-results.json`. **4/4 PASS**, cleanup 5/5 assinaturas e 5/5
customers, readback de resíduo zero em `ACTIVE`/`INACTIVE`/`EXPIRED`.

| Prova | O que ficou estabelecido                                                                    |
| ----- | -------------------------------------------------------------------------------------------- |
| P1    | documento é obrigatório; variável isolada `cpfCnpj` (matriz da §1.a)                          |
| P2    | readback confere: valor 149 pedido = 149 devolvido, `ACTIVE`, `externalReference` ida e volta |
| P3    | resposta perdida de verdade (filho morto em voo, 600 ms) recuperada por `externalReference`, **sem segundo POST** |
| P4    | **o provedor NÃO tem idempotência**: duas criações concorrentes com a mesma referência produzem duas assinaturas |

**P4 é o achado que mais muda o raciocínio.** "Procurar antes de criar" estreita a janela e não a
fecha: as duas chamadas simultâneas não se enxergam, e as duas assinaturas cobrariam. A defesa real do
O-5 não está no provedor nem na busca — está no `reserveSignupBillingAttempt`, que serializa em
`FOR UPDATE` e deixa **exatamente um** chamador alcançar o Asaas; a segunda aba recebe `conflict` e
nunca faz POST. Isso é provado em Postgres real pelo bloco "billing O-5" do `signup-regression`.

A consequência operacional: qualquer caminho futuro que chame o provedor **sem** passar pela reserva
reintroduz cobrança duplicada. O CAS não é otimização; é o mecanismo.

Continuam pendentes para Accepted: E2E da jornada completa e Product Acceptance humano.

---

## Emenda de 26/09/2026 — Checkout recorrente hospedado do Asaas

Esta emenda substitui as seções 1, 1.a, 3 e 7 da emenda de 18/09 no caminho de cadastro autônomo. O
contrato direto `createCustomer` + `createSubscription(UNDEFINED)` foi removido do fluxo novo porque
ativava o tenant antes de o pagador passar pelo Checkout e reproduzia exatamente o desvio observado
por uma pessoa: plano + CPF levavam direto ao dashboard.

O contrato vigente é:

1. o browser salva o `planId` no passo próprio; `POST /api/signup/checkout` recebe corpo estritamente
   vazio e resolve plano, preço, ciclo, trial e primeiro vencimento no servidor;
2. após reservar a intenção por CAS, o servidor cria Checkout com `billingTypes: [CREDIT_CARD]`,
   `chargeTypes: [RECURRENT]` e `subscription: { cycle: MONTHLY, nextDueDate }`;
3. o Qoro não envia `customer` nem `customerData`. Documento, telefone, endereço e cartão são
   coletados na página hospedada. Antes da conclusão, a sessão guarda somente id e URL do Checkout;
4. `successUrl` não confirma pagamento. A rota de status procura cobrança pelo id do Checkout, relê
   a assinatura e valida customer, estado `ACTIVE`, cartão, ciclo, valor e vencimento;
5. somente depois do readback a tentativa passa a `active` por CAS e
   `provisionTenantFromSignup` pode criar tenant, owner, customer local e assinatura local na mesma
   transação que consome o draft;
6. cancelamento ou expiração relê o provider, cancela o Checkout e só então muda a tentativa para
   `failed`, limpando id e URL por CAS. Uma conclusão concorrente vence e segue para validação;
7. os Checkouts expiram em 60 minutos. Reabrir a mesma URL cancelada/expirada é proibido; após
   encerramento confirmado, uma nova tentativa cria um novo Checkout.

### Evidência e estado da decisão

- migrations 0105–0106 aplicadas e relidas no banco DEV;
- criação recorrente real aceita no Sandbox sem PII no payload; cleanup confirmado;
- `items[].name` usa identificador técnico limitado a 30 caracteres; a descrição completa fica em
  `items[].description`, conforme defeito encontrado pelo primeiro E2E do Preview;
- customer mínimo e `customerData` parcial recusados pelo Asaas, confirmando que o pagador precisa
  completar os dados na página hospedada;
- contrato, retorno autoritativo, corrida de cancelamento e UI cobertos por testes locais;
- conclusão externa permanece pendente porque o POST final do Checkout exigiu reCAPTCHA. Ela será
  julgada pelo roteiro humano no Preview HTTPS.

O ADR permanece **Proposed** até o Checkout ser concluído no Sandbox pelo roteiro humano e o retorno
provisionar a clínica. As provas do contrato direto continuam históricas; não descrevem mais o
runtime do cadastro autônomo.
