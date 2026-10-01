# Prompt — auditoria integral, execução e ampliação dos testes do Qoro

Trabalhe no repositório `C:\dev\ClinicaOS_V2`, em português do Brasil. Atue como responsável pela qualidade funcional, engenharia de testes, segurança de aplicação e confiabilidade das integrações do Qoro/ClinicaOS.

Sua missão é **analisar todas as funcionalidades existentes, mapear a cobertura real, executar e diagnosticar os testes antigos, corrigir defeitos comprovados e criar/executar os testes ausentes**. Quero evidência de que cada ação produz o resultado correto na interface, no servidor, no banco e, quando aplicável, no serviço externo.

**WhatsApp é a única frente explicitamente adiada por mim.** Todo o restante entra na análise e na validação. Não encerre o trabalho depois de produzir um plano ou uma lista de sugestões: avance da descoberta para implementação dos testes, execução, correções e retestes, respeitando os limites operacionais abaixo.

## 1. Escopo e significado de conclusão

Inclua UI, Server Actions, APIs, domínio, Postgres/RLS, autenticação, permissões, Storage, PDFs, exportações, tarefas agendadas, outbox, integrações, observabilidade e recuperação operacional. O universo é a funcionalidade realmente existente no checkout e os contratos de produto aprovados que a regem.

Para cada item, diferencie:

- **Implementado e comprovado:** execução atual demonstra o comportamento.
- **Implementado sem prova suficiente:** existe código, mas falta teste ou execução adequada.
- **Implementado com defeito:** reprodução atual contradiz o contrato esperado.
- **Parcialmente implementado:** só uma parte da jornada existe.
- **Não implementado:** há apenas proposta, placeholder, especificação ou roadmap.
- **Adiado por escopo:** somente a frente WhatsApp definida abaixo.

Mapear uma funcionalidade ausente não autoriza criar um módulo de produto novo. Corrija defeitos do comportamento existente e desenvolva os testes necessários. Se faltar uma decisão funcional, explicite a dúvida e continue as frentes independentes. Não escolha uma regra nova apenas para fazer o teste passar.

“Testar todas as possibilidades” significa inventariar todas as ações, estados e transições finitas existentes, cobrir classes de entrada, limites, combinações críticas e modos de falha. Use tabelas de decisão e testes parametrizados; para combinações não críticas muito numerosas, use combinação por pares ou amostragem justificada. Nunca prometa exaustividade sobre entradas infinitas, concorrência ilimitada ou serviços de terceiros.

O aceite exige **nenhuma ação implementada esquecida**, rastreabilidade entre comportamento e teste, resultado atual por cenário e explicação concreta de qualquer lacuna remanescente.

## 2. WhatsApp adiado, sem adiar o restante

Não execute nem tente resolver nesta tarefa Embedded Signup, Facebook Login/App Review, WABA/número, perfil WhatsApp Business, templates/categorias, configuração Meta, envio/recebimento real ou callbacks de entrega do WhatsApp. Registre essas provas como `ADIADO_WHATSAPP`, fora do denominador de aceite desta auditoria.

Preserve os testes determinísticos existentes desses módulos na regressão geral. Não os apague, desative ou enfraqueça. Falhas que afetem compilação ou lógica compartilhada precisam de diagnóstico; correções específicas do canal ficam registradas para a frente posterior.

Continuam no escopo:

- Gemini, tools, cadastro pelo agente, confirmação de ações, segurança conversacional e efeitos persistidos, exercitados sem transporte Meta real.
- Histórico, permissões, atribuição e handoff em Conversas, nos comportamentos independentes do envio externo.
- Elegibilidade, deduplicação e persistência de jobs proativos; a entrega WhatsApp fica adiada.
- Geração do link de pagamento, checkout Asaas, webhook, conciliação e reflexos em agenda/financeiro. O link pode ser aberto pelo harness autorizado, sem afirmar que foi entregue ao paciente por WhatsApp.

Uma jornada com etapa WhatsApp pode ter etapas independentes `PASS` e entrega `ADIADO_WHATSAPP`. Não a apresente como jornada completa pelo canal. Não reescreva a integração para contornar essa exclusão.

## 3. Leia e reconstrua o estado real antes de executar

Leia as instruções aplicáveis e inventarie `/docs` integralmente. Registre quais fontes foram consultadas e quais partes são históricas. Cruze a documentação com código, migrations, configurações e testes. Prioridade para:

- `docs/README.md`, `docs/CURRENT-STATE.md`, `docs/VisãoGeral.md`, `docs/CONVENTIONS.md` e `organizar_docs.md`.
- `docs/quality/e2e-coverage-audit.md`, `docs/quality/e2e-coverage-matrix.md`, `docs/development/testing.md` e `e2e/README.md`.
- `docs/qorov2.md`, incluindo o estado canônico e os checkpoints mais recentes; `docs/discovery-log.md`, `docs/handoff-qorov2.md` e os prompts anteriores de retomada.
- `docs/domains/`, `docs/frontend/`, `docs/database/`, `docs/backend/`, `docs/billing/`, `docs/ai/`, `docs/integrations/` e `docs/contracts/`.
- `docs/security/`, `docs/achados/`, `docs/audits/`, `docs/AUDITORIA_C0_C10_COMPLETA.md`, `docs/testesC15.md` e `docs/c16/`.
- `docs/adr/`, especialmente decisões vigentes de sessão, MFA, permissões, retenção, criptografia clínica, acesso a PDFs, pagamentos, ledger, documentos, exportação contábil e cadastro autônomo.
- `docs/runbooks/`, `docs/operations/`, `docs/engineering/`, `docs/roadmap/known-limitations.md` e `docs/archive/evidence-snapshots.md`.
- Documentação de design/UI para identificar estados e fluxos preservados, sem transformar referência visual em requisito funcional.

