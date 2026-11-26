# Roadmap e backlog rastreável

**Plano proposto. Nenhuma tarefa de migração foi iniciada por este documento.** Cada ID é uma entrega revisável, tipicamente um PR; procedimentos de múltiplas capacidades devem ser divididos em PRs menores mantendo o ID como épico. O [JSON completo](tarefas.json) contém todos os campos, inclusive pré-requisitos, ordem, aprovação e evidência.

## Ordem e dependências

Baseline/decisões/characterização → configuração e contrato por capacidade → hosting e Storage → financeiro → identidade e Postgres → exercícios de saída → falhas combinadas → operação. As numerações de fases/gates preservam o mapa do pedido; G7 (hosting) pode ser demonstrado antes de G4/G6, sem liberar estes gates.

Os pré-requisitos comuns são contrato e ambiente aprovados, fixtures identificadas, ausência de produção/efeitos reais e revisão do diff anterior. Eles se aplicam a **cada tarefa** abaixo, além das dependências listadas. Para trabalho sem dado real, o inventário estático pode avançar antes de G0 operacional; cutover/cópia real não.

## Tarefas

### B00 — Congelar baseline operacional e recuperação

- **Fase / ordem / status / responsável:** 0 / 1 / PENDENTE / Tech lead + SRE.
- **Objetivo e alteração/procedimento:** Inventariar somente metadados do ambiente alvo, datas/escopo dos backups e métricas sanitizadas; escolher snapshot e autorizar ensaio protegido antes de qualquer cópia.
- **Estado atual:** Fotografia estática disponível; volumes, custos e restore atual não consultados.
- **Localização:** `docs/decoupling/inventario-codigo.json`; `docs/runbooks/disaster-recovery.md`; `.github/workflows/db-backup.yml`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; nenhuma tarefa anterior. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 1–2 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/crítico.
- **Testes:** D03,D07,D16. **Evidência:** SHA e ambiente; execução identificada dos cenários D03,D07,D16; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Sem escrita de produto; retirar apenas inventário novo se incorreto.
- **Gate / resultado esperado:** G0; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### B01 — Consolidar caracterização e fixtures

- **Fase / ordem / status / responsável:** 2 / 2 / PENDENTE / QA + backend.
- **Objetivo e alteração/procedimento:** Catalogar suites atuais por cenário; preparar duas clínicas sintéticas, operações financeiras com cleanup e relógio controlado; adicionar apenas lacunas da matriz.
- **Estado atual:** 216 testes locais passaram; não existe prova completa nos destinos alternativos.
- **Localização:** `src/lib/auth/*.test.ts`; `src/lib/db/tenant.test.ts`; `e2e/`; `scripts/security/`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B00. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** A01-A19,F01-F24,D01-D16. **Evidência:** SHA e ambiente; execução identificada dos cenários A01-A19,F01-F24,D01-D16; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Remover somente fixtures identificadas após reconciliação; preservar evidências.
- **Gate / resultado esperado:** G2; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### B02 — Aprovar fronteiras e contratos

- **Fase / ordem / status / responsável:** 1 / 3 / PENDENTE / Arquiteto + segurança + founder.
- **Objetivo e alteração/procedimento:** Revisar D01-D12, fechar contratos/capacidades e owners; produzir ADRs e critérios quantitativos aceitos sem mudar regras comerciais.
- **Estado atual:** Portas parciais e decisões propostas, sem segundo adapter homologado.
- **Localização:** `docs/architecture/04-arquitetura-to-be.md`; `docs/architecture/05-contratos-e-adaptadores.md`; `docs/adr/`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B00. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 1–2 dias de engenharia; confiança baixa a média; probabilidade/impacto Baixa/alto.
- **Testes:** Revisão adversarial e contratos versionados. **Evidência:** SHA e ambiente; execução identificada dos cenários Revisão adversarial e contratos versionados; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Revisar ADR proposta; nenhuma migração em runtime.
- **Gate / resultado esperado:** G1; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### H01 — Independência de ambiente e origens

