# DOCS REFACTOR CHECKPOINT

## Visibilidade de cadastros no admin — 03/11/2026

Em implementação isolada: [diagnóstico e validação](docs/quality/admin-cadastros-e-trial-2026-11-03.md).
As três contas Auth de hoje ainda não confirmaram o e-mail nem provisionaram clínica; o admin
passa a mostrá-las em seção própria, sem alterar contagens de tenants ou apagar dados expirados.
A regra de trial de 14 dias e a documentação de troca/cancelamento foram conferidas com o código.
Produção permanece no merge `3fba02a3`; esta correção ainda não foi publicada.

## Correção do cadastro — 31/10/2026

Em desenvolvimento isolado na branch `fix/signup-single-password-20261031`: coleta da senha após
confirmação e continuação no mesmo aparelho, conforme pedido do founder. Fonte desta alteração:
[validação da senha única](docs/quality/cadastro-senha-unica-2026-10-31.md), com decisão na
[ADR-062, seção 12](docs/adr/062-identidade-consentimento-cadastro.md). Não altera preços, contratos,
migrations ou campanhas. O fluxo novo ainda precisa da evidência Preview/DEV; a publicação anterior
abaixo permanece histórica e não equivale a um PASS desta correção.

## Janela de produção autorizada — 30/10/2026

Fonte atual: [publicação executada e encerrada](docs/quality/publicacao-oferta-2026-10-30.md). App #42, complemento #44 e landing #3 mesclados/publicados, 15 migrations aplicadas e contratos preservados. **GO operacional mensal: cadastro reaberto após Turnstile real 3/3 correlacionado com HTTP 200**, às 22:27:25 UTC; novo deployment `dpl_J1dQNbzxS2GL8yNHfUgYNnai1gmt`, SHA `71cc5643`, READY às 22:36:38 UTC. CI 5.828/5.828; 15/15 probes públicos e 2/2 E2E autenticados após reabertura; 381 requisições sem 5xx na amostra. Anual novo continua desativado. Runbook, guia humano e evidência sanitizada atualizados; não repetir trabalho aplicado nem pedir a senha de backup dispensada. Esta atualização documental não altera código ou contratos. Riscos e limites permanecem no registro, inclusive cópia independente NOT RUN/risco aceito. O checkpoint histórico de refatoração abaixo fica preservado.

## Continuidade operacional — 30/10/2026

A resposta do founder encerrou a pergunta sobre recursos: não há mídia externa, armazenamento aprovado ou gerenciador. A fonte da escolha atual é [backup independente sem compra](docs/runbooks/backup-independente-sem-custo-2026-10.md); o [guia humano](docs/runbooks/acoes-manuais-pendentes-pricing-2026-10.md) e o [fechamento](docs/quality/fechamento-definitivo-oferta-2026-10-30.md) apontam para ela. Inclui fontes oficiais, B2/Bitwarden/papel como piloto proposto, dimensionamento sanitizado e limites contratuais/operacionais. A comparação histórica foi preservada e marcada como superada. O estado da refatoração antiga abaixo não é evidência de recuperação independente ou autorização de publicação.

## Status

- estado: CONCLUÍDA — refatoração, validação conectada e revisão final executadas
- percentual aproximado: 100%
- última etapa concluída: formatação, links internos/externos, status documental, checks de migrations/observabilidade e diff aprovados
- próxima etapa: manter o worktree local e incluir os docs junto da próxima alteração de código; não criar branch, commit ou push nesta tarefa

## Regras de decisão

- implementação real > testes/evidência executável > documentação > intenção futura
- funcionalidade inexistente não pode aparecer como implementada
- código no repositório prova implementação estrutural; não prova configuração, migration, entrega ou saúde em produção
- estado atual, ADR, operação, auditoria histórica e roadmap não podem redefinir o mesmo conceito
- cada conceito importante terá uma fonte canônica; arquivos auxiliares apenas apontarão para ela
- incerteza externa será marcada como `REQUIRES_MANUAL_VALIDATION`; limitação confirmada no código será explícita
- esta tarefa não altera aplicação, migrations, CI/CD, deploy, provedores ou dados
- mudanças preexistentes do worktree serão preservadas e reconciliadas

