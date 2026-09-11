# SECURITY-DELTA — auditoria adversarial × código real

**Data:** 2026-09-11. **Base:** os 50 achados (SEC-001..050) da auditoria
adversarial externa, confrontados com o repositório.

A auditoria declara, honestamente, que foi feita **sem acesso ao repositório** e
marca quase tudo como "PROVÁVEL". A Fase 0 do próprio prompt dela manda confirmar
ou refutar contra o código antes de editar uma linha — é o que este documento faz.

Três rótulos, sem meio-termo:

- **REFUTADO** — o código já resolve, com arquivo e linha. Não vira trabalho.
- **CONFIRMADO** — o defeito existe. Vira correção com teste.
- **PARCIAL** — a premissa está certa, o alcance não. Diz-se o que é real.

Um aviso que vale para o documento inteiro: refutar um achado **não** é dizer que
o sistema é seguro. É dizer que aquele mecanismo específico não é o furo.

---

## Fase 0 — inventário exigido antes de qualquer edição

### Origem de conexão com o banco

```text
grep -rn "postgres(|new Pool|drizzle(|createClient|SERVICE_ROLE" src/
```

Três pools, um arquivo:

| Pool | Papel | Quem pode importar |
| --- | --- | --- |
| `db` | runtime, **RLS via role-switch** | **somente** `src/lib/db/tenant.ts` |
| `dbAdmin` | BYPASSRLS (painel de plataforma) | allowlist por arquivo em `arch-db-check` |
| `dbWorker` | BYPASSRLS (worker do outbox) | allowlist por arquivo |

`pnpm arch:db-check` é **default-deny** e AST-based: cobre import, `import()`
dinâmico, `require()`, re-export (`export { db } from`, `export *`) com cadeias
rastreadas transitivamente. Resultado medido: **1187 arquivos varridos, 0
achados**. Usos diretos de `db.` fora de `tenant.ts`: **zero**. Call sites de
`withTenant`: **162**.

### Superfícies

`docs/security/acoes.md` (gerado por AST): **174 Server Actions**, **33 métodos
HTTP** em 32 handlers, **14 props** com referência de action, **174** leituras de
`process.env`, **5** nomes `NEXT_PUBLIC_`. Guards não resolvidos: **0**.

---

## Top 10 da auditoria — veredito item a item

### #1 SEC-002 — `service_role` ignora o isolamento — **PARCIAL, e endurecido**

A premissa está **certa e o próprio código já a documentava**: o pool `db`
conecta com papel BYPASSRLS, então quem isola é o `SET LOCAL ROLE authenticated`
dentro de `withTenant`, não a RLS.

O que a auditoria **errou** foi o alcance. Ela supõe "toda SaaS serverless
acumula caminhos com `service_role`: webhooks, jobs, PDFs, importação". Aqui não
dá: `db` só é importável por `tenant.ts`, com gate AST default-deny. Não existe o
call site esquecido que o cenário exige.

O que sobrava de real era mais sutil: se o `SET LOCAL ROLE` **silenciosamente não
surtisse efeito**, todas as queries rodariam ignorando RLS, devolvendo dados de
todos os tenants, sem erro e sem log. Era a única forma de perder isolamento sem
deixar sinal.

**Corrigido** em `src/lib/db/tenant.ts`: `withTenant` passou a **verificar** o
papel efetivo antes de executar qualquer callback. A leitura de `current_user`
viaja na mesma ida ao banco do `set_config` que já existia — custo zero de
round-trip nos 162 call sites. Divergiu, lança `TenantRoleError` e a transação
aborta. Fail-closed.

E a premissa deixou de ser crença. `scripts/security/tenant-isolation.ts` ganhou
um **contrafactual** que roda no Postgres real:

```text
PASS CONTRAFACTUAL: sem role-switch o papel do pool (security_local, BYPASSRLS)
     LÊ a linha da outra clínica — quem isola é o SET LOCAL ROLE, não a RLS sozinha
```

A mesma policy, o mesmo dado, dois papéis, resultados opostos. É a medição que
sustenta o desenho inteiro.