- **Fase / ordem / status / responsável:** 3 / 4 / PENDENTE / Backend + segurança.
- **Objetivo e alteração/procedimento:** Introduzir APP_ENV/backend identity e DeploymentContext; preservar adapter Vercel e allowlist exata; cobrir URLs, CSRF, chaves públicas no build e config runtime.
- **Estado atual:** Preview depende de VERCEL_ENV e formato de host; coerência depende de Supabase ref.
- **Localização:** `src/lib/env.ts`; `src/lib/env-coherence.ts`; `src/lib/http/application-url.ts`; `src/lib/http/content-security-policy.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B01, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/crítico.
- **Testes:** H03,H06,H11; env/application-url tests. **Evidência:** SHA e ambiente; execução identificada dos cenários H03,H06,H11; env/application-url tests; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Manter leitores de env anteriores durante compatibilidade; desligar novo context antes de remover aliases.
- **Gate / resultado esperado:** G3-host; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### H02 — Imagem Next reproduzível

- **Fase / ordem / status / responsável:** 7 / 5 / PENDENTE / Platform engineer.
- **Objetivo e alteração/procedimento:** Preparar imagem Node 22 non-root com lockfile e artefatos; validar PDF/WASM, secrets lazy, startup/readiness e parada; não incluir env local na imagem.
- **Estado atual:** next build/start existem; não há imagem de produção alternativa no recorte.
- **Localização:** `NOVO Dockerfile`; `NOVO .dockerignore`; `next.config.ts`; `package.json`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; H01. **Aprovação:** Aprovar mudança de build/deploy/CI antes de implementar configuração afetada.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** H01-H04,H09,H11. **Evidência:** SHA e ambiente; execução identificada dos cenários H01-H04,H09,H11; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Retornar à imagem anterior; não remover Vercel.
- **Gate / resultado esperado:** G7; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### H03 — Executor dos 21 schedules

- **Fase / ordem / status / responsável:** 7 / 6 / PENDENTE / SRE + backend.
- **Objetivo e alteração/procedimento:** Gerar lista de schedules independente com paridade verificável; testar executor único, UTC, segredos destrutivos, leases, deadline e heartbeats em fixtures.
- **Estado atual:** Manifesto Vercel tem 21 jobs; gate HTTP é Bearer.
- **Localização:** `vercel.json`; `src/lib/http/cron-auth.ts`; `src/app/api/cron/`; `src/lib/outbox/worker.ts`; `NOVO manifesto scheduler`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; H01, B01. **Aprovação:** Aprovar mudança de build/deploy/CI antes de implementar configuração afetada.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** H07-H09,C01,C03. **Evidência:** SHA e ambiente; execução identificada dos cenários H07-H09,C01,C03; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Parar geração nova antes de religar antiga; drenar leases, reconciliar efeitos.
- **Gate / resultado esperado:** G7; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### H04 — Landing em host estático alternativo

- **Fase / ordem / status / responsável:** 7 / 7 / PENDENTE / Frontend + platform.
- **Objetivo e alteração/procedimento:** Configurar destinos de build allowlisted; reproduzir static 404/headers/redirects; testar CTA, Ads e experiência em dois tamanhos sem alterar trigger comercial.
- **Estado atual:** Vite/prerender ajuda; headers, redirects, Preview e Analytics dependem de Vercel.
- **Localização:** `LANDING src/lib/comecar.ts`; `src/lib/eventos.ts`; `vercel.json`; `scripts/serve.mjs`; `scripts/prerender.mjs`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; H01, B02. **Aprovação:** Aprovar mudança de build/deploy/CI antes de implementar configuração afetada.
- **Esforço / risco:** 1–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** H05,H12; npm run comecar/conversao/seguranca. **Evidência:** SHA e ambiente; execução identificada dos cenários H05,H12; npm run comecar/conversao/seguranca; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Restaurar release estática e origens anteriores; preservar medição e não enviar ao prod em teste.
- **Gate / resultado esperado:** G7; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### S01 — Extrair contrato de objetos

- **Fase / ordem / status / responsável:** 3 / 8 / PENDENTE / Backend.
- **Objetivo e alteração/procedimento:** Criar FileStorage pequeno; implementar adapter Supabase atrás dos helpers existentes; testes de contrato para bytes, paginação, erros e overwrite.
- **Estado atual:** Quatro helpers usam diretamente storage do cliente admin Supabase.
- **Localização:** `src/lib/storage/clinical.ts`; `exports.ts`; `admin-exports.ts`; `clinic-assets.ts`; `NOVO contracts.ts e supabase-adapter.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B01, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** D08-D13. **Evidência:** SHA e ambiente; execução identificada dos cenários D08-D13; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Facade compatível permite voltar ao helper anterior sem mover objetos.
- **Gate / resultado esperado:** G3-storage; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### S02 — Desvincular referências de URL proprietária