## Inventário

### Documentos analisados

- todos os 157 arquivos encontrados inicialmente em `docs`, classificados por nome, tamanho, títulos, links e finalidade
- documentos centrais antigos: `README.md`, `CURRENT-STATE.md`, `VisãoGeral.md`, `PlanoAção.md`, `PROGRESS.md` e `teste2e2.md`
- coleções: 48 ADRs numerados mais índice/template; auditorias C11/C12; achados; contratos; planos de implementação/remediação; runbooks; engenharia; desenvolvimento; governança; C16/SLO; UI e migração documental
- fontes de verdade inspecionadas: manifesto, CI, Vercel, `src/app`, 12 bounded contexts, schema Drizzle, 80 migrations, autenticação/permissões, providers, workers/outbox, cron, testes e scripts

### Documentos ainda não analisados

- nenhum

### Estado inicial mensurável

- arquivos em `docs`: 157
- maiores arquivos: `PlanoAção.md` (4.133 linhas), `teste2e2.md` (3.343), `VisãoGeral.md` (1.992), `PROGRESS.md` (1.225)
- código: 12 contexts, 90 tabelas Drizzle, 80 migrations SQL e 248 arquivos de teste unitário/integração/E2E
- pilha confirmada: Node 22 no manifesto/CI, pnpm 11.17, Next.js 15.5, React 19.2, TypeScript 5.7, Drizzle 0.45, postgres.js, Supabase, Vitest e Playwright

## Descobertas

### Arquitetura

- aplicação full-stack Next.js com Server Components, Server Actions e Route Handlers; domínios em `src/contexts`
- banco acessado por três pools postgres.js separados: runtime, admin e worker
- side effects assíncronos usam outbox transacional; o worker reserva com `SKIP LOCKED`, usa advisory lock e aplica retry/DLQ
- marca do produto na UI é Qoro; nome técnico do repositório/pacote é ClinicaOS. A documentação canônica usará “ClinicaOS (produto Qoro)”

### Banco

- schema versionado por 80 migrations (`0000`–`0079`) e 90 tabelas declaradas; migrations e schema Drizzle são a referência do schema do repositório
- tabelas estão distribuídas entre tenancy, identity, onboarding, patient, scheduling, clinical, financial, messaging, AI, billing, feedback e infraestrutura
- RLS é habilitado e forçado; `withTenant` abre transação, assume `authenticated` e define GUCs de clínica/usuário na mesma conexão
- `.env.local` executa o localhost contra o projeto Supabase DEV remoto via Transaction Pooler; o PostgreSQL que escuta em `localhost:5432` não é o alvo configurado da aplicação
- banco DEV contém 80 registros Drizzle, com ordem/timestamps até `0079` coerentes; 42 hashes divergem apenas por LF/CRLF e `0051_ai_conversations_panel` possui drift real de conteúdo, embora seus objetos funcionais esperados tenham sido confirmados
- 89 tabelas lógicas da aplicação (excluindo `_schema_version`) têm RLS habilitado e forçado; partições físicas herdam o isolamento do pai e não têm `FORCE` próprio
- `qoro_runtime` foi confirmado em DEV como `LOGIN`, `NOBYPASSRLS`, sem poderes de superuser/DDL, membro de `authenticated`, com timeouts 30s/15s e conexão real pelo pooler
- leitura direta por `qoro_runtime` e por `authenticated` sem tenant GUC retornou zero; dois tenants distintos foram testados e cada transação enxergou somente suas próprias linhas

### Backend

- rotas HTTP públicas/operacionais: auth, health, webhooks Meta/Asaas, exports e 15 crons Vercel
- crons usam Bearer `CRON_SECRET`; operações destrutivas podem exigir `CRON_SECRET_DESTRUCTIVE`
- CI real executa audit, typecheck, lint, checks arquiteturais/migrations/observabilidade/registry, cobertura Vitest e build; Playwright não roda no CI atual
- outbox limita payload, valida schema, deduplica por evento/chave e retém falhas terminais para investigação