Testes: `src/lib/db/tenant.test.ts` **5/5** (inclui "papel BYPASSRLS aborta antes
do callback" e "papel ausente é falha, não permissão"); `pnpm security:tenant`
PASS nos dois sentidos + contrafactual.

**Residual registrado:** `DATABASE_URL_RUNTIME` (papel sem BYPASSRLS) continua
opt-in e **não provisionado** no Postgres. Com ele, um escapelo hipotético falha
fechado no banco também. Provisionar é operação, não código.

### #2 SEC-001 — telefone resolve paciente globalmente — **REFUTADO**

`src/contexts/ai-agent/internal/conversation.ts:64-67`:

```ts
.where(and(eq(patients.clinicId, clinicId), eq(patients.telefoneHash, phoneHash)))
```

O lookup é **composto por clínica**, o telefone é armazenado como **hash** (não
em claro), e a consulta roda dentro de `withTenant` — RLS por cima. O cenário
"envio mensagem para a clínica A e o sistema carrega o paciente da clínica B" não
se sustenta contra este código.

### #3 SEC-041 — preview deploy com credencial de produção — **CONFIRMADO (parcial) e corrigido no que é detectável**

Não havia asserção de coerência de ambiente. **Corrigido** em
`src/lib/env-coherence.ts`, ligado ao parse de env (`src/lib/env.ts`), que é a
camada de autoridade — build e boot param:

1. O project ref de `NEXT_PUBLIC_SUPABASE_URL` precisa bater com o ref embutido
   no usuário do `DATABASE_URL`/`DATABASE_URL_RUNTIME` do pooler. Divergir
   significa **autenticar contra um projeto e ler o banco de outro** — o
   `clinic_id` do JWT não corresponde ao banco consultado, e o isolamento por
   tenant passa a repousar sobre um identificador de outro universo.
2. `VERCEL_ENV=preview` com `SUPABASE_PROJECT_ENV=prod` reprova.

**O que a checagem NÃO faz, dito sem eufemismo:** de dentro do deployment não há
como saber se a `DATABASE_URL` deste preview é a mesma de produção quando ambas
são refs de projetos gerenciados distintos. Isso é Deployment Protection e
segregação de env no painel da Vercel — console, não código. Fica no registro.

Testes: `src/lib/env-coherence.test.ts` **9/9**, incluindo "não reprova o que não
consegue determinar" (Postgres local e o build isolado caem aí — silêncio por
inaplicabilidade, não por aprovação).

### #4 SEC-026/027 — webhook com assinatura frágil e tenant vindo do corpo — **REFUTADO**

`src/lib/messaging/number-store.ts:51-58`:

```sql
SELECT clinic_id FROM clinic_whatsapp_numbers
WHERE meta_phone_id = $1 AND active = true
```

O tenant é resolvido pela **integração que recebeu o evento**, com lookup no
servidor — exatamente a correção que a auditoria prescreve. `phone_id` sem
integração ativa → descartado (`meta/route.ts:148-149`). Meta usa HMAC; Asaas usa
token constante com **consulta autoritativa do pagamento**, não confiança no
corpo. Cobertura: **154 testes** de webhook, incluindo assinatura válida,
inválida, replay e corpo gigante.

Correção real feita numa rodada anterior: os dois webhooks Asaas **liam o corpo
inteiro antes de aplicar o teto**. `src/lib/http/webhook-body.ts` passou a cortar
durante a leitura.

### #5 SEC-029/030 — IA com ferramentas e autorização no prompt — **REFUTADO no mecanismo**

O `clinicId` é resolvido no servidor e injetado no contexto da ferramenta; o
catálogo testado **não expõe** tool de prontuário, criação de cobrança nem
mensagem em massa. `src/contexts/ai-agent/guards/prompt-injection-security.test.ts`
roda **15 vetores determinísticos** contra registry, schemas e políticas reais.
Tetos duros: `MAX_TOOL_ROUNDS=3`, `MAX_MUTATIONS_PER_TURN=1` contado através das
rodadas.

**Pendente honesto:** isso mede a política, não o modelo. A bateria contra o
Gemini real (`pnpm ai:adversarial`) exige credencial e não foi executada.

### #6 SEC-003/006 — `clinicId` do payload e IDOR — **REFUTADO**