Leia também `package.json`, versões efetivas, `vitest.config.ts`, os quatro `playwright*.config.ts`, `.github/workflows/`, `vercel.json`, `e2e/`, `security-e2e/`, testes em `src/` e scripts de smoke/security/live-check/simulação/carga. Siga as referências aos helpers, fixtures, guards e cleanup.

O antigo `teste2e2.md` não existe no checkout de referência: foi removido na consolidação documental do commit `d8d442d`. Pode ser consultado no Git, por exemplo na revisão `60ce22a`, para recuperar cenários e regressões. Não o restaure como fonte canônica, não herde suas autorizações operacionais e não converta seus resultados em PASS atual.

**Precedência:** implementação e configuração versionadas definem o comportamento disponível; contratos aprovados definem o esperado; execução atual demonstra o observado. Documentação divergente precisa de reconciliação. Um bug não vira requisito porque está no código; um desejo de roadmap não vira comportamento implementado porque está documentado.

### Ponto de partida verificado em 28/09/2026

Esta é uma fotografia para orientar a descoberta; recalcule tudo no início da execução:

- Branch observada: `snapshot/estado-atual-2026-09-27`; HEAD `7d6032dd98e03be53b1f86105dcdd9ce1c5079be`.
- Contagem estática: 54 páginas `page.tsx`, 41 arquivos `route.ts`, 58 specs em `e2e/`, sendo 44 `production-*`, e 384 arquivos `src/**/*.test.ts(x)`.
- Há uma suíte adicional em `security-e2e/http-only-session.spec.ts`. Arquivos não equivalem ao número de casos executáveis; loops, projetos e parametrizações precisam ser contabilizados pelo runner apropriado.
- Node observado: 22.16.0; pnpm: 11.17.0. Confirme `engines` e `packageManager` atuais.
- O CI versionado já chama `pnpm test:e2e:ci` e `pnpm security:browser-session`. Trechos que dizem “nenhum Playwright roda em CI” estão desatualizados. Isso não prova execução remota desta revisão nem cobertura autenticada completa.
- A matriz documental distingue provas locais do cadastro com Auth/Redis sintéticos de evidência externa. Os checkpoints posteriores registram confirmação por e-mail no Preview, replay e comportamento entre navegadores; confira a etapa exata de cada prova.
- Checkout/provisionamento futuro do cadastro autônomo não deve ser confundido com `/join` por convite nem com checkout de pagamento de paciente já implementado.

Esses números e observações vieram de inspeção, **não de execução da suíte nesta preparação do prompt**.

## 4. Ambiente, autorizações e dados de teste

Comece por branch, SHA, status/diff, runtime, comandos e identificação sanitizada dos ambientes. Preserve alterações preexistentes. Não use `reset --hard`, limpeza ampla nem troca de branch que descarte trabalho.

Use alvo local descartável ou Preview dedicado e isolado para escritas de teste. A URL da aplicação sozinha não prova isolamento: confira também banco, Auth, Storage, Redis, Asaas, e-mail e destinos dos jobs. Um localhost pode estar conectado a produção.

Respeite autorizações válidas da sessão sem pedir novamente. Na ausência delas, obtenha confirmação específica antes de migrations, operações destrutivas, mudanças em CI/build/deploy, dependências de produção, contratos públicos, refatoração ampla ou mutações em recursos externos/compartilhados. Prepare antes o comando, alvo, efeito, guard e rollback/cleanup revisáveis. Continue trabalho independente enquanto aguarda.

Não faça push, merge, deploy ou mutação de produção por inferência deste pedido. Autorizações históricas para Clínica A não concedem permissão geral para novos testes, cobrança, refund ou recursos fora daquele escopo.

Não inspecione nem altere `.env.local` desnecessariamente. Use loaders existentes e credenciais já disponibilizadas por canal seguro, sem imprimir valores. Nunca copie segredos, tokens, cookies, chaves Asaas, TOTP, conexão de banco, dados de cartão ou PII para relatório, chat, fixture versionada ou artefato público.

Antes de cada grupo mutável, tenha:

1. Alvo e identidade do projeto confirmados, com allowlist positiva de ambiente.
2. Clínicas A e B sintéticas isoladas, usuários/roles próprios e plano/assentos suficientes.
3. Fixtures identificadas por `runId`, IDs exatos e proveniência; controle positivo no tenant dono.
4. Escopo dos efeitos externos conhecido, incluindo jobs/outbox disparados indiretamente.
5. Cleanup em `finally`/teardown, restrito aos IDs da execução, com readback de resíduos.
6. Restauração verificada de configurações, permissões e estado global alterado.

Cleanup que falha é resultado da auditoria; não engula a exceção nem esconda a falha original. Não apague trilhas imutáveis para forçar “zero”: distinga resíduos indevidos de auditoria/ledger que devem permanecer por contrato.

Não habilite todas as flags `E2E_*` e rode a suíte indiscriminadamente. Muitos `production-*` exigem host e banco de produção; classifique cada um. Reaproveite seus cenários em alvo seguro com fixtures próprias e guards equivalentes, sem remover proteções para fazê-los rodar.

Fixtures por SQL/admin servem para preparação e inspeção independente. A **ação sob teste** deve atravessar UI/API/Server Action e a autorização real. Não use `dbAdmin` para simular que o usuário conseguiu executar a ação.

## 5. Entrega inicial: inventário rastreável e matriz de cobertura

Derive o inventário de páginas, ações exportadas, formulários, rotas HTTP/métodos, serviços, tabelas/constraints/RLS, eventos/handlers, crons, integrações e exports. Inclua ações secundárias, caminhos de erro, botões destrutivos e endpoints sem tela.

Crie ou atualize uma matriz com estes campos, distribuídos em tabelas legíveis quando necessário:

`ID | domínio | funcionalidade | ação/entrada | contrato e fonte | implementação | ator/permissão | tenant/ownership | pré-condições | estado inicial | resultado UI/HTTP | mudança persistida | efeitos assíncronos/externos | efeitos proibidos | cenário positivo/negativo/limite/concorrência | teste/asserção existente | lacuna | ambiente | evidência | status atual`.

Separe **cobertura existente** de **resultado da execução**. Uma linha “Coberto” não significa PASS hoje. “Fora do navegador” é camada de teste, não exclusão nem prova automática de integração real.

Para cada ação responda:

- Quem pode executar, sobre qual registro e em qual estado?
- Quem deve receber negativa, e qual comportamento de negativa é esperado?
- O que muda exatamente, com valores, cardinalidades e versões esperadas?
- O que não pode mudar, inclusive em outros tenants e domínios?
- Qual evento, auditoria, job, arquivo ou chamada externa nasce dela?
- Como confirmar o resultado após reload, nova sessão e leitura independente?
- O que acontece se repetir, concorrer, expirar, interromper ou perder a resposta?
- Como detectar e recuperar efeito parcial sem duplicar operação?

Identifique cada ação sem teste e cada teste sem contrato relevante. Não use apenas contagem de specs, linhas ou porcentagem global de coverage como medida de qualidade.

## 6. Audite os testes antigos antes de confiar no verde

Leia cada família e execute uma baseline compatível com o ambiente confirmado. Registre comandos exatos, horários, duração, exit code, SHA/diff, casos esperados/descobertos/executados, aprovados, falhos, skips, retries e artefatos sanitizados.

Verifique `test.only`, `test.skip`, `fixme`, retornos antecipados, condicionais que pulam asserts, erros engolidos, seletores obsoletos, fixtures compartilhadas, datas fixas, dependência de ordem, sleep arbitrário, mocks de resposta final e limpeza incompleta.

Pontos concretos encontrados na inspeção do checkout de referência, a reproduzir e corrigir conforme o contrato:

- `e2e/authenticated-readonly-routes.spec.ts`: usa `status < 500`, coleta contagens sem afirmar comportamento e retorna `empty` quando não há link dinâmico. Isso pode aprovar 404/negativa ou deixar a jornada dinâmica sem exercício. Use fixtures e expectativas por rota/role, preservando o caso vazio como cenário explícito.
- `e2e/admin-boundary-rbac.spec.ts`: o loop verifica ausência de determinados textos administrativos, mas não afirma positivamente a negativa esperada por rota. Uma página de erro sem esses textos pode passar. Prove sessão válida antes, negativa correta e ausência de vazamento no corpo/RSC/dados retornados.
- `e2e/payments-account-lifecycle.spec.ts` e outros helpers: `catch` genérico pode converter qualquer falha de login em skip atribuído a provável rate limit. Só classifique 429/limite quando houver evidência; falha inesperada precisa aparecer.
- Nesse lifecycle, `lerEstado` considera “conectada” qualquer tela que não contenha o texto de conta vazia. Exija estado conhecido; tela quebrada não é conta conectada.
- O ciclo Asaas e o CRUD de modelos em `e2e/tenant-settings-screens.spec.ts` dependem do fim feliz para cleanup. Uma asserção intermediária pode deixar estado vivo. Garanta teardown verificável e revise seletores como `.listrow` contra a UI atual.
- Descrições como “não expõe chave” precisam de assertiva efetiva no caso executado. Um caso condicional pulado não fornece essa prova ao restante do arquivo.
- Revise logs legados de specs de dashboard/RBAC: a narrativa impressa deve corresponder às assertivas e aos resultados reais.
- Confira o que `E2E_ARTIFACTS=0` realmente configura: `retain-on-failure` ainda pode guardar cookies/PII. Desligue ou sanitize captura autenticada sensível antes de compartilhar artefatos.

Não trate todos os usos de `status < 500` como erro por regex: examine as assertivas de negócio seguintes. O defeito é aceitar resultado insuficiente como prova do contrato.

Classifique cada falha antes de corrigir:

1. Regressão do produto: contrato correto, implementação defeituosa → corrija produto e adicione regressão.
2. Teste errado/obsoleto: contrato aprovado mudou ou o teste mede o atributo errado → corrija a assertiva e documente a fonte.
3. Fixture/ambiente/harness defeituoso → corrija setup, isolamento ou sincronização, preservando a exigência funcional.
4. Falha ou limitação real do provedor → preserve evidência e separe da falha local.
5. Requisito ausente/ambíguo → decisão explícita antes de alterar comportamento.

Nunca faça o produto reproduzir um bug para satisfazer teste antigo. Nunca retire assertivas, aumente retries/timeouts sem diagnóstico, reduza thresholds ou desative segurança para obter verde. Um teste que só passa no retry deve permanecer identificado como instável.

## 7. Padrão mínimo para testes novos ou corrigidos

Use a camada adequada: unitário para regras e combinações; integração com banco real para transações/RLS/constraints; HTTP/Server Action para autorização/contrato; Playwright para jornada; provider sandbox para integração externa; carga em ambiente descartável para concorrência/limites.

Mocks e transportes sintéticos podem produzir falhas determinísticas, mas devem estar identificados. Não servem como prova de entrega de e-mail, pagamento, Auth externo ou qualquer gate do provedor. Não intercepte com resposta de sucesso a chamada cujo funcionamento o teste promete validar.

Para todo comportamento relevante, cubra:

- Caminho feliz completo, efeitos persistidos e reload/readback.
- Ausente, nulo, vazio, espaços, formato inválido, IDs inexistentes, campos extras, multibyte e limites imediatamente abaixo/no/acima do máximo aplicável.
- Negativa de permissão pelo servidor; UI oculta não basta.
- Próprio tenant permitido e A→B/B→A negado, incluindo referências filhas e IDs adulterados.
- Estados permitidos/proibidos, registro removido, sessão/ação expirada e versão desatualizada.
- Duplo clique, retry, replay, resposta perdida, duas abas e concorrência real com início coordenado.
- Falha de DB, provider, rede, Storage ou worker quando aplicável; rollback e ausência de efeitos parciais indevidos.
- Feedback utilizável, correlação/auditoria e ausência de segredos/PII indevidos.