### Frontend

- shell da clínica cobre dashboard, agenda, consultório, pacientes/prontuário, documentos, financeiro/caixa, conversas, relatórios, equipe e configurações
- shell de super-admin cobre clínicas, billing, feedback, IA, métricas, auditoria e saúde
- middleware somente faz triagem por cookie/request-id; autenticação e autorização reais ocorrem no servidor

### Integrações

- Asaas é o único provider de cobrança implementado
- Meta Cloud API é o provider de WhatsApp implementado; `ZApiProvider` existe apenas como skeleton e seus quatro métodos lançam `ProviderNotImplementedError`
- Gemini é o provider de IA ativo; `OpenAIProvider` é placeholder não implementado
- há integração com Supabase Auth/Storage, Upstash Redis, Resend, Sentry e backend de secrets configurável
- presença de código/configuração não prova credenciais, subscriptions, templates, alertas ou entrega real em produção
- health profundo PROD aprovou DB, Gemini, Meta, Asaas, Redis e outbox; auth hook também respondeu `ok`
- Meta PROD: um canal ativo; token/scopes, phone `CONNECTED`, WABA `APPROVED`, app subscription e tráfego real confirmados. Em sete dias: 94 inbound processadas e 87 outbound `delivered`/`read`
- templates Meta: `lembrete_confirmacao` e `retorno_consulta` aprovados como `MARKETING`; `lista_espera_oferta` como `UTILITY`; `cobranca_amigavel` ausente
- a configuração Meta primária da `.env.local` não corresponde ao app emissor do token PROD; o par alternativo local corresponde, mas chaves com sufixo `1` são ignoradas pelo loader. O deploy está correto segundo cron/Graph/tráfego; o problema é configuração local
- Gemini live aprovou as 15 tools, function calling e cadastro antes de agendamento com `gemini-2.5-flash`
- Asaas PROD: API key válida; webhook único, ativo/não interrompido, URL canônica e sete eventos; reconcile atual sem divergência. Três assinaturas estão em trial e quatro pagamentos `PENDING`, sem settlement comprovado
- Resend: domínio `qoro.dev` verificado; últimos 100 envios da conta observada = 67 delivered/33 bounced. A chave é rotulada DEV, então a atribuição integral ao deploy PROD é incerta

### Segurança

- seis roles: `owner`, `gestor`, `doctor`, `attendant`, `financial` e `super_admin`; catálogo atual possui 28 permissões
- autorização combina perfil/epoch de claims, permissões por role/override, guards de servidor e RLS
- MFA AAL2 é obrigatório para super-admin; gestor/financial recebem incentivo, não bloqueio obrigatório
- PII sensível usa AES-256-GCM por tenant e lookup HMAC; PDFs/exports clínicos usam buckets privados e URLs assinadas
- CSP atual é report-only; headers de segurança adicionais são aplicados no Next.js
- grants de tabela em DEV não expõem objetos `public` a `anon`/`PUBLIC`; `qoro_runtime` tem apenas DML e depende de RLS, sem `CREATE`, `SUPERUSER` ou `BYPASSRLS`
- `bump_plan_claims_version()` é `SECURITY DEFINER` e ainda possui `EXECUTE` por `PUBLIC` em DEV (logo também por `anon`); é trigger-only e não foi invocada, mas o grant contradiz o padrão least-privilege e exige correção por migration futura, não edição retroativa
- Storage PROD: `clinical-pdfs`, `lgpd-exports` e `admin-exports` privados; `clinic-logos`/`logo_qoro` públicos; objetos reais existem nos fluxos clínico/LGPD

### IA

- runtime atual usa Gemini `gemini-2.5-flash` por padrão e whitelist de 15 tools
- mutações de agenda usam prepare → confirmação explícita posterior → `confirm_pending_action`
- contato desconhecido é cadastrado primeiro e depois retoma o agendamento preservado; não é handoff automático
- conselhos clínicos/diagnóstico são bloqueados e encaminhados a humano; ações dependem de tools validadas com Zod
- conversas/mensagens são cifradas; pending actions têm TTL/lock; falhas consecutivas podem abrir handoff

