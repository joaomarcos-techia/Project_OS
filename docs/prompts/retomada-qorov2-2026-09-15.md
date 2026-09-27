# Prompt de retomada — Qoro v2, checkpoint de 15/09/2026

> Fotografia anterior a O-3a. O fundador aprovou e a execução local posterior está em
> [Qoro v2 §35.10](../qorov2.md) e [ADR-062](../adr/062-identidade-consentimento-cadastro.md).
> Para o próximo passo, prevalece esse checkpoint; O-3b permanece Proposed.

Você é o engenheiro principal do Qoro/ClinicaOS, SaaS brasileiro de gestão de clínicas em
Next.js App Router, Supabase/Postgres, Asaas, Meta WhatsApp e Gemini. Trabalhe em português do
Brasil no repositório `C:\dev\ClinicaOS_V2`. Continue o desenvolvimento por fatias verificadas.
O Qoro v2 está **EM DESENVOLVIMENTO**; não é uma entrega final nem está liberado para go-live.

## 1. Primeiro, confirme o checkout e leia as fontes atuais

Este checkpoint foi feito na branch `redesign/qoro-ui-v4`, HEAD
`a9621e89f4fcd159843e33699272b091c0dfae1d`, com mudanças locais ainda sem commit/push.
O remoto é `https://github.com/joaomarcos-techia/Project_OS.git`. A `main` remota consultada
estava em `93da840f620816e0fdf3300dd82a25f97c01118c`; seu CI verde não valida este working tree.
Reconfirme `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, remoto e
diff antes de concluir qualquer coisa. Se esses dados mudaram, atualize o checkpoint.

Há mudanças de cadastro/segurança e trabalho anterior de UI no mesmo checkout. Preserve
`.claude/`, `financeiro.md`, `novaui.md`, prompts e scripts temporários de refunds, assim como
qualquer alteração alheia. Não use reset, limpeza geral, stage-all ou cherry-pick de lote misto.
Inspecione hunks e arquivos novos; evidência de outro worktree não prova este checkout.

Leia, nesta ordem:

1. [qorov2](../qorov2.md), bloco canônico e §§0.1/0.6/0.9, 21, 29, 31.4, 32, 33 e 35.4–35.8.
2. [ADR-060](../adr/060-sessao-anonima-de-cadastro.md), especialmente §1.c/§1.c.1/§1.d,
   contratos de TTL/CAS/consumo, matriz endpoint × limites, rate limiting e evidências datadas.
3. [ADR-053](../adr/053-cadastro-autonomo-seguro.md), ainda **Proposed**, com precedência explícita
   das decisões posteriores da ADR-060. Não trate seu fluxo completo como código instalado.
4. [ADR-037](../adr/037-server-authoritative-session.md), incluindo a emenda de 14–15/09;
   [ADR-019](../adr/019-consultorio-chamadas.md), emenda de polling;
   [segurança](../security/README.md), [riscos](../security/riscos.md),
   [modelo](../security/model.md) e [Discovery Log](../discovery-log.md).
5. [runbook de recuperação](../runbooks/disaster-recovery.md), checkpoint de 15/09, e
   [workflow Git](../engineering/git-workflow.md).

Precedência: código real → banco observado → testes/evidências → documentação canônica →
roadmap/histórico. Preserve fotografias históricas como datadas; não anuncie provider atual por
uma prova antiga. Não refaça D126–D131 nem reintroduza cookie legível para recuperar Realtime.

## 2. O que está implementado e validado localmente

D126–D131 foram corrigidos e a tela `/cadastro` das **quatro perguntas impessoais** foi construída.
Os handlers têm corte durante leitura por bytes, validação estrita, resposta uniforme para cookie
malformado, diferenciação entre sessão morta e CAS e testes próprios de `/answers`.
Criação aceita até 16 KiB para o token Turnstile; respostas têm teto de 1 KiB. Não restaure o teto
antigo incompatível na criação. Use §35.5 e testes como fonte para os detalhes.

O cadastro atual coleta profissionais, atendimentos semanais, ferramenta atual e canal declarado:
quatro grupos radio, 17 opções fechadas. Não coleta identidade, consentimento, nome da clínica,
checkout ou provisionamento. Não adicione “Outro” livre, “quem indicou?” ou PII nessas perguntas.

`signup_sessions` tem token/HMAC, risco, TTL idle de 15 min e absoluto de 60 min, CAS, respostas e
`consumed_at`. Os estados **efetivos** são `initiated`, `details_complete`, `blocked`, `expired`.
Não existem ainda os campos/writers de `auth_user_id`, `email_hash`, `owner_name` ou `clinic_name`.
O DTO público `/me` contém status, risco, expiração, rowVersion e respostas sanitizadas.
Migrations `0096`–`0098` estão fora de produção segundo o último registro; isso não foi
reconsultado externamente nesta retomada. O enum completo da §21.5 é proposta, não instalação.

O risco de sessão Supabase legível foi removido do registro de risco como correção de código,
com provas novas em §35.6. Não houve aceite humano fictício:

- Cookies Supabase são HttpOnly, SameSite=Lax e Secure em produção; nome
  `sb-<project>-auth-token-v2-<geração>`, geração aleatória de 32 caracteres hexadecimais.
- Seletor HttpOnly `qoro-auth-session` aponta a geração. Login/OTP/login final de `/join` criam
  geração nova e selecionam **depois** de gravar os fragmentos. Escritas de mutação são `required`.
- Refresh nunca grava nem apaga seletor, inclusive em falha. Resposta atrasada de A não seleciona
  A nem apaga B depois de OTP B/logout. Não reverta isso para limpeza baseada em snapshot antigo.
- GET perto do vencimento, margem de 120 s, usa `/auth/session-refresh` Node e força
  `refreshSession()`; a diferença para a margem do SDK não pode recriar loop de redirect.
- Middleware permanece sem rede/autorização; apaga legado/órfãos sem copiar bearer ou reemitir
  seletor/cookies ativos. Sessão legada exige uma autenticação nova no cutover.
- `/convite` verifica identidade/perfil no servidor e revalida na action. O cliente recebe somente
  estado/metadados limitados. `supabase-browser.ts` e o hook Realtime foram removidos.
- Consultório usa `getBoard` server-side a cada 20 s, pausa oculto e tem backoff; há perda da
  latência de evento. Barreira AST verifica imports diretos e transitivos do SDK no cliente.

Evidência registrada em 15/09: suíte completa **3.458/3.458, 370 arquivos**; segurança
**330/330, 28 arquivos**; typecheck, lint e formatação PASS; inventário **174 actions/38 métodos
HTTP**, zero drift/unresolved; Postgres isolado com `withTenant` real, A↔B/contrafactual e cleanup
zero PASS; build Next de produção isolado concluído `2026-09-15T11:19:24.075Z`; bundle
**160 artefatos, zero achado**; HTTP **306 requests/153 actions**, 47 negativas explícitas em 200.

Chromium **6/6 PASS** cobre legado, OTP/fragmentação, refresh/reload, refresh A atrasado com
sucesso e falha após OTP B e detector negativo de sessão base64 em IndexedDB genérico.
Chromium/Next/SDK instalado/Postgres são reais; **Auth é sintético em loopback**.
Não é prova de GoTrue/SMTP/produção, aceite completo de convite via OTP no browser ou revogação
externa de token roubado. A janela preexistente epoch → global signOut não foi encerrada por
essa prova. CSRF com sessão válida, IDOR HTTP de dois usuários, CSP nonce e demais riscos têm
fechamento próprio; HttpOnly não encerra XSS/CSRF.

## 3. Patch CI autorizado e incidente GitHub separados

O fundador autorizou a aplicação do patch CI em 15/09. Ele **já foi aplicado** localmente em
`.github/workflows/ci.yml`: `pnpm test:e2e:ci && pnpm security:browser-session`, depois da instalação
de Chromium. Não aplique novamente o patch ignorado de `dist/security-local`.

O comando exato terminou com exit 0: **6 públicos PASS, 2 skips por ausência deliberada de
configuração Turnstile, 6 HttpOnly PASS**. `actionlint` 1.7.12 PASS. Nenhum teste foi desativado.
O patch não foi commitado/publicado e sua execução remota é **NOT TESTED**.

O problema remoto observado é outro: **Daily DB Backup (prod)**, arquivo
`.github/workflows/db-backup.yml`, falhou em 14 e 15/09:

- [34962218431](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34962218431)
  e [34840979071](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34840979071):
  instalação PG17 PASS, autenticação no Session Pooler 5432 FAIL, upload SKIPPED.
- Erro sanitizado: banco rejeita a senha apresentada pela conexão `DATABASE_URL_PROD`.
  Na investigação inicial, o valor secreto não foi lido e a causa externa específica era hipótese.
  A confirmação posterior da rotação e a correção comprovada estão registradas abaixo.
  Não invente conserto de YAML para recuperar credencial.
- [CI 33942979910](https://github.com/joaomarcos-techia/Project_OS/actions/runs/33942979910),
  `main` SHA `93da840`, PASS em 05/09. Isso não valida a emenda desta branch.

Último PASS em 29/08 (run33252428397) e primeiro FAIL em 30/08 (run33308814087)
usaram o mesmo HEAD `3612b08` e o mesmo `pg_dump`17.11. A primeira falha já foi
autenticação rejeitada. Secret GitHub sem atualização desde24/07; workflow desde01/07.
Não atribua a falha ao patch CI/HttpOnly ou a mudança comprovada de código/cliente;
a causa externa específica exige evidência de autenticação do Supabase.

**Correção posterior confirmada em 15/09:** o fundador informou rotação da senha do banco em
30/08, atualização somente na Vercel e secret GitHub antigo. Autorizou usar `DATABASE_URL_PROD`
de `.env.local` para atualizar o secret pelo comando. Isso foi feito por stdin, sem imprimir a
conexão, alterar o arquivo ou criar cópia temporária. API GitHub confirmou atualização
`2026-09-15T12:56:26Z`, PASS. Não leia novamente o env nem repita a atualização por inferência.

Um único backup foi disparado para validar a correção:
[run34971934566](https://github.com/joaomarcos-techia/Project_OS/actions/runs/34971934566),
`main`93da840, criado `2026-09-15T12:57:06Z`, **PASS**, concluído12:58:01Z. Instalação,
dump/cifra e upload aprovados. Artifact `db-backup` ID10397950443, **527.083 bytes**,
`expired=false`, expira `2026-10-15T12:57:58Z`. Incidente operacional encerrado.
O workflow é somente leitura do banco.
A exigência adicional de autorização de rerun era editorial; o pedido original de resolver o
workflow e a nova autorização do secret cobrem essa validação. Consulte qorov2§35.8 para o
resultado final; não dispare outro run. Fechar backup com runPASS e artifact cifrado; restore
scratch é prova separada ainda NOT TESTED e exige autorização própria. Não inferir aprovação
para migration, deploy, nova rotação ou outras operações produtivas. Fonte de conexão:
[documentação Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 4. Próxima fatia: identidade + consentimento + nome da clínica

Continue **uma fatia por vez**: identidade/consentimento/nome → confirmação de e-mail → Checkout
recorrente hospedado → webhook/reconcile → provisionamento idempotente → onboarding → `O.H/O.S`.
Não implemente todas juntas. Primeiro congele o escopo e escreva a ADR complementar/emenda da
fatia de identidade com contratos e evidências necessárias; depois implemente o escopo autorizado.

Resolva explicitamente as diferenças documentais antes do código:

1. ADR-060 status limita autorização a O-2, não O-3/posteriores. As decisões de §1.c indicam a
   próxima fatia, mas não autorizam migration/API/infra por inferência. §§2–4 guardam desenho
   anterior às perguntas; não os trate como descrição exaustiva do schema atual.
2. ADR-053 ainda é Proposed e menciona verificação antes de dados da clínica. A decisão posterior
   ADR-060 §1.c/§1.c.1 permite **nome da clínica com consentimento, antes da confirmação do e-mail**.
   Recursos definitivos e customer/Checkout/assinatura Asaas continuam posteriores à verificação.
3. Use os rótulos de fatias da §21.19; “O-2” na §6 é outro marco. Atribuição O-1 não bloqueia
   bootstrap orgânico. §33 reserva ADR-061 para perfil WhatsApp; não use o número sem reconciliar.

Decisões já fechadas, sem reabrir:

- Consentimento por links `https://qoro.dev/politica-de-privacidade` e
  `https://qoro.dev/termos-de-uso`; sem sistema novo de versões/hash/histórico. Defina somente o
  sinal mínimo de aceite necessário conforme ADR-060 §1.c/§1.d e seu limite probatório registrado.