- **Fase / ordem / status / responsável:** 5S / 9 / PENDENTE / Backend + frontend.
- **Objetivo e alteração/procedimento:** Inventariar leitores; adicionar resolução compatível de objeto lógico/URL antiga; mover marca para URL própria aprovada; não reescrever snapshots assinados.
- **Estado atual:** PDFs usam paths; logo_url e cinco templates embutem URL absoluta.
- **Localização:** `src/contexts/tenancy/schema.ts`; `src/contexts/clinical/schema.ts`; `src/lib/email/templates/`; `src/lib/storage/`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; S01. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 2–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** D08,D11,D14; testes de templates/PDF. **Evidência:** SHA e ambiente; execução identificada dos cenários D08,D11,D14; testes de templates/PDF; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Manter leitura dos dois formatos; reverter apresentação antes de qualquer contract de schema.
- **Gate / resultado esperado:** G5S; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### S03 — Homologar Storage alternativo

- **Fase / ordem / status / responsável:** 5S / 10 / PENDENTE / Backend + segurança.
- **Objetivo e alteração/procedimento:** Implementar apenas capacidades acordadas em destino S3 de teste aprovado; conferir MIME, tamanho, ACL, TTL e integridade por hash com dados sintéticos.
- **Estado atual:** Não existe adapter alternativo provado.
- **Localização:** `NOVO src/lib/storage/s3-adapter.ts`; `NOVOS testes de contrato`; `scripts de manifesto`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; S01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D08-D13,D15. **Evidência:** SHA e ambiente; execução identificada dos cenários D08-D13,D15; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Desligar adapter novo e manter todos os objetos originais; excluir só fixtures próprias autorizadas.
- **Gate / resultado esperado:** G5S; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### S04 — Ensaiar cópia/delta e retorno de objetos

- **Fase / ordem / status / responsável:** 5S / 11 / PENDENTE / SRE + QA.
- **Objetivo e alteração/procedimento:** Criar manifesto cifrado e checkpoints; copiar sintéticos, simular overwrite/delete e tombstones; congelar escritor, verificar delta e testar retorno sem ressuscitar objetos.
- **Estado atual:** Restore histórico Supabase não prova S3 nem exclusão concorrente.
- **Localização:** `scripts/recovery/`; `docs/runbooks/disaster-recovery.md`; `NOVO roteiro Storage`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; S02, S03, O02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D09-D15,C06. **Evidência:** SHA e ambiente; execução identificada dos cenários D09-D15,C06; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Restaurar roteamento só com delta/tombstones reconciliados; não apagar destino.
- **Gate / resultado esperado:** G5S; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F01 — Extrair portas financeiras e DTO canônico

- **Fase / ordem / status / responsável:** 3 / 12 / PENDENTE / Backend financeiro.
- **Objetivo e alteração/procedimento:** Extrair recorrência, checkout e snapshots; manter facade compatível; mapear cents, moeda, obrigação, settlement, refund e dispute sem perder unknown.
- **Estado atual:** PaymentProvider e tipos estão em payments/asaas; consumidores conhecem status e ciclo proprietários.
- **Localização:** `src/lib/payments/asaas/index.ts`; `NOVO src/lib/payments/contracts/`; `src/contexts/billing/internal/provider-sync.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B01, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F01,F03,F11,F12,F24. **Evidência:** SHA e ambiente; execução identificada dos cenários F01,F03,F11,F12,F24; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Preservar chamadas antigas e remover só nova composição se houver regressão.
- **Gate / resultado esperado:** G3-finance; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F02 — Traduzir eventos e preservar confiança

- **Fase / ordem / status / responsável:** 4 / 13 / PENDENTE / Backend + segurança.
- **Objetivo e alteração/procedimento:** Separar tradutor autenticado/readback do caso de uso; manter HTTP budget e dedup transacional; decidir inbox somente com evidência de necessidade.
- **Estado atual:** Routes normalizam IDs e leem estado Asaas; dedup é específico.
- **Localização:** `src/app/api/webhooks/asaas/route.ts`; `patient/[ref]/route.ts`; `NOVO lib/payments/events.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F02-F06,F20,F23. **Evidência:** SHA e ambiente; execução identificada dos cenários F02-F06,F20,F23; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Continuar endpoints antigos; não reprocessar efeitos já confirmados; reconciliar namespace.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F03 — Persistir binding de provider e conta