### Billing

- planos reais: `solo`, `clinica` e `pro`; não existe plano `Pro+`
- trial padrão do onboarding: 14 dias
- somente assentos de usuários são quota rígida; agendamentos e IA são métricas
- upgrade é aplicado após pagamento avulso Asaas confirmado; downgrade é agendado e exige exatamente um usuário ativo tanto na solicitação quanto no fim do ciclo
- cancelamento, revogação de cancelamento, inadimplência, dunning e reconciliação estão implementados; estado externo atual não foi verificado

### Multi-tenancy

- `clinic_id` e RLS isolam dados; `withTenant` é a fronteira transacional canônica
- super-admin acessa o shell de tenant somente por sessão explícita de impersonação
- tabelas globais/protegidas têm políticas específicas; RBAC continua na camada de aplicação

### Outros

- pacientes suportam PII cifrada, consentimentos, vínculos, merge, óbito, restauração e fluxo LGPD
- scheduling possui estados/transições explícitos, disponibilidade, recorrência, recursos, ausências, fila e waitlist
- prontuário assinado é imutável; correções pós-assinatura preservam versão legal anterior
- financeiro usa lançamentos receber/pagar, ledger de pagamentos/estornos, conciliação e rollup de caixa
- dez backups agendados consecutivos estavam verdes; o de 2026-08-18 gerou dump de 2.731.974 bytes e artifact cifrado de 530.326 bytes com retenção até 2026-09-17; restore não executado
- alert targets respondem corretamente, mas regras/canais não foram provados: tokens Sentry retornaram 401/403 e não existe credencial Better Stack local

## Contradições encontradas

- documentos antigos alternam Qoro/ClinicaOS sem explicar marca versus nome técnico
- documentação antiga menciona GPT/OpenAI ou arquitetura multi-LLM como atual; runtime usa Gemini e OpenAI é placeholder
- documentos variam entre 15, 16 e outros totais de tools; código registra 15
- Z-API foi descrita tanto como fallback disponível quanto como adapter ausente; há skeleton, mas nenhuma operação funciona
- billing antigo cita `Pro+`, múltiplos limites Solo, 7 dias de trial ou funcionalidades ausentes; código atual tem três planos, Solo com um assento e trial de 14 dias
- auditorias de produção datadas tratam problemas posteriormente corrigidos como estado atual
- documentação sugere cron `onboarding-reconcile`; somente um comentário de código o cita e não existe rota/cron correspondente
- `.nvmrc` indica Node 20, enquanto manifesto e CI exigem Node 22
- catálogo local declara todos os templates proativos como `UTILITY`, mas a Meta classifica reminder/follow-up aprovados como `MARKETING`
- documentação tratava o estado conectado inteiro como manual; DEV RLS/runtime e várias bordas PROD agora têm evidência datada, enquanto settlement/alert delivery/restore continuam pendentes

## Documentos obsoletos

- `PlanoAção.md` e `PROGRESS.md`: misturam backlog e histórico com estado atual
- auditorias, relatórios e planos de implementação datados não devem permanecer como referência corrente
- a maior parte dos 48 ADRs descreve decisões intermediárias já incorporadas, substituídas ou duplicadas
- `teste2e2.md` é evidência operacional datada, não estado atual; somente resultados históricos realmente úteis serão resumidos
- `docs/docs-migration/*` é proposta de migração anterior, não migração executada nem fonte de verdade

## Documentos para fundir

- arquitetura/visão/contextos/fluxos em uma visão canônica mais referências por domínio
- múltiplos documentos de segurança/RLS/LGPD em referências canônicas de banco e segurança
- planos/quotas/webhooks/reconciliação de billing em uma fonte canônica
- C11/C12, ferramentas e prompts em uma fonte canônica de IA; auditorias preservadas apenas como histórico compacto quando referenciadas pelo código
- runbooks repetidos em um conjunto operacional mínimo

