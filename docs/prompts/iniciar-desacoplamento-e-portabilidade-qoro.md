# Prompt de execução — desacoplamento e portabilidade do Qoro

Copie o conteúdo deste documento a partir de **Missão** para a IA que trabalhará no repositório. Este é um roteiro de implementação incremental. Sua preparação não iniciou a migração nem aprovou as decisões arquiteturais ainda pendentes.

## Missão

Assuma a responsabilidade técnica pela execução incremental do plano de portabilidade do Qoro. Trabalhe com competência de arquitetura SaaS, Next.js/TypeScript, PostgreSQL/RLS, identidade, segurança, pagamentos recorrentes, Storage, infraestrutura e testes.

O objetivo é permitir a substituição futura de **Vercel, Supabase e Asaas por capacidade**, preservando comportamento, segurança, dados, contratos e continuidade. Mantenha o monólito modular Next.js e PostgreSQL enquanto isso for coerente com as decisões aprovadas. Não reescreva o sistema nem introduza microserviços apenas para criar independência.

Execute engenharia revisável e testada. Não entregue somente outro plano. Comece pelas atividades locais seguras, prepare as alterações necessárias e avance pelas dependências que estiverem liberadas. Para cada capacidade, diferencie: contrato criado, adapter atual equivalente, alternativa integrada e migração/retorno demonstrados.

**Primeira entrega concreta:** estabelecer uma base de implementação preservada, caracterizar os fluxos afetados e preparar a prova de hospedagem de app e landing fora da Vercel, com dados sintéticos e os provedores atuais preservados. Não comece trocando Auth, banco e gateway juntos.

## 1. Escopo e limites de autorização

Este prompt solicita implementação e validação incremental **local**, preparação de alterações revisáveis e ensaios não produtivos que estejam especificamente autorizados. Não é autorização de publicação ou de alteração de contratos.

1. Leia e cumpra os `AGENTS.md` aplicáveis e as instruções do usuário. Não interprete este prompt como dispensa dessas exigências.
2. Preserve alterações existentes e trabalho de outros agentes. Não use `reset --hard`, `clean`, exclusões em massa, stash automático ou force push para preparar o ambiente.
3. Não faça merge nem deploy de produção. Não altere DNS, variáveis, webhooks, integrações ou configuração dos provedores de produção.
4. Não execute migrations remotas, limpeza de dados, alteração de planos, cancelamentos, cobranças reais, estornos ou mensagens externas sem autorização específica.
5. Uma migration pode ser proposta como arquivo novo; aplicá-la exige conferir ambiente, escopo e autorização. Não edite migrations históricas aplicadas.
6. Novas dependências de produção, mudanças de contratos públicos, refatorações amplas e alterações de CI/build/deploy exigem a confirmação prevista no AGENTS.md. Prepare a proposta concreta e continue as frentes independentes antes de pedir a aprovação específica.
7. Não contrate serviços, mude planos pagos ou ative PITR. Registre custos desconhecidos e solicite decisão antes de gerar despesa.
8. Trate `.env.local` como sensível. Não imprima, copie, altere ou rotacione seu conteúdo; não o leve para imagem, artefato, outro worktree ou ambiente. Use nomes e modelos de configuração para investigar; leia credenciais somente por mecanismo necessário e autorizado, sem exibição.
9. Dados sintéticos são o padrão. Não copie banco, documentos médicos, hashes de senha ou configurações secretas reais para destino novo sem autorização específica de tratamento e custódia.
10. Não enfraqueça RLS, MFA, validação de origem, Turnstile, permissões, verificações financeiras ou testes para conseguir um PASS.
11. Não crie um pagamento Sandbox antes de preparar fixture identificada, estado esperado, rastreabilidade e limpeza. Não repita checkouts já provados sem mudança relevante.
12. Não mande WhatsApp/e-mail, nem use destinatários de clientes, durante a validação. Ensaios devem utilizar sinks/adapters de teste ou efeitos externos especificamente autorizados.
13. Não escolha automaticamente o fornecedor definitivo. Uma prova local de Node/Postgres/objetos não autoriza contratação nem troca comercial.
14. As decisões D01–D12 do plano ainda são propostas. Não transforme sua existência em aprovação. Solicite somente decisões realmente necessárias à etapa dependente e avance no trabalho local independente.

## 2. Localização, estado inicial e preservação do plano

Plano e código auditado:

```text
C:/dev/Qoro_portability_plan_20261106
Branch: docs/provider-portability-plan-20261106
Base auditada do app: 534995b0a41d3b856fa0310e9e4359245a44589a
Repositório: https://github.com/joaomarcos-techia/Project_OS
```

Landing auditada:

```text
C:/dev/Qoro_landing_portability_audit_20261106
Checkout destacado auditado: deb670bbf3dd5c3e5ba521318f052d312f0193bb
Repositório: https://github.com/joaomarcos-techia/landing_page
```

Esses SHAs são a fotografia do plano, não uma garantia de que continuam sendo os HEADs remotos. O diretório `C:/dev/ClinicaOS_V2` foi identificado em snapshot antigo e com alterações alheias. O checkout `C:/dev/qoro` também divergia da main remota. Não os use como base de implementação sem conferir seu estado.