- **Fase / ordem / status / responsável:** 4 / 14 / PENDENTE / DBA + backend financeiro.
- **Objetivo e alteração/procedimento:** Desenhar migration expand-only para binding e unicidades compostas; backfill Asaas com hashes agregados de preservação; testar N/N-1 e colisão entre contas.
- **Estado atual:** IDs/dedup Asaas e single-gateway não permitem convivência segura.
- **Localização:** `src/contexts/billing/schema.ts`; `src/contexts/payments/schema.ts`; `NOVA migration após última atual`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F01, B00. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F17,F20,F22; migration N/N-1. **Evidência:** SHA e ambiente; execução identificada dos cenários F17,F20,F22; migration N/N-1; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Manter colunas antigas e dual-read controlado; não apagar mapping se recebeu efeito externo.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F04 — Operações financeiras com resultado incerto

- **Fase / ordem / status / responsável:** 4 / 15 / PENDENTE / Backend financeiro + QA.
- **Objetivo e alteração/procedimento:** Levar reserva/checkpoint/readback ao contrato novo; provar timeout pós-criação, webhook antes da resposta e retry sem POST cego nem fallback entre gateways.
- **Estado atual:** Há leases/external refs no fluxo atual; ainda não é contrato multi-provider.
- **Localização:** `src/contexts/onboarding/internal/signup-hosted-checkout.ts`; `src/contexts/billing/internal/plan-changes.ts`; `src/contexts/payments/internal/hosted-checkout.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F01, F02, F03. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F04,F06-F09,C04. **Evidência:** SHA e ambiente; execução identificada dos cenários F04,F06-F09,C04; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Pausar criação, reconciliar operação pela origem e retomar somente após decisão autoritativa.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F05 — Segundo gateway em Sandbox

- **Fase / ordem / status / responsável:** 4 / 16 / PENDENTE / Backend financeiro.
- **Objetivo e alteração/procedimento:** Selecionar pela matriz de capacidades; implementar adapter e passar suíte comum para cliente, recorrência, checkout e readback; unsupported bloqueia operação correspondente.
- **Estado atual:** Nenhum segundo gateway foi escolhido ou homologado.
- **Localização:** `NOVO src/lib/payments/adapters/<provider>/`; `testes de contrato compartilhados`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F01, F04. **Aprovação:** Aprovar provider/capacidades/custo e tratamento de dados/credenciais antes de operação externa.
- **Esforço / risco:** 5–10 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F01-F24 segundo capacidades; X02. **Evidência:** SHA e ambiente; execução identificada dos cenários F01-F24 segundo capacidades; X02; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Desligar novas originações, preservar contratos/credenciais de fixtures até conciliação e cleanup.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### F06 — Cohort financeiro e saída de recorrência

- **Fase / ordem / status / responsável:** 4 / 17 / PENDENTE / Financeiro + backend + jurídico.
- **Objetivo e alteração/procedimento:** Preparar roteamento por contrato, runbook de consentimento/token e encerramento de cobranças futuras; ensaiar origem recebendo refund depois da troca; zero alterações reais.
- **Estado atual:** Uma env global não pode migrar contratos ativos ou cartões.
- **Localização:** `src/contexts/billing/internal/plan-change-provider-sync.ts`; `billing-reconcile`; `docs/runbooks/provider-cutover.md`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F03, F04, F05. **Aprovação:** Aprovar provider/capacidades/custo e tratamento de dados/credenciais antes de operação externa.
- **Esforço / risco:** 3–6 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F17-F22,C07. **Evidência:** SHA e ambiente; execução identificada dos cenários F17-F22,C07; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Voltar novas vendas à origem sem mover obrigações já criadas no destino; reconciliar ambos.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### I01 — Porta de sessão verificada

- **Fase / ordem / status / responsável:** 3 / 18 / PENDENTE / Backend identidade + segurança.
- **Objetivo e alteração/procedimento:** Extrair verificação de sessão/subject e assurance; preservar CurrentUser, claims_version e leitura autoritativa; adapter Supabase equivalência primeiro.
- **Estado atual:** tenant-context importa Supabase diretamente; authz Qoro já é própria.
- **Localização:** `src/lib/auth/tenant-context.ts`; `supabase-server.ts`; `NOVO lib/identity/contracts.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B01, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A04-A11,A15. **Evidência:** SHA e ambiente; execução identificada dos cenários A04-A11,A15; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Facade mantém adapter Supabase e cookies atuais; não aceitar issuer desconhecido.
- **Gate / resultado esperado:** G3-identity; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### I02 — Mapear identidade interna e FKs