- Supabase é dono de senha/sessão. Senha só em memória/request, nunca em staging/storage/URL/log.
- Nenhum recurso Asaas antes de e-mail verificado. Cartão no **Checkout hospedado**;
  tokenização descartada. Não copie PAN/CVV do `/join`, cujo fluxo atual é outro.
- Trial self-service de **7 dias**, após intenção idempotente e readback da assinatura correta,
  recorrente e não terminal. Liquidação não é pré-requisito; parcela pode vencer após o trial.
  Convite/admin tem **14 dias**, fluxo separado.
- Plano/preço/trial/role/tenant são autoridade do servidor; produto único, CRM apenas.
- Captcha Supabase segue desligado segundo o checkpoint. Não ativar no painel por inferência:
  código deve enviar desafio em todos os callsites afetados antes. Turnstile é single-use;
  token de bootstrap não pode ser reaproveitado para signup/envio de verificação.

O scope freeze precisa definir campos pessoais mínimos, staging/retenção e janitor, aceite antes
de PII, estados/constraints/TTL/CAS, ownership single-use com `auth_user_id`, consumo/replay,
retomada autenticada, confirmação em outro navegador sem token de signup na URL e tratamento de
conta existente sem enumeração. Verificação por e-mail deve falhar fechado se limiter distribuído
estiver indisponível; fallback de sessão efêmera não autoriza spam de e-mail (ADR-060 §6).

