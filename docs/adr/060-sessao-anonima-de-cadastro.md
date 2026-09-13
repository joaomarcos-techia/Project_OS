# ADR-060 — Fatia O-2: sessão anônima de cadastro (bootstrap seguro)

- **Status:** **O-2a Accepted**; **O-2b Accepted no servidor** — classificador e `siteverify`
  verificados contra a Cloudflare real no Preview em 13/09. Falta só o widget renderizado, que
  pertence à fatia das perguntas. Não autoriza as fatias O-1, O-3 e seguintes, nem migration em
  produção
- **Data:** 2026-09-12 (revisada no mesmo dia; ver "Revisão de 12/09" ao final)
- **Contextos:** onboarding (novo) + `lib/db` (tabela global pré-tenant) — dois bounded contexts, no teto
- **Relaciona:** [ADR-053](053-cadastro-autonomo-seguro.md) (arquitetura do track),
  [ADR-007](007-rls-implementation-patterns.md), [ADR-010](010-security-definer-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md) e
  [Qoro v2 §21.5–21.8](../qorov2.md#215-modelo-de-dados-da-sessão-de-cadastro), §31

## Contexto

A [ADR-053](053-cadastro-autonomo-seguro.md) decidiu a arquitetura do cadastro autônomo inteiro e
listou, para virar *Accepted*, uma barra de evidência que inclui coisas que a fatia O-2 **não toca** —
prova de Checkout recorrente no Sandbox do Asaas, linker do Google, contrato de trial. Enquanto essa
barra for tratada como pré-requisito único, nenhuma fatia começa, inclusive as que não dependem de
provider nenhum.

Este ADR existe para separar as duas coisas: ele congela o escopo de **O-2** e define a evidência que
**essa fatia** precisa, sem esperar por O-5.

### Decisões do fundador em 12/09/2026

1. **Reabrir o Track O** e começar pelo O-2 na leitura do §21.19 — "bootstrap seguro" (migration
   `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit, Turnstile, janitor). Motivo declarado: *"prezo
   pela segurança e quero ter uma boa observação de leads pelo formulário de cadastro"*. O §31.2
   registra que o rótulo "O-2" é ambíguo no roadmap; **esta ADR adota a leitura do §21.19**.
2. **Cartão pelo Checkout hospedado do Asaas**, nunca por formulário próprio. A ADR-053 já decidia isso
   por escopo PCI; o fundador acrescentou a razão de produto: *"usando um personalizado nosso, pode
   haver falta de confiança em colocar as informações lá"*. As duas razões apontam para o mesmo lugar, e
   a de produto sobrevive mesmo se o argumento técnico mudar.
3. **Ordem do fluxo: opção A** (ver "Ordem do fluxo" abaixo) — três perguntas, depois identidade
   verificada, depois cartão.

## Ordem do fluxo — a decisão que reordena a máquina de estados

O fluxo pretendido pelo fundador era *três perguntas → checkout com login e cartão juntos*. Isso
conflitava com o §21.2 e com o item 3 da ADR-053, que exigem **identidade verificada antes** de dados de
clínica e de billing — ordem que o enum do §21.5 carrega (`identity_pending` antes de
`details_complete`). Três ordens foram postas ao fundador, que escolheu a **A**:

| | Ordem | Consequência |
| --- | --- | --- |
| **A — escolhida** | perguntas → e-mail/senha → **verifica** → checkout(cartão) | Guarda a conversão das perguntas primeiro e não cria recurso externo para e-mail não provado |
| B | perguntas → checkout(login+cartão) → verifica depois | Melhor funil; aceita customer/assinatura órfãos no Asaas e PII pré-verificação |
| C | e-mail/senha → verifica → perguntas → checkout | Mais seguro, pior funil: pede credencial antes de qualquer valor percebido |

**A ordem canônica passa a ser:**

```text
initiated → details_complete → identity_pending → email_verified → checkout_pending
          → provisioning → completed
                                   (a qualquer momento: expired | blocked | failed)
```

Essa sequência vive **no código** (`SIGNUP_FUNNEL_ORDER`), não no banco. A coluna é `text` com CHECK
(decisão 3), então ordenar por `status` daria ordem alfabética — que não tem relação nenhuma com
progresso. **Nada deve `ORDER BY status` para deduzir etapa do funil.**

### O que a escolha de A muda nesta fatia

1. **As perguntas passam a preceder a identidade.** O-2 continua sem implementá-las, mas a fatia que as
   implementa deixa de ser a quarta e passa a ser a imediatamente seguinte a esta. A numeração do
   §21.19 fica, portanto, fora de ordem em relação ao fluxo — **não renumerada aqui** pelo mesmo motivo
   do §31.2 (há referências fora do documento).
2. **PII entra na sessão anônima na fatia seguinte, não nesta.** `owner_name` é dado pessoal, e em A ele
   chega antes de qualquer verificação. Consequência direta e obrigatória: **o janitor escrito em O-2
   nasce preparado para apagar PII**, com teste que prove a remoção, mesmo que em O-2 não haja nenhuma.
   Escrever agora um janitor que só apaga linha "vazia" garantiria retrabalho na fatia seguinte, na
   parte do sistema onde esquecer tem consequência de LGPD.
3. **O perfil de abuso muda:** texto livre entra antes da identidade. Os tetos de tamanho do §21.9
   (body pequeno, Zod `.strict()`, limites por campo) deixam de ser higiene e viram contenção de custo,
   e "details submetidos" vira sinal para o classificador de risco do §21.8.
4. **A proteção que A preserva** é a que importa: nenhum customer ou assinatura no Asaas antes do e-mail
   verificado. Órfão em provider externo é o lixo que não dá para limpar com `DELETE`.

## Decisão

### 1. Corte em duas sub-fatias

O escopo anterior desta ADR juntava migration, endpoints, rate limit, Turnstile, janitor e eventos.
O Turnstile é o **único item que depende de configuração humana em terceiro** (conta Cloudflare, chaves
por ambiente, um dono). Juntá-lo ao resto põe uma dependência externa no caminho crítico de trabalho
que é inteiramente testável offline.

**O-2a — sessão (sem dependência externa):**

1. Migration da tabela global `signup_sessions`, pré-tenant, sem grants a `anon`/`authenticated`,
   acessível somente pelo serviço mínimo allowlisted ([ADR-010](010-security-definer-patterns.md));
2. `POST /api/signup/sessions` — cria a sessão e devolve o token bruto **apenas** no cookie
   `__Host-qoro_signup` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `Domain`);
3. `GET /api/signup/sessions/me` — estado **sanitizado** da própria sessão, para sobreviver a refresh e
   a múltiplas abas;
4. Rate limiting multidimensional. **Reaproveita `src/lib/auth/rate-limit.ts` e o `@upstash/ratelimit`
   que já são dependências do projeto** — nenhuma conta nova, nenhum setup humano;
5. Janitor de expiradas em lotes pequenos, **já capaz de apagar PII** (item 2 da seção anterior);
6. Eventos de observação de funil, sem PII.

**O-2b — risco adaptativo (depende de terceiro):** classificador do §21.8 e Turnstile validado no
backend. Pequeno e bem especificado: o §21.8 já define os sinais e as três faixas; o que falta são os
limiares, que são afinação, e o dono da configuração.

### 1b. Desafio de bot: DUAS camadas, não uma escolha entre elas

Levantado em 13/09, a partir de uma pergunta do fundador ("não seria melhor um reCAPTCHA? acho que já
existe no Supabase"). A resposta tem três partes, e a do meio muda o desenho.

**O Supabase não suporta reCAPTCHA.** A proteção de bot do Supabase Auth aceita **hCaptcha** e
**Cloudflare Turnstile**. (As menções a reCAPTCHA no §20 do roadmap são do Checkout do **Asaas** —
escolha do provider, na página dele, não nossa.)

**O captcha do Supabase NÃO protege a nossa rota.** Ele age nos endpoints do Supabase Auth — `signUp`,
`signIn`, recuperação de senha. `POST /api/signup/sessions` é rota nossa; o Supabase nunca a vê. Logo:

| Camada | Protege | Fatia | Custo |
| --- | --- | --- | --- |
| Captcha do Supabase Auth | `signUp` e reenvio de verificação | **O-3** (identidade) | **configuração**, zero código |
| Desafio próprio (Turnstile) | `POST /api/signup/sessions` | **O-2b** | código |

As duas são desejadas, em fatias diferentes. A do Supabase estava prestes a virar item esquecido
justamente por não ser código — não aparecia em nenhuma lista até este registro.

**Turnstile não implica migrar para a Cloudflare.** É serviço avulso: basta conta e o par de chaves.
Não exige DNS apontado para lá, proxy, CDN nem mudança de hospedagem — o Vercel continua o Vercel.
Registrado porque a decisão estava sendo adiada por um pré-requisito que não existe.

**Por que Turnstile e não hCaptcha**, agora com um motivo melhor que o do §21.8 ("custo e integração
simples"): **um provedor cobre as duas camadas**. Uma conta, um par de chaves por ambiente, e o
Supabase o suporta nativamente. Sobre reCAPTCHA há ainda o ângulo de privacidade — ele envia dados do
visitante ao Google, o que num produto de saúde brasileiro com criptografia por tenant e postura LGPD
é decisão de produto, não detalhe técnico neutro.

**Contrato de env (decidido aqui para o O-2b não reabrir a discussão):**

| Variável | Natureza | Onde |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | pública — o widget roda no browser | `.env.local` + Vercel (Preview e Production) |
| `TURNSTILE_SECRET_KEY` | **segredo** — só o servidor valida o token | idem, **sem** `NEXT_PUBLIC_` |

Chaves **separadas por ambiente** (§21.8): o Turnstile valida o hostname onde o widget rodou, e um
widget por ambiente evita que a chave de produção seja exercitada de Preview ou de `localhost`.

**Detalhe de implementação que muda o fluxo:** o token do Turnstile é **de uso único**. Um token
gasto na criação da sessão (O-2b) **não** serve para o `signUp` (O-3) — cada passo protegido precisa
do seu próprio desafio. Desenhar a tela supondo "um captcha no começo resolve o cadastro inteiro"
levaria a uma falha de verificação no meio do funil, que é o pior lugar para descobrir isso.

#### ⚠️ ORDEM OBRIGATÓRIA: código primeiro, painel depois

**Ligar o captcha no painel do Supabase antes de o código enviar o token derruba o login de todas as
clínicas.** Não é degradação — é ninguém entra. Levantado em 13/09, quando o fundador ia ativar direto
no projeto de produção; busca por `captchaToken` no repositório inteiro devolveu **zero ocorrências**,
e há **três** chamadas que o captcha passa a exigir:

| Call site | Chamada | O que quebra | Situação |
| --- | --- | --- | --- |
| `app/(app)/login/actions.ts` | `signInWithPassword` | **login de toda clínica existente** | feito (13/09) |
| `app/(app)/login/actions.ts` | `resetPasswordForEmail` | recuperação de senha | feito (13/09) |
| `app/(app)/join/[token]/actions.ts` | `signInWithPassword` | auto-login pós-checkout | feito (13/09) |

**Correção de 13/09 — eram três, não quatro.** A quarta linha desta tabela dizia
`auth/confirm/route.ts → verifyOtp`, e isso está errado: o SDK não permite. A variante que essa rota
usa, `VerifyTokenHashParams` (`verifyOtp({ token_hash, type })`), **não tem campo `options`**; nas
outras duas variantes o `captchaToken` está marcado `@deprecated`. Faz sentido — quem chega ali já
provou posse do token do e-mail, e não há navegador para resolver desafio num link clicado. Conferido
em `@supabase/auth-js@2.106.2`.

O mesmo vale para `convite/page.tsx`, que também usa `verifyOtp({ token_hash })`. As chamadas
`admin.auth.admin.*` (convite, `generateLink`, `createUser` da saga) usam a service role e **não passam
por captcha** — por isso o provisionamento do checkout não precisa de token.

**Consequência para o checkout:** o token do formulário de ativação é gasto no auto-login, e só nele.
Um token por envio basta — e é bom que baste, porque o usuário não teria como resolver um segundo
desafio depois de o cartão já ter sido cobrado. O `catch` mudo daquele auto-login virou
`logger.warn('checkout.autologin_failed')`: sem isso, um captcha mal configurado apareceria apenas
como "paguei e caí no login", indistinguível de decisão de produto.

**Pré-requisito que faltava: a CSP bloqueava o Turnstile.** `script-src`, `frame-src` e `connect-src`
não tinham `https://challenges.cloudflare.com`. O widget carrega um script, renderiza num **iframe** e
**fala** com a Cloudflare — faltando qualquer uma das três, ele nunca aparece, e a falha é silenciosa
para quem não abre o console. Corrigido com origem nomeada (nunca curinga) e registrado na allowlist de
`src/lib/security/headers-gate.test.ts`.

Sequência correta:

1. o código renderiza o widget e passa `options.captchaToken` nas chamadas acima;
2. ativa no Supabase **de dev**, usando as **chaves de teste** da Cloudflare (o par documentado em que
   o desafio sempre passa). Assim o E2E continua verde **e** o caminho do captcha é exercitado — melhor
   que desligar no Preview, que pularia o código em vez de testá-lo;
3. só então ativa em produção, com as chaves reais.

O passo 2 responde à objeção correta do fundador de que ativar no projeto de dev quebraria o E2E: os
testes fazem login de verdade em `e2e/auth.ts`. Com as chaves de teste, quebram não.

### 1.b. O que a tela das três perguntas HERDA do `/join` — avaliação de 13/09

A tela de cadastro autônomo não existe, mas a tela de onboarding **existe**: o wizard de
`/join` (`clinic → owner → plan → checkout`). Antes de desenhar a nova, vale listar o que já está
resolvido lá, porque reconstruir do zero perde coisas que custaram caro.

**O que precisa ser copiado, não reinventado:**

| Mecanismo | Onde | Por que importa |
| --- | --- | --- |
| Persistência por passo com CAS | `guardedUpdateInvite(id, version)` | A segunda aba perde a corrida em vez de sobrescrever. `signup_sessions.row_version` já existe para o mesmo papel. |
| **Senha nunca entra no estado persistido** | `join-wizard.tsx` (`needsPassword`) | Vive só no cliente; numa retomada em outra aba é pedida de novo. A nova sessão NÃO pode gravar credencial na linha. |
| Cartão só em memória | `submitCheckoutAction` | Nunca logado, nunca persistido, nunca no `step_state`. |
| Preço resolvido no SERVIDOR | `resolveCheckoutPlan(st.planId)` | O cliente manda o `planId`, não o preço. Sem isso, desconto é um campo de formulário. |
| Idempotência natural | convite vira `completed`, guardado por `version` | Reenvio dá "já ativado" em vez de cobrar duas vezes. `status` + `consumed_at` + `row_version` cobrem o mesmo na sessão. |
| **Taxonomia de falha com mensagem própria** | `OnboardingProvisionError` | `card_declined` (com a razão legível do Asaas), `provider_unreachable`, `invite_version_conflict`, `owner_create_failed` (e-mail já em uso). É a parte mais fácil de perder numa reescrita, e a que o usuário mais sente. |

**O que a ordem A (perguntas antes da identidade) obriga a decidir antes de codar:**

1. **Colunas de PII na sessão.** Hoje `signup_sessions` tem só `id · token_hash · status ·
   risk_level · failed_attempts · row_version · TTLs`. As três perguntas trazem dado de pessoa
   (nome, clínica, telefone?) para uma linha que existe **antes de haver usuário e antes de haver
   consentimento**. Isso é migration nova + decisão de retenção: um lead que abandona no passo 2
   deixou dados, e o janitor hoje apaga por TTL — o que é a resposta certa, mas precisa estar dita.
2. **Quais são as três perguntas.** Não há especificação. É decisão de produto, não de engenharia.
3. **Checkout próprio ou do Asaas.** O fundador levantou em 12/09 que o checkout transparente pode
   gerar desconfiança ("colocar o cartão num formulário nosso"). Se a escolha for o checkout hospedado
   do Asaas, o bloco de cartão do `submitCheckoutAction` **deixa de existir** — e com ele a validação
   de CPF/CEP/validade e o `card_declined`. Decidir isso depois de implementar custa o dobro.

**O que já foi corrigido no `/join` por causa desta avaliação:** o auto-login pós-checkout era
`try { … } catch {}` mudo. Virou `logger.warn('checkout.autologin_failed')` com motivo
(`captcha_failed` / `auth_rejected`). A clínica que paga e cai no `/login` agora aparece em log, em
vez de aparecer só quando alguém abre suporte.

### 2. O que a fatia NÃO entrega — escopo congelado, não omissão

- **sem** `signUp` no Supabase, confirmação de e-mail ou PKCE (fatia de identidade);
- **sem** qualquer chamada ao Asaas, intenção de billing ou Checkout (O-5);
- **sem** criação de `clinics`, profile owner ou recurso de tenant (O-6);
- **sem** `/comecar`, parâmetros de campanha ou tag do Google (O-1);
- **sem** as três perguntas e sem tela de cadastro (produto, fatia seguinte).

O-2 é o **substrato**: a sessão que torna confiável tudo o que as outras fatias penduram nela.

### 3. Colunas: só as que a fatia escreve

O §21.5 desenha a tabela final. **Não vamos criá-la inteira agora.** Nesta fatia entram:

```text
id · token_hash · status · risk_level · failed_attempts · row_version
idle_expires_at · absolute_expires_at · consumed_at · created_at · updated_at
```

Ficam para as fatias que as escrevem: `owner_name`, `clinic_name` e `selected_plan_id` (fatia das
perguntas, agora a seguinte), `auth_user_id` e `email_hash` (identidade), `attribution` (O-1),
`completed_at` (O-6).

**Motivo, o mesmo do [§30.6](../qorov2.md#306-decisão-do-fundador-1209-apenas-crm):** coluna que nasce
sem caminho de escrita e sem leitor é dado morto que toda revisão futura precisa explicar. Aqui o custo
de adiar é ainda menor que no caso do CRM: **as linhas vivem no máximo 60 minutos**, então
`ALTER TABLE ADD COLUMN` mais tarde não tem backfill, não tem lock relevante e não tem linha histórica
para reconciliar.

**Correção (implementação): `text` + CHECK, não `pgEnum`.** As duas versões anteriores desta ADR
discutiam se o enum devia nascer completo. A pergunta estava errada. Ao escrever a migration, o
análogo mais próximo — `clinic_invites`, também global e pré-tenant — usa `text` com um comentário
listando os valores, e **sem CHECK**: nenhuma validação no banco. E o projeto já usa CHECK em outras
tabelas (`clinics_slug_format`, `profiles_role_clinic_check`), então é ferramenta da casa.

`text` + CHECK ganha das duas opções que eu havia considerado:

- **valida no banco**, ao contrário do `text` puro do `clinic_invites`;
- **estende sem armadilha**: `DROP CONSTRAINT` + `ADD CONSTRAINT`, sem o problema do
  `ALTER TYPE ... ADD VALUE` (valor novo inutilizável na mesma transação);
- e, o mais importante, **permite listar só os estados desta fatia**. O CHECK da 0096 aceita
  `initiated`, `expired` e `blocked` — nada mais. O congelamento de escopo vira **constraint**, não
  comentário pedindo cuidado: o banco recusa uma transição que esta fatia não deveria produzir. Cada
  fatia seguinte substitui a constraint acrescentando os seus.

Com isso a regra "só o que se escreve" volta a valer **também** para os estados, sem exceção — e o
ponto sobre ordem de declaração some junto: `text` ordena alfabeticamente, então **nada deve ordenar
por `status`** para deduzir progresso. A ordem do funil vive no código, em `SIGNUP_FUNNEL_ORDER`.

### 4. Estados alcançáveis nesta fatia

Só três: `initiated`, `expired` e `blocked`. Qualquer outra transição é erro de programação aqui e
**deve ter teste que falhe**, não comentário pedindo cuidado.

### 5. Token, TTL e concorrência

Vale integralmente o §21.6 — 32 bytes CSPRNG, só o HMAC no banco, comparação em tempo constante, 15 min
de inatividade e 60 min absolutos, CAS por `status + row_version`, `409` para a aba perdedora, `410`
genérico para token consumido ou expirado, token nunca na URL. Esta ADR não redefine nada disso;
registra que O-2a é onde passa a existir em código.

### 6. Indisponibilidade do limiter: graduada, não uniforme

**Esta decisão foi revista depois de ler o código.** A versão anterior desta ADR mandava *fail-closed*
para tudo. Duas coisas contradizem isso:

- o padrão vigente do projeto **degrada**: `BoundedFallbackLimiter` (`src/lib/auth/rate-limit.ts`) cai
  para contagem em memória, limitada e com evicção FIFO, quando o Redis some;
- a própria ADR-053 escreve "falham **fechadas/degradadas**" — permite as duas, não manda fechar.

E o argumento decisivo é o custo do que se está protegendo. **Nesta fatia, uma sessão excedente custa
uma linha que expira em 60 minutos, sem PII e sem chamada externa.** Fechar o cadastro inteiro porque o
Upstash caiu troca um custo desprezível por indisponibilidade total de aquisição.

Portanto:

| Operação | Limiter indisponível | Por quê |
| --- | --- | --- |
| `POST /api/signup/sessions` | **degrada** para o fallback limitado | Linha efêmera, sem PII, sem custo externo |
| `GET .../me` | degrada para permitido | Não cria nada |
| Envio de e-mail de verificação (fatia seguinte) | **fecha** | Custo externo, abusável, não reversível |
| Criar customer/assinatura no Asaas (O-5) | **fecha** | Registro órfão em terceiro, sem `DELETE` que resolva |

Contrapartida honesta do "degrada": em serverless o fallback é por instância, então um atacante
distribuído consegue mais que o limite nominal durante um apagão do Redis. Aceito **nesta fatia**
porque o teto de dano é linha efêmera — e contido pelo teto da decisão 6b. Não seria aceitável nas
linhas de baixo da tabela, e por isso elas fecham.

### 6b. O teto de sessões vivas — o que torna "degradar" defensável

`SIGNUP_SESSION_CEILING` limita quantas sessões **vivas simultâneas** podem existir. Acima dele, a
criação é recusada.

**O que ele NÃO é:** não é limite de contas criadas, nem de cadastros por período. Em O-2a não existe
conta nenhuma — nem usuário, nem tenant, nem e-mail enviado. Um limite de negócio por período barraria
cliente de verdade e não é isto.

**O que ele é:** contenção de raio de alcance. O banco é o mesmo que guarda dado clínico de clínicas
pagantes. Um endpoint público e anônimo não pode ter caminho para fazer uma tabela crescer sem fim lá
dentro. O teto torna explícito um trade-off que sem ele ficaria implícito:

| | com teto | sem teto |
| --- | --- | --- |
| atacante enche | derruba o **cadastro** — ruim, limitado, recuperável | degrada o **banco** que atende paciente |

**Custo assumido:** um atacante pode encher o teto de propósito para negar cadastro (DoS por
esgotamento). Aceitável porque (a) em operação normal o rate limit o para muito antes — o teto só
aperta enquanto o limiter distribuído está fora; (b) é dimensionado ordens de grandeza acima da
concorrência legítima; (c) o que ele nega é exatamente o que o *fail-closed* negaria, mas **só sob
ataque**, não a cada soluço do Redis.

**Implementação:** conferido por amostragem (uma vez a cada 30 s por instância), não a cada
requisição — um `COUNT` por chamada seria custo fixo no caminho quente para uma válvula que quase
nunca dispara. E não depende do Redis, porque o cenário em que o teto importa é o de Redis fora.

### 7. Observação de leads — o que a fatia entrega de verdade

| Evento | Quando | Campos |
| --- | --- | --- |
| `signup.session.created` | sessão criada | `risk_level`, se houve desafio |
| `signup.session.challenged` | Turnstile exigido (O-2b) | `risk_level` |
| `signup.session.blocked` | tentativas/risco estouraram | motivo categorizado |
| `signup.session.expired` | janitor ou leitura vencida | último `status`, idade |

Nenhum carrega e-mail, nome, telefone, IP bruto ou token. `email_hash` existirá para deduplicação e
limite, **nunca** para contato ou junção com marketing.

**Limite honesto:** isto não é um painel de funil, e O-2 sozinho não mostra em qual das três perguntas a
pessoa parou — elas ainda não existem. O que O-2 garante é que, quando existirem, a contagem será
estado com CAS e não estimativa de tráfego. Com a ordem A, `details_complete` passa a ser o **primeiro**
degrau observável depois de `initiated`, o que torna a taxa "abriu → respondeu as perguntas" medível
já na fatia seguinte.

### 8. Retenção, rollback e rollout

Nenhuma coluna desta fatia guarda PII, então o janitor **apaga** — mas nasce preparado para PII, porque
a fatia seguinte a traz (item 2 de "Ordem do fluxo").

Rollback é barato e deve continuar assim enquanto durar O-2: kill switch por env desliga a rota; como
não existe tenant, assinatura nem usuário criado por este caminho, reverter é desligar a rota e, se
necessário, remover a tabela. **Depois de O-6 isso deixa de ser verdade** — mais uma razão para não
juntar as fatias.

**Rollout:** a rota não precisa nascer pública. Subir atrás de flag ou allowlist, validar o anti-abuso
com tráfego controlado e só então abrir é prudência barata numa superfície que existe justamente para
receber desconhecidos.

## O-2b — como o desafio ficou (13/09)

### Sinais disponíveis, e os que não existem ainda

O §21.8 lista velocidade por IP/sessão/e-mail/dispositivo, tokens inválidos, falhas de schema, origem
cross-site e assinatura de WAF. **Quatro existem hoje**; os outros não têm de onde vir nesta fatia, e
isso está no código em vez de virar dívida silenciosa:

| Sinal | Faixa | Por quê |
| --- | --- | --- |
| `Origin` de outro host | **alto** → recusa | Não há caso legítimo de POST de cadastro vindo de outra origem. Não vale gastar desafio |
| `Origin` ausente | moderado → desafia | Cliente não-browser pode ser legítimo. "Não é o fluxo normal" ainda não é "é abuso" |
| corpo recusado pelo schema | moderado | Bot manda lixo; a nossa tela, não |
| balde do IP ≥ 50% | moderado | Pedir prova ANTES de o limite estourar transforma o rate limit de muro em pedágio |
| **limiter degradado** | moderado | Ver abaixo |

Fora do escopo por não existirem: e-mail e dispositivo (a ordem A põe as perguntas depois, então a
fatia não os coleta) e assinatura de WAF (não há WAF). O classificador é função **pura** que recebe os
sinais prontos — acrescentar um não mexe em quem o chama.

### Limiter degradado vira desafio: controle compensatório

Decisão que emergiu ao ligar as peças, e que fecha um buraco da decisão 6.

Quando o Upstash cai, a defesa por IP **deixa de existir de fato** — em serverless o fallback é por
instância, e a carga de 13/09 mediu exatamente isso: 300 tentativas de IPs distintos, zero recusas.
A decisão 6 aceitava isso porque o teto contém o pior caso. Mas havia um degrau intermediário vazio.

Agora o estado degradado **exige desafio**. Isso troca "perdemos o rate limit" por "prove que é
humano", em vez de "deixa passar", e só encarece o cadastro durante o apagão. A escada fica:

```text
Redis são          → cadastro normal, sem desafio
Redis fora         → desafio para todos (o desafio substitui o limite que sumiu)
teto atingido      → recusa
```

### Falha fechada, mas só no caminho de desafio

`verifyTurnstileToken` devolve `unreachable` quando não consegue falar com a Cloudflare, e o caller
**recusa**. É o mesmo raciocínio graduado da decisão 6, aplicado um nível acima: esta função só é
chamada quando algo na requisição **já pediu prova**, e não conseguir a prova não autoriza seguir como
se ela tivesse sido dada.

O caminho de risco baixo não passa por ali. Então um apagão da Cloudflare **não derruba o cadastro
normal** — derruba só o das requisições que já estavam sob suspeita. Há teste para isso.

### Códigos HTTP: quatro desfechos, quatro códigos

| Código | Desfecho | O que o cliente faz |
| --- | --- | --- |
| `429` | `rate_limited` | espera (`Retry-After`) |
| `503` | `at_capacity` | espera (`Retry-After`) |
| `403` | `blocked` (risco alto) | nada — não há retry útil |
| `401` | `challenge_required` | resolve o Turnstile e repete |

Colapsar em um só apagaria a distinção justamente no incidente em que ela decide o que fazer.

### Contrato de chaves, conferido no ambiente

O `normalizeDevelopmentAliases` deste projeto é **allowlist explícita**. Turnstile não estava nela, e
as variáveis `*_DEV` que o fundador criou no `.env.local` **não eram lidas por nada** — quem valia era
o nome canônico. Corrigido: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` entraram no
schema e no alias, seguindo a convenção de `DATABASE_URL` e `ASAAS_*`.

Variantes `*_LOCAL` não têm função: `.env.local` só é lido em localhost, então uma chave por ambiente
basta — e para localhost o caminho previsto são as chaves de teste da Cloudflare, sem widget.

### Verificação do O-2b no Preview — 13/09

O classificador exercitado por HTTP real, cada faixa com o seu código:

| Requisição | Resposta |
| --- | --- |
| `Origin` coerente | `201` — segue sem desafio, `riskLevel: 0`, `risk: clean` |
| `Origin` ausente | `401 challenge_required` |
| `Origin` de outro host | `403 blocked`, `risk: cross_site_origin` |
| campo extra no corpo | `400 invalid_body` |

**E a prova que o status HTTP sozinho não dava.** Um token forjado no caminho de desafio respondeu
`401` — mas `not_configured` e `rejected` mapeiam para o MESMO `401`, então a resposta não distinguia
"a Cloudflare recusou" de "não há chave configurada". A métrica distinguiu, e na primeira tentativa
disse `signup.turnstile.not_configured`: comportamento correto (falha fechada) pelo motivo errado, que
teria passado por "integração funcionando".

Causa: as chaves estavam no Preview com sufixo `_DEV`, e o alias não roda lá (`NODE_ENV=production` no
Preview da Vercel — ver o aviso em `src/lib/env.ts`). Corrigido para o nome canônico, redeploy, e o
mesmo teste passou a emitir:

```json
{"event":"signup.turnstile.rejected","codes":["invalid-input-response"]}
```

O código de erro é o que fecha a prova: **`invalid-input-response`** (token inválido) e não
`invalid-input-secret` — ou seja, a Cloudflare **aceitou a nossa secret** e recusou o token. A
integração fala com o provider de verdade, e o token forjado não cria sessão.

## Matriz endpoint × limites (evidência 2)

Ambos os endpoints são **públicos e anônimos** — não há sessão Supabase, e por isso
`api/signup` está excluído do gate do middleware. O que os protege não é autenticação.

| | `POST /api/signup/sessions` | `GET /api/signup/sessions/me` |
| --- | --- | --- |
| efeito | INSERT de uma linha | UPDATE de uma linha (renova o idle) |
| limite por IP | 20 / 15 min (sliding window) | 120 / 15 min |
| orçamento | próprio (`rl:signup:ip`) | próprio (`rl:signup:read`) |
| teto global | `SIGNUP_SESSION_CEILING` | não se aplica (não cria) |
| Redis fora | **degrada** p/ fallback em memória | **degrada** |
| corpo | ≤ 1 KiB, JSON vazio, Zod `.strict()` | sem corpo |
| nega com | 429 `rate_limited` · 503 `at_capacity` · 400 `invalid_body` · 413 `body_too_large` | 429 `rate_limited` · 410 `gone` |
| `Retry-After` | 60 s | 60 s |

Três decisões que a matriz torna visíveis:

1. **Orçamentos separados.** Leitura é frequente e legítima (refresh, troca de aba);
   criação é rara. Num balde único, um refresh insistente consumiria a cota de
   *iniciar* cadastro — e o usuário seria punido por usar a tela normalmente.
2. **`/me` tem limite porque ESCREVE.** Renovar o prazo de inatividade é um UPDATE
   por chamada. Sem limite, quem tem um token válido transformaria uma leitura barata
   em carga de escrita sustentada. A primeira versão desta fatia não tinha esse limite;
   o buraco apareceu ao montar esta tabela.
3. **429 e 503 são códigos diferentes de propósito.** "Este cliente pediu demais" e "o
   sistema todo está no teto" pedem reações opostas de quem opera. Colapsar nos dois num
   código só apagaria a distinção justamente no incidente em que ela decide o que fazer.

## Evidência necessária para aceitar ESTA fatia

1. desenho da migration revisado: grants, ausência de acesso `anon`/`authenticated`, índices
   (`token_hash`, `status + idle_expires_at`) e decisão explícita sobre adiar, junto com as colunas, a
   constraint que impede `completed` incompleto;
2. matriz endpoint × limites aprovada para os dois endpoints;
3. testes: unit (entropia, HMAC, TTL, CAS, tempo constante), integration DB (expiração, duas abas,
   concorrência, janitor apagando PII simulada, ausência de grants), adversarial (replay, token
   forjado, enumeração) e carga scratch no comportamento degradado;
4. **teto auto-limitante + sinal no `/api/health`** — é o que sustenta degradar em vez de fechar.
   Resolvido em código, não em configuração: ver "Por que não um alerta novo", abaixo;
5. para O-2b apenas: responsável nomeado pela configuração do Turnstile e limiares das faixas.

**Não** entram aqui: Sandbox do Asaas, linker do Google, contrato de trial. Eles bloqueiam O-5 e O-1, e
não esta fatia.

## Por que não um alerta novo

A versão anterior exigia "alerta de crescimento da tabela" como evidência de aceite. Duas coisas
mudaram isso.

**Primeiro, uma correção de fato.** Eu havia lido o `alerting-setup.md` como se o alerting do projeto
fosse `NOT_TESTED` por inteiro. A evidência ali é mais estreita: diz que a API do Sentry respondeu
401/403 **aos tokens locais** e que não havia credencial Better Stack *naquela tentativa, em 18/08*.
O fundador informou em 12/09 que **o Sentry funciona em produção e os monitores das APIs de saúde no
Better Stack também**. O runbook está desatualizado, não o ambiente.

**Segundo, a distinção que sobra.** Há três caminhos de alerta, e eles não são intercambiáveis:

| caminho | estado |
| --- | --- |
| probe HTTP de saúde → Better Stack | funciona |
| exceção → Sentry | funciona |
| métrica em linha de log → regra de limiar → canal | seria novo |

O sinal de pressão da tabela é exatamente da forma que o `/api/health` já trata: o check `outbox` vira
`degraded` quando `oldest_pending_age_s > 300` — um `COUNT` com limiar, agregado em `status`, com
`?strict=1` devolvendo 503 para monitor que só olha código HTTP.

Então o sinal entra como mais um check (`signup`), **degradando a 80% do teto** — não a 100%, porque
um alerta que dispara junto com a recusa avisa depois da queda. Zero caminho novo para provar, e a
contenção de um risco de segurança deixa de depender de um mecanismo não exercitado.

## Evidência produzida em 12/09 (O-2a)

| Item | Estado |
| --- | --- |
| migration revisada: grants, RLS, índices | **feito** — e verificado NO BANCO após aplicar, não só no SQL: RLS ENABLE+FORCE, zero policies, grants só para `postgres` (dono) e `service_role`, CHECK recusando estado de fatia futura |
| matriz endpoint × limites | **feito** — ver seção acima |
| testes unit | **feito** — 12 casos |
| teste de integração contra o banco | **feito** — `pnpm smoke:signup-session`, PASS com readback zero |
| adversarial (cookie forjado, resposta genérica) | **feito** — verificado no Preview: cookie ausente e cookie forjado devolvem `410` com corpo idêntico |
| teto auto-limitante + sinal no `/api/health` | **feito** |
| carga scratch no modo degradado | **feito** — `pnpm load:signup-degraded`, PASS; resultados abaixo |
| dono do Turnstile | conta criada pelo fundador em 13/09; faltam os widgets por ambiente e as chaves no env (§1b) |

### Carga com o limiter degradado — 13/09

A degradação **não foi mockada**: o script aponta `UPSTASH_REDIS_REST_URL` para
`http://127.0.0.1:1`, o cliente falha em rede de verdade e o `catch` de
`assertSignupSessionAllowed` cai no `BoundedFallbackLimiter` — o mesmo caminho de um outage real.
Os logs confirmam: `auth.ratelimit.degraded` com `reason_category: network`, `fetch failed`.

| Fase | Resultado |
| --- | --- |
| **A1** — 60 tentativas de UM IP | o fallback em memória **continua limitando**: criações param no teto configurado (20/15 min) e o resto é recusado |
| **A2** — 300 tentativas de IPs distintos | **zero recusas pelo limiter**. Confirma o pior caso: em serverless o fallback é por instância, e um atacante distribuído passa por ele |
| **B** — tabela no teto (2.010 vivas) | **10 de 10 recusadas** com `at_capacity`; **nenhuma** sessão criada acima do teto |
| **C** — janitor | **441 remoções/s** (1.691 linhas em 3,8 s) |
| limpeza | readback **zero** — nenhuma linha do teste sobrou |

**O que isso prova e o que NÃO prova.** Prova que a contenção funciona: com o limiter fora e
IPs distintos, quem segura é o teto, e ele segurou 100% das tentativas. Prova também que a
recuperação é muito mais rápida que a degradação — o janitor drena a ~441/s.

**Não prova** qual é a vazão de um atacante real. A vazão medida aqui (4,1 sessões/s, o que daria
~8 min para encher o teto) é a DESTE cliente, de uma máquina doméstica com RTT de ~160 ms ao banco e
concorrência 20. Um atacante em datacenter seria muito mais rápido. O número honesto a tirar daqui
não é "leva 8 minutos para encher", é **"encheu, e o teto segurou; e o dreno é ~100× mais rápido que
o enchimento observado"**.

**Consequência operacional registrada:** o `/api/health` degrada a 80% do teto, então o sinal chega
antes de a recusa começar. Com dreno a 441/s, uma passada do janitor (10 em 10 min) devolve o
sistema ao normal em segundos assim que a fonte de abuso para.

### O que a verificação real pegou, e o unitário não

1. **Bug de runtime em `readSignupSession`.** A renovação interpolava um `Date` do JS dentro de um
   template `sql` cru; o driver não faz bind de `Date` ali. O teste unitário passou porque o banco é
   mock — `GET /me` daria **500 em toda chamada**. Apareceu na primeira execução do smoke contra o
   banco de verdade. A correção passou os dois prazos para o relógio do BANCO
   (`now() + make_interval`), o que de quebra eliminou deriva de relógio entre instância e Postgres.
2. **`qoro_runtime` com DML na tabela nova** (migration 0097). Só apareceu ao consultar os grants
   reais em vez de assumir que "não conceder" bastava.
3. **`GET /me` sem rate limit.** A rota ESCREVE (renova o idle). O buraco apareceu ao montar a matriz
   de limites — escrever a tabela foi o que obrigou a olhar os dois endpoints lado a lado.

Os três reforçam a mesma coisa: **verificar contra o sistema real acha o que raciocinar sobre o código
não acha.**

## Consequências

### Positivas

- a fatia é começável hoje: não depende de O-1, de Turnstile nem de contrato com terceiro;
- sem PII e sem tenant, o custo de errar é baixo e o rollback é real;
- a sessão com CAS transforma contagem de funil em estado, não em estimativa;
- degradar em vez de fechar mantém a aquisição viva durante apagão de um terceiro;
- congelar o escopo impede que "bootstrap" cresça até virar o track inteiro num PR só.

### Custos e riscos

- migration global pré-tenant é a primeira tabela fora do modelo tenant-scoped; exige revisão de grants
  mais atenta que o normal, porque `withTenant` não a protege;
- o fallback por instância é mais fraco que o limiter distribuído; depende do alerta de crescimento
  para não virar ponto cego;
- Turnstile é configuração manual em terceiro: sem dono nomeado, a proteção fica desligada sem ninguém
  perceber — por isso está na evidência de O-2b, não na de O-2a;
- a tabela nasce incompleta de propósito; quem ler o §21.5 esperando o schema final vai estranhar.

## Alternativas rejeitadas

- **autenticação anônima do Supabase (`signInAnonymously`) no lugar da tabela própria:** economizaria
  cripto, cookie e janitor próprios, e o projeto já tem o encanamento SSR/PKCE. Perde **neste código**
  porque o usuário anônimo nasce em `auth.users` com JWT real, e toda política RLS do projeto pressupõe
  que quem tem JWT é usuário de verdade — a ADR-007 descreve `withTenant` como a defesa principal.
  Adotá-la obrigaria a auditar todas as políticas e o middleware para distinguir `is_anonymous`, raio de
  alcance muito maior que uma tabela isolada sem grant para ninguém. Registrada porque é uma alternativa
  legítima que a ADR-053 não considerou;
- **criar a tabela inteira do §21.5 agora:** colunas sem escritor, e constraint referenciando dado que
  nenhuma fatia produz;
- **`pgEnum` para `status`, completo ou parcial:** as duas versões anteriores desta ADR debateram qual
  das duas; a resposta é nenhuma. Enum completo carrega valores que a fatia não pode produzir (então o
  banco não ajuda a congelar o escopo) e enum parcial paga a armadilha do `ALTER TYPE ... ADD VALUE`.
  `text` + CHECK escapa das duas — ver decisão 3;
- **`text` puro, como `clinic_invites` faz:** é o análogo mais próximo, mas sem CHECK não há validação
  nenhuma no banco — um estado escrito errado passa em silêncio. Copiar o vizinho aqui seria copiar a
  fraqueza dele;
- **fail-closed uniforme:** ver decisão 6 — contradiz o padrão vigente do projeto e troca custo
  desprezível por indisponibilidade de aquisição;
- **manter a ordem do §21.2 (identidade antes das perguntas):** decisão do fundador em 12/09 pela opção
  A; a ordem C pede credencial antes de qualquer valor percebido;
- **ordem B (login e cartão no mesmo passo, verificação depois):** criaria customer e assinatura no
  Asaas para e-mail não verificado — órfão em terceiro, que nenhum `DELETE` nosso resolve;
- **fazer O-1 antes por causa do número:** a numeração do §21.19 é de fatias, não de dependências, e a
  atribuição é explicitamente proibida de criar sessão;
- **guardar as respostas das três perguntas já em O-2:** cravaria desenho de produto que ainda vai
  mudar, e traria PII para uma fatia que hoje não tem nenhuma.

## Revisão de 12/09

A primeira versão desta ADR foi revisada no mesmo dia, a pedido do fundador ("o escopo como está é o
melhor possível ou existe outra abordagem?"). Mudou:

1. **ordem do fluxo** — a versão inicial não percebeu que o fluxo descrito pelo fundador invertia a
   ordem cravada no enum do §21.5. Resolvido pela opção A;
2. **indisponibilidade do limiter** — de *fail-closed* uniforme para graduado, depois de ler
   `BoundedFallbackLimiter` e reler o "fechadas/degradadas" da ADR-053;
3. **corte em O-2a/O-2b** — tira a dependência humana do Turnstile do caminho crítico;
4. **alternativa do Supabase anônimo** — registrada com o motivo da rejeição;
5. **teto auto-limitante no lugar de alerta novo** (decisão 6b e "Por que não um alerta novo"), depois
   de o fundador corrigir minha leitura sobre o estado do alerting;
6. **`text` + CHECK no lugar de `pgEnum`** (decisão 3), depois de ler `clinic_invites` ao escrever a
   migration — o congelamento de escopo passa a ser constraint de banco.