## Documentos para dividir

- `VisãoGeral.md`: arquitetura, domínios e operação serão distribuídos por fontes canônicas especializadas
- conteúdo válido de `PlanoAção.md`/`PROGRESS.md`: somente fatos atuais migram; planos sem evidência serão removidos
- `teste2e2.md`: resumo histórico separado de estado atual e requisitos de validação manual

## Documentos a criar

- índice canônico e estado atual
- referências canônicas para arquitetura/contextos, banco, backend/jobs, frontend/acesso, segurança, IA, billing, integrações, operações, desenvolvimento/testes e regras de negócio
- lista explícita de limitações confirmadas e validações externas necessárias
- histórico mínimo de evidências datadas

## Alterações realizadas

- acervo reduzido de 157 para 61 arquivos; maiores monólitos removidos ou reescritos em referências compactas
- criadas fontes canônicas para banco, backend/jobs/outbox, frontend, pacientes/clínico/LGPD, agenda/financeiro, IA, billing, integrações, segurança, operações, testes e limitações
- `README.md`, `CURRENT-STATE.md`, `VisãoGeral.md`, `CONVENTIONS.md`, `onboarding-spec.md` e `adr/README.md` reescritos
- 48 ADRs antigos consolidados; oito caminhos ainda citados por código/README foram reescritos como decisões curtas e atuais
- auditorias, planos, relatórios de implementação, remediações, UI refactor, governança duplicada e proposta `docs-migration` removidos
- evidências datadas C11/C12/C15/C0–C10 reduzidas a notas `Historical`; `archive/evidence-snapshots.md` separa prova antiga de estado atual
- runbooks duplicados fundidos em índice, migrations, runtime RLS, release, observabilidade, C2/C4/C5/C7/C14, incidentes e disaster recovery
- links referenciados por código, scripts, CI, infra, root README e CHANGELOG preservados por caminho
- 14 caminhos canônicos novos criados; 47 caminhos existentes reescritos; 110 caminhos do inventário inicial removidos; oito documentos finais classificados como `Historical`
- nenhum arquivo de aplicação, migration, CI/CD ou deploy foi alterado
- fontes canônicas de banco, segurança, providers, operação, ambiente, testes, limitações, estado atual e evidências foram atualizadas com a rodada conectada de 2026-08-18
- referência fantasma `pnpm db:verify` removida; não existe script com esse nome no manifesto
- as três specs Playwright incompatíveis com localhost foram nomeadas e explicadas na documentação de testes
- as mesmas três specs foram executadas depois contra `app.qoro.dev` com contas sintéticas autorizadas; todas passaram, e a documentação distingue as assertivas válidas dos dois logs diagnósticos legados
- `docs/engineering/decision-guide.md` restaurado como ponte compacta porque templates de issue/PR e o aviso ADR do CI dependem desse caminho

## Validação executada

