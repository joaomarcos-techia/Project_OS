# Track O — revalidação independente e correções de 21/09/2026

Complementa [qorov2 §36](../qorov2.md), a [matriz](track-o.md) e o
[handoff](../handoff-track-o-final.md). A implementação e as medições prevalecem sobre as descrições
anteriores. Nenhuma migration nova ou escrita no banco de produção foi necessária nesta rodada.

## Achados reavaliados

| Achado | Conclusão e correção |
| --- | --- |
| Janitor usava relógio do processo | Corrigido em `4d51cef`: DELETE compara os dois TTLs com `now()` do PostgreSQL. A regressão inspeciona o SQL e o harness exerce o DELETE real. |
| Inventário, plano escolhido pelo browser, garantias SQL e `_gl` divergentes | Reconciliados em `0ce960d` no app e `048b9ce` na landing. `planId` é entrada legítima; preço/ciclo/trial continuam no servidor. Clique de âncora recebe `_gl`; navegação automática não. |
| F5 devolvia a primeira pergunta | Corrigido em `signup-questions.tsx`: somente as quatro respostas impessoais são mantidas no navegador, com validação fechada e prazo de uma hora sem renovação por edição. Uma sessão nova, expirada ou respostas salvas no servidor apagam o rascunho. Nome, e-mail, senha e aceite não entram nele. |
| P3 do Sandbox matava o processo antes do POST | Runner corrigido: um processo Node, um POST real e perda de transporte injetada antes de o adapter consumir a resposta. Reconciliação usa somente GET; a prova não afirma ter medido `creation_unknown` no banco. Esse estado é medido separadamente no harness SQL. |
| P2 declarava medir ciclo/vencimento sem compará-los | Agora compara ciclo e a primeira cobrança real. `nextDueDate` da assinatura já havia avançado para o próximo mês; o vencimento da primeira cobrança permanece no fim dos sete dias. A primeira asserção contra `nextDueDate` falhou e foi corrigida para medir o objeto certo, conforme o contrato do Asaas. |
| DELETE 500 no Sandbox era tratado como resíduo sem readback | Uma execução recebeu 500 no DELETE e a leitura posterior provou exclusão. O runner registra respostas inconclusivas e reprova se a leitura não comprovar remoção de cada assinatura/customer criado, incluindo referências cuja resposta se perdeu. |
| Reconciliação ativava assinatura sem conferir estado/valor | **Novo defeito confirmado na reanálise.** O caminho `creation_unknown` localizava um ID e ativava o draft. Agora relê a assinatura, exige `ACTIVE`, valor do catálogo e correlação de assinatura/customer/referência. Divergência conserva `creation_unknown`, sem nova cobrança ou tenant. O UPDATE exige versão e TTL válidos. |
| Plano podia mudar depois da reserva da assinatura | **Novo defeito confirmado por teste antes da correção.** `PUT /api/signup/plan` aceitava trocar para um plano caro enquanto o billing já usava o barato, inclusive em `active`. O UPDATE agora só aceita estado vazio ou `failed`; `reserved`, `creation_unknown` e `active` bloqueiam também o fallback idempotente. O harness prova esses estados e a disputa entre trocar plano e reservar billing. |
| `security:browser-session` 2/6 | Falha de captura: navegação seguinte invalidava corpo RSC de prefetch iniciado no login. A preparação espera o término da rede antes da troca. Nenhum erro de leitura é ignorado; controles positivos verificam bearer em payload, IndexedDB e corpo ilegível. |
| 32 hashes diferentes em produção | **Não era divergência de SQL:** todos coincidem com os arquivos atuais convertidos para CRLF. 105/105 aplicadas; 0096–0104 coincidem byte a byte. Nenhum journal foi reescrito. |
| Dois hashes antigos do DEV sem origem identificada | `0051` e `0093`: não localizados no histórico Git. Schema atual comparado em transações READ ONLY: colunas/defaults, FK `ON DELETE RESTRICT`, duas permissões e sete vínculos de papel coincidem com SQL e produção. Proveniência dos bytes originais: **NOT TESTED**. |
| Roteiro humano prometia cartão e retomada de todos os campos | Corrigido para o contrato implementado: cadastro sem cartão, cobrança futura hospedada pelo Asaas, perguntas retomáveis no mesmo navegador e identidade sujeita a redigitação. |
| Corrida de provisionamento era descrita como prova de rollback | A perdedora aguarda `FOR UPDATE` e não chega a inserir. O runner agora provoca erro SQL depois do DELETE da sessão e verifica todas as entidades, além de observar sete etapas SQL antes de matar o processo real. O antigo teste com atrasos fixos não comprovava a etapa atingida. |
| Compensação só tinha unit | O runner de provisionamento foi ampliado para recusa, valor divergente e perda do CAS com SQL real e **stub explícito**. Em seguida, o cenário C1 do runner Sandbox reuniu perda real do CAS no Postgres, orquestração de produção e cancel/delete no Asaas real; leu ambos os recursos excluídos antes do teardown, sem segundo POST ou tenant. |
| Cleanup do webhook declarava readback de customer sem realizá-lo | Corrigido: assinatura e customer agora exigem `deleted=true` ou 404, com ID conferido; o contador HTTP não decide mais o veredito. O guard também exige endpoint HTTPS oficial do Sandbox. |