`src/contexts/patient/security-actions.test.ts` (17 testes) enumera as **16
exports reais** de paciente e prova duas coisas: negam sem sessão **antes de
tocar o banco**, e os schemas **descartam** `clinicId`, `role` e `amountCents`
injetados no payload. O escopo vem do gate, nunca da entrada. IDOR por id
estrangeiro é barrado por RLS — medido nos dois sentidos em Postgres real.

### #7 SEC-021/022/024 — estados de pagamento, preço e idempotência — **REFUTADO na estrutura**

Constraints reais encontradas nas migrations:

| Constraint | Onde |
| --- | --- |
| `patient_webhook_events_uniq (clinic_id, asaas_event_id)` | `0086_patient_webhook.sql` |
| `outbound_messages_clinic_idem_uniq (clinic_id, idempotency_key)` | `0022/0045` |
| `outbox_event_type_idempotency_key_uniq` | `0008_c4_outbox_core.sql` |
| `idempotency_keys_key_format_chk` (regex de formato) | `0008` |

Existe tabela `idempotency_keys` com CHECK de formato e teto de tamanho de
resposta. A dedup de webhook de paciente usa chave composta por clínica —
inclusive com a justificativa escrita de por que não usar só o id do evento
("nada garante que dois provedores nunca repitam um id").

**Pendente:** a prova dessas constraints em Postgres real com replay
transacional. Hoje os testes usam dependência substituída. Registrado.

### #8 SEC-009/004/013 — sessão sobrevive a mudança de papel — **REFUTADO**

ADR-037: `authenticate()` confere `claims_version` **contra o banco a cada
request**. Não existe a janela de "claim congelado no login" que o achado
descreve. `src/lib/auth/tenant-context.test.ts` (38 testes) cobre
`epoch_mismatch` e `claim_divergence` com revogação de sessão.

Correção real feita numa rodada anterior: `logout/route.ts` **ignorava o erro da
revogação** e respondia sucesso — um refresh token podia seguir vivo com o
usuário achando que saiu. Agora exige retorno positivo do epoch e devolve 503 em
vez de mentir.

### #9 SEC-010/036/038/043 — cadeia XSS → token → takeover — **REFUTADO no elo principal**

O elo que a cadeia exige é token de sessão legível por JS. **Não existe**:

```text
grep -rn "localStorage|sessionStorage" src/ → tema e dispensa de aviso, nada de sessão
```

A sessão vive em cookie do `@supabase/ssr`, e desde 2026-09-10 os atributos são
**fixados pelo repositório** (`hardenCookie`: `httpOnly` e `SameSite=Lax` mesmo
que a biblioteca peça o contrário). Com o token fora do alcance de script, XSS
deixa de render takeover.

O bundle é varrido por `pnpm security:bundle` (166 arquivos, canários de
`sb_secret_`, chave privada e script do Vercel Live): **0 achados**.

**Pendente:** supply chain de CI (`pull_request_target`, pin de actions por SHA,
`--ignore-scripts`) não foi endurecido. É trabalho de workflow, registrado.

### #10 SEC-045/050 — auditoria apagável e negativas sem log — **SEC-045 PARCIAL, SEC-050 CONFIRMADO e corrigido**

**SEC-045 — parcialmente refutado.** A trilha já é append-only para o app:
`0009_c4_audit_partitioned.sql` cria **apenas** `FOR INSERT` e `FOR SELECT` em
`audit_events`. E o "erro clássico" que a auditoria prevê — FK com
`ON DELETE CASCADE` apagando o log junto do usuário — **não existe aqui**: não há
FK cascade na tabela. Residual real: `service_role` tem `UPDATE`/`DELETE`
(`0010_c4_hardening.sql:72`). Hash encadeado e cópia WORM continuam ausentes.

**SEC-050 — confirmado.** Nenhuma negativa de autorização era observável.
Sondagem de escopo produzia só uma sequência de 403 que ninguém contava —
detecção cega é o que transforma um ataque de horas num de meses.

**Corrigido** em `src/lib/auth/tenant-context.ts`: o construtor de `AuthError`
emite `authz.denied` com `{code, reason, httpStatus}`. O emissor fica no
construtor de propósito — é o ponto pelo qual toda negativa passa hoje e passará
amanhã, e não há decorator para alguém esquecer numa rota nova. Erro de
**configuração** (500) não emite: misturá-lo envenenaria o painel, porque um
deploy com env faltando geraria um pico de "negativas" escondendo a sondagem
real.

