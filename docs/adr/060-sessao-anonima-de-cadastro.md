# ADR-060 — Fatia O-2: sessão anônima de cadastro (bootstrap seguro)

- **Status:** Proposed — congela o escopo da fatia O-2. Não autoriza migration aplicada, deploy, nem as
  fatias O-1, O-3 e seguintes
- **Data:** 2026-09-12
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
   `signup_sessions`, cookie/HMAC/TTL/CAS, rate limit fail-closed, Turnstile, janitor). A escolha foi
   explícita quanto ao motivo: *"prezo pela segurança e quero ter uma boa observação de leads pelo
   formulário de cadastro"*. O §31.2 registra que o rótulo "O-2" é ambíguo no roadmap; **esta ADR adota
   a leitura do §21.19** e é a referência para a fatia.
2. **Cartão pelo Checkout hospedado do Asaas**, nunca por formulário próprio. A ADR-053 já decidia isso
   por escopo PCI; o fundador acrescentou a razão de produto: *"usando um personalizado nosso, pode
   haver falta de confiança em colocar as informações lá"*. As duas razões apontam para o mesmo lugar, e
   a de produto é a que sobrevive mesmo se o argumento técnico mudar.
3. **Fluxo pretendido:** três perguntas → e-mail/senha → checkout. Isso é desenho de produto das fatias
   O-1/O-4; entra aqui apenas como restrição: **O-2 não pode cravar o número nem o conteúdo das
   perguntas** no schema ou na máquina de estados.

### Por que O-2 pode começar antes de O-1

Na leitura do §21.19, O-1 é **atribuição** (`/comecar`, parâmetros allowlisted, linker do Google) e o
§21.3 exige que ela **não** crie `signup_sessions`. A coluna `attribution` é anulável. Logo O-2 não
depende de O-1 — a ordem numérica aqui não é ordem de dependência. Uma sessão criada sem atribuição é
uma sessão orgânica, que é um caso real e permanente, não um degrau temporário.

## Decisão

### 1. O que a fatia entrega

1. Migration da tabela global `signup_sessions`, pré-tenant, sem grants a `anon`/`authenticated`,
   acessível somente pelo serviço mínimo allowlisted ([ADR-010](010-security-definer-patterns.md)).
2. `POST /api/signup/sessions` — cria a sessão e devolve o token bruto **apenas** no cookie
   `__Host-qoro_signup` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `Domain`).
3. `GET /api/signup/sessions/me` — devolve o estado **sanitizado** da própria sessão, para a página
   sobreviver a refresh e a múltiplas abas.
4. Rate limiting multidimensional **fail-closed** e bot protection adaptativa (Turnstile só acima do
   limiar de risco), conforme §21.7 e §21.8.
5. Janitor de expiradas, em lotes pequenos.
6. Eventos de observação de funil, sem PII (item 7 abaixo).

### 2. O que a fatia NÃO entrega — e isto é escopo congelado, não omissão

- **sem** `signUp` no Supabase, confirmação de e-mail ou PKCE (é O-3);
- **sem** qualquer chamada ao Asaas, intenção de billing ou Checkout (é O-5);
- **sem** criação de `clinics`, profile owner ou qualquer recurso de tenant (é O-6);
- **sem** `/comecar`, parâmetros de campanha ou tag do Google (é O-1);
- **sem** as três perguntas do wizard e sem tela de cadastro (produto, O-1/O-4).

O-2 é o **substrato**: a sessão que torna confiável tudo o que as outras fatias vão pendurar nela.

### 3. Colunas: só as que esta fatia escreve

O §21.5 desenha a tabela final. **Não vamos criá-la inteira agora.** Nesta fatia entram:

```text
id · token_hash · status · risk_level · failed_attempts · row_version
idle_expires_at · absolute_expires_at · consumed_at · created_at · updated_at
```

Ficam para as fatias que as escrevem: `auth_user_id` e `email_hash` (O-3), `owner_name`, `clinic_name`
e `selected_plan_id` (O-4), `attribution` (O-1), `completed_at` (O-6).