- **Fase / ordem / status / responsável:** 5I / 19 / PENDENTE / DBA + segurança.
- **Objetivo e alteração/procedimento:** Projetar identity bindings issuer+subject, preservar UUIDs e autor original; adicionar esquema/compatibilidade e testar exclusão/revinculação sem cascata indevida.
- **Estado atual:** profiles.id tem vínculo com auth.users; e-mail não é chave segura.
- **Localização:** `src/contexts/identity/schema.ts`; `migrations auth FK`; `NOVO identity-bindings repository/migration`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; I01, B00. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 3–6 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A12,A14-A16,D03,D06. **Evidência:** SHA e ambiente; execução identificada dos cenários A12,A14-A16,D03,D06; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Preservar auth.users e mapping antigo durante expansão; não contract antes de prova conjunta.
- **Gate / resultado esperado:** G5I; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### I03 — Homologar credenciais/MFA/refresh no alvo

- **Fase / ordem / status / responsável:** 5I / 20 / PENDENTE / Segurança + backend.
- **Objetivo e alteração/procedimento:** Confirmar capacidades contratuais; testar apenas contas sintéticas; escolher reautenticação/reset/re-enrollment se import não for seguro e suportado.
- **Estado atual:** Não há prova de import de hashes/tokens/fatores para outro Auth.
- **Localização:** `NOVO adapter identidade`; `src/lib/auth/mfa.ts`; `sessão/refresh/reset routes`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; I01, I02. **Aprovação:** Aprovar provider/capacidades/custo e tratamento de dados/credenciais antes de operação externa.
- **Esforço / risco:** 4–7 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A04-A14,A17. **Evidência:** SHA e ambiente; execução identificada dos cenários A04-A14,A17; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Retorno pode exigir novo login; manter issuer antigo só conforme política e revogações reconciliadas.
- **Gate / resultado esperado:** G5I; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### I04 — Continuar cadastro e trial através da porta

- **Fase / ordem / status / responsável:** 5I / 21 / PENDENTE / Backend onboarding + QA.
- **Objetivo e alteração/procedimento:** Preservar timestamp histórico e estado de jornada; adaptar operações de conta, código, reset e provisioning a subject interno sem novo trial/contrato.
- **Estado atual:** Trial novo usa created_at do Auth; jornada possui senha/código/checkout próprios.
- **Localização:** `src/contexts/onboarding/internal/signup-auth-admin.ts`; `signup-auth-binding.ts`; `signup-trial.ts`; `signup-provision.ts`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; I02, I03, F01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A01-A03,A16-A19,F13. **Evidência:** SHA e ambiente; execução identificada dos cenários A01-A03,A16-A19,F13; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Manter leituras antigas e versionar operação; reconciliar identidade/contrato antes de qualquer rollback.
- **Gate / resultado esperado:** G5I; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### I05 — Ensaio completo de identidade e autorização

- **Fase / ordem / status / responsável:** 5I / 22 / PENDENTE / QA segurança + SRE.
- **Objetivo e alteração/procedimento:** Executar login/refresh/logout/MFA/reset/claims e duas clínicas em alvo isolado; simular corte/retorno com sessões e recuperação pendentes.
- **Estado atual:** Sessão alternativa ainda não foi executada no Qoro.
- **Localização:** `security-e2e/`; `e2e/`; `scripts/security/tenant-isolation.ts`; `NOVO ensaio identity`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; I03, I04, B01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A01-A19,C02. **Evidência:** SHA e ambiente; execução identificada dos cenários A01-A19,C02; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Manter escritores de identidade únicos; reconciliar senha/reset/ativo antes de permitir origem novamente.
- **Gate / resultado esperado:** G5I; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### D01 — Catalogar dependências efetivas do Postgres