Contrato do vencimento: [atualização de assinatura](https://docs.asaas.com/reference/atualizar-assinatura-existente)
e [cobranças da assinatura](https://docs.asaas.com/reference/listar-cobrancas-de-uma-assinatura).

## Medições

As execuções abaixo capturam o estado desta revalidação; provas históricas estão identificadas.

| Verificação | Resultado medido |
| --- | --- |
| Vitest completo da correção | **PASS** — 3.997/3.997, 397 arquivos, 148,82 s, exit 0; inclui as quatro regressões adicionais de congelamento do plano |
| Integração com a main atual | **PASS em CI** — `e0e8f15`, 4.086/4.086 testes, 401 arquivos, 270,31 s, exit 0; inclui perfil WhatsApp do PR #16. [Execução completa](https://github.com/joaomarcos-techia/Project_OS/actions/runs/35668163487) passou também audit de dependências, lint, tipos, arquitetura, migrations, observabilidade, cobertura, inventário, isolamento de tenants e build |
| TypeScript e ESLint | **PASS** — `npx tsc --noEmit` e `npx eslint .`, exit 0 |
| Next em modo produção | **PASS** — `npx tsx scripts/security/local-build.ts`, exit 0; build isolado com ambiente sintético, sem conectar ao banco de produção |
| Sessão no navegador | **PASS** — `npx playwright test --config=playwright.httponly.config.ts`, 7/7, 44,0 s, exit 0, repetido no build com a trava de plano |
| Vitest focado em perguntas e checkout | **PASS** — 60/60, dois arquivos, exit 0 |
| Sandbox billing | **PASS** — P1–P4 4/4 + descoberta e readback de cleanup 2/2; exit 0; 5 assinaturas e 5 customers removidos |
| Harness SQL de signup | **PASS** — 26/26, exit 0, cleanup zero e Postgres próprio encerrado; catálogo/versão de reconciliação e congelamento do plano conferidos; prova antes da correção falhou com `plano nao pode mudar enquanto billing esta reserved` |
| Harness SQL + navegador | **PASS** — comando com `--browser`, 27/27, exit 0; F5 retoma a pergunta, segunda aba recupera escolhas, largura de 390 px sem overflow; Auth externo é fixture, não entrega real de e-mail |
| Migrations PROD/DEV | **PASS** — 105/105 nos dois, leitura `transaction_read_only=on`; Track O com hashes exatos |
| Origem dos dois hashes antigos DEV | **NOT TESTED** — nenhuma versão encontrada no histórico disponível; estruturas atuais equivalentes |
| Reconciliação + webhook + compensação Sandbox/SCHEMA | **PASS** — 12/12, exit 0: nove casos de webhook, dois de reconciliação por preço/estado e C1 de compensação real após perda do CAS. C1 confirmou 1/1 assinatura e customer excluídos antes do teardown; cleanup dos outros dois tenants confirmou 2/2 assinaturas e 2/2 customers removidos |
| Provisionamento isolado | **PASS** — `npx tsx --conditions=react-server scripts/security/signup-provision-db.ts`, 12/12, exit 0, 105 migrations reais; erro SQL após DELETE, crash em sete pontos observados e três compensações com provider stub. Oito drafts de casos negativos permaneceram até a destruição do cluster descartável; nenhum recurso externo criado por esse runner |
| O-7 autenticado Preview | **PASS** — `e0e8f15`, 5/5 sem skip, 1,1 min, exit 0; dashboard, documentação, 404, tour e convergência de duas abas. `E2E_AUTH_REUSE=1`; [Preview medido](https://project-cofoulm3e-clinic-os-v2-s-projects.vercel.app) |
| Landing | **PASS** — `npm run comecar` 27/27; `conversao` 2/2 ligado; `seguranca` 20; lint, typecheck e build exit 0 |
| Variáveis órfãs na landing | **PASS** — `npx vercel env ls`, exit 0: nenhuma variável no projeto `landing-page` |
| Observabilidade | **PASS** — 19 crons coerentes e sete eventos de saved-search presentes, exit 0 |
| Inventário de segurança | **PASS** — `npx tsx scripts/security/inventory.ts --check`, exit 0; [inventário regenerado](../security/acoes.md), sem guardas não resolvidos, env pública não registrada ou testes de rota ausentes |
| E2E público do CI | **PASS no escopo executado** — 6 passaram, 2 skips condicionais às flags do ambiente sintético; os skips não contam como testes aprovados |
| HTTP público de produção | **PASS** — GETs HTTP 200; CTAs 8/5/4 e WhatsApp zero em home/preços/psiquiatria; canais institucionais preservados; login direto; GET/POST `/api/lead` e POST irmão inexistente 404 sem challenge; nenhum cadastro enviado |

### Publicação

Landing: correções documentais publicadas em `main`, `048b9ce`, com os seis gates acima aprovados.
Arquivos locais preexistentes `.claude/settings.local.json` e `_to_delete/` foram preservados e não
incluídos no push. App: integração acompanhada no [PR #15](https://github.com/joaomarcos-techia/Project_OS/pull/15),
sem trocar a branch do worktree compartilhado. A atualização `9d2a668` de `main` (perfil WhatsApp,
PR #16) foi preservada; o único conflito estava no inventário gerado, refeito a partir do código combinado.

Comandos no worktree do app (binários diretos; não usar `pnpm <script>`):

```powershell
npx vitest run
npx tsc --noEmit
npx eslint .
npx tsx scripts/security/local-build.ts
npx playwright test --config=playwright.httponly.config.ts
npx tsx --conditions=react-server scripts/security/signup-regression.ts --browser
```

Sandbox: fornecer somente `ASAAS_API_KEY_DEV`, `ASAAS_BASE_URL_DEV` e `ASAAS_WEBHOOK_TOKEN_DEV` como
seus aliases sem sufixo no processo do runner; `SANDBOX_CONFIRM=ASAAS_SANDBOX_ONLY`. Nunca carregar
o ambiente inteiro num runner que cria banco descartável: `DATABASE_URL_DEV` substituiria a conexão
temporária pela normalização de aliases. O runner billing não usa banco, mas o validador de ambiente
exige URLs sintéticas locais e a chave pública sintética. Nenhum valor de credencial faz parte do relatório.

## O que ainda exige ação ou prova externa

1. **Aceitação de produto — NOT TESTED.** Percorrer o [roteiro corrigido](../runbooks/aceitacao-humana-cadastro.md)
   no Preview conectado a DEV/Sandbox, usando alias consentido. Confirmar pelo celular, retomar no
   computador, concluir plano/assinatura, observar dashboard, tour, checklist e ajuda. Registrar
   aceito/ressalvas/recusado na matriz; sem e-mail, token ou documento pessoal no registro.
2. **Crédito final no Google Ads — BLOCKED por acesso ao painel.** A requisição emitida já foi
   observada; conferir a ação “Cadastro iniciado” e o crédito correspondente no painel é outra prova.
   Não criar cliques de anúncio ou conversões artificiais para forçar esse resultado.
3. **Configuração interna de Supabase — BLOCKED por autenticação administrativa.** O token de gestão
   disponível respondeu 401. Conferir no DEV e PROD: confirmação de e-mail, política de senha,
   SMTP/Resend, template, Site URL e allowlist de redirecionamento. O callback de cadastro deve estar
   no domínio correto do ambiente. Não copiar segredos; registrar apenas nomes e estados.
4. **Painéis Vercel/Asaas — validação limitada.** Listagens autenticadas provam nomes/escopos de envs,
   deploys Ready e webhooks habilitados/sem interrupção. Não provam todos os valores ou entrega de
   um evento pelo painel até a aplicação. A prova webhook do runner exercita a rota real e o
   readback real do Asaas, mas entrega o evento pelo harness.
5. **Conversão final de assinatura — NOT TESTED e não implementada como medição Ads.** O app não
   tem tag Google; “Cadastro iniciado” mede a passagem pela landing. Instrumentar a assinatura
   final exige decisão própria sobre evento/consentimento/atribuição, não faz parte deste reparo.
6. **Aceite documental.** ADR-053 continua Proposed e o checklist §21.20 ainda precisa registrar
   as decisões de aceite. Implementação não substitui a assinatura do responsável de produto.

A antiga lacuna de compensação externa foi fechada para o cenário de perda de CAS pelo C1 acima.
Recusa e mismatch continuam com SQL real e provider stub no runner de provisionamento; o PASS
externo não é estendido a cenários não executados. A origem dos dois hashes históricos do DEV
permanece sem prova documental, embora as estruturas atuais tenham sido comparadas.

As falhas intermediárias de execução permanecem no relato: P3 original inconclusiva; P2 comparando
o próximo ciclo ao primeiro vencimento; DELETE 500 com exclusão confirmada; captura RSC abortada;
execução paralela dos dois harnesses disputando a porta de fixture 55440 (reexecutados em sequência).
Uma execução completa teve 3.996 PASS e um timeout na espera de redirecionamento do convite;
o arquivo isolado passou 11/11 sem mudança de timeout. A execução completa final é registrada acima.
Nenhum desses resultados foi promovido a PASS sem uma medição posterior apropriada.