- `pnpm exec prettier --check docs organizar_docs.md`: PASS
- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm arch:check`: PASS, 839 arquivos, zero dependência circular
- `pnpm arch:db-check`: PASS, 895 arquivos, zero achado
- `pnpm check:migrations`: PASS; três migrations com DROP previamente aprovadas
- `pnpm check:observability`: PASS; 15 crons e cinco eventos documentados coerentes
- `pnpm check:registry:strict`: PASS; 57 eventos, 14 handlers e 43 `PRODUCER_AHEAD`
- `pnpm audit --prod --audit-level high`: PASS, nenhuma vulnerabilidade conhecida
- `pnpm test:coverage`: PASS; 201 arquivos Vitest, zero falha; 31,69% lines/statements, 44,34% functions e 77,4% branches
- `pnpm build`: PASS; Next.js 15.5.21 compilou e gerou todas as rotas
- `pnpm test:e2e e2e/login-and-navigation.spec.ts`: PASS, 5 testes e um skip autenticado
- `pnpm test:e2e` completo em localhost: FAIL conhecido, 5 pass/48 skip/3 fail; três specs `production-*` lançam guard de host em vez de skip. Não foi apontado para produção nem corrigido por estar fora do escopo documental
- `pnpm test:e2e:prod` focado em `production-dashboard-financial-rbac`, `production-dashboard-operational-a` e `production-whatsapp-settings-rbac`: PASS em `app.qoro.dev`, 3/3, 28,4 s, contas sintéticas e nenhuma mutação
- links internos: 148, zero quebrado; referências externas a docs fora de worktrees auxiliares: 89, zero quebrada
- inventário cruzado: 90 tabelas, 80 migrations, 12 contexts, 28 permissões e seis roles
- todos os 61 documentos têm `## Status`; `git diff --check`: PASS
- `pnpm format:check` global: FAIL baseline em 132 arquivos preexistentes fora deste escopo; os 61 docs e o checkpoint passam isoladamente
- DB DEV read-only: 80/80 migrations em ordem/timestamp; 42 hashes explicados por LF/CRLF e drift não trivial somente na `0051`; objetos da `0051` presentes
- DB DEV read-only: 89/89 tabelas lógicas com RLS+FORCE; sem grants de tabela para `anon`/`PUBLIC`; isolamento comportamental de dois tenants aprovado
- role runtime DEV: login pelo Transaction Pooler, `NOBYPASSRLS`, membership `authenticated`, sem DDL/superuser e timeouts 30s/15s
- deploy PROD: health shallow/deep, outbox strict e auth-hook PASS; outbox sem pending/processing/failed e sem alarmes
- PROD read-only: Meta inbound/outbound/status callbacks, Asaas webhooks/reconcile, Storage/buckets e 13 heartbeats frequentes confirmados
- Graph Meta GET: token/scopes/phone/WABA/subscription/templates validados; nenhum envio ou alteração externa
- Asaas GET: `/myAccount`, `/webhooks`, quatro payments e três subscriptions validados; nenhuma cobrança criada/repetida
- `pnpm ai:live-check`: PASS; Gemini real, 15 tools e function calling, custo aproximado US$ 0,003234
- Resend GET: domínio verificado e 100 últimos status de envio auditados; nenhum e-mail enviado nesta rodada
- GitHub Actions/API: dez backups agendados verdes e artifact atual não expirado; nenhum download/restore

## Decisões tomadas

- preservar caminhos documentais referenciados por código/scripts quando úteis, reescrevendo-os como referência compacta ou ponte explícita
- remover material redundante sem valor operacional; Git preserva o histórico, portanto `archive` não será depósito integral
- separar “implementado no repositório” de “confirmado em produção” em todos os documentos operacionais
- mudanças preexistentes: arquivos de `docs-migration/*` e `teste2e2.md` foram movidos para dentro de `docs` antes desta execução; serão incorporados à disposição final sem restaurar cópias antigas
- o conteúdo útil dessas mudanças preexistentes foi incorporado às fontes canônicas/arquivo compacto; as cópias e a proposta intermediária foram removidas
- `Pro+`, Stripe billing, Z-API funcional, OpenAI funcional, 16 tools e cron `onboarding-reconcile` não aparecem como implementação atual
- preços seed são documentados como defaults; catálogo/preço ativo no banco continua autoritativo
- assentos são documentados como única quota rígida; feature de permissions granulares em Clínica/Pro permanece distinta de quota

## Pontos que exigem validação manual

- schema/migrations, drift da `0051` e papel runtime realmente aplicados na instância de produção
- correção por nova migration do grant `PUBLIC EXECUTE` da trigger e decisão sobre o drift histórico da `0051`
- criar/corrigir `cobranca_amigavel` e decidir se as categorias Meta `MARKETING` são aceitáveis
- primeira cobrança/settlement Asaas efetivamente confirmado
- atribuir os bounces Resend a testes/produção e validar os envios críticos do deploy
- acesso Sentry/Better Stack, existência das regras/canais e teste real de notificação
- restore do artifact cifrado em scratch autorizado; não copiar PII para scratch sem procedimento/cleanup
- migrations/RLS/role runtime e configuração Data API do PROD