**Atenção:** na entrega do plano havia documentos novos não rastreados e grafos/documentos modificados, ainda sem commit. Um worktree novo criado de `origin/main` não recebe automaticamente esses arquivos.

Proceda assim:

1. Execute leituras de `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list --porcelain` e inventário dos documentos do plano.
2. Confira `origin/main` de cada repositório; buscar refs não autoriza merge, rebase ou checkout sobre trabalho existente.
3. Registre os SHAs reais e o diff relevante desde a fotografia. Reaudite somente os pontos alterados que afetem o plano.
4. Proteja o pacote documental antes de criar a base de implementação. Se houver autorização de commit, faça commit somente dos arquivos revisados do plano, por caminhos explícitos. Caso contrário, mantenha a origem intacta e transfira somente os documentos necessários para o worktree novo, com lista e hashes; sem `.env`, backups, node_modules, sessões ou artefatos sensíveis.
5. Crie um worktree de implementação em pasta nova e branch exclusiva, baseada no código atual escolhido. Sugestão de nome, se estiver livre: `integration/provider-portability-phase1-AAAA-MM-DD`.
6. Confira a compatibilidade de Node, package manager e dependências. Não reutilize junction de node_modules sem verificar versões/lockfile, nem apague instalação alheia para resolver conflito.
7. Crie um registro de execução antes de modificar produto: `docs/quality/execucao-portabilidade-AAAA-MM-DD.md`.

Este registro deve conter: escopo da rodada, SHAs, worktrees, alterações anteriores preservadas, tarefas selecionadas, autorizações aplicáveis, ambientes permitidos, riscos e evidências. Não registre segredos.

## 3. Leitura obrigatória do pacote de planejamento

Todos os caminhos abaixo são relativos a `C:/dev/Qoro_portability_plan_20261106`. Leia integralmente o núcleo e, antes de atuar em cada camada, releia o respectivo plano, os consumidores do código e os testes. Não implemente a partir de títulos ou de um resumo de conversa.

### 3.1 Núcleo: contexto, evidências e arquitetura

1. `docs/decoupling/README.md`
2. `docs/decoupling/01-resumo-executivo.md`
3. `docs/architecture/01-contexto-atual.md`
4. `docs/architecture/02-inventario-de-dependencias.md`
5. `docs/architecture/03-diagramas-as-is.md`
6. `docs/architecture/dependency-graph.mmd`
7. `docs/architecture/context-map.mmd`
8. `docs/architecture/event-flow.mmd`
9. `docs/architecture/arch-metrics.json`
10. `docs/decoupling/inventario-codigo.json`
11. `docs/decoupling/02-matriz-vendor-lock-in.md`
12. `docs/architecture/04-arquitetura-to-be.md`
13. `docs/architecture/05-contratos-e-adaptadores.md`
14. `docs/architecture/06-decisoes-arquiteturais.md`

### 3.2 Execução, testes, riscos e retorno

15. `docs/decoupling/03-roadmap-mestre.md`
16. `docs/decoupling/tarefas.json`
17. `docs/decoupling/04-plano-supabase.md`
18. `docs/decoupling/05-plano-asaas.md`
19. `docs/decoupling/06-plano-vercel.md`
20. `docs/decoupling/07-matriz-edge-cases.md`
21. `docs/decoupling/08-plano-de-testes.md`
22. `docs/decoupling/09-gates-de-validacao.md`
23. `docs/decoupling/10-matriz-de-riscos.md`
24. `docs/decoupling/11-plano-de-migracao.md`
25. `docs/decoupling/12-plano-de-rollback.md`
26. `docs/decoupling/13-criterios-de-aceite.md`
27. `docs/decoupling/14-scorecard-de-portabilidade.md`
28. `docs/decoupling/15-cronograma-e-dependencias.md`
29. `docs/decoupling/validacao-do-pacote.md`
30. `docs/decoupling/validacao.json`
31. `docs/runbooks/provider-cutover.md`
32. `docs/runbooks/provider-rollback.md`

### 3.3 Convenções existentes e continuidade

Leia também:

```text
docs/README.md
docs/CURRENT-STATE.md
docs/CONVENTIONS.md
docs/architecture/context-map.md
docs/database/schema.md
docs/backend/http-jobs-outbox.md
docs/frontend/routes-and-access.md
docs/security/model.md
docs/billing/subscriptions.md
docs/integrations/providers.md
docs/operations/deployment-observability.md
docs/development/setup.md
docs/development/environment.md
docs/development/testing.md
docs/engineering/decision-guide.md
docs/engineering/definition-of-done.md
docs/adr/README.md
docs/runbooks/README.md
docs/runbooks/disaster-recovery.md
docs/runbooks/migrations.md
docs/runbooks/runtime-role-nobypassrls.md
docs/runbooks/incident-response.md
docs/runbooks/alerting-setup.md
docs/runbooks/recuperacao-portavel-e-rotina-2026-10.md
docs/runbooks/backup-real-b2-bitwarden.md
docs/quality/aceite-risco-backup-2026-10-30.md
```

Se um caminho mudou, localize seu sucessor por Git/rg e registre a mudança. Não invente o conteúdo ausente. Consulte as ADRs específicas dos módulos tocados a partir do índice e do catálogo E01–E25.

## 4. O que já foi comprovado e o que ainda não foi

Na fotografia do plano:

