# Auditoria das variáveis Vercel — integração financeira

## Estado operacional atual — 12/11/2026

| Etapa | Preview financeiro | Production |
| --- | --- | --- |
| Configurado | Variáveis específicas da branch e mapa dos cinco produtos Sandbox existentes | Nome `ABACATEPAY_API_KEY` e escopo confirmados; erro de grafia removido |
| Verificado | Conta/recursos Sandbox e fingerprint DEV comprovados nas provas anteriores | Somente nomes/escopos, com `decrypt=false`; validade, permissões e revogação anterior não verificadas |
| Integrado | Runtime Sandbox, bindings, inbox e cinco contratações iniciais | Composição live não implementada; presença da chave não a habilita |
| Testado | Cinco pagamentos iniciais reais Sandbox; incrementos locais/CI descritos no relatório | Nenhum teste com credencial live, webhook live ou transação real nesta autorização |
| Ativado | Sandbox restrito à candidata; recuperação nova ainda depende de SQL coordenado | **Não ativado; NO-GO financeiro** |

Não é necessário cadastrar novamente a API key. Nenhum valor live foi lido, copiado ou usado nesta rodada. As tabelas datadas abaixo são inventários históricos, não afirmações de ausência atual. `QORO_TISS_WORKTREE`/`QORO_TISS_REF` são entradas locais dos ensaios, não variáveis de Vercel. O novo gate de trial não requer segredo/flag nova nem alteração de CI/deploy.