## Pendências

- nenhuma pendência documental automática após os checks finais
- pendências de produto/operação permanecem explicitamente na seção anterior e em `docs/roadmap/known-limitations.md`
- itens externos/manuais permanecem somente na seção anterior e em `docs/roadmap/known-limitations.md`
- correção das três specs Playwright que falham em localhost é dívida de testes fora do escopo desta tarefa
- dois `console.log` desses specs ainda descrevem exposição antiga apesar das assertivas atuais aprovarem o bloqueio; correção é dívida de teste fora do escopo documental

## Histórico de execução

- 2026-10-30: founder aceitou adiar a cópia/cofre independente para prosseguir com o lançamento; registro em `docs/quality/aceite-risco-backup-2026-10-30.md`. Rotina opt-in preservada e sem execução: pacote único, escritor temporário sem exclusão, readback/restore Linux. SQL/hash, 44 partes Storage e fontes Auth/chaves presentes. Não solicitar novamente senha/configuração; nenhum envio real ou mudança em produção nesta preparação.
- 2026-10-30: piloto B2 autorizado com chave filha temporária: upload/download, integridade, restore Linux e cleanup reais passaram com dados sintéticos. Chave original/cache preservados; evidência em `docs/quality/evidencias/b2-pilot-roundtrip-20261030.json`. Guia humano deixou de pedir nova chave/captura; custódia, destino médico e operação recorrente seguem no runbook canônico `docs/runbooks/backup-independente-sem-custo-2026-10.md`.
- 2026-08-18: checkpoint lido vazio; worktree e inventário físico inicial coletados.
- 2026-08-18: 157 documentos classificados; stack, 90 tabelas, 80 migrations, 12 contexts, 248 testes, rotas, integrações, IA, billing, RLS, segurança, frontend e jobs reconstruídos a partir do código.
- 2026-08-18: estrutura canônica aplicada (61 arquivos); 148 links internos e 89 referências externas verificados sem quebra; `check:observability` aprovado com 15 crons/5 eventos.
- 2026-08-18: typecheck, lint, arquitetura, migrations, observabilidade, registry, audit, cobertura e build aprovados; E2E local focado 5/5. Suíte Playwright completa revelou três guards de produção incompatíveis com localhost e foi documentada como limitação.
- 2026-08-18: checkpoint encerrado sem commit, push, deploy, migration, provider live ou alteração de código.
- 2026-08-18: validação complementar reaberta por autorização do usuário, mantendo tudo local e read-only; app localhost confirmado contra Supabase DEV, não PostgreSQL local.
- 2026-08-18: três specs Playwright read-only executadas com contas sintéticas contra `app.qoro.dev`; 3/3 passaram em 28,4 s, sem mutações. Logs legados contraditórios de dois specs foram classificados como diagnóstico obsoleto, não como falha de RBAC.
- 2026-08-18: 80 migrations comparadas com o DEV; 42 diferenças explicadas por finais de linha e um drift real na `0051`; objetos funcionais da `0051` presentes.
- 2026-08-18: 89/89 tabelas lógicas com RLS+FORCE, isolamento comportamental entre dois tenants e papel `qoro_runtime` NOBYPASSRLS/timeouts validados; grant `PUBLIC EXECUTE` residual em `bump_plan_claims_version()` descoberto.
- 2026-08-18: health e operações PROD verificados read-only; Meta/Asaas/Gemini/Resend/Storage, crons, entregas e backups receberam evidência datada, sem mensagens, cobranças, migration ou restore.
- 2026-08-18: divergências externas registradas: um template Meta ausente, dois reclassificados como MARKETING, quatro pagamentos ainda pendentes, 33 bounces nos últimos 100 e alert delivery não comprovado.
- 2026-08-18: revisão final aprovada com Prettier direcionado, `check:migrations`, `check:observability`, links e `git diff --check`; worktree permaneceu em `main` sem branch, commit, push, deploy ou alteração de aplicação.