- **Fase / ordem / status / responsável:** 6 / 23 / PENDENTE / DBA.
- **Objetivo e alteração/procedimento:** Gerar inventário de roles/policies/functions/FKs/extensões/publicações/partições e queries críticas da cópia autorizada; separar recursos usados de resíduos históricos.
- **Estado atual:** 136 migrations e 24 com auth; texto não é schema efetivo.
- **Localização:** `drizzle/migrations/`; `scripts/security/scratch-schema.ts`; `src/lib/db/`; `docs/database/schema.md`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B00, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/crítico.
- **Testes:** D03-D07,D16. **Evidência:** SHA e ambiente; execução identificada dos cenários D03-D07,D16; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Somente inventário; nenhum DDL remoto.
- **Gate / resultado esperado:** G6; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### D02 — Bootstrap Postgres genérico com segurança

- **Fase / ordem / status / responsável:** 6 / 24 / PENDENTE / DBA + segurança.
- **Objetivo e alteração/procedimento:** Criar bootstrap explícito com extensões/roles mínimas e contexto Qoro; replay de migrations atuais + mudanças aditivas; testar RLS e runtime sem BYPASSRLS.
- **Estado atual:** Supabase oferece roles/functions/Auth que banco genérico não traz.
- **Localização:** `NOVO bootstrap Postgres`; `src/lib/db/tenant.ts`; `migrations`; `scripts/security/`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; D01, I02. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 3–6 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D03-D07,A15; tenant real. **Evidência:** SHA e ambiente; execução identificada dos cenários D03-D07,A15; tenant real; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Descartar só cluster sintético identificado; não afrouxar policies para passar restore.
- **Gate / resultado esperado:** G6; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### D03 — Snapshot e delta com escritor único

- **Fase / ordem / status / responsável:** 6 / 25 / PENDENTE / DBA + SRE.
- **Objetivo e alteração/procedimento:** Escolher pausa ou CDC após medir volume; preparar snapshot/manifesto/checkpoint; ensaiar deltas de registros/filas, sequence e timezone sem split-brain.
- **Estado atual:** Não há mecanismo multi-host de migração de dados homologado.
- **Localização:** `scripts/recovery/`; `NOVO migrador/checker`; `db/outbox schema`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; D02, O02. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D01-D07,C01,C05. **Evidência:** SHA e ambiente; execução identificada dos cenários D01-D07,C01,C05; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Guardar log de escritas pós-corte e reconciliar antes de retorno; não promover backup antigo como escritor.
- **Gate / resultado esperado:** G6; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### D04 — Restore e operação real no Postgres alvo

- **Fase / ordem / status / responsável:** 6 / 26 / PENDENTE / DBA + QA.
- **Objetivo e alteração/procedimento:** Restaurar cópia autorizada ou sintéticos integrais; validar constraints/policies/crypto e fluxos principais com Auth alternativo; medir duração e retorno.
- **Estado atual:** Restore histórico foi em stack Supabase, não prova independência.
- **Localização:** `scripts/restore-test.ts`; `security:tenant`; `NOVO ensaio PG`; `runbook DR`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; D03, I05. **Aprovação:** Aprovar contrato/schema e destino; migration somente na janela/ambiente expressamente autorizado.
- **Esforço / risco:** 3–5 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D01-D16,C01,C05. **Evidência:** SHA e ambiente; execução identificada dos cenários D01-D16,C01,C05; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Retornar escritor só após delta reconciliado; snapshot base permanece imutável.
- **Gate / resultado esperado:** G6; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### O01 — SLIs e alertas por capacidade

- **Fase / ordem / status / responsável:** 2 / 27 / PENDENTE / SRE.
- **Objetivo e alteração/procedimento:** Mapear métricas atuais ao host alvo; instrumentar lacunas com IDs internos; validar alerta de falha e readback sem dados sensíveis.
- **Estado atual:** JSON/health/heartbeats existem; coleta e alertas fora Vercel não foram provados.
- **Localização:** `src/lib/observability/`; `src/app/api/health/`; `docs/runbooks/alerting-setup.md`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B00, B02. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 1–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** H07,H13,F05. **Evidência:** SHA e ambiente; execução identificada dos cenários H07,H13,F05; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Conservar collector e monitores anteriores durante sobreposição; não publicar raw payload.
- **Gate / resultado esperado:** G2; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### O02 — Recuperação pertinente à nova migração