- 13 contexts de negócio; 57 Route Handlers; 136 migrations; 21 schedules Vercel.
- Grafo gerado: 58 elementos, 316 arestas agregadas e zero ciclos entre módulos.
- Caracterização local: 216 testes aprovados em 12 arquivos.
- Foram validados os links, tarefas, IDs de cenário e a sintaxe dos diagramas do pacote.
- Não houve execução do app em outro host, de Auth/Storage/DB alternativos ou de segundo gateway.
- Os contratos novos e as decisões arquiteturais ainda não foram implementados/aprovados.
- Restores e testes financeiros anteriores são evidências históricas dos respectivos SHAs/ambientes, não homologação dos destinos futuros.

Não repita a suíte inteira ou pagamentos só para reconstruir histórico. Primeiro verifique se a prova ainda se aplica ao código atual. Após novas alterações, execute os testes afetados e os gates exigidos para aquela entrega.

O aceite anterior de risco de backup não é autorização de perda de dados em nova migração, nem PASS de cópia independente. Não reabra a exigência de contratar PITR; preserve a decisão financeira e explicite o risco pertinente à nova janela.

## 5. Regras técnicas que devem permanecer verdadeiras

1. **Tenant:** contexto de clínica verificado, papel runtime apropriado, RLS e transação; nunca fallback para admin porque o adapter novo falhou.
2. **Identidade:** sujeito/issuer verificados, UUID interno estável, usuário ativo, claims_version e MFA. E-mail não é chave suficiente para unir identidades.
3. **Financeiro:** preço, trial, plano, período, cota e direitos pertencem ao Qoro. Preserve o desconto vitalício e todos os contratos legados.
4. **SaaS versus paciente:** mensalidade paga à Qoro e cobrança do paciente na conta da clínica são domínios distintos.
5. **Gateway:** binding persistido por contrato/conta/operação; timeout não autoriza repetir criação em outro provider.
6. **Confirmação:** pagamento confirmado não significa dinheiro liquidado; refund solicitado não significa DONE; mensagem aceita não significa entregue.
7. **Segredos:** preservar versões/chaves/salts necessários aos dados antigos. Não rotacionar criptografia simultaneamente à troca de banco.
8. **Arquivos:** privado continua privado, acesso clínico continua autorizado e exclusões não podem ser ressuscitadas por cópia/rollback.
9. **Jobs:** um escritor autoritativo e uma geração de scheduler ativo por domínio; efeitos externos não ganham exactly-once só porque existe outbox.
10. **Ambiente:** nenhum Preview/local pode cair implicitamente na produção. Origem/Host livre do request não escolhe destino confiável.
11. **Oferta:** não alterar preços, trial, franquias, cotas, cancelamento ou disponibilidade de modalidade anual como efeito colateral técnico.
12. **Tecnologia:** sair do Supabase gerenciado por self-hosting não significa eliminar dependência da tecnologia Supabase. Manter PostgreSQL é uma escolha explícita, não falha de portabilidade.

## 6. Camada 0 — baseline e decisões antes da implementação dependente

**Tarefas:** B00, B01, B02; O01/O02 nos escopos liberados.