## 5. Código que deve ser lido antes de editar

- `src/app/(app)/cadastro/{page,signup-questions}.tsx` e testes;
  `src/app/api/signup/sessions/{route.ts,me/route.ts,answers/route.ts}` e `signup/cookie.ts`.
- `src/contexts/onboarding/index.ts` é boundary pública; app não importa `internal/*`.
  Leia `schema.ts`, `internal/signup-session.ts`, `signup-answers.ts`, `signup-answer-values.ts`,
  `signup-risk.ts` e `turnstile.ts`, com testes e migrations `0096`–`0098`.
- `src/lib/auth/{rate-limit,captcha,supabase-server,supabase-session-cookie}.ts`;
  `src/components/shared/turnstile-widget.tsx`.
- `src/app/(app)/auth/confirm/{route,confirm-logic}.ts`: hoje OTP `token_hash` para
  convite/recovery, sem linker Track O/consumo de bootstrap/callback PKCE. Verifique os tipos
  permitidos antes de estender: OTP `signup` já é aceito, mas `safeNext` só permite `/dashboard`,
  `/convite` e `/reset-password`. Falta integrar retorno seguro ao cadastro junto ao vínculo/consumo
  Track O, sem afrouxar o parser. Nova identidade usa `newSession: true` e escrita `required`.