Construa os valores esperados a partir da fixture e do contrato, sem chamar a mesma função produtiva para calcular resultado e expectativa. Para valores financeiros, use centavos/arredondamento explicitamente definido; para tempo, relógio controlado nos testes locais e fuso da clínica.

Espere condições observáveis com prazo limitado, não sleeps arbitrários. Testes devem falhar por uma regressão específica, e não apenas afirmar que a página existe.

## 8. Matriz funcional obrigatória

### A. Autenticação, cadastro, convites e sessão

- Login válido/inválido, usuário inexistente/inativo/excluído, rate limit por IP/e-mail, CAPTCHA e indisponibilidade de dependências.
- Cookies HttpOnly/Secure/SameSite, fragmentação e geração; nenhum bearer no HTML, RSC, JavaScript, storage ou logs.
- Refresh próximo da expiração, múltiplas abas, refresh atrasado após logout/troca de conta/OTP, ausência de loops e recuperação segura.
- Logout em múltiplas sessões, replay de cookie/bearer antigo e revogação real quando a prova externa estiver disponível. Invalidação local não comprova revogação no provedor.
- MFA: enrollment, desafio, step-up, código inválido/expirado/reutilizado, remoção, fator órfão e bootstrap de super_admin sem ficar preso fora da tela de configuração.
- Recovery: anti-enumeração, entrega/callback, token inválido/expirado/uso único, concorrência de consumo, troca de senha, revogação e redirects hostis.
- Convite de equipe e `/join`: criação, reenvio, cópia, fragmento/legado, aceitação, expiração, revogação, duas aceitações simultâneas, usuário já existente e destino correto.
- Cadastro autônomo: `/cadastro`, sessões, respostas, identidade/consentimento, Auth, reenvio, callback, `/cadastro/continuar`, ownership e draft realmente implementados. Verificar CAS, TTL idle/absoluto, janitor, resposta perdida sem retry de signup, senha não retida, budgets, mesmo navegador e navegador distinto.
- Não dar acesso tenant a identidade pré-tenant. Coincidência de e-mail não autoriza apropriação de staging. Confirmar o comportamento de reinício quando falta o cookie anônimo.
- Separar dados legais da clínica, dono da conta e contato/titular de cobrança. Não preencher um com a identidade do outro por conveniência da fixture.

### B. Equipe, permissões, planos e isolamento

- Recalcular roles e catálogo de permissões do código. Exercitar owner, gestor, doctor, attendant, financial, super_admin, anônimo, usuário inválido e pré-tenant nos caminhos pertinentes.
- Criar/convidar/editar/ativar/desativar/remover membro, credenciais profissionais e transições de role; proteger último owner e outras restrições existentes.
- Overrides, concessão/revogação, claims antigas/epoch e tentativa de autoelevação pelo endpoint real.
- Permissão geral versus escopo de profissional/autor; credencial profissional versus role administrativa; clínica não é identidade de pagamento.
- Assentos como limite real, mudanças concorrentes de equipe/plano e aplicação posterior de downgrade. Conferir que métricas de agenda/IA não viram bloqueios inventados.
- Matriz tenant nas tabelas, actions, joins, exports, PDFs, Storage, webhooks e jobs. Usar runtime sem bypass para provar RLS; erro 500/503 não comprova isolamento.

### C. Pacientes, relacionamentos, consentimento e LGPD

- CRUD, busca, normalização/duplicidade, paginação/filtros, dados inválidos, concorrência/rowVersion, soft delete, lixeira e restauração.
- CPF/telefone cifrados, HMAC lookup, falha de chave/versionamento, acesso mínimo e ausência de plaintext indevido.
- Endereço, contatos de emergência, vínculos/responsáveis/menores, merge/proveniência, óbito e suppression conforme implementação.
- Conceder/revogar consentimento com persistência, histórico e efeitos em usos dependentes; não confundir com consentimento do cadastro de usuário.
- Pedido LGPD pela UI/API: exportação/exclusão, estados, prazo, replay, falha/retry, entrega ao destinatário de teste, arquivos corretos e isolamento.
- Export JSON/PDF: conteúdo permitido, ausência de outro tenant, expiração/regeneração e limites reais de revogação de URL emitida.
- Exclusão: cancelamento de fluxos permitidos, bloqueio de restauração quando devido, hard delete versus anonimização por retenção, arquivos derivados e cleanup correlacionado. Executar destruição apenas em fixture/alvo autorizado.
- Inadimplência não deve impedir os direitos LGPD nem a leitura clínica prevista em contrato.

### D. Agenda, recursos e jornadas operacionais

- Procedimentos/preço/duração, profissionais, disponibilidade, horários, pausas, ausências, feriados, recursos/salas e alterações concorrentes.
- Recalcular slots após criar, mover, cancelar, liberar hold, mudar duração/disponibilidade e recurso. Confirmar conflitos de paciente/profissional/recurso por validação e constraint.
- Fuso, virada de dia/mês/ano, horário de parede/DST quando pertinente, antecedência mínima, instante passado e limites exatos dos intervalos.
- Criar/editar/confirmar/check-in/iniciar/finalizar/cancelar/falta e todas as transições normais permitidas/proibidas do código.
- Recuperações explícitas: interromper, cancelamento excepcional, reabrir e transferir. Não confundir esses contratos com arestas da máquina normal.
- Recorrência: ocorrência isolada versus série, cancelamento/edição, conflitos parciais, datas e proveniência.
- Importação: formatos válidos/inválidos, limite de tamanho/linhas, duplicidade, erros por linha, transação/resultado parcial declarado e replay do lote.
- Fila/walk-in/urgência, ordenação determinística, waitlist, expiração/aceite/concorrência de oferta. Entrega WhatsApp adiada.
- Todas as visões e filtros da agenda; datasets acima dos limites usuais devem revelar truncamento, paginação incorreta ou totais inconsistentes.