Leia os arquivos reais de configuração:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
vitest.config.ts
eslint.config.mjs
next.config.ts
vercel.json
.env.example
.gitignore
.prettierignore
playwright.config.ts
playwright.ci.config.ts
playwright.httponly.config.ts
.github/workflows/ci.yml
.github/workflows/db-backup.yml
scripts/arch-graphs.ts
scripts/arch-db-check.ts
scripts/check-migration-safety.ts
scripts/check-observability-drift.ts
scripts/check-handler-registry.ts
```

Procedimento:

1. Reconcilie os documentos com código e configuração atuais. Precedência: código/configuração → testes/readbacks → documentos → histórico.
2. Selecione tarefas pequenas e prepare critérios de aceite antes de editar.
3. Catalogue testes existentes e lacunas, com fixtures sintéticas de duas clínicas.
4. Registre decisões aprovadas e pendentes. As decisões podem ser aprovadas por etapa; não obtenha um GO genérico para todos os riscos.
5. Faça caracterização das fronteiras tocadas antes de alterar seu comportamento.
6. Para trabalho puramente local e sintético, avance sem exigir um novo restore de produção. Antes de copiar dados reais ou executar cutover, G0 operacional deve ser atendido ou formalmente tratado.

**Saída:** base preservada, tarefa e ambiente identificados, risco/rollback/testes definidos e nenhuma aprovação pendente escondida.

## 7. Camada 1 — ambiente, configuração e origens

**Tarefa principal:** H01. **Gate:** G3-host, respeitando G1/G2 aplicáveis.

Leia:

```text
src/lib/env.ts
src/lib/env-aliases.ts
src/lib/env-coherence.ts
src/lib/http/application-url.ts
src/lib/http/content-security-policy.ts
src/lib/http/cron-auth.ts
src/lib/db/index.ts
src/middleware.ts
src/lib/env.test.ts
src/lib/env-coherence.test.ts
src/lib/http/application-url.test.ts
src/lib/http/cron-auth.test.ts
src/middleware.test.ts
```

Trabalho:

- Preparar ambiente explícito e identidade esperada do backend, sem depender só de VERCEL_ENV ou do formato do domínio Supabase.
- Encapsular metadados Vercel num contexto de deployment, preservando compatibilidade com o deployment atual.
- Separar origem confiável, aliases aprovados e callbacks externos; impedir open redirect, bypass vazado e Preview→prod.
- Decidir configuração pública por build versus runtime. Não transformar NEXT*PUBLIC*\* em lookup dinâmico que o bundler não incorpora.
- Verificar quais mudanças são locais e quais alteram contrato público/build/deploy e exigem aprovação específica.

Testar valores ausentes/inválidos, ambientes incompatíveis, custom domains, host/Origin forjados, localhost controlado, callbacks e os caminhos existentes Vercel. Um env novo sem consumidor/teste/documentação não conclui H01.

## 8. Camada 2 — hospedagem, jobs e landing

**Tarefas:** H02, H03, H04, O04, X01. **Gate:** G7.

Arquivos do app:

```text
next.config.ts
vercel.json
src/app/api/cron/                 (todos os Route Handlers)
src/app/api/health/route.ts
src/lib/http/health-auth.ts
src/lib/http/health-probes.ts
src/lib/http/cron-auth.ts
src/lib/http/application-url.ts
src/lib/storage/clinic-logo-policy.ts
src/lib/db/index.ts
src/lib/outbox/worker.ts
src/lib/outbox/registry.ts
src/lib/outbox/catalog.ts
src/lib/outbox/side-effects.ts
src/lib/outbox/publish.ts
src/lib/outbox/janitor.ts
src/lib/crypto/secret-provider.ts
src/lib/observability/            (logger, metrics, capture e contexto)
security-e2e/http-only-session.spec.ts
scripts/security/local-build.ts
scripts/security/local-http.ts
scripts/security/bundle-check.ts
```

Arquivos da landing, relativos ao checkout correto dela:

```text
package.json
package-lock.json
vite.config.ts
vercel.json
.env.example
index.html
src/routes.tsx
src/entry-server.tsx
src/lib/comecar.ts
src/lib/conversao.ts
src/lib/eventos.ts
src/data/planos.ts
src/layouts/PageShell.tsx
scripts/prerender.mjs
scripts/serve.mjs
scripts/verificar-comecar.mjs
scripts/verificar-conversao.mjs
scripts/verificar-links.mjs
scripts/testar-seguranca.mjs
```

Procedimento:

1. Preparar build reproduzível de Next/Node compatível com a versão efetiva. Dockerfile/.dockerignore/standalone são alterações a revisar, não arquivos já existentes confirmados pelo plano.
2. Provar PDF/WASM/fontes, pacote lazy de secrets quando habilitado, startup, readiness, shutdown, diretórios temporários e limites de upload.
3. Reproduzir os 21 schedules a partir do manifesto, com UTC, autenticação correta por rota, deadline/retry/lease e heartbeat.
4. Não ligar scheduler de teste sobre DEV compartilhado sem autorização e isolamento de efeitos. Preferir backend local sintético.
5. Provar autenticação entre réplicas, cache/invalidação, Server Actions, headers, cookies e proxy confiável. Calcular orçamento de conexão por réplica/pool/worker.
6. Na landing estática, preservar prerender, diretórios/index, 404 real, redirects, CSP/TLS e atribuição. Preparar host allowlist/CTA de Preview sem redirecionamento livre.
7. Tratar Analytics Vercel como dependência própria: substituir ou obter aceite da perda de medição; não alterar a definição de conversão Ads por acidente.
8. Executar browser desktop/mobile e rollback de release/scheduler em ambiente isolado.

**Não declare G7 PASS por iniciar a home com next start.** Exija os fluxos críticos, os jobs, callbacks, observabilidade e o retorno.

## 9. Camada 3 — Storage e referências de objetos

**Tarefas:** S01–S04. **Gates:** G3-storage e G5S.

Leia:

```text
src/lib/storage/clinical.ts
src/lib/storage/clinical.test.ts
src/lib/storage/exports.ts
src/lib/storage/admin-exports.ts
src/lib/storage/clinic-assets.ts
src/lib/storage/clinic-logo-policy.ts
src/lib/auth/supabase-admin.ts
src/contexts/clinical/schema.ts
src/contexts/tenancy/schema.ts
src/contexts/financial/schema.ts
src/lib/email/templates/clinic-invite.ts
src/lib/email/templates/signup-confirmation.ts
src/lib/email/templates/team-invite.ts
src/lib/email/templates/password-reset.ts
src/lib/email/templates/signup-code.ts
scripts/recovery/                (leia cada script antes de usá-lo)
```

Procedimento:

1. Extrair contrato mínimo de objetos e adapter Supabase preservando a facade dos helpers atuais.
2. Cobrir upload/download/head/list paginado/delete, MIME/tamanho, overwrite, hash e classificação de acesso.
3. Inventariar leitores de paths e URLs persistidas. Manter leitura compatível; não reescrever documento clínico assinado para trocar domínio de imagem.
4. Preservar rota clínica same-origin autorizada. Logo público, export assinado e PDF clínico privado têm políticas diferentes.
5. Implementar segundo adapter somente para destino/capacidades aprovados. Emulador/fake prova contrato, não homologação de um serviço externo.
6. Preparar manifesto cifrado, verificação de integridade, checkpoint/delta, tombstones e retorno. Testar com sintéticos.
7. Não copiar arquivos médicos reais até haver autorização do destino/custódia e recuperação pertinente à janela.

**Gate:** bytes e referências íntegros, privado recusado ao anônimo/tenant errado, exclusões preservadas e retorno demonstrado.

## 10. Camada 4 — assinatura SaaS, pagamento de paciente e gateway

**Tarefas:** F01–F06, X02. **Gates:** G3-finance e G4.

Leia:

```text
src/lib/payments/asaas/index.ts
src/lib/payments/account-store.ts
src/lib/payments/account-lock.ts
src/lib/payments/account-closure.ts
src/contexts/billing/schema.ts
src/contexts/billing/api.ts
src/contexts/billing/proposed-offer.ts
src/contexts/billing/internal/state-machine.ts
src/contexts/billing/internal/subscriptions.ts
src/contexts/billing/internal/provider-sync.ts
src/contexts/billing/internal/plan-changes.ts
src/contexts/billing/internal/plan-change-provider-sync.ts
src/contexts/billing/internal/plan-change-payment.ts
src/contexts/billing/internal/billing-cycle-provider-sync.ts
src/contexts/billing/internal/billing-period.ts
src/contexts/billing/internal/cancellation-charges.ts
src/contexts/billing/internal/annual-prepay.ts
src/contexts/billing/internal/dunning.ts
src/contexts/billing/internal/access.ts
src/contexts/billing/internal/provisioning.ts
src/contexts/payments/schema.ts
src/contexts/payments/internal/hosted-checkout.ts
src/contexts/payments/internal/charge-store.ts
src/contexts/payments/internal/deposit-charge.ts
src/contexts/payments/internal/remainder-charge.ts
src/contexts/payments/internal/excess-refund.ts
src/contexts/payments/internal/excess-refund-reconcile.ts
src/contexts/payments/internal/patient-payment-risk.ts
src/app/api/webhooks/asaas/route.ts
src/app/api/webhooks/asaas/patient/[ref]/route.ts
src/app/api/cron/billing-reconcile/route.ts
src/app/api/cron/billing-dunning/route.ts
src/app/api/cron/financial-reconcile/route.ts
src/app/api/cron/payments-deposit/route.ts
src/contexts/onboarding/internal/signup-hosted-checkout.ts
src/contexts/onboarding/internal/signup-checkout.ts
src/contexts/onboarding/internal/signup-billing.ts
src/contexts/onboarding/internal/signup-trial.ts
scripts/security/subscription-plan-change-sandbox.ts
scripts/security/subscription-cancellation-sandbox.ts
scripts/security/signup-webhook-sandbox.ts
scripts/security/signup-billing-sandbox.ts
```

Leia também os testes adjacentes e os produtores/consumidores em financial, scheduling e onboarding encontrados pelo inventário. Métodos presentes no adapter não provam que a UI oferece todas as modalidades.

Procedimento:

1. Extrair portas por capacidade a partir do PaymentProvider existente. Não criar outro contrato universal com os mesmos tipos proprietários.
2. Normalizar ciclos/estados/erros mantendo diferença entre obrigação paga, liquidação, refund e disputa. Alterar unidade monetária exige contrato e testes próprios; não reinterpretar valores persistidos.
3. Separar tradução de webhook autenticado de aplicação de regras. Preservar readback autoritativo, body cap, dedup e transação local.
4. Projetar namespace `{provider, accountRef, externalId}` e binding persistido por contrato/conta/operação. Novas colunas/índices/backfill exigem revisão e autorização da migration no ambiente específico.
5. Preservar reserva/lease/checkpoint e erro de resultado desconhecido. Nenhum failover de criação financeira por variável global.
6. Demonstrar no Asaas atual a equivalência dos consumidores modificados antes de implementar o adapter secundário.
7. Selecionar o gateway futuro por capacidades verificadas e decisão aprovada. Se um método/ciclo/cancelamento/readback não for suportado, retornar unsupported e isolar a decisão comercial.
8. Provar Sandbox do segundo gateway com fixture e readback/DB/UI. Não confundir simulador com prova de API/tokenização/mandato.
9. Roteamento para novos contratos e transferência de antigos são etapas distintas. Cartões e mandatos não são presumidos exportáveis.
10. Manter obrigações, webhooks, refunds e chargebacks antigos na origem. Não encerrar conta/credencial antiga por cleanup enquanto houver obrigação.

**Gate:** nenhuma cobrança/benefício duplicado, centavos/períodos/cotas corretos, contratos legados intactos e divergência financeira explicada/resolvida. Repasse interno não é split bancário; NF não é recurso a inventar nesta migração.

## 11. Camada 5 — identidade, sessão, cadastro e autorização

**Tarefas:** I01–I05. **Gates:** G3-identity e G5I.

Leia:

```text
src/lib/auth/README.md
src/lib/auth/supabase-server.ts
src/lib/auth/supabase-admin.ts
src/lib/auth/supabase-session-cookie.ts
src/lib/auth/tenant-context.ts
src/lib/auth/claims.ts
src/lib/auth/session-epoch.ts
src/lib/auth/permissions.ts
src/lib/auth/roles.ts
src/lib/auth/mfa.ts
src/lib/auth/action-guard.ts
src/lib/auth/page-guard.ts
src/lib/auth/rate-limit.ts
src/lib/auth/recovery-grant.ts
src/lib/auth/recovery-consumption.ts
src/lib/auth/signup-confirmation-grant.ts
src/lib/auth/signup-password.ts
src/lib/auth/policies/            (todos os arquivos)
src/contexts/identity/schema.ts
src/contexts/identity/internal/members.ts
src/contexts/onboarding/schema.ts
src/contexts/onboarding/internal/signup-session.ts
src/contexts/onboarding/internal/signup-draft.ts
src/contexts/onboarding/internal/signup-draft-snapshot.ts
src/contexts/onboarding/internal/signup-auth-admin.ts
src/contexts/onboarding/internal/signup-auth-binding.ts
src/contexts/onboarding/internal/signup-email-code.ts
src/contexts/onboarding/internal/signup-email-code-repository.ts
src/contexts/onboarding/internal/signup-recovery.ts
src/contexts/onboarding/internal/signup-provision.ts
src/contexts/onboarding/internal/signup-trial.ts
src/contexts/onboarding/internal/turnstile.ts
src/app/(app)/auth/               (routes e actions pertinentes)
src/app/(app)/logout/route.ts
security-e2e/http-only-session.spec.ts
scripts/security/signup-local-backend.ts
scripts/security/signup-local.integration.ts
scripts/security/signup-code-db.ts
scripts/security/signup-provision-db.ts
```

Procedimento:

1. Separar sessão/identidade verificada da autorização Qoro. Continuar lendo perfil/ativo/claims_version e permissões no servidor.
2. Definir issuer+subject → UUID Qoro estável. Confirmar todas as FKs e efeitos de exclusão; e-mail igual não autoriza unir contas.
3. Introduzir expansão compatível de schema antes de remover dependência de auth.users. Não quebrar autores de prontuários/auditoria.
4. Confirmar suporte real do alvo para hashes, refresh, reset, OAuth e MFA. Preparar reautenticação/re-enrollment quando necessário, com aprovação de experiência/comunicação.
5. Preservar jornada de código/retomada, senha única, plano escolhido e timestamps. Não reiniciar trial ao importar identidade nem gerar outro checkout/tenant.
6. Provar sessão ativa, expiração, logout/replay, troca de função, usuário desativado, MFA e recuperação atravessando cutover/retorno.
7. Provar duas clínicas e negativas reais de autorização em browser, API e DB.

**Gate:** identidade alternativa funcional com regras de autorização e continuidade preservadas; nenhuma transferência de sessão ou fator presumida.

## 12. Camada 6 — PostgreSQL fora do Supabase

**Tarefas:** D01–D04. **Gate:** G6, com as dependências de identidade resolvidas.

Leia:

```text
src/lib/db/index.ts
src/lib/db/tenant.ts
src/lib/db/schema/index.ts
src/lib/db/schema/infra/          (todos os schemas de infraestrutura)
drizzle.config.ts
drizzle/migrations/              (sequência completa e metadados pertinentes)
drizzle/migrations/0001_tenancy_foundation.sql
drizzle/migrations/0003_identity_core.sql
drizzle/migrations/0045_rls_v2_and_least_privilege.sql
scripts/check-migration-safety.ts
scripts/db-migrate-dev.ts
scripts/db-migrate-prod.ts
scripts/db-backup-prod.ts
scripts/restore-test.ts
scripts/security/scratch-schema.ts
scripts/security/tenant-isolation.ts
scripts/security/contract-owner-db.ts
scripts/security/offer-legacy-migration-db.ts
scripts/security/offer-restored-backup-db.ts
src/lib/crypto/index.ts
src/lib/crypto/encryption.ts
src/lib/crypto/secret-provider.ts
```

Os scripts com `prod` são leitura de implementação; sua listagem não autoriza execução. Leia migrations em ordem para entender o schema final, não apenas três exemplos.

Procedimento:

1. Inventariar roles/grants, RLS/policies, auth functions/FKs, extensões, triggers, views, partições, publicações e sequences efetivas numa cópia autorizada.
2. Diferenciar recursos PostgreSQL de serviços/esquemas Supabase. Não fazer stubs que devolvem identidade constante para passar migrations.
3. Preparar bootstrap mínimo e reproduzível no Postgres alvo, com role runtime sem BYPASSRLS e serviço/worker separado.
4. Executar migrations do zero e upgrade de snapshot isolado; os dois caminhos devem passar.
5. Confirmar keys/salts/versões e decrypt sintético de dados antigos antes de declarar restore válido.
6. Medir volume e escolher pausa controlada ou sincronização incremental fundamentada. Não adotar CDC/dual-write por preferência.
7. Provar delta, concorrência, sequences, encoding/timezone, constraints/índices, integridade, RLS e consultas críticas.
8. Preservar snapshot base e validar rollback com dados escritos depois do corte. Restore antigo sobre escritor ativo não é rollback aceitável.

**Gate:** Postgres alternativo opera o produto com segurança e integridade; restore de tabelas sozinho não conclui a camada.

## 13. Camada 7 — proteção transversal e operação

**Tarefas:** O01–O04, acompanhando as demais camadas.

- Reutilize logs/metrics/audit existentes e mantenha correlação sem dados médicos/segredos.
- Valide entrega de alerta, não apenas criação de configuração de monitor.
- Mantenha testes arquiteturais de imports, inclusive reexports e imports computados, sem bloquear por convenção apenas.
- Compare o grafo e fan-in/fan-out para identificar novas dependências estruturais.
- Preserve backup SQL, binários do Storage, configurações Auth e custódia das chaves como componentes diferentes.
- Meça limites de conexão, memória, latência, timeout, backlog, cold start e custos do alvo com carga comparável.
- Não declare que autoscaling resolve capacidade sem calcular pools × réplicas e concorrência dos jobs.
- No novo host, comprove funcionamento de crypto, Resend, Meta, Gemini, Upstash e Turnstile que permanecerem habilitados. Use sintéticos e efeitos isolados; sair da Vercel não elimina essas dependências.

## 14. Camada 8 — exercícios de saída e falhas compostas

**Tarefas:** X01–X04. Não executar tudo simultaneamente em produção.

1. **Exercício C / X01:** app e landing fora Vercel, mantendo provedores atuais de teste. Demonstrar fluxo funcional, segurança, scheduler, observabilidade e retorno.
2. **Exercício B / X02:** recorrência/checkout/readback/webhook/reconciliação no gateway secundário, convivência de contratos e tratamento de efeitos incertos.
3. **Exercício A / X03:** identidade, Storage e PostgreSQL alternativos operando os fluxos essenciais, incluindo duas clínicas e recuperação do serviço.
4. **Combinado / X04:** executar C01–C07 da matriz depois de A/B/C; medir comportamento com pagamento durante cópia, sessão durante mudança, webhook atrasado durante retorno, exclusão durante sincronização e rollback de app com schema expandido.

Cada exercício exige fixture, estado inicial, estímulo, invariantes, readbacks, evidência segura e encerramento/cleanup confirmado. Sem teste real de uma capacidade crítica, ela permanece PENDENTE/BLOCKED.

## 15. Camada 9 — consolidação e eventual janela futura

**Tarefa:** X05. **Gate:** G9.

Atualize runbooks para que outro operador consiga reproduzir build, configuração, recovery, cutover e retorno. Registre dependências deliberadas e obrigações antigas; não apague provedor/origem por completar o adapter novo.

Uma janela real futura precisa de aprovação específica contendo: capacidade, cohort, SHAs, alvo/conta, config, schema, escopo de dados, backup/restore, método de writer único, duração/abort e recuperação. Não reutilize autorizações históricas de rollout ou migrations numeradas anteriores.

O procedimento deverá contemplar:

1. Gates e configuração conferidos no SHA real.
2. Snapshot/custódia/restauração pertinentes à janela.
3. Compatibilidade N/N-1 e migrations aditivas preflightadas.
4. Controle implementado e testado dos writers afetados. SIGNUP_ENABLED fecha cadastro, não toda a escrita do sistema.
5. Um scheduler ativo; origem anterior retida conforme o plano.
6. Corte, smoke funcional/segurança e reconciliação.
7. Retorno que preserve escritas, objetos, identidades e obrigações posteriores.
8. Observação e aceite antes de revogar credenciais ou remover recursos.

## 16. Ordem de implementação e controle dos gates

Mapa completo de tarefas, sem eliminar dependências do JSON:

| Ordem lógica              | IDs                               | Resultado esperado                                       |
| ------------------------- | --------------------------------- | -------------------------------------------------------- |
| Base e decisões           | B00, B01, B02                     | Estado preservado, caracterização e fronteiras revisadas |
| Configuração              | H01                               | Ambiente/origens seguros e compatíveis                   |
| Primeira prova de hosting | H02, H03, H04, O04, X01           | App/landing e jobs homologados fora Vercel               |
| Storage                   | S01, S02, S03, S04                | Segundo backend com bytes/ACL/retorno                    |
| Financeiro                | F01, F02, F03, F04, F05, F06, X02 | Semântica própria e gateway secundário com convivência   |
| Identidade                | I01, I02, I03, I04, I05           | Sujeito, sessão, autorização e jornada preservados       |
| Banco                     | D01, D02, D03, D04, X03           | PostgreSQL alternativo com segurança e recovery          |
| Transversais              | O01, O02, O03, O04                | Observabilidade, proteção, recuperação e capacidade      |
| Integração e operação     | X04, X05                          | Falhas compostas, retorno e procedimentos homologados    |

As tarefas transversais começam quando suas dependências forem atendidas; não espere o fim de todas as camadas. Contratos podem avançar de forma independente; cutovers de identidade e banco exigem prova conjunta. A numeração histórica de gates não impõe ordem numérica: G7 de hosting pode anteceder G4/G6, sem aprová-los.

**Desambiguação:** existem IDs iguais em catálogos diferentes. Use `TASK-D01` para a tarefa de Postgres, `ADR-D01` para a decisão e `CASE-D01` para cenário de dados. Não renomeie os IDs originais nos arquivos sem necessidade.

Uma dependência bloqueada congela a tarefa dependente, não todas as frentes. Não pule a dependência apenas para declarar avanço.

## 17. Testes e Definition of Done por entrega

Confirme os comandos atuais em package.json/CI. A fotografia do app usava Node 22 e pnpm 11.17.0; a landing usava npm e seu próprio lockfile. Não imponha essas versões se houver atualização aprovada posterior.

No app, conforme a alteração:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:coverage
pnpm arch:check
pnpm arch:db-check
pnpm arch:graphs --check
pnpm check:migrations
pnpm check:observability
pnpm check:registry:strict
pnpm security:inventory
pnpm security:tenant
pnpm security:build
pnpm security:bundle
pnpm security:http
pnpm security:browser-session
pnpm test:e2e:ci
```