- `src/lib/auth/tenant-context.ts`: usuário verificado pré-tenant não possui profile/clínica.
  Crie a seam mínima de onboarding verificado no escopo aprovado; não enfraqueça `authenticate()`
  nem crie clínica/perfil artificial para atravessar guards. Preserve gate `invite_pending`.
- `/join/[token]` e `onboarding/internal/saga.ts` são antecedentes de CAS/falhas/compensação,
  não self-service pronto. O fluxo síncrono/cartão pelo backend não deve ser copiado.
- `scripts/security/signup-regression.ts` com `--browser`,
  `security-e2e/http-only-session.spec.ts` e `playwright.httponly.config.ts` são harnesses locais.

## 6. ADRs que governam os contratos e as outras frentes

Leia ao tocar cada contrato; cite a ADR e a seção reais ao registrar a decisão:

| Contrato | Fonte |
| --- | --- |
| Profiles/guards/RBAC autoritativos | [ADR-008](../adr/008-identity-patterns.md), [ADR-037](../adr/037-server-authoritative-session.md) |
| RLS/FORCE/`withTenant`, tabela global protegida | [ADR-007](../adr/007-rls-implementation-patterns.md), [ADR-010](../adr/010-security-definer-patterns.md), [ADR-041](../adr/041-authz-tables-are-not-tenant-tables.md), [ADR-042](../adr/042-rls-initplan-and-public-least-privilege.md) |
| Outbox/audit/idempotência; provider fora da tx | [ADR-011](../adr/011-outbox-audit-idempotency-patterns.md), [ADR-020](../adr/020-messaging-provider-patterns.md) |
| Planos, billing verify-then-act/reconcile | [ADR-024](../adr/024-plan-model.md), [ADR-025](../adr/025-billing-architecture.md), Addendum A2 |
| Convite14/CAS/saga, gate membro pendente, MFA | [ADR-027](../adr/027-onboarding-magic-invite.md), [onboarding-spec](../onboarding-spec.md), [ADR-040](../adr/040-invite-acceptance-gate.md), [ADR-038](../adr/038-mfa-policy.md) |
| Observabilidade/ambiente/execução | [ADR-045](../adr/045-observability-execution-boundary.md) |
| Pagamento paciente BYO da clínica; distinto de assinatura Qoro | [ADR-049](../adr/049-pagamentos-paciente-sinal.md), [ADR-050](../adr/050-identidade-de-pagamento-do-paciente.md), [ADR-051](../adr/051-conciliacao-sinal-e-recebivel.md), [ADR-052](../adr/052-risco-e-reversao-de-pagamento-do-paciente.md) |
| Entregas clínicas/PDFs | [ADR-055](../adr/055-documentos-clinicos-fora-da-consulta.md), [ADR-059](../adr/059-acesso-autenticado-pdfs-clinicos.md) |
| CSV contábil não fiscal; NFS-e separado | [ADR-058](../adr/058-exportacao-financeira-contabilidade.md), parcialmente substitui [ADR-054](../adr/054-documento-de-pagamento-e-recibo-fiscal.md) |
| Retorno/no-show; Meta externa separada | [ADR-057](../adr/057-recuperacao-falta-retorno.md) |
| Memed adiado para Track M final | [ADR-056](../adr/056-spike-integracao-memed.md) |

