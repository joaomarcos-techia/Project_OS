# ADR-062 — Identidade, consentimento e nome da clínica no cadastro

- **Status:** O-3a e o Track O original foram publicados. A emenda vigente de confirmação e handoff
  está em §11: usuário nasce sem senha, o Qoro envia link e código pelo Resend, o link confirma apenas
  a caixa postal e a aba iniciadora instala a senha somente depois do código. Em 25/09/2026 o E2E
  fail-closed passou **5/5** contra Supabase DEV + Resend real, em Chromium, um worker, zero retry e
  9,4 min contra `next dev`, com limpeza Auth/DB/fixture/lock. O mesmo spec passou **5/5 em 4,9 min**
  no Preview protegido da branch, no SHA `9608e1e`, com fingerprint Auth + DB DEV, um worker/zero
  retry e cleanup zero.
  Inspeção do inbox e aceitação humana continuam `NOT TESTED`.
- **Data:** 2026-09-15.
- **Atualizado:** 2026-09-25.
- **Checkout de rollout:** PR #15 mesclado na `main` em `193ce31`. O alvo da aceitação humana continua
  sendo o Preview validado da branch; os checkouts de 16–17/09 são apenas histórico.
- **Contextos por subfatia:** onboarding + `lib/db` em O-3a; onboarding + infraestrutura Auth em
  O-3b. Não alterar o contexto identity/RBAC nem adicionar tenancy/billing.
- **Relaciona:** [ADR-060 §1.c/§1.c.1/§1.d/§5–§8](060-sessao-anonima-de-cadastro.md),
  [ADR-053](053-cadastro-autonomo-seguro.md), [ADR-037](037-server-authoritative-session.md),
  [ADR-007](007-rls-implementation-patterns.md), [ADR-008](008-identity-patterns.md),
  [ADR-010](010-security-definer-patterns.md), [ADR-011](011-outbox-audit-idempotency-patterns.md),
  [ADR-040](040-invite-acceptance-gate.md), [ADR-041](041-authz-tables-are-not-tenant-tables.md),
  [ADR-042](042-rls-initplan-and-public-least-privilege.md) e
  [Qoro v2 §21.19/§35.9](../qorov2.md).

## 1. Contexto, precedência e scope freeze proposto

Contexto observado antes da implementação O-3a em 15/09. O resultado posterior fica em §7.a
e Qoro v2 §35.10; não usar a descrição histórica abaixo como inventário atual.

O cadastro atual termina nas quatro perguntas impessoais. O schema, o CHECK da migration 0098 e
`SIGNUP_FUNNEL_ORDER` admitem apenas `initiated`, `details_complete`, `blocked`, `expired`;
`/me` retorna status, risco, expiração, versão e respostas. Não existem writers de identidade,
ownership ou consumo. `/join` é convite, com saga e cartão pelo backend, e não implementa Track O.

`/auth/confirm` já verifica OTP `signup`; `safeNext` permite apenas `/dashboard`, `/convite` e
`/reset-password`. `createAuthConfirmationUrl` hoje aceita apenas `invite | recovery | magiclink`
e fixa `/convite`; não é linker pronto para signup. `authenticate()` nega `NO_PROFILE`; leitura
de profile ou `getUser()` isolados não liberam convite pendente/epoch antigo. A seam O-3b e seu
retorno precisam de implementação própria e regressão dos caminhos atuais.

A decisão posterior da ADR-060 §1.c/§1.c.1 prevalece sobre a ordem original da ADR-053 e de
Qoro v2 §21.2: **quatro perguntas fechadas → identidade + consentimento + nome da clínica na mesma
tela → verificação de e-mail → Checkout hospedado**. A ADR-053 continua Proposed. Os §§2–4 da
ADR-060 descrevem o corte original de O-2; a migration 0098 e §1.c.1 documentam sua extensão pelas
perguntas. Esta proposta complementa esses contratos sem afirmar que seu schema já existe.

**Numeração:** ADR-061 permanece reservada ao perfil WhatsApp em Qoro v2 §33/§34.8. A busca local
de 15/09 não encontrou ADR-062 nem outra reserva desse número antes da criação deste documento.

O-3 significa a fatia de implementação de §21.19, não um marco da lista de §6. Dividir antes de
codificar; o teto vale individualmente e não será consumido pelo diff preexistente:

| Subfatia                    | Objetivo e entrega revisável                                                                             | Estimativa máxima                                                                            | Dependência                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **O-3a — dados e aceite**   | Tela após as perguntas; staging mínimo com CAS; contrato de endpoint; janitor comprovando remoção de PII | 18 arquivos / 1.200 linhas / 2 contextos                                                     | Aprovação deste contrato e da alteração de API/schema; execução SQL somente em Postgres local descartável autorizado |
| **O-3b — Auth e ownership** | `signUp`/verificação, retorno fixo, consumo/vínculo únicos, retomada verificada e anti-enumeração        | Reestimada em seis subfatias em §9; teto individual 25 arquivos / 1.500 linhas / 2 contextos | O-3a verde; aprovação dos contratos Auth/API de §9; alvo externo próprio se necessário                               |

O-3a não coleta senha nem envia e-mail enquanto O-3b não estiver instalada. Deve dizer **dados
salvos; criação da conta ainda indisponível**, sem botão de confirmação fictício. A tela final de
O-3b inclui senha no mesmo passo dos demais campos; o envio ao Auth ocorre por request separado e
guardado, depois do aceite/staging. Nenhuma subfatia entrega plano, Checkout, tenant, profile,
assinatura, onboarding operacional, Google Ads, painel de leads ou `O.H/O.S`.

## 2. PII mínima, aceite e validação

Os limites de staging foram **aprovados para O-3a**; senha/Auth foram aprovados depois em O-3b. Nome
e clínica reaproveitam o teto de 120 caracteres de `internal/step-state.ts`. Normalizar espaços de
bordas, recusar vazio e controles; não exigir que um nome contenha sobrenome. Todos os objetos são
estritos; campos desconhecidos, ids de usuário/tenant, role, preço, trial e plano são recusados.

| Campo                     | Entrada                                                                                   | Persistência Qoro proposta                                                                                                | Retomada                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Nome de quem cria a conta | 1–120 caracteres após trim                                                                | `owner_name`, staging protegido                                                                                           | Reexibir somente ao dono do draft; nunca em `/me` anônimo         |
| Nome da clínica           | 1–120 caracteres após trim                                                                | `clinic_name`, staging protegido; não cria clínica                                                                        | Mesmo limite de acesso do nome                                    |
| E-mail                    | Endereço validado, trim, máximo 160 caracteres, conforme antecedente de convite           | Somente `email_hash` por `hashEmail` de `lib/auth/email-hash.ts`; raw e-mail apenas em memória/request e no Supabase Auth | Redigitar depois de reload; hash não permite reconstruir endereço |
| Aceite                    | Checkbox desmarcada; literal `true` no envio                                              | `accepted_at` pelo relógio do banco, junto aos nomes/hash no mesmo CAS                                                    | Novo aceite explícito ao substituir dados ou recomeçar            |
| Senha, somente O-3b       | 8–72 caracteres, até 72 bytes, com ASCII maiúscula, minúscula e número; símbolo opcional; sem espaço, controle ou `trim` | Nunca em staging, metadata, logs, URL, outbox, storage ou DTO                                                             | Sempre redigitar; não restaurar                                   |

Não pedir CPF/CNPJ, telefone, endereço, especialidade, contato de terceiro, dados clínicos ou
pagador. Sem chave de clínica, não fabricar um tenant para usar `encryptForTenant`. A proposta
guarda os dois nomes em staging restrito, sem nova camada de criptografia global; esse custo
residual exige aceite deste contrato e não equivale à criptografia clínica por tenant.