- **Fase / ordem / status / responsável:** 0/2 / 28 / PENDENTE / SRE + segurança + founder.
- **Objetivo e alteração/procedimento:** Reusar DR existente com snapshot aprovado para o corte; verificar decrypt/keys/Auth config/Storage e medir restore; não contratar PITR nem fazer upload real sem autorização.
- **Estado atual:** Há provas históricas e aceite de backup independente adiado; RTO completo não medido.
- **Localização:** `docs/runbooks/disaster-recovery.md`; `scripts/recovery/`; `.github/workflows/db-backup.yml`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B00. **Aprovação:** Aprovar provider/capacidades/custo e tratamento de dados/credenciais antes de operação externa.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** D09,D16; exercício de recuperação. **Evidência:** SHA e ambiente; execução identificada dos cenários D09,D16; exercício de recuperação; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Preservar originais/custódia; descartar apenas destino isolado autorizado; aceitar risco só formalmente.
- **Gate / resultado esperado:** G0 operacional / G2; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### O03 — Impedir regressão de fronteiras

- **Fase / ordem / status / responsável:** 3 / 29 / PENDENTE / Tech lead + QA.
- **Objetivo e alteração/procedimento:** Adicionar regras mínimas de import/provider para fronteiras migradas e snapshot check quando aprovado; testes não podem esconder acoplamento via reexports/dynamic import.
- **Estado atual:** ESLint boundaries, madge e AST DB guards já existem.
- **Localização:** `eslint.config.mjs`; `scripts/arch-db-check.ts`; `scripts/arch-graphs.ts`; `NOVO contract-architecture tests`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; B02, F01, I01, S01. **Aprovação:** Aprovar mudança de build/deploy/CI antes de implementar configuração afetada.
- **Esforço / risco:** 1–2 dias de engenharia; confiança baixa a média; probabilidade/impacto Baixa/alto.
- **Testes:** Reintroduzir import proibido em fixture e exigir falha. **Evidência:** SHA e ambiente; execução identificada dos cenários Reintroduzir import proibido em fixture e exigir falha; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Reverter regra específica só por ADR; não desativar gate para build passar.
- **Gate / resultado esperado:** G3; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### O04 — Orçamento de capacidade e falhas

- **Fase / ordem / status / responsável:** 7/8 / 30 / PENDENTE / SRE + performance QA.
- **Objetivo e alteração/procedimento:** Medir latência, memória PDF, pool, jobs e retries em host alvo; simular rede lenta e saturação; definir limites e custo previsto antes de contratar escala.
- **Estado atual:** Pools são fixos por processo; performance/custos atuais não medidos.
- **Localização:** `src/lib/db/index.ts`; `load scripts existentes`; `NOVO relatório capacidade`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; H02, H03, O01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/alto.
- **Testes:** H02,H08,H09,H11. **Evidência:** SHA e ambiente; execução identificada dos cenários H02,H08,H09,H11; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Reduzir réplicas/concurrency e reverter imagem; não relaxar isolamento.
- **Gate / resultado esperado:** G7/G8; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### X01 — Exercício C: saída da Vercel

- **Fase / ordem / status / responsável:** 8 / 31 / PENDENTE / QA + SRE.
- **Objetivo e alteração/procedimento:** Subir app e landing aprovados em host não Vercel; executar login/cadastro/pagamento fixture/Storage/jobs e rollback mantendo backend de teste autorizado.
- **Estado atual:** Não há execução externa homologada nesta rodada.
- **Localização:** `docs/runbooks/provider-cutover.md`; `e2e/`; `landing verificadores`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; H02, H03, H04, O04, B01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–3 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/alto.
- **Testes:** H01-H13,C03. **Evidência:** SHA e ambiente; execução identificada dos cenários H01-H13,C03; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Executar runbook de retorno com scheduler único e efeitos reconciliados.
- **Gate / resultado esperado:** G7; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### X02 — Exercício B: saída do Asaas

