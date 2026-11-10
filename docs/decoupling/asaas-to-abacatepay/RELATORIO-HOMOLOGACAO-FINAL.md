# Homologação financeira AbacatePay — Qoro

**Leitura atual:** [seção 27 — continuidade sem aguardar suporte](#27-continuidade-sem-aguardar-suporte--09112026). O proprietário informou o envio da solicitação; a resposta está pendente. Checkpoints anteriores permanecem históricos, não instrução de reenviar ou repetir pagamentos.

Iniciado em **09/11/2026**, antes das alterações desta rodada. **As seções 1–8 preservam o checkpoint H0 anterior à implementação; as seções 9–25 registram o fechamento diferencial.** Referência para futura ativação, **não autorização de Produção**. Este relatório consolida os [planos existentes](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md), o [diário](PLANO-EXECUCAO-CONTINUIDADE.md), a [renovação](PLANO-CONTINUIDADE-RENOVACAO-E-HOMOLOGACAO.md) e a [matriz financeira](MATRIZ-CENARIOS-E-TESTES.md); não os substitui por regras comerciais novas.

## 1. Arquitetura e baseline H0

Somente assinaturas da clínica à Qoro são candidatas à AbacatePay. Contratos Asaas existentes, anuais legados, descontos e pagamentos de pacientes permanecem na origem. Supabase e Vercel continuam como infraestrutura. Nenhum cutover, cobrança real ou merge está autorizado.

- Worktree `C:/dev/Qoro_billing_abacatepay_20261107`, branch `feat/billing-abacatepay-20261107`, HEAD inicial `af43c56572bfd2dad62b2ea28e14b4756a715ea7`, limpo. O commit local do backlog futuro foi preservado e não será alterado.
- [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) OPEN/draft, HEAD remoto `3bacc7e78a6d84e1b93bd68165ffd6324361a90e`. Diferença local: somente dois documentos do registro futuro.
- [CI do código](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42567863264) SUCCESS: 6.616 testes/606 arquivos, build, segurança, isolamento, bundle/HTTP; E2E público 8 PASS/2 SKIP. Semgrep, Snyk e Vercel SUCCESS; Agent Review NEUTRAL não equivale a revisão humana.
- Preflight DEV somente leitura em `2026-11-09T10:37:54Z` (**07:37:54 Brasília**): 141 migrations, nenhuma pendente, hash 0140 `98269c83b754785a7e9ecf0b2b4b142ff121cc22b56b8f3055575299ba8ca330`, zero escritas. Não reaplicar migrations históricas.
- A [0140 passou no DEV](evidencias/renewal-0140-20261109.json): duas tabelas privadas, 18 tabelas anteriores preservadas, FORCE RLS e service_role somente SELECT/INSERT. Provas locais: 22 verificações de renovação e 47 de trial/cancelamento/recontratação com 141 migrations.
- UI paralela: `C:/dev/Qoro_ui_refactor_20261108`, branch `ui/refactor-qoro-20261108`, HEAD observado `2ed6b71f`. Há mudanças não commitadas em dashboard, caixa, consultório, painel e CSS. Não serão editadas, copiadas nem descartadas nesta rodada. Alterações indispensáveis na assinatura devem permanecer funcionais e isoladas.
- [Convênios, lotes e CID](../../roadmap/convenios-lotes-cid-futuro.md) fora do escopo, inclusive suas tabelas, documentos e IA.

## 2. Inventário de capacidades antes da implementação

“Testada” abaixo identifica o nível da prova, não homologação integral. Estados de teste neste relatório: PASS, FAIL, BLOCKED, NOT RUN ou NOT APPLICABLE. Capacidade incompleta é descrita por texto e gates distintos.

| Funcionalidade          | Implementada                                               | Testada localmente                                 | Homologada Sandbox                                                                | Pendências reais                                                                                |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cadastro e trial        | Sim, avaliação Qoro absoluta e sem checkout                | PASS: PG e testes anteriores                       | Preview: identidade confirmada administrativamente → trial; não entrega de e-mail | Prazo real de 14 dias não observado; preservação na regressão                                   |
| Checkout                | Sim, preço no servidor e journal                           | PASS: concorrência/resultado desconhecido retido   | PASS: emissão Clínica R$397 anterior                                              | Recuperar checkout quando o resultado do POST se perdeu                                         |
| Pagamento inicial       | Sim, readback integral e efeito atômico                    | PASS                                               | PASS: pagamento Sandbox anterior, webhook e UI paga                               | Não repetir esse pagamento                                                                      |
| Webhook                 | Sim, secret+HMAC, inbox e lease                            | PASS: autenticação/replay/transação                | PASS para o primeiro pagamento                                                    | Demais eventos exigem provas próprias                                                           |
| Renovação               | Sim, leitor e calendário original aprovado                 | PASS: 43 testes do leitor, 15 de calendário, 22 PG | NOT RUN para renovação temporal externa                                           | API sem período/vencimento; descoberta de evento totalmente ausente                             |
| Falha de pagamento      | Evento em revisão; política de acesso existente preservada | PASS somente ausência de concessão indevida        | NOT RUN                                                                           | Registrar estado financeiro verificável, retries e causa do cancelamento sem inventar suspensão |
| Cancelamento            | Sim, irreversível no provedor, acesso até fim pago         | PASS                                               | PASS: comando/readback e UI; não entrega do webhook                               | Distinguir cancelamento automático de voluntário                                                |
| Recontratação           | Sim, gerações distintas e sem novo trial                   | PASS: duas gerações PostgreSQL                     | NOT RUN após fim temporal real                                                    | Fixture retida até fim do período, sem alterar suas datas                                       |
| Upgrade                 | Comando adapter; composição de domínio indisponível        | PASS apenas comando PENDING                        | NOT RUN                                                                           | ADR-068 C: liberar só na renovação paga do novo valor/produto                                   |
| Downgrade               | Comando adapter; composição de domínio indisponível        | Regressão Asaas existente; não paridade AbacatePay | NOT RUN                                                                           | Ocupação, reserva de cota e efetivação no próximo ciclo                                         |
| Médico adicional        | Catálogo/cotas existentes; compra AbacatePay indisponível  | Não comprova ciclo completo AbacatePay             | NOT RUN                                                                           | Mesma ADR-068 C, preço aprovado, concorrência e renovação                                       |
| Estorno e disputa       | Eventos ficam em revisão, sem revogar direitos             | PASS somente ausência de efeito indevido           | NOT RUN                                                                           | Readback por cobrança e política comercial para efeito no acesso                                |
| Conciliação             | Inicial sem webhook, inbox e cancelamento                  | PASS nos recortes anteriores                       | PASS no cancelamento observado; inicial sem webhook só sintético                  | Descoberta de renovações/eventos negativos e divergências                                       |
| Recuperação de checkout | Reserva durável impede novo POST; não descobre o resultado | PASS na retenção de unknown                        | NOT RUN para retorno perdido externo                                              | Consultar referência oficial, provar unicidade/identidade e completar a mesma operação          |

## 3. Compatibilidade e decisões vigentes

| Aspecto              | Asaas preservado                                 | Candidata AbacatePay                                                        |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Origem               | Contratos antigos mantêm IDs, preço e desconto   | Binding por provedor/conta/ambiente imutável                                |
| Trial                | Jornada atual e convites não são redirecionados  | 14 dias desde Auth; checkout somente ao fim                                 |
| Período              | Sem alteração nesta rodada                       | ADR-069 e calendário mensal original aprovado; não afirma vencimento remoto |
| Alteração de plano   | Upgrade proporcional/sincronização atual         | ADR-068 C: próximo ciclo integral pago, sem proporcional separado           |
| Cancelamento         | Mantém reativação suportada                      | ADR-070: sem desfazer; nova contratação após fim pago                       |
| Anual novo           | Flag fechada; contratos existentes preservados   | NOT APPLICABLE: não abrir nova oferta anual                                 |
| Pacientes/repasse/NF | Fora desta migração; conta recebedora da clínica | Não implementados por este adapter                                          |

## 4. Jornadas e gates — checkpoint inicial

| ID   | Requisito              | Cenário                                                             | Ambiente                 | Resultado esperado                                  | Resultado real                                                               | Evidência                                      | Status  | Bloqueio                                           |
| ---- | ---------------------- | ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- | ------- | -------------------------------------------------- |
| H0   | Baseline real          | Git/CI/DEV e trabalho paralelo                                      | Local/API DEV/PR         | Nenhuma pendência presumida                         | Matriz acima e preflight sem escrita                                         | Baseline desta seção                           | PASS    | Não                                                |
| H1-L | Renovação              | Cobrança distinta, calendário, duplicidade, ordem, rollback, tenant | PG/HTTP sintéticos       | Um benefício por ciclo validado                     | 22 verificações anteriores passaram                                          | `evidencias/renewal-0140-20261109.json`        | PASS    | Não no recorte local                               |
| H1-E | Renovação externa      | Ciclos sucessivos reais                                             | Sandbox                  | Provar pagamento/ciclo/efeito                       | Sem aceleração oficial localizada; fixture já cancelada não será reutilizada | Documentação oficial e plano anterior          | BLOCKED | Dependência externa; não inferir pelo PAID inicial |
| H2   | Eventos negativos      | Falha/refund/disputa e reversão                                     | A executar               | Estado financeiro rastreável sem política inventada | Revisão segura existe; demais etapas pendentes                               | Worker e contratos atuais                      | NOT RUN | Engenharia/readback e regras de acesso             |
| H3   | Resultado desconhecido | POST remoto sem resposta persistida                                 | A executar               | Recuperar a mesma operação sem novo POST            | Journal retém unknown, mas recuperação não existe                            | `command-operation.ts`, `deferred-checkout.ts` | NOT RUN | Implementável por leitura oficial                  |
| H4   | Planos/adicionais      | Próxima renovação no novo preço/produto                             | A executar               | Cota só após condição financeira aprovada           | ADR-068 C aprovada; composição bloqueada                                     | ADR-068                                        | NOT RUN | Engenharia e homologação                           |
| H5   | Conciliação            | Dados ausentes/divergentes e repetição                              | A executar               | Recuperar com prova, sem criar cobranças            | Recortes inicial/cancelamento existentes                                     | Diário/matriz anteriores                       | NOT RUN | Completar novos recortes                           |
| H6   | Jornada completa       | Trial → pago → renovação → cancelamento → recontratação             | PG/Preview/Sandbox       | Provas por subcenário e nível                       | Inicial/cancelamento externos; outros recortes locais                        | Matriz anterior                                | NOT RUN | Não confundir soma de provas com temporal contínuo |
| H7   | E2E público            | Secret ausente no browser e widget resolvido                        | Build isolado específico | Executar os dois SKIP com chaves oficiais de teste  | Ausência de chaves no build padrão confirmada                                | `e2e/public-surface.spec.ts`, Cloudflare       | NOT RUN | Configuração local isolada viável                  |
| H8   | Regressão              | Gates após novas mudanças                                           | A executar               | Nenhuma regressão crítica                           | Baseline 6.616 válida antes de alterações                                    | CI 42567863264                                 | NOT RUN | Reexecutar somente após mudanças pertinentes       |
| H9   | Revisão adversarial    | 22 questões do prompt                                               | A executar               | Riscos corrigidos ou classificados                  | Baseline sem conclusão integral                                              | Este relatório será atualizado                 | NOT RUN | Revisão diferencial                                |
| H10  | Pré-produção           | Flags, secrets, legado, monitoramento e rollback                    | Documentação             | Material revisável, sem ativação                    | [Rollback](../../runbooks/provider-rollback.md) existente                    | Checklist abaixo                               | NOT RUN | Gates financeiros anteriores                       |

## 5. Fontes e limites externos

Documentação oficial AbacatePay conferida em 09/11, repositório `AbacatePay/documentation` HEAD `b221a381d3363ab3eb384134ff4567e60c001225`, igual à baseline. [Assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference), [eventos](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [busca de checkout](https://docs.abacatepay.com/pages/subscriptions/checkouts-get), [lista de checkouts](https://docs.abacatepay.com/pages/subscriptions/checkouts-list), [Cloudflare — chaves de teste](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

O GET de assinatura não documenta próximo vencimento/período pago. A lista de checkouts aceita referência e paginação; um GET por referência sozinho não comprova unicidade. A simulação documentada de pagamento transparente não é aceleração de assinatura. Não criar transação nova para repetir prova anterior.

## 6. Ordem de execução e condições de segurança

1. H0 acima; preservar contratos/fixture, backlog e UI.
2. H1 diferencial: confirmar limites oficiais e completar apenas lacunas locais executáveis. Não inventar evento ausente.
3. H3/H5: recuperar checkout desconhecido por consulta autenticada, referência estável, fingerprint e unicidade, sem segundo POST.
4. H2: persistir observações verificadas de eventos negativos sem criar política de revogação; separar acesso de obrigação.
5. H4 conforme ADR-068 C, sem escolher novamente upgrade imediato; falta de prova remota bloqueia benefício.
6. H7 em cópia local sem `.env` real e chaves oficiais de teste, sem alterar CI/Produção. Positivo de teste não comprova domínio real ou negativo.
7. H6/H8/H9/H10, evidências e gates por nível. As etapas bloqueadas não interrompem as independentes.

## 7. Checklist de ativação futura e rollback

- [ ] H1–H6 críticos comprovados no nível exigido, com ambiguidades sem concessão de direitos.
- [ ] H7 público executado; configuração real separada verificada antes de abertura.
- [ ] Migrations futuras compatíveis, preflight, backup e autorização da janela de Produção.
- [ ] Secrets próprios de Produção, conta/permissões e produto/valor conferidos, sem copiar credenciais DEV.
- [ ] Webhook HTTPS estável, secret/HMAC, inbox durável, alertas/retries e conciliação verificados.
- [ ] Origem por assinatura preservada, Asaas ativo para obrigações antigas; nenhuma cobrança em ambos.
- [ ] Trial, cotas, planos e landing coerentes; oferta anual nova continua fechada.
- [ ] Piloto gradual autorizado, monitoramento de backlog/review/valor/período/duplicidade e critérios de contenção.
- [ ] Rollback ensaiado: parar novas originações, manter recepção/conciliadores das obrigações, preservar binding e histórico. Voltar código não desfaz comando remoto; sem DOWN destrutivo ou failover de cobrança.
- [ ] Aceites comerciais pendentes resolvidos; homologação temporal não pode ser substituída silenciosamente por mock.

## 8. Decisão deste checkpoint

**NO-GO para ativação de Produção.** H0 concluído; nenhum novo teste externo, escrita remota ou alteração de código feita antes desta matriz. Os próximos registros devem informar comandos, resultados, arquivos e limites reais. Não há autorização de cutover nesta rodada.

## 9. Implementação diferencial

O código novo permanece exclusivamente na branch financeira. O [journal](../../../src/lib/payments/saas/command-operation.ts) exporta o mesmo cálculo de fingerprint já utilizado, sem alterar sua identidade. O [leitor de recuperação](../../../src/lib/payments/abacatepay/checkout-recovery.ts) verifica loja, Sandbox, produto mensal sem trial nativo, preço, referência, callbacks, data e **todas as páginas** da busca. Dois resultados, cursor repetido, limite de páginas ou divergência encerram a leitura sem recuperação. Um GET por referência que retorna o último resultado não basta.

A [recuperação no domínio](../../../src/contexts/billing/internal/abacatepay-checkout-recovery.ts) confirma a **operação original** e anexa o ID na mesma transação. Não repete POST nem cria invoice, período ou direito. Abrange aquisição e recontratação, com geração anterior efetivamente cancelada. A releitura financeira posterior decide se o checkout ainda pode ser apresentado; um checkout pago nunca vira um novo link de contratação. O cron passa por recuperação antes de buscar o pagamento inicial ausente, respeita o orçamento e registra adiamento por `job_budget`.

O [novo domínio de planos](../../../src/contexts/billing/internal/abacatepay-plan-changes.ts) implementa a alternativa C da ADR-068: uma intenção privada por geração, catálogo/preço/produto no servidor, nenhuma cobrança proporcional e nenhuma cota antecipada. Pedidos concorrentes usam a mesma obrigação. Outro plano não sobrescreve uma pendência desconhecida. O downgrade reserva a capacidade no banco desde a intenção; o plano e seus benefícios mudam atomicamente com a invoice da renovação integral no produto autorizado, mantendo o aniversário original.

O GET de assinatura não promete `frequency`. O comando agora só admite sua ausência quando consegue provar o ciclo pelo **produto do checkout original pago**, com cliente, item e valor verificados. Não presume MONTHLY a partir de ACTIVE ou do produto desejado. Frequência explicitamente incompatível continua recusada.

## 10. Estado externo, financeiro e acesso

| Entrada                                           | Estado comprovável                                              | Efeito financeiro/local                                                | Acesso/cota                                           | Recuperação                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Resposta perdida na criação                       | Busca única + fingerprint original                              | Completa a mesma operação e binding; nenhum pagamento criado           | Nenhum                                                | Readback financeiro separado; ausência/ambiguidade fica retida              |
| Primeiro pagamento integral                       | Checkout e assinatura vinculados                                | Uma invoice e snapshot inicial                                         | Remove cotas temporárias, mantém teto do plano        | Caminho anterior preservado; sem repetir pagamento                          |
| Renovação integral                                | Checkout distinto + extrato aprovado + conta/cliente/assinatura | Uma observação, uma invoice por ciclo                                  | Avança somente calendário elegível                    | Inbox com lease e retries limitados                                         |
| Plano novo aceito PENDING                         | Comando reconhecido, não pagamento                              | Intenção congelada; nenhuma invoice complementar                       | Plano atual permanece; downgrade reserva teto         | Próxima renovação tem de provar produto e valor novos                       |
| Pagamento parcial, preço antigo ou produto errado | Insuficiente para plano novo                                    | Revisão; não inventa complemento                                       | Sem liberação de médicos extras                       | Corrigir divergência na origem e reconciliar com prova                      |
| Falha de pagamento/disputa notificada             | Notificação autenticada + estado atual da assinatura            | Auditoria distingue notificação de prova financeira                    | Nenhum direito novo nem suspensão por suposição       | Revisão; API não comprova por esse GET o retry/ciclo ou desfecho da disputa |
| Estorno                                           | Checkout próprio + débitos `category=refund` no extrato         | Registra valor parcial/integral observado, sem reescrever invoice paga | Mantém o período pago e encaminha para revisão humana | Reversão ou ausência de débito suficiente continua ambígua                  |
| Cancelamento confirmado                           | Recorrência parada no provedor                                  | Snapshot preserva período pago                                         | Até fim pago, sem tolerância adicional                | Irreversível; nova contratação apenas depois                                |
| Recontratação após fim pago                       | Outra geração e pagamento integral                              | Nova invoice; história anterior intacta                                | Novo período, sem novo trial                          | Não reutiliza IDs anteriores nem mantém duas recorrências                   |

Nos contratos não cancelados, o gate de escrita existente também verifica `current_period_end` e a tolerância persistida; não depende apenas do rótulo ACTIVE para permitir escrita indefinidamente. A regra geral foi preservada; a exceção de refund do ciclo atual segue a aprovação descrita abaixo. Cancelados não recebem esse intervalo adicional.

## 11. Eventos negativos: limite deliberado

[Leitor financeiro](../../../src/lib/payments/abacatepay/negative-payment.ts), [vínculo/auditoria](../../../src/contexts/billing/internal/abacatepay-negative-events.ts) e worker distinguem `refund_debit_verified`, `status_only` e `subscription_status_only`. O extrato é paginado e limitado, sem registrar clientes, descrições, cartões ou payload bruto. Repetir o evento não duplica a observação de domínio. Falha de API/transação mantém retry limitado e nenhum efeito parcial.

**REFUNDED isolado não comprova valor estornado; PAID não comprova disputa ganha.** Débito de estorno parcial não é perda integral. Uma movimentação `reversal` não autoriza declarar pagamento recuperado. Notificação de falha não basta para afirmar número do retry, vencimento ou cancelamento por inadimplência. A API consultada não fornece todos esses vínculos/desfechos, e o parser não transforma campos descartados do webhook em verdade financeira.

**Decisão expressa do founder em 09/11/2026:** manter o acesso até o fim do período pago e encaminhar estorno/chargeback para revisão humana. Evento de ciclo antigo não pode bloquear ciclo novo já pago. A implementação não cancela a recorrência, não encurta o período pago e não reescreve a invoice como se tivesse sido quitada novamente. Um débito de refund confirmado para o exato período e geração atuais limita a carência ao fim já contratado; não cria quinze dias adicionais não pagos após esse período. Eventos históricos, ambíguos, disputas sem perda comprovada e notificações de falha não reduzem o período nem a carência de um ciclo novo. Uma renovação nova comprovada segue sua regra normal.

Os testes PostgreSQL reais passaram para reembolso parcial/integral, oito workers concorrentes, uma única auditoria, permissão de escrita preservada durante o período e bloqueio após projeção temporal local do seu fim. Um refund verificado do checkout inicial, recebido depois de uma renovação paga, preservou integralmente o novo período e sua carência. Não houve reembolso externo nem alteração de direitos de cliente real. A política está aprovada e testada localmente; falta a prova financeira externa correspondente para homologar H2 por completo.

## 12. Migration 0141 e isolamento

[0141](../../../drizzle/migrations/0141_saas_scheduled_plan_changes.sql) acrescenta `billing_gateway.plan_changes`, um índice único de intenção pendente por geração, snapshots protegidos, FKs compostas e um guard adicional de capacidade em `profiles`. Preserva a trigger anterior e os contratos Asaas. Não altera preços, contratos, permissões já contratadas, dados clínicos ou a 0140 aplicada.

A tabela tem FORCE RLS, nenhum acesso anon/authenticated e service_role somente SELECT/INSERT/UPDATE, sem DELETE/TRUNCATE/REFERENCES/TRIGGER. A trigger não aceita alterar os termos congelados nem reescrever uma aplicação concluída. A ordem é **schema aditivo → aplicação candidata → validação**, evitando receber renovação com código novo e schema ausente. A autorização desta rodada cobre somente DEV verificado; **não aplicar em Produção**.

Preflight somente leitura em `2026-11-09T11:36:00Z`: 141 migrations existentes; única pendente `0141_saas_scheduled_plan_changes`; hash `a13faef1aa291981c3e4c337cbde868225d9d1433bdeed8dd320fd7a74fdf5fd`. Histórico é comparado por timestamp/hash, incluindo apenas divergências antigas já auditadas; contagem sozinha não basta. **Aplicação autorizada DEV: PASS**, `2026-11-09T12:10:13Z–12:10:24Z`. Histórico 141 → 142, somente 0141; hashes e timestamps conferidos, locks com prazo e transação. Hashes/contagens das 20 tabelas anteriores iguais antes/depois; privilégios das onze tabelas privadas anteriores iguais. Nova tabela vazia, FORCE RLS, zero acesso anon/authenticated, service_role SELECT/INSERT/UPDATE, duas funções/triggers conferidas. Zero escrita em Production. Não repetir a migration.

## 13. Provas locais e comando de reprodução

No worktree financeiro, com dependências existentes e sem carregar `.env.local` real nos ensaios sintéticos:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run --coverage --minWorkers=1 --maxWorkers=1
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-checkout-recovery-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
```

Os scripts PG inicializam clusters locais descartáveis, aplicam as migrations reais e usam **HTTP sintético**, sem credenciais reais nem acesso de rede ao provedor. Seeds e relógios/datas controlados só nesses clusters. Validações incluem divisão por zero/rollback real, concorrência, tenant, valor parcial, referência errada, snapshots, geração e cotas. Não são prova de cobrança temporal externa.

Checkpoint executado: 8 verificações H3; 47 trial/cancelamento/recontratação; **33 renovação/planos/negativos**, incluindo a política aprovada. Esses últimos 33 passaram com exit 0, 142 migrations reais e zero chamadas de rede externa. Também foi corrigido o replay de um ciclo já marcado para revisão: a repetição continua em revisão, em vez de ser rotulada como aplicação duplicada bem-sucedida. Os totais finais de regressão, build e CI devem ser lidos no registro de fechamento, sem herdar PASS do baseline para código alterado.

## 14. Sandbox real nesta rodada

Em `2026-11-09T11:14:37Z`, o novo leitor descobriu a cobrança **já existente** da fixture retida: recurso único, checkout original igual e fingerprint igual; estado atual PAID. **4 GETs, zero POSTs, zero escritas DB e zero contas/fixtures criadas.** A loja foi conferida contra o hash do manifesto protegido e o produto retornou Sandbox. Isso prova a busca/leitura oficial utilizada na recuperação; não houve timeout externo induzido nem nova mensalidade.

Não deslocar datas, recancelar ou excluir a fixture paga/cancelada. Seu período termina em `2026-12-09T00:31:10.888Z` (**08/12 às 21:31:10 em Brasília**). Pagamento inicial, webhook e cancelamento observados anteriormente continuam válidos no seu recorte; não recebem rótulo de renovação por terem PAID.

## 15. E2E público e os dois SKIP

Os 8 PASS/2 SKIP da CI anterior continuam registrados. Ausência de chaves no build isolado é intencional; não afrouxar teste ou copiar segredo privado para a CI. Nesta rodada:

- **PASS:** teste original do widget no Preview imutável `3bacc7e7`, Chromium, 3.732 ms, 1 PASS/0 SKIP; ambos os widgets obtiveram token e o script permaneceu único. Chave pública oficial de teste always-pass; **não** prova desafio real, hostname real, rejeição ou replay server-side.
- **PASS:** teste original de ausência da secret no HTML em build local isolado anterior compatível nos arquivos de Auth/login/env/middleware, com canário oficial conhecido em runtime; 1 PASS/0 SKIP. Não leu nem comprovou a secret privada mascarada do Preview, nem declara build financeiro novo a partir desse artefato.
- **Correção do harness:** `storageState` vazio da spec eliminava o cookie da proteção Vercel e o teste observava SSO em vez do Qoro. O acesso de automação agora é limitado à origem Vercel; não acompanha chamadas Cloudflare. O teste espera o campo de senha visível após hidratação e não faz SKIP silencioso quando há chave esperada e o widget não aparece.

Nenhuma conta ou cobrança criada. A conferência de Production real permanece fora desta autorização; os resultados acima não a substituem.

## 16. E2E financeiro por subcenário

| Jornada                                                  | Local/PG/HTTP sintético                       | Preview/Sandbox real                               | Limite                                                                    |
| -------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| Identidade confirmada administrativamente → trial        | PASS anterior e regressão                     | PASS anterior                                      | Não prova entrega do e-mail                                               |
| Trial vencido → checkout → pagamento → webhook → UI paga | PASS                                          | PASS anterior                                      | Sem repetir cobrança; callback em contexto novo encontrou proteção Vercel |
| Resposta perdida → recuperação → pagamento separado      | PASS H3                                       | PASS somente busca/leitura do recurso já existente | Falha externa não induzida                                                |
| Renovação → invoice → mesmo calendário → acesso          | PASS                                          | NOT RUN                                            | Falta ciclo financeiro externo com vínculo verificável                    |
| Cancelar → acesso até fim → nova contratação             | PASS, duas gerações                           | PASS cancelamento e recusa antecipada anteriores   | Fim temporal/recontratação externa ainda NOT RUN                          |
| Plano/extra médico → renovação integral → cota           | PASS nos recortes PG novos                    | NOT RUN                                            | Precisa assinatura Sandbox ativa e renovação no novo produto              |
| Falha/refund/disputa → readback → revisão                | PASS no recorte seguro e na política aprovada | NOT RUN                                            | Falta evento financeiro externo                                           |

Não somar provas parciais para afirmar que um único usuário percorreu todos os meses no Sandbox. Os testes de componente validam interação, não liquidação, persistência ou provedor; os scripts PG cobrem persistência; o Sandbox tem prova própria.

## 17. Matriz diferencial dos gates

| Frente                                            | Estado da prova                                               | Bloqueio de ativação?       | Próximo gate concreto                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| H0 baseline/isolamento                            | PASS                                                          | Não                         | Preservar branch, legado e UI paralela                                                         |
| H1 renovação local                                | PASS no recorte ampliado                                      | Não no recorte local        | Evidência PG final com 33 verificações                                                         |
| H1 renovação externa e webhook totalmente ausente | BLOCKED                                                       | Sim                         | Vínculo cobrança/ciclo pela API ou suporte e observação externa; não inferir por cliente/valor |
| H2 observação negativa e acesso local             | PASS no recorte implementado                                  | Não no recorte local        | Política aprovada: manter período e revisar; falta prova externa                               |
| H2 falhas e desfecho financeiro externo           | BLOCKED                                                       | Sim                         | Evidência financeira específica; decisão de acesso já aprovada                                 |
| H3 recuperação local e busca real                 | PASS                                                          | Não para esse recorte       | Falha remota induzida continua NOT RUN                                                         |
| H4 planos/adicionais                              | PASS local no recorte novo                                    | Sim para oferta ao público  | Homologar comando + renovação Sandbox de plano alterado                                        |
| H5 inbox/inicial/unknown/cancelamento             | PASS por recortes locais                                      | Sim na lacuna externa       | Não há descoberta segura de renovação completamente sem referências                            |
| H6 contínuo temporal externo                      | NOT RUN                                                       | Sim                         | Fechar as subprovas financeiras faltantes; não reutilizar fixture cancelada                    |
| H7 duas verificações públicas                     | PASS nos ambientes indicados                                  | Não para o recorte de teste | Não confundir com Production                                                                   |
| H8 regressão local                                | PASS: 6.695 testes, typecheck, lint, inventário e arquitetura | Não no recorte local        | Build e checks remotos do novo SHA ainda precisam terminar                                     |
| H8 build/CI a3539abc                              | PASS, CI 42615597795 e Preview READY                          | Não para esse código        | Documentação posterior não muda src/schema/E2E; verificar checks do HEAD final                 |
| H9 adversarial                                    | PASS como revisão documentada; riscos abertos não aprovados   | Sim nos P0/P1               | Resolver/validar itens abaixo                                                                  |
| H10 pré-produção                                  | PASS como preparação, não execução                            | Sim nos pré-requisitos      | Nenhum cutover autorizado                                                                      |

## 18. Revisão adversarial — 22 perguntas

| #   | Pergunta/risco                          | Conclusão e evidência                                                                                                                                                                                                                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cobrar duas vezes?                      | Journal durável + obrigação única impedem repetição pelo Qoro; não há failover cego. **Risco aberto:** URL de checkout do provedor é reutilizável fora do app; o fechamento precisa de prova própria.                                 |
| 2   | Mesmo pagamento concede duas vezes?     | PK financeira/ciclo, invoice e direitos atômicos; PG concorrente prova uma aplicação.                                                                                                                                                 |
| 3   | Webhook falso libera?                   | Secret privado + HMAC + ambiente + inbox; direito exige GET financeiro vinculado. HMAC publicado pelo provedor não é segredo de autenticação.                                                                                         |
| 4   | Outro tenant acessa financeiro?         | Identidade/permissão no servidor, IDs do body não escolhem clínica, FKs compostas e contexto de conta; PG/HTTP negativos.                                                                                                             |
| 5   | Asaas altera assinatura AbacatePay?     | Nova composição exige billing_provider/conta/ambiente e nenhum asaas_subscription_id; scanners Asaas conservam seus IDs. Não há roteamento automático por flag global de obrigação antiga.                                            |
| 6   | Evento antigo sobrescreve atual?        | Geração, calendário, snapshots e origem preservados; evento histórico não rebaixa período.                                                                                                                                            |
| 7   | Renovar sem pagamento?                  | ACTIVE, PENDING, webhook ou bill inicial não bastam; valor integral, outro checkout e recibo vinculados são necessários.                                                                                                              |
| 8   | Cancelar encurta período pago?          | Snapshot exato e gate de fim pago; comando irreversível só interrompe recorrência. Provas anteriores preservadas.                                                                                                                     |
| 9   | Checkout desconhecido duplica cobrança? | Recuperação GET-only, fingerprint e unicidade; ausência não autoriza novo POST. Corrigido nesta rodada.                                                                                                                               |
| 10  | Rollback incompatível?                  | Schema expansivo e binding preservado; voltar release não desfaz comando remoto. Não fazer DOWN destrutivo nem migrar obrigações ao Asaas.                                                                                            |
| 11  | Banco falha após confirmação?           | Reserva/evento persistidos antes; efeito DB atômico/rollback testado. Readback retoma sem segunda cobrança.                                                                                                                           |
| 12  | API falha e estado se perde?            | Reserva unknown fica retida; retries de GET e auditoria. Ambiguidade pode exigir suporte; retenção segura não equivale a recuperação automática completa.                                                                             |
| 13  | Renovação depois de cancelar?           | Pagamento recebido ainda pode ser observado/histórico; cancelamento solicitado impede extensão automática. Divergência exige revisão e não nova cobrança.                                                                             |
| 14  | Recontratação cria duas recorrências?   | Confirma a geração anterior CANCELLED, fim pago e geração nova; não reusa contrato inicial. Paridade temporal externa ainda pendente.                                                                                                 |
| 15  | Disputa antiga suspende ciclo novo?     | Política aprovada preserva o período pago e exige revisão humana; refund antigo verificado não encurta período/carência novos. PG cobre a separação por período e geração.                                                            |
| 16  | Plano gera valor errado?                | Servidor resolve catálogo mensal congelado; browser manda só plano; produto/preço comparados; sem proporcional. Preço/produto divergente não libera.                                                                                  |
| 17  | Médicos divergem do contratado?         | Intenção não concede cota; só renovação integral aplica plano, invoice e histórico. Downgrade reserva teto no PostgreSQL e confere ocupação novamente.                                                                                |
| 18  | Legado Asaas continua?                  | Nenhuma reprecificação/migração de contrato; suíte de regressão precisa ficar verde. Trial antigo, anual existente e desconto vitalício não foram alterados.                                                                          |
| 19  | Adapter isolado?                        | HTTP/provider DTOs em lib/payments/abacatepay; aplicação de direitos em billing. SQL e Next não entram no adapter. Composição financeira ainda é específica e não é portabilidade total.                                              |
| 20  | Terceiro gateway fácil?                 | Contratos neutros, bindings e journal ajudam. Um terceiro exige adapter, capacidades comerciais, esquema de eventos/períodos, testes e cutover; trocar uma env não migra contratos.                                                   |
| 21  | Dependências ocultas de host/DB?        | Cron Vercel, URLs, HTTP/SSO e PostgreSQL/RLS/transações continuam explícitos. Não foram substituídos; arquitetura não é neutra a infraestrutura inteira.                                                                              |
| 22  | O que falta externamente?               | Renovação sucessiva, recuperação sem evento, plano no ciclo seguinte, falha de cartão/retries/auto-cancel, refund/disputa/reversão, fechamento de checkout e recontratação após fim pago. Não marcar esses itens PASS por mock ou CI. |

## 19. Risco de checkout reutilizável

O [diário anterior](PLANO-EXECUCAO-CONTINUIDADE.md) já registra que um checkout de assinatura pode ser reutilizado para outro comprador. O Qoro não reapresenta link pago e não concede direitos quando a lista encontra mais de uma assinatura, mas não controla uma URL previamente copiada no provedor. Isso continua **P0 de ativação**, e não foi ocultado pela correção de recuperação.

A documentação oferece [POST de exclusão do checkout](https://docs.abacatepay.com/pages/subscriptions/checkouts-delete), com permissão SUBSCRIPTION:DELETE, prometendo preservar assinaturas geradas. **Não comprova** a disponibilidade posterior do GET financeiro, do vínculo original, do recibo ou do próprio fluxo de mudança de plano após excluir. Não apagar o único checkout pago retido para descobrir isso. É necessário um ensaio rastreável específico de fechamento, perda de resposta, lista/GET/subscrição e pagamentos históricos. Não inventar `/close` nem considerar remoção visual da lista prova de impossibilidade de nova contratação.

### Ensaio externo diferencial de exclusão, sem pagamento

Em **09/11 às 12:18 UTC**, uma fixture nova, identificada e não divulgada, gerou somente um checkout Sandbox pendente de Consultório. O manifesto e o procedimento de limpeza foram gravados antes do POST; operação reservada e resultado desconhecido retido sem repetição cega. Confirmados status PENDING, nenhum cliente, valor pago nulo/zero e nenhuma assinatura antes de excluir **somente esse recurso** pela rota oficial.

Resultado: exclusão aceita, checkout ausente da lista, **GET financeiro HTTP 200** após excluir. Em navegador novo, a URL mostrou **“Não encontramos este link”**, sem inputs ou botões de pagamento. **Zero pagamentos, zero assinaturas, zero dados de pacientes, fixture paga original intacta.** O manifesto permanece protegido para auditoria. Isso comprova o comportamento do recurso **não pago**; não prova histórico/recibo após pagamento, assinatura sobrevivente, concorrência entre duas conclusões antes do fechamento ou mudança de plano depois da exclusão. Não há fechamento automático implementado na composição: exige comando durável, reserva antes do I/O, recuperação de resposta perdida e essas provas antes de ativar. Não excluir a fixture paga atual nem declarar este P0 resolvido.

## 20. Produção, secrets e permissões

Não houve composição de Production. API e comandos continuam guardados para Sandbox; uma chave ou flag sozinha não libera o provedor em Production. Não copiar `.env.local` para Vercel/Produção.

Futura ativação exige conta/loja, chave própria, verificação dos produtos mensais sem trial nativo, webhook HTTPS estável com secret próprio, callbacks corretos e permissões mínimas efetivamente necessárias. Conferir o catálogo oficial antes de emitir a chave: SUBSCRIPTION:CREATE para criar/alterar, SUBSCRIPTION:READ para consultar e BANK_STATEMENT:READ para o extrato. O [cancelamento](https://docs.abacatepay.com/pages/subscriptions/cancel) já requer **SUBSCRIPTION:DELETE**, a mesma permissão documentada para excluir checkout; não existe fundamento para inventar SUBSCRIPTION:CANCEL. Conferir também as permissões documentadas de leitura da loja e dos produtos. Não atribuir autorização a uma chave antiga por ela autenticar GET.

`SAAS_SIGNUP_PROVIDER` controla **novas originações**, não muda o provider persistido. `ABACATEPAY_STORE_ID`, `ABACATEPAY_API_KEY`, `ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID`, `ABACATEPAY_SANDBOX_PLAN_PRODUCTS` e `ABACATEPAY_WEBHOOK_SECRET` são da candidata Sandbox, não receita de Production. Modalidade anual nova permanece fechada; contratos anuais antigos ficam no Asaas.

## 21. Monitoramento e conciliação

Monitorar `billing.abacatepay.event_reconciled`, `reconcile_failed`, `checkout_reconciled`, `negative_event_review`, `plan_change_pending` e `reconcile_deferred`, além do heartbeat `billing-reconcile`, leases expirados, `review`, operações unknown e backlog crescente. Não registrar payload, recibo, URL de checkout com segredo, cliente ou cartão.

O cron existente limita cada trabalho e guarda auditoria de verificação/backoff; não tem fila isolada nem SLA novo implantado nesta rodada. Processamento de Asaas pode consumir o orçamento e adiar AbacatePay; agora há sinal explícito. Antes do piloto real, validar capacidade/alerta e responsável. Métrica emitida **não significa alerta externo configurado**.

Para webhook totalmente ausente de uma renovação, extrato com cliente/preço iguais não prova assinatura. Solicitar replay oficial ou vínculo oficial cobrança → assinatura. Não inserir evento positivo artificial, não alterar período manualmente para aparentar conciliação e não renovar pelo bill inicial.

## 22. Rollback e contenção

Seguir [provider-rollback](../../runbooks/provider-rollback.md): parar novas originações/operações na candidata, preservar recepção durável e conciliação das obrigações já existentes, guardar journals/leases/snapshots e reconsultar o provedor de origem. Não usar Asaas como repetição de uma obrigação AbacatePay desconhecida. Nenhuma flag desfaz cancelamento irreversível ou cobrança remota.

A 0141 é expansiva e pode permanecer com código anterior; não excluir tabela/histórico nem remover guard via DOWN em incidente. Promover somente release compatível, conferir origem/valores/quotas e reconciliar o intervalo antes de retomar. Este procedimento foi revisado por código e testes locais, **não executado como rollback de Production**.

## 23. Próximos gates externos e ações humanas indispensáveis

1. **Política financeira já aprovada e implementada:** manter período pago e revisão humana, sem suspender ciclo novo por perda de ciclo antigo. Não há nova decisão humana pendente sobre essa regra; falta sua homologação com eventos externos.
2. **Suporte AbacatePay, sem dados de pacientes:** pedir método oficial para acelerar recorrência Sandbox; vínculo autoritativo de novo bill/payment com assinatura quando o webhook nunca chega; consulta de ciclo/vencimento/retries e desfecho de disputa; comportamento de GET/recibo após excluir checkout e garantia de não reutilização. Encaminhar IDs de fixture somente por canal administrativo autorizado, nunca chaves ou payload no Git.
3. **Pagamento novo somente quando necessário e acompanhado:** a fixture atual já está cancelada e precisa ser preservada. Se o provedor exigir outra assinatura ativa para provar alteração/renovação/fechamento, preparar manifesto com estado inicial, expected values, geração, responsável, evidência e cleanup **antes** de gerar checkout. Não criar link antecipado que expire enquanto o founder está ausente.
4. **Futuro piloto de Production:** autorização específica após os gates, chave/configuração próprias e plano de observabilidade. Não há solicitação de cartão real, cobrança ou migração de cliente nesta rodada.

## 24. Checklist verificável de pré-produção

- [x] CI/build/segurança do código a3539abc aprovados e código revisável; o HEAD documental posterior exige conferência própria.
- [ ] 0141 e anteriores com preflight/backup/locks/rollback verificados na janela autorizada; nunca executar agora em Production.
- [ ] Recorrência externa com cobrança/ciclo/valor/item/cliente/conta e calendário comprovados.
- [ ] Fechamento de checkout reutilizável homologado sem perder recuperação financeira/histórico.
- [ ] Upgrade, downgrade e médico adicional comprovados no ciclo integral real, sem cota antecipada.
- [ ] Falhas, retries e auto-cancelamento conhecidos; política de estorno/disputa aprovada e validada.
- [ ] Ausência total de webhook com recuperação autoritativa ou requisito de aceitação explicitamente tratado pelo responsável.
- [ ] Webhook público de destino estável, secret mínimo, inbox/lease/replay e alertas operacionais verificados.
- [ ] Trial/cotas/termos/landing coerentes com checkout ao final e novas regras de alteração; anual não anunciado como disponível.
- [ ] Origem Asaas legada/paciente e desconto vitalício preservados; nenhum failover financeiro automático.
- [ ] Rollout gradual autorizado e monitorado; contenção pronta, sem DOWN destrutivo.

## 25. Decisão

**NO-GO para ativação de AbacatePay em Production.** Há avanços concretos implementados: recuperação de resultado perdido, intenção/plano/cotas no próximo ciclo e observação financeira negativa com política de acesso aprovada. Provas locais e readback real têm limites explícitos. Permanecem gates financeiros externos, além do risco já conhecido de checkout reutilizável. A plataforma de Production não foi alterada e o Asaas não foi desligado. O registro final de execução abaixo deve completar totais, hashes, DEV, CI e Preview do código novo, sem reclassificar limites temporais como prova externa.

### Registro de fechamento local — 09/11/2026

- **PASS:** suíte completa, 609 arquivos, **6.695/6.695**, exit 0, 749,41 s. O harness registrou o código de saída real de cada processo. TypeScript, lint completo, inventário, segurança de migrations, drift de observabilidade e arquitetura DB/ciclos também saíram 0.
- **PASS após a última alteração de acesso:** TypeScript, lint dos arquivos afetados, 74 testes focados (35 recuperação, 20 negativos e 19 HTTP/autorização de plano), mais os 33 checks PostgreSQL. Um primeiro typecheck desse teste detectou linha possivelmente ausente; foi corrigido com asserção explícita, sem cast ou supressão.
- **Transparência:** uma execução anterior exibiu 6.692 asserções aprovadas e cobertura, mas o comando composto retornou 1 e o código ainda estava sendo revisado. Não foi usada como PASS integral. O lint intermediário também encontrou import de banco na rota e nomes de helpers interpretados como hooks; os problemas foram corrigidos, sem desativar regras. O gate completo posterior acima terminou exit 0.
- **Sandbox:** catálogo mensal de cinco variantes conferido; três produtos sintéticos adicionais criados com manifesto prévio, externalId estável e resultado desconhecido retido antes do POST. Valores 197/397/544/691/838 reais por mês, sem trial nativo. **Zero contas, checkouts ou cobranças novas**. IDs e procedimento de limpeza ficam no manifesto protegido; não remover produtos referenciados por contratação.
- **Configuração do Preview:** a tentativa de atualizar somente o mapa de produtos da branch foi interrompida antes da escrita: API administrativa Vercel retornou 403 para a sessão disponível. A configuração não foi alterada nessa tentativa; não confundir login CLI antigo com permissão atual. Conferir a continuação abaixo antes de declarar o catálogo incorporado ao novo deployment.
- **Build novo local: NOT RUN:** máquina com memória disponível insuficiente para outro build Next simultâneo. Usar CI e deployment do SHA novo; build de outro SHA não substitui esse gate.

**Continuação da configuração:** a CLI oficial renovou legitimamente a sessão. Em `2026-11-09T12:14:17Z`, o mapa dos cinco produtos foi atualizado apenas em Preview, branch `feat/billing-abacatepay-20261107`. Uma variável alterada; metadados das demais variáveis/ambientes preservados; zero escrita em Production. Exige novo deployment. A recusa 403 anterior permaneceu sem efeitos.

[Evidências sanitizadas desta rodada](evidencias/homologacao-final-20261109.json). Os resultados remotos do novo SHA serão acrescentados depois de sua execução.

### Registro remoto do código a3539abc

**PASS:** [CI 42615597795](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42615597795), 609 arquivos e 6.695/6.695 testes; cobertura 62,27% linhas/statements, 83,14% branches e 66,43% funções. Auditoria de dependências, TypeScript, lint, arquitetura, migrations, observabilidade, registry, inventário, isolamento entre dois tenants, build Next, bundle e HTTP boundaries aprovados. E2E público: **8 PASS/2 SKIP**, somente os dois caminhos Turnstile sem chaves nesse build, com suas provas separadas na seção 15. Upload do relatório de falha foi ignorado porque não houve falha; não é cenário funcional omitido. Semgrep, Snyk e Vercel SUCCESS; Agent Review NEUTRAL, sem tratá-lo como revisão humana.

**Preview READY:** [project-mvz987crz](https://project-mvz987crz-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura), deployment dpl_7ZaQF6AkvkUHeDknPLpRSHY55nSw, mesmo SHA. E2E com assinatura de runtime confirmou DEV em Auth e DB; login real da fixture retida, desktop 1440 e mobile 390, nenhum overflow, cancelamento/período preservados e contratação antecipada ausente. A nova rota recusou mudança da assinatura cancelada com 409 e corpo contendo tenant forjado com 400. Hash da assinatura e contagens de invoices/operações/intents iguais antes/depois. Zero comandos financeiros novos nesse E2E. Não prova mudança de plano paga nem renovação temporal.

**Readback negativo real:** cinco GETs Sandbox, sem mutações ou escrita DB. O leitor encontrou PAID e nenhum débito de refund, classificando corretamente como status_only. Não é prova de estorno ou desfecho de disputa. O catálogo foi incorporado ao novo deployment; o 403 administrativo intermediário foi resolvido por renovação legítima da sessão CLI.

O primeiro format:check encontrou somente o snapshot JSON antigo de preservação sem formatação. Foi formatado sem mudar nenhum campo/hash, com igualdade de JSON verificada. Os arquivos alterados e o diff foram conferidos. A atualização documental posterior não altera src, migrations nem E2E desse código já aprovado.

### Próxima intervenção humana realmente necessária

Abra [o painel AbacatePay](https://app.abacatepay.com/), mantenha **Modo Teste (Sandbox)** e clique em **Suporte**. Encaminhe esta pergunta, sem dados de pacientes, API key ou payload:

Utilize a [solicitação consolidada ao suporte](SOLICITACAO-SUPORTE-HOMOLOGACAO.md), apresentada integralmente no chat em 09/11. Ela substitui a pergunta curta anterior, que incluía retentativas já documentadas e não explicitava a incompatibilidade do endpoint de refund com assinaturas V2. A documentação já confirma que excluir o checkout não cancela as assinaturas geradas; a dúvida remanescente é sobre uso único e preservação das consultas/históricos. A mensagem foi preparada, **não enviada**; não há resposta externa nesta rodada.

Resultado necessário: orientação oficial ou resposta vinculada a ticket/documentação, não uma alteração de datas que aparente um mês decorrido. Envie apenas a resposta e identificador do ticket, sem credenciais. Se o método exigir assinatura ativa, a engenharia preparará outra fixture antes de gerar link, com você disponível. Não pagar novamente o link antigo, não alterar seu cancelamento e não criar cobrança real. O uso de Sandbox não autoriza Production.

## 26. Continuidade enquanto o suporte não responde — 09/11/2026

Baseline conferida: `14d7f9d4a749b257bb4e7a2f8d6ae0a8f6382fa6`, worktree financeiro limpo, PR #53 OPEN/draft. A CI [42617193661](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42617193661) terminou SUCCESS com 6.695 testes e build; seus dois SKIP Turnstile continuam SKIP no build isolado. As provas separadas anteriores não são reinterpretadas como execução desses caminhos na CI. Nenhuma mudança de CI/deploy ou nova configuração de chaves nesta rodada.

### Revisão documental e gate S1

A [solicitação única](SOLICITACAO-SUPORTE-HOMOLOGACAO.md) contém assunto, mensagem completa, seis referências verificadas e quatro respostas esperadas. Foi apresentada no chat antes da continuação técnica. **S1 concluído como preparação/entrega; envio e resposta não executados pela engenharia.** Não há autorização de contato remoto implícita nesse gate.

A documentação atual de [refund](https://docs.abacatepay.com/pages/payment/refund) proíbe reembolsar cobranças de assinatura pela API V2 e não suporta parcial nesse endpoint. O leitor de débitos financeiros existente **não executa reembolso** e suas fixtures de parcial não afirmam capacidade de solicitar essa operação ao provedor. Refund/disputa de assinatura exigem procedimento suportado a esclarecer. O [simulador](https://docs.abacatepay.com/pages/transparents/simulate-payment) é de pagamento transparente; não foi encontrado acelerador oficial do ciclo mensal. A [exclusão de checkout](https://github.com/AbacatePay/documentation/blob/main/pages/subscriptions/checkouts-delete.mdx) preserva assinaturas geradas, mas não documenta todas as consultas financeiras posteriores nem uso único. A ausência de documentação suficiente não prova ausência do recurso.

### Correção local confirmada

`readAbacatePayNegativeEvent` verificava conta e identificadores externos, mas não filtrava o vínculo interno de clínica/assinatura previamente registrado no inbox. Uma fixture adversarial com referências conflitantes reproduziu **retentativa**, em vez de revisão imediata. O trigger de imutabilidade do inbox já impedia o commit cruzado; **não foi comprovado acesso cruzado nem alteração indevida de período**. A correção respeita também os IDs internos já vinculados antes de qualquer GET. O teste exige revisão, zero consultas externas e preservação do vínculo, das invoices e do acesso. Não exige migration, contrato público novo ou mudança de regra comercial.

### Ampliação local e limites

- Renovação: recuperação de lease abandonado e encerramento da última tentativa sem um 11º readback.
- Eventos negativos: vínculo interno conflitante, namespace Asaas, lease perdido durante readback e falha real de INSERT da auditoria com rollback da política/inbox; retry posterior auditado uma vez.
- Plano/adicionais: cancelamento intercalado entre reserva e confirmação do comando; uma cobrança alvo posterior preserva evidência financeira, sem liberar cota ou reaplicar o efeito em replay.
- Calendário: tolerância de emissão em ±60 segundos e recusa fora dela; recontratação no instante exato de vencimento, um milissegundo antes/depois e representação equivalente de Brasília/UTC. É relógio/estado sintético, sem alterar a fixture remota.

A [matriz diferencial](MATRIZ-CENARIOS-E-TESTES.md#continuidade-aguardando-suporte--gates-s1-l1l7-e-e1e4) separa cada prova local da dependência externa. Fechamento automático de checkout pago continua não implementado/não autorizado para ensaio remoto sem garantias; o link pago antigo permanece intacto. Não inventar ciclo a partir de preço/cliente, não usar o simulador transparente para declarar renovação e não usar `/checkouts/refund` para assinatura.

### Resultados locais finais do incremento

- **435/435 testes focados**, 20 arquivos, exit 0. Incluem HMAC/receptor HTTP, readers, journal/unknown, rotas de checkout/cancelamento/plano e calendário. Nove casos unitários novos, sem remoção de asserções.
- **40/40 verificações PostgreSQL**, 142 migrations reais, exit 0, zero rede externa e 140 chamadas HTTP de fixtures. São os 33 checks anteriores do recorte com sete novos. As 8 provas H3 e 47 de trial/cancelamento/recontratação anteriores continuam evidência histórica, **não foram reexecutadas nem contadas como 95 checks novos**.
- TypeScript, lint completo e inventário de segurança aprovados; nenhum guard/piso/skip foi enfraquecido. Build e E2E do código novo devem ser conferidos no PR/CI do novo SHA, sem reutilizar o build de `14d7f9d4` como se fosse deste incremento. Não foi necessário repetir inspeção visual sem alteração de UI.
- Falha de regressão inicial reproduziu retry para o vínculo conflitante; corrigida e retestada. Duas execuções intermediárias encontraram problemas na preparação das fixtures novas (conta sintética Asaas ausente e campo obrigatório de período ausente), corrigidos sem alterar as regras de produção nem a schema para aceitar fixtures inválidas. O ensaio final passou inclusive com cancelamento intercalado durante o comando.
- **Zero** novas contas/produtos/checkouts/pagamentos no provedor, zero migrations DEV/Production, nenhum GET/POST no Sandbox necessário nesta rodada, nenhuma alteração do checkout pago retido. Somente o worktree financeiro foi editado.

[Evidência sanitizada local](evidencias/continuidade-suporte-20261109.json). A mensagem não foi enviada, nenhum ticket foi aberto e nenhuma resposta foi recebida pela engenharia. **NO-GO de Production preservado** pelos gates E1–E4; continuam necessárias as provas e garantias externas, mesmo com os gates locais aprovados.

## 27. Continuidade sem aguardar suporte — 09/11/2026

**Atualização do proprietário:** a solicitação já foi enviada por ele; a resposta permanece pendente. O registro anterior descreve o que a engenharia havia feito naquele checkpoint, não uma instrução para reenviar. A [solicitação original e seu controle](SOLICITACAO-SUPORTE-HOMOLOGACAO.md#controle-da-solicitação) foram atualizados sem modificar o corpo encaminhado. E1–E4 continuam `BLOCKED — AGUARDANDO SUPORTE` no recorte externo.

### Lacuna local identificada e implementada

O pagamento inicial já recusava uma lista com várias assinaturas, mas não existia monitoramento periódico dos checkouts conhecidos após a primeira ativação ou recontratação. Uma assinatura adicional criada no provedor poderia permanecer sem um incidente explícito no Qoro. Foi implementada uma inspeção de integridade **sem comandos financeiros**:

- Contrato neutro em `src/lib/payments/saas/recurrence-integrity.ts`; observação não é pagamento, período, direito ou ordem de cancelamento.
- Adapter `checkout-integrity.ts`: somente GETs documentados, loja/ambiente/recurso/cliente conferidos, no máximo duas páginas. Uma lista com dois IDs distintos gera evidência de recorrências múltiplas; lista incompleta/duplicada/inválida não recebe classificação saudável. A observação pode ser um limite inferior, sem afirmar totalidade.
- `abacatepay-integrity.ts`: verifica bindings e gerações anteriores/pendentes de recontratação, mantém reserva/auditoria no histórico existente, revalida vínculo antes do commit e deduplica incidente por fingerprint. Não muda assinatura, invoice, cota, perfil, preço ou cancelamento.
- Cancelamento remoto inesperado, referência divergente, trial nativo e estado desconhecido geram revisão humana. Cancelamento já solicitado localmente não é classificado como inesperado. Não inferir perda financeira de status remoto.
- Auditoria `subscription.recurrence.checked/observed/review_required/check_failed`, métricas `billing.abacatepay.integrity_scan/integrity_review/integrity_failed` e chamada sanitizada ao capturador Sentry existente. Nenhum payload, cliente ou cartão vai à métrica/exceção. A emissão do sinal não comprova entrega de notificação ao operador.
- Reserva sob lock de assinatura e nova leitura do predicado de backoff após adquirir o lock. A gravação da observação espera o lock por até 2s; usar SKIP LOCKED nessa segunda fase podia perder o registro durante a corrida dos próprios workers, comportamento detectado no ensaio e corrigido sem alterar política de acesso.
- Integração no cron existente, sem mudança de agendamento/configuração: até três candidatos, prazo por GET de 1,5s, margem de 7s por candidato e backoff de uma hora. Gerações ainda não examinadas são sinalizadas por `deferred`; **isso não é promessa de varredura horária**. O cron continua diário e pode adiar AbacatePay após trabalho Asaas; capacidade/backlog devem ser monitorados no piloto.

### Novas provas e limites

O leitor e a integração do cron passaram inicialmente **50 testes focados**, sendo 33 novos do adapter e 17 da rota existente. O ensaio PostgreSQL foi ampliado para incluir concorrência de 16 monitores, deduplicação entre verificações, indisponibilidade de API, rollback da auditoria, cancelamento esperado/inesperado, isolamento, orçamento e gerações distintas. Os totais finais ficam no registro de encerramento deste incremento; não herdar o PASS do ensaio intermediário para alteração posterior.

Readback real em **09/11 às 18:01 UTC (15:01 Brasília)**: cinco GETs, uma recorrência conhecida, status parado e lista completa, sem divergência. Loja validada pelo manifesto protegido e Sandbox validado pelo adapter. **Zero mutações remotas, escritas DB, contas, checkouts ou pagamentos novos**; fixture paga/cancelada intacta. Não comprova produção de assinatura duplicada, renovação, fechamento pago, refund ou passagem temporal.

As duas provas Turnstile foram preparadas em cópia local sem `.env`, com chaves dummy oficiais, sem mudar Vercel/CI/Production. A tentativa não chegou aos testes: o servidor Next local não respondeu ao healthcheck de `/login` em 180s (ECONNREFUSED e depois ECONNRESET no encerramento). Foram corrigidos dois problemas do runner — cópia de `public` inexistente e quoting Windows — mas a inicialização continuou sem readiness. Havia cerca de 551 MB de memória física disponível; isso é indício de restrição ambiental, não causa exclusiva comprovada. Nenhum teste de widget ou de secret recebe FAIL/PASS por essa inicialização. Uma alteração experimental da assertion foi retirada; a spec ficou idêntica ao baseline. Os dois SKIP da CI permanecem SKIP, e as provas separadas históricas da seção 15 continuam com seu recorte. Não foi alterado código de Auth, chave real, segurança ou UI para forçar a execução.

**Nenhuma migration nova. Nenhuma alteração comercial, no Asaas legado/pacientes ou na UI do outro agente. NO-GO de Production preservado.** O monitor detecta/anota incidentes; ele não garante uso único da URL e não executa fechamento remoto automático.

### Registro local do monitor

- **50/50 checks PostgreSQL**, 142 migrations reais, 173 chamadas HTTP sintéticas e zero rede externa, exit 0. Dez checks novos sobre os 40 do checkpoint `75fe1e74`. Reserva/backoff, 16 workers, dedup entre verificações, falha de persistência com rollback, indisponibilidade/retry, cancelamento esperado/inesperado, tenant, orçamento, backlog e checkout de geração anterior/pendente comprovados sem mudar direitos/valores/invoices/comandos.
- O teste da fixture pendente inicialmente foi recusado por `gateway_recontract_not_eligible`; a preparação sintética foi corrigida para respeitar cancelamento confirmado e término do período. A constraint não foi afrouxada. Uma execução concorrente posterior revelou que SKIP LOCKED na gravação podia pular o registro; a espera limitada/revalidação corrigiu o caso, sem retirar asserções. O ensaio final acima passou.
- Regressão afetada final: **493/493 testes em 23 arquivos**, incluindo os 33 novos do leitor e os 17 da rota. TypeScript final, lint integral, formatação dos arquivos alterados, inventário, AST de acesso ao banco, dependências circulares, drift de observabilidade e segurança de migrations passaram com exit 0. O inventário foi regenerado após a adição do módulo, sem guard novo sem revisão, sem drift de env pública e sem método HTTP novo. Build, regressão integral remota e Preview exigem o resultado do novo SHA no PR; não herdar o resultado `75fe1e74`.
- O readback Sandbox usa a fixture paga/cancelada preservada, sem editar sua recorrência ou vencimento. Não é prova de duplicidade financeira externa. Nenhuma credencial nova foi solicitada.

A capacidade do capturador Sentry existente é utilizada, mas **entrega de uma notificação ao responsável não foi ensaiada nesta rodada**. Antes de piloto real, conferir destino/roteamento do sinal e capacidade do cron para a quantidade de checkouts; a métrica de lote adiado não equivale a uma varredura completa. E1–E4 continuam pendências externas de homologação, não regressões locais presumidas.

O [snapshot sanitizado desta rodada](evidencias/integridade-recorrencias-20261109.json) reúne as verificações, horários, limites e hashes dos arquivos executáveis. A revisão adversarial foi feita pelo mesmo executor, com casos de resposta malformada, tenant/gateway divergentes, cursor repetido, timeout, locks e falha de persistência; não representa uma revisão independente. **L1–L7 têm evidência local aplicável; L8 permanece PARTIAL** pelos dois cenários Turnstile não executados no runner atual e pela necessidade de conferir o novo Preview; **L9 depende também da CI própria**. Não há decisão comercial pendente nova nesta implementação. Após a resposta oficial, executar somente as provas E1–E4 que o mecanismo suportado permitir, em fixtures identificadas; não repetir a compra inicial nem reenviar a solicitação.

## 28. Resposta do suporte incorporada — 09/11/2026

A [resposta de Guilherme encaminhada pelo founder](SOLICITACAO-SUPORTE-HOMOLOGACAO.md#resposta-recebida-e-consequência-técnica--09112026) substitui o estado geral “aguardando suporte” dos checkpoints anteriores. E1 e E2 são limitações confirmadas; E4 tem procedimento esclarecido; somente parte de E3 ainda aguarda confirmação do time do provedor. Nenhum limite externo recebe PASS por uma fixture local.

| Frente | Conclusão atual | Risco/ação restante |
|---|---|---|
| Renovação, planos e retries | Sem acelerador Sandbox. Calendário e efeitos já têm testes locais; o ciclo financeiro externo não foi antecipado. | Observar ciclo real ou tratar o requisito de aceite com autorização expressa; não repetir pagamento inicial. |
| Renovação sem nenhum webhook | Não existe histórico de cobranças por assinatura nem vínculo `subs_` no extrato. Recuperação do inbox já recebido não resolve ausência integral de evento. | Operação precisa de reenvio pelo provedor/suporte e vínculo autoritativo. Não conceder acesso por aproximação de valor, cliente ou horário. Risco exige decisão explícita antes do piloto. |
| URL reutilizável | `customerId` não impede outro pagador. Monitor/journal detectam inconsistência, sem impedir o pagamento externo. | Aguardar confirmação de invalidação da URL e efeitos após exclusão. Fixture paga intacta. Continua impedimento para ativação irrestrita. |
| Refund e disputa | Refund integral pelo painel/portal cancela remotamente; refund parcial de assinatura não está disponível. Eventos negativos não equivalem a prova de débito. | ADR-071 mantém o acesso já pago e revisão humana. Nenhum refund, portal ou disputa real foi executado. |

### Correção encontrada e executada

O receptor já aceitava `checkout.lost`, mas o worker o encaminhava à revisão genérica, sem a mesma observação financeira auditada de `checkout.disputed`. O evento foi incluído no ramo de notificação financeira negativa. O vínculo de checkout/cliente continua sendo validado; a notificação não revoga acesso, não cancela recorrência e não afirma que o readback provou uma perda financeira.

Provas novas: **35/35 testes focados** (processamento e receptor HMAC) e **51/51 checks PostgreSQL**, com **142 migrations reais**, 177 chamadas HTTP sintéticas e **zero rede externa**. O 51º check aplica um segundo ciclo sintético, recebe `checkout.lost` sem `subscriptionId`, confere uma auditoria conforme ADR-071, repete o evento sem outro GET e compara o estado financeiro integral. Os outros 50 checks são regressão afetada, não 50 provas novas. Os resultados de CI/build do novo commit devem ser lidos no fechamento remoto desta seção.

O suporte distingue falhas por `installmentId`, `installmentNumber` e `retryNumber`. Esses detalhes ainda não são persistidos no DTO mínimo; não há cobrança/retry iniciado pelo Qoro nem concessão de novo ciclo a partir de falha. Deduplicação atual é por ID de evento. A informação por tentativa é uma melhoria de observabilidade, não uma capacidade já entregue.

**NO-GO para ativar AbacatePay em Production mantido.** Sem migration nova, alteração de produção, envio externo, novo checkout, pagamento, cancelamento ou exclusão da fixture. As quatro exclusões locais de vídeos históricos detectadas antes da edição foram preservadas fora do commit; não representam alterações desta correção.

### Fechamento local do incremento de suporte

TypeScript, lint integral, Prettier dos três arquivos executáveis, inventário e diff check passaram com exit 0. O inventário manteve 199 ações, 65 métodos HTTP e zero pendência de guard/env pública/teste de rota. [Evidência sanitizada](evidencias/resposta-suporte-20261109.json), com hashes do código executado. CI/build do novo commit devem ser conferidos no PR #53; a aprovação de `ffd4c635` continua histórica e não substitui os checks desta correção.

## 29. Sincronização com o cadastro publicado — 09/11/2026

O PR #54 foi autorizado e publicado independentemente em Production: main `5620a098`, CI 6.186/6.186 e smoke 9/9. A branch financeira incorporou essa main para preservar o feedback de entrega, correção por CAS e retomada do cadastro. O único conflito foi o inventário Markdown gerado, refeito a partir do código; não houve resolução manual de conflito funcional nem alteração do worktree do agente de UI.

O incremento financeiro `862194fd` passou CI 42720100240 com **6.738/6.738**, build, segurança/isolamento e E2E público 8 PASS/2 SKIP. Essa evidência é anterior à incorporação da main; o merge exige sua própria regressão afetada/CI. A publicação autorizada do cadastro não autorizou ativar AbacatePay, rodar migrations financeiras em Production ou modificar a fixture paga. E1–E4 continuam com a classificação da seção 28.

### Regressão após incorporar a main

PASS: 141/141 testes focados, TypeScript, lint dos arquivos incorporados, inventário, Prettier e **7/7 verificações PostgreSQL com 142 migrations reais**, zero rede externa/escrita em Produção. A primeira inicialização do ensaio PostgreSQL não herdou a condição server de um processo filho; não executou asserções. O runner foi repetido com `NODE_OPTIONS=--conditions=react-server`, preservando o guard `server-only`. O JSON de evidência novo foi formatado sem alteração de conteúdo. [Prova do banco integrado](../../quality/evidencias/signup-email-correction-integrated-20261109.json).

A CI e o Preview próprios do merge são registrados no corpo do PR #53 após execução, para não gerar outra bateria integral apenas por acrescentar o resultado documental. A prova financeira 51/51 continua aplicável ao código financeiro inalterado de `862194fd`; não foram criados novos pagamentos ou testes externos para repetir essa evidência.

## 30. Fechamento dos bloqueios e operação auditável — 10/11/2026

Baseline verificada: PR #53 draft em `c712b743`, CI `42723322325` SUCCESS com 6.777 testes; main/PR #54 mesclado em `5620a098`. Esta rodada implementa a lacuna operacional B2, sem reimplementar o cadastro e sem repetir compras aprovadas. [Plano final, matriz de gates e termos de risco](PLANO-FINAL-GO-LIVE-ABACATEPAY.md); [operação com MFA](../../runbooks/abacatepay-operacao.md); [mensagem original encaminhada do suporte](SUPORTE-RESPOSTA-INTEGRAL-20261110.md).

**Implementado:** monitor de fim de período pago sem renovação conciliada, abertura/resolução deduplicadas, sinal sanitizado de incidente/cobertura adiada, painel `/admin/billing/operacao` com fila/quarentena e autorização superadmin AAL2+TOTP atual para uma releitura. Ledger privado com FK composta, snapshot e contador cumulativo, no máximo 3 autorizações/evento/24h; auditado atomicamente com `super_admin_actions`. O worker continua verificando o mesmo evento e os mesmos IDs remotamente antes de qualquer efeito financeiro. Não há entrada para preço, período ou “marcar pago”. Falha de audit faz rollback; queda após autorização conserva a fila. Monitor, autorização e revisão não concedem acesso por si.

**Banco:** migration aditiva 0142 aplicada somente no DEV em `2026-11-10T04:36:24Z`, histórico 142 → 143. As seis diferenças antigas de hash correspondem à baseline de 30/10; não foram alteradas. Readback comprovou RLS FORCE, service_role SELECT/INSERT, sem UPDATE/DELETE/TRUNCATE, e fingerprint dos contratos inalterado. [Evidência DEV](evidencias/0142-dev-20261110.json). Não foi aplicada migration em Production.

**Testes:** 66/66 verificações PostgreSQL reais, com 143 migrations, 202 chamadas HTTP sintéticas e zero rede externa; 15 checks novos OPS-001–015, além da regressão afetada de 51. Passaram também 793 testes financeiros dirigidos e 63 testes finais nos cinco arquivos de ação, tela, entrada, worker e cron; as contagens se sobrepõem e não devem ser somadas. TypeScript, lint integral, inventário (200 ações/66 métodos, zero drift/guard pendente), arquitetura de banco e observabilidade passaram. [Snapshot sanitizado e hashes](evidencias/operacao-final-20261110.json). Build, CI própria e Preview do commit publicado ficam registrados no corpo do PR #53 após conclusão. A revisão adversarial foi do próprio executor; não é auditoria independente.

**Limites:** B1 não tem garantia suficiente de URL invalidada/histórico preservado, inclusive na janela anterior ao webhook. O delete remoto continua sem implementação/execução. B3 não possui simulador oficial de ciclo, refund ou disputa recorrente; nenhuma fixture local recebe o rótulo de prova externa. B2 recupera evento recebido, não reconstrói uma renovação inteiramente sem webhook/histórico oficial. O cron continua diário às 09:00 UTC, até 10 contratos locais/3 gerações remotas por chamada; volume e alertas precisam de validação operacional. A jornada admin real com MFA e a entrega da notificação externa não foram executadas nesta rodada. Dois Turnstile SKIPs continuam explícitos na CI isolada, sem dummy em Production.

**NO-GO financeiro mantido.** Riscos R1–R4, canal oficial de recuperação, operador/alerta e evidência externa permanecem pendentes. A candidata é Sandbox: não existe modalidade de aquisição live nem cohort de produção implementado. Não basta configurar uma chave real; essa composição exige incremento específico e validação após os gates. A fixture paga retida não foi alterada, contratos Asaas/desconto vitalício e pagamentos de pacientes foram preservados. Sem merge, produção, nova cobrança, refund, portal, cancelamento, mensagens ou reenvio aos leads. As quatro exclusões preexistentes de vídeos não pertencem ao commit.

Verificação adicional de navegador: corrigido o escape do hífen no `pattern` HTML do incidente; o backend já recusava entradas inválidas. PASS **5/5** restrições nativas no Chromium e **5/5** testes da tela repetidos, sem credenciais, conta ou rede externa. Não representa login superadmin/MFA real. Fonte: `scripts/security/abacatepay-review-form-browser.ts`; resultado e hash no snapshot.

Incremento de integridade do journal: o `when` da 0142 é uma versão lógica de 16:00 UTC, superior ao horário real da aplicação. Foi preservado o histórico já aplicado e acrescentado ao checker de migrations o bloqueio de próxima versão regressiva, índices pulados e prefixos divergentes. PASS **24/24** testes de segurança de migrations, incluindo 10 novos casos, TypeScript/lint; nenhuma nova migration, escrita remota ou mudança de configuração de CI/deploy. Os 16 hashes financeiros anteriores continuam iguais e não houve alteração de código de runtime do app. [Evidência de reutilização das provas e da fronteira Preview 3/3](evidencias/ordem-migrations-20261110.json). CI própria do novo SHA registrada no PR.

Fechamento remoto do código financeiro `5f216739`: [CI 42758707597 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42758707597), **6.807/6.807**, cobertura, build, segurança, isolamento e E2E público **8 PASS / 2 SKIP**. Preview imutável `project-fq6gww0xk-clinic-os-v2-s-projects.vercel.app` READY. A nova fronteira admin passou **3/3** verificações reais anônimas (desktop 1440, celular 390 e RSC); a primeira tentativa do probe API parou na confiança TLS local e passou usando as raízes oficiais do sistema, sem desativar TLS. Login superadmin/MFA e entrega de alerta continuam sem ensaio real. O incremento de checker posterior não altera essa fonte financeira; CI própria e deployment atual ficam no PR para evitar nova bateria por registrar resultados.

## 31. Preparação para “criar checkout” sem aguardar suporte — 10/11/2026

Baseline remota confirmada: `a27be74240bf72bdef088b9017fbb9d6b4f94fbd`, [CI 42760464375 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42760464375), **6.817/6.817**, build e E2E público 8 PASS/2 SKIP. O novo incremento é tooling de homologação e uma correção no preço esperado do E2E; não muda runtime financeiro, schema, CI/deploy ou aquisição em Production.

Implementado operador durável `preflight/prepare/create/verify`, com binding exato Preview/DEV/Sandbox, trava entre processos, manifesto imutável quanto a ambiente/plano, credencial DPAPI e ACL privada, recuperação da mesma identidade/checkout, bloqueio diante de resultado ambíguo e retenção sem timeout. Reaproveita a jornada UI existente, sem pagar pelo usuário. A invoice do E2E deixou de fixar R$ 397 e usa a oferta aprovada do plano, inclusive Consultório R$ 197. A verificação nova exige pagamento integral, assinatura única, webhook aplicado, invoice/receipt/tentativa únicos, período Qoro correto, UI desktop/mobile e repetição de checkout recusada.

PASS nesta rodada: **143/143 testes dirigidos**, incluindo **32 novos** de ambiente/persistência/concorrência e os 6 existentes de journal (não somar as contagens); preflight externo real na baseline acima; preparação local com roundtrip DPAPI/ACL e zero contas/checkouts/pagamentos. Dois desses 32 testes executam o CLI verdadeiro com entradas inseguras e comprovam rejeição anterior à leitura de configuração/serviços. A flag do arquivo local é `--settings-file`, evitando a interceptação de `--env-file` pelo runtime Node/tsx. Arquitetura DB, checker de migrations, TypeScript, lint e formatação são conferidos antes do commit; CI/build próprios do incremento ficam no PR. [Roteiro e limites](PROXIMO-CHECKOUT-SANDBOX.md).

O ensaio real encontrou uma falha de repetição da ACL: reaplicar `Set-Acl` sobre o diretório já protegido exigia um privilégio Windows desnecessário. Corrigido para conferir a ACL existente e alterar somente a DACL na pasta nova, preservando proprietário e sem elevação. PASS duas operações locais (pasta nova/repetição) e repetição completa de `prepare` com o mesmo run/credencial. A API também apresentou leituras transitoriamente indisponíveis; o operador mantém falha fechada e timeout de leitura limitado a 30s, sem repetir comandos financeiros. [Evidência sanitizada e hashes](evidencias/checkout-preparado-20261110.json).

**NOT RUN:** nova compra e `create/verify` positivos do novo operador, aguardando o pedido e o pagamento do founder. A prova da preparação não equivale a pagamento, webhook novo nem aquisição completa. Fixture financeira antiga preservada; nenhum novo usuário DEV, checkout, envio, migration ou alteração de Production nesta rodada. B1/B3, prova admin/MFA e recebimento de alerta permanecem fora desse novo pagamento inicial. GO de produção não foi concedido.

## 32. Checkout solicitado pelo founder — 10/11/2026

O pedido “criar checkout” autorizou executar a preparação existente: uma identidade sintética DEV, uma clínica de teste e **um checkout Clínica mensal de R$ 397 no Sandbox**. Run `2d072b20-dab5-4073-bdaf-2c8f1989c739`, contrato `9cf0a65a-ef4c-4e09-84dc-034985b1036b`, clínica `3b1d8180-9455-4ff1-87f3-eecbfef94cb0`, checkout `bill_6WgrJ0S5pfFrkZyhJcyNTKLE`. O link é entregue somente ao founder; não integra o Git. Readback final: PENDING, uma operação, zero assinaturas remotas e pagamento ainda não executado. Manifesto/credencial e fixture permanecem retidos.

O teste encontrou erro no roteiro de seeding: `Date` como parâmetro SQL bruto não é serializável pelo cliente canônico após a composição Drizzle. Confirmado por SELECT somente de leitura; a transação anterior fez rollback sem profile/draft. Corrigido para ISO explícito e schema de leitura que aceita os timestamps reais como string ou Date, recusando nulos/inválidos onde não permitidos. A mesma identidade foi reaproveitada. PASS **61/61 dirigidos**, incluindo **38 do operador**; TypeScript, lint e Prettier; roundtrip ISO real no DEV; E2E real de login → trial → DB → desktop/mobile → rota Qoro → checkout hospedado, sem pagamento. Sem alteração de runtime do app, migration, Production, contrato real ou fixture antiga.

A correção do roteiro fica local/revisável até conciliar este pagamento: publicar a branch durante a espera avançaria o alias destinatário do webhook e invalidaria a exigência de mesma release do manifesto. Continuar com o Preview imutável `project-c7axs7wlj-clinic-os-v2-s-projects.vercel.app`, SHA de runtime `ea45fb8e`. Depois de “pago”, executar `verify`, conferir evento aplicado/invoice/período/cotas/UI e só então publicar o incremento local com seus checks. B1/B3 e a ativação Production não foram liberados por criar este checkout.