Esses comandos não são uma ordem para executá-los sem ler pré-requisitos. Suites de banco/serviço precisam do harness isolado; checks com rede, seeds ou cleanup precisam de ambiente e autorização conferidos. Rode testes direcionados durante a mudança; complete os gates exigidos antes de declarar a entrega pronta.

Na landing, confirme e reutilize os scripts existentes:

```text
npm run typecheck
npm run lint
npm run build
npm run comecar
npm run conversao
npm run seguranca
```

Após cada entrega:

1. Ler consumidores e invariantes antes de escrever.
2. Fazer mudança pequena, tipada e compatível, reutilizando helpers.
3. Adicionar/ajustar testes de comportamento e de falha relevantes.
4. Rodar testes, typecheck/lint/build aplicáveis, corrigir e repetir quando necessário.
5. Verificar efeito real no nível apropriado: DB, provider, browser ou runtime. UI renderizada e mock não substituem readback.
6. Reler diff: sem alterações alheias, segredos, dependência não aprovada ou refatoração acidental.
7. Atualizar execução, testes, documentação e limitações.
8. Criar commit pequeno/descritivo somente conforme o escopo de Git autorizado; não publicar branch, PR ou deployment por pressuposição.

Não desative teste nem transforme exceção em skip para passar. Se faltar ferramenta/acesso, registre o comando não executado e a dependência concreta; continue outras atividades seguras.