**Motivo, e é o mesmo do [§30.6](../qorov2.md#306-decisão-do-fundador-1209-apenas-crm):** coluna que
nasce sem caminho de escrita e sem leitor é dado morto que toda revisão futura precisa explicar. Aqui o
custo de adiar é ainda menor que no caso do CRM: **as linhas desta tabela vivem no máximo 60 minutos**,
então `ALTER TABLE ADD COLUMN` mais tarde não tem backfill, não tem lock relevante e não tem linha
histórica para reconciliar. Adiar é quase de graça; antecipar não é.

**A exceção deliberada é o enum de `status`: ele nasce completo**, com os dez valores do §21.5
(`initiated`, `identity_pending`, `email_verified`, `details_complete`, `checkout_pending`,
`provisioning`, `completed`, `expired`, `blocked`, `failed`). Valor de enum não usado é metadado com
custo zero — não ocupa linha, não aparece em `SELECT`, não confunde leitura. Já `ALTER TYPE ... ADD
VALUE` é armadilha de migration: o valor novo não pode ser usado na mesma transação que o adiciona.
Trocar um risco de migration por zero custo de dado é a troca certa, e é por isso que a regra
"só o que se escreve" vale para colunas e não para valores de enum.

### 4. Estados alcançáveis nesta fatia

Só três: `initiated` (criação), `expired` (TTL vencido, pelo janitor ou na leitura) e `blocked`
(tentativas ou risco). Qualquer outra transição é erro de programação nesta fatia e **deve ter teste que
falhe**, não comentário pedindo cuidado. `identity_pending` passa a ser alcançável em O-3.

### 5. Token, TTL e concorrência

Sem novidade: vale integralmente o §21.6 — 32 bytes CSPRNG, só o HMAC no banco, comparação em tempo
constante, 15 min de inatividade e 60 min absolutos, CAS por `status + row_version`, `409` para a aba
perdedora, `410` genérico para token consumido ou expirado, token nunca na URL. Este ADR não redefine
nada disso; registra que a fatia O-2 é onde isso passa a existir em código.

### 6. Fail-closed é uma decisão de disponibilidade, não só de segurança

Se o limiter distribuído estiver indisponível, **a criação de sessão falha**. Consequência aceita
conscientemente: durante um apagão do Upstash, ninguém consegue iniciar cadastro. A alternativa —
degradar para permitir — transforma a indisponibilidade de um terceiro em janela aberta de criação
massiva, num endpoint público e anônimo que gera escrita no banco. Cadastro é a superfície onde
indisponibilidade custa menos que abuso: quem não conseguiu se cadastrar volta; tenant-lixo e custo de
e-mail não voltam atrás.

Isto vale para a criação. A **leitura** do próprio estado (`GET .../me`) pode degradar para permitido,
porque não cria nada.

### 7. Observação de leads — o que O-2 entrega de verdade

O objetivo declarado do fundador é enxergar o funil do formulário. A fatia entrega os eventos, **sem
PII**:

| Evento | Quando | Campos |
| --- | --- | --- |
| `signup.session.created` | sessão criada com sucesso | `risk_level`, se houve desafio |
| `signup.session.challenged` | Turnstile exigido | `risk_level` |
| `signup.session.blocked` | tentativas/risco estouraram | motivo categorizado |
| `signup.session.expired` | janitor ou leitura vencida | último `status`, idade |

Nenhum deles carrega e-mail, nome, telefone, IP bruto ou token. `email_hash` existe (em O-3) para
deduplicação e limite, **nunca** para contato ou para juntar com marketing.

**Limite honesto:** isto não é um painel de funil, e O-2 sozinho não mostra "em qual das três perguntas
a pessoa parou" — as perguntas não existem ainda. O que O-2 garante é que, quando existirem, a contagem
será confiável: sem sessão, "quantos começaram" seria estimativa de tráfego; com ela, é estado com CAS.

### 8. Retenção e rollback

Como nenhuma coluna desta fatia guarda PII, o janitor **apaga** linha expirada — não há o que
anonimizar. Isso é consequência direta da decisão 3: adiar as colunas de PII adiou junto a superfície de
LGPD da fatia.

Rollback é barato e deve continuar assim enquanto durar O-2: kill switch por env desliga a rota; como
não existe tenant, assinatura nem usuário criado por este caminho, reverter é desligar a rota e, se
necessário, remover a tabela. **Depois de O-6 isso deixa de ser verdade** — é mais uma razão para não
juntar as fatias.

## Evidência necessária para aceitar ESTA fatia

Bem menor que a da ADR-053, porque a fatia não fala com provider nenhum:

1. desenho da migration revisado: grants, ausência de acesso `anon`/`authenticated`, índices
   (`token_hash`, `status + idle_expires_at`) e a constraint que impede `completed` sem as colunas que
   ainda nem existem — ou, na ausência delas, a decisão explícita de adiar a constraint junto;
2. matriz endpoint × limites aprovada para os dois endpoints desta fatia;
3. testes: unit (entropia, HMAC, TTL, CAS, tempo constante), integration DB (expiração, duas abas,
   concorrência, janitor, ausência de grants), adversarial (replay, token forjado, enumeração) e carga
   scratch no limiter fail-closed;
4. runbook e alerta para "limiter indisponível" — sem isso, o fail-closed vira indisponibilidade
   silenciosa de aquisição;
5. responsável nomeado pela configuração do Turnstile.

**Não** entram aqui: Sandbox do Asaas, linker do Google, contrato de trial. Eles continuam bloqueando
O-5 e O-1, e não esta fatia.

## Consequências

### Positivas

- a fatia é começável hoje: não depende de O-1 nem de contrato com terceiro;
- sem PII e sem tenant, o custo de errar é baixo e o rollback é real;
- a sessão com CAS transforma contagem de funil em estado, não em estimativa;
- congelar o escopo impede que "bootstrap" cresça até virar o track inteiro num PR só.

### Custos e riscos

- migration global pré-tenant é a primeira tabela fora do modelo tenant-scoped; exige revisão de grants
  mais atenta que o normal, porque `withTenant` não a protege;
- fail-closed acopla disponibilidade de cadastro à do limiter (aceito acima, mas precisa de alerta);
- Turnstile é configuração manual em terceiro, fora do código — se ninguém for dono dela, a proteção
  fica desligada sem ninguém perceber;
- a tabela nasce incompleta de propósito; quem ler o §21.5 esperando o schema final vai estranhar, e é
  por isso que a decisão 3 está escrita por extenso aqui.

## Alternativas rejeitadas

- **criar a tabela inteira do §21.5 agora:** sete colunas sem escritor, e a constraint de `completed`
  referenciando dado que nenhuma fatia produz. O argumento do §30.6 vale aqui, e mais forte, porque a
  linha é efêmera;
- **enum parcial, crescendo por fatia:** troca custo zero (valor de enum sem uso) por armadilha real
  (`ALTER TYPE ... ADD VALUE` não utilizável na mesma transação);
- **fazer O-1 antes por causa do número:** a numeração do §21.19 é de fatias, não de dependências, e a
  atribuição é explicitamente proibida de criar sessão;
- **degradar o limiter para permitir quando o Upstash cair:** abre criação massiva num endpoint público
  e anônimo exatamente quando ninguém está olhando;
- **guardar as respostas das três perguntas já em O-2:** cravaria no schema um desenho de produto que
  ainda vai mudar, e traria PII para uma fatia que hoje não tem nenhuma.