### E. Consultório, prontuários, prescrições e documentos

- Jornada `Agenda → Consultório → Prontuário/documentos → Encerramento → Caixa` com os mesmos IDs e resultados reconciliados.
- Fila, prioridade, escopo do profissional, atualização periódica e duas pessoas tentando iniciar/encerrar o mesmo atendimento.
- Templates existentes, incluindo Psiquiatria; preencher, salvar, autosave, reload, campos vazios/opcionais, conflitos e perda de rede.
- Assinatura imutável, autoria/credencial, assinatura concorrente, tentativa de editar assinado e correção legal que preserva versão anterior.
- Documentos dentro e fora da consulta, modelos de receita CRUD/aplicação, atestados, exames, declarações, encaminhamentos e modalidades de prescrição implementadas.
- PDFs: conteúdo/texto e identidade corretos, múltiplas páginas/acentos/campos extensos, download real, headers, autorização atual, A↔B e sessão/permissão revogada.
- Rotas autenticadas dos PDFs clínicos não devem expor URL direta/token do Storage. Diferenciar esse contrato do export LGPD temporário.
- Finalização clínica produz no máximo um recebível; replay, falha do consumer e reconcile não duplicam faturamento. Pagamento/disputa posterior não apaga fato clínico.
- Não atribuir integração Memed, assinatura digital externa ou emissão fiscal ao produto sem implementação comprovada.

### F. Financeiro, caixa, créditos e conciliação

- Receber/pagar, fornecedores, métodos, vencimentos, valores, centavos, filtros e paginação.
- Recebimento/pagamento integral e parcial, cancelamento, estorno parcial/integral, sobrepagamento, comprovantes existentes e permissões próprias de operação/reembolso.
- Ledger append-only com original e compensação; totais reconciliados entre lançamentos, transações, créditos e UI.
- Duas baixas simultâneas, baixa versus estorno, versão antiga, replay e impossibilidade de ultrapassar o saldo segundo o contrato.
- Sinal, crédito disponível/alocado/bloqueado/revertido, aplicação ao recebível, saldo remanescente e excesso. Reembolso não pode liberar/reutilizar dinheiro duas vezes.
- Conciliação financeira e rollup: consulta concluída sem recebível, processamento duplicado, atrasado e estorno fora da janela padrão.
- Pendências/collection cases, resolução/reabertura e separação entre lembrete de cobrança e movimentação de dinheiro.
- Método convênio é comportamento financeiro existente; não implica TISS, autorização de operadora, glosa ou repasse implementados.

### G. Dashboards, relatórios, exports e configurações

- Dashboard vazio e não vazio, KPIs contra fixture independente, período/fuso, gráficos, próximos atendimentos, atividade e permissões de finanças/auditoria.
- Relatórios e PDFs com/sem permissão financeira; ausência de valores sensíveis também no payload, não apenas no componente oculto.
- CSV contábil: mês civil no fuso, quatro combinações receber/pagar × pagamento/estorno, sinal de caixa, arredondamento, ordenação, BOM/separador/CRLF, formula injection e limite sem exportação silenciosamente truncada.
- Auditoria CSV: colunas permitidas, conteúdo mínimo, paginação/limites e RBAC; não reprovar a palavra “prontuário” se ela identifica legitimamente o tipo de recurso.
- Perfil da clínica/profissional, credenciais, upload de logo e limites alinhados entre cliente, multipart/Server Action e plataforma; tipo inválido, excesso, troca, falha de upload e reload.
- Horários, procedimentos, recursos, configurações do agente/convênios, assinatura e pagamentos; erro de salvar deve ser visível e não aparentar persistência.
- Sugestões/feedback: autor privado mesmo dentro da clínica, A↔B, acesso global autorizado, CRUD/status/export que existirem.
- UI transversal: loading/empty/error, teclado/foco, labels, confirmação destrutiva, mobile, temas, reload/back/deep-link, filtros/página na URL e ausência de erros de navegador. Smoke visual não substitui E2E funcional.

### H. Administração da plataforma

- Percorrer páginas e ações reais de `/admin`: clínicas, detalhe, billing, feedbacks, IA, métricas, saúde, auditoria e configuração.
- Negar anônimo/tenant/role inadequada/AAL insuficiente sem vazamento e com controle positivo de sessão válida.
- Impersonação: step-up, criação, escopo, banner, ator verdadeiro na auditoria, expiração, encerramento e revogação da linha mesmo com cookie intacto.
- Kill-switches, flags e anúncios existentes: estado e auditoria atômicos, efeitos reais nos consumidores e restauração do valor original.
- Falha/timeout no meio da operação não deixa privilégio ou configuração global indevidos.

## 9. Asaas: duas matrizes completas e independentes

Inspecione adapters, actions, schemas, máquinas de estado, webhooks, crons e scripts existentes. Consulte documentação oficial atual do Asaas quando precisar confirmar contrato externo; registre versão/data e diferença entre SDK, API e comportamento observado.

Nunca misture credenciais, IDs, webhooks ou saldos da assinatura SaaS com os da conta da clínica que recebe do paciente.

### 9.1 Assinatura do Qoro — clínica paga a plataforma

Cubra customer, assinatura, plano/preço efetivo/campanha, trial e ciclo existentes, primeira cobrança, recorrência, faturas, pagamento, atraso, dunning, acesso, cancelamento, revogação do cancelamento e reativação.

Teste upgrade/prorrata e pagamento antes de aplicar o plano; downgrade agendado e revalidação de assentos na aplicação. Erro do Asaas não pode ser apresentado como plano alterado com sucesso.