## 18. Evidência, status e acompanhamento

Para cada tarefa registre no documento de execução:

```text
ID e camada:
SHA / worktree / ambiente:
Status: PENDENTE / EM EXECUÇÃO / PASS / FAIL / BLOCKED / CONDITIONAL
Autorizações e decisões aplicáveis:
Arquivos/funções alterados:
Comportamento anterior e novo:
Testes/comandos e códigos de saída:
Readbacks e artefatos sanitizados:
Fixture e cleanup:
Riscos e limitações:
Rollback e prova:
Gate e aprovador, quando exigido:
Próxima tarefa liberada:
```

`CONDITIONAL` exige exceção expressa, responsável e prazo. Não marque CONDITIONAL sozinho para ultrapassar um gate. PASS de uma tarefa não é PASS de uma camada inteira nem GO de produção.

Propostas quantitativas de latência, RPO/RTO e rollback no plano precisam de aprovação/medição. Não as apresente como SLA adquirido. Nenhum teste demonstra ausência absoluta de qualquer falha possível; cubra sistematicamente os 79 cenários e acrescente diferenças identificadas nos novos providers.

## 19. Quando parar e solicitar ação humana específica

Pare somente a operação dependente quando houver:

- Decisão arquitetural/comercial necessária ainda não aprovada.
- Novo custo, conta/contratação, KYC ou acesso administrativo indispensável.
- Operação destrutiva, mutation de serviço, migração remota, dados reais ou produção fora do escopo autorizado.
- Alteração que o AGENTS.md exige confirmar antes de executar.
- Falha de autorização, perda/inconsistência de dados, duplicidade financeira, exposição de segredo/arquivo privado ou retorno inviável.