Na futura composição live, os consumidores de chave, loja, produtos, webhook e cohort precisam ser implementados/revisados antes de definir sua configuração final. Os nomes `ABACATEPAY_SANDBOX_*` não devem receber produtos reais. Não inventar uma variável `_PROD` que o runtime não consome. Endpoint V2 oficial é `https://api.abacatepay.com/v2`; credencial e prova de ambiente devem concordar, sem depender só do hostname. [Sequência de preparação e ativação](PLANO-FINAL-GO-LIVE-ABACATEPAY.md#preparação-live-executável--1211-sem-ativação).

**Confirmação posterior em 11/11, 21:14 UTC:** após o titular informar a correção, uma nova consulta de nomes/escopos confirmou **`ABACATEPAY_API_KEY` presente em Production** e nenhuma declaração com o nome `ABACATEPAY_API_KAY`. A configuração específica do Preview financeiro continua presente. Consulta com `decrypt=false`, sem ler valores, testar a chave live, modificar configuração ou fazer redeploy. A substituição/revogação da credencial anterior não foi auditada. Isso encerra a pendência de grafia, não os gates da composição live. A leitura anterior abaixo fica preservada como histórico; o novo readback está em `productionCredentialCorrection` da evidência canônica.

**Atualização em 11/11, 21:03 UTC:** o founder informou aprovação da conta AbacatePay e cadastro da chave live, sem redeploy. A leitura autenticada de nomes/escopos (`decrypt=false`) encontrou **`ABACATEPAY_API_KAY` em Production**, com erro de grafia; **`ABACATEPAY_API_KEY` estava ausente nesse ambiente no momento da leitura**. O código consome `KEY`, não `KAY`. Não foi lido ou copiado nenhum valor, corrigida configuração ou feito deployment. Depois do aviso, o founder informou que substituirá a credencial e corrigirá o nome; essa intenção ainda não é confirmação da alteração. As linhas da auditoria de 10/11 abaixo continuam históricas. A evidência atual está no campo `productionCredentialUpdate` de [recuperacao-financeira-20261111.json](evidencias/recuperacao-financeira-20261111.json).

Uma credencial apareceu na seleção do IDE enviada ao chat. Seu valor não foi reproduzido nem guardado em evidência. Recomendada substituição pelo titular antes da ativação, salvando a nova chave com o nome correto somente em Production. Não foi revogada nenhuma chave por automação. `ABACATEPAY_API_KEY_PROD` local não tem consumidor na aplicação atual; não trocar a chave Sandbox de `ABACATEPAY_API_KEY` no local/Preview pela live. A separação operacional da aplicação usa o mesmo nome por ambiente da Vercel, sem sufixos. Não fazer redeploy nem mudar `SAAS_SIGNUP_PROVIDER` para Sandbox em Production para tentar ativar: o runtime ainda bloqueia esse ambiente e falta a composição live revisada.

Leitura em **2026-11-10T18:00:43.229Z**, projeto project-os, branch `feat/billing-abacatepay-20261107`. Consulta autenticada com **decrypt=false**: nenhum valor solicitado para decifração, lido ou publicado por este auditor. Zero alteração de configuração ou Production. O inventário contém **52 nomes relevantes**, incluindo variáveis consumidas mas ausentes e três variáveis automáticas da plataforma. [Metadados e todos os consumidores](evidencias/variaveis-vercel-20261110.json).

## O que foi configurado e por quê

Para testar a AbacatePay sem afetar o Asaas publicado, a automação configurou somente seis variáveis no **Preview da branch financeira**, em 08/11: API key, loja, produto de atestação, mapa de planos, segredo de webhook e seletor de aquisição. [Registro sanitizado](evidencias/configuracao-preview-proveniencia-20261110.json). A operação era um upsert: a evidência não distingue criação de substituição de cada registro. Não atribuímos autoria às demais variáveis apenas por existirem.

Em 09/11 o mapa de produtos foi atualizado de dois para cinco planos, para permitir escolher 2–5 médicos já na primeira compra. Essa mudança não define um preço no navegador: catálogo SQL e produto remoto precisam concordar com R$ 197/397/544/691/838. Não houve nova modificação de variáveis nesta rodada.

## Por que existem duas ABACATEPAY_API_KEY em Preview

Há uma declaração geral Preview, do tipo sensitive e mais recente, e uma declaração encrypted específica desta branch. **A configuração específica da branch prevalece**, mesmo sendo mais antiga. O Preview imutável `fd90ded7` usa esse escopo; seus metadados efetivos são anteriores ao deployment. Os valores não foram comparados e não se afirma que sejam iguais. A nova chave geral pode afetar outros Previews; não foi removida nem copiada.

No inventário atual, as seis variáveis da candidata estão **ausentes em Production**. Isso é esperado: o código implementa `abacatepay_sandbox` e recusa Production. Cadastrar uma chave real não implementa o caminho live nem autoriza ativação. Não criar nomes alternativos `ABACATEPAY_API_KEY_DEV/PROD`: o código consome `ABACATEPAY_API_KEY`; a separação é pelo ambiente/branch da Vercel. Nunca usar `NEXT_PUBLIC_` para chave privada.

## Ambientes e nomes que não precisam ser criados

Nenhuma destas variáveis foi encontrada no escopo gerenciado Development. Isso não significa ausência no arquivo local: os operadores funcionam com suas credenciais protegidas existentes e o arquivo `.env.local` não foi alterado. Preview financeiro usa DEV comprovado por prova assinada; Production foi somente inventariada por metadados.

Não há variável de modo ou base URL AbacatePay exigida por este código: endpoint V2 fica no adaptador; a credencial e os recursos com `devMode=true` comprovam o modo de teste. URLs de checkout vêm da criação remota e são persistidas; não se inventa URL em env. Retorno usa a base confiável da aplicação. Webhook tem segredo próprio e validação HMAC. Não criar variáveis por nomes sugeridos sem consumidor.

## Inventário técnico

Todos os nomes abaixo estão **ausentes no escopo gerenciado Development**. Preview/Production são presença e escopo, não leitura dos valores. Uma célula presente não prova que a credencial esteja correta; somente os preflights explicitamente executados dão essa evidência. Os consumidores completos, com linha, estão no JSON. A coluna de origem distingue operação comprovada de autoria desconhecida.

| Nome | Finalidade / necessidade | Consumidores (amostra) | Preview | Production | Sigilo | Proveniência |
|---|---|---|---|---|---|---|
| `ABACATEPAY_API_KEY` | Autenticar chamadas servidor-servidor; obrigatória na candidata. | [src/app/api/cron/billing-reconcile/route.ts:548](../../../src/app/api/cron/billing-reconcile/route.ts), [src/app/api/cron/billing-reconcile/route.ts:568](../../../src/app/api/cron/billing-reconcile/route.ts) + 22 refs | presente/branch | ausente | privada; não exibir | upsert Preview pela automação, 08/11 |
| `ABACATEPAY_SANDBOX_PLAN_PRODUCTS` | Mapear os cinco planos aos produtos aprovados; obrigatória no Sandbox. | [src/contexts/billing/internal/abacatepay-plan-changes.ts:108](../../../src/contexts/billing/internal/abacatepay-plan-changes.ts), [src/contexts/billing/internal/abacatepay-plan-changes.ts:249](../../../src/contexts/billing/internal/abacatepay-plan-changes.ts) + 1 refs | presente/branch | ausente | privada; não exibir | upsert Preview pela automação, 08/11 |
| `ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID` | Atestar devMode por produto conhecido; obrigatória no Sandbox. | [src/contexts/billing/internal/abacatepay-management.ts:93](../../../src/contexts/billing/internal/abacatepay-management.ts), [src/contexts/billing/internal/abacatepay-management.ts:99](../../../src/contexts/billing/internal/abacatepay-management.ts) + 4 refs | presente/branch | ausente | privada; não exibir | upsert Preview pela automação, 08/11 |
| `ABACATEPAY_STORE_ID` | Fixar a loja autorizada e impedir cruzamento de contas; obrigatória. | [src/app/(admin)/admin/_lib/repositories/abacatepay-operations.repo.ts:11](../../../src/app/(admin)/admin/_lib/repositories/abacatepay-operations.repo.ts), [src/app/(admin)/admin/_lib/repositories/abacatepay-operations.repo.ts:21](../../../src/app/(admin)/admin/_lib/repositories/abacatepay-operations.repo.ts) + 48 refs | presente/branch | ausente | privada; não exibir | upsert Preview pela automação, 08/11 |
| `ABACATEPAY_WEBHOOK_SECRET` | Autenticar o endpoint de eventos; distinto da API key; obrigatório. | [src/app/api/webhooks/abacatepay/route.ts:16](../../../src/app/api/webhooks/abacatepay/route.ts), [src/app/api/webhooks/abacatepay/route.ts:27](../../../src/app/api/webhooks/abacatepay/route.ts) | presente/branch | ausente | privada; não exibir | upsert Preview pela automação, 08/11 |
| `APP_BASE_URL` | Base confiável de redirects/e-mails; obrigatória na operação do cadastro. | [src/app/api/signup/sessions/route.ts:53](../../../src/app/api/signup/sessions/route.ts), [src/app/api/signup/sessions/route.ts:55](../../../src/app/api/signup/sessions/route.ts) + 11 refs | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `ASAAS_API_KEY` | Assinaturas SaaS antigas; não é a credencial Asaas privada de cada clínica. | [src/app/(admin)/admin/_lib/services/health.service.ts:68](../../../src/app/(admin)/admin/_lib/services/health.service.ts), [src/app/(admin)/admin/_lib/services/health.service.ts:73](../../../src/app/(admin)/admin/_lib/services/health.service.ts) + 7 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `ASAAS_BASE_URL` | Endpoint Asaas da operação antiga; preservar separação Sandbox/real. | [src/app/(admin)/admin/_lib/services/health.service.ts:72](../../../src/app/(admin)/admin/_lib/services/health.service.ts), [src/app/api/signup/runtime-fingerprint/route.ts:118](../../../src/app/api/signup/runtime-fingerprint/route.ts) + 4 refs | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `ASAAS_HTTP_TIMEOUT_MS` | Teto por chamada Asaas; ausência usa 10.000 ms. | [src/lib/payments/asaas/index.ts:713](../../../src/lib/payments/asaas/index.ts), [src/lib/payments/asaas/index.ts:714](../../../src/lib/payments/asaas/index.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `ASAAS_WEBHOOK_TOKEN` | Validar eventos SaaS Asaas; preservar contratos existentes. | [src/app/(admin)/admin/config/page.tsx:197](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/env.ts:626](../../../src/lib/env.ts) + 1 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `CRON_SECRET` | Autenticar crons de conciliação/dunning; obrigatório operacionalmente. | [src/app/(admin)/admin/config/page.tsx:203](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/env.ts:527](../../../src/lib/env.ts) + 3 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `CRON_SECRET_DESTRUCTIVE` | Segredo separado opcional; ausência usa CRON_SECRET por retrocompatibilidade. | [src/lib/http/cron-auth.ts:45](../../../src/lib/http/cron-auth.ts) | ausente | ausente | privada; não exibir | sem autoria comprovada neste recorte |
| `CRYPTO_LOOKUP_SALT` | Lookup protegido de dados; obrigatório no backend env. | [src/lib/crypto/secret-provider.ts:71](../../../src/lib/crypto/secret-provider.ts), [src/lib/crypto/secret-provider.ts:75](../../../src/lib/crypto/secret-provider.ts) + 1 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `CRYPTO_MASTER_KEY_V1` | Criptografia de dados; obrigatório no backend env. | [src/app/(admin)/admin/config/page.tsx:208](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/crypto/secret-provider.ts:51](../../../src/lib/crypto/secret-provider.ts) + 1 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `CRYPTO_MASTER_KEY_V2` | Rotação futura opcional; não substituir V1 nem gerar chave por auditoria. | [src/lib/crypto/secret-provider.ts:53](../../../src/lib/crypto/secret-provider.ts) | ausente | ausente | privada; não exibir | sem autoria comprovada neste recorte |
| `CRYPTO_SECRET_BACKEND` | Selecionar env ou GCP; presença não prova o valor, que não foi lido. | [src/lib/env.ts:539](../../../src/lib/env.ts) | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `DATABASE_URL` | Conexão PostgreSQL administrativa/migrations; não usar cliente com origem errada. | [src/app/api/signup/runtime-fingerprint/route.ts:108](../../../src/app/api/signup/runtime-fingerprint/route.ts), [src/lib/db/index.ts:128](../../../src/lib/db/index.ts) + 4 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `DATABASE_URL_RUNTIME` | Conexão runtime quando configurada; validar projeto pela prova assinada. | [src/lib/db/index.ts:128](../../../src/lib/db/index.ts) | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `EMAIL_FROM` | Remetente do cadastro/e-mails; necessário em runtime com Resend. | [src/lib/email/resend.ts:92](../../../src/lib/email/resend.ts), [src/lib/env.ts:633](../../../src/lib/env.ts) | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `GCP_PROJECT_ID` | Obrigatório apenas no backend de segredos GCP. | [src/lib/crypto/secret-provider.ts:106](../../../src/lib/crypto/secret-provider.ts), [src/lib/env.ts:557](../../../src/lib/env.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `GCP_SECRET_LOOKUP_SALT_NAME` | Nome do segredo no GCP, condicional ao backend GCP. | [src/lib/crypto/secret-provider.ts:127](../../../src/lib/crypto/secret-provider.ts), [src/lib/env.ts:559](../../../src/lib/env.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `GCP_SECRET_MASTER_KEY_NAME` | Nome do segredo no GCP, condicional ao backend GCP. | [src/lib/crypto/secret-provider.ts:117](../../../src/lib/crypto/secret-provider.ts), [src/lib/env.ts:558](../../../src/lib/env.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `LOGIN_HASH_PEPPER` | Proteção de identificadores/rate limit; necessário nos caminhos protegidos. | [src/app/(admin)/admin/config/page.tsx:210](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/auth/email-hash.ts:18](../../../src/lib/auth/email-hash.ts) + 3 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `LOGTAIL_SOURCE_TOKEN` | Declaração legada de logs; nenhum consumidor AST encontrado neste recorte. Rever pipeline antes de remover. | não encontrado no AST; ver observação | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `LOGTAIL_URL` | Declaração legada de logs; nenhum consumidor AST encontrado neste recorte. Rever pipeline antes de remover. | não encontrado no AST; ver observação | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `MAGIC_TOKEN_SECRET` | Assinar tokens de jornada/recuperação; obrigatório nos handlers correspondentes. | [src/app/api/signup/runtime-fingerprint/route.ts:97](../../../src/app/api/signup/runtime-fingerprint/route.ts), [src/contexts/identity/internal/password-reset-email.ts:45](../../../src/contexts/identity/internal/password-reset-email.ts) + 8 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN público de telemetria; source possui fallback público. Ausência não prova Sentry desligado. | [sentry.edge.config.ts:9](../../../sentry.edge.config.ts), [sentry.server.config.ts:10](../../../sentry.server.config.ts) + 1 refs | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Fallback público legado; não obrigatório quando publishable está configurada. | [src/lib/auth/supabase-server.ts:56](../../../src/lib/auth/supabase-server.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública para Supabase; par com URL e políticas RLS. | [src/lib/auth/supabase-server.ts:56](../../../src/lib/auth/supabase-server.ts) | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `NEXT_PUBLIC_SUPABASE_URL` | Projeto Auth/REST; o Preview financeiro foi atestado como DEV. | [next.config.ts:16](../../../next.config.ts), [next.config.ts:85](../../../next.config.ts) + 5 refs | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Widget público do cadastro; não equivale a comprovar secret/domínio real. | [src/components/shared/turnstile-widget.tsx:144](../../../src/components/shared/turnstile-widget.tsx), [src/components/shared/turnstile-widget.tsx:152](../../../src/components/shared/turnstile-widget.tsx) | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `OFFER_2026_ANNUAL_NEW_SALES_ENABLED` | Flag para novas vendas anuais Asaas; ausência=false. Candidata AbacatePay só mensal. | [src/contexts/billing/internal/plan-changes.ts:1931](../../../src/contexts/billing/internal/plan-changes.ts), [src/contexts/billing/internal/plan-changes.ts:642](../../../src/contexts/billing/internal/plan-changes.ts) + 3 refs | ausente | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `RESEND_API_KEY` | Enviar e-mails transacionais; obrigatória em runtime. | [src/contexts/onboarding/internal/signup-recovery.ts:191](../../../src/contexts/onboarding/internal/signup-recovery.ts), [src/contexts/onboarding/internal/signup-recovery.ts:200](../../../src/contexts/onboarding/internal/signup-recovery.ts) + 2 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `RESEND_WEBHOOK_SECRET` | Receber eventos de entrega; ausente em Preview, rastreamento externo ali não comprovado. | [src/app/api/webhooks/resend/route.ts:15](../../../src/app/api/webhooks/resend/route.ts), [src/app/api/webhooks/resend/route.ts:19](../../../src/app/api/webhooks/resend/route.ts) | ausente | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `SAAS_SIGNUP_PROVIDER` | Escolher a origem de novas aquisições; não migra contratos existentes. Ausência mantém Asaas. | [src/lib/payments/saas/acquisition.ts:7](../../../src/lib/payments/saas/acquisition.ts) | presente/branch | ausente | configuração/pública | upsert Preview pela automação, 08/11 |
| `SENTRY_AUTH_TOKEN` | Autenticação de build/source maps; opcional para runtime, nunca público. | não encontrado no AST; ver observação | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `SENTRY_DNS` | Nome existente sem consumidor AST; provável grafia incorreta. Não renomear/excluir sem revisar configuração. | não encontrado no AST; ver observação | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SENTRY_DSN` | Fallback server/edge de telemetria; source possui DSN público posterior. Não confundir com SENTRY_DNS. | [sentry.edge.config.ts:10](../../../sentry.edge.config.ts), [sentry.server.config.ts:11](../../../sentry.server.config.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `SENTRY_ORG` | Organização da integração Sentry no build; não é chave runtime financeira. | não encontrado no AST; ver observação | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SENTRY_PROJECT` | Projeto da integração Sentry no build; não é chave runtime financeira. | não encontrado no AST; ver observação | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SIGNUP_AUTH_ENABLED` | Opt-in do cadastro Auth; ausência=false. | [src/app/api/signup/checkout/cancel/route.ts:36](../../../src/app/api/signup/checkout/cancel/route.ts), [src/app/api/signup/checkout/route.ts:110](../../../src/app/api/signup/checkout/route.ts) + 32 refs | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SIGNUP_ENABLED` | Kill switch de entrada; ausência=true, não bloqueia usuários existentes. | [src/app/(app)/cadastro/page.tsx:30](../../../src/app/(app)/cadastro/page.tsx), [src/app/(app)/cadastro/verificacao/page.tsx:14](../../../src/app/(app)/cadastro/verificacao/page.tsx) + 2 refs | ausente | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SIGNUP_IDENTITY_ENABLED` | Opt-in da identidade de cadastro; ausência=false. | [src/app/(app)/cadastro/page.tsx:30](../../../src/app/(app)/cadastro/page.tsx), [src/app/(app)/cadastro/page.tsx:38](../../../src/app/(app)/cadastro/page.tsx) + 35 refs | presente/geral | presente/geral | configuração/pública | sem autoria comprovada neste recorte |
| `SUPABASE_PROJECT_ENV` | Guard de scripts operacionais, não exigência de variável gerenciada do deployment. | [src/lib/db/index.ts:39](../../../src/lib/db/index.ts), [src/lib/db/index.ts:53](../../../src/lib/db/index.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `SUPABASE_SECRET_KEY` | Credencial administrativa server-side; obrigatória para caminhos privilegiados. | [src/lib/auth/recovery-grant.ts:30](../../../src/lib/auth/recovery-grant.ts), [src/lib/auth/signup-confirmation-grant.ts:25](../../../src/lib/auth/signup-confirmation-grant.ts) + 1 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `SUPABASE_SERVICE_ROLE_KEY` | Fallback legado; não obrigatório quando secret key adequada está configurada. | [src/lib/auth/recovery-grant.ts:30](../../../src/lib/auth/recovery-grant.ts), [src/lib/auth/signup-confirmation-grant.ts:25](../../../src/lib/auth/signup-confirmation-grant.ts) + 1 refs | ausente | ausente | privada; não exibir | sem autoria comprovada neste recorte |
| `TURNSTILE_SECRET_KEY` | Verificação server-side do desafio; nunca NEXT_PUBLIC. | [src/contexts/onboarding/internal/turnstile.ts:65](../../../src/contexts/onboarding/internal/turnstile.ts) | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `UPSTASH_REDIS_REST_TOKEN` | Credencial de limite de abuso/distribuição; necessária nos caminhos protegidos. | [src/app/(admin)/admin/config/page.tsx:206](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/auth/rate-limit.ts:286](../../../src/lib/auth/rate-limit.ts) + 18 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `UPSTASH_REDIS_REST_URL` | Endpoint Redis do limite de abuso; par com o token. | [src/app/(admin)/admin/config/page.tsx:206](../../../src/app/(admin)/admin/config/page.tsx), [src/lib/auth/rate-limit.ts:286](../../../src/lib/auth/rate-limit.ts) + 19 refs | presente/geral | presente/geral | privada; não exibir | sem autoria comprovada neste recorte |
| `VERCEL_BRANCH_URL` | Variável de sistema injetada pela Vercel; não criar manualmente. | [src/lib/http/application-url.ts:110](../../../src/lib/http/application-url.ts), [src/lib/http/application-url.ts:83](../../../src/lib/http/application-url.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `VERCEL_ENV` | Variável de sistema da Vercel; guard impede candidata Sandbox em Production. | [next.config.ts:84](../../../next.config.ts), [src/app/(app)/oferta-preview/page.tsx:14](../../../src/app/(app)/oferta-preview/page.tsx) + 17 refs | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |
| `VERCEL_URL` | Variável de sistema do deployment; não criar manualmente. | [src/lib/http/application-url.ts:110](../../../src/lib/http/application-url.ts), [src/lib/http/application-url.ts:83](../../../src/lib/http/application-url.ts) | ausente | ausente | configuração/pública | sem autoria comprovada neste recorte |

## Ações recomendadas, sem mudança automática

- **Nenhuma configuração adicional é necessária agora para os quatro checkouts Sandbox.** O preflight confirmou cinco produtos devMode, loja, webhook e runtime DEV. A criação aguarda somente “crie os checkouts”.

- `SENTRY_DNS` não tem consumidor encontrado; os nomes usados são `SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN`. O código tem fallback público, portanto a grafia não prova ausência de telemetria. Revisar o destino desejado antes de renomear/remover; não alterado.

- `LOGTAIL_*` não tem consumidor AST neste recorte. Isso não comprova que o pipeline gerenciado deixe de usar essas declarações. Sentry org/project/auth também podem ser consumidos pelo SDK de build. Não remover por uma busca negativa isolada.

- O rastreamento de entrega Resend no Preview não é comprovado sem o segredo de evento; não copiar o de Production para fazê-lo passar. A prova financeira começa com identidade sintética confirmada administrativamente e não atesta entregabilidade.

- Variáveis GCP ausentes só são problema se o backend efetivo for GCP; o valor não foi lido nesta auditoria. O preflight runtime DEV passou, sem assumir configuração Production.

- Qualquer futura alteração de env precisa de deployment novo para produzir efeito. Não modificar a release enquanto fixtures cobrantes esperam pagamento: o operador exige o mesmo SHA no app e no destino do webhook.

## Limites

O AST cobre acessos explícitos `env.X/process.env.X` em src (sem testes) e next.config/sentry server/edge. Dependências podem ler variáveis internamente. Este auditor não mede validade de segredo, saldo, tier, domínio Turnstile ou equivalência entre credenciais. Nomes de outras integrações existentes foram listados no JSON como fora do recorte, sem valores nem alteração.

## Revalidação somente leitura — lote pago em 11/11/2026

Em 11/11 às 09:58:31 UTC, metadata de 52 nomes relevantes foi conferida novamente com `decrypt=false`. A configuração Preview específica desta branch continuou suficiente para as quatro contratações: mesma release/runtime DEV, cinco produtos devMode e webhook correspondente. A precedência da chave da branch sobre a variável Preview geral foi preservada. **Nenhuma variável foi criada, alterada ou copiada para Production.** O inventário histórico acima não foi substituído.

Em linguagem simples: no Preview já existem os seis nomes candidatos `SAAS_SIGNUP_PROVIDER`, `ABACATEPAY_API_KEY`, `ABACATEPAY_STORE_ID`, `ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID`, `ABACATEPAY_SANDBOX_PLAN_PRODUCTS` e `ABACATEPAY_WEBHOOK_SECRET`. Não precisa cadastrar outros para este lote. Para futura Production, chave de API, identidade da loja, catálogo e segredo de webhook deverão ser próprios do ambiente real. **Não basta colocar a chave real:** o seletor atual `abacatepay_sandbox` é recusado em Production; a composição live/cohort ainda precisa ser implementada e revisada. Os nomes Sandbox não autorizam copiar seus valores para Production, nem definem por antecipação a configuração live. Credenciais Asaas e integrações de pacientes permanecem preservadas.

## Controles novos preparados, sem configuração externa — 11/11

ABACATEPAY_NEW_CHECKOUTS_ENABLED=false pausa somente novos checkouts; omissão preserva a candidata Sandbox anterior. ABACATEPAY_CHECKOUT_CLINIC_IDS recebe UUIDs separados por vírgula, no máximo 100, sem duplicatas; valor malformado bloqueia. Omissão mantém o cohort Sandbox existente. São configurações servidor, não segredos, e não foram cadastradas na Vercel. Não desligam consumidores, conciliação ou cancelamento.

**Production continua proibida pelo runtime.** Não configure SAAS_SIGNUP_PROVIDER=abacatepay_sandbox em Production. Após a futura composição live ser implementada/autorizada, será necessário chave API real específica, identidade de loja conferida, catálogo real e segredo de webhook próprio, preservando Asaas/pacientes. Os produtos e probe Sandbox não são catálogo de Production. Novos controles não substituem esse incremento nem geram um seletor live inexistente.

Em 11/11, o SDK Sentry do navegador passou a consumir **NEXT_PUBLIC_VERCEL_ENV**, metadata pública que a Vercel fornece automaticamente ao framework Next.js. Não é uma credencial nem exige criar uma variável na Vercel nesta rodada. Ausente fora da plataforma, preserva NODE_ENV. Foi registrada no schema e no inventário público; nenhuma chave de DEV foi copiada para Production.

## Incremento de recuperação/fechamento — 11/11

Nenhuma variável nova é necessária para o código de recuperação GET-only ou para preparar o fechamento. Usa os nomes Sandbox já auditados, schema readiness e um comando interno explícito; não há cron de exclusão habilitado. O cron de conciliação não mudou de horário. O SQL candidato continua fora do DEV, portanto sua recuperação independente ainda não está ativa no Preview compartilhado.

Os cinco pagamentos iniciais foram concluídos; a menção anterior à frase de criação é histórica. Não pagar/criar outro checkout para testar este incremento. Nenhuma variável de Production foi lida em claro, alterada ou copiada. A composição live continua sendo implementação/revisão própria: não basta trocar a API key ou o valor de um seletor para liberar Production.

## Continuidade e falha de banco — 11/11

A fronteira de captura adicionada ao worker usa o mesmo flow Sentry e as variáveis existentes. Não requer nova variável, segredo, mudança de Vercel ou configuração do workflow. A indisponibilidade anterior de apt/DNS não foi tratada trocando credenciais ou enfraquecendo TLS: a nova tentativa da CI de `b6965447` passou sem essas alterações. O histórico de nomes/escopos acima permanece datado da auditoria original, não uma nova leitura em claro de Production.

A instrução de manter migrations das branches separadas não cria um segundo banco nem um journal financeiro paralelo. O DEV permanece compartilhado e exige uma sequência futura acordada antes de aplicar o candidato. Nenhuma variável pode substituir essa dependência ou habilitar a composição live ainda não implementada.

## Alerta Preview e ensaio SQL fixado — 11/11

O founder confirmou teste de canal e recebimento do único probe414eb196; entrega Preview PASS. Não foi necessário criar variável, copiar segredo ou alterar regra Production. A API administrativa continuou401; essa prova externa usa confirmação do destinatário, não inventário autenticado de regras.

`QORO_TISS_WORKTREE` e `QORO_TISS_REF` são somente entradas locais dos harnesses, não variáveis da Vercel. O SHA completo fixa o SQL TISS até0149; o journal da candidata financeira e o DEV continuam inalterados. Não cadastrar esses nomes em Production/Preview nem tratar o ensaio local como ativação da recuperação.

## Contenção distribuída — 12/11

Nenhuma variável ou dependência de produção nova foi criada. O transporte passa a depender também de `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`, presentes no inventário Preview anterior. Não foram lidos seus valores nem alterados seus escopos nesta rodada. Conferir a integração efetiva no deployment novo; presença histórica não comprova validade atual. Usa `ABACATEPAY_STORE_ID` para dividir a contenção por loja, sem usar chave API como identificador.

Sem Redis/loja configurados, o transporte fecha de maneira segura. Isso precisa ser conferido antes de qualquer futura ativação live. Não copiar token Preview para Production nem remover a proteção para contornar indisponibilidade. A validação determinística local não faz I/O externo; o Lua foi exercitado em Redis7.4 real, somente loopback.

Uma chamada admitida normalmente executa uma avaliação de admissão e uma de resultado; contenção pode executar até3 avaliações de admissão por tentativa. Chamadas GET opcionais podem repetir somente conforme o orçamento já existente. O custo depende do número real de operações, quotas e contrato do Redis; não foi comprovado custo zero, aumentado plano ou contratado serviço. Medir consumo/latência/quota antes de ampliar cohort. Não foram criadas filas em serviço pago.

`QORO_ABACATEPAY_SCALE`, `QORO_DOCKER_BIN`, `QORO_TISS_WORKTREE` e `QORO_TISS_REF` são exclusivamente controles locais dos ensaios; não cadastrá-los na Vercel. A chave live permanece **configurada, não testada ou ativada**. O inventário não transforma `abacatepay_sandbox` em uma composição de produção.

## Scanner incremental e tick existente — 12/11, candidato não ativado

O scanner durável não exige variável nova na Vercel. Reutiliza a conta Sandbox, Redis, segredo do cron e tabelas privadas de checkpoints. A cadência preparada usa o tick já existente de outbox; nenhum horário em `vercel.json` nem configuração de Production foi alterado. Sem a aplicação autorizada do SQL candidato, a varredura persistente não fica disponível; a leitura N-1 conserva seu limite explícito.

`QORO_ABACATEPAY_SCALE_CONCURRENCY` ajusta somente o ensaio sintético local (inteiro 1–64, padrão 32); não cadastrar na Vercel. A carga não consulta o provedor nem mede quota ou custo do Redis. Nenhum valor secreto foi lido para este incremento. O projeto auxiliar foi inventariado com GET/list fixos; não repetir `vercel env run` para executar scripts locais.

O snapshot TISS revisado passou a `233d225e0ddb1fe56ee3975471a4c0260454bec7`, até 0156. As referências anteriores a 0149/0154 são históricas. Isso não autoriza DDL compartilhado nem reserva o próximo número, pois existe trabalho posterior ainda em edição.

Metadata conferida novamente em 12/11 às 19:52 UTC, com `decrypt=false`: os três overrides de chave/store/probe pertencem exatamente à branch financeira e ao target Preview; os dois nomes Redis estão no Preview geral. Nenhuma variável foi alterada. Redis está marcado como `sensitive`: o valor não é recuperável por leitura administrativa, por desenho da [Vercel](https://vercel.com/docs/environment-variables/sensitive-environment-variables). Não usar `env pull`, copiar segredo de Production ou diminuir essa proteção para testar. A prova funcional de transporte deve executar dentro do Preview com autenticação e escopo de fixture; é trabalho de engenharia pendente, não solicitação de senha ao founder. Presença de nomes não recebeu PASS de runtime.

## Continuidade do inbox e scanner de estornos

Não há nome novo de configuração. A mesma variável ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID já auditada é obrigatória para atestar o modo antes da varredura global; ausência, id divergente ou devMode=false interrompem o lote antes do extrato. Isso evita confiar apenas no id de loja. Não cadastrar a chave live nessa branch nem relaxar a atestação. O snapshot SQL revisado avançou até0158/120e8195; o candidato permanece fora do journal e não aplicado.

## Composição live preparada após aprovação executiva — 12/11

Nenhuma variável Production foi lida pelo valor ou alterada nesta execução. ABACATEPAY_API_KEY já existe; não precisa de outro nome na Vercel. As seguintes configurações têm agora consumidor no código candidato, para uma futura janela autorizada:

| Nome | Preview/Sandbox | Production futura |
| --- | --- | --- |
| ABACATEPAY_ENVIRONMENT | sandbox ou ausente | production, explícito |
| SAAS_SIGNUP_PROVIDER | abacatepay_sandbox | abacatepay_production somente para aquisição aprovada |
| ABACATEPAY_PLAN_PRODUCTS | Não usado | JSON com os cinco produtos mensais reais aprovados; nenhum ID Sandbox |
| ABACATEPAY_NEW_CHECKOUTS_ENABLED | Ausente preserva o comportamento Sandbox; false pausa | true explícito e lista de clínicas válida; false pausa novas obrigações |
| ABACATEPAY_CHECKOUT_CLINIC_IDS | Lista opcional para o cohort Sandbox | Lista obrigatória, UUIDs únicos, no máximo 100 |
| ABACATEPAY_STORE_ID | Loja atestada por recurso devMode=true | Loja atestada por recurso devMode=false |
| ABACATEPAY_WEBHOOK_SECRET | Segredo do webhook Sandbox | Segredo próprio de live, no cofre; nunca copiar do Sandbox |

As variáveis ABACATEPAY_SANDBOX_PLAN_PRODUCTS e ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID permanecem para testes. O produto de atestação live vem do catálogo aprovado; não há nova variável de probe live. Não copiar valores, habilitar modalidade anual ou redeployar Production com base nesta tabela. Uma configuração Production exige novo deployment e os gates da janela; uma chave presente não representa recorrência liberada.

## Readback nominal atual —12/11, após DEV160

Leitura Vercel com decrypt=false, sem valores/alterações: Production tem o nome `ABACATEPAY_API_KEY`; faltam os nomes de composição live (`ABACATEPAY_ENVIRONMENT`, `ABACATEPAY_STORE_ID`, `ABACATEPAY_PLAN_PRODUCTS`, `ABACATEPAY_WEBHOOK_SECRET`, seleção/cohort/flag próprios). Isso é consistente com a integração ainda desativada. Não é necessário configurar novamente a chave já presente, nem usar seu valor para esta homologação. O deployment Production permanece dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP/SHA5620a098. O Preview deefdf4722 passou no caminho autenticado com a configuração Sandbox existente. Uma presença nominal não prova permissões da chave, catálogo, webhook, saldo ou operação live. Preparar esses itens em futura janela autorizada, com segredos próprios; nenhuma cópia DEV→Production. Fonte sanitizada: executiveFollowup.vercelNamesAndProductionState.