Preserve epoch por request, RBAC fresco, autoria/paciente/clínica consistentes, leituras clínicas
auditadas, um handler registrado por evento e ausência de I/O provider dentro da transação.
Agenda muda por `applyTransition`; Payments publica eventos, não escreve appointments/ledger
diretamente. `patient_charges` não é ledger; dinheiro recebido/alocado determina `valorPago`.
IA não pode autorizar cobrança nem conteúdo clínico só por texto de prompt.

Fotografia das outras frentes, sem reconsulta externa: Camada2/2.S PASS em 11/09 (`2e1f5fc`);
P2/Camada3 reduzida em 12/09, conselho genérico/CRP e pacote de paciente adiados.
TISS/convênio, NFS-e, NPS/online e demais P3 ficam no backlog; Memed é Track M final.
Perfil WhatsApp Business (§33) é especificação, sem runtime. D50 tinha refund PENDING em 06–07/09;
D80/P11-D77 terminou CANCELLED, sem prova externa `DONE → refunded`.
D102/2.4A depende de templates Meta: substitutos estavam PENDING em 12/09 após reclassificação
MARKETING. Não mudar env para template pendente, repetir POST/refund/cobrança ou criar fixture
nova por inferência. Não substituir chave Asaas da clínica compartilhada.

## 7. Autorizações, validação e checkpoint durante o trabalho

