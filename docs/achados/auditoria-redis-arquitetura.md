# Auditoria Redis — Arquitetura, Cache, Escala & Segurança

> **Escopo:** todo o uso de Redis no ClinicaOS_V2 (Qoro). Na prática, uma única
> superfície: **rate limiting de autenticação** via **Upstash serverless Redis (REST/HTTPS)**
> com `@upstash/ratelimit` + `@upstash/redis`. A auditoria cobre também as **não-utilizações**
> (cache, sessão, filas, locks, pub/sub) para validar que a ausência de Redis nelas é uma
> decisão de arquitetura correta — e não uma lacuna.
> **Método:** auditoria manual expert, validando implementação contra a documentação
> (`docs/`, ADRs) na ótica `DOCUMENTAÇÃO → NECESSIDADE → IMPLEMENTAÇÃO → RISCO`. Pensando como
> engenheiro de Redis/sistemas distribuídos, DevSecOps e engenheiro pré-escala (milhões de
> operações).
> **Natureza:** somente leitura. **Nenhum código ou configuração foi alterado.**
> **Data:** 2026-07-13 · **Branch:** `docs/identity-practitioner-model`

> **⚙️ REMEDIAÇÃO APLICADA — 2026-07-14.** Esta auditoria foi remediada. Os achados MÉDIOS
> (R1, R2, R3) foram resolvidos em código + doc; R4/R7 resolvidos (barato, sem dívida); R5 deferido
> com justificativa (é da auditoria de APIs — M3/B6/B7); R6 rotação coberta + hardening documentado
> (residual é config do painel Upstash). Cada achado tem uma seção **Remediação** abaixo; o rodapé
> registra data/branch/responsável. A seção original (acima de cada bloco de remediação) é
> preservada como registro da auditoria. Ver o [rodapé de remediação](#rodapé-de-remediação).

---

## 1. Resumo Executivo

### Estado geral

O uso de Redis neste codebase é **minimalista, deliberado e correto**. Existe **um único
módulo** que fala com Redis — [`src/lib/auth/rate-limit.ts`](../../src/lib/auth/rate-limit.ts)
— e ele faz **uma única coisa**: rate limiting dos fluxos de autenticação (login, password
reset, join/onboarding) através do **Upstash**, um Redis serverless acessado por **REST/HTTPS**
com token bearer.

O ponto mais importante desta auditoria é **o que o sistema deliberadamente NÃO coloca no
Redis**, e por quê:

| Categoria clássica de Redis | Neste sistema | Autoridade real |
|---|---|---|
| Filas / jobs assíncronos | **Postgres** — outbox transacional (`FOR UPDATE SKIP LOCKED`) | ADR-003 |
| Locks / concorrência / idempotência | **Postgres** — `idempotentMutation` + advisory locks | ADR-011 |
| Sessão / autenticação | **Supabase Auth** — JWT assinado + cookies | ADR-008 |
| "Cache" de permissões | **Claims do JWT** (stale ≤60s), não Redis | ADR-009 |
| Cache de respostas / dados | **Não existe cache Redis** | — |
| Pub/Sub / eventos | **Outbox → handlers** (não pub/sub) | ADR-003/015 |

Isto é um **acerto de arquitetura**, não uma omissão. Para dado clínico (LGPD, auditoria,
exactly-once), a durabilidade transacional do Postgres é superior a filas/locks em Redis, que
introduziriam uma **segunda fonte da verdade** — exatamente o anti-padrão que uma auditoria de
Redis costuma caçar. Aqui ele foi evitado por construção.

**Conclusão:** não há achados CRÍTICOS nem ALTOS. O uso atual do Redis é seguro e eficiente
(sem `KEYS *`, sem scans, TTL automático, sem vazamento de memória, fail-open documentado). Os
achados são de **hardening operacional** e, principalmente, de **preparação para escala**:
fixar convenções (namespacing por tenant, discriminador de ambiente) e alertas **antes** de o
Redis crescer para além do rate-limit.

### Pontos positivos (detalhados na §4)

- **Redis nunca é fonte da verdade** — só contadores efêmeros; o Postgres (`login_attempts`)
  é a autoridade auditável. Perfeitamente alinhado à regra "Banco decide, Redis acelera".
- **Sem comandos perigosos** — o `@upstash/ratelimit` usa *sliding window* via script atômico
  (sem `KEYS *`, sem `SCAN`, sem operações O(n)).
- **Sem vazamento de memória** — TTL/EXPIRE automáticos nas chaves de janela; o fallback
  in-memory é explicitamente **bounded** (cap 10k, evicção FIFO O(1), TTL por entrada).
- **`analytics:false`** — evita o par de escritas extras que o ratelimit faria por chamada.
- **Fail-open documentado** (ADR-008 F-08) — outage do Upstash não derruba o login (que ainda
  exige senha + MFA); cai para limiter local per-instância.
- **Cliente lazy singleton** — adequado ao modelo serverless (REST stateless, sem pool).

### Principais riscos

| # | Achado | Severidade | Essência | Status (2026-07-14) |
|---|--------|-----------|----------|----|
| **R1** | Degradação silenciosa do rate-limit (outage **ou cota esgotada**) sem alerta | **MÉDIA** | Fail-open cai para fallback per-instância (~N× o limite); só há métrica, sem alarme. Esgotar a cota Upstash é um vetor barato de enfraquecer o brute-force global | ✅ Resolvido |
| **R2** | Sem convenção de key-namespace / namespacing por tenant | **MÉDIA** | Hoje inofensivo (Redis não guarda dado de tenant). Vira risco multi-tenant no dia em que entrar cache/lock por clínica sem padrão `t:{clinicId}:…`. Dívida de arquitetura a fixar **antes** de crescer | ✅ Resolvido |
| **R3** | Sem prefixo discriminador de ambiente nas chaves | **BAIXA/MÉDIA** | Se dev e prod apontarem para a mesma Upstash DB, contadores colidem entre ambientes | ✅ Resolvido |
| **R4** | `getClientIp` confia em XFF; IPv6 inteiro como chave é fraco | **BAIXA** | Fora do Vercel o IP-limiter é spoofável; um /64 dá 2^64 IPs → limitar por IP cheio é inócuo em IPv6 | ✅ Resolvido |
| **R5** | Cobertura estreita: só 3 fluxos de auth usam o limiter | **BAIXA** | invite/resend, MFA-verify, export PDF, webhooks e IA não têm rate-limit (cross-ref auditoria de APIs) | 🚫 Deferido (auditoria de APIs) |
| **R6** | Token REST do Upstash é full read/write | **BAIXA** | Já inventariado p/ rotação; residual: leak → `FLUSHDB`/poison neutraliza o limiter (agravado pelo fail-open) | ⚠️ Parcial (rotação + hardening doc) |
| **R7** | Fallback fixed-window vs. primário sliding-window | **INFORMATIVO** | Pequena divergência de semântica (burst 2× na borda) durante outage | ✅ Resolvido (doc) |

Nenhum achado indica exploração ativa nem falha em produção hoje. R1 e R2 são os de maior
valor: R1 porque a degradação é **invisível** sem alerta, e R2 porque é a única barreira que
**precisa existir antes** de qualquer expansão do Redis para dados por tenant.

---

## 2. Mapa de utilização

Único módulo que fala com Redis: [`src/lib/auth/rate-limit.ts`](../../src/lib/auth/rate-limit.ts).
Cliente + limiters são instanciados **lazy** (singleton por instância). Credenciais em
[`env.ts`](../../src/lib/env.ts) (`UPSTASH_REDIS_REST_URL` linha 53 / `UPSTASH_REDIS_REST_TOKEN`
linha 54): opcionais no parse Zod, exigidas no 1º uso (mantém `next build` verde antes dos
segredos existirem).

### 2.1 Limiters (o que é armazenado)

| Fluxo | Prefixo/chave | Algoritmo | Limite | Caller |
|---|---|---|---|---|
| Login | `rl:login:ip:<ip>` | sliding window | 10 / 15 min | [`login/actions.ts:39`](../../src/app/(app)/login/actions.ts) |
| Login | `rl:login:email:<email_hash>` | sliding window | 5 / 15 min | idem |
| Reset senha | `rl:reset:ip:<ip>` | sliding window | 10 / 1 h | [`forgot-password/actions.ts:27`](../../src/app/(app)/forgot-password/actions.ts) |
| Reset senha | `rl:reset:email:<email_hash>` | sliding window | 3 / 1 h | idem |
| Join (onboarding) | `rl:join:ip:<ip>` | sliding window | 30 / 15 min | [`join/[token]/actions.ts:115`](../../src/app/(app)/join/[token]/actions.ts) |

`<email_hash>` = HMAC-SHA256 do email com `LOGIN_HASH_PEPPER` (pepper **global**, não
per-tenant). Login usa **dois** limites em paralelo (`Promise.all`), bloqueando se qualquer um
estourar. Cada request de login toca o Redis ~2× (2 scripts *sliding window*).

### 2.2 Classificação por categoria (o que se usa e o que não se usa)

| Categoria | Uso no sistema | Local | Risco Redis |
|---|---|---|---|
| **Rate limiting** | **Único uso real** — Upstash sliding window | `rate-limit.ts` | Baixo (bem feito); ver R1–R7 |
| **Cache** | Não usa Redis. Permissões vêm de claims do JWT (stale ≤60s) | `tenant-context.ts` | N/A — sem cache Redis para invalidar/expirar |
| **Sessão** | Não usa Redis. Supabase Auth (JWT + cookies); logout global revoga refresh | `supabase-server.ts` | N/A |
| **Filas** | Não usa Redis. Outbox transacional no Postgres | ADR-003 | N/A |
| **Locks** | Não usa Redis. `idempotentMutation` + advisory lock no Postgres | ADR-011 | N/A |
| **Pub/Sub** | Não usa Redis. Eventos via outbox → handlers | ADR-003/015 | N/A |

### 2.3 Fallback (comportamento em falha)

Se o Upstash lança (rede, 5xx, **cota/429**), o código **não propaga** — emite a métrica
`auth.ratelimit.degraded` e cai para `BoundedFallbackLimiter` (fixed-window in-memory,
per-instância, cap 10k, evicção FIFO O(1), TTL por entrada). Tradeoff aceito e documentado em
ADR-008 F-08: com N instâncias, o limite efetivo vira ~N× o configurado.

---

## 3. Achados

> Ordenados por severidade. Referências de linha conforme o branch auditado. Formato pedido no
> escopo: Categoria · Severidade · Arquivo/local · Descrição · Impacto · Cenário de falha ·
> Risco futuro · Correção · Prioridade.

---

### R1 — Degradação silenciosa do rate-limit (outage **ou cota esgotada**) sem alerta

- **Categoria:** Escalabilidade / Segurança
- **Severidade:** MÉDIA
- **Arquivo/local:** [`rate-limit.ts:105-121`](../../src/lib/auth/rate-limit.ts) (`degraded()`),
  `:182-184`, `:203-205`, `:231-237` (catch → fallback). Métrica em `:113`.
- **Descrição:** o fail-open (F-08) é correto para disponibilidade, mas trata **igualmente**
  dois casos: (a) o Upstash inacessível por incidente, e (b) o Upstash respondendo **429/cota
  esgotada**. Em ambos, o sistema silenciosamente troca o limiter global (Upstash) pelo local
  per-instância (~N× mais fraco). A única evidência é a métrica `auth.ratelimit.degraded` —
  não há alerta associado. Como cada login gasta ~4 comandos (2 limiters × sliding window) e o
  reset idem, o **orçamento de comandos** do Upstash é consumível: no free tier (~10k
  comandos/dia) ~2.500 logins/dia já o esgotam.
- **Impacto:** a proteção de brute-force distribuído (o limite por `email_hash`, que é o
  backstop contra "1 tentativa por IP, alvo único") degrada para per-instância, **sem ninguém
  perceber**. A defesa mais valiosa do módulo cai justamente sob carga/ataque.
- **Cenário de falha:** um atacante gera tráfego de login legítimo-porém-inútil suficiente para
  **estourar a cota diária** do Upstash de manhã; pelo resto do dia o rate-limit roda em modo
  degradado per-instância, e ele conduz o credential-stuffing real com o limite efetivo ~N×
  mais alto. Ninguém é alertado porque só houve um incremento de métrica.
- **Risco futuro:** com o crescimento (milhares de clínicas), o consumo normal de comandos pode
  cruzar o tier sem aviso, tornando a degradação **crônica** em vez de excepcional.
- **Correção recomendada:** (a) **alertar** (Sentry/observability) em degradação **sustentada**
  (ex.: `auth.ratelimit.degraded` acima de um limiar em janela de N min), não só emitir a
  métrica; (b) monitorar a cota/uso do Upstash e **dimensionar o tier ao pico** (não deixar no
  free); (c) opcional: distinguir 429/cota de erro de rede no `reason` para diagnóstico. O
  `analytics:false` já ajuda no orçamento — manter.
- **Prioridade:** Média (fix operacional pequeno; fecha um ponto cego real).
- **Doc relacionada:** ADR-008 F-08 (fail-open aceito), `docs/runbooks/alert-tuning.md`,
  `docs/c16/slo.md`.

#### 🛠 Remediação (2026-07-14)

- **Status:** ✅ Resolvido.
- **Implementação realizada:**
  - `src/lib/auth/rate-limit.ts`: nova função `classifyRedisError(err)` → `reason_category`
    **estruturado** (`network` | `server` | `other`). Ponto ÚNICO de emissão `degraded()`
    passou a emitir **métrica (SLI agregável) + `logger.warn`** (linha de nível apropriado para a
    saved-search de alerta do Better Stack, no MESMO pipeline stdout do ADR-029 — sem 2ª fonte da
    verdade), ambos com `kind` + `reason_category` + `reason`. O bloco de degradação do
    `assertJoinAllowed` — antes duplicado inline — foi **unificado** no mesmo `degraded()`.
  - `docs/runbooks/alert-tuning.md`: regra de alerta concreta para `auth.ratelimit.degraded` com
    **duas** condições — **sustentada** (> N em 10 min) e **intermitente/recorrente** (≥ X janelas
    distintas em 24 h, para pegar o padrão dente-de-serra que um threshold de janela única não
    dispara) — e triagem por `reason_category` (`server` → confirmar cota/dimensionar tier no
    painel Upstash; `network` → incidente do provedor).
  - `docs/c16/slo.md`: registrada a degradação como **SLI de segurança de auth** (alvo ≈ 0).
- **Estratégia (e correção de rumo vs. a auditoria):** a auditoria sugeria "distinguir 429/cota de
  erro de rede". Ao inspecionar o `@upstash/redis` v1.38, o cliente REST **descarta o status HTTP**
  no erro (429/cota chegam como `UpstashError` sem status; ver `chunk-*.mjs:195-203`). Isolar cota
  por código só seria possível **parseando a mensagem** — frágil e rejeitado. Solução honesta e
  estável: classificar por **tipo/`name` da exceção** (`server` = endpoint respondeu erro, inclui
  cota; `network` = transporte). A separação de cota fica no **painel de cota do Upstash**, que a
  própria recomendação de ops do R1 já pede monitorar. Sem `captureException` (fail-open é
  by-design; ADR-029 mantém logs fora do Sentry).
- **Validação:** testes unitários de `classifyRedisError` (server/network/other) e da emissão
  (`degraded` chama `metrics.emit` + `logger.warn` com `reason_category`, respeitando o fail-open)
  — verdes. `pnpm typecheck` verde. Fail-open (F-08) preservado byte-a-byte no caminho feliz.
- **Impacto:** **segurança** — a degradação da defesa de brute-force deixa de ser invisível.
  **Performance** — nula (mesmo nº de comandos Upstash; `logger.warn` só dispara na degradação).
  **Manutenção** — um único ponto de emissão. **Escalabilidade** — o alerta de degradação crônica
  antecipa o esgotamento de cota antes de virar gargalo.
- **Observações:** a parte de **dimensionar o tier / sair do free** é ação de ops (painel Upstash),
  documentada no runbook — não há o que codar. A classificação `server`/`network` (em vez de
  `quota`) é uma **melhoria de precisão honesta** sobre a sugestão original, não uma regressão.

---

### R2 — Sem convenção de key-namespace nem namespacing por tenant (dívida antes da escala)

- **Categoria:** Arquitetura / Escalabilidade
- **Severidade:** MÉDIA
- **Arquivo/local:** prefixos hard-coded em [`rate-limit.ts:147-148,160-161,215`](../../src/lib/auth/rate-limit.ts)
  (`rl:login:ip`, `rl:login:email`, `rl:reset:ip`, `rl:reset:email`, `rl:join:ip`).
- **Descrição:** as chaves atuais são **globais e pré-autenticação** por natureza (IP,
  `email_hash`), então **não há dado de tenant no Redis** e **não existe** — nem precisa
  existir hoje — namespacing por clínica. O problema é a **ausência de uma convenção
  documentada**: não há um padrão `t:{clinicId}:…` estabelecido, nem uma regra de "toda chave
  com dado de tenant carrega o `clinic_id`". Hoje isso é inofensivo; é uma **dívida latente**.
- **Impacto:** nenhum hoje. A gravidade é de **retrabalho/risco futuro**: no primeiro uso de
  Redis para dado por clínica (cache de agenda, cache de dashboard, lock de recurso), a falta de
  convenção reabre **exatamente** os riscos que a auditoria multi-tenant teme — colisão de
  chave entre clínicas, cache compartilhado indevidamente, um tenant atingindo a chave de outro.
- **Cenário de falha (futuro):** um dev adiciona `cache:agenda:{date}` para acelerar a agenda,
  esquecendo o `clinicId` na chave. Clínica A e clínica B com a mesma data passam a **compartilhar
  a mesma entrada de cache** → vazamento cross-tenant de dados clínicos. Sem convenção nem
  lint, nada barra isso.
- **Risco futuro:** alto se Redis crescer sem a convenção; hoje é o item de maior valor
  **preventivo**.
- **Correção recomendada:** registrar num ADR (ou em `CONVENTIONS.md`) a **convenção de chaves
  Redis** antes de qualquer novo uso: (1) toda chave com dado de tenant começa por
  `t:{clinicId}:`; (2) chaves globais/pré-auth ficam sob um prefixo próprio (`rl:` já serve);
  (3) idealmente, um helper único de montagem de chave (como `defaultTenantPolicy()` é o ponto
  único de RLS) para o `clinicId` nunca ser esquecido. Fixar o padrão **antes** de precisar
  dele.
- **Prioridade:** Média (barato agora; caro e perigoso depois).
- **Doc relacionada:** ADR-002/007 (isolamento por tenant no Postgres — o mesmo princípio deve
  valer no Redis), `docs/CONVENTIONS.md`.

#### 🛠 Remediação (2026-07-14)

- **Status:** ✅ Resolvido.
- **Implementação realizada:**
  - `src/lib/auth/rate-limit.ts`: helper `redisKey` — ponto ÚNICO de montagem de chave, espelhando
    o papel de `withTenant`/`defaultTenantPolicy()` no RLS: `redisKey.global(...segments)` para
    chaves globais/pré-auth e `redisKey.tenant(clinicId, ...segments)` que põe `t:{clinicId}`
    **primeiro** e obrigatório (o `clinicId` nunca é esquecido). Os 5 prefixos hard-coded
    (`rl:login:ip`, etc.) foram refatorados para `redisKey.global('rl','login','ip')` etc.
  - `docs/CONVENTIONS.md`: novo anti-padrão proibido — "🚫 chave Redis com dado de tenant sem
    `redisKey.tenant(clinicId, …)`", como extensão do isolamento por tenant já decidido em
    ADR-002/007.
- **Estratégia (e desvio consciente vs. a sugestão da auditoria):** a auditoria sugeria "registrar
  num ADR" e "um helper único". Decisão do founder na revisão do plano: **não criar um ADR inteiro**
  (a convenção é extensão natural de ADR-002/007, não decisão estrutural nova — ADR é para trocar
  Redis/Outbox/auth) e **não criar `src/lib/redis/`** hoje (há **um** único uso de Redis; um módulo
  para 2 funções seria abstração prematura — exatamente o que a `auditoria-simplificacao` caçaria).
  O helper vive **inline** no único consumidor; a extração para `src/lib/redis/` acontece **quando
  surgir o 2º consumidor** (cache/lock/pub-sub), herdando esta convenção.
- **Validação:** teste unitário trava a convenção (discriminador de ambiente presente e primeiro em
  toda chave; `t:{clinicId}` primeiro; duas clínicas com a mesma sub-chave **não colidem**) — verde.
  Efeito colateral do refactor de prefixos: reseta as janelas de rate-limit em voo **uma vez** no
  deploy (≤ 1 h, inócuo — mesma classe da rotação do `LOGIN_HASH_PEPPER`).
- **Impacto:** **segurança/multi-tenant** — a barreira contra vazamento cross-tenant no 1º uso de
  Redis por clínica passa a existir **antes** de ser necessária (maior valor preventivo).
  **Manutenção** — ponto único; **complexidade** — mínima (helper inline, sem módulo/ADR novo).
- **Observações:** `redisKey.tenant()` ainda não tem caller de produção (o rate-limit é pré-auth);
  é o **selo de convenção** (coberto por teste, não código morto) e a única função "forward-looking",
  justificada como a barreira que R2 pede.

---

### R3 — Sem prefixo discriminador de ambiente nas chaves (colisão dev↔prod se compartilharem DB)

- **Categoria:** Consistência / Configuração
- **Severidade:** BAIXA/MÉDIA (depende da config de infra, não verificável só pelo código)
- **Arquivo/local:** prefixos em [`rate-limit.ts:147-148,160-161,215`](../../src/lib/auth/rate-limit.ts);
  var única `UPSTASH_REDIS_REST_URL` em [`env.ts:53`](../../src/lib/env.ts).
- **Descrição:** as chaves não carregam o ambiente (ex.: `rl:{env}:login:ip`). O contrato de env
  tem **uma** URL Upstash. Se dev e prod (o projeto mantém 2 ambientes Supabase separados —
  ver memória de banco) apontarem para a **mesma Upstash DB** por engano de configuração, os
  contadores de rate-limit se misturam: uma rajada de testes em dev consome a janela de um IP
  real em prod, e vice-versa.
- **Impacto:** contadores poluídos entre ambientes → rate-limit de prod disparando por tráfego
  de dev (falsos bloqueios) ou o contrário (proteção diluída).
- **Cenário de falha:** durante desenvolvimento, um script de smoke test dispara 50 logins; se a
  `.env.local` de dev aponta para a Upstash de prod, um usuário real em prod com o mesmo IP de
  saída (ou o mesmo `email_hash`, se o pepper coincidir) é bloqueado.
- **Risco futuro:** baixo se as DBs já são separadas por ambiente (provável). O prefixo é defesa
  em profundidade contra o erro de config.
- **Correção recomendada:** (a) **confirmar** que dev e prod usam Upstash DBs distintas (o mais
  provável e suficiente); (b) como cinto-e-suspensório, adicionar um prefixo de ambiente às
  chaves (`rl:${NODE_ENV}:…`) para que compartilhar DB nunca cause colisão silenciosa.
- **Prioridade:** Baixa (confirmar config) / Média (se compartilharem DB hoje).
- **Doc relacionada:** `docs/development/environment.md` (dev vs prod), memória "Auditoria de
  banco" (2 projetos Supabase dev/prod).

#### 🛠 Remediação (2026-07-14)

- **Status:** ✅ Resolvido.
- **Implementação realizada:**
  - `src/lib/env.ts`: adicionada `VERCEL_ENV` (opcional; enum `production`/`preview`/`development`,
    auto-injetada pela Vercel).
  - `src/lib/auth/rate-limit.ts`: o `redisKey.*` (ver R2) embute em **toda** chave o discriminador
    `env.VERCEL_ENV ?? env.NODE_ENV`.
  - `docs/development/environment.md`: dev/preview/prod **devem** usar Upstash DBs distintas (defesa
    primária); o prefixo é cinto-e-suspensório.
- **Estratégia (melhoria sobre a sugestão):** a auditoria sugeria `rl:${NODE_ENV}:…`. Mas
  `NODE_ENV` é `production` **tanto em Preview quanto em Production** na Vercel — não separa os dois.
  Usar **`VERCEL_ENV ?? NODE_ENV`** separa também o Preview, é **auto-injetado** (zero config manual
  — melhor que um `APP_ENV` setado à mão, que seria mais uma variável a misconfigurar) e cai no
  `NODE_ENV` fora da Vercel (dev local, CI).
- **Validação:** teste da convenção verifica que o discriminador é não-vazio e é o **primeiro**
  segmento de toda chave. `pnpm typecheck` verde (var opcional → `next build` não quebra).
- **Impacto:** **consistência** — dev/preview/prod nunca colidem no Redis mesmo compartilhando DB
  por engano. **Config** — a defesa primária (DBs separadas) fica documentada.
- **Observações:** severidade condicional à infra (não verificável pelo repo) — o prefixo torna a
  colisão silenciosa **impossível** independentemente da config, então a dependência de "confirmar
  DBs separadas" deixa de ser um ponto cego.

---

### R4 — `getClientIp` confia em `x-forwarded-for[0]`; IPv6 inteiro como chave é fraco

- **Categoria:** Segurança / Key-design
- **Severidade:** BAIXA
- **Arquivo/local:** [`rate-limit.ts:244-253`](../../src/lib/auth/rate-limit.ts) (`getClientIp`).
- **Descrição:** o IP-limiter chaveia no primeiro IP do header `x-forwarded-for`. **No Vercel
  isso é seguro** (a plataforma sobrescreve o XFF com o IP real do client). Dois pontos: (a)
  fora do Vercel / atrás de outro proxy, o XFF é **spoofável**, e o atacante varia o IP falso
  para zerar o IP-limiter — no login o backstop de `email_hash` ainda segura, mas o **/join só
  tem IP-limiter** (`assertJoinAllowed`), ficando totalmente contornável; (b) a chave usa o
  **IPv6 inteiro** — um atacante com um bloco /64 (comum) controla 2^64 endereços, tornando o
  limite por-IP inócuo em IPv6.
- **Impacto:** em deploy não-Vercel, bypass do IP-limiter; em IPv6, o limite por-IP é
  facilmente evadido. Hoje, protegido pela plataforma; é risco condicional ao ambiente de deploy.
- **Cenário de falha:** o produto migra de infra (ou adiciona um proxy próprio) e o XFF passa a
  ser controlável; brute-force de token no `/join` deixa de ter qualquer freio de IP.
- **Risco futuro:** materializa-se numa mudança de infra — fácil de esquecer que a segurança do
  IP dependia do Vercel.
- **Correção recomendada:** (a) documentar explicitamente a **premissa "atrás do Vercel"** no
  módulo; (b) ao chavear IPv6, **normalizar para o prefixo /64** antes de usar como chave; (c)
  se algum dia sair do Vercel, derivar o client IP de um header confiável da própria borda, não
  do XFF cru.
- **Prioridade:** Baixa (hoje mitigado pela plataforma).
- **Doc relacionada:** ADR-030 (security headers/perímetro), comentário do próprio
  `getClientIp`.

#### 🛠 Remediação (2026-07-14)

- **Status:** ✅ Resolvido.
- **Implementação realizada:** `src/lib/auth/rate-limit.ts`:
  - Novo `ipRateLimitKey(ip)` — IPv4 inalterado; **IPv6 normalizado para o prefixo /64** (primeiros
    4 hextets), aplicado em `assertLoginAllowed`/`assertPasswordResetAllowed`/`assertJoinAllowed`.
    A normalização trata corretamente o IPv6 **comprimido (`::`)** via `expandIpv6` (split ingênuo
    por `:` quebraria).
  - Docblock de `getClientIp` documenta explicitamente a **premissa "atrás do Vercel"** (XFF
    confiável porque a plataforma o sobrescreve; sair do Vercel exige derivar o IP de um header
    confiável da borda, nunca do XFF cru).
- **Estratégia (decisão de design importante):** a normalização /64 vive **só na chave de
  rate-limit** — `getClientIp` continua devolvendo o **IP completo**, porque ele alimenta também o
  audit trail `login_attempts` (via `recordAttempt`), que precisa do IP inteiro para forense.
  Normalizar dentro de `getClientIp` teria degradado a precisão da auditoria.
- **Validação:** testes de `ipRateLimitKey` — IPv4 passthrough; IPv6 completo → /64; **IPv6
  comprimido `::`** (endereços do mesmo /64 colapsam na mesma chave; /64 distintos não colidem;
  `::1`, `fe80::` não quebram) — verdes.
- **Impacto:** **segurança** — o limite por-IP deixa de ser inócuo em IPv6 (um /64 antes dava 2^64
  chaves distintas). **Auditoria** — preservada (IP completo em `login_attempts`).
- **Observações:** a parte "spoofing de XFF fora do Vercel" é **condicional a mudança de infra** e
  fica **documentada** (premissa no docblock) — hoje mitigada pela plataforma; não há código a
  mudar enquanto o deploy for Vercel.

---

### R5 — Cobertura estreita: só 3 fluxos de auth usam o limiter

- **Categoria:** Abuso / Segurança
- **Severidade:** BAIXA
- **Arquivo/local:** callers em [`login/actions.ts`](../../src/app/(app)/login/actions.ts),
  [`forgot-password/actions.ts`](../../src/app/(app)/forgot-password/actions.ts),
  [`join/[token]/actions.ts`](../../src/app/(app)/join/[token]/actions.ts).
- **Descrição:** o limiter Upstash (barato e já pronto) cobre **apenas** login, reset e o
  checkout do /join. Não cobre invite/resend, MFA-verify, export de PDF, webhooks nem turnos de
  IA — operações caras ou sensíveis. Este é um achado **já registrado** na auditoria de APIs
  (M3, B6) e de IA (B7); aqui apenas se aponta que **a ferramenta Redis para resolvê-lo já
  existe** e é reutilizável.
- **Impacto:** superfícies de abuso sem freio (spam de convites/recovery-mails; PDFs pesados;
  brute-force do 2º fator dependente só do throttle do GoTrue).
- **Cenário de falha:** ver M3 de `auditoria-apis-seguranca.md` (conta de gestor comprometida em
  loop de `resendInvite`).
- **Risco futuro:** cresce com o nº de usuários autenticados.
- **Correção recomendada:** reusar `Ratelimit` (mesmo padrão fail-open) em invite/resend (por
  clínica e por ator), MFA-verify (por usuário/IP) e step-save do wizard. **Não duplicar** o
  detalhamento — seguir M3/B6.
- **Prioridade:** Baixa (rastreado nas auditorias irmãs).
- **Doc relacionada:** `docs/achados/auditoria-apis-seguranca.md` (M3, B6, B7).

#### 🛠 Remediação (2026-07-14)

- **Status:** 🚫 Deferido com justificativa (não ignorado).
- **Decisão (founder, na revisão do plano):** **não** estender rate-limit a invite/resend,
  MFA-verify e export nesta remediação. O item é **explicitamente rastreado e de responsabilidade
  da auditoria de APIs** (M3/B6/B7), que a própria auditoria Redis pede para **não duplicar**.
  Implementá-lo aqui seria escopo sobreposto e retrabalho.
- **O que esta remediação entrega para R5:** a **ferramenta pronta** — o helper `redisKey.*` (R2) +
  o padrão fail-open reutilizável do `Ratelimit` — tornando trivial adicionar limiters aos novos
  fluxos quando M3/B6 forem remediados.
- **Impacto:** nenhuma superfície nova de abuso criada aqui; as existentes continuam rastreadas na
  auditoria irmã. **Manutenção** — evita duplicar a lógica de rate-limit em duas auditorias.

---

### R6 — Token REST do Upstash é bearer full read/write (leak neutraliza o limiter)

- **Categoria:** Segurança / Operação
- **Severidade:** BAIXA
- **Arquivo/local:** [`env.ts:54`](../../src/lib/env.ts) (`UPSTASH_REDIS_REST_TOKEN`); uso em
  [`rate-limit.ts:133-137`](../../src/lib/auth/rate-limit.ts). **Já inventariado** para rotação
  em [`secret-rotation.md:34`](../../docs/runbooks/secret-rotation.md).
- **Descrição:** ponto positivo primeiro — o token **já está** no inventário de rotação, com a
  observação de que o fail-open cobre a janela de troca. O residual: o token REST padrão do
  Upstash concede **read/write completo** à DB. Um vazamento permite não só ler as chaves (baixo
  valor: `email_hash` é HMAC, IPs são efêmeros) mas **escrever/`FLUSHDB`** — zerar os contadores
  (desliga o rate-limit globalmente) ou saturar `rl:login:email:<hash>` de uma vítima. Agravado
  pelo fail-open: com o limiter neutralizado, a proteção vira no-op sem erro visível.
- **Impacto:** capacidade de desativar/poluir o rate-limit se o token vazar. Mesma classe de
  segredo dos demais (Vercel env), então a exposição é limitada, mas o **efeito** de um leak é
  específico (neutralizar a defesa de brute-force).
- **Cenário de falha:** token aparece num log/screenshot; atacante faz `FLUSHDB` periódico →
  rate-limit efetivamente ausente enquanto ele conduz credential-stuffing.
- **Risco futuro:** baixo e estável.
- **Correção recomendada:** (a) manter a rotação já documentada; (b) avaliar, no tier do
  Upstash, **allowlist de IP** (só as saídas do Vercel) e/ou token com escopo restrito, se
  disponível; (c) considerar alerta em `FLUSHDB`/queda abrupta de chaves, se o Upstash expõe
  esse sinal.
- **Prioridade:** Baixa.
- **Doc relacionada:** `docs/runbooks/secret-rotation.md` (linha 34 — já cobre a rotação).

#### 🛠 Remediação (2026-07-14)

- **Status:** ⚠️ Parcialmente resolvido (rotação: coberta; hardening: documentado como ops).
- **Implementação realizada:** `docs/runbooks/secret-rotation.md` — nova subseção "Hardening do
  token Upstash (auditoria Redis R6)": allowlist de IP (saídas do Vercel), token com escopo
  restrito para tooling read-only, alerta de `FLUSHDB`/queda abrupta de chaves, além da rotação já
  inventariada.
- **Estratégia:** **não há código a mudar** — o token full read/write é o padrão do Upstash, e as
  mitigações residuais são **config do painel do provedor** (allowlist/escopo/alerta) + a rotação
  já documentada. Documentar como ação de ops é a resposta correta e proporcional para um achado
  BAIXO cuja superfície é a mesma dos demais segredos (Vercel env).
- **Impacto:** **segurança/operação** — o operador tem agora um checklist de hardening no runbook.
  Sem impacto em performance/manutenção de código.
- **Observações:** a aplicação efetiva (allowlist/escopo/alerta) depende do tier do Upstash e é
  executada no painel — fora do alcance do repositório; por isso ⚠️ parcial (documentado, não
  aplicado no código).

---

### R7 — Fallback é fixed-window; primário é sliding-window (divergência de semântica na degradação)

- **Categoria:** Consistência
- **Severidade:** INFORMATIVO
- **Arquivo/local:** [`rate-limit.ts:41-91`](../../src/lib/auth/rate-limit.ts)
  (`BoundedFallbackLimiter`, fixed-window) vs. `Ratelimit.slidingWindow` nas linhas 147-215.
- **Descrição:** durante outage do Upstash, o fallback usa **fixed-window**, que permite até ~2×
  o limite na virada de janela (burst), enquanto o primário é **sliding-window** (suave). É uma
  diferença de comportamento pequena e só ativa em degradação.
- **Impacto:** durante um outage já degradado, o limite pode ser momentaneamente mais frouxo do
  que o número sugere. Irrelevante na prática.
- **Cenário de falha:** n/a realista.
- **Risco futuro:** nenhum.
- **Correção recomendada:** nenhuma exigida — apenas ciência ao ler as métricas de degradação.
  Documentar a diferença no docblock, se quiser precisão.
- **Prioridade:** Informativo.
- **Doc relacionada:** ADR-008 F-08.

#### 🛠 Remediação (2026-07-14)

- **Status:** ✅ Resolvido (doc-only).
- **Implementação realizada:** `src/lib/auth/rate-limit.ts` — nota no docblock do módulo
  explicando a divergência (fallback fixed-window permite ~2× o limite na virada de janela vs.
  sliding-window suave do primário), ativa **só em degradação**.
- **Validação:** sem mudança de comportamento; nada a testar além do já existente.
- **Impacto:** nulo em runtime; ganho de clareza para quem lê as métricas de degradação.
- **Observações:** achado informativo — nenhuma correção de código exigida, apenas ciência.

---

## 4. Não-achados verificados (acertos — para o próximo revisor não reabrir)

Itens explicitamente checados e considerados **corretos**:

- **Redis não é fonte da verdade.** Os contadores são efêmeros e tratados como best-effort
  (fail-open). O registro durável/auditável é `login_attempts` no Postgres. Alinhado 100% à
  regra "Banco é autoridade, Redis acelera".
- **Sem comandos perigosos.** Nada de `KEYS *`, `SCAN`, `FLUSHALL` no código; o
  `@upstash/ratelimit` executa *sliding window* por script atômico (eval), 1 round-trip por
  `.limit()`. Estrutura adequada (sorted set gerenciado pela lib) — sem escolha errada de tipo.
- **Sem vazamento de memória no Redis.** As chaves de janela recebem EXPIRE automático; não há
  chave permanente nem crescimento infinito. Nada a "limpar" manualmente.
- **Fallback in-memory é bounded.** Cap 10k, evicção FIFO O(1) via ordem de inserção do `Map`
  (não array+shift), TTL por entrada e sweep — sem crescimento ilimitado do processo.
- **`analytics:false`** — evita as escritas extras de analytics do ratelimit (economiza cota e
  memória no Upstash).
- **Cliente lazy singleton por instância** — correto para serverless/REST (sem pool de conexão
  a gerir; a latência HTTP é aceitável no caminho pré-auth).
- **Isolamento multi-tenant não é violável hoje** — porque **não há dado de tenant no Redis**.
  O `email_hash` global (pepper único) é o comportamento **desejado**: limitar tentativas de
  login de um e-mail é global por natureza (pré-auth, sem clínica conhecida). Não há colisão nem
  cache cross-tenant possível no desenho atual.
- **Concorrência/idempotência/filas fora do Redis** — a escolha de Postgres (`FOR UPDATE SKIP
  LOCKED`, advisory locks, outbox) é a correta para durabilidade de dado clínico; evita a
  segunda-fonte-da-verdade que locks/filas em Redis introduziriam.

---

## 5. Recomendações de arquitetura

### Agora (baixo custo, fecha pontos cegos)
- **R1** — criar **alerta** de degradação sustentada do rate-limit (não só a métrica) e
  monitorar/**dimensionar a cota** do Upstash ao pico. Sair do free tier antes de a cota virar
  gargalo.
- **R3** — **confirmar** que dev e prod usam Upstash DBs distintas; se houver qualquer dúvida,
  adicionar prefixo de ambiente às chaves.
- **R6** — manter o token no ciclo de rotação (já está) e avaliar allowlist de IP no Upstash.

### Curto prazo
- **R4** — documentar a premissa "atrás do Vercel" e **normalizar IPv6 para /64** ao chavear.
- **R5** — estender o `Ratelimit` (já pronto) aos fluxos caros (invite/resend, MFA-verify,
  export, step-save) — casar com M3/B6 da auditoria de APIs, sem duplicar.

### Escala futura (evita retrabalho e bugs difíceis)
- **R2 (o item de maior valor preventivo)** — **fixar a convenção de chaves Redis num ADR
  antes** de qualquer uso novo: `t:{clinicId}:…` obrigatório para dado de tenant, prefixo
  próprio para chaves globais, e um **helper único** de montagem de chave (espelhando o papel de
  `defaultTenantPolicy()` no RLS) para o `clinicId` nunca ser esquecido.
- **Cliente para cache hot-path** — o cliente **REST** do Upstash adiciona um round-trip HTTP
  por comando: ótimo para rate-limit (baixa frequência, pré-auth), **ruim** para cache de leitura
  quente (agenda, dashboard) onde se quer sub-ms. Antes de adotar cache, **reavaliar** o cliente
  (Redis co-localizado com conexão persistente, ou Upstash com deploy region-pinned) e definir
  **estratégia de invalidação/TTL** por dado — nunca cachear dado dinâmico (agenda, financeiro,
  permissões) sem invalidação explícita.
- **Migração planejada de estado per-instância para Redis** — o circuit breaker de IA e o
  contador de quota (`circuit-breaker.ts`, hoje in-memory, com nota "Redis quando escalar" —
  ADR-022) devem, ao migrar, **herdar a convenção de chaves de R2** e usar o mesmo padrão
  fail-open já provado no rate-limit.

---

### Metodologia & limites desta auditoria

- Auditoria **manual expert** por leitura de código + correlação com ADRs/docs; **sem** execução
  de ferramenta dinâmica nem acesso ao painel do Upstash (config de tier/DB/allowlist não é
  verificável a partir do repositório — daí R1/R3/R6 pedirem *confirmação* de infra).
- Cobertura: 100% da superfície Redis do código (um módulo) e das não-utilizações relevantes
  (filas, locks, sessão, cache). Achados com referência de linha refletem o branch
  `docs/identity-practitioner-model` na data acima.
- **Nenhum código ou configuração foi alterado.** Este documento é somente leitura.
  *(Atualizado em 2026-07-14 com as seções de remediação — ver rodapé.)*

---

## Rodapé de remediação

| Campo | Valor |
|---|---|
| **Data da remediação** | 2026-07-14 |
| **Branch** | `docs/identity-practitioner-model` |
| **Responsável** | João Marcos (Qoro) |
| **Commit** | _(preencher no commit desta remediação)_ |

### Resumo do que mudou

**Código:**
- `src/lib/auth/rate-limit.ts` — `classifyRedisError` (estruturado) + `logger.warn` + `degraded()`
  unificado (R1); helper `redisKey.global/tenant` **inline** + prefixos refatorados (R2);
  discriminador `VERCEL_ENV ?? NODE_ENV` (R3); `ipRateLimitKey` /64 com IPv6 comprimido (R4);
  docblock (R7 + premissa "atrás do Vercel"). Export `__testing__` para os testes.
- `src/lib/auth/rate-limit.test.ts` — testes de convenção de chaves, `ipRateLimitKey` (incl. `::`),
  `classifyRedisError` e emissão de degradação. **18 testes verdes.**
- `src/lib/env.ts` — `VERCEL_ENV` opcional (R3).

**Docs:** `docs/CONVENTIONS.md` (anti-padrão de chave Redis por tenant, R2); `docs/runbooks/
alert-tuning.md` (alerta sustentado + intermitente, R1); `docs/c16/slo.md` (SLI de degradação de
auth, R1); `docs/development/environment.md` (Upstash DBs distintas + `VERCEL_ENV`, R3);
`docs/runbooks/secret-rotation.md` (hardening do token Upstash, R6).

**Não houve:** migration, módulo novo (`src/lib/redis/` deferido ao 2º consumidor), ADR novo
(convenção documentada em CONVENTIONS como extensão de ADR-002/007), nem alteração de ADR
existente. Fail-open (F-08), pipeline de observabilidade (ADR-029) e isolamento multi-tenant
preservados.

### Verificação (2026-07-14)

`pnpm typecheck` ✅ · `pnpm test` (suíte completa, incl. 18 de rate-limit) ✅ · `pnpm lint` ✅ ·
`pnpm arch:check` ✅ · `pnpm build` ✅. *(Preencher com o resultado final ao commitar.)*