Percorra criação/provider versus persistência local: falha antes/depois de cada etapa da saga, compensação possível, compensação falha, resposta perdida e retomada sem duplicação. Não crie cobrança real para “ver se resolve”.

Teste webhook `/api/webhooks/asaas` e reconcile: materialização de fatura ainda ausente, atualização, remoção/restauração quando suportadas, evento perdido, duplicado, atrasado e fora de ordem. Confirme estado autoritativo no provider, não apenas no corpo notificado.

Valide bloqueio de mutations por inadimplência e as exceções contratuais. Login e leitura clínica continuam acessíveis onde previsto.

### 9.2 Pagamento de paciente — paciente paga a clínica

Cubra `/configuracoes/pagamentos`: chave inválida, conta desconectada/conectada, persistência cifrada, identidade da conta correta, RBAC, troca/desconexão com fixture dedicada e nenhum segredo devolvido ao cliente.

Confira webhook por clínica `/api/webhooks/asaas/patient/[ref]`, autenticação, vínculo da referência, eventos configurados, acesso a credencial da própria clínica e isolamento A↔B. Criar registro/configuração não prova entrega; faça evento sandbox percorrer endpoint, persistência, outbox e projeções quando autorizado.

Matriz mínima de pagamentos:

- Política de sinal aplicável/não aplicável, valor fixo/percentual e limites existentes, isenções, prazo e hold.
- Checkout hospedado de PIX/cartão suportados, vínculo à dívida/consulta/tenant, status, expiração e gerações de renovação.
- `creation_unknown` e resposta perdida: não repetir POST cegamente; reconciliar a tentativa original segundo o contrato implementado.
- Pagamento dentro/fora do hold, evento após expiração/cancelamento/falta, crédito disponível/alocado e saldo remanescente.
- Checkout antigo pago depois de renovação, duas gerações pagas, excesso e prevenção de cobrança/baixa duplicada.
- Cancelamento/remoção/restauração e pagamento removido que ainda pode responder HTTP 200 com `deleted: true`; use o estado real retornado.
- Refund integral/parcial, intenção persistida antes do provider, rejeição, pendência, resposta incerta e conclusão por consulta/webhook.
- Disputa/chargeback, bloqueio do crédito, disputa ganha/perdida, reversão de recebimento em dinheiro, parte alocada/não alocada e compensação no ledger.
- Falta de vínculo histórico inequívoco: conciliação manual observável, sem inventar baixa original.
- Nenhuma disputa dispara automaticamente nova cobrança ou envia prontuário ao Asaas.

Para cada caso financeiro, prove separadamente: status da cobrança, confirmação do pagamento, disponibilidade/settlement, estado do refund, crédito local, ledger, saldo do recebível, agenda/prontuário e resultado apresentado ao operador.

`CONFIRMED` não basta para afirmar saldo disponível. Pedido de refund ou aprovação visual não basta para afirmar devolução; confira estado terminal, incluindo `DONE` quando previsto no contrato. Não confunda `chargeback.status = DONE` com `refund.status = DONE`: são objetos e efeitos diferentes.

Os registros D50/D80 são pistas históricas de operações com refund incerto/pendente. Releia o checkpoint e consulte o estado permitido da operação original; não repita refund nem crie nova fixture para esconder a ausência de prova. Limitação do sandbox vira `BLOCKED/PARTIAL` na prova externa, nunca PASS inventado nem permissão para usar produção.

### 9.3 Resiliência dos dois fluxos

Cubra token ausente/incorreto, corpo inválido/excessivo/streaming, entidade desconhecida, payload divergente, valor/titular/tenant incompatíveis, duplicidade, assinatura inexistente, eventos fora de ordem, 401/403/404/429/5xx, timeout, circuit breaker e recuperação.

Prove que erro de consulta autoritativa não confirma pagamento; retry e reconcile não cobram nem estornam de novo. Verifique webhook real chegando ao Preview: um 302 de proteção Vercel ou 401 no endpoint não demonstra entrega funcional. Use apenas o mecanismo de automação autorizado, sem desligar proteção por conveniência.

## 10. Demais integrações externas e operação

Crie uma matriz por serviço: consumidor, credencial/ambiente sem valores, chamada, contrato, sucesso, falha, timeout/retry, idempotência, efeito persistido, evidência externa e cleanup.

- **Supabase Auth:** signup, e-mail confirmado, convites, login/MFA/recovery, refresh/revogação; URLs/templates corretos por ambiente. Teste sintético via SDK instalado é prova local, não GoTrue externo.
- **E-mail Auth/SMTP e Resend:** rastrear qual serviço envia cada mensagem; aceite API, ID, entrega/bounce, conteúdo/link seguro e consumo pelo destinatário de teste. Não tomar HTTP 200 como chegada à caixa postal.
- **Postgres/Supabase:** schema/migrations aplicadas no alvo, grants, FORCE RLS, role runtime, pools, transações/locks/timeout e Data API conforme arquitetura. Indisponibilidade não equivale a autorização negada.
- **Storage:** upload/download, bucket privado/público correto, ACL, path traversal, tamanho/tipo, expiração, arquivos ausentes, falha parcial e limpeza. Validar próprio tenant permitido antes do cross-tenant.
- **Upstash Redis:** rate limit/cache/locks realmente utilizados, isolamento de chaves, concorrência, TTL e falha/degradação conforme contrato; não compartilhar budgets com produção.
- **Cloudflare Turnstile:** challenge/expiry/forja/ausência, origem/hostname/action quando validados e falha do provider. Chaves de teste não comprovam rejeição de token forjado em produção.
- **Gemini:** tools reais, schemas, datas/preços oriundos do sistema, confirmação em dois turnos, ownership, limite de mutations/rounds/custo, timeout/429/5xx, resposta/tool inválida, prompt injection, PII e handoff. Inclua dataset adversarial e chamadas reais controladas quando autorizadas, sem envio Meta.
- **Sentry/Better Stack/logs:** erro controlado até captura e correlação sanitizada; regra de alerta e entrega no canal autorizado são provas separadas. Não dispare mensagens a terceiros sem autorização.
- **Vercel/CI:** artefato/commit correto, boundaries, limites de request/function, configuração por ambiente, crons e heartbeats. Build/deploy verde não comprova negócio ou provider.
- **Backup/restore:** backup recente, artifact íntegro e restore em scratch autorizado, com schema/dados/constraints/RLS/readback e RPO/RTO medidos quando cabíveis. Não restaurar no banco ativo; dump não restaura Auth, Storage e Asaas automaticamente.
- **Providers opcionais/placeholder:** confirmar o implementado. Não tratar Z-API, OpenAI, GCP SDK, Memed, TISS, NFS-e ou outra proposta como integração operacional sem código e evidência correspondentes. Ausência é registrada, não implementada por inferência.