Testes: `src/lib/auth/authz-denied.test.ts` **6/6**, incluindo "o evento não
carrega mensagem livre nem identificador de pessoa" e o gate que trava o emissor
no construtor.

---

## Achados da auditoria que já estavam corrigidos antes dela

Trabalho das rodadas de 2026-09-10, que a auditoria não podia enxergar de fora:

| SEC | Estado |
| --- | --- |
| SEC-034 (LLM ilimitado = exaustão de custo) | **corrigido**: teto horário por clínica, aplicado antes do provider. O achado era pior que o relatado — `checkQuota` devolvia `Infinity` **e não tinha caller nenhum** |
| SEC-039 (CSP fraca) | **corrigido**: bloqueante, `connect-src`/`img-src` por origem nomeada, sem `unsafe-eval` (medido: 0 ocorrências em 161 chunks). Verificado em browser real |
| SEC-015 (CORS `*`) | **não se aplica ao app**: a medição da auditoria foi no site de marketing, que é outro deployment (SSG, não-Next). O app não emite `Access-Control-Allow-Origin` |
| SEC-046/047 (PII em log/Sentry) | **corrigido**: `sentry-scrub.ts` elimina o body; `sanitize/keys.ts` redige nome, convênio e aliases. Teste falhava antes, passa depois |
| LGPD — leitura de prontuário | **corrigido**: `clinical.prontuario.viewed` na mesma tx da leitura, fail-closed, com gate estático contra leitor novo sem trilha |

---

## Correções desta rodada

| SEC | Arquivo | Teste |
| --- | --- | --- |
| SEC-002 | `src/lib/db/tenant.ts` — role verificado antes do callback | `tenant.test.ts` 5/5 + contrafactual em Postgres real |
| SEC-041 | `src/lib/env-coherence.ts` + `env.ts` | `env-coherence.test.ts` 9/9 |
| SEC-050 | `src/lib/auth/tenant-context.ts` — `authz.denied` | `authz-denied.test.ts` 6/6 |

---

## O que continua aberto

Fonte aplicada por teste: [riscos.md](./riscos.md). Nada aqui está aceito — todo
item é `pendente`, com prazo de revisão.

| Tema | Por quê continua aberto |
| --- | --- |
| Replay de webhook em Postgres real | As constraints existem; falta exercitá-las com transação real em vez de dependência substituída |
| IDOR/CSRF por HTTP com dois usuários | Exige Supabase Auth **local**; a prova hoje é do caminho SQL |
| Gemini adversarial | Exige credencial real e chamada externa |
| Nonce na CSP | Exige ampliar o matcher do middleware sem quebrar o redirect de `/login` |
| Hash chain / WORM na auditoria | `service_role` ainda pode `UPDATE`/`DELETE` em `audit_events` |
| Supply chain de CI | `permissions` mínimo, pin por SHA, `--ignore-scripts` |
| `DATABASE_URL_RUNTIME` provisionado | Papel sem BYPASSRLS existe no código, falta criar no Postgres |
| Deployment Protection, Sentry, DNS/MFA | Console externo — ver [README.md](./README.md) §4 e §5 |

---

## Nota de método

A auditoria acertou a **classe** de risco dominante — resolução de tenant — e
errou o **alcance** em quase todos os itens dessa classe, porque presumiu os
atalhos que uma SaaS serverless costuma ter e este repositório fechou com gate
AST. O valor dela não foi a lista: foi obrigar a transformar duas crenças em
medição (o contrafactual do role-switch) e expor uma cegueira real de detecção
(SEC-050), que nenhum teste de funcionalidade encontraria.

Achado que não estava na lista e apareceu no caminho: o túnel do Sentry só engata
quando o host do DSN casa `o<id>.ingest[.<cc>].sentry.io`. Como a CSP não libera
o host de ingestão, trocar o DSN por um self-hosted mataria em silêncio todo o
relato de erro do cliente. Virou gate em `headers-gate.test.ts`.