Não inspecione/edite `.env.local`, não exponha credenciais e não use seus valores para inferir
acesso produtivo. Produção continua vedada pela decisão em §34.2, salvo autorização nova,
específica e registrada. Preview/Sandbox também precisam de alvo/fixture/escopo autorizados;
testes históricos não são autorização geral. Não envie Meta real sem destinatário consentido.
Migrations, comandos destrutivos, dependência nova de produção, CI/build/deploy e mudança de
API pública exigem confirmação conforme AGENTS/instruções atuais. O patch CI acima já foi
autorizado/aplicado; não peça a mesma aprovação outra vez. Publicação/merge/deploy não ocorreram.

Fatias de até 25 arquivos/1.500 linhas e no máximo dois bounded contexts. Se a identidade exceder,
divida por objetivo antes de editar. Prepare contrato/diff concreto revisável antes de pedir a
aprovação externa que faltar. Não confunda autorização do desenvolvimento com rodar migration.

Runtime observado: Node22.16.0, pnpm11.17.0, Next15.5.21, React19.2.6,
`@supabase/ssr`0.10.3, `supabase-js`2.106.2. Reconfirme `package.json`/lockfile.
Scripts reais: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`,
`pnpm security:check`, `pnpm test:e2e:ci`, `pnpm arch:check`, `pnpm arch:db-check`,
`pnpm arch:graphs --check`, `pnpm check:migrations`, `pnpm check:observability`,
`pnpm check:registry:strict`, `git diff --check`. Use os apropriados ao recorte.

`security:check` tem sete etapas: inventory → unit → tenant → build → browser-session → bundle
→ HTTP. Instale Chromium de desenvolvimento se necessário. Não rode builds concorrentes.
Build comum carrega `.env.local`; use o build isolado. Scripts que importam `_env` podem carregar
dotenv; execute com cwd/ambiente isolados quando necessário. Não rode `production-*` em lote.
Prettier/lint não substituem provas de persistência/ownership. Nunca desative teste, silencie tipo
com any/cast ou mude esperado para aceitar defeito. Registros gerados têm fonte em scripts;
não edite `riscos.md`/`acoes.md` manualmente.

Para identidade, prove bytes/stream cancelado, entradas estritas, aceite antes de PII, TTL/janitor
apagando PII sintética, CAS/duas abas, ownership/consumed replay, confirmação cruzada, conta
existente/expiração sem enumeração, Auth/limiter indisponíveis, retry sem envio/vínculo duplicado,
ausência de bearer no navegador, teclado/foco/reload e mensagens honestas.
Mocks/loopback provam o contrato local; GoTrue/SMTP/Asaas reais têm gate externo separado.

Atualize **durante** o trabalho `docs/qorov2.md`, ADR, Discovery Log e matriz E2E conforme o recorte.
Registre decisão, branch/SHA, arquivos/diff, comandos/exit codes, ambiente, cleanup, pendência,
limites e próximo passo. Classifique cada prova PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED.
Ao concluir a fatia, entregue o resultado testado e o checkpoint, sem declarar Track O/Qoro v2
inteiros completos. Faltam rollout/cutover real, Auth/SMTP, Checkout recorrente Sandbox,
provisionamento/onboarding, `O.H/O.S`, WAF/Turnstile externo e Product Acceptance.