## 11. Outbox, crons, segurança e carga

Recalcule crons a partir de `vercel.json` e handlers do código, não de contagens antigas. Para cada job prove autorização, seleção correta, efeito, idempotência, concorrência, timezone, heartbeat, erro e recuperação.

Cubra negócio + evento na mesma transação, registro real de handlers, schema de evento, reserva/lease, `SKIP LOCKED`, retry/backoff, falha terminal, janitor, finalização tardia e replay controlado. Um harness sem importar o registro de handlers pode produzir `skipped_no_handler` e estragar a própria prova; confira o bootstrap.

`PRODUCER_AHEAD` declarado não é automaticamente defeito. Consumer obrigatório ausente é. Não drene outbox de outras execuções/clínicas nem processe jobs externos fora do alvo autorizado.

Inclua CSRF com sessão válida, IDOR horizontal/vertical, adulteração de IDs/role/tenant/campos ocultos, XSS, SQL injection, CSV injection, redirects abertos, caches compartilhados, vazamento em RSC/HTML/erros/logs e payload sem `Content-Length`. O servidor deve negar a operação, sem efeito colateral e sem vazar dado protegido.

Use scripts existentes de segurança e carga antes de criar infraestrutura duplicada. Carga somente em scratch guardado, com metas/SLOs definidos pelo projeto, volume suficiente para exceder limites/paginação e resultados de latência, throughput, erros, locks e duplicidade. Preserve efeitos financeiros idempotentes sob concorrência.

## 12. Jornadas completas obrigatórias

Além dos testes por módulo, execute jornadas com IDs correlacionados do começo ao fim:

1. Convite/onboarding implementado → usuário/tenant/permissões corretos → configuração mínima → primeira operação. Cadastro autônomo é jornada separada; marque exatamente onde a implementação termina.
2. Paciente → agendamento → check-in → atendimento → prontuário/documento → finalização → recebível → baixa → caixa/dashboard/relatório/export reconciliados.
3. Agendamento com sinal → link/checkout Asaas → pagamento → webhook → outbox → crédito → atendimento → abatimento → cobrança do saldo → quitação, sem depender da entrega WhatsApp.
4. Expiração/cancelamento/falta → pagamento tardio ou duplicado → crédito/excesso/reembolso conforme regra → ledger e agenda consistentes.
5. Pagamento alocado → disputa/perda ou refund → compensação → saldo/reconciliação, preservando prontuário e fato clínico.
6. Assinatura → trial/cobrança → webhook → atraso/restrição → pagamento/reativação, incluindo troca de plano e assentos.
7. Convite de membro → mudança de role/permissão → sessão antiga → revogação/remoção → tentativa de replay e acesso direto.
8. Pedido LGPD → processamento → export/entrega ou exclusão/anonimização → verificação de resíduos permitidos/proibidos.
9. Super_admin → MFA → ação de plataforma/impersonação → auditoria → encerramento/revogação → negativa posterior.
10. Falha entre duas etapas → reprocessamento/reconcile → convergência sem duplicar ação, cobrança, crédito, documento ou evento obrigatório.

Cada jornada deve ter caminho feliz, negativo de maior risco e interrupção/repetição pertinente. Camadas verdes isoladamente não garantem jornada: prove a ligação entre elas.

## 13. Ordem de execução e comandos do projeto

Trabalhe em lotes pequenos, mantendo um checkpoint e avançando sem pedir confirmação para leituras, análise, testes seguros ou correções já autorizadas. Uma frente bloqueada não interrompe as demais.

1. Inventário, autoridade documental, ambiente e risco de cada runner.
2. Baseline local/isolada e classificação dos testes antigos.
3. Correções do harness/fixtures/assertivas que poderiam mascarar o restante.
4. Autenticação/RBAC/tenant; depois clínico/agenda/financeiro e demais módulos.
5. Asaas e outros providers em alvos autorizados; jornadas completas.
6. Concorrência, degradação, limites/carga, segurança e recuperação.
7. Regressão final do candidato, revisão do diff, matriz/evidências e pendências.