- **Fase / ordem / status / responsável:** 8 / 32 / PENDENTE / QA financeiro + financeiro.
- **Objetivo e alteração/procedimento:** Executar jornada SaaS e cenários de convivência em gateway B; documentar capacidades paciente não migradas e obrigações de origem; financeiro reconcilia números.
- **Estado atual:** Sandbox anterior confirma Asaas, não outro gateway.
- **Localização:** `docs/runbooks/provider-cutover.md`; `contratos e E2E financeiro`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; F06, O01, B01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** F01-F24,C04,C07. **Evidência:** SHA e ambiente; execução identificada dos cenários F01-F24,C04,C07; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Pausar originações e reconciliar ambos; manter artifacts/fixture até fechamento.
- **Gate / resultado esperado:** G4; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### X03 — Exercício A: saída do Supabase

- **Fase / ordem / status / responsável:** 8 / 33 / PENDENTE / QA segurança + DBA + SRE.
- **Objetivo e alteração/procedimento:** Operar Qoro com identidade, objetos e Postgres alternativos; demonstrar ausência de dependência operacional Supabase e recuperação dos três serviços.
- **Estado atual:** Interfaces e restores históricos não substituem serviço alternativo completo.
- **Localização:** `docs/runbooks/provider-cutover.md`; `security-e2e/`; `restore/manifestos`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; S04, I05, D04, O01. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** A01-A19,D01-D16,C02,C06. **Evidência:** SHA e ambiente; execução identificada dos cenários A01-A19,D01-D16,C02,C06; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Reconciliar três domínios antes de retorno; não habilitar duas identidades/escritores sem plano.
- **Gate / resultado esperado:** G5/G6; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### X04 — Falhas combinadas e retorno completo

- **Fase / ordem / status / responsável:** 8 / 34 / PENDENTE / QA + SRE + segurança.
- **Objetivo e alteração/procedimento:** Executar C01-C07 com injeção de falha e escritor/scheduler definidos; medir perda/duplicação, RPO/RTO e necessidade de forward-fix.
- **Estado atual:** Zero ensaio composto executado.
- **Localização:** `NOVO relatório ensaio composto`; `e2e e harnesses de falha`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; X01, X02, X03. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 2–4 dias de engenharia; confiança baixa a média; probabilidade/impacto Alta/crítico.
- **Testes:** C01-C07. **Evidência:** SHA e ambiente; execução identificada dos cenários C01-C07; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Acionar freeze e forward-fix se inversão segura não comprovada; nenhum restore destrutivo automático.
- **Gate / resultado esperado:** G8; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

### X05 — Homologar operação e retirada gradual

- **Fase / ordem / status / responsável:** 9 / 35 / PENDENTE / Tech lead + operação + founder.
- **Objetivo e alteração/procedimento:** Revisar evidências/ADRs, inventário residual, alertas, restore e runbooks; propor janela e retenção antigas; remover dependências somente após autorização e risco reconciliado.
- **Estado atual:** Provedores atuais devem continuar disponíveis até aceites.
- **Localização:** `docs/decoupling/`; `runbooks`; `package/config apenas em execução aprovada`. NOVO indica arquivo ainda não criado; LANDING indica o outro repositório.
- **Pré-requisitos e dependências:** comuns acima; X04, O03. **Aprovação:** Mudança pequena de código pode ser proposta por PR; interfaces públicas e regras comerciais exigem aprovação específica.
- **Esforço / risco:** 1–2 dias de engenharia; confiança baixa a média; probabilidade/impacto Média/crítico.
- **Testes:** Gates e restore/rollback reproduzidos por outro operador. **Evidência:** SHA e ambiente; execução identificada dos cenários Gates e restore/rollback reproduzidos por outro operador; readback/artefatos sanitizados e cleanup rastreado.
- **Rollback:** Não deletar origem antes de critérios legais/operacionais; rollback de config mantém bindings e histórico.
- **Gate / resultado esperado:** G9; testes e invariantes correspondentes atendidos, prova do efeito e retorno sem perda.

## Premissas das estimativas

Total aritmético sem paralelismo: **81–150 dias de engenharia**. Não é prazo prometido nem orçamento. Supõe time experiente no repositório, nenhum redesenho comercial, provider alternativo com capacidades adequadas, acesso a ambientes sintéticos e reaproveitamento dos testes atuais. Esperas de aprovação, KYC, consentimento, fornecedores e sessões/mandatos não estão incluídas. Não multiplicar o total por uma tarifa inventada; aprovar orçamento com capacidade real da equipe. Reestimar após B00/B02 e após cada spike. O [cronograma](15-cronograma-e-dependencias.md) separa prova inicial, programa inteiro e contingências.