Exibir os links existentes [Privacidade](https://qoro.dev/politica-de-privacidade) e
[Termos](https://qoro.dev/termos-de-uso). Sem versões/hash de documentos, histórico de aceite,
consentimento de marketing ou sistema novo de termos. `accepted_at` registra quando o servidor
recebeu o sinal; não prova qual texto estava publicado, conforme ADR-060 §1.d, nem constitui um
documento jurídico aprovado pelo controlador.

Aceite ausente/falso ou entrada inválida impede qualquer escrita de PII e chamada Auth. Nenhum
autosave, analytics, beacon ou erro Zod pode transmitir campos pessoais antes do envio aceito.
O parser pode receber o body limitado em memória para validá-lo; não o registra. Logs, Sentry,
métricas e audit recebem apenas motivos categorizados, sem nomes, e-mail/hash ou credenciais.

## 3. Contrato O-3a de staging/API/schema

**Endpoint aprovado O-3a:** `POST /api/signup/sessions/identity`. JSON estrito:
`{ rowVersion, ownerName, clinicName, email, accepted: true }`. Sem senha/captcha/id no body.
A sessão é resolvida exclusivamente pelo cookie `__Host-qoro_signup` existente.

| Resultado                                                                | HTTP / comportamento proposto                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Salvo                                                                    | `200 { rowVersion }`; não devolver PII, hash, id ou token                                                                                        |
| Entrada inválida / aceite ausente                                        | `400 { error: 'invalid_body' }`; zero escrita de PII                                                                                             |
| Corpo acima de 4 KiB                                                     | `413 { error: 'body_too_large' }`; cortar por bytes durante leitura e cancelar stream, inclusive sem `Content-Length`                            |
| Origem ausente/divergente ou Fetch Metadata cross-site                   | `403 { error: 'blocked' }`; validar origem configurada por `APP_BASE_URL`/`buildApplicationUrl`, antes de DB/PII; não confiar em Host arbitrário |
| Aba com versão antiga, sessão ainda utilizável                           | `409 { error: 'conflict' }`; reler `/me`, sem sobrescrever                                                                                       |
| Cookie ausente/malformado, desconhecido, bloqueado, vencido ou consumido | `410 { error: 'gone' }`; limpar cookie, mesmo body, zero mutação                                                                                 |
| Limite atingido                                                          | `429 { error: 'rate_limited' }`, `Retry-After`                                                                                                   |
| Limiter/DB/configuração indisponível                                     | `503` categorizado, sem sucesso ou fallback de escrita de PII                                                                                    |
| Gate de identidade desligado                                             | `503 { error: 'unavailable' }`; sem writer nem formulário de identidade ativo                                                                    |

Teto de 4 KiB cobre nomes UTF-8 de 120 caracteres, e-mail de 160 e envelope pequeno; provar
fronteira exata/multibyte. Reutilizar `readWebhookBodyCapped` e o decoder de `signup/cookie.ts`.
Propor limite distribuído de staging por IP **10/15 min** e por HMAC da sessão **5/15 min**;
falha/timeout de qualquer bucket fecha antes da escrita. Reutilizar sliding window, `redisKey`
e dependências atuais, sem alterar o fallback de login/bootstrap. O-2 segue sem PII e mantém
sua degradação própria; ela não autoriza o writer novo de PII.

O-3a adiciona apenas `owner_name`, `clinic_name`, `email_hash`, `accepted_at` e `identity_pending`.
Constraints: os quatro campos de staging são todos nulos ou todos preenchidos; comprimentos e
hash válido; `identity_pending` exige staging, quatro respostas e `consumed_at IS NULL`.
Não adicionar colunas de ownership, billing ou lease sem writer nesta subfatia.

O writer aceita `details_complete` ou `identity_pending` vivos, usa HMAC/token + status + versão

- dois TTLs + `consumed_at IS NULL` no mesmo UPDATE e incrementa `row_version`. A passagem
  `initiated → identity_pending` é recusada. Ao avançar para identidade, congelar as quatro
  respostas nessa sessão; sua edição após esse ponto não retorna silenciosamente a etapa anterior.
  Reenvio com versão antiga não repete efeito. Se a resposta se perder, `/me` informa o novo estado
  e a versão; nomes/e-mail/senha não são reconstruídos pela autoridade anônima.

O DTO `/me` mantém os campos atuais e acrescenta somente o novo valor de status. A mudança de
união pública também entra na aprovação de API; página/schema/testes devem aceitar explicitamente
o estado. App continua importando a boundary `@/contexts/onboarding`, nunca `internal/*`.

## 4. TTL, retenção e janitor

Manter **idle 15 min / absoluto 60 min desde a criação** para todo staging, inclusive o que for
vinculado depois. Atividade válida renova só idle com `least(..., absolute_expires_at)` pelo relógio
do banco. Polling automático de espera não representa atividade humana nem estende o draft.
Erro, retry recusado, consumo ou nova autenticação não reiniciam os prazos da linha antiga.

O janitor faz DELETE por vencimento de qualquer prazo, em lotes de **500**, até **10 lotes** por
execução, desde que a linha não carregue traço de billing. Depois da 0103, qualquer valor em
`billing_attempt_state`, `billing_attempted_at`, `asaas_customer_id` ou `asaas_subscription_id`
preserva a linha para reconciliação/compensação; apagar esse vínculo poderia deixar efeito externo
órfão. A retenção não autoriza acompanhamento comercial. A métrica e o campo de resultado ainda se
chamam `subscription_retained`/`retainedWithSubscription` por compatibilidade, mas contam os quatro
marcadores. Linhas sem traço de billing, inclusive consumidas/vinculadas vencidas, continuam sendo
removidas; bloqueio impede acesso imediatamente e não prolonga autoridade.

TTL encerra autoridade, não comprova exclusão física pontual. Cadência documentada de 10 min é
alvo operacional; backlog/indisponibilidade podem atrasar o DELETE. Medir heartbeat, backlog e
remoção em scratch; não afirmar retenção física máxima de 60 min ou janitor externo ativo sem
prova. Backups/retenção Supabase/Auth têm ciclo próprio e não são apagados por esse DELETE.
Esta fatia não exclui usuários de `auth.users` nem altera backup, cron/deploy ou retenção externa.

## 5. Contrato exigido para O-3b: Auth, consumo e ownership

Não implementar O-3b junto de O-3a. Seu scope freeze de execução deve preservar estes invariantes
e apresentar endpoint/schema/estimativa próprios antes de mudar o contrato público:

1. `signUp` usa SDK SSR server-only; senha/e-mail somente no request ao Supabase, após aceite,
   sessão viva, CAS e limites distribuídos. Não usar service-role `createUser` da saga de convite.
   Não vincular o UUID retornado por `signUp`: conta existente pode produzir resposta ofuscada.
2. Confirmação OTP já admite `signup`. Propor somente o destino fixo `/cadastro/continuar`, sem
   queries de retorno Track O nem fragmentos; preservar parser/allowlist dos demais fluxos.
   Não transmitir token anônimo, draft id ou PII na URL de confirmação. O token de e-mail pertence
   ao Supabase e não é token de cadastro. PKCE não é adicionado por inferência: exigir apenas se
   o fluxo escolhido o utilizar, com prova de SDK/provider e callback próprios.
3. Nova sessão Auth segue `createServerClient({ newSession: true, cookieWrites: 'required' })`:
   fragmentos antes do seletor, cookies HttpOnly, refresh sem escrita/apagamento do seletor.
   Nunca devolver access/refresh token ou importar SDK Supabase em cliente.
4. `getUser()` server-side deve confirmar id, e-mail e `email_confirmed_at`; `getSession()`,
   claims/email_hash/cookie anônimo e redirect não são prova de identidade. Usuário anônimo do
   Supabase é recusado. Criar seam mínima **exclusiva do onboarding pré-tenant**, sem permissões,
   clínica artificial ou bypass de `authenticate()`/`require*`.
5. Consultar profile autoritativo: usuário sem profile pode continuar apenas neste draft.
   Profile existente segue guards/epoch e destino do produto; `invite_pending`, desativado,
   excluído ou claims antigas não passam pela seam como se fossem usuários novos.
6. **Emendado em 17/09/2026 — ver §10.** Ownership requer confirmação explícita de dados/aceite
   pelo usuário verificado em POST same-origin. Com cookie original vivo e hash compatível com seu
   e-mail, revisar/reenviar dados e respostas antes de ligar a linha. Hash só confere consistência;
   não autoriza claim sozinho. Não carregar automaticamente nomes submetidos por terceiro na conta
   confirmada.
7. Propor `auth_user_id` único, escrito somente pelo servidor após essas provas, junto de
   `consumed_at`, `email_verified` e incremento de versão **na mesma transação/CAS**. Unique
   resolve duas sessões disputando o mesmo usuário. Ownership nunca muda de A para B. Consumir
   o bootstrap remove sua autoridade; limpar cookie na resposta, sem depender da limpeza para
   impedir replay. Provider I/O sempre fora da transação, conforme ADR-011.
8. **Emenda proposta ao instante de consumo de ADR-060 §5/Qoro v2 §21.6:** OTP estabelece sessão
   Auth verificada; a confirmação autenticada e explícita do draft conclui vínculo/consumo.
   Nenhum passo posterior aceita esse usuário/draft antes do consumo. Evita atribuir PII de uma
   submissão anônima a uma conta existente só porque ela confirmou o e-mail.
9. **Emendado em 17/09/2026 — ver §10.** No outro navegador, não buscar staging sem owner pelo
   HMAC de e-mail/UUID de `signUp`, nem transferir cookie. Depois de autenticar, retomar somente
   draft já pertencente ao próprio `auth_user_id`; se não existir, colher novamente as quatro
   respostas, nomes e aceite e criar um draft verificado, já consumido, sem nova credencial
   anônima. E-mail vem de `getUser()`.
10. Retomada autenticada consulta ownership + status + TTLs a cada request, não token consumido.
    Outra conta não lê nem altera o draft. Replay anônimo continua `410`; retry autenticado lê
    seu único draft sem vincular/consumir novamente. Expirou: negar acesso, purgar a linha antiga
    e permitir recomeço explícito, sujeito a limites, sem estender TTL ou reter PII antiga.
    Unique exige tratar a linha vencida na transação de recriação; não esperar o cron para resolver.

## 6. Anti-enumeração, indisponibilidade e envio de e-mail

O-3b deve reservar uma tentativa de envio com CAS **antes** de Auth I/O; duas abas/retries não
enviam duas vezes. Seu desenho deve incluir estado persistente de tentativa e resultado incerto,
sem senha/raw e-mail/token de captcha. Timeout após envio possível não autoriza retry cego,
compensação apagando usuário ou afirmar “e-mail enviado”. Recuperação de envio incerto precisa
de decisão guardada, cooldown e evidência; não pressupor idempotência de `signUp`/SMTP.

Para conta nova, existente verificada ou existente não verificada, manter resposta/copy públicas
uniformes: **“Se houver uma etapa de confirmação para este endereço, você receberá as instruções.
Se já tem conta, entre para continuar.”** Não retornar existência, UUID Auth, `identities`, e-mail
ou texto bruto do provider. Não prometer nova conta ou entrega. Provar body, status, caminhos e
amostras de timing para evitar ramo óbvio de enumeração; atraso fixo não substitui essa prova.

Limites iniciais de §21.7 a materializar no scope O-3b: envio **10/15 min/IP, 5/sessão, 3/h/e-mail**;
reenvio **10/h/IP, 3/h/sessão e e-mail, cooldown 60 s**. Chaves de sessão/e-mail HMAC, IP
normalizado por `ipRateLimitKey` e separação de ambiente, conforme infraestrutura vigente;
nenhum e-mail bruto em contador ou IP bruto em staging/logs. Limiter ausente/degradado fecha **antes** de qualquer chamada
capaz de enviar e-mail. DB/Auth/cookies indisponíveis não geram sucesso nem claim parcial.

Captcha Supabase permanece conforme configuração já registrada, sem ativação de painel nesta
fatia. Cada operação protegida obtém token fresco; não reutilizar desafio do bootstrap nem gastar
o mesmo token no siteverify próprio e no Supabase. `verifyOtp({ token_hash, type })` não aceita
`options.captchaToken`. Integração do desafio, política de senha, SMTP, templates e redirect URLs
exigem contrato/provider reais no alvo autorizado; mocks não fecham esses gates.

## 7. Impacto, evidência e critérios de aceite

| Superfície/domínio                      | Prova obrigatória na implementação                                                                                                                               | Estado em 15/09 nesta fatia                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Staging/PII                             | Schema estrito, aceite falso/ausente, limite/cancelamento/multibyte, controles, zero PII em DTO/logs/storage/URL                                                 | **NOT TESTED — sem implementação**                                |
| Estado/DB                               | Transições ilegais, TTL idle/absoluto, CAS simultâneo, retry/resposta perdida, janitor com PII sintética e readback zero                                         | **NOT TESTED**                                                    |
| Grants/RLS                              | Scratch vazio/populado/volume; migração up/down/up; anon/authenticated/qoro_runtime sem DML, service-role mínimo                                                 | **NOT TESTED**                                                    |
| UI/cadastro                             | Quatro perguntas preservadas, mesma tela de dados/aceite, teclado/foco/labels, reload, duas abas, 409/410/429/503/rede e copy honesta                            | **NOT TESTED**                                                    |
| Auth/ownership O-3b                     | Conta nova/existente, não verificado/anônimo/profile pendente, A→B, duas sessões, consumo/replay, OTP inválido/expirado, confirmação cruzada, retomada/recriação | **NOT TESTED**                                                    |
| Anti-abuso O-3b                         | Limiter/provider indisponíveis, timeout incerto, cooldown, retry sem envio/vínculo duplicado, anti-enumeração                                                    | **NOT TESTED**                                                    |
| Transporte de sessão                    | AST sem SDK browser, Chromium/Next/SDK reais, fragmentação/refresh e ausência de bearer                                                                          | PASS histórico em Qoro v2 §35.6; integração O-3 **NOT TESTED**    |
| Identity/convite                        | Guards/epoch, gate `invite_pending`, recovery/OTP/allowlist atuais preservados; regressões existentes                                                            | Gates atuais conforme §35.9; comportamento O-3 **NOT TESTED**     |
| Tenancy/billing/Agenda/Payments/Meta/IA | Nenhum writer/callsite novo; suíte existente verde, sem recurso externo por cadastro                                                                             | Não alterados por este contrato; jornada posterior **NOT TESTED** |
| GoTrue/SMTP/Preview/produção            | Provider real, caixa de teste consentida, alvo/fixture autorizados, cleanup e readback                                                                           | **NOT TESTED**, sem autorização externa nova                      |

Validações documentais e gates executados nesta retomada, comandos/exit codes/ambiente, estão em
[Qoro v2 §35.9](../qorov2.md) e na [matriz E2E](../quality/e2e-coverage-matrix.md). Nenhum PASS de
docs/build/suíte atual comprova comportamento novo, migração aplicada, SMTP ou Product Acceptance.

### 7.a Execução aprovada e evidência local

O-3a foi implementado após o “aprovo” do fundador. Writer/schema vivem em
`internal/signup-session.ts`, na tabela global já protegida, sem nova exceção arquitetural.
Migration 0099 validada em scratch vazio/down/populado (2.000 linhas); staging impede down
até descarte. SQL/Chromium reais passaram em 19 checks, incluindo resposta perdida/reload,
CAS, constraints (inclusive controle C1), TTL, janitor e cleanup zero. Redis REST é sintético
pelo SDK instalado; nenhuma prova de Upstash/GoTrue/SMTP externa foi fabricada.

Next 15.5.24/eslint-config-next 15.5.24 e Sharp 0.35.4 corrigem o audit preexistente em fatia
de manutenção separada. Após atualização: 3.518/3.518 testes (372 arquivos), typecheck/lint/
formatação e audit PASS. Build e navegador com o runtime atualizado: **PASS**;
fechamento em Qoro v2 §35.10. A tabela §7 acima guarda a fotografia pré-implementação.

## 8. Aprovação, rollout e próximo passo

Aprovação recebida do fundador em 15/09/2026 (“aprovo”): implementar **somente O-3a localmente**,
incluindo novo endpoint/DTO, writer/schema e migration, com execução SQL/testes exclusivamente em
Postgres descartável de loopback com fixtures sintéticas e cleanup verificável. Não executar SQL
em DEV compartilhado, Preview, Sandbox ou produção sob essa aprovação. API/migration/Auth/infra
posteriores têm aprovação própria; nenhuma dependência de produção nova é prevista.

O-3a instala `SIGNUP_IDENTITY_ENABLED` server-only,
default `false`, registrado no schema de env e inventário, guardando UI/endpoint/writer. Ativação
somente em fixture local nesta aprovação; configuração/rollout externos continuam separados.
Reverter código ou desligar o writer impede novas gravações; PII já gravada
permanece até descarte/janitor comprovado, portanto rollback não é apenas desligar UI. Não remover
colunas com dados nem executar down em ambiente compartilhado sem autorização e plano próprios.
O-3b cria identidade Auth externa; seu rollback não se resolve apagando `signup_sessions` e deve
preservar contas preexistentes. Sem deploy, alteração de CI/cron/config Auth ou chamada externa
automática para fabricar prova. Patch CI de 15/09 já autorizado/aplicado permanece preservado.

Após aprovação, reestimar O-3a e conferir branch/HEAD/hunks; implementar e validar uma subfatia
até ficar verde; atualizar ADR, canônico, Discovery Log e matriz durante a execução. O contrato
teve O-3a aprovado primeiro e O-3b.1–6 aprovadas e fechadas localmente depois; provas externas
continuam separadas. **Track O e Qoro v2 permanecem EM DESENVOLVIMENTO.**

## 9. Scope freeze de execução O-3b — 15/09/2026

**Contratos aprovados após “Aprovo” do fundador; O-3b.1–6 executadas e validadas localmente.** O
scope freeze abaixo foi preparado antes dessa aprovação. Ela cobre as seis subfatias sequenciais/API/schema
e SQL somente em Postgres descartável loopback com dados sintéticos/cleanup verificável.
Não autoriza Auth/SMTP/config/SQL externos nem publicação. O-3a e o trabalho anterior permanecem
preservados no mesmo checkout; implementação e evidência serão registradas por subfatia.

### 9.1 Código observado e decisão de transporte

Node 22.16.0/pnpm 11.17.0; Next 15.5.24, `supabase-js` 2.106.2 e `@supabase/ssr` 0.10.3.
O cliente de `lib/auth/supabase-server.ts` já centraliza cookies e timeout de fetch de 20 s.
O SDK SSR instalado **força `flowType: 'pkce'`**, inclusive sobre `options.auth.flowType`.
`signUp` gera challenge/verifier; `verifyOtp({ token_hash, type })` usa `/verify`, enquanto
`exchangeCodeForSession` usa `/token?grant_type=pkce` e depende do verifier original.

Preservar o cliente SSR. Para Track O, escolher link customizado com `TokenHash` e OTP no
servidor, sem callback `code` nem mudança dos fluxos existentes. Template para
**Confirm sign up**, com callback canônico fornecido pelo servidor, não derivado de Host:

```html
<a
  href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup&next=%2Fcadastro%2Fcontinuar"
  >Confirmar e-mail</a
>
```

`emailRedirectTo` de signup/resend é a URL canônica `/auth/confirm` construída por
`buildApplicationUrl`; o template a recebe em `RedirectTo`, acrescenta somente `TokenHash`,
`type=signup` e o destino interno fixo `/cadastro/continuar`. Template, redirect allowlist e
aceitação de `type=signup` pelo GoTrue real exigem readback/teste no alvo autorizado. Não usar
`ConfirmationURL` para devolver bearer ao browser.
Não acrescentar draft id, token de bootstrap, e-mail, nomes ou retorno arbitrário ao link.

Fundamentação: [templates e endpoint SSR](https://supabase.com/docs/guides/auth/auth-email-templates),
[signup SSR](https://supabase.com/docs/guides/auth/passwords) e código do SDK instalado.
Prova local de contrato SDK não comprova GoTrue, template publicado ou entrega SMTP.

O login atual recusa qualquer usuário sem profile e faz signOut local. Sem uma extensão
restrita, uma conta pré-tenant confirmada não conseguiria retomar por senha depois de consumir
o OTP. Incluir esse callsite no escopo: somente com gate Auth ativo e prova atual de usuário
verificado sem profile, encaminhar para continuar; conservar todos os caminhos de perfil/MFA.

### 9.2 Subfatias e orçamento antes de código

O escopo completo excede a estimativa original de uma única fatia. Executar sequencialmente,
com checkpoint verde por objetivo, mantendo gate Auth desligado entre entregas incompletas.
Estimativas incluem implementação **e testes**; documentação/inventário gerado têm recorte
próprio de até oito arquivos/600 linhas por checkpoint. Reestimar antes de ultrapassar qualquer
teto; não atribuir o diff preexistente ao trabalho novo.

| Subfatia | Entrega concreta                                                               | Estimativa de arquivos / linhas alteradas | Superfícies principais                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O-3b.1   | Reserva CAS, envio inicial, limiter fechado e recusa de sessão Auth inesperada | 18 / 1.450                                | signup-session/schema/index, migration 0100+journal, novo POST auth+testes, rate-limit+testes, supabase-server+testes, env, questions+testes e prova SQL/SDK |
| O-3b.2   | OTP com destino fixo, seam verificada e retomada por login pré-tenant          | 14 / 1.300                                | confirm-logic/route+testes, seam Auth+testes, login/actions+testes e contrato SDK                                                                            |
| O-3b.3   | Draft com ownership/consumo/retomada/recriação                                 | 16 / 1.450                                | writer onboarding+testes, migration 0101+journal, GET/POST draft+testes e prova SQL                                                                          |
| O-3b.4   | Reenvio explícito com reserva, cooldown e recuperação de resultado incerto     | 9 / 1.100                                 | novo POST resend+testes, writer+testes, buckets Auth+testes e prova SQL/SDK                                                                                  |
| O-3b.5   | Senha na tela de dados, espera honesta e revisão autenticada em continuar      | 15 / 1.400                                | cadastro/page/questions/identity+testes, nova continuar/page/form+testes e widget existente                                                                  |
| O-3b.6   | Prova integrada HTTP/SQL/Chromium e fechamento local                           | 6 / 1.400                                 | harness signup-regression, fixture Auth local, provas de sessão/browser e inventário fonte                                                                   |

Somente onboarding + infraestrutura Auth; não alterar schemas/writers de identity, tenancy,
billing, Agenda, Payments, Meta ou IA. Reutilizar a leitura autoritativa e os guards de identity.
Sem dependência nova, CI/build/deploy, cron novo, criação artificial de profile/clínica ou Asaas.
O-3b.1 é o primeiro objetivo após aprovação; não chamar o conjunto de concluído antes de O-3b.6.

Reestimativa durante O-3b.1, antes de ampliar a prova: implementação e testes unitários
fecharam em 17 arquivos/912 linhas alteradas. A prova SQL/HTTP/SDK/Chromium ficou em recorte
sequencial próprio (1 harness/511 linhas); documentação/inventário, em 7 arquivos/123 linhas.
Isso preserva
o teto por alteração revisável sem pular a validação nem iniciar O-3b.2.

### 9.3 Contratos de API e UI propostos

Instalar `SIGNUP_AUTH_ENABLED` server-only, default false. Cada endpoint/writer novo o verifica;
UI só oferece Auth quando esse gate e `SIGNUP_IDENTITY_ENABLED` estiverem ativos. Não ativar
configuração externa nesta execução. Novas rotas Node, dinâmicas, respostas `no-store`.

| Superfície                                   | Entrada/autoridade                                                                                                                          | Sucesso e negativos                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/signup/sessions/auth`             | Cookie original; JSON estrito `{ rowVersion, email, password, accepted: true, captchaToken? }`; staging aceito e hash compatível            | `200 { rowVersion }` uniforme para nova/existente; 400 inválido, 403 origem, 409 CAS/etapa incompatível, 410 morta, 413 corpo, 429 limite, 503 indisponível/incerto                             |
| `POST /api/signup/sessions/resend`           | Cookie original; `{ rowVersion, email, accepted: true, captchaToken? }`; nunca senha nem lookup de conta pelo e-mail                        | Mesmo envelope uniforme do envio; 429 também para cooldown, com `Retry-After`; zero chamada em negação                                                                                          |
| `GET /api/signup/sessions/me`                | Cookie anônimo vivo, não consumido; conserva projeção sem PII                                                                               | Acrescenta só `email_pending`; resposta perdida/reload não solicita Auth de novo. Não expõe estado interno de provider/tentativa                                                                |
| `GET /api/signup/draft`                      | `getUser` verificado + seam pré-tenant + owner/estado/dois TTLs                                                                             | `200 { status: 'email_verified', rowVersion, ownerName, clinicName, answers, idleExpiresAt, absoluteExpiresAt }`; 401 sem prova, 403 perfil impedido, 410 sem draft vivo, 429/503 categorizados |
| `POST /api/signup/draft`, modo `link`        | `{ mode: 'link', rowVersion, ownerName, clinicName, answers, accepted: true }`, usuário verificado e cookie original compatível             | `200 { rowVersion }` após CAS/ownership/consumo; 409 disputa/draft já existente, 410 original morto, demais negativos de validação/Auth/origem/limites                                          |
| `POST /api/signup/draft`, modo `restart`     | `{ mode: 'restart', ownerName, clinicName, answers, accepted: true }`; usuário verificado, dados/respostas/aceite recolhidos explicitamente | Cria linha nova consumida com owner; 409 se já há draft vivo. Purga somente seu draft vencido na mesma transação. E-mail sempre de `getUser`, sem novo cookie anônimo                           |
| `/auth/confirm` e `/cadastro/continuar`      | OTP estabelece sessão; continuar revalida usuário/profile e exige revisão explícita para link/restart                                       | Novo `next` aceita **somente** `/cadastro/continuar` sem query/fragmento, limitado a OTP `signup`; demais destinos/parser/fluxos conservam contrato. OTP não consome draft                      |
| Login por senha, somente ausência de profile | Prova `getUser` verificado, não anônimo e gate Auth ativo depois do login existente; nunca confiar só no user retornado por signIn          | Encaminha apenas para `/cadastro/continuar`; gate off/usuário não verificado mantém negativa. Profile existente segue destino/MFA/guards atuais                                                 |

`answers` reutiliza as quatro opções fechadas de `signup-answer-values.ts`, com validação
estrita; nunca texto livre/PII de terceiro. IDs, role, plano, trial, preço e tenant são recusados.
`/draft` não devolve id/token/hash/UUID Auth nem senha; nomes só após ownership comprovado.
Revisão antes do vínculo mantém nomes em branco; as respostas impessoais do cookie original
podem ser exibidas, mas o POST confirma explicitamente o conjunto. Outro browser recolhe tudo.
Retry autenticado usa GET de seu draft; não reaplica link/restart nem sobrescreve dados.

Limitar auth/resend a **16 KiB reais**, incluindo captcha/multibyte; draft a **4 KiB**. Reutilizar
reader capped e decoder de cookie; cortar/cancelar antes de parsing. POSTs validam Origin
canônica e Fetch Metadata antes de PII/DB; GET não exige Origin ausente em fetch de leitura,
não abre CORS nem escreve/renova TTL. Gate antes de qualquer efeito. Falha de limiter fecha antes do writer
e de qualquer SDK capaz de enviar e-mail. Nenhum log recebe body, Zod issues ou erro bruto Auth.

Na mesma tela, validar dados/aceite/senha, salvar staging e então chamar Auth com a versão
retornada, sem navegar/autosave entre os requests. Limpar senha/captcha após tentativa, sem
restaurar no reload. Se staging ou Auth perder resposta, reler estado; nenhuma repetição
automática de signup/resend. Oferecer login existente e reenvio por ação explícita com redigitação
de e-mail/aceite e novo desafio. Copy pública única conforme §6; não afirmar envio ou nova conta.

### 9.4 Schema, CAS e resultado incerto

**Migration 0100 proposta:** `auth_attempt_kind` (`initial|resend`), `auth_attempt_state`
(`reserved|completed|uncertain`), `auth_attempted_at` e estado `email_pending`. As três colunas
de tentativa são todas nulas ou preenchidas; etapa pending exige quatro respostas/staging,
tentativa e `consumed_at IS NULL`. Preservar constraints/grants/RLS das migrations 0096–0099.
`identity_pending` anterior continua válido, sem tentativa; writer de identidade só substitui
staging antes de qualquer reserva. Nunca trocar e-mail/nomes sob uma tentativa em voo.
Reconhecer/fixar `email_pending` no DTO e na tela já em O-3b.1, inclusive com gate desligado:
nenhuma edição de respostas/identidade nem retomada silenciosa da etapa anterior. Controles
completos de Auth/reenvio chegam apenas na subfatia UI, sem afirmar entrega antecipadamente.

Enviar inicialmente somente por CAS `identity_pending`, versão esperada, HMAC/token, staging
compatível, dois TTLs e não consumido. UPDATE reserva `email_pending/reserved/initial`, instante
DB e nova versão; essa reserva é a única permissão para uma chamada inicial. Provider fora da tx.
Finalização compara a versão reservada e as mesmas condições; muda para completed/uncertain e
incrementa versão, **sem renovar TTL por atividade de máquina**. Ignorar UUID/identities retornados.
Respostas dependentes de conta, inclusive recusa por conta existente, seguem o mesmo 200/copy;
categorizar códigos SDK confirmados, nunca mensagem/email do provider.

Falha de rede/timeout/5xx, perda da finalização no DB ou crash mantém a tentativa como
potencialmente enviada. `reserved` abandonado tem o mesmo tratamento conservador de uncertain.
Retornar 503 genérico se não há finalização comprovada; nenhuma compensação apagando Auth.
`/me` só informa a etapa pending. GET não transforma estado nem autoriza retry inicial.

Reenvio é **nova intenção explícita**, nunca repetição de `signUp`. Usa `resend({ type: 'signup',
email, options })`, mesmos hash/staging/TTL/CAS, cooldown DB de 60 s desde a tentativa anterior e
buckets próprios. Pode recuperar completed/uncertain/reserved abandonado depois do cooldown;
reserva nova versão antes do SDK. Uma finalização antiga não conclui a reserva nova. Como SMTP
não é idempotente, um envio antigo incerto pode entregar depois: não prometer exatamente um e-mail
nem confundir esse risco com duas abas emitindo a mesma intenção.

**Migration 0101 proposta:** `auth_user_id uuid UNIQUE` e estado `email_verified`; sem FK para
profile, pois o usuário ainda não o possui. Email_verified exige owner, consumed_at, staging e
respostas. Não promover owners de linhas existentes pelo hash de e-mail. Link escreve owner,
consumo, status, dados/aceite reconfirmados e versão no mesmo CAS/transação; owner nunca muda.
Unique resolve sessões concorrentes do mesmo usuário. Limpar bootstrap depois do commit;
mesmo se cookie clear falhar, consumed_at nega replay. A constraint antiga token_hash NOT NULL
é preservada: restart gera HMAC aleatório server-side sem emitir a credencial ao navegador.

Retomada sempre por owner + estado + dois TTLs; polling não estende nenhum prazo. Restart
transacional elimina apenas a linha expirada daquele owner, verifica ausência de draft vivo e
cria prazos novos exclusivamente para a linha nova. Disputa unique retorna conflito/GET próprio,
sem apagar linha viva. Janitor continua removendo também tentativas/owners/PII vencidos.
Não alterar migrations já registradas. Números 0100/0101 livres no checkout reconfirmado; verificar
novamente antes de criar arquivos e registrar no journal.

### 9.5 Seam, anti-abuso e configuração ainda pendente

Seam server-only em `lib/auth` usa `getUser()` para id/e-mail/email_confirmed_at e recusa usuário
anônimo. Consulta `readAuthoritativeProfile`; ausência permite apenas onboarding. Havendo profile,
usa `authenticate()` e verifica o mesmo userId: identidade válida segue destino fixo do produto;
invite_pending segue apenas fluxo de convite, nunca draft. Desativado/excluído/claims antigas/
inconsistência bloqueiam. DB/Auth indisponíveis falham fechado; não tratar exceção como NO_PROFILE.
Não mudar `authenticate`/require\*, não criar permissões nem aceitar claims/cookie/hash como prova.
Login ganha apenas encaminhamento para essa seam quando não há profile e a verificação é
comprovada; nunca converter profile impedido em usuário novo. Continuação exige a seam a cada
request, inclusive após senha correta; não concede acesso às rotas tenant.

OTP mantém nova geração + cookies required + fragmentos antes do seletor. Para signup inicial,
propor opção restrita no adapter `sessionWrites: 'reject'`, default permitindo os fluxos atuais:
rejeitar qualquer tentativa de gravar sessão inesperada **antes** dos fragmentos/seletor. A chamada
usa também newSession/required para isolar a geração. Se confirmação estiver desligada e o SDK
tentar auto-login, falhar sem instalar essa sessão nem apagar a sessão anterior. Provar esse caso
no SDK real; não ativar Auth sem readback da confirmação obrigatória no alvo.
O callback atual registra `error.message` no warning; O-3b.2 substitui esse detalhe por motivo
categorizado de OTP, preservando `verifyErrorReason` para a UI. Não introduzir raw erro de provider
nos logs de signup/OTP/resend nem tratar stack do SDK como prova de envio.

Buckets distribuídos: inicial IP 10/15 min, sessão 5/60 min (janela absoluta do draft), e-mail 3/h;
resend IP 10/h, sessão 3/h, e-mail 3/h + cooldown 60 s. Novo writer verificado: IP 10/15 min e
HMAC do usuário 5/15 min; leitura autenticada IP 120/15 min e HMAC do usuário 60/15 min.
Todos fechados em ausência/erro/timeout, inclusive `success:true` com reason timeout do SDK.
Reutilizar redisKey, hashEmail e ipRateLimitKey; HMAC de usuário com domínio separado do bootstrap,
sem id/email/IP bruto em chaves/logs. Nenhum fallback local autoriza envio/PII/ownership.

**Filtro Qoro atualizado pelo fundador em 17/09/2026:** mínimo oito caracteres, ao menos uma letra
maiúscula, uma minúscula e um número; caractere especial é opcional. Aplicar no servidor antes de
Auth e reutilizar o mesmo validador na UI O-3b.5. Símbolos continuam aceitos; espaço/controle não é
aceito. O teto é 72 bytes, limite do Auth, sem
`trim` ou normalização da senha. Recusa dependente da conta não produz enumeração. A configuração
efetiva do provider continua NOT TESTED até a verificação no painel.

Captcha segue último registro externo, sem ativação. Usar widget/captchaOptions existentes com
token fresco por chamada; não reutilizar bootstrap nem validar o mesmo desafio em dois providers.
SMTP/template/redirect/captcha/política externos permanecem NOT TESTED até prova no alvo autorizado.

### 9.6 Validação, autorização solicitada e limite de fechamento

Solicitar aprovação **dos contratos de §9 e execução local sequencial**, incluindo migrations
0100/0101 e SQL apenas em Postgres descartável loopback, dados sintéticos e cleanup/readback zero.
GoTrue sintético local serve para contrato do SDK, não para fechar provider. Não incluir nessa
aprovação recursos Auth compartilhados/externos, SMTP real, painéis/config, Preview/Sandbox/prod,
push/commit/deploy, nova dependência ou mudanças CI/build. Alvo/caixa consentida/cleanup externos
serão proposta separada depois de implementação concreta e verde.

Provas novas obrigatórias: duas abas e uma chamada por reserva; sem Auth antes de aceite/limites/
CAS; timeout/crash/finalização atrasada/resposta perdida sem retry cego; cooldown/429/503; mesmo
body/status/caminho e amostras de timing para nova/existente verificada/não verificada; OTP
inválido/expirado, destino com query/fragmento e browser sem verifier original; getUser sem email
confirmado/anônimo; todos os guards/epoch de profile; A→B/duas sessões/unique; link/replay/clear
falhando; restart/expiry/purge concorrente; RLS/grants/populado/up-down-up/volume e janitor com PII.
UI: quatro perguntas, senha/aceite na mesma tela, teclado/foco/reload/rede e zero senha/bearer/PII
anônima em DTO/storage/URL/logs. Nenhum bypass de captcha/provider nem teste desativado.

Por subfatia de código: typecheck, lint, formato, testes focados/SQL pertinentes, revisão do diff.
Fechamento integrado: coverage completa (dois workers), security:check por etapas sem builds
concorrentes, test:e2e:ci, arquitetura/registry/migrations/observabilidade. Build sempre isolado
sem dotenv real; scripts `_env` em cwd/ambiente sintéticos. Publicar evidências separadas em
canônico/Discovery/matriz, com exit codes e cleanup. GO-LIVE/Checkout/O.H/O.S continuam fora.

### 9.7 Evidência da preparação, sem implementação O-3b

| Verificação nesta retomada                                                                                                                | Resultado / limite                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node dist/auth-email-o3b-freeze/sdk-probe.mjs`                                                                                           | PASS, exit 0, 7 checks/6 chamadas em loopback sintético; confirmação em jar independente, PKCE forçado, resend e rejeição esperada de sessão no adapter. Servidor encerrado |
| Vitest dos cinco arquivos Auth atuais (tenant-context, supabase-server, supabase-session-cookie, rate-limit, confirm-logic), dois workers | PASS, exit 0, 108/108; comprova contratos atuais, não endpoints futuros                                                                                                     |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                        | PASS, exit 0; MD ignorado no comando global, ADR também conferida explicitamente com ignore vazio                                                                           |
| Links/contagem/revisão com baseline do checkout                                                                                           | PASS, 239 links locais/zero quebrados; matriz permanece 84/5/0/4/9; somente quatro documentos alterados, zero stage, código anterior preservado                             |

Artefatos/logs/diff em `dist/auth-email-o3b-freeze`, ignorados. Nenhuma migration/teste SQL novo,
build novo ou suíte completa repetida nesta fatia documental de código inalterado. Os resultados
de O-3a permanecem em §7.a/Qoro v2 §35.10. O-3b integrado e provider externo continuam NOT TESTED.

### 9.8 Evidência O-3b.1 — envio inicial local

O-3b.1 implementa a migration 0100, o estado `email_pending`, reserva/finalização CAS,
POST inicial com origem/cap/limites distribuídos fechados e o adapter que rejeita sessão Auth
inesperada antes de gravar fragmentos ou seletor. Senha, e-mail bruto, UUID e identities do
provider não entram no staging nem na resposta. O GET da espera não renova TTL e a UI congela
respostas/identidade sem afirmar que o e-mail foi entregue.

| Verificação                                                           | Evidência local                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suíte integral com cobertura, dois workers                            | PASS, exit 0, 3.594/3.594 em 374 arquivos; linhas 50,94%, branches 81,56%, funções 56,85%                                                                                        |
| Build Next 15.5.24 isolado                                            | PASS, exit 0, concluído em 16/09/2026; somente variáveis sintéticas allowlisted                                                                                                  |
| Postgres 17 descartável + migration 0100                              | PASS, vazio/up-down-up e 2.000 linhas preservadas; grants/RLS sem expansão; CAS/TTL/janitor; cleanup zero e cluster encerrado                                                    |
| Next produzido + SDK instalado + Auth/Redis loopback + Chromium       | PASS, 22 checks principais e 13 cenários Auth; duas requisições geram uma chamada, timeout 20 s, sessão inesperada, resposta perdida, limite e Redis indisponível sem retry cego |
| Typecheck, lint, Prettier, migration safety, inventário e arquitetura | PASS; 174 actions/40 métodos, zero rota sem teste, zero env pública irregular, zero achado DB e zero ciclo                                                                       |

Esta prova é **local e sintética**. GoTrue/SMTP/template/redirect/captcha/política do Supabase,
migration compartilhada, Preview, produção e entrega real de e-mail permanecem **NOT TESTED**.
O-3b.2 (OTP/retomada verificada) fica registrada em §9.9. Ownership, reenvio e UI da senha
continuam em subfatias posteriores. Track O e Qoro v2 permanecem EM DESENVOLVIMENTO.

### 9.9 Evidência O-3b.2 — confirmação e retomada pré-tenant locais

O callback `signup` ignora todo `next` recebido e termina exclusivamente em
`/cadastro/continuar`, sem query ou fragmento. A nova seam server-only aceita somente o usuário
não anônimo que `getUser()` devolve com e-mail válido e `email_confirmed_at`; ausência de profile
libera apenas a continuação do cadastro. Profile existente volta ao `authenticate()` e às regras
atuais de MFA, role, epoch, ativo/deletado e convite. O login estende somente o caso verificado sem
profile; os demais caminhos permanecem com a política anterior. Falha de OTP registra tipo e
motivo categorizado, sem mensagem bruta do provider.

| Verificação                                                  | Evidência local                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Testes focados                                               | PASS, 73/73: seam, callback, destino fixo, login pré-tenant e página protegida                                                                                                                                     |
| Suíte integral com cobertura, dois workers                   | PASS, 3.644/3.644 em 377 arquivos; linhas 51,02%, branches 81,75%, funções 56,83%                                                                                                                                  |
| Build Next 15.5.24 isolado                                   | PASS; `/cadastro/continuar` dinâmica no manifesto produzido                                                                                                                                                        |
| SDK instalado + Auth/Redis loopback + Postgres 17 + Chromium | PASS, 22 checks principais e 15 cenários HTTP/SDK; link `token_hash` sem PKCE prévio, quatro `next` hostis ignorados, duas revalidações `getUser()`, sessão HttpOnly e OTP inválido/expirado sem sessão/PII no log |
| Escopo medido contra o checkpoint O-3b.2                     | 10 arquivos/580 linhas de implementação e testes; harness separado em 1 arquivo/168 linhas                                                                                                                         |

Esta prova é **local e sintética**. GoTrue/SMTP/template/redirect/configuração do Supabase,
Preview, produção e entrega real de e-mail continuam **NOT TESTED**. A seam não cria clínica,
profile, role ou permissão e não consome/vincula o draft; ownership, confirmação explícita dos
dados e unicidade A→B pertencem à O-3b.3.

### 9.10 Evidência O-3b.3 — ownership e consumo locais

A migration 0101 acrescenta `auth_user_id uuid UNIQUE` e o estado `email_verified`, sem FK para
profile. O CAS de link exige usuário/e-mail confirmados pela seam, HMAC do e-mail compatível,
cookie original, versão e dois TTLs vivos; owner, consumo, dados confirmados e nova versão são
gravados atomicamente. A leitura autenticada projeta somente nomes, respostas, estado, versão e
prazos, sem renovar TTL. Restart apaga somente o draft vencido do próprio owner e cria uma linha
consumida com token aleatório não emitido. O endpoint não cria profile, clínica, role, permissão,
plano ou trial.

| Verificação                                               | Evidência local                                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes focados                                            | PASS, 110/110: schema estrito, seam, HMAC de usuário, limites fail-closed, writer e GET/POST draft                                                                                                              |
| Suíte integral com cobertura, dois workers                | PASS, 3.689/3.689 em 380 arquivos; linhas 51,08%, branches 81,87%, funções 57,04%                                                                                                                               |
| Migration 0101 + Postgres 17 descartável                  | PASS, vazio/up-down-up e 2.000 linhas preservadas; RLS/grants inalterados; link, e-mail/versão divergentes, A→B, replay, unique concorrente, leitura sem renovação, restart e purge; cleanup zero               |
| Next produzido + Auth/Redis loopback + Chromium           | PASS, 23 checks principais e 16 cenários HTTP/SDK; OTP real pelo SDK instalado, link pela rota produzida, cookie limpo, DTO sanitizado e replay com cópia prévia do cookie recusado sem mutação                 |
| Build, typecheck, lint, formato, inventário e arquitetura | PASS; Next 15.5.24, 174 actions/42 métodos/zero guard pendente, rota com teste, migration safety, DB guard, grafos, madge e observabilidade                                                                     |
| Escopo medido contra o checkpoint O-3b.3                  | 17 arquivos/1.080 linhas de implementação, testes e guards; harness separado em 1 arquivo/392 linhas. O detector de disputa reconhece `23505` direto ou no `cause` do wrapper Drizzle e propaga os demais erros |

Esta prova é **local e sintética**. A migration 0101 não foi aplicada fora do Postgres
descartável. GoTrue/SMTP/Upstash externos, template/redirect/configuração Supabase, Preview,
produção e entrega real de e-mail permanecem **NOT TESTED**. Reenvio explícito e a UI de revisão
e senha continuam nas subfatias O-3b.4/O-3b.5; Track O e Qoro v2 permanecem EM DESENVOLVIMENTO.

### 9.11 Evidência O-3b.4 — reenvio explícito local

O novo `POST /api/signup/sessions/resend` aceita somente e-mail, versão, aceite e captcha opcional;
senha e campos de ownership são recusados. Três baldes distribuídos próprios limitam IP a 10/h,
sessão a 3/h e HMAC do e-mail a 3/h, sem fallback local. Depois dos limites, o writer reserva
`auth_attempt_kind='resend'` por CAS e exige cooldown de 60 s pelo relógio do Postgres. Estados
`completed`, `uncertain` e `reserved` abandonado podem ser recuperados depois do prazo. A chamada
usa `supabase.auth.resend({ type: 'signup' })` uma vez; resultado tardio só finaliza a reserva
`resend` de mesma versão. Reserva/finalização não renovam TTL e nunca repetem `signUp`.

| Verificação                                               | Evidência local                                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes focados                                            | PASS, 173/173: schema sem senha, cooldown, CAS/finalização, três buckets fail-closed, rota/cap/origem e SDK                                                                                                       |
| Suíte integral com cobertura, dois workers                | PASS, 3.742/3.742 em 381 arquivos; linhas 51,26%, branches 82%, funções 57,15%                                                                                                                                    |
| Postgres 17 descartável                                   | PASS, 24 checks: cooldown DB, um vencedor concorrente, TTL congelado, recuperação de `completed`/`uncertain`/`reserved`, finalização antiga negada, cleanup zero e cluster encerrado                              |
| Next produzido + Auth/Redis loopback + Chromium           | PASS, 21 cenários HTTP/SDK; `resend` real do SDK, concorrência com uma chamada, repetição imediata 429, 5xx/timeout incertos sem retry, quarto HMAC de e-mail bloqueado e Redis indisponível antes de DB/provider |
| Build, typecheck, lint, formato, inventário e arquitetura | PASS; Next 15.5.24, 174 actions/43 métodos/zero guard pendente, rota com teste, migration safety, DB guard, grafos, madge e observabilidade                                                                       |
| Escopo medido contra o checkpoint O-3b.4                  | 7 arquivos/728 linhas de implementação e testes; harness separado em 1 arquivo/260 linhas; inventário em 1 arquivo/4 linhas                                                                                       |

Esta prova é **local e sintética**. GoTrue/SMTP/Upstash externos, caixa real, template/redirect,
configuração Supabase, Preview, produção e entrega de e-mail permanecem **NOT TESTED**. SMTP não
é idempotente: uma tentativa antiga incerta ainda pode entregar depois; a UI não promete exatamente
um e-mail. A tela de senha/revisão continua em O-3b.5; Track O e Qoro v2 seguem EM DESENVOLVIMENTO.

### 9.12 Evidência O-3b.5 — senha, espera e revisão autenticada locais

A tela de dados aplica o mesmo schema do servidor: 8–72 caracteres, até 72 bytes, maiúscula,
minúscula e número, com símbolo opcional, sem espaço/controle e sem `trim`. O submit valida
dados/aceite/senha, grava o staging e só então chama Auth com a versão confirmada. Senha e captcha
somem depois da tentativa. Resposta Auth ambígua relê `/me` e nunca dispara `signUp` de novo.

`email_pending` oferece login e reenvio explícito com nova digitação de e-mail, novo aceite e
captcha; o request não contém senha. A copy não afirma conta criada ou e-mail entregue. Na rota
autenticada, o client lê primeiro o draft do owner. Sem owner, o navegador original confirma
respostas impessoais e nomes em branco pelo modo `link`; outro navegador redigita tudo pelo modo
`restart`. Ambos exigem aceite e releem o draft depois do POST. Nenhum fluxo cria profile, tenant,
role, plano, trial ou checkout.

| Verificação                              | Evidência local                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes focados                           | PASS, 83/83: filtro compartilhado, staging→Auth, limpeza da senha, reconciliação sem retry, reenvio sem senha, página protegida e link/restart explícitos                        |
| Typecheck, lint e formato                | PASS, exit 0 em `pnpm typecheck`, `pnpm lint` e `pnpm format:check`                                                                                                              |
| Build Next 15.5.24 isolado               | PASS, exit 0, ambiente sintético allowlisted e sem dotenv; `/cadastro` e `/cadastro/continuar` dinâmicas                                                                         |
| Escopo medido contra o checkpoint O-3b.5 | 10 arquivos/1.100 linhas alteradas de implementação e testes; sem dependência, migration, rota pública, configuração externa ou writer fora de onboarding/Auth                   |
| Limite deste checkpoint                  | Chromium integrado, suíte completa, security/E2E/arquitetura e inventário pertencem ao fechamento O-3b.6; provider, SMTP, configuração, Preview e produção permanecem NOT TESTED |

O filtro também corrigiu uma divergência encontrada na revisão: o schema anterior recusava
controles, mas aceitava uma senha com espaços caso as demais classes estivessem presentes. O
validador compartilhado agora cumpre o contrato aprovado de §9.5. Nesse checkpoint, a evidência
continuava **local** e o fechamento integrado ainda pertencia à O-3b.6.

### 9.13 Evidência O-3b.6 — fechamento integrado local

O harness integrado passou pela UI real de cadastro com Next/Chromium, SDKs instalados e Postgres
descartável: senha fraca foi recusada antes do staging; uma resposta perdida do staging preservou o
commit sem reter senha; o reload não expôs PII, senha ou storage; a nova digitação chegou ao Auth uma
única vez; e uma resposta Auth perdida foi reconciliada por `/me`, sem retry. O mesmo navegador provou
cooldown e reenvio explícito único; OTP, página protegida, revisão `link` e recriação `restart` também
foram exercitados pela UI. O cleanup leu zero resíduos e encerrou o Postgres próprio.

| Verificação                                          | Evidência local                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness SQL/Next/Chromium                            | PASS, 24/24 checks; fixture Auth/Redis/HTTP 22/22; exatamente uma chamada ao provider nos casos de resposta perdida; cleanup zero                     |
| Suíte integral com cobertura                         | PASS, 3.747/3.747 em 382 arquivos; linhas 51,58%, branches 81,89%, funções 57,65%, statements 51,58%                                                  |
| Segurança e superfície pública                       | PASS: inventário 174 actions/43 métodos/zero gaps; unit 331; tenant isolation; browser-session 6/6; bundle 165 client files; HTTP 12 vetores/306 requests sobre 153 actions; E2E público 6 aplicáveis + 2 skips condicionais de Turnstile |
| Build e qualidade                                    | PASS: Next 15.5.24 isolado, typecheck, lint e formato                                                                                                 |
| Arquitetura e operação                               | PASS: DB guard 1.259 arquivos/zero achados; 56 elementos/297 arestas/zero ciclos; registry 67/25 + 42 producer-ahead; migrations e observabilidade   |
| Escopo incremental O-3b.6                            | 3 arquivos/186 linhas: harness 140 adições + 33 remoções e correção fail-closed/teste 12 adições + 1 remoção; sob o teto 6/1.400                      |

Com isso, a implementação **local** O-3b.1–6 está fechada. GoTrue/SMTP/Upstash externos, configuração
Supabase, caixa real, migrations compartilhadas, Preview, produção e entrega de e-mail permanecem
**NOT TESTED**. Nenhuma configuração, migration compartilhada, publicação ou chamada externa foi
executada. Track O e Qoro v2 continuam EM DESENVOLVIMENTO para as fatias posteriores e o rollout.

### 9.14 Evidência externa DEV e correção do callback — 16/09/2026

O rollout autorizado ficou restrito ao banco DEV, à branch `preview/auth-email-o3b` e a uma caixa
consentida. As migrations 0099–0101 foram aplicadas e relidas no DEV. O cadastro real concluiu os
quatro requests HTTP (`201/200/200/200`), o SMTP entregou a mensagem e o clique confirmou o usuário
no Auth. Depois do clique, o readback encontrou zero sessões Auth ativas e zero refresh tokens;
o draft permaneceu `email_pending`, sem owner e não consumido.

O clique também revelou uma falha no template instalado: `ConfirmationURL` apontava para o Preview
da branch de pagamentos, protegido pelo login da Vercel e sem as rotas do O-3b. A credencial de
confirmação presente no link era esperada e foi consumida uma única vez; não foi encontrada sessão
reutilizável. O risco observado estava no callback incorreto e no uso do fluxo pronto do provider,
que pode devolver material de sessão ao browser, e não na simples existência do token descartável.

O template versionado passou a montar o link com `RedirectTo`, `TokenHash`, `type=signup` e destino
interno fixo. Signup e resend agora fornecem como `RedirectTo` somente a origem canônica mais
`/auth/confirm`; esse endpoint executa `verifyOtp` no servidor e só então segue para
`/cadastro/continuar`. O template não contém `ConfirmationURL`.

A revisão da telemetria encontrou ainda que o scrubber de URLs reconhecia `token=`, mas não
`token_hash=`. Uma exceção no callback poderia, portanto, enviar a credencial de confirmação ao
Sentry. O redactor agora cobre `token_hash` e possui regressão que mantém apenas rota, tipo e destino
não secretos. O callback não inclui o token nos logs estruturados da aplicação.

| Verificação | Resultado |
| --- | --- |
| Migrations 0099–0101 no DEV e readback de schema/RLS/grants | **PASS** |
| Envio SMTP, recebimento e consumo do primeiro link real | **PASS** |
| Ausência de sessão/refresh token reutilizável depois do clique observado | **PASS**, zero/zero no readback |
| Testes focados do callback/template/redaction | **PASS**, 104/104 |
| Suíte integral | **PASS**, 3.760/3.760 em 384 arquivos |
| Build de segurança, typecheck, lint, formato e regressão SQL/Next/Chromium | **PASS**, regressão 24/24 e cleanup zero |
| Publicação isolada da correção | **PASS**, branch `preview/auth-email-o3b`; alias estável `project-os-git-preview-auth-email-o3b-clinic-os-v2-s-projects.vercel.app` |
| Template corrigido instalado no Supabase e novo clique real até `/cadastro/continuar` | **PASS**, novo cadastro consentido; confirmação e sessão estabelecidas no celular |
| Readback após o callback corrigido | **PASS**, usuário confirmado e autenticado, uma sessão e um refresh token; draft ainda `email_pending`, sem owner e não consumido |
| Reuso do mesmo link no computador | **PASS**, rejeitado como token de uso único já consumido; o intervalo de 27 minutos não prova expiração por TTL |
| Continuação em outro navegador | **PASS**, modo `restart` sem recuperar PII/respostas do cookie anônimo ausente, conforme contrato O-3b.5 |
| Layout móvel da aplicação no Preview | **PASS**, 320 px e 390 px sem overflow horizontal; a sobreposição observada era `vercel-live-feedback`, injetada pelo Preview |
| Cleanup da identidade consentida no DEV | **PASS**, um usuário Auth e um draft pendente removidos; readback zero/zero |

`APP_BASE_URL`, os dois gates de signup, o template **Confirm signup** e o callback permitido ficaram
restritos ao Preview da branch. A repetição com `x-vercel-skip-toolbar` removeu apenas a barra externa
da Vercel e preservou as mesmas dimensões da aplicação; por isso nenhum CSS do Qoro foi alterado para
compensá-la. O primeiro clique no celular consumiu corretamente a credencial de uso único. O segundo
acesso, no computador, precisava falhar mesmo antes do TTL porque replay não é permitido.

Como a confirmação ocorreu em outro navegador, sem o cookie anônimo que criou o staging, o fluxo não
vinculou o draft automaticamente nem recuperou seus dados. A sessão autenticada chegou a
`/cadastro/continuar` e apresentou a redigitação completa por `restart`, que é a proteção prevista
contra associação por e-mail entre navegadores. Encerrada a prova, a identidade do alias e seu único
draft pendente foram removidos do DEV com guards de projeto, estado e cardinalidade; o readback final
foi zero. Produção continua fora deste rollout.

### 9.15 Evidência O-4 — clínica e plano no draft autenticado

O nome da clínica já pertence ao draft verificado da O-3b. A O-4 acrescenta a seleção do plano na
mesma linha pré-tenant, sem criar outra entidade parcial. A migration 0102 adiciona
`selected_plan_id` com FK restritiva para `plans`; grants e RLS permanecem inalterados. O SQL foi
validado primeiro em Postgres 17 descartável com 2.000 linhas preexistentes e ciclo up/down/up. Depois
da prova local, a migration foi aplicada no DEV autorizado e relida no catálogo do banco.

`GET /api/signup/plan` exige a seam de usuário verificado sem profile e devolve somente o draft do
owner, os planos ativos com preço mensal BRL de tabela e o trial autônomo de sete dias. Campanhas de
convite, inclusive `fundador`, ficam fora dessa resolução. `PUT /api/signup/plan` aceita apenas
`{ rowVersion, planId }`: origem, rate limit e corpo limitado são verificados antes da escrita; o
servidor trava e revalida plano/preço ativos, aplica CAS na mesma linha, renova apenas o idle até o
limite absoluto e trata retry da mesma escrita de forma idempotente. Preço, trial, campanha, owner e
clínica enviados pelo browser são rejeitados pelo schema estrito.

A nova tela `/cadastro/plano` reutiliza a seam pré-tenant, mostra a clínica já confirmada e apresenta
cards de plano acessíveis. A confirmação deixa explícito que nenhuma cobrança começou. Esta fatia
não chama Asaas, não abre checkout, não inicia trial e não cria clinic, profile, role, assinatura ou
recursos operacionais; essas transições continuam reservadas às próximas fatias.

| Verificação | Evidência local |
| --- | --- |
| Testes focados de domínio, rota, continuação e UI | **PASS**, 59/59 |
| Suíte integral | **PASS**, 3.800/3.800 em 386 arquivos |
| Build isolado Next 15.5.24 | **PASS**; `/api/signup/plan` e `/cadastro/plano` dinâmicas no manifesto |
| Typecheck, lint integral e formato | **PASS**, exit 0 |
| Inventário e arquitetura DB | **PASS**; 174 actions/45 métodos, zero guard ou teste de rota pendente; 1.264 arquivos/zero achados |
| Migration safety | **PASS**; 0102 aditiva, sem operação destrutiva |
| SQL/HTTP/Chromium integrado | **PASS**, 25/25 em Postgres 17 descartável + Next produzido + Chromium + SDK Auth/Redis; migration 0102 com 2.000 linhas, catálogo de planos, CAS/idempotência, TTL, negativas, cleanup zero e Postgres parado |
| Migration 0102 no DEV | **PASS**; marker `signup-plan-selection`, coluna UUID nullable, FK `ON DELETE RESTRICT`, RLS/FORCE RLS e grants exclusivos de `postgres`/`service_role` relidos; catálogo contém 3 planos mensais BRL de tabela elegíveis |
| Preview O-4, Upstash externo, Asaas e produção | **NOT TESTED**; nenhum deploy, chamada Asaas ou recurso de produção foi alterado |

O fixture Redis do runner fica em processo isolado e implementa o formato real de pipeline/EVALSHA
do SDK instalado. Em falha transitória local, o runner só repete o request depois de provar que banco
e contador do provider não mudaram; por isso o retry do harness não encobre efeito colateral. A matriz
viva está em [`docs/quality/e2e-coverage-matrix.md`](../quality/e2e-coverage-matrix.md) e a execução do
runner está documentada em [`docs/development/testing.md`](../development/testing.md).

---

## 10. Emenda de 17/09/2026 — retomada entre aparelhos e uma pergunta por tela

### 10.1 O problema medido, não suposto

A prova de Preview de §9.14 e [Qoro v2 §35.19](../qorov2.md) terminou com um defeito real de
produto, não de implementação: o cadastro começou no computador, o link de confirmação foi aberto no
celular, e **o celular não tinha o cookie anônimo** `__Host-qoro_signup`. A barreira desenhada em §5.6
e §5.9 fez exatamente o que estava escrito — recusou reencontrar o staging — e a continuação ofereceu
`restart`, exigindo redigitar nome, clínica e as quatro respostas. Ao mesmo tempo, o computador
continuava parado na tela de espera, sem nenhuma forma de saber que a confirmação já tinha ocorrido.

O fundador tratou isso como bloqueio de produto e emitiu o veredito abaixo. Ele **revoga** as partes
de §5.6 e §5.9 que exigiam cookie original para reencontrar o draft; tudo o mais de §5 continua
valendo, em especial os itens 1–5, 7, 8 e 10.

### 10.2 O que foi decidido

| Decisão                                   | Conteúdo                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Entrada do cadastro                       | “Cadastre-se”, no login, passa a ser link para `/cadastro`                                                                            |
| Senha                                     | Símbolo deixa de ser obrigatório: 8–72 caracteres (72 bytes), maiúscula, minúscula e número; símbolos seguem aceitos                 |
| Card lateral de `/cadastro`               | Removido, com o conteúdo do fluxo em coluna única                                                                                     |
| Retomada entre aparelhos                  | O servidor reencontra o draft pelo **e-mail já verificado**, sem cookie anônimo                                                       |
| Sincronização no aparelho original        | A espera reconhece sozinha a confirmação feita em outro aparelho                                                                      |
| Perguntas do perfil                       | Uma pergunta por tela, com progresso, voltar e estado preservado                                                                      |
| Respostas no `/admin`                     | As quatro respostas, nome da clínica, etapa e plano ficam visíveis no painel, sem e-mail, hash, credencial ou id interno              |

### 10.2.a Senha recusada pelo provider — medição e eliminação do alçapão

Afrouxar o filtro local não afrouxa o Supabase, e a primeira redação desta seção tratava isso como
um item de checklist a conferir no painel antes do rollout. A medição mostrou que checklist não
resolveria: o problema não era a configuração que alguém poderia ter posto lá, era o que a rota
fazia com a recusa.

**Readback do projeto DEV `pqhkirrszzpwezdaqrai`, 17/09/2026**, pela Management API e pelo próprio
GoTrue:

| Campo                           | Valor medido | Leitura                                                     |
| ------------------------------- | ------------ | ----------------------------------------------------------- |
| `password_required_characters`  | `""`         | Nenhuma classe exigida — remover o símbolo não quebra nada  |
| `password_min_length`           | `6`          | O filtro do Qoro, com 8, é mais estrito                      |
| `password_hibp_enabled`         | `true`       | **Senha vazada é recusada pelo provider**                    |
| `disable_signup`                | `false`      | Cadastro aberto                                              |
| `mailer_autoconfirm`            | `false`      | Confirmação por e-mail exigida, como o fluxo pressupõe       |
| `security_captcha_enabled`      | `false`      | O desafio é o Turnstile do Qoro; o do provider segue desligado |

O achado original — exigência de símbolo — **não existe neste projeto**. Mas o HIBP ligado produz o
mesmo alçapão com senha real em vez de configuração hipotética. Prova executada contra o DEV, com a
senha literal dos testes de UI do cadastro:

```
POST /auth/v1/signup  password='Senha1234'  ->  422
{"error_code":"weak_password","weak_password":{"reasons":["pwned"]}}
```

`Senha1234` tem maiúscula, minúscula, dígito e nove caracteres: **aprovada por
`signupPasswordSchema`**. Nenhum usuário foi criado e nenhum e-mail saiu — a recusa é avaliada a
partir do valor enviado. E, com `weak_password` dentro de `ACCOUNT_OUTCOMES`, a rota devolvia `200`,
a UI abria a tela de espera, e a pessoa aguardava para sempre um e-mail que nunca existiu.

**A correção tira `weak_password` do conjunto e devolve a reserva.** O argumento de §6 não se aplica
a ela: comprimento, classes e HIBP dependem só da senha enviada, o GoTrue os avalia antes de olhar a
conta, e um endereço já confirmado recebe sucesso ofuscado — nunca `weak_password`. Diferenciá-la não
diz nada sobre existência de conta.

Devolver a reserva importa tanto quanto: tratada como `uncertain`, a tentativa seria gasta e a pessoa
cairia no cooldown de 60 s do reenvio por ter escolhido uma senha comum. `abortSignupAuthAttempt`
faz o CAS inverso do `reserve` — de (`email_pending`, `reserved`, versão reservada) para
(`identity_pending`, tentativa nula) — e só aceita a reserva `initial`, porque reenvio não manda
senha e reserva finalizada pode ter enviado e-mail. Os CHECKs permitem: `identity_pending` exige
staging, aceite e `consumed_at IS NULL`, tudo preservado, e `num_nonnulls(...) IN (0, 3)` da 0100
aceita a tentativa toda nula. **Nenhuma migration.** Nenhum prazo é tocado: abortar não é atividade
humana nova. Se o CAS de devolução perder, a resposta volta a ser `503` — o caminho conservador, que
não afirma envio sobre um estado que não voltou.

O efeito arquitetural é maior que a correção: **a dependência do painel desaparece**. Qualquer que
seja a política do provider, hoje ou depois de alguém mexer nela, a recusa vira erro acionável na
tela em vez de espera silenciosa. O HIBP continua ligado, e deve continuar — o defeito era engolirmos
o veredito dele, não ele existir.

Limite honesto: o projeto de **produção `shlcbxawrxuaebazuiue` não foi lido**. Não é mais um gate de
rollout, porque a correção não depende da configuração; continua valendo como informação útil antes
de publicar.

### 10.3 Vínculo pela identidade verificada — por que é seguro

`claimSignupDraftByVerifiedEmail(userId, email)` roda **no servidor**, dentro de uma transação, e a
única entrada que aceita vem de `resolvePreTenantOnboarding()`, ou seja, de `getUser()` com
`email_confirmed_at` presente e usuário não anônimo. Nada vem do cliente: nem e-mail, nem id, nem
versão, nem cookie. O candidato é procurado por `email_hash = hashEmail(<e-mail verificado>)` entre
linhas `email_pending`, sem owner, não consumidas e dentro do teto absoluto; é travado com
`FOR UPDATE`, ordenado pela tentativa mais recente, e vinculado por CAS na mesma transação
(`status`, `auth_user_id`, `consumed_at`, `row_version`). O `UNIQUE` de `auth_user_id` resolve
disputa entre abas, e ownership continua sem poder mudar de A para B.

O filtro por `auth_attempt_state` foi deliberadamente removido do candidato. A constraint da
migration 0100 já exige tentativa em `email_pending`, e uma reserva cuja finalização se perdeu
(`reserved`) descreve justamente o envio que pode ter chegado. Quem abre a continuação carrega um OTP
válido daquele endereço: recusar a reserva órfã devolveria a redigitação que esta emenda elimina.

O que se perde em relação a §5.6: os nomes do staging passam a ser carregados sem uma segunda
confirmação explícita. O risco residual é alguém iniciar um cadastro com o endereço de outra pessoa e
essa pessoa confirmar o e-mail — cenário que já existia antes desta emenda, porque `signUp` cria a
conta com a senha de quem submeteu, e que §6 trata com resposta uniforme. O vínculo do draft não
amplia esse risco: não cria clínica, tenant, papel, plano, trial nem cobrança, e a tela de
continuação mostra os dados recuperados antes de qualquer passo seguinte.

### 10.4 Onde o vínculo roda, e onde não roda

O vínculo **não** acontece no render de `/cadastro/continuar`. Escrever durante o render ficaria fora
do rate limit, engoliria a falha e voltaria a rodar a cada carga da página. Ele roda dentro de
`GET /api/signup/draft`, que já exige a seam pré-tenant e os limites por IP e por HMAC do usuário, e
só depois de a leitura do próprio draft devolver `gone` — quem já é dono paga apenas o `SELECT`.

Isso emenda a linha de §9.3 que dizia que o GET “não escreve”: ele passa a poder executar **um**
vínculo idempotente. Esse vínculo não renova prazo nenhum — fixa `idle_expires_at` no
`absolute_expires_at` que a linha já tinha — e o GET ganhou recusa de Fetch Metadata `cross-site`,
para que navegação de terceiro não dispare o efeito. Uma indisponibilidade do vínculo responde `503`;
nunca `410`, que significaria “não há cadastro”.

Quando o vínculo **falha**, o GET relê o draft antes de decidir. Duas abas do mesmo usuário abrindo a
continuação ao mesmo tempo fazem a perdedora receber `conflict` — ou `gone`, porque `FOR UPDATE`
reavalia a linha já vinculada e ela deixa de casar com o predicado. Nos dois casos o cadastro existe:
responder `410` ali mandaria a pessoa redigitar o que acabou de ser recuperado. Só a requisição que
efetivamente vinculou limpa o cookie.

### 10.5 O modo `link` deixa de existir

Com o vínculo por e-mail verificado cobrindo todo candidato vivo, `POST /api/signup/draft` no modo
`link` virou caminho sem saída: quando o GET não vincula é porque o hash não bate, e nesse estado o
`link` só poderia responder `409`. A tela chegava a prometer “Encontramos as respostas deste
navegador” para um envio que nunca concluiria. O modo foi removido do schema, do writer, da rota e da
tela, com aprovação explícita do fundador por ser contrato público.

O corpo de `POST /api/signup/draft` passa a ser um objeto único e estrito
`{ ownerName, clinicName, answers, accepted: true }`, sem `mode`, sem `rowVersion` e sem token. Ele
cobre o único caso restante: não havia nada a recuperar, e a pessoa reescreveu tudo. O cookie anônimo
é limpo tanto nesse POST quanto no GET que vincula.

### 10.6 Prazos do draft vinculado

Um draft já vinculado não tem mais credencial anônima a limitar, e a leitura autenticada não renova
nada. Por isso `idle_expires_at` passa a nascer igual a `absolute_expires_at` também no recomeço, e a
escolha de plano deixou de tocar no prazo. A versão anterior encurtava a vida do draft a cada
`PUT /api/signup/plan` — `least(now() + 15 min, absoluto)` — e podia apagar, em quinze minutos e sem
renovação possível, o cadastro que a pessoa tinha acabado de redigitar. O teto absoluto de 60 minutos
de §4 permanece intocado e continua sendo o único prazo dessas linhas.

### 10.7 Espera no aparelho original

A tela de espera relê `GET /api/signup/sessions/me`, que passou a reconhecer `email_verified` para o
token do navegador original, devolver apenas esse estado — sem respostas nem PII — e limpar o cookie
consumido. O intervalo é de 20 s com teto de 30 leituras (10 min): `/me` tem limite de 120 por 15 min
**por IP**, compartilhado com outras abas e com quem mais estiver atrás do mesmo NAT, e a versão
inicial de 10 s estouraria esse limite antes da metade do TTL, passando a receber `429` justamente
enquanto a pessoa aguarda. Esgotado o teto, recarregar a página mostra o resultado. Um `410` durante a
espera encerra a espera em vez de insistir contra o limite.

### 10.8 Perguntas e painel

As quatro perguntas continuam as mesmas, fechadas e impessoais; muda só a apresentação: uma por tela,
com “Pergunta N de 4”, barra de progresso, botão Voltar e escolha preservada ao navegar. Navegar não
escreve no banco — a gravação continua sendo um único `POST /answers` na quarta tela, porque a
constraint `answers_all_or_none` não admite linha meio respondida. O card lateral saiu e o conteúdo
ficou em coluna única.

No `/admin`, `listSignupIntakes` lê apenas cadastros ainda válidos e devolve id, nome da clínica
quando informado, etapa, as quatro respostas, o código do plano escolhido e o instante da última
atualização. E-mail, `email_hash`, token, tentativa, senha e `auth_user_id` ficam fora do DTO e da
tela. O guard `super_admin` + AAL2 e a natureza read-only do painel não mudam.

### 10.9 Evidência desta emenda

Números da reexecução integral de **18/09/2026**, já com o portão de entrada da §10.10 e com O-5/O-6
(§35.24 do qorov2) no lugar. Eles substituem a medição parcial do dia anterior (772 testes focados, 24
checks do runner), que era de uma execução intermediária desta mesma emenda, não de outro escopo. O
runner cresceu de 25 para 27 checks porque O-5 acrescentou a migration 0103 e a disputa de CAS do
billing — nada aqui foi reclassificado, só remedido.

| Verificação                                    | Resultado                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suíte integral do projeto                      | **PASS**, 3.903/3.903 em 390 arquivos, 0 falha e 0 skip, exit 0, 180,7 s; cobertura 52,02 / 81,95 / 57,83 / 52,02 sobre pisos 29/74/41/29                     |
| Runner `signup-regression --browser`           | **PASS**, 27/27 checks e 22/22 provas de Auth/HTTP/browser, 0 FAIL; migrations 0099–0103 up/down/up vazio e com 2000 linhas, RLS/FORCE/grants preservados     |
| Limpeza do runner                              | **PASS**, readback zero de fixture e cluster Postgres encerrado                                                                                              |
| Typecheck, lint, formato e `git diff --check`  | **PASS**, exit 0                                                                                                                                             |
| Gates de arquitetura, banco e observabilidade  | **PASS** — `security:inventory --check`, `arch:db-check` (1265 arquivos, 0 findings), `madge --circular`, `check:migrations`, `check:observability` (19 crons), `check:registry:strict` (catalog 67 ⇔ registry 25) |

O ambiente do runner é, nas palavras do próprio artefato
(`dist/signup-regression/auth-http-results.json`), "loopback synthetic Auth/Redis, real installed SDK
and disposable Postgres". **Nenhuma dessas 22 provas é prova de provider externo** — o SDK é real, o
Auth do outro lado não é.

Limites desta emenda, sem exceção: Preview, produção, GoTrue/SMTP reais, Upstash externo, Asaas e
qualquer configuração de painel permanecem **NOT TESTED** aqui. O portão da §10.10 está provado em
unit, não no browser: exercitá-lo lá pediria um segundo build do Next com a variável desligada.
Nenhuma migration foi criada ou aplicada — a emenda não muda schema. Nenhum commit, push ou deploy foi
executado.

### 10.10 Consequência não prevista: a entrada passou a existir antes da saída

O item 3.1 do veredito — "Cadastre-se" vira link — foi implementado como pedido, e por isso mesmo
criou um risco que não existia antes. Enquanto era um `<span>` órfão, `/cadastro` não tinha como ser
alcançado por quem não digitasse a URL. Com o link vivo, a página vira porta de entrada real na tela
mais visitada do produto.

O problema é o que há do outro lado. **O funil não tem saída.** Ele termina em
`/cadastro/plano` com "Plano salvo — a escolha foi vinculada ao cadastro, nenhuma cobrança foi
iniciada", e para por ali: `resolvePreTenantOnboarding` devolve `pretenant` para sempre, porque nada
cria profile ou tenant a partir de uma `signup_session`. `provisionTenantFromInviteTx` existe, mas
exige `clinic_invites` — é a saga do convite, não a do cadastro autônomo. O-5 (billing), O-6
(provisionamento) e O-7 (onboarding) não existem em código.

Sem portão, publicar esta emenda entregaria a um visitante quatro perguntas, uma conta verificada por
e-mail real e um beco sem saída — mais uma linha em `signup_sessions` por visita, já que
`SignupQuestions` faz bootstrap no `useEffect` de montagem.

**Decisão:** `/cadastro` só abre o funil quando `SIGNUP_ENABLED` **e** `SIGNUP_IDENTITY_ENABLED`
estiverem ligados; fechado, renderiza uma tela de indisponibilidade que não monta `SignupQuestions` —
logo, não cria linha. `SIGNUP_IDENTITY_ENABLED` já nasce desligado, então **produção fica fechada por
default**, sem depender de alguém lembrar de configurar. `SIGNUP_ENABLED` é novo e nasce ligado: é o
kill switch de operação do §21.20, que fecha a entrada (página e `POST /api/signup/sessions`) sem
tocar em login, sessão viva ou tenant existente. Os dois portões são server-only e não vão ao bundle.

Por que dois e não um: eles respondem a perguntas diferentes. "A fatia seguinte já existe?" é rollout,
nasce fechado e abre quando o código existe. "Preciso parar a aquisição agora?" é incidente, nasce
aberto e fecha por decisão. Colapsar os dois num só obrigaria a escolher qual significado perder.

A tela fechada não diz qual portão fechou — para quem chega, o fato útil é que não dá para criar conta
agora e que o login continua funcionando. Operação e visitante têm necessidades diferentes de
informação, e a página é do visitante.

O que este portão **não** é: defesa. Rate limit por IP, teto de sessões vivas, risco/Turnstile e
janitor continuam sendo o que segura abuso. Um portão em variável de ambiente segura decisão, não
adversário.

## 11. Emenda de 23/09/2026 — confirmação e handoff de credencial

### 11.1 Precedência e ameaça que muda a decisão

Esta emenda preserva as §§1–10 como histórico, mas **revoga** a conclusão residual da §10.3 de que
vincular o draft após o clique não ampliava o risco de alguém iniciar o cadastro com e-mail alheio.
No desenho anterior, o iniciador escolhia a senha antes da prova da caixa postal. Quando a vítima
clicava no link legítimo, a aba anônima do iniciador era vinculada e avançava. A vítima provava o
e-mail; o sistema entregava a continuação e a senha a outra ponta.

Controle da caixa postal e autorização da aba iniciadora são provas diferentes. A primeira não pode
implicar a segunda. Por isso também ficam substituídos, para o fluxo vigente, o avanço automático da
§10.7 e as partes das §§9.9, 9.12 e 37.2–37.5 do qorov2 que pressupunham senha criada antes do clique
ou vínculo suficiente para abrir o plano.

### 11.2 Contrato vigente

1. **Conta passwordless e pendente.** Depois da validação local e do HIBP, o servidor usa Admin
   `createUser` sem `password`, com `email_confirm: false`. `app_metadata` recebe marcador Qoro,
   versão, `signup_ref` exato e `password_state=pending`. Não existe senha Auth utilizável nessa
   etapa.
2. **E-mail sob controle do repositório.** Primeiro envio e reenvio usam Admin
   `generateLink({ type: 'recovery' })`; o provider devolve o token, mas não envia a mensagem. Assunto,
   HTML, texto e URL vivem no módulo do Qoro e o Resend faz o transporte. Template e redirect do
   painel Supabase deixam de ser dependência do cadastro. O token, o tipo e a referência ficam no
   fragmento do link, que o HTTP GET não transmite. `/auth/confirm` responde com uma ponte HTML
   mínima, `no-store` e `no-referrer`; o navegador extrai o fragmento e autoenvia POST. O endpoint de
   verificação recebe a credencial no corpo, fora do request target, do access log e do `Referer`.
   Mensagens antigas com query permanecem compatíveis por um ramo transitório que também não consome
   no GET; ele não oferece sigilo retroativo do request target já recebido e deve ser removido depois
   do TTL desse estoque.
3. **Duas provas na mensagem.** O corpo contém o link e um código decimal de oito dígitos. O código é
   derivado com HMAC da referência e da época daquela reserva; não aparece na URL, não é persistido em
   claro e é comparado em tempo constante.
4. **Callback restrito.** O link cria sessão verificada e termina em `/cadastro/confirmado`. Para uma
   referência explícita, o servidor valida primeiro usuário, e-mail e marker pendente; reivindica no
   banco somente aquele `signup_ref`; e só depois reata o `app_metadata` ao vencedor. Perder a
   reivindicação não pode deixar Auth apontando para a referência perdedora.
5. **Clique não conclui credencial.** A página confirmada diz apenas “E-mail confirmado”. Ela não
   instala senha, não abre plano ou checkout e não concede à aba original mais do que o estado
   `email_verified`.
6. **Handoff explícito.** A aba original chama `POST /api/signup/sessions/continue` com corpo estrito
   contendo `rowVersion`, e-mail, senha e código. O servidor exige e-mail verificado, marker Qoro
   pendente, referência exata, draft vivo, owner compatível, versão atual e código da época atual.
7. **Política de senha no ponto de efeito.** HIBP roda antes do primeiro efeito em Auth/Resend e
   novamente imediatamente antes do CAS de credencial. Rate limit e reserva transacional no banco
   precedem essa fronteira. Senha vazada responde como escolha inválida; HIBP
   indisponível falha fechado. Um código incorreto é recusado antes dessa consulta externa. O contrato
   local continua 8–72 caracteres/bytes, sem espaço, com maiúscula, minúscula e número; símbolo é
   opcional.
8. **Um vencedor.** O CAS incrementa a época/`row_version` antes de a Admin API instalar a senha.
   Somente o vencedor pode marcar `password_state=set` e autenticar. Retry depois do marker `set` não
   sobrescreve a senha. Falha parcial precisa de recuperação/reconciliação, nunca de segundo avanço
   cego.
9. **Gate posterior.** Páginas e APIs de draft autenticado, plano e checkout exigem a seam
   `ready-owned`: sessão válida, e-mail verificado, pré-tenant Qoro, `password_state=set`, referência
   Auth idêntica à realmente possuída no banco e `auth_attempt_state=completed`. A seam permissiva
   continua limitada a callback, handoff e recovery, onde a credencial pendente é o próprio caso de
   uso. Estado parcial ou divergente não alcança leitura do draft nem billing.
10. **Rotação só pelo dono da tentativa.** O reenvio da mesma sessão fixa uma nova época por CAS,
    gira token e código e relê estado, tipo, versão, época e validade antes de chamar o Resend. Um
    segundo draft para o mesmo e-mail não pode substituir um `signup_ref` ainda vivo: o servidor
    confere referência, HMAC do e-mail, usuário quando reivindicado e expiração absoluta. Enquanto a
    referência original estiver viva, responde de forma ofuscada e não envia outra mensagem; quando
    estiver ausente ou expirada, um novo draft pode prosseguir. Se a criação inicial terminou incerta
    e a busca Auth exata prova ausência, somente a reserva do próprio draft pode criar explicitamente
    a conta passwordless no reenvio; isso não instala senha nem substitui o handoff.
11. **Reparo depois do OTP.** Se a verificação consumir o OTP e validação, claim ou binding falhar por
    indisponibilidade, o callback grava um grant HMAC de 15 minutos em cookie HttpOnly. O grant contém
    somente usuário, referência e expiração, não entra na URL/DOM e só é aceito por
    `/cadastro/confirmado` para o mesmo usuário autenticado. A página repete validação, claim e binding
    de forma idempotente; falha de autoridade continua recusada. Antes do claim, a referência assinada
    pelo callback vence um marker pendente antigo; depois do claim, a referência possuída no banco
    volta a ser a autoridade.
12. **Recovery discriminado, inclusive órfão e concorrente.** O grant assinado distingue `profile`,
    `pretenant` e `pretenant_orphan`. Profile consome `claims_version` por CAS antes da escrita Auth;
    com draft, `signup_ref` e época esperada consomem o CAS da credencial; sem draft vivo, somente uma
    conta confirmada com marker exato `password_state=set` recebe grant órfão, serializado por advisory
    lock. Nesse caso o epoch é `Auth.updated_at`, e id, e-mail, confirmação, marker e epoch são relidos
    na Admin API imediatamente antes da escrita. Só uma troca concorrente vence; o sign-out global
    encerra as sessões antigas.
13. **Lookup exato e indexado.** A busca administrativa por e-mail usa o filtro oficial do GoTrue,
    limita o resultado e exige igualdade normalizada exata. Resposta malformada, ambígua ou
    indisponível falha fechado; o cadastro não pagina toda a base a cada envio/reenvio.
14. **Legado markerless não é autoridade.** Conta antiga ainda não confirmada só pode ser adotada
    quando a tentativa exata continua reservada, o e-mail coincide e não há profile, convite,
    banimento ou marker Qoro; o marker só é escrito depois de OTP e claim. Conta antiga já confirmada
    só migra para `password_state=set` depois que o login com a senha conhecida foi aceito.
15. **Concordância depois do claim.** O mesmo marker `set`, a mesma referência possuída e credencial
    `completed` são idempotentes; marker `set` para outra referência continua recusado e nunca é
    reparado silenciosamente. Se o commit SQL ocorreu e a atualização Auth falhou, o repair grant pode
    repetir o binding esperado. Se, numa adoção, a atualização Auth ocorreu e o commit SQL falhou, o
    gate `ready-owned` bloqueia login, leitura e billing; repetir o mesmo código conclui a transferência
    no banco sem instalar a senha novamente.
16. **Adoção segura de segundo draft.** Um segundo draft para o mesmo e-mail não gira o link vivo nem
    recebe mensagem. O código da tentativa viva pode transferir a autoridade para os dados do segundo
    draft, sob CAS e transação. Nenhum dos dois estados parciais é tratado como pronto.
17. **Resultado externo não enumera conta.** Depois que o envio começou, `auth` e `resend` respondem
    com o mesmo envelope `200` para entrega aceita, conta ofuscada e efeito incerto. O banco mantém
    `uncertain`; a finalização do Resend só aceita `email_pending + reserved` ou
    `email_verified + completed` do mesmo usuário.

### 11.3 Dados, interface e falhas

O banco continua sem e-mail bruto, senha, **token ou código em claro**. `signup_sessions` guarda HMAC
do token anônimo e do e-mail, além do estado/época necessários ao CAS; a senha permanece apenas na
memória da aba até o handoff. Depois de
F5, a pessoa redigita e-mail e senha. O código pode continuar válido somente até uma nova reserva,
consumo ou expiração **da mesma sessão**; criar outro draft não invalida o link/código ativo.

`email_pending` mostra espera e reenvio discreto. Na aba ainda viva, o e-mail em memória torna o
reenvio um clique; depois de F5, revela-se somente o campo de e-mail. Ao observar
`email_verified`, a aba passa para a tela de código. O controle de visibilidade da senha existe tanto
na coleta inicial quanto na redigitação. Só o sucesso do handoff navega para `/cadastro/plano`.

Respostas públicas continuam sem enumerar existência ou estado de conta. Os limites por IP, sessão e
identidade derivada permanecem. `401/403` negam prova ou binding; `409` exige reconciliação da versão;
`410` encerra draft expirado; `422` pede outra senha; indisponibilidade de Auth, DB, HIBP ou resultado
incerto devolve falha conservadora sem afirmar envio, confirmação ou instalação.

A ponte não promete imunidade a todo scanner de e-mail. Scanner HTTP que só faz GET não vê o
fragmento e não consome o OTP. Scanner que executa JavaScript pode autoenviar o POST; isso permanece
risco residual explícito. Single-use, rotação por reenvio e o código separado evitam que o consumo do
link baste para instalar a senha, mas não garantem que o clique humano nunca encontre um link já
consumido.

### 11.4 Evidência exigida e estado atual

Esta emenda não cria migration. Ela reutiliza `auth_attempted_at`, `row_version`, estado do draft e
`app_metadata`; qualquer mudança futura de schema exige nova ADR/migration, não edição retroativa.

| Prova | Estado em 25/09/2026 |
| ----- | -------------------- |
| Unit/integration do binding, callback, envio, reenvio, continuação, recovery, gate e UI | **PASS 238/238 em oito arquivos** — inclui ready-owned, adoção parcial, recovery concorrente, resposta uniforme, repair grant, liveness, lookup exato e legado seguro |
| Suíte integral, typecheck, lint e build | **PASS** — 4.378/4.378 em 414 arquivos, exit 0, 185,27 s; `tsc --noEmit`, ESLint completo e Next 15.5.24 otimizado, exit 0 |
| Inventário e gates de segurança | **PASS** — 180 actions/49 métodos/16 props/254 env/9 públicos, zero gaps; browser-session 7/7 em 45,5 s; tenant, bundle, HTTP, DB/arquitetura, migrations, observabilidade e registry, exit 0 |
| Regressão HTTP/SQL do cadastro | **PASS 29/29**, incluindo transferência de ownership e cleanup zero |
| E2E do contrato atual contra Supabase DEV + Resend | **PASS 5/5**, Chromium, 9,4 min contra `next dev`, um worker/zero retry; cache efêmero E2E-only de 15 min/64 entradas; limpeza terminou sem conta, linha, fixture ou lock residual |
| Billing/provisionamento nas provas próprias | **PASS** — Asaas 6/6, cleanup 5/5; webhook/provisionamento 12/12, cleanup 2/2; não é atribuído ao spec de confirmação |
| Gate de sessão no navegador | **PASS 7/7** |
| Preview da revisão vigente | **PASS 5/5**, 4,9 min no SHA `9608e1e`, no alias protegido da branch, Chromium, um worker/zero retry; fingerprint Auth + DB DEV; cleanup Auth/DB/fixture/lock zero |
| Merge/publicação | **PASS técnico** — PR #15 mesclado em `193ce31`; Vercel Production `Ready`; GET `/login` e `/cadastro` 200, sem escrita |
| Produção | **NOT TESTED** e fora do alvo de escrita desta validação |
| Inbox consentido | **NOT TESTED**; aceitação do Resend não prova chegada/renderização |
| Billing/Asaas pelo E2E de confirmação | **NÃO COBERTO** — o spec encerra ao abrir `/cadastro/plano` |

O E2E DEV já provou: link isolado não avança; pendente não acessa plano/checkout; código errado e
época anterior falham; reenvio da mesma sessão muda link/código; segundo draft não gira a referência
viva nem recebe mensagem; legado markerless seguro; senha não autentica antes e autentica depois do
CAS; refresh exige redigitação; cleanup Auth/DB/fixture/lock termina zero. O comando canônico é
`npx tsx scripts/run-signup-confirmation-e2e.ts`, com os guards descritos na matriz Track O. A mesma
prova também passou 5/5 no Preview protegido, com fingerprint do ambiente DEV e limpeza zero.

## 12. Senha escolhida após a confirmação, com continuação no mesmo aparelho (31/10/2026)

Decisão do founder: pedir a senha uma única vez e oferecer uma continuação clara após confirmar
o e-mail. Esta seção substitui a coleta inicial de senha e a página de confirmação sem ação
descritas na seção 11; preserva os controles de ownership, validade, CAS e anti-fixação.

1. A etapa de dados solicita nome do titular, nome da clínica, e-mail e aceite. Ela não pede,
   transmite nem retém senha. O primeiro envio continua criando uma conta Auth **sem senha**.
2. O link do e-mail mantém a ponte fragmento → POST, OTP de uso único e referência exata. Depois
   da confirmação, `/cadastro/confirmado` apresenta somente a criação da senha e a ação **Criar
   senha e escolher plano**. Não exige repetir o e-mail nem digitar o código nesse aparelho.
3. `POST /api/signup/password` aceita somente a senha. Antes de ler o corpo, exige origem confiável,
   sessão Auth autoritativa com e-mail confirmado e ausência de profile. Aplica o limite existente
   por IP/HMAC do usuário. O usuário e a referência nunca são escolhidos pelo navegador.
4. A referência Auth deve corresponder ao draft vivo que pertence ao mesmo usuário/e-mail. O
   servidor relê o usuário na Admin API, verifica o marker `pending`, consulta a política de senha
   e vazamentos e reserva o **mesmo CAS** usado pelo handoff anterior. Só o vencedor pode instalar
   a senha e promover o marker para `set`.
5. Falha ambígua mantém a reserva `uncertain`. Um marker já `set` permite finalizar o SQL e tentar
   autenticar com a mesma senha, mas **nunca sobrescrever** a senha. Sucesso requer nova sessão
   HttpOnly e a pós-condição ready-owned antes de responder `200` e abrir `/cadastro/plano`.
6. A aba anônima original continua sem autoridade para usar a nova rota, mesmo após observar
   `email_verified`. Como alternativa, ainda pode usar o código de oito dígitos do corpo do e-mail
   e escolher a senha pela rota anterior. Após F5, redigita também o e-mail. O link sozinho não
   libera a aba de quem iniciou um cadastro com o e-mail de outra pessoa.
7. A página confirmada não pede senha novamente quando a credencial já está pronta: oferece
   **Escolher plano**. Conta existente com profile não pode usar essa rota para trocar senha.
   Link/draft expirado não é revivido; indisponibilidade e rate limit falham de modo conservador.
8. Durante o rollout, `/sessions/auth` aceita a senha opcional de clientes antigos e mantém sua
   validação quando presente. O cliente novo a omite. Sem alteração de schema ou migration.
9. Não persistir senha em estado global, local/sessionStorage, staging, logs, traces ou artifacts.
   O template `signup-confirmation.v4` orienta a continuação no próprio link e explica o código
   apenas como alternativa para a aba original. O risco residual de scanner com JavaScript
   consumir OTP permanece; o formulário exige uma ação explícita para instalar a credencial.

Evidências específicas, ambiente, comandos e limites desta alteração ficam em
[validação da senha única](../quality/cadastro-senha-unica-2026-10-31.md). Evidências da seção 11
são históricas e não constituem aprovação automática do fluxo alterado.