Confirme os scripts atuais antes de usar. Comandos existentes na referência:

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm arch:check
pnpm arch:graphs --check
pnpm arch:db-check
pnpm check:migrations
pnpm check:observability
pnpm check:registry:strict
pnpm test:coverage
pnpm security:inventory
pnpm security:unit
pnpm security:tenant
pnpm security:build
pnpm security:bundle
pnpm security:http
pnpm test:e2e:ci
pnpm security:browser-session
```

`security:build` produz o build isolado usado pelos gates de navegador. Verifique correspondência com o código atual; servidor ou artefato antigo não valida o diff. `pnpm build` também existe; use o fluxo de build adequado ao gate documentado, sem conectar inadvertidamente a produção ou alterar configuração para contornar falhas.

Para testes focados, use os scripts `test`/`test:e2e` com o arquivo explícito. Para cadastro há `scripts/security/signup-regression.ts --browser`, executado via `pnpm exec tsx --conditions=react-server` após o build exigido. Leia suas dependências, portas, migrations e transportes antes de rodar.

Outros runners a classificar antes de executar: `test:e2e:public`, `test:e2e:admin`, `test:e2e:prod`, `test:visual`, `smoke:c3` a `smoke:c14`, `smoke:onboarding`, `smoke:journeys`, `smoke:conversas`, `smoke:admin-config`, `smoke:accounting-export`, `smoke:payments-*`, `test:simulation`, `test:load`, `billing:live-check`, `billing:card-live-check`, `billing:live-roundtrip`, `billing:delete-restore-e2e`, `payments:live-check`, `payments:checkout-e2e`, `email:live-check`, `ai:live-check` e `ai:adversarial`.

Os nomes “smoke”, “check” ou “sandbox” não garantem ausência de escrita, custo ou efeito externo. Leia o runner. `test:e2e:public` também não deve ser presumido inteiramente anônimo ou somente leitura: confira os specs efetivamente selecionados pelo manifesto.

Não rode os comandos de Meta/WhatsApp desta tarefa. Não instale dependências nem altere CI/build/deploy sem a autorização exigida. Dependência disponível ausente, browser ou Postgres local faltante é pré-requisito a resolver/declarar, não justificativa para simular PASS.

Não exclua testes/código dos gates para esconder falha. Se artefatos gerados contaminarem lint/build, identifique a origem e use o mecanismo isolado já existente com equivalência do candidato demonstrada. Falhas preexistentes devem ser separadas das introduzidas, sem serem omitidas.

## 14. Relatórios e evidências durante a execução

Atualize `docs/quality/e2e-coverage-matrix.md` e `docs/quality/e2e-coverage-audit.md` com estado e cobertura atuais, sem apagar o histórico nem reaproveitar números antigos. Registre achados no `docs/discovery-log.md` e mantenha o checkpoint aplicável de `docs/qorov2.md` coerente. Não transforme o roadmap inteiro em “concluído” por esta auditoria.

Mantenha um relatório desta execução em `docs/quality/auditoria-integral-execucao.md`, ou reutilize o equivalente atual se já existir. Evidências sanitizadas podem ficar em diretório próprio por data/runId. Não duplique especificações canônicas.

Cada achado precisa de ID, severidade/impacto, contrato esperado, reprodução, resultado observado, causa, arquivo/linha, ambiente/candidato, correção, teste que o detecta e resultado do reteste. Diferencie bug de produto, defeito de teste, drift documental, bloqueio de ambiente e limitação de provedor.

Status de execução:

- `PASS`: cenário completo executado nesta revisão/ambiente com todas as assertivas exigidas.
- `FAIL`: execução contradiz o esperado, incluindo cleanup obrigatório que falhou.
- `PARTIAL`: só parte ou uma camada foi provada; explicitar exatamente qual.
- `BLOCKED`: pré-requisito externo/credencial/autorização/ambiente impede a prova; registrar tentativa e desbloqueio necessário.
- `NOT TESTED`: não executado; informar motivo e próximo passo.
- `ADIADO_WHATSAPP`: exclusão expressa do canal, com dependências discriminadas.

`SKIPPED`, `n/v`, nenhum teste descoberto e retry que esconde instabilidade nunca contam como PASS. “Não implementado” é estado de implementação separado do resultado de execução.

Informe cobertura sobre um denominador explícito: ações/cenários inventariados, executados e comprovados, com positivos, negativos, tenant e persistência. Separe unit/integration, browser local, Preview, provider sandbox, CI remoto e produção. Não extrapole um ambiente para outro.

Em cada atualização curta, diga o que foi comprovado, o problema real encontrado, o que mudou e o próximo lote. Se a execução atravessar sessões, deixe branch/SHA/diff, comandos, runIds/fixtures, resíduos, autorizações, bloqueios e próximo comando seguro. Não recomece operações financeiras porque perdeu contexto.

## 15. Critérios finais de aceite

Só declare a auditoria integral concluída quando:

- Todas as superfícies implementadas estiverem inventariadas e ligadas a cenários explícitos.
- Todas as transições finitas críticas, negativas de autorização, tenant, persistência, idempotência e invariantes financeiras tiverem prova na camada adequada.
- Testes antigos tiverem sido auditados/executados onde aplicáveis; falhas e skips tiverem destino explícito.
- Novos testes e correções estiverem executados, com regressão final e gates de build/tipos/lint/formato/testes aprovados para o candidato.
- Integrações externas obrigatórias tiverem prova atual própria, com resultado final da operação e sem apresentar simulação como provider real.
- Não houver P0/P1 aberto no escopo, instabilidade crítica mascarada ou resíduo mutável indevido.
- O diff tiver sido relido, preservando trabalho alheio, sem segredos, dependências desnecessárias ou testes enfraquecidos.
- Documentação, matriz, comandos e evidências permitirem reproduzir os resultados.

Se uma condição não puder ser satisfeita, continue tudo que for independente e entregue status parcial fiel, com bloqueio e ação exata necessária. Não encerre como sucesso integral tendo Asaas, Auth, e-mail, Storage ou outra frente não WhatsApp sem prova obrigatória.

O relatório final deve apresentar: funcionalidades verificadas; lacunas de produto versus testes; defeitos encontrados/corrigidos; testes criados/ajustados; contagens reais de execução; resultado de cada integração; limpeza/restauração; riscos residuais; e a lista separada `ADIADO_WHATSAPP`.

Não declare prontidão global de produção apenas porque esta auditoria passou: WhatsApp continua adiado e implementação, validação local, CI, deploy e operação real são evidências distintas.

**Comece agora pelo inventário e pela baseline segura. Execute, investigue, corrija e reteste até fechar o escopo autorizado; não entregue somente uma proposta de como alguém poderia fazer.**
