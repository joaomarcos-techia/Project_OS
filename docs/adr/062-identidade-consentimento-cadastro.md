# ADR-062 — Identidade, consentimento e nome da clínica no cadastro

- **Status:** O-3a Accepted local, aprovado em 15/09/2026 pelo fundador (“aprovo”) e validado.
  Contratos O-3b de §9 aprovados para execução local sequencial; O-3b.1–6 validados localmente
  e implementação local O-3b encerrada. Rollout DEV autorizado em 16/09/2026: migrations
  0099–0101, entrega SMTP e confirmação de uma conta real verificadas; correção do callback
  server-side publicada e verificada de ponta a ponta no Preview isolado.
- **Data:** 2026-09-15.
- **Atualizado:** 2026-09-16.
- **Checkout de rollout:** branch `preview/auth-email-o3b` em worktree isolada; base histórica
  `redesign/qoro-ui-v4` no commit `a9621e89f4fcd159843e33699272b091c0dfae1d`.
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
| Senha, somente O-3b       | 8–72 caracteres, até 72 bytes, com ASCII maiúscula, minúscula, número e símbolo aceito pelo Supabase; sem espaço, controle ou `trim` | Nunca em staging, metadata, logs, URL, outbox, storage ou DTO                                                             | Sempre redigitar; não restaurar                                   |

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

O janitor existente faz DELETE por vencimento de qualquer prazo, em lotes de **500**, até
**10 lotes** por execução. Provar com nomes/e-mail hash sintéticos que também remove os novos
campos e linhas consumidas/vinculadas vencidas, sem apagar as vivas. Bloqueio impede acesso
imediatamente e não prolonga retenção. Não preservar PII para acompanhamento comercial.

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
6. Ownership requer confirmação explícita de dados/aceite pelo usuário verificado em POST
   same-origin. Com cookie original vivo e hash compatível com seu e-mail, revisar/reenviar dados
   e respostas antes de ligar a linha. Hash só confere consistência; não autoriza claim sozinho.
   Não carregar automaticamente nomes submetidos por terceiro na conta confirmada.
7. Propor `auth_user_id` único, escrito somente pelo servidor após essas provas, junto de
   `consumed_at`, `email_verified` e incremento de versão **na mesma transação/CAS**. Unique
   resolve duas sessões disputando o mesmo usuário. Ownership nunca muda de A para B. Consumir
   o bootstrap remove sua autoridade; limpar cookie na resposta, sem depender da limpeza para
   impedir replay. Provider I/O sempre fora da transação, conforme ADR-011.
8. **Emenda proposta ao instante de consumo de ADR-060 §5/Qoro v2 §21.6:** OTP estabelece sessão
   Auth verificada; a confirmação autenticada e explícita do draft conclui vínculo/consumo.
   Nenhum passo posterior aceita esse usuário/draft antes do consumo. Evita atribuir PII de uma
   submissão anônima a uma conta existente só porque ela confirmou o e-mail.
9. No outro navegador, não buscar staging sem owner pelo HMAC de e-mail/UUID de `signUp`, nem
   transferir cookie. Depois de autenticar, retomar somente draft já pertencente ao próprio
   `auth_user_id`; se não existir, colher novamente as quatro respostas, nomes e aceite e criar
   um draft verificado, já consumido, sem nova credencial anônima. E-mail vem de `getUser()`.
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

**Filtro Qoro aprovado pelo fundador:** mínimo oito caracteres, ao menos uma letra maiúscula,
uma minúscula, um número e um caractere especial. Aplicar no servidor antes de Auth e reutilizar
o mesmo validador na UI O-3b.5. As classes obrigatórias e os símbolos seguem os conjuntos
publicados pelo Supabase; espaço/controle não é aceito. O teto é 72 bytes, limite do Auth, sem
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
minúscula, número e símbolo do conjunto aceito pelo Supabase, sem espaço/controle e sem `trim`. O submit valida
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