Entregue a decisão concreta, evidência, alternativas, recomendação, impacto e o trecho da regra aplicável. Não peça outra autorização geral para o projeto. Não solicite segredo no chat. Deixe a preparação local revisável e prossiga nas tarefas independentes.

## 20. Relatório ao encerrar a rodada

Entregue:

1. Objetivo da rodada e entregas realmente executadas.
2. Tabela por tarefa/camada/gate: status, ambiente, evidência e próxima ação.
3. Arquivos alterados e por quê, com links.
4. Testes executados e números reais; testes não executados e motivo.
5. Preservação de dados, contratos legados, privacidade e compatibilidade.
6. Provas de portabilidade adquiridas, separadas das interfaces apenas implementadas.
7. Falhas encontradas/corrigidas e risco residual.
8. Estado Git: branch, worktree, commits locais, alterações pendentes e qualquer publicação autorizada.
9. Decisões/acessos exclusivamente humanos, com passos e links oficiais quando conhecidos.
10. Próxima tarefa técnica concreta e dependências.

Prepare um checkpoint suficiente para outro engenheiro continuar sem reconstruir a conversa. Não marque a migração global concluída enquanto os exercícios A/B/C, segurança, recuperação e retorno não estiverem comprovados.

## Início obrigatório da execução

Comece agora pela **preservação da base e leitura do núcleo**, confirme o código atual e selecione as primeiras tarefas locais de B00/B01/B02 e preparação de H01. Apresente brevemente o recorte inicial e avance no que estiver autorizado.

O resultado da primeira rodada deve ser engenharia concreta e validada, ou propostas de mudança prontas para a aprovação específica quando uma regra exigir isso. Não finalize apenas com a frase "é necessário criar adapters". Também não pule diretamente para migração financeira, troca de Auth ou publicação em produção.
