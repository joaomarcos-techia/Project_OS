> **Estado corrente: seção59 — CI recuperada, preflight e ensaio136→160.** [Dossiê A–H](ABACATEPAY-SaaS-GO-NO-GO-FINAL.md). Runtime7208d505/SQL/configuração congelados; novas ferramentas de validação e16 testes. f94248ef passou7.190 testes e22 E2E,zero SKIP; conferir checks do novo SHA no PR53. Production136 e DEV161 reconferidos somente leitura;24 migrations reais em ensaio sintético com16 verificações PASS. [Handoff UI](HANDOFF-UI-BILLING-SaaS.md) publicado para leitura, não confirmado. R1–R4 PARTIAL e sem aceite. Nenhuma operação Production autorizada; seções anteriores preservam história.

# Homologação financeira AbacatePay — Qoro

**Checkpoint corrente: seção59 — CI recuperada e preflight verificável.** Os resultados externos iniciais permanecem válidos; a renovação natural não recebeu PASS. A versão final dos checks está no PR53 e não é inferida de uma CI anterior.

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
| Checkout                | Sim, preço no servidor e journal                           | PASS: concorrência/resultado desconhecido retido   | PASS: emissão Clínica R$ 397 anterior                                              | Recuperar checkout quando o resultado do POST se perdeu                                         |
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

## 33. Pagamento informado e jornada final comprovada — 10/11/2026

Após o founder informar “pago”, o mesmo operador executou `verify` no slot retido `next-checkout-20261110`, sem criar outra conta ou transação. **PASS em 2026-11-10T13:49:41.683Z**, contra o runtime imutável `ea45fb8e`. Checkout `bill_6WgrJ0S5pfFrkZyhJcyNTKLE`: **PAID R$ 397**, cartão, uma assinatura remota `subs_zHgJmhLNe4S3c0rDfrY6TTHt` ativa, mesmo cliente e produto, sem trial nativo. [Snapshot sanitizado, fontes e limites](evidencias/checkout-pago-20261110.json).

No DEV: contrato `9cf0a65a-ef4c-4e09-84dc-034985b1036b` ativo, **um** `subscription.completed` aplicado, **uma** invoice paga, **uma** tentativa confirmada, **um** receipt e **uma** operação de criação de checkout. A política de trial foi liberada. Início/fim de período conferidos contra a regra aprovada de `createdAt` da assinatura; fim em **10/12/2026 às 13:44:26.186 UTC**. Esse é o calendário de acesso do Qoro, não uma data de renovação informada pela API. A engenharia não marcou a conta como paga nem reenviou o evento.

O E2E autenticado real passou pela UI paga nas larguras **1440 e 390**, sem overflow; mostrou “Pagamento confirmado” e retirou “Contratar assinatura”. Um novo POST pela sessão do navegador retornou **HTTP 409 `already_paid`**, sem outra operação financeira. Os gates de trial para WhatsApp/Asaas desapareceram e a interface de convite ficou disponível; nenhum número foi conectado, convite enviado ou integração de paciente alterada. Identidade sintética confirmada administrativamente: esta prova não cobre entrega do e-mail de cadastro.

A primeira execução foi `BLOCKED` em `sandbox_store` por erro de socket em um GET; repetir a leitura da mesma fixture concluiu com PASS. Não foi necessário corrigir runtime, alterar configuração, migrar banco nem criar novo pagamento. O operador conservou o histórico e encerrou em fase `verified`, sem cleanup. A fixture histórica paga/cancelada de 08/11 permaneceu intocada.

Com o pagamento conciliado, o commit local `e8a97ab3` de timestamps e esta evidência podem seguir para o PR draft #53. Os **61/61 testes dirigidos**, TypeScript, lint e formato da correção continuam aplicáveis ao código inalterado; a CI própria do novo HEAD será registrada no corpo do PR, com os dois SKIP de Turnstile explicitados. Nenhuma publicação financeira em Production, merge, alteração de contrato Asaas, nova cobrança ou mensagem externa foi realizada.

**Restante para go-live:** garantia/controle suficiente da URL reutilizável e da recuperação de renovação sem evento; prova operacional de alerta e superadmin/MFA; tratamento explícito dos riscos de renovação/refund/disputa não simuláveis; e implementação/revisão da composição live com cohort autorizado. [Plano final](PLANO-FINAL-GO-LIVE-ABACATEPAY.md). Este PASS fecha a contratação inicial desta fixture, não os gates externos nem o NO-GO financeiro de Production.

Fechamento remoto deste incremento: `49b2df95`, [CI 42828598836 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42828598836), **6.855/6.855 testes**, cobertura, TypeScript, lint, build Next, arquitetura, migrations, isolamento e segurança. E2E público **8 PASS / 2 SKIP** por ausência de chaves Turnstile no build isolado. O incremento seguinte de matriz tem sua própria CI registrada no PR; este resultado não deve ser apresentado como aprovação de testes ainda não publicados.

## 34. Matriz de médicos e valores solicitada pelo founder — 10/11/2026

**Checkpoint anterior à decisão complementar da seção 35.** A limitação inicial a dois médicos descrita abaixo foi identificada na auditoria e depois alterada com aprovação expressa do founder. A regra de mudança posterior de uma assinatura já paga permanece.

O founder perguntou sobre testar diferentes quantidades de médicos. **Regra efetiva na candidata AbacatePay:** o cadastro inicial aceita Consultório ou Clínica com 2 médicos; médicos adicionais são uma alteração da assinatura existente, válida apenas na **próxima renovação integralmente paga**, conforme ADR-068. Não foi implementada seleção de 3–5 médicos no primeiro checkout, nem compra imediata com pró-rata. Isso seria outra mudança de jornada, que não deve ser confundida com os testes desta regra aprovada.

| Plano/cota | Mensalidade comprovada no catálogo | Administrativo |
|---|---|---|
| Consultório, 1 médico | R$ 197 | Até 3 acessos incluídos |
| Clínica, 2 médicos | R$ 397 | Até 3 acessos incluídos |
| Clínica, 3 médicos | R$ 544 | Até 3 acessos incluídos |
| Clínica, 4 médicos | R$ 691 | Até 3 acessos incluídos |
| Clínica, 5 médicos | R$ 838 | Até 3 acessos incluídos |

**Implementação deste incremento:** somente testes, fixtures locais e documentação. Estendida a prova existente `scripts/security/abacatepay-renewal-db.ts` para todas as variantes de 3–5 médicos, sem novo framework, dependência, migration ou alteração de runtime. A fixture conserva o preço do checkout original após o upgrade; o valor da assinatura subsequente varia separadamente, como no fluxo real.

**PASS 85/85 verificações PostgreSQL**, 143 migrations reais, 349 chamadas HTTP sintéticas e **zero rede externa**. São **19 casos novos** sobre os 66 existentes: para cada quantidade, preço exato, 8 pedidos concorrentes/um comando, nenhuma vaga antecipada, 8 aplicações do mesmo pagamento/uma invoice, owner com CRM contado como médico, ocupação exata da cota, próximo médico recusado, 3 administrativos incluídos/quarto recusado, downgrade recusado com excesso e liberado após ajuste/pagamento correspondente. Em cada variante, valor antigo, pagamento parcial, valor pago maior, produto diferente e pagamento antecipado não liberam a cota. Plano desconhecido, legado ou já contratado não gera comando. Os dois primeiros ensaios novos falharam na preparação: CRM fictício repetido e expectativa sobre qual trigger de cota deveria recusar. Foram corrigidas as fixtures/expectativas específicas; os controles do produto e as asserções de bloqueio permaneceram.

**PASS 168/168 testes dirigidos em 6 arquivos**, incluindo **14 novos** de UI, fronteira HTTP e leitores inicial/recorrente. Verificam preço inteiro e pagamento exato em todas as variantes, recusa de parâmetros financeiros/quantidade enviados pelo navegador e deduplicação do botão. TypeScript, lint e Prettier passaram. A inspeção autenticada de leitura da fixture paga no Preview `ea45fb8e` mostrou as opções R$ 197/544/691/838 para troca do plano atual de R$ 397; **zero POST financeiro**, convite ou nova assinatura. Não representa execução externa de `change-plan`.

[Evidência sanitizada, nomes dos 19 casos, contagens e hashes](evidencias/checkout-variantes-20261110.json). A prova externa nova continua sendo o pagamento inicial da seção 33. As renovações dos planos maiores foram simuladas localmente com relógio explícito da aplicação; não houve nova cobrança Sandbox nem observação de passagem temporal. PR #53 segue draft; CI/build do novo HEAD são registrados no corpo do PR após conclusão. NO-GO financeiro de Production e as condições dos contratos existentes permanecem.

Fechamento remoto da matriz: `f8def6d8`, [CI 42831998291 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42831998291), **6.869/6.869 testes**, build, tipos/lint, cobertura, arquitetura, segurança/isolamento e E2E público **8 PASS / 2 SKIP** Turnstile. A implementação inicial ampliada abaixo exige seus próprios checks; não herdar esta CI para código funcional posterior.

## 35. Selecionar 2–5 médicos no primeiro pagamento — 10/11/2026

O founder aprovou a opção **“Escolher de 2 a 5 no primeiro pagamento”** e informou que outro agente já havia feito a UI. Localizado o worktree `C:/dev/Qoro_ui_refactor_20261108`, branch `ui/refactor-qoro-20261108`, commit `e47ec2f0`. Seu `PlanSelectionForm` já renderiza o catálogo retornado pelo servidor e transmite `planId/cycle/rowVersion`; foi apenas lido. Não houve reimplementação visual, alteração nesse worktree ou merge amplo da UI.

Implementado no backend da candidata AbacatePay: catálogo inicial completo de 1–5 médicos, gravação por CAS, provisionamento com plano/preço corretos e aquisição somente mensal. A seleção de 2/3/4/5 médicos corresponde ao valor integral R$ 397/544/691/838; Consultório permanece R$ 197. Preço e produto continuam vindo do servidor, um item de quantidade 1. Catálogo ausente não cai em plano legado na candidata. A origem Asaas conserva seu comportamento anterior. Contrato já pago continua sujeito à renovação paga para mudanças posteriores, conforme [ADR-068](../../adr/068-abacatepay-upgrade-policy.md).

O trial não é reiniciado: são 14 dias desde Auth, sem primeira cobrança/cartão, com cotas e integrações/convites bloqueados como antes. O primeiro pagamento integral ativa o plano escolhido e remove as cotas temporárias. O operador e o E2E existente passaram a aceitar as cinco variantes; o operador valida os cinco produtos contra a loja e o catálogo protegido já existente. GET real comprovou os cinco preços mensais no Sandbox, sem trial nativo e **sem criar produto ou transação**.

**PASS 18/18 verificações PostgreSQL**, 143 migrations, **382 chamadas HTTP sintéticas**, zero rede externa; dez cenários novos de checkout inicial/pagamento insuficiente, em cinco variantes. Exercitam a função real de criação, intents/preço/produto congelados, seis cliques repetidos/um POST, reconciliação real da aplicação, invoice única, cota correta e trial preservado; pagamento insuficiente não libera acesso nem gera outro checkout. Os oito testes existentes de resultado incerto/recuperação permanecem. **PASS 222/222 testes dirigidos** (14 novos neste incremento), TypeScript/lint/formato conforme registro final do PR. [Evidência sanitizada e hashes](evidencias/contratacao-inicial-catalogo-20261110.json).

Não há migration nova, mudança de Production, compra adicional ou alteração da fixture paga. O pagamento externo real de R$ 397 da seção 33 continua retido. **Ainda não houve novo pagamento hospedado de 3–5 médicos nem E2E da junção com a branch visual:** UI foi comparada por contrato e os casos novos financeiros foram simulados localmente. A preparação de um slot novo de 5 médicos não executa compra; criação/pagamento ficam para pedido futuro explícito. CI/build/Preview próprios do novo HEAD são registrados no PR depois de passarem. NO-GO financeiro de Production não foi retirado.

## 36. Fechamento da primeira contratação e integração visual — 10/11/2026

Pedido desta rodada: concluir a primeira contratação, validar a composição com a UI e executar somente homologação Sandbox. A autorização adicional do founder cobre o par público oficial Turnstile no **build isolado de testes**, sem mudar Vercel/Production. O PR #53 continua a unidade de entrega; não há merge nem nova migration.

Baseline reconferida: `4e120afe`, [CI 42837580106 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42837580106), **6.883/6.883**, build, tipos/lint, segurança/isolamento; público 8 PASS/2 SKIP. `main` remota em `5620a098`, UI em `e47ec2f0`. As quatro exclusões antigas de vídeos continuam alheias. TISS não foi alterado.

### Composição com a UI

A comparação anterior da seção 35 comprovava o protocolo, não a experiência completa. A leitura posterior encontrou botão/resumo que ainda descreviam checkout/cartão no início do trial. Foram reaproveitados somente a moldura pública, seu CSS e a apresentação do plano do redesign; conservados os handlers, validações, CAS e destinos da branch financeira. Não foi copiado o redesign inteiro, nem alterado o worktree da UI.

| Antes | Depois |
|---|---|
| Formulário sem o resumo lateral da nova UI | Seleção e resumo com nome da clínica, médicos, administrativos e mensalidade do servidor |
| Texto do redesign prometia checkout no início da avaliação | Botão “Começar avaliação gratuita”, sem cartão/cobrança inicial, rótulo “Mensalidade após a avaliação” |
| Etapa 3 sempre se chamava Pagamento | “Plano e avaliação” na aquisição AbacatePay; comportamento Asaas preservado |
| Tokens da moldura dependiam do redesign completo | Dois aliases CSS locais usam os tokens existentes; sem substituir o CSS global ou introduzir dependência |

O ensaio conservador por arquivo usou `git merge-file -p` em cópias em `dist`, sem merge de branch. Foram comparados **120 arquivos compartilhados**, com conflitos potenciais em **29**. Existem **dois merge-bases** (`5620a098` e `311e5dd0`); portanto essa projeção NÃO afirma a contagem de conflitos de um futuro merge recursivo. A UI também carrega uma versão anterior de partes do financeiro. A integração ampla deverá preservar os leitores, comandos, journal e migrations financeiros atuais, rever o journal SQL e resolver a camada visual com os dois responsáveis; nunca aplicar `ours/theirs` globalmente. A integração limitada desta rodada testa o cadastro sem sobrescrever esse trabalho paralelo.

### Testes e limites

- Testes dirigidos de catálogo/provisionamento/rotas/operador e UI são registrados na evidência desta rodada e na CI própria do incremento. Os 18 checks PostgreSQL de primeira contratação e os 85 de renovação/cotas continuam aplicáveis: o runtime financeiro não foi reescrito nesta integração visual. Não somar as contagens sobrepostas.
- `e2e/abacatepay-plan-ui.spec.ts`: oito casos, 2–5 médicos em 1440/390 px, TSX/CSS reais e respostas HTTP controladas. Conferem resumo, preço, capacidade, refresh anterior ao salvamento e um único salvamento/provisionamento por clique repetido. **Não comprovam Auth, banco ou pagamento.** O harness só é gerado por `security:build` dentro de `dist/security-local/app`; não existe rota correspondente no source publicado.
- `e2e/abacatepay-trial-preview.spec.ts`: ampliado para inspecionar todas as variantes/resumos no Preview real, recusar preço/quantidade adulterados antes do checkout e retomar o mesmo checkout após abandono/refresh, sem liberar o trial nem emitir outra operação. Usa a fixture identificada/retida e a rota real; a identidade confirmada administrativamente não comprova entregabilidade de e-mail.
- Os dois SKIPs históricos eram **sigilo da secret na página e resolução/token do widget**, não dois testes negativos de cobrança. O build isolado agora recebe apenas o par público oficial da [Cloudflare](https://developers.cloudflare.com/turnstile/troubleshooting/testing/); config do Playwright exige correspondência exata e não herda chaves de deployment. O teste de widget verifica nó anexado, estado `solved`, token e uma só carga do script. Visibilidade do host era uma expectativa incorreta para `interaction-only`; nenhum guard do produto foi relaxado.
- A tentativa local inicial do público teve 8 PASS/2 FAIL: compilação fria excedeu o tempo de navegação e a expectativa de host visível reprovou. O runner local da UI não chegou ao navegador: o aquecimento expirou com cerca de 250 MB de memória livre. Foi encerrado seu próprio servidor; nenhum processo de outro agente foi interrompido. Não foram classificados como PASS. Os gates finais devem usar os resultados reais da nova CI, registrados no PR.

O pagamento externo de **2 médicos/R$ 397** da seção 33 permanece válido e retido. Para a primeira compra de **5 médicos/R$ 838**, usar slot novo `next-checkout-five-ui-20261110`, após preflight do Preview do novo HEAD. O slot anterior `next-checkout-five-20261110` contém somente preparação local sem Auth/checkout e fica preservado; não reescrever seu SHA. O pedido atual autoriza criar uma única fixture/checkout Sandbox de 5 médicos. **Pagamento hospedado, webhook e liberação de cinco vagas só recebem PASS depois da confirmação real.** Não repetir o pagamento de 2 médicos apenas para reproduzir um resultado já comprovado.

### Fontes externas e produção

Reconsultadas em 10/11 as referências oficiais de [assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference), [CLI](https://docs.abacatepay.com/pages/cli/overview), [eventos](https://docs.abacatepay.com/pages/webhooks/events/subscriptions) e [segurança](https://docs.abacatepay.com/pages/webhooks/security). Secret privado de webhook + HMAC do raw body continuam obrigatórios; retorno do navegador não libera acesso. O simulador documentado continua limitado a cobranças transparentes. Não inventar simulador de assinatura/renovação nem usar Pix avulso para provar recorrência.

A modalidade de aquisição implementada ainda é `abacatepay_sandbox`, recusada em Production. Composição live/cohort, garantias/controle de URL reutilizável, recuperação de renovação inteiramente sem evento, operação MFA/alerta e aceites R1–R4 continuam gates próprios. Não foram ativados nem dispensados por esta rodada. A aplicação e o desembolso real permanecem proibidos.

A consulta do índice web de `/precos` devolveu conteúdo antigo; ela foi descartada como prova do estado atual. **GETs HTTP diretos em 10/11 às 15:35 UTC** retornaram 200 na home e em `/precos`, com **14 dias/até 5 médicos**, sem os textos de 7 dias/10 profissionais/equipe ilimitada. Os limites públicos estão coerentes nesse recorte. Na ativação futura, conferir também a jornada sem cartão e as restrições do trial; o Asaas citado para cobranças de pacientes permanece pertinente e não deve ser removido por trocar a assinatura SaaS. Nenhuma alteração/publicação no repositório da landing foi feita nesta frente.

### Resultado da primeira CI desta composição

O commit `01a3af71`, [CI 42846932199](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42846932199), passou nos **6.897 testes unitários**, tipos/lint, build, arquitetura e segurança. O navegador teve **10 PASS / 8 FAIL / 0 SKIP**: os dois testes Turnstile antes ignorados passaram. Os oito casos de planos chegaram ao destino sintético, mas a resposta HTML do próprio teste omitia `charset=utf-8`; o relatório registrou o título com acentos corrompidos, diferente do texto esperado. Corrigido somente o Content-Type da resposta sintética, mantendo as asserções de preço, capacidade, cliques e navegação. Um ensaio Chromium com HTTP loopback passou **2/2**: reproduziu a corrupção sem charset e conferiu o título exato com UTF-8; não substitui o E2E completo. Não foi necessário alterar o runtime para essa falha. O resultado final depende da CI do commit corretivo; não registrar os oito casos como PASS antes dela.

O preflight externo do mesmo Preview passou pelas provas de runtime DEV, Auth, cinco produtos Sandbox e webhook, mas parou na conexão canônica do banco DEV com `CONNECT_TIMEOUT`. Uma consulta HTTP somente de leitura ao catálogo DEV também respondeu **503**; porta TCP acessível não comprova serviço PostgreSQL operacional. Causa ainda não estabelecida. Nenhuma identidade, clínica ou checkout novo foi criado. Repetir somente a prontidão após recuperação do DEV, preservando o pagamento histórico e os manifestos existentes. Isso é bloqueio de ambiente, sem evidência de regressão financeira causada por esta alteração visual.

## 37. DEV recuperado, inventário financeiro e lote sob pedido — 10/11/2026

**Orientação mais recente:** preparar as compras pendentes e aguardar **“crie os checkouts”**. Substitui o pedido anterior de criar imediatamente cinco médicos. Nenhuma nova identidade, clínica, assinatura, cobrança ou checkout foi criada nesta rodada. A compra de dois médicos/R$ 397 permanece paga e retida. O lote pendente é Consultório/R$ 197 e Clínica com 3/R$ 544, 4/R$ 691 e 5/R$ 838. [Roteiro e slots](PROXIMO-CHECKOUT-SANDBOX.md).

### Causas e recuperação de DEV

- O HTTP503 foi localizado no **PostgREST do Supabase DEV**, código `PGRST002`, schema cache indisponível; resposta fresca, não erro de checkout AbacatePay. O founder confirmou a Data API desativada, ativou e salvou no painel. Após a intervenção dele, leitura REST do catálogo passou **HTTP200, cinco planos**. A engenharia não alterou configuração, role, cache, credencial ou Production.
- O timeout PostgreSQL anterior recuperou em leituras canônicas repetidas. Não há prova de sua causa histórica, nem de que fosse causado pela Data API desativada. Na observação atual: `max_connections=60`, cinco conexões idle, uma ativa, **zero lock aguardando**, authenticator habilitado e duas sessões PostgREST idle. Não foi aumentado timeout para ocultar o problema.
- Conferência de privacidade após ativação: schema privado `billing_gateway` não exposto; HEAD anônimo a profiles/patients **401**, zero registros lidos. Amostra de oito requests do Preview: seis provas assinadas 200, dois probes negativos 401, sem 503 nessa amostra. Isso não afirma ausência de erro em todo o histórico.
- O GET autenticado de lojas AbacatePay retornou **200 em 912 ms**. Recuperação observada não prova disponibilidade permanente. O operador conserva o bloqueio seguro em falha remota.

### Compatibilidade com trabalho paralelo

O DEV passou de 143 para **144 migrations**: a nova entrada corresponde exatamente à `0143_tiss_catalog.sql` da branch TISS (`9f9b483a…`, timestamp1794330000000). Revisada somente de leitura: três tabelas de catálogo, índices, RLS e grants, sem alterar tabelas financeiras existentes. Nenhum arquivo/migration TISS foi copiado, editado ou aplicado pela engenharia financeira.

O operador antes exigia contagem 143 e última0142, bloqueando essa adição independente. Agora confere os **sete hashes/timestamps financeiros 0136–0142**, rejeita ausências, duplicações e deriva, e permite somente o apêndice TISS **exato** revisado. Não foi trocado por um permissivo `>=143`. Preflight real passou com144, runtime DEV assinado, Auth de fixture, cinco produtos devMode, webhook na mesma release e segredo inválido 401. Os seis hashes DEV históricos já conhecidos permanecem preservados; a checagem operacional não substitui aquela auditoria completa.

### Implementação e testes novos

- Operador/session: compatibilidade estrita acima, **nove testes novos** (50 no arquivo), incluindo deriva do SQL financeiro, apêndice desconhecido/adulterado, duplicação e contagem inexplicada.
- Auditor Vercel somente leitura: metadata `decrypt=false`, schemas que descartam valores antes de qualquer relatório, precedência de branch e isolamento de ambiente. **Seis testes** incluem canários de segredo, conflito e ausência de herança Production. Leitura real de **52 variáveis relevantes**, sem valor decifrado nem configuração alterada. [Explicação, consumidores, finalidade, escopos e proveniência](AUDITORIA-VARIAVEIS-VERCEL.md).
- Rota de seleção: nove casos de quantidade arbitrária/inválida retornam400 sem writer. Consultório com um médico continua válido; não se aceita campo `doctors` enviado pelo navegador para alterar o preço/plano.
- Comentário obsoleto da rota signup/checkout corrigido para distinguir trial sem cobrança da candidata e checkout Asaas legado. Sem mudança de runtime financeiro.
- **56/56** nos dois arquivos de operador/auditor; **2.247/2.247 em 125 arquivos** na regressão financeira/cadastro/rotas/adaptadores. Não somar contagens sobrepostas nem representar HTTP sintético como pagamento externo. TypeScript/lint/formato e inventário são executados no fechamento do incremento; os checks remotos próprios do novo HEAD ficam no PR #53.

### CI comprovada e limite externo

O corretivo anterior `fd90ded7` fechou a [CI 42851519029 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42851519029): **6.897/6.897**, build, tipos/lint, arquitetura, segurança/isolamento e **18 E2E PASS / zero SKIP**. São oito UI com HTTP controlado e dez públicos; os dois Turnstile antes ignorados passaram com o par público oficial isolado. Não comprova chaves reais de Production. O erro UTF-8 da resposta sintética da seção 36 foi corrigido mantendo as asserções.

O preparo histórico `next-checkout-five-ui-20261110` passou em `fd90ded7`, run `b717a123-ec3d-47f7-9d41-79b24624dc53`, sem userId/checkoutId. Como o novo incremento terá outro SHA, seus quatro slots finais serão preparados no Preview imutável final, preservando os anteriores. A fase efetiva e o readback do preparo ficam no checkpoint do PR; criação somente sob a frase combinada. Não haverá segundo pagamento de dois médicos.

[Inventário completo dos fluxos SaaS, legados, pacientes e registros manuais](INVENTARIO-FLUXOS-FINANCEIROS.md) e [evidência sanitizada de prontidão/CI/privacidade](evidencias/prontidao-dev-lote-20261110.json). Renovação, mudança após pagamento, falhas/retentativas e refund/disputa não viram compras iniciais para receber PASS. B1–B4 e composição live/cohort permanecem próprios; Production continua NO-GO financeiro, PR draft e sem merge. As quatro exclusões antigas de vídeos permanecem alheias e fora dos commits.

## 38. Cinco contratações iniciais homologadas — 11/11/2026

O founder autorizou criar os quatro pendentes e informou **“todos pagos”**. As quatro verificações terminaram PASS no Preview imutável de runtime `6b89b9e2`. A compra de dois médicos da seção 33 foi preservada sem novo pagamento. [Evidência consolidada, IDs, horários, fontes e limites](evidencias/checkouts-lote-20261111.json).

| Jornada mensal | Valor | Checkout / pagamento | Webhook / assinatura / invoice | Médicos + administrativos | UI / segurança | Evidência |
|---|---:|---|---|---|---|---|
| Consultório | R$ 197 | PASS / PAID | PASS / ativa / 1 paga | 1 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 2 médicos | R$ 397 | PASS histórico; não repetido | PASS histórico / ativa / 1 paga | 2 + até 3 | PASS histórico 1440/390 e 409 | 10/11, seção 33 |
| Clínica 3 médicos | R$ 544 | PASS / PAID | PASS / ativa / 1 paga | 3 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 4 médicos | R$ 691 | PASS / PAID | PASS / ativa / 1 paga | 4 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 5 médicos | R$ 838 | PASS / PAID | PASS / ativa / 1 paga | 5 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |

### Prova externa efetivamente executada

Preflight real confirmou DEV/Auth assinados, 144 migrations com apêndice TISS exato, loja e cinco produtos devMode/BRL/mês/preços aprovados e webhook na mesma release. Antes da criação, os quatro slots não tinham identidade/checkout; cada jornada criou uma operação e manteve zero invoice/acesso pago antes da confirmação. Foram usados somente Sandbox e identidades sintéticas retidas com DPAPI/ACL privada. Nenhuma cobrança real, pagamento pelo agente, alteração de Production, migration ou edição do worktree TISS.

Após o pagamento humano, o operador confirmou PAID integral, produto/cliente/externalId e assinatura remota única ACTIVE por checkout, cartão e ausência de trial nativo. No DEV: assinatura ativa, um evento autenticado aplicado, uma invoice paga no valor exato, tentativa/receipt únicos e trial liberado. Datas do período coincidem com a âncora aprovada do Qoro; não são prova de próximo vencimento fornecido pela API. Nova sessão de navegador conferiu a UI paga em 1440/390, retirada dos bloqueios temporários de WhatsApp/Asaas/convite e HTTP409 `already_paid` sem nova operação. Não houve conexão ou convite externo.

As cotas persistidas são 1/3/4/5 médicos e até 3 administrativos nas respectivas fixtures. O teto sob concorrência/CRM e alterações de plano conserva a prova PostgreSQL anterior de 85 checks, com HTTP sintético; não foi confundido com convite real. Nova conferência READ ONLY das quatro invoices provou o próprio registro visível em 4/4 contextos e **12/12 leituras cruzadas negadas** usando o `withTenant` canônico/role authenticated. Invoice, receipt, período e provider conferidos; nenhum ID Asaas foi usado.

### Falhas encontradas, recuperação e correção

1. O request API do E2E não herdava o bypass já instalado na navegação; era redirecionado ao SSO e recebia HTML200 da Vercel. Corrigido somente o header do GET de mesma origem no spec. Segredo não é enviado ao checkout externo; proteção do produto não foi relaxada. Quatro criações e quatro verificações pagas passaram pelo navegador após a correção.
2. Consultas locais ao provedor tiveram `UND_ERR_SOCKET`. Um helper ignorado repetiu **somente GET real uma vez**, nunca POST financeiro. Indisponibilidade histórica não foi atribuída a uma causa de rede sem prova.
3. As contratações de 4 e 5 médicos tiveram inbox recebido e `authoritative_readback_failed` em duas tentativas. Enquanto isso, nenhuma invoice/acesso pago foi liberado. A **terceira tentativa automática** aplicou o evento: 4 médicos às 10:25:52.636142 UTC e 5 às 10:26:24.734665 UTC, cerca de 5m16s após o recebimento. Não houve replay manual nem mudança artificial de status. Essa latência é evidência real de recuperação, não de disponibilidade instantânea; a causa subjacente da falha remota não foi estabelecida.
4. Diagnósticos de login atingiram o limite de 5/15min de uma fixture; aguardou-se o prazo sem apagar Redis, trocar senha ou relaxar guard.

### Novos testes e regressão pertinente

O harness existente ganhou dois cenários de atomicidade: falha de INSERT da invoice e falha na liberação de cota. Em Postgres loopback descartável com 143 migrations reais, cada falha conserva zero invoice/receipt/tentativa e vínculo não ativado; retirar apenas a falha sintética permite repetir a conciliação real uma vez, sem outro POST cobrante. **20/20 checks PASS**, 424 chamadas HTTP sintéticas, 20 tentativas POST sintéticas e **zero rede externa**. Inclui os 18 anteriores; não são 20 novos testes. Os 85 checks de ciclo de vida continuam aplicáveis porque o runtime financeiro não mudou.

Baseline CI `6b89b9e2`: [42872281354 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42872281354), **6.921 testes e 18 E2E, zero SKIP**. TypeScript/lint/formato/inventário e CI próprios do incremento são registrados no fechamento do PR #53. Nenhum resultado da baseline é apresentado como execução do commit novo. A branch só é publicada depois de conciliar as quatro fixtures, preservando o SHA do manifesto e o destinatário do webhook durante os pagamentos.

### O que permanece

Não há outro pagamento inicial humano pendente. Manter as fixtures e não pagar links antigos. Os cinco PASS são de **primeira contratação Sandbox**. Renovação natural/change-plan/falha recorrente/refund/disputa sem simulador oficial continuam com prova local e limites externos explícitos. Permanecem B1 (URL reutilizável), B2 (ciclo sem qualquer evento), B3 (ciclo externo), prova operacional admin/MFA/alerta e implementação live/cohort. **PR #53 draft; NO-GO para ativar AbacatePay em Production.** Não houve merge/deploy/configuração de Production nem repricing de contratos legados.

## 39. Operação contínua, contrato atual do provedor e controles — 11/11/2026

Baseline remota d9180228/CI 43005109295 confirmada, PR #53 draft; main continua 5620a098. As cinco compras da seção 38 foram preservadas, sem outro checkout/pagamento. [Evidência desta rodada](evidencias/operacao-continua-20261111.json). Não há escrita em Production, configuração Vercel, merge, alteração TISS ou migration remota.

### Implementado e validado localmente

- GET transitório: opt-in de duas tentativas para rede/502/503/504, espera de 100 ms e orçamento compartilhado de 20 s no primeiro readback. POST nunca é repetido; 401/403/429, resposta inválida e erro de vínculo não recebem retry curto. Retentativa do inbox continua cumulativa, máximo 10; lease expirada não concede direitos e agora pede recuperação em vez de relatar revisão como encerramento.
- Diagnóstico: métricas com código sanitizado, HTTP, tentativas, duração e idade do evento. Erros de revisão/esgotamento e ativação concluída após 120 s acionam captura Sentry. Persistência/conflito de webhook autenticado também geram captura; tráfego não autenticado fica em métricas para não gerar alerta por requisição de atacante.
- Aquisição: kill switch e cohort exato de UUIDs no servidor, antes de qualquer operação nova. Cancelamento/reconciliação/webhooks existentes continuam habilitados. UI explica notificação em verificação, oferece atualização sem POST financeiro e oculta nova contratação nesse estado; pausa de aquisição tem feedback próprio.
- Sentry server/edge distinguem VERCEL_ENV=preview de production. NODE_ENV=production do build deixava os dois indistinguíveis. A alteração é candidata, não deploy em produção; SDK preserva scrub/PII.

### Nova evidência oficial e incompatibilidade corrigida na candidata

O [índice oficial atual](https://docs.abacatepay.com/llms.txt) e a [fonte atual do GET](https://github.com/AbacatePay/documentation/blob/main/pages/subscriptions/get.mdx) agora documentam currentPeriodStart/currentPeriodEnd/nextChargeAt. **GETs reais HTTP 200** nas fixtures Consultório e Clínica 5 confirmaram os três campos, com datas 2026-11-11/2026-12-11/2026-12-11. Não são horários nem autorização para substituir o calendário Qoro aprovado. O leitor passa a validar essas datas como metadata; a próxima cobrança não é pagamento confirmado.

A [documentação de eventos](https://docs.abacatepay.com/pages/webhooks/events/subscriptions) atual diz que o checkout original permanece nas renovações; isso difere da resposta histórica do suporte. O leitor e o ledger antigos recusavam esse modelo por exigir bill distinto e UNIQUE(account_id,checkout_id). A candidata aceita também o modelo com checkout original **somente** com período posterior ao inicial e receipt de cartão exato/novo, preservando o caminho anterior e o calendário Qoro. Prova ausente/contraditória continua em revisão.

O [SQL candidato](migrations/saas_period_snapshot.candidate.sql) adiciona datas auditáveis e substitui a unicidade por checkout pela combinação existente de pagamento/extrato e período. Mantém RLS e snapshots imutáveis. **Não está no journal nem em DEV/Production**: PR #55 avançou para 0143–0146 (head 4fb419f8 no readback), então não foi inventado um prefixo livre, copiada migration ou feito merge entre agentes. Em N/N-1, o novo modelo permanece em revisão se o schema adicional não existir. Não basta publicar este código para liberar renovação do contrato novo.

**Atualização B1:** a [fonte oficial atual de exclusão](https://github.com/AbacatePay/documentation/blob/main/pages/subscriptions/checkouts-delete.mdx), consultada diretamente nesta rodada, agora afirma que o link para de aceitar pagamentos e que a assinatura gerada continua ativa. Não é necessário repetir essa pergunta ao suporte. Ainda falta comprovar o fechamento de um checkout pago e os readbacks posteriores, pois a conciliação consulta esse recurso. Nenhum checkout pago foi excluído e nenhum comando automático de fechamento foi ativado por suposição. A janela anterior ao webhook também continua exigindo contenção/monitoramento de duplicidade remota.

### Renovação totalmente sem webhook

O monitor agora compara o período remoto autenticado com o local e abre incidente provider_period_ahead, mesmo com **zero evento no inbox**. O teste comprova que não fabrica webhook, invoice, pagamento ou extensão de acesso. **Detecção PASS local; recuperação financeira automática ainda não implementada.** A trilha atual exige evento autenticado como origem: substituir essa origem por prova de extrato requer um ledger/readback específico, migração coordenada e provas de associação inequívoca. Não foi inferida uma cobrança por valor/data/ACTIVE. Evento já recebido continua recuperável por worker/releitura autorizada.

### Latência e limites mensuráveis

Antes, 4/5 médicos tiveram 316,13/316,39s entre inbox e aplicação, três tentativas reais. Logs Vercel foram obtidos: quatro falhas genéricas de readback/transação, sem HTTP/causa preservados; não é possível afirmar retrospectivamente timeout, HTTP503 ou consistência eventual. Depois da correção, testes PostgreSQL com falha de rede/HTTP503 sintéticos recuperam na primeira lease; durações exatas estão no JSON. **Esses milissegundos locais não comprovam melhoria externa nem P95 do provedor.** Não repetimos pagamentos.

Meta técnica proposta: confirmação saudável em até 30 s após inbox, leituras limitadas a 20 s; sinal de atraso quando aplicação exceder 120 s, e revisão/alerta ao esgotar tentativas. O sinal de atraso ocorre na próxima execução/conclusão; não é temporizador autônomo de 120 s. Backstop atual continua cron diário às 09:00 UTC; redelivery observado demorou cerca de 5 min. Ainda não existe SLA de detecção/ativação em 120 s nem observação externa após a correção. Volume, fila e destino do alerta precisam de ensaio operacional antes do piloto.

### MFA, alertas e prova real

DEV somente leitura: 2 operadores ativos, 2 marcados MFA e 2 fatores nativos verificados, sem divulgar identidades. AAL2+TOTP atual na ação administrativa permanece coberto por testes; **login/reprocessamento interativo não executado**. O próprio usuário da API GitHub não informou two_factor_authentication; não se presume desativado. Vercel/AbacatePay/MFA de outros serviços não foram inferidos a partir do MFA Qoro.

Sentry administrativo retornou 401. Foi enviado **um** envelope sintético preview, sem paciente/pagamento, aceito HTTP 200 em 11:43:25  UTC: evento fc2862ce570d48c6966747db2022aa5b. Isso comprova ingestão no projeto, não envio de e-mail/Slack, configuração da regra ou recebimento pelo responsável. O probe não passou pelo webhook financeiro nem foi chamado de pagamento real. [Procedimento do responsável](../../runbooks/abacatepay-operacao.md#8-fechamento-operacional-de-11112026).

### Qualidade e estado

PASS **29/29** checks de checkout/recuperação, 143 migrations reais, 553 chamadas HTTP sintéticas e zero rede externa; inclui os 20 anteriores, 24 replays concorrentes e dois erros transacionais. PASS **92/92** checks de ciclo de vida/segurança: 143 migrations reais **mais o SQL candidato local**, 352 chamadas sintéticas, zero rede externa; inclui 85 anteriores, detecção sem evento, N/N-1, preservação de dados/RLS e duas renovações no mesmo checkout sob concorrência. Não somar essas contagens a testes unitários. Passaram **965 testes dirigidos em 53 arquivos** na regressão final; as verificações anteriores de alerta/ambiente são sobrepostas.

A primeira execução nova de fixture usou um nome incorreto de enum; corrigida a preparação sem retirar asserções. Uma edição do sinal de atraso foi detectada fora do escopo pelo TypeScript e pela regressão; movida para o observador correto e repetidos os gates afetados. Não são falhas de Production. Quatro novos E2E desktop/mobile exercitam pausa e processamento sem POST em harness isolado; resultado do build/CI do novo commit é registrado no PR, sem herdar a CI anterior.

**PARTIAL / NO-GO financeiro Production.** Restam: registrar/aplicar schema candidato após coordenar 0143–0146; completar recovery financeiro sem nenhum evento sem criar origem fictícia; fechamento remoto do link com histórico/readbacks preservados; MFA operacional e recebimento do alerta; composição live e rollout autorizado. Controles de cohort/kill estão implementados na composição Sandbox; **não** existe seletor live nem ativação automática em Production. Nenhum risco foi aceito em nome do founder.

### Regressão no Preview do código novo

O commit `68de428c` gerou [Preview READY](https://project-6xv2jd9kf-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura). Uma execução Chromium com a fixture sintética Clínica 5 já paga passou: login real, readback autenticado da invoice/pagamento/inbox, UI em 1440/390 px, tentativa de nova compra recusada HTTP 409 e gates de integrações/convite liberados. Não houve novo checkout, pagamento ou evento financeiro; os registros pagos históricos foram relidos. O manifesto histórico não foi modificado. Os quatro E2E de processamento/pausa pertencem ao harness isolado da CI e são provas separadas. O resultado final da CI fica nos checks do PR #53; esta evidência não herda os números do commit anterior.

## 40. Retorno do founder sobre Sentry e classificação do browser — 11/11/2026

O founder localizou o probe na Issue **7842026780**, com o mesmo horário/flow/run ID da seção 39, e esclareceu que o viu **somente no painel**, sem notificação fora do Sentry. Visibilidade do evento: PASS por evidência fornecida pelo operador. Roteamento/recebimento: ainda não comprovados; não confundir com ingestão HTTP 200 ou completar esse gate por suposição.

Os outros registros fornecidos são distintos: **7590707702**, de 09/11, é CONNECT_TIMEOUT no dashboard de localhost, environment=development; comprova falha de conexão naquela execução, não a causa de rede/pool nem uma falha atual em Production. **7730223576**, de 04/11, veio de uma URL de Preview e contém React #418 seguido de parentNode; o primeiro identifica falha de hidratação segundo a [referência oficial React](https://react.dev/errors/418), mas a causa específica e a relação causal exata com parentNode não foram reproduzidas. Não suprimir erros nem aumentar timeouts globais por inferência.

Foi confirmada uma falha de classificação no código atual: o SDK do navegador usava NODE_ENV, que é production também no build de Preview. A candidata passa a usar **NEXT_PUBLIC_VERCEL_ENV**, metadata pública automática da Vercel para Next.js, com fallback local; [contrato oficial](https://vercel.com/docs/environment-variables/framework-environment-variables#next_public_vercel_env). Não houve configuração de env/deploy ou inclusão de segredo. Schema e registro público/inventário foram atualizados; scrub, ausência de PII e Session Replay desligado foram preservados. **58/58 testes afetados PASS**, incluindo 8 de ambiente, sanitização e headers. Esses testes se sobrepõem aos testes anteriores e não devem ser somados.

O E2E de fixture paga agora registra somente categorias sanitizadas de erros não tratados do navegador e reprova hidratação/parentNode ou outro erro não tratado. Sua execução na nova versão do Preview e a CI final são registradas nos checks/corpo do PR #53. Não é correção comprovada da origem do erro histórico nem homologação nova de pagamento.

## 41. Recuperação financeira e fechamento preparado — 11/11/2026

Baseline preservada: `a5984e2316c596cb4228ae37daa47b1ef4036872`, [CI 43020053694 SUCCESS](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43020053694), 6.971 testes e 22 E2E/zero SKIP. O incremento desta seção tem provas próprias; não herda a aprovação da baseline. Nenhum novo checkout, pagamento, SQL remoto, merge ou mudança de Production. As quatro exclusões antigas de vídeos continuam fora do trabalho financeiro.

### Recuperação financeira sem evento

Implementados `abacatepay-renewal-recovery.ts` e `abacatepay-renewal-source.ts`. O cron existente pode descobrir uma renovação por **GETs autenticados**: loja, produto, assinatura exata, vínculo único do checkout e extrato paginado. Exige cliente exato, cartão aprovado integral, payment/statement novos e período pago posterior ao inicial. Não consulta uma API inexistente de faturas por assinatura. Datas ou ACTIVE sozinhos não concedem acesso. Mais de um receipt, ambiente, valor ou vínculo divergente exigem revisão.

A origem independente fica em `billing_gateway.renewal_api_readbacks`, privada, imutável, com hash canônico e FKs. Não é criada uma linha fictícia no inbox. A observação aceita exatamente **uma** origem: webhook autenticado ou readback da API. Invoice, pagamento, ledger, plano/cotas e período são aplicados na mesma transação; falha reverte o conjunto. O calendário original do Qoro permanece. Um ledger já pago só repara seu período local exato após conferir invoice, valor, datas e tentativa confirmada; não cria outro mês nem invoice.

A revisão encontrou uma corrida ao adquirir lock e ler joins de plano na mesma instrução: uma consulta que aguardou podia conservar a visão antiga do join. Agora o lock da assinatura precede a leitura do contexto, e ambos os caminhos usam a mesma ordem. Os 12 processamentos concorrentes da troca de plano voltaram a produzir uma aplicação e 11 duplicatas. Nenhuma asserção foi retirada.

O novo worker faz no máximo uma descoberta por chamada, duas tentativas por GET, timeout por leitura de 1,5s e orçamento total de 12s. Não inicia sem orçamento nem sem o novo schema. O cron atual é diário e compartilha orçamento com Asaas/inbox/gestão; **não promete recuperação imediata ou processamento ilimitado**. A capacidade/frequência de um piloto real precisa de dimensionamento e autorização operacional. Não houve alteração da agenda nem custo.

**Limites:** o modo atual recupera um receipt inequívoco no período remoto atual. Ausência das datas, múltiplos recibos, ciclos antigos não enumeráveis e associações ambíguas continuam para revisão humana. Não há override administrativo para marcar como pago. Sem o SQL coordenado, o novo worker fica inativo e o modelo de renovação com checkout original continua em revisão.

### Checkout consumido e fechamento

O ledger `paid_checkouts` e a invoice paga continuam sendo a prova de consumo local. Um novo `subscription.completed` da mesma assinatura/cliente já consumidos é reconhecido sem recriar invoice ou ativar direitos, mesmo depois de apagar o link remoto. Mais de uma assinatura remota ou outra identidade gera revisão.

Preparado `closeConsumedAbacatePayCheckout`, exclusivamente interno e Sandbox. Ele exige geração paga vinculada, invoice/valor corretos e schema adequado, confere o recurso e a assinatura, reserva `close_paid_checkout` no journal durável e usa o [endpoint oficial de exclusão](https://docs.abacatepay.com/pages/subscriptions/checkouts-delete). Depois confere que a assinatura sobreviveu. Resposta perdida, divergência ou falha do journal permanecem `unknown`; **não há segundo POST automático**. Snapshot/resultados ficam preservados. Não remove ledger, invoice, binding, assinatura nem histórico local.

As leituras de renovação, prova do ciclo para mudança de plano e refund do checkout original podem usar a geração local consumida, mantendo a consulta real de assinatura/produto/extrato e cliente. Não inventam um status de checkout quando ele deixou de existir. Refund de ciclo sem associação inequívoca continua em revisão, sem revogar o período pago.

**O comando não foi conectado ao cron nem disparado contra as fixtures retidas.** A invalidação remota e os GETs posteriores ainda precisam do ensaio externo específico. Os testes locais abaixo não são prova de exclusão real, recibo público disponível ou futura renovação no provedor. O intervalo antes do webhook ainda pode permitir outro pagador remoto; o monitor de multiplicidade continua necessário. Não existe garantia nativa de link de uso único.

### Schema financeiro e TISS

Readback DEV: 144 entradas, com `0143_tiss_catalog` exata (`when=1794330000000`, hash `9f9b483a…`). Nenhuma 0144–0147 nem candidato financeiro aplicada pelo executor. Financeiro conserva journal 0–142. O TISS avançou localmente para `9382c4629d873dc6d2cdbec3ff045a7539ccff0d` durante esta rodada; 0143–0147 estão ocupadas. A branch remota deve ser conferida de novo no momento da integração.

O SQL permanece em `migrations/saas_period_snapshot.candidate.sql`, **sem número e fora do journal**, com período/proveniência privados e ampliação aditiva da categoria de operação. Não se alterou nenhuma migration já aplicada.

O harness `abacatepay-tiss-schema-db.ts` passou **5/5**: financeiro→TISS, TISS→financeiro, rollback dos dois ensaios e identidade/ordem do histórico comum. Confere schema, constraints, RLS, catálogo de planos/preços e ausência de escrita no worktree TISS. Não prova toda a funcionalidade TISS nem equivale a aplicar migrations no histórico remoto.

**Estratégia recomendada:** preservar integralmente 0143–0147 e seus timestamps/hashes; preparar revisão/merge do PR53 antes do PR55 sem aplicar o candidato isoladamente. Na integração autorizada, construir um journal único 0–147 e só então registrar o financeiro na próxima posição realmente livre, com `when` posterior ao último TISS. Não assumir que 0148 continuará livre. A ordem de merge de código não precisa coincidir com a ordem de aplicação SQL. Nunca aplicar um timestamp financeiro mais alto e depois tentar inserir TISS com timestamps antigos: o migrator pode ignorá-los. Se o financeiro tiver que ir ao DEV antes do TISS, será necessária uma alocação conjunta diferente dos **ainda não aplicados**, com novo ensaio; não renumerar silenciosamente o trabalho do outro agente.

Pré/postflight, impacto e recuperação estão no runbook §9. Falta autorização específica do founder para o schema reconciliado no DEV; não há SQL que ele precise executar manualmente agora.

### Operação, Sentry e MFA

A ingestão/visibilidade do probe Issue7842026780 está comprovada pelo provider e pelo founder. O founder confirmou **nenhuma notificação externa recebida** e depois informou que **só existe regra de erros em Production**; ele criará a de Preview quando voltar. API administrativa continua HTTP401; inventário do navegador nesta rodada retornou `browser access host is unavailable`/native pipe indisponível. Nenhuma regra, destinatário ou MFA foi alterado e nenhum probe repetido. O [runbook §10](../../runbooks/abacatepay-operacao.md#10-ações-humanas-que-continuam-necessárias) contém os controles e rótulos atuais para criar a regra Preview sem duplicar ou alterar Production, testar a ação e só depois testar o disparo real.

O Sentry de cliente/server/edge conserva a correção de identificação de Preview e os testes da baseline; não houve alteração nesses arquivos neste incremento. Isso não corrige retrospectivamente a causa de hidratação da Issue7730223576, que não foi reproduzida. A causa do CONNECT_TIMEOUT local da Issue7590707702 continua indeterminada.

Readback DEV em 11/11: 2 superadmins ativos, 2 com MFA marcado e 2 fatores nativos verificados. Os controles de AAL2/TOTP e os testes de RBAC permanecem. A jornada interativa e MFA de cada provedor externo exigem a conferência do titular; nenhum token foi usado para contornar MFA.

### Resultados e decisão

- PostgreSQL loopback: **115/115**, 143 migrations reais mais candidato, 537 chamadas HTTP sintéticas, **zero rede externa**. Preserva os 92 anteriores e acrescenta descoberta sem evento, oito workers concorrentes, webhook posterior, invoice ausente, período local desatualizado, rollback/retry, ausência de prova, tenant incorreto, RLS, fechamento/timeout e leitura posterior de renovação/plano/refund. Fonte: `scripts/security/abacatepay-renewal-db.ts`.
- SQL financeiro/TISS: **5/5**, conforme escopo restrito acima. Fonte: `scripts/security/abacatepay-tiss-schema-db.ts`, com `QORO_TISS_WORKTREE` apontando para a cópia autorizada somente leitura.
- A [CI 43033198873 do código 6dbfe46a](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43033198873) passou **7.005/7.005 testes em 623 arquivos**, cobertura, TypeScript, lint, arquitetura, inventário, isolamento, build, bundle e HTTP. São 34 testes a mais que os 6.971 da baseline. O job terminou por timeout na instalação do Chromium: logs registram `Temporary failure resolving` nos repositórios Ubuntu; os E2E remotos dessa execução não rodaram. Isso não é aprovação integral da CI nem reprovação do código financeiro. Os 22 E2E locais passaram separadamente. O fechamento editorial seguinte altera somente documentação; os checks próprios do HEAD final continuam no PR53, sem inventar uma execução aprovada.
- O [Preview imutável 6dbfe46a](https://project-qouiqh791-clinic-os-v2-s-projects.vercel.app) ficou READY e passou regressão autenticada em 1440/390 px, usando a fixture Clínica 5 já paga: login, readback DEV, invoice/período/cotas, compra repetida recusada HTTP409 sem nova operação e nenhum erro não tratado do navegador. Não houve novo checkout, pagamento, webhook ou convite. A leitura de 18 bundles confirmou inicialização Sentry Preview e nenhuma Production; cliente/server/edge mantêm os testes de ambiente já aprovados. Os registros financeiros históricos foram relidos, não apresentados como nova entrega.

**NO-GO para ativar AbacatePay em Production.** Engenharia deste incremento preparada/testada localmente; aplicação integrada do schema e prova externa do fechamento ainda pendentes. Também permanecem: notificação efetivamente entregue, MFA operacional, eventos recorrentes externos não simuláveis e composição live revisada. Nenhum requisito de aceite foi removido. Trial, preços, cotas, cancelamento, contratos legados e cobranças de pacientes Asaas permanecem preservados. O trabalho não exigiu novo pagamento humano.

## 42. Continuidade com branches independentes — 11/11/2026

**Escopo ajustado pelo founder durante a execução:** não misturar migrations com o outro agente. Ele confirmou a escrita da 0149 TISS. Nenhum arquivo/journal TISS foi importado, renumerado ou alterado pela frente financeira; o candidato financeiro continua separado, sem número. Não houve SQL no DEV compartilhado, merge, mudança em Production, pagamento, fechamento remoto ou novo probe Sentry.

### Correção e novas provas financeiras

Foi reproduzida uma lacuna de observabilidade em três testes unitários: falhas na leitura do schema, na seleção do candidato e na auditoria de erro podiam propagar ao cron sem captura no flow financeiro específico. O cron ainda podia registrar a falha geral; não era prova de ausência completa de telemetria. A correção envolve o worker numa fronteira que emite erro sanitizado e métrica sem tentar acessar novamente o banco, e relança a exceção original. Não altera a regra financeira nem transforma falha em sucesso. Os três testes reprovaram antes e passaram depois; dois testes adicionais preservam o estado inativo sem schema/Sandbox.

O PostgreSQL descartável passou **120/120** (115 preservados + 5 novos), com 143 migrations financeiras reais e o candidato SQL local, zero rede externa. Novos cenários: falha na aplicação da cota de três médicos com rollback de origem/invoice/plano, retry com uma invoice e teto real de três; interrupção da auditoria operacional após commit sem repetir o ciclo; receipt antigo após período mais recente; operadores inativo e excluído logicamente recusados pelo banco. O comando de mudança de plano não foi chamado pela recuperação. As cinco compras externas anteriores permanecem intactas.

Os primeiros ensaios novos tinham duas falhas de preparação: tentativa de agendar mudança num período já vencido (corretamente recusada pelo produto) e fixture HTTP presa ao valor de R$ 397 em vez de R$ 544. Foram corrigidos somente o estado sintético histórico e a resposta HTTP da fixture; nenhum guard/asserção de segurança foi removido. O teste histórico também exige que um ciclo já vencido seja contabilizado sem conceder acesso futuro. Os limites financeiros não foram relaxados.

### Banco, TISS e ordem futura

Readback somente leitura de 11/11, 17:00 UTC: DEV com 144 entradas, 0143 TISS com hash/timestamp exatos, 0144–0148 não aplicadas, colunas candidatas ausentes. HEAD TISS lido `3edb45328ef2ce4174ac75f804cc5add7ac24e06`, com 0148; 0149 está em elaboração em outra branch. A branch financeira preserva 0–0142. O ensaio anterior de 5 checks pertence à versão TISS até 0147 e não comprova a 0149 ainda não congelada.

Recomendação: preservar as revisões independentes; não ativar AbacatePay sem schema; depois de o responsável TISS congelar e integrar seu histórico sobre a base aprovada, preparar o SQL financeiro numa etapa separada com número/timestamp realmente livres. O [runbook §9](../../runbooks/abacatepay-operacao.md#estratégia-coordenada-com-pr55) compara as alternativas. Não reservar 0150 por suposição, compor journals nesta branch ou aplicar um timestamp financeiro alto antes das migrations TISS anteriores. A aprovação futura do DEV deve nomear a sequência e os hashes definitivos; o founder não executa SQL manualmente.

### CI, Sentry e MFA

A [CI 43036700032, tentativa 2](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43036700032), do commit `b6965447`, concluiu **SUCCESS: 7.005 testes e 22 E2E/zero SKIP**, além de build/tipos/lint/segurança/isolamento. As falhas anteriores de DNS ficam preservadas como históricas. O runner anterior era Ubuntu 26.04, imagem 20261101.186.1; o bloqueio ocorreu ao obter dependências via apt, não na execução de um E2E. Nenhuma configuração de workflow/proxy/DNS foi alterada.

Foi conferida somente a metadata da imagem oficial `mcr.microsoft.com/playwright:v1.62.0-noble`, versão correspondente ao lockfile, digest `sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07`. A imagem existe para amd64/arm64, mas não foi baixada/executada. A [documentação Playwright](https://playwright.dev/docs/docker) informa que a imagem inclui browsers/dependências de sistema e precisa do pacote correspondente no projeto. Essa é uma alternativa de contingência para avaliação conjunta se apt voltar a falhar; cache de browser sozinho não fornece as bibliotecas do sistema. Não foi aplicada nenhuma proposta ao workflow compartilhado nem tratada metadata como prova de E2E em contêiner.

Os controles MFA ganharam seis testes na ação financeira: fator não verificado, seleção do fator atual, recusa de OTP reutilizado pelo Auth, sessão perdida com nova verificação após reautenticação e falhas de contexto/cookies/listagem. São testes com I/O simulado, não uma sessão real AAL2. A prova de operadores revogados é banco real isolado. O [roteiro humano §10](../../runbooks/abacatepay-operacao.md#10-ações-humanas-que-continuam-necessárias) separa login, logout, outro dispositivo, recuperação em cofre e MFA de cada serviço. Não remover fatores de contas existentes para testar recuperação.

Sentry Preview segue sem regra/recebimento confirmados. **Não enviar probe até o founder confirmar recebimento do Send Test Notification.** Nenhum alerta Production foi alterado. O incremento usa as variáveis existentes, sem novo segredo. Os checks da CI própria do próximo commit ficam no PR53, sem atribuir automaticamente a aprovação de `b6965447` à correção nova.

### Prontidão

**NO-GO Production mantido.** A nova captura é corrigida e testada; a recuperação financeira continua condicionada ao schema ainda não aplicado. Renovação temporal externa, fechamento da fixture paga e readbacks posteriores, entrega de alerta, operação MFA interativa, composição live e autorização de janela permanecem gates distintos. Não remover Asaas das cobranças de pacientes nem migrar contratos antigos. A próxima etapa de banco depende do congelamento/acordo com TISS e de aprovação específica; nenhum pagamento humano novo é necessário.

## 43. Alerta entregue e composição SQL fixada na 0149 — 11/11/2026

### Sentry: gate Preview concluído

O founder informou a regra criada, confirmou o recebimento do `Send Test Notification` e confirmou depois **o alerta específico 414eb196**. Foi emitido um único evento sintético às **15:29:32 BRT** (18:29:32 UTC), aceito HTTP200, evento `04822f778d5649b3a0a19e28ce798236`, run `414eb196-882f-4627-bcbd-d4465e1ada5b`, `environment=preview`, flow `billing.abacatepay.sandbox_probe`. Sem pacientes/pagamentos, mudança de configuração ou evento artificial Production. **PASS para entrega operacional desse alerta Preview**, sem repetir probes.

Limite da evidência: API administrativa HTTP401 e controle visual indisponível; regras, destinatários e histórico interno não foram lidos diretamente. O recebimento do evento identificado é testemunhado pelo responsável. O emissor usa a ingestão Sentry direta, não executa uma falha real de cron/banco no deployment. Os testes da captura financeira comprovam esse caminho local separadamente; a prova não mede SLA nem entrega de todas as categorias ou ambiente Production.

### SQL e isolamento entre branches

`main` remota permaneceu `5620a0987ec53db7d7358728eb7d457d9d373df3`; PR53 em `b18407c31e0f5506ae4e049ab1857d373620c26b`, OPEN/draft, todos os checks relevantes aprovados. A [CI 43069046940](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43069046940) comprova **7.016 testes, 22 E2E/zero SKIP**, tipos, lint, build, segurança e isolamento. Esse resultado não é atribuído automaticamente aos novos arquivos de harness; o incremento exige sua própria CI.

A 0149 foi encontrada inicialmente commitada localmente em TISS `b450a560897d4004b2de305ac91c3ffa1197ec89`, ainda ausente do HEAD remoto PR55 então lido (`3edb4532`); a 0150 estava em edição e foi excluída daquela prova. Durante a rodada, o outro agente publicou a0150 e o HEAD remoto avançou para **`6b101e892e4e856c5653e7bb89a1791ce452815c`**. A comparação confirmou SQL até0149 inalterado. Depois da leitura da0150 publicada, os ensaios foram estendidos a esse snapshot exato. O novo helper exige SHA completo, só lê objetos imutáveis com `git show`, compara blobs SQL/histórico comum e confere a sequência/timestamps em memória. Aceita apenas snapshots revisados terminando em0149 ou0150; versões posteriores continuam exigindo revisão. Nenhuma migration foi copiada para a branch financeira, nenhum journal foi composto em disco/alterado e nenhum número novo foi reservado. Nenhum arquivo TISS foi escrito.

Readback DEV somente leitura atualizado em **11/11,20:49 UTC**:144 entradas;0143 TISS com hash/timestamp exatos,0144–0150 ausentes e sem conflitos de timestamp, candidato financeiro ausente. A futura aplicação exige outro preflight que inclua os commits/hashes finais e eventuais migrations posteriores. A quantidade de entradas sozinha não substitui essa verificação.

### Provas de compatibilidade e recuperação

- **21/21 verificações SQL/dados** nas duas ordens de aplicação e rollback, primeiro até0149 e depois com **151 migrations (0000–0150)** e candidato financeiro. Fingerprints incluem índices, constraints, políticas RLS, gatilhos e definições de suas funções. Preservados registros sintéticos anteriores de assinaturas Asaas/AbacatePay, invoices, agendamentos e recebíveis particulares. A extensão confere compatibilidade SQL da0150, não todo o fluxo de lotes TISS.
- Convivência dos gatilhos de trial (`AFTER INSERT`) e convênio (`BEFORE`); recebível integral de convênio recusado sem consumir franquia; agendamento anterior permanece particular. A função substituída na 0149 foi exercitada: cobertura concluída fica congelada sem pendência, correção com pendência aberta exige autor e carimba data; pendência duplicada é recusada. RLS impede leitura cruzada e acesso ao schema financeiro privado.
- **120/120 verificações financeiras com TISS0143–0149**, repetidas com **0143–0150 publicada no snapshot6b101e89**, além do candidato, em bancos descartáveis. São os mesmos cenários financeiros, não novos pagamentos ou120 cenários TISS adicionais: recuperação com/sem evento, concorrência, invoices, cotas, rollback/retry e fechamento/readbacks sintéticos. HTTP do provedor controlado e **zero rede externa**; não é homologação de renovação nem exclusão remota.
- Erros de preparação foram corrigidos sem mudar produto/segurança: slug sintético longo, corretamente recusado, uso de conexão externa ao savepoint no teste de erro esperado e runner local sem a condição `react-server` repassada ao processo filho. O savepoint mantém o erro42501 esperado; nenhuma permissão foi concedida ou teste retirado para passar. O runner foi corrigido e as verificações afetadas repetidas.

A suíte financeira passa a aceitar `QORO_TISS_REF` opcional para reproduzir o cenário composto; sem a variável, preserva a prova anterior0000–0142. Artifacts separados por snapshot evitam substituir a evidência financeira isolada ou até0149. O [runbook §9](../../runbooks/abacatepay-operacao.md#estratégia-coordenada-com-pr55) contém comandos completos e limites. Isso prova compatibilidade SQL da versão fixada, não toda a aplicação TISS nem o merge TypeScript. O índice de schema de cada branch tem exports exclusivos; a integração futura deve preservar `billing/gateway-schema` e `health-insurance/schema`, além de reconciliar handlers/eventos/env sem substituir arquivos inteiros.

### Ativação e próximos gates

SQL financeiro continua sem número, fora do journal e **não aplicado ao DEV compartilhado**. Recomendação preservada: terminar/congelar a frente TISS, concordar o histórico único e só então preparar o financeiro numa etapa posterior com posição realmente livre, hash/timestamp exatos e aprovação DEV específica. As provas nas duas ordens não autorizam executar timestamps fora de sequência no Drizzle.

Fechamento remoto de uma fixture paga continua exigindo aprovação específica; cinco compras preservadas, nenhuma compra nova. A documentação oficial da [CLI AbacatePay](https://docs.abacatepay.com/pages/cli/overview) consultada nesta rodada continua limitando o simulador a cobranças transparentes; não foi encontrado um simulador de renovação recorrente. Preservar a resposta do suporte e distinguir os eventos documentados da execução externa real. Não simular passagem anual/mensal como homologação do provedor.

MFA automatizado permanece comprovado conforme §42. O founder executou o roteiro curto no Preview `b18407c3` e confirmou “tudo ok”: **login/TOTP, acesso administrativo, logout bloqueando a página e novo login com MFA — PASS da jornada normal**. Evidência fornecida pelo operador, sem screenshot/inspeção automatizada da sessão. Não prova TOTP inválido, expiração forçada, recuperação após perda, revogação global, replay financeiro com step-up nem MFA dos serviços externos. Esses cenários mantêm a evidência automatizada anterior e seus limites. Não reprocessar fixture, remover fator ou pedir OTP. Nenhuma autenticação global alterada. **Composição live/cohort para Production continua engenharia específica pendente**, não apenas preenchimento de segredo; o runtime Sandbox segue recusando Production. Variáveis, flags, rollback e critérios de interrupção permanecem preparados, sem ativação.

**NO-GO Production mantido, com entrega do alerta Preview e jornada administrativa normal com MFA comprovadas.** Não houve merge, SQL remoto, nova cobrança, fechamento remoto, alteração de contrato ou variável Production. O próximo resultado de CI pertence ao SHA publicado deste incremento e será registrado no PR53, preservando a baseline aprovada.

### Fechamento remoto e informação posterior sobre a chave live

O incremento foi publicado em `be73f827c8817ad48f2deae5de663616f3eca9b8`. Seu Preview ficou READY, com SHA/branch conferidos. A [CI43099008464](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43099008464) permaneceu na fila, sem executar o primeiro step. O [status oficial do GitHub](https://www.githubstatus.com/) registrou indisponibilidade grave de Actions no incidente `dvy0t3mvh1lg`, iniciado às20:48 UTC em11/11, também concomitante à fila do PR55. **BLOCKED externo, não PASS nem reprovação do código.** Nenhum workflow foi alterado e nenhum rerun duplicado foi disparado. Build Vercel,21 checks SQL,120 financeiros, TypeScript e lint locais passaram; a advertência de variável não usada do harness foi corrigida e os scripts passaram com tolerância zero. A CI do commit final continua obrigatória após normalização do serviço.

Depois do push, o founder informou aprovação da conta AbacatePay e chave de produção cadastrada sem redeploy. A auditoria somente de metadata encontrou `ABACATEPAY_API_KAY` em Production, não o nome consumido `ABACATEPAY_API_KEY`. Valor da chave não foi lido; nenhuma configuração foi corrigida automaticamente. `ABACATEPAY_API_KEY_PROD` no arquivo local não é consumida pela aplicação. O [inventário](AUDITORIA-VARIAVEIS-VERCEL.md) contém o procedimento de correção e a recomendação de substituir a credencial que apareceu na seleção do IDE, sem registrar seu valor. Aprovação do lojista não ativa a composição live nem dispensa os gates. Permanecem proibidos redeploy Production, cobranças reais e aplicação remota de SQL nesta autorização.

### Correção da variável confirmada e resultado posterior da CI

Após o titular informar a alteração, o readback de nomes/escopos às **21:14 UTC** confirmou `ABACATEPAY_API_KEY` em Production e ausência do nome incorreto. O Preview específico da branch mantém sua declaração. Nenhum valor foi solicitado ou testado com a API live; não se afirma que a credencial seja válida ou que a chave anterior tenha sido revogada. Nenhum redeploy ou configuração foi executado pela automação.

A execução [43100201006](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43100201006), no SHA `e8309aee`, começou depois da espera por infraestrutura: **7.016 testes passaram**, mas a execução **reprovou no inventário de segurança desatualizado**. A causa é o registro gerado das leituras de ambiente dos scripts alterados no harness, não uma permissão pendente ou chave de produção. O diff revisado contém somente duas leituras de ambiente adicionais e suas referências de linha; o inventário foi regenerado e o gate local passou, sem remover verificações ou relaxar guards. Build e E2E dessa execução não rodaram após a falha; o build Vercel do mesmo SHA ficou READY, sem substituir os demais gates. O resultado da CI do commit corretivo será registrado no PR53; a falha desta execução permanece como evidência e não deve ser atribuída ao incidente de fila.

## 44. Trial definitivo e composição com 0151 — 12/11/2026

### Implementação efetiva

Base preservada `c0db176a96d7eec1cf394a9e2a6cffe3f3c02342`, CI43101832867 aprovada com7016 testes/22E2E semSKIP. `main` continua `5620a0987ec53db7d7358728eb7d457d9d373df3`. A aprovação dessa baseline não foi transferida para o incremento.

- `src/lib/entitlements/`: política compartilhada da aplicação para cobranças de pacientes e agentes, lendo estado autoritativo, plano, período/carência existente e invoice positiva paga da mesma clínica/assinatura. Trial vigente/expirado, ausência de liberação, contrato suspenso/cancelado, plano desconhecido ou período inválido negam operação. Legados ativos não recebem inscrição retroativa. TISS retorna indisponibilidade operacional mesmo após pagamento.
- Inbound de IA é recusado antes de ler/persistir o turno ou chamar modelo/ferramentas; registry revalida na transação da ferramenta. Jobs proativos verificam assinatura antes de procurar contato/template ou enviar, incluindo réguas de cobrança. Criação e renovação de checkout Asaas de paciente recusam antes do claim e de GET/POST externo. Histórico, refund/conciliação e obrigações existentes não são apagados.
- Checkout SaaS permanece permitido **durante ou após** o trial, opcionalmente. Removido o erro obsoleto `trial_active`. A primeira ativação exige pagamento integral confirmado; o limite inferior do período é o Auth original do claim vinculado à clínica/titular. Nenhum novo trial, concessão por pendência ou extensão pela data de chegada do webhook. Recontratação continua só após o período pago anterior. Valores mensais e regras de mudanças no próximo ciclo pago permanecem iguais.
- Interface explica contratação antecipada, indisponibilidade dos módulos e limites após pagamento. O E2E autenticado foi atualizado para a nova expectativa sem criar checkout só para inspecionar trial. A variante de trial ativo foi posteriormente executada no Preview do código `4b666cc0`: **1/1 PASS**, Chromium, desktop/celular, com a fixture antiga ainda não paga. Login real, assinatura, CTA habilitado, corpo adulterado recusado e telas de integração bloqueadas; nenhuma criação de identidade/checkout/invoice. A prova preserva o prazo/contrato antes e depois, sem clicar no CTA para gerar nova obrigação. Não é novo pagamento externo.

### Integração com TISS sem misturar as branches

Durante a rodada, a0151 deixou de ser rascunho e foi publicada no PR55, SHA **`2a70788046752df4c8b349b871a089bc432a8609`**. O executor não teve acesso ao agente de outra thread: a coordenação verificável foi por leitura do contrato/fonte Git e preparação do manifesto, sem alegar troca direta de mensagens.

O adapter da aplicação consulta `public.qoro_premium_denial(uuid,text)` na mesma transação quando a função existe, traduzindo `patient_payments` para `patient_charges`. Recusa SQL sempre prevalece; retorno ausente/malformado não autoriza. Na versão N-1 sem0151, o gate da aplicação continua operando. Os testes exercitaram a função real da0151 e o escopo de tenant, além da ausência dela. Ainda falta revisão/integração final dos dois PRs; não declarar merge de código TISS ou política operacional final aprovado.

O helper de inputs passou a aceitar o snapshot revisado até0151. Lê SQL por `git show`, confere identidade dos blobs/histórico comum e ordem/timestamps; não copia migrations para a branch financeira. A proposta reproduzível está em `scripts/security/abacatepay-tiss-composition.ts`, com manifesto em `dist/abacatepay-tiss-composition.json`: posição financeira depois da cauda TISS acordada, **sem número/journal reservado**. Os testes não eliminam a necessidade de aprovação específica para DEV.

Readback somente leitura em **12/11,04:09 UTC**: DEV144 entradas;0143 exata aplicada;0144–0151 ausentes, sem conflitos de timestamp; coluna candidata financeira ausente. A0151 tem hash LF `a0e446dbce4121c538c4a3e206a406e0977d5d1729ed14b03417a3937b71ae0b`. Candidato financeiro inalterado, hash LF `5a1c7bd1a6f073972d7010998703d6f26667ee133f404dd358153fc5e2164b1a`. Nenhuma escrita DEV/Production ou no worktree TISS.

### Evidência de validação e limites

| Prova | Resultado executado | Recorte |
| --- | --- | --- |
| Decisão comercial, ferramentas, jobs, Asaas, período e UI | 142/142 testes dirigidos PASS | I/O simulado/happy-dom; antes dos últimos ajustes dos harnesses/E2E |
| Suíte integral local anterior ao último adapter SQL | 7056/7056 PASS | Não atribuída ao incremento final; CI própria obrigatória |
| Trial sem TISS | 49/49 PASS | PostgreSQL real,143 migrations, HTTP de provedor controlado, zero rede externa |
| Trial com TISS0151 | 49/49 PASS | PostgreSQL real,152 migrations, função SQL real + tenant/paid invoice/contratação antecipada |
| Composição SQL até0151 | 33/33 PASS | Duas ordens, rollback, índices/constraints/RLS/funções/gatilhos, contratos/dados anteriores preservados |
| Recuperação financeira com TISS0151 | 120/120 PASS | Mesmo catálogo de cenários financeiros, concorrência, falhas de invoice/período/cota, retry e fechamento; não120 pagamentos |
| TypeScript e lint integral | PASS local | Incremento da aplicação; scripts finais e inventário revistos antes do commit |
| Build, E2E público, cobertura e segurança do código4b666cc0 | CI43154102122 PASS:7061 testes e22 E2E/zeroSKIP | Snyk/Semgrep PASS; acompanhamento do commit documental nos checks do PR53 |
| Cinco primeiras compras Sandbox | Homologação anterior preservada | Sem novo pagamento/checkout nesta rodada |
| Renovação temporal e fechamento remoto | PARTIAL, sem nova prova externa | Nenhuma operação irreversível/autorização financeira presumida |

Os snapshots, comandos, horários e hashes estão no campo `trialEntitlementsFollowup` da [evidência canônica](evidencias/recuperacao-financeira-20261111.json). Não somar suítes sobrepostas como novas provas externas. Os testes SQL de até0150 continuam válidos para aquele snapshot;0151 foi ensaiada separadamente por alterar o comportamento comercial.

Um primeiro ensaio de entitlement com `withTenant` encontrou falta de SELECT em `clinics` no scaffold local. A leitura somente leitura DEV comprovou os privilégios existentes. O harness passou a modelar apenas SELECT(id,status) para authenticated, só no cluster loopback; nenhuma permissão real foi criada, RLS foi preservada e leitura cruzada continuou negada. As expectativas antigas de UI e fixtures pagas dos testes foram ajustadas à decisão aprovada, sem retirar asserções de segurança.

### Operação e configuração

API key Production **configurada por nome/escopo**, não testada nem ativada. Sem leitura do segredo, chamada live, alteração de variável ou redeploy. Inventário diferencia Configurado → Verificado → Integrado → Testado → Ativado. Não pedir novamente a variável já cadastrada. Sentry Preview (probe414eb196) e jornada normal MFA permanecem PASS; não repetidos.

Corrigido o runbook que exigia um bill distinto em toda renovação: a documentação atual admite checkout original com **novo payment.id** e correlação autoritativa de receipt/período/extrato. O estado PAID do primeiro checkout nunca comprova outro ciclo. A recuperação sem evento é GET-only e depende do candidato; não inserir evento artificial nem cobrar de novo. A documentação/CLI e a resposta do suporte continuam sem acelerador de renovação recorrente: limitação externa/temporal, não nova reprovação de código.

### Decisão de prontidão

**NO-GO AbacatePay Production.** Implementado/testado localmente não equivale a homologado externamente, ativado ou publicado. Faltam: acordo/journal final do SQL e autorização DEV; homologação externa de fechamento/readbacks e renovação ou tratamento formal de risco; composição live ainda deliberadamente ausente; responsáveis/capacidade e gates Production; CI verde do commit entregue. O [plano live](PLANO-FINAL-GO-LIVE-ABACATEPAY.md#preparação-live-executável--1211-sem-ativação) separa tarefas técnicas, futuras autorizações e provas externas. Nenhum merge, nova cobrança, refund, alteração de contrato, ativação TISS ou publicação foi executado.

### Verificação posterior do código publicado no PR

A [CI43154102122](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43154102122) aprovou o código `4b666cc07c8cdb1597c4d56b74f9ca27155b191b`: **7061 testes/22 E2E/zeroSKIP**, build, cobertura, tipos/lint/arquitetura, inventário, isolamento e fronteiras. Snyk e Semgrep também passaram; Agent Review ignorado não equivale a revisão independente. Preview imutável READY com SHA/branch conferidos.

O teste adicional autenticado usou a fixture sintética existente de08/11, sem criar outra conta. PASS1/1 em43,3s (53,4s total), sem erro de browser. Readbacks de12/11,04:26 e04:33UTC preservaram identidade, contrato, trial até22/11, nenhum binding remoto, zero invoices/operações. Login real altera metadados de sessão Auth; não é classificado como operação Auth somente leitura. Os primeiros preflights locais falharam antes do navegador; CLI Vercel autenticada e certificados do Windows via `--use-system-ca` resolveram o operador, sem desabilitar TLS, mudar app/Vercel ou relaxar o fingerprint DEV.

Esta atualização posterior altera somente documentação/evidência. O resultado completo do código acima fica preservado, e os checks obrigatórios do novo SHA documental continuam no PR53. Nenhuma suíte financeira externa foi repetida.

## 45. Concorrência, contenção distribuída e pacote SQL — 12/11/2026

Esta seção substitui o status corrente, preservando os checkpoints anteriores como históricos. Baseline confirmada `9ddc432a`; PR53 continua draft. A nova implementação ainda precisa dos checks de seu próprio SHA. Não foram repetidos pagamentos, encerradas fixtures ou usados segredos live.

### Problemas reproduzidos e corrigidos

1. **Cadastro simultâneo com o mesmo nome:** o SELECT de disponibilidade do slug podia retornar livre para duas transações. O teste de carga reproduziu `23505/clinics_slug_unique`. `resolveAvailableSlug` agora adquire um advisory lock transacional por candidato antes de consultar a disponibilidade. A constraint UNIQUE permanece; nomes distintos não são serializados globalmente.
2. **Lock de renovação amplo demais:** notificações ainda sem IDs internos podiam selecionar todas as assinaturas da loja para `FOR UPDATE`. A carga reproduziu `40P01`. A reserva agora exige o vínculo da assinatura externa original ou da recontratação paga da mesma clínica/conta. A validação financeira e a transação continuam obrigatórias.
3. **Sem coordenação entre instâncias:** o transporte passou a usar o Redis existente, por loja, com Lua atômico e relógio do servidor. Admissão espaçada em20ms (teto interno50/s), até3 consultas de admissão por tentativa, tratamento429/Retry-After/RateLimit-Reset, circuito30s após5 falhas e pausa60s em401/403. Redis indisponível bloqueia a chamada. Cada comando POST continua tendo uma única tentativa; erro posterior ao envio permanece resultado desconhecido.
4. **Retentativa imediata de inbox:** espera persistida5s,10s,20s…até1h, mantendo leases, limite de tentativas, revisão e replay administrativo. O webhook transitório responde503 com Retry-After30; isso não comprova que o provedor respeita esse header. Replays autorizados continuam explícitos. O cron drena até10 eventos dentro do orçamento, sem mudar seu agendamento.

### Provas executadas

| Prova | Resultado | Abrangência e limite |
| --- | --- | --- |
| PostgreSQL,100/500/1000 clínicas sintéticas | PASS de integridade | Provisionamento real, ingressos duplicados e aplicação atômica concorrente de renovação.32 tarefas, pool admin8. Não é carga HTTP no provedor ou na Vercel |
|1000 clínicas, última etapa |25,25 clínicas/s; p50 1252ms; p95 1818ms; p99 2100ms | Cada tarefa disputa duas aplicações do mesmo ciclo; etapas anteriores são reexecutadas como duplicatas |
| Banco e memória |13 conexões observadas; pico7 aguardando locks; RSS Node283MiB; zero deadlocks/temp spill/rollback na execução final | Medição amostral local, não dimensionamento de Supabase/Vercel |
| Integridade final |1000 clínicas/2000 invoices/1000 ciclos/1000 eventos; zero vínculo cruzado | A primeira invoice de cada clínica é fixture sintética S0; não representa outro pagamento externo |
| Meta diagnóstica p95≤2s | PARTIAL | A etapa500 teve p95 3603ms na aplicação e5627ms no provisionamento. A etapa1000 teve2071ms no provisionamento. Não se aprovou SLA de2s |
| Redis7.4 real | PASS |1000 admissões concorrentes/20 controladores, loja compartilhada, isolamento de lojas, circuito e429;5 admissões/135,5ms e30 admissões no ensaio contínuo de1s. Zero chamadas ao provedor/Redis externo |
| Financeiro com TISS0151 |120/120 PASS | HTTP controlado/PG real; espera de retry também comprovada sem antecipar calendário externo |
| Composição TISS0151 |33/33 PASS | Snapshot imutável `1be40b15ed7533fcac54a3d89cbc821f2e17af22`, ambas ordens/rollback, dados e RLS |
| SQL de pré/pós-verificação gerado |4/4 PASS | Queries exatas executadas em PG descartável; não aplicadas no DEV/Production |

Evidência e números completos no incremento `scalabilityFollowup` do [registro canônico](evidencias/recuperacao-financeira-20261111.json). Os scripts são `abacatepay-renewal-db.ts` em modo `QORO_ABACATEPAY_SCALE=1`, `abacatepay-scale-proof.ts`, `abacatepay-rate-db.ts` e `abacatepay-composition-checks-db.ts`, sob `scripts/security`. A carga usa o serviço de domínio diretamente: **não drena o inbox por HTTP/worker nem mede o scheduler**. Os1000 eventos ficam recebidos no banco descartável, depois removido com o cluster; nenhuma atualização artificial os marcou processados.

### Composição e limites ainda reais

O readback DEV de12/11,06:38UTC confirmou144 entradas, com0143 exata;0144–0151 e candidato financeiro ausentes. Não houve divergência por timestamp nas fontes TISS. O journal financeiro permanece0000–0142. A composição preparada ordena0144–0151 e, depois da cauda acordada, o candidato financeiro de hash LF `5a1c7bd1a6f073972d7010998703d6f26667ee133f404dd358153fc5e2164b1a`. **Nenhum número final foi reservado, nenhum journal foi adulterado.** A integração definitiva dos journals e do código dos dois PRs continua trabalho pendente, não prova de merge por esses ensaios SQL.

Há limites técnicos que impedem GO irrestrito: agendamento diário não oferece recuperação rápida para muitas clínicas; a busca de receipt exige terminar até5 páginas de100 registros no período; acima disso fecha em erro seguro, sem conceder acesso. Não foram inventados filtros por assinatura/checkout no extrato. Preparar varredura com checkpoint e execução frequente com capacidade medida continua necessário para escala operacional. A composição live também não existe: o runtime só aceita Sandbox fora de Production. Presença de API key live não a implementa.

A documentação oficial confirma100 requisições/s por loja e os filtros/paginação disponíveis: [índice oficial](https://docs.abacatepay.com/llms.txt), [extrato](https://docs.abacatepay.com/pages/bank-statement/list). Nenhum teste local substitui a renovação externa ou o readback após fechamento real. O fechamento das fixtures continua sem autorização; não foi executado.

**Decisão: NO-GO de Production.** Os avanços de concorrência são comprovados, mas não justificam declarar toda a operação pronta para1000 clínicas. A matriz única G01–G24 está em [cenários e testes](MATRIZ-CENARIOS-E-TESTES.md#matriz-única-g01g24--12112026); não se transferem ao founder os itens de engenharia que ainda faltam.

### Fechamento das provas desta rodada

A segunda carga, sobre o código runtime commitado, preservou todos os invariantes, mas sob testes simultâneos e pressão local de memória a etapa1000 registrou **4,98 clínicas/s; p50 6191ms; p95 10326ms; p99 11251ms**. Foram13 conexões, pico8 aguardando locks e RSS Node115MiB, sem deadlock ou efeito duplicado. Ambos os resultados foram preservados: não escolher apenas os25,25/s da primeira execução como capacidade. A meta diagnóstica p95≤2s não foi cumprida; G18 continua PARTIAL e nenhum SLA/capacidade Production foi aprovado.

A comparação completa do DEV confirmou138 hashes LF iguais e as mesmas seis diferenças históricas registradas em30/10 e04/11. Três foram novamente comprovadas como equivalentes CRLF;0051/0093/0124 conservam origem não reconstruída e os prefixos históricos registrados. Os hashes completos atuais ficaram preservados na evidência sanitizada, sem reescrever histórico ou reaplicar SQL antigo. Não tratar essa baseline conhecida como uma nova migration pendente nem apagar sua incerteza.

Foi gerado um **journal proposto0000–0152**, com153 entradas consecutivas, em `dist/abacatepay-tiss-release/drizzle/migrations`; a0152 é apenas proposta, **não reservada nem adicionada ao journal do repositório**. O timestamp de preparação é12/11,07:42:38UTC. O migrador Drizzle real executou somente0144–0152 a partir da história local equivalente à0143:144→153, catálogo e os144 registros anteriores preservados, incluindo os seis hashes históricos. A segunda execução não aplicou nada. São **8/8 verificações PASS** da proposta/pré/pós/RLS/migrador, sem clone de dados DEV, sem DDL remoto e sem modificar PR55. O pacote só pode ser promovido após nova conferência da cauda/número/hashes e aprovação específica.

A [CI43176421120](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43176421120) aprovou o código runtime `c65311e0fcf86a2fde8fdf6dc1b27ff1dd00ef05`:7080 testes,22 E2E/zeroSKIP, cobertura, tipos/lint/arquitetura, build Next, isolamento, inventário, bundle/HTTP e auditoria de dependências. A repetição local integral passou7080/7080, com dois workers;70 testes dirigidos e49 do transporte passaram, sem somar contagens sobrepostas. O primeiro build local teve falha de cadeia de certificados; a repetição com CAs do Windows manteve TLS e foi interrompida para liberar memória. **Não houve PASS local de build:** o PASS de compilação vem da CI e do Preview real. Os scripts finais da proposta passaram o ensaio PostgreSQL8 e arquitetura sem abrir exceção ao guard de conexões. Os checks do SHA final desses scripts/documentação devem ser conferidos no [PR53](https://github.com/joaomarcos-techia/Project_OS/pull/53); aprovação anterior não é atribuída a um commit novo.

### Check final dos scripts e do inventário

A [CI 43179637635](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43179637635), do commit `8c591c8f`, passou os 7.080 testes, cobertura, tipos, lint, arquitetura e os guards de migrations/observabilidade. Falhou no snapshot documental do inventário de segurança: o novo harness acrescentou três acessos a variáveis de ambiente e deslocou linhas de dois scripts. Não havia itens sem revisão, variáveis públicas irregulares ou testes de rotas ausentes. O inventário foi regenerado pelo comando oficial e `scripts/security/inventory.ts --check` passou, com `unresolved: []`. Build e E2E foram ignorados após essa falha; seus resultados anteriores não são atribuídos a essa execução. O commit de correção exige nova CI completa no PR.

### Exceção operacional — recurso auxiliar criado pela CLI

Durante a tentativa posterior de validar consultas Sandbox/Redis com `vercel env run`, **minha execução criou inesperadamente um projeto auxiliar e um deployment marcado Production**, embora a intenção e os argumentos fossem Preview/local. Não houve rollout do Qoro. O caminho foi interrompido, sem repetir a chamada. Não se deve resumir esta rodada como ausência absoluta de publicação externa.

Inspeção somente leitura em 12/11, 08:12 UTC: projeto `run-scale-preview-redis`, ID `prj_htYpK9lthoj7LG78fVa8JsH3VzRn`, deployment `dpl_HX9mrERFQab1U74efzo4NjX7yKdh`. Existe somente `src/run-scale-preview-redis.cjs`; o SHA1 corresponde exatamente ao wrapper local `fa32a3bbfb16a029e1ae88f44ff0f0e7cf8cbdae`, que não contém credenciais. Projeto sem Git, sem variáveis próprias configuradas; inventário do deployment não mostrou nomes de credenciais do Qoro. Proteção SSO: `all_except_custom_domains`. Nenhum vínculo local `.vercel/project.json` foi criado. Não foi executado o probe financeiro nem alterado banco/assinatura.

O projeto Qoro continua sendo `project-os`, com Production no deployment `dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP` e SHA `5620a0987ec53db7d7358728eb7d457d9d373df3`, iguais à referência da main desta rodada. A causa interna do despacho da CLI não foi demonstrada; não se inferiu segurança de uma repetição. A remoção **exclusiva** do auxiliar foi solicitada ao founder por exigir confirmação de operação destrutiva nas instruções AGENTS.md; está pendente, sem ampliar para qualquer recurso Qoro. O resultado de limpeza será registrado quando houver autorização e readback.

## 46. Atualização da cauda TISS para 0154 — 12/11/2026

Ao retomar os checks, o PR #55 havia avançado para `8a947e10bd77ae941a48b5340c14bf1bd0131c0b`, acrescentando 0152 (glosas/pagamentos), 0153 (ponte com o livro) e 0154 (evidência de período premium). A proposta financeira 0152 da seção anterior ficou histórica e **não deve ser aplicada**. O outro worktree foi somente lido por Git, sem merge ou alterações.

O pacote atual é `dist/abacatepay-tiss-release-154-8a947e10`, com **156 entradas propostas, 0000–0155**. A financeira é apenas uma proposta `0155_saas_period_snapshot`, sem reserva ou alteração do journal do repositório. Seu SQL conserva o SHA256 `5a1c7bd1a6f073972d7010998703d6f26667ee133f404dd358153fc5e2164b1a`. O `when` proposto, `1794691373858`, é a chave de ordenação imediatamente posterior à cauda TISS; **não representa data de criação nem autorização de aplicação**. O journal TISS já usa chaves futuras. Número e `when` finais exigem revisão conjunta.

Provas executadas sobre esse SHA fixo:

- **35/35 composição SQL:** duas ordens, rollback, constraints/gatilhos/RLS, contratos e campos anteriores dos recebíveis preservados. A primeira tentativa acusou os dois campos novos do TISS como divergência de objeto completo; o ensaio passou a comparar todos os campos anteriores e a exigir explicitamente `source_hi_guide_id IS NULL` e `valor_glosado = 0` para os recebíveis particulares antigos. A fixture paga recebeu período verificável, como exige a 0154; nenhuma regra do produto foi relaxada.
- **8/8 pacote e migrador Drizzle:** base local equivalente à 0143, aplicação de exatamente 12 entradas (0144–0155), catálogo e 144 registros históricos preservados, incluindo os seis hashes antigos; segunda aplicação sem efeito. Pré/pós-verificações geradas foram executadas, com RLS forçada e privilégios privados conferidos.
- **120/120 financeiros**, 601 chamadas HTTP controladas e zero rede externa: renovação, recuperação, cancelamento, cotas, duplicidade, falhas e eventos negativos.
- **49/49 trial/entitlements**, zero rede externa: nenhum pagamento pendente concede operação premium, e pagamento não ativa o TISS indisponível.

A execução financeira inicialmente usou a condição `react-server` no processo pai do tsx e foi recusada pelo guard `server-only`; o comando foi corrigido para o padrão do projeto, `tsx --conditions=react-server`, e executado novamente. Não se tratou essa tentativa como teste financeiro aprovado.

Readback DEV em 12/11, 17:08 UTC: 144 entradas até 0143; 138 hashes LF idênticos e as mesmas seis diferenças históricas documentadas, sem timestamp desconhecido/duplicado. 0144–0154 e candidato financeiro continuam ausentes. Nenhuma migration remota foi executada. Os metadados Vercel confirmaram as três variáveis AbacatePay específicas da branch e Redis no escopo Preview, sem decrypt, alteração ou leitura da chave live; isso não comprova o novo transporte em operação externa.

A [CI 43265236442](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43265236442), SHA `7e35aa3e`, passou **7.080 testes e 22 E2E sem SKIP**, cobertura, build e segurança. Os novos ajustes são de harness/manifest/documentação, com tipos, lint, arquitetura e inventário locais aprovados; seus checks finais pertencem ao SHA publicado no PR #53. Cargas anteriores e provas externas continuam preservadas. **NO-GO de Production:** faltam consolidação conjunta do journal/schema, aprovação DEV, varredura incremental/cadência de recuperação, composição live e gates externos/operacionais. A remoção do auxiliar descrito na seção anterior segue pendente de autorização específica.

## 47. Scanner durável e recuperação contínua — 12/11/2026

Este incremento substitui o teto permanente de 500 registros para a busca de comprovantes CARD_APPROVED, quando o SQL candidato estiver presente. `statement_scans` mantém cursor opaco, geração, lease/fencing, páginas, contadores e backoff por loja/mês brasileiro. `statement_scan_items` preserva somente identificadores e movimentos mínimos necessários à prova, sem nome, e-mail, documento ou payload bruto. As duas tabelas são privadas, com RLS forçada, sem SELECT de tenant nem DELETE do service_role. Nenhum cache parcial concede pagamento/acesso. Em N-1, sem as tabelas, permanece o leitor anterior e seu limite explícito; não se declara capacidade incremental antes da aplicação autorizada do schema.

Cada página e seu checkpoint são gravados na mesma operação SQL atômica. O HTTP ocorre fora do lock; processo interrompido retoma o cursor persistido. Uma lease antiga não pode gravar depois de substituída. Cursor repetido ou recusado é reiniciado com nova geração e backoff, não ignorado. A leitura verifica a loja antes de armazenar dados. Mudança da identidade financeira de um registro gera conflito e revisão; o scanner nunca cria invoice, assinatura ou cobrança.

Depois da varredura integral, atualização de topo pode parar ao reencontrar uma página inteiramente conhecida. A revisão integral periódica continua para encontrar registros antigos/backfill além dessa fronteira. Frescor de 60 segundos e varredura integral a cada 15 minutos são controles operacionais da candidata, não novas condições comerciais nem SLA contratado. Trata-se de elegibilidade; frequência efetiva depende do scheduler e backlog. Nenhum OFFSET é usado. A paginação oficial é decrescente e `pagination.next` deve ser reenviado como `after`; datas são inclusivas no calendário brasileiro: [extrato oficial](https://docs.abacatepay.com/pages/bank-statement/list).

O tick já existente `/api/cron/outbox` passa a executar, em paralelo com seu trabalho anterior, um lote financeiro limitado a 35 segundos. Não foi alterado `vercel.json`, criada infraestrutura de agendamento ou ativado cron em Production. O lote é recusado em Production pelo guard existente. Ele avança páginas e trata até dez contratações iniciais e dez recuperações de renovação dentro do orçamento; os candidatos são rotacionados pelo histórico privado. Ausência de comprovante ou metadados suficientes não libera um mês. O cron diário continua como caminho adicional, sem misturar contratos Asaas.

**Correção confirmada:** a recuperação da primeira contratação exigia trial expirado, podendo atrasar a liberação de quem pagasse antecipadamente e perdesse o webhook. Foi removida somente essa condição; continuam obrigatórios checkout, vínculo e prova autenticada integral. Consultas têm deadline compartilhado, candidatos pendentes têm cooldown de cinco minutos e falhas geram alerta sem dados sensíveis. Não foi feita cobrança, liberado contrato real ou alterada duração do trial.

**Latência:** medição anterior à restrição dos joins, neste incremento, preservou invariantes com 100/500/1.000 clínicas, mas no lote de 1.000 teve p95 total de 9.587 ms, p95 de admissão no pool de 8.250 ms e p95 de transação até COMMIT de 1.480 ms. Esses percentis não são somáveis. Admissão inclui espera e BEGIN; transação inclui SQL/locks/COMMIT. Havia testes concorrentes e menos de 500 MiB livres na máquina. Não houve carga HTTP contra o provedor. Foi identificado no código o join por conta inteira antes dos snapshots laterais; a consulta agora resolve a geração original/recontratada pelos índices existentes e só então consulta/bloqueia o contrato correspondente. Comparação final e limites ficam na evidência do incremento; não atribuir melhoria causal sem considerar o ambiente.

**TISS:** o snapshot revisado é `233d225e0ddb1fe56ee3975471a4c0260454bec7`, até 0156. A 0155 pertence à correção de agregação do livro da TISS e não está reservada para AbacatePay. O pacote descartável de 158 entradas apenas propõe uma posição seguinte para ensaiar Drizzle; número/when financeiros seguem **não atribuídos** no repositório. Há trabalho TISS posterior ainda em edição, excluído das provas fixadas. Readback DEV em 18:15 UTC: 144 entradas até 0143, mesmas seis diferenças históricas, nenhum timestamp desconhecido/duplicado e candidato ausente. Nenhum DDL remoto foi executado.

**Incidente Vercel:** nova inspeção em 18:27 UTC confirmou o projeto/time exatos, nenhum domínio personalizado, nenhuma variável própria, nenhum Git e lista vazia de recursos Marketplace. O Qoro manteve deployment e SHA de Production. O novo preflight só admite comandos GET/list fixos, recusando sintaxe arbitrária antes de chamar a CLI; não contém delete/deploy/env-run. Causa interna do despacho inicial permanece não comprovada. Uso por outro operador e custo não medido não podem ser inferidos como inexistentes; remoção segue dependente de aprovação específica. Não houve nova publicação auxiliar nesta rodada.

As provas finais e o SHA dos checks deste código são registrados no incremento `incrementalScannerFollowup` da [evidência canônica](evidencias/recuperacao-financeira-20261111.json). As seções anteriores permanecem históricas; seus PASS não são automaticamente atribuídos ao código novo. A [matriz G01–G28](MATRIZ-CENARIOS-E-TESTES.md) passa a ser a decisão corrente. **Production permanece NO-GO** até fechar a composição compartilhada/live, os gates externos e a aprovação operacional; não é necessário repetir as cinco compras já homologadas.

### Comparação de carga e gates locais deste incremento

| Clínicas | Antes, 32 tarefas: p50/p95/p99 (ms) | Consulta restrita, 32 tarefas (ms) | Consulta restrita, 8 tarefas (ms) |
|---|---|---|---|
| 100 | 5.482 / 6.827 / 7.646 | 5.140 / 7.086 / 7.267 | 1.711 / 2.212 / 2.334 |
| 500 | 7.431 / 9.541 / 9.954 | 5.081 / 6.966 / 8.132 | 391 / 553 / 601 |
| 1.000 | 6.598 / 9.587 / 10.815 | 4.961 / 7.899 / 9.239 | 831 / 1.807 / 2.119 |

Todas as cargas preservaram invariantes, com zero erro/deadlock; cada tarefa disputa a mesma renovação com uma repetição concorrente. O pool permaneceu com oito conexões de aplicação. Na carga de 1.000 com 32 tarefas, throughput passou de 4,91 para 6,45 clínicas/s (+31,3%) e p95 caiu 17,6%; com 100 houve piora de p95 de 3,8%. Com oito tarefas, a carga de 1.000 fez 8,43 clínicas/s. A meta diagnóstica local de 2 s não foi atendida em todos os tamanhos. O ambiente variou e tinha pouca RAM: a comparação não isola causalidade nem garante capacidade de Production. Reduzir fila não equivale a aumentar capacidade contratada do banco; nenhuma configuração de pool/cron/serviço externo foi alterada.

Instrumentação separa admissão no pool e transação até COMMIT; o scanner também mede HTTP sintético, banco e backlog. As cargas de domínio não medem checkout externo, latência real do Redis/provedor, resposta HTTP do webhook ou throughput do worker completo. Esses campos não recebem PASS por inferência. O plano SQL da consulta restrita foi preservado no JSON da evidência, sem adicionar índices.

Provas executadas: **955 testes direcionados**, mais **50** de regressão dos quatro módulos afetados pela composição final; **16 checks do scanner**, **121 financeiros**, **50 de trial**, **35 de compatibilidade SQL** e **8 de composição com Drizzle real**. Números são escopos distintos, não uma soma de testes únicos. Scanner processou 10.003 registros sintéticos, com interrupção antes/depois do commit, cursor vencido/cíclico, dois workers, registro novo/backfill, 429, indisponibilidade e isolamento. Nenhuma chamada externa ou pagamento foi usado nessas provas. Tipos, lint direcionado, arquitetura, segurança de migrations, formatação e coerência de observabilidade passaram. O primeiro build local encontrou falha de cadeia de certificados; a repetição usa a confiança do sistema Windows, sem desligar TLS nem modificar configuração versionada de build. A repetição local com certificados do sistema terminou por falta de heap V8 (exit 134); não foi aprovada como build local. O build final e os E2E serão comprovados na CI do SHA publicado, sem reduzir nenhum gate.

O gate de arquitetura detectou inicialmente uma importação privilegiada nova na rota de outbox. A composição foi movida para o seam financeiro já autorizado, com dependência explícita do reconciliador inicial; a allowlist não foi ampliada. Os quatro testes da rota preservam resposta, início paralelo e propagação de falha ao limite de alerta existente. A rota aguarda ambos os trabalhos terminarem antes de responder com erro, evitando abandonar o outbox quando a recuperação financeira falha primeiro.

**Engenharia ainda pendente:** composição live explícita e revisão final do pacote compartilhado; prova do transporte/Redis e capacidade HTTP/worker no ambiente-alvo; leitor incremental próprio para débitos de estorno/disputa, hoje limitado a cinco páginas. Não apresentar esses itens como trabalho manual do founder nem declarar cobertura ilimitada de todo o financeiro. A prova de recuperação CARD_APPROVED não modifica a política aprovada de preservar acesso após evento negativo e encaminhar para revisão.

## 48. Inbox de minuto, estornos e TISS até 0158 — 12/11/2026

O tick existente de outbox agora retoma também o inbox financeiro: até dez eventos por lote, janela de admissão de 15 s e orçamento compartilhado de leitura de até 35 s. Cada item recebe deadline absoluto de até 20 s, propagado aos leitores de contratação, renovação, cancelamento e evento negativo. Leases, backoff, limite de tentativas e idempotência continuam autoritativos. Os três trabalhos independentes terminam antes da resposta de erro; não há abandono do outbox por uma rejeição financeira antecipada. Nenhuma agenda externa foi alterada e todos os consumidores continuam recusados em Production.

A paginação durável foi estendida aos estornos. As partições usam loja, mês e finalidade: card_approved para comprovantes de pagamento, adjustments para observações de refund/reversal. Um comprovante de cartão não é prova de estorno, nem o inverso. A chave/FK composta impede misturar as finalidades. Dados parciais não comprovam valor. Em N-1, sem o schema com finalidade, ambos os caminhos mantêm o fallback limitado; o incremento não foi ativado no DEV compartilhado.

O comprovante de cartão permanece imutável. No cache de ajustes, movimentos podem mudar após uma nova leitura autenticada, como na reversão de um estorno; a identidade (loja, registro, checkout, pagamento, data e cliente) não pode mudar. Mudança de identidade gera conflito e revisão. O histórico processado fica no inbox e em billing_events: atualizar a observação do cache não apaga uma decisão anterior nem concede/revoga direitos. Mantida a política aprovada: preservar o período pago e encaminhar eventos negativos à revisão humana. Não há refund, cancelamento ou cobrança automática nova.

Antes de uma varredura global, o lote confere o produto de prova configurado e exige id correto e devMode=true. Identidade da loja sozinha não atesta o modo. Recurso live, id divergente ou configuração ausente interrompem o lote antes da leitura do extrato. O scanner também recusa conta Production. Usa a variável Sandbox já existente, sem ler chave live ou criar variável nova.

**Provas locais atuais:** scanner 22 (mais de 10 mil registros em cada finalidade, disputa de páginas entre finalidades, reversão posterior, identidade alterada, RLS/FK e zero chamadas externas); financeiro 122; trial 50; SQL 41; Drizzle 8. A prova do tick drenou dois lotes de dez eventos antigos sintéticos, deixou a loja estrangeira intacta e não chamou o provedor. Os SQL 41 incluem as duas ordens de aplicação, contratos/recebíveis particulares preservados, RLS forçada e view invoker de repasse TISS, além da recusa de outra clínica e do anônimo na função de sincronização de coparticipação. Não equivalem à homologação de todos os cálculos do módulo TISS.

**Snapshot TISS revisado:** 120e8195e4ad267a64157239cb9bc0c22b432033, até 0158. Foram lidas as migrations 0157 de repasses e 0158 de sincronização de coparticipação; elas não alteram o ledger SaaS. O pacote descartável tem 160 entradas e ensaia 144 → 160 no migrator real, preservando as 144 entradas/hashes anteriores e comprovando segunda execução sem reaplicar. O número financeiro seguinte é apenas proposta no laboratório, não reserva nem journal publicado. DEV em 20:24 UTC continua com 144 entradas até 0143, sem timestamp desconhecido/duplicado; mesmas seis diferenças históricas, candidato ausente. Nenhuma escrita remota ou no worktree TISS. A cauda final ainda exige acordo antes de qualquer aplicação compartilhada.

**CI/Preview:** a [CI 43294439503](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43294439503) do b235413d aprovou 7.110 testes e 22 E2E sem SKIP, build, cobertura, segurança e isolamento; Semgrep/Snyk/Preview também passaram. Esse SHA precede inbox e estornos deste checkpoint e não aprova automaticamente o código posterior. No mesmo Preview, três verificações HTTP reais passaram: outbox 401, billing-reconcile 401, admin 307 para login. O primeiro harness esperava um campo JSON incorreto; foi ajustado ao contrato existente error=unauthorized, sem mudar o produto. É prova de fronteira anônima, não de Redis/provedor. O resultado dos checks do último SHA deve ser conferido no PR #53.

**Restante:** composição live explícita e revisão final do pacote compartilhado; prova autenticada do transporte/Redis e capacidade HTTP/worker no ambiente-alvo; renovação externa e readbacks pós-fechamento sob autorização específica; responsáveis e aceites operacionais/comerciais. O leitor de estornos já não é uma pendência de implementação incremental. As cinco compras iniciais não foram repetidas, fechadas ou canceladas. Production permanece NO-GO e o PR continua draft.

## 49. Aprovação executiva e composição live preparada — 12/11/2026

Escopo novo: cadeia TISS completa 0144–0158 + sucessora financeira no DEV autorizada expressamente após esclarecer a dependência do journal único; fechamento de uma fixture Sandbox autorizado; remoção do auxiliar autorizada sob preflight; preparação live autorizada. Migrations Production não estão autorizadas por essa permissão DEV. O rollout continua condicionado a todos os gates, sem GO presumido.

O código candidato já suporta composição live explícita, catálogo separado e devMode=false, mantendo os wrappers Sandbox estritos, os bindings de contratos e o kill switch independente dos consumidores. Conta/ambiente são vinculados na persistência e nos readbacks. Não foi usada a credencial live. Asaas legado, pacientes, preços, cotas e trial permanecem.

Provas locais: 125 cenários financeiros PostgreSQL; 22 de scanner (10 mil registros por finalidade); 41 de compatibilidade SQL; 50 de trial; 9 de migrator real, incluindo lock concorrente/SQLSTATE55P03 e rollback das 16 entradas pendentes. No ensaio local, a aplicação durou 10,21s; a transação bloqueada durou 15,05s incluindo as migrations precedentes, com timeout de lock de 2s no statement bloqueado. São medições de laboratório, sem estimativa garantida para DEV/Production. TypeScript e lint direcionado passaram; a CI própria do novo código será conferida no PR.

O [manifesto executável de inputs](migrations/release-manifest.json) fixa os bytes SQL revisados em TISS120e8195 e a financeira0159. O HEAD TISS avançou para62edb485 somente com ferramentas/evidências operacionais; hashes0143–0158 idênticos. A leitura atual confirmou que o agente TISS já aplicou0144–0158: DEV159 entradas, somente0159 pendente. O pacote composto usa o journal real do Drizzle e preserva as seis diferenças históricas conhecidas; não há inserção manual de histórico compartilhado. O backup DEV local foi cifrado com AES256/GPG, protegido por ACL e verificado por decifragem. Aplicação DEV e resultados externos serão registrados separadamente depois de efetivamente executados.

O auxiliar run-scale-preview-redis foi removido após confirmação de identidade/time, zero env/Git/domínio personalizado/Marketplace/crons, um deployment READY, nenhuma referência em configurações de C:/dev e seis GETs sem resposta2xx desde sua criação. A consulta posterior confirmou ausência. O Qoro manteve Production no SHA5620a098 e app/landing responderam200. Sem uso de flag para ignorar a confirmação de DELETE: a confirmação normal da CLI foi executada dentro da autorização específica.

A documentação oficial de assinaturas consultada em12/11 agora descreve um checkout por cliente e nextChargeAt. Isso difere do retorno histórico do suporte. Não foram removidos os controles de binding/quarentena nem declarada garantia externa com base apenas nessa alteração documental. Renovação natural e consultas depois do fechamento continuam exigindo evidência própria.

O aplicador guardado `scripts/security/abacatepay-dev-release.ts` passou em preflight read-only no DEV:159 entradas,224 tabelas comparadas por hashes sem dados expostos,3 contratos órfãos históricos preservados, zero invoices cruzadas e zero ciclos duplicados. Usa SET de sessão verificado (Supavisor ignora parâmetros de inicialização), migrator oficial, lock_timeout2s e statement_timeout15s. A execução de escrita ainda será registrada após commit dos inputs e nova conferência.

## 50. DEV aplicado e provas externas delimitadas — 12/11/2026

O preflight recusou o primeiro input quando o agente TISS avançou para62edb485. A conferência mostrou os mesmos bytes SQL0143–0158 e a aplicação independente, por aquele agente, de0144–0158 no DEV. Não reaplicamos a cadeia. O manifesto passou a fixar62edb485 como HEAD operacional, preservando120e8195 como origem da prova SQL. O migrator oficial aplicou **somente0159_saas_period_snapshot** no DEV, às22:49UTC, em2,26s, com lock_timeout2s/statement_timeout15s efetivamente medidos na sessão. Histórico159→160; segunda execução sem mudança. Nenhuma inserção manual no histórico. Antes da escrita: zero DDL ativo observado, zero transações longas/locks esperando e backup cifrado com decifragem verificada. O lock consultivo só coordena quem o respeita; não foi afirmado isolamento de operadores não cooperantes.

Pós-voo:224 tabelas existentes comparadas usando as colunas anteriores e hashes sem exposição de valores; dados preservados. Três contratos órfãos históricos DEV continuam intactos; zero invoice cruzada, zero ciclo duplicado. RLS forçada e SELECT de tenant/DELETE de service_role negados nas três novas tabelas privadas. A versão do guard de review aceita o namespace explícito de produção; não foi usada credencial live nem mudado um contrato. Evidência sanitizada no incremento executiveFollowup do registro canônico.

**Previewefdf4722**, https://project-jag1hizd8-clinic-os-v2-s-projects.vercel.app: login real da fixture paga, registros no DEV, desktop1440/mobile390, checkout repetido recusado e gates operacionais pagos conferidos, sem nova compra. A prova HTTP usou evento sintético assinado pelo operador, com IDs da compra já paga:401 sem autenticação,401 com HMAC inválido,202 para a primeira entrega e503 para a concorrente enquanto a lease estava ativa; a repetição tardia retornou200. Uma linha de inbox, uma tentativa aplicada, lease liberada e resultado initial_payment_already_consumed. Pelo caminho obrigatório do código publicado, houve HTTP→inbox→worker→coordenação Redis→GET do provedor→pós-estado no banco. Assinatura/invoice/cotas mantidas. Isso não é evento novo emitido pela AbacatePay, medição de SLA, pane injetada no Redis Preview ou teste global de cron. Nenhum tick global com risco de enviar mensagens a outras clínicas foi disparado.

**Fechamento real autorizado Sandbox:** bill_WDnCdCcreJeqUyz65paa4WXt, ConsultórioR$197. Prova anterior preservada antes do comando; um único POST subscriptions/checkouts/delete retornou200. A repetição pelo journal adicionou zero POST. GET da assinatura, listagem de assinaturas vinculadas e extrato continuaram válidos; invoice, período e liberação local preservados. O checkout saiu da listagem completa, porém continua consultável por GET em PAID. Um evento tardio sintético, depois do fechamento, percorreu o Preview e terminou aplicado uma vez sem alteração financeira. Não houve cancelamento, refund ou pagamento adicional. O link HTTP respondeu200; isso isoladamente não comprova aceitação de novo pagamento. A documentação oficial atual passou a afirmar que o link excluído deixa de aceitar pagamento; a inspeção observacional e seus limites ficam registrados na evidência. Não tentamos pagar de novo para provar bloqueio.

O ensaio de fechamento usou Redis7.4 dedicado em loopback e API Sandbox real; não usou Redis de produção. Primeiro o Redis local anterior estava parado: o preflight falhou antes de qualquer HTTP ao provedor ou POST. O harness foi reduzido ao contrato exato e recebeu timeout de comando. Um aviso de listeners do socket pertenceu somente ao operador descartável, foi corrigido sem repetir o fechamento; não foi identificado como vazamento no runtime Next. A primeira consulta complementar sofreu falha transitória e a repetição somente de GETs passou. Esses incidentes não foram ocultados nem convertidos em sucesso externo retroativo.

A CI43323224785 deefdf4722 passou7138 testes e reprovou1 asserção de texto administrativo antigo. A asserção foi corrigida ao novo texto sem remover os checks de autorização e formulário; os5 testes do arquivo passaram. A CI do commit final será conferida separadamente. O build Vercel deefdf4722 passou; não se atribui a CI anterior ao código novo. **PR53 continua draft e Production NO-GO**: faltam os gates operacionais/comerciais e a evidência natural de renovação ou tratamento formal do risco, sem migrations Production autorizadas por esta etapa DEV.

A inspeção readonly do link excluído confirmou a mensagem **“Não encontramos este link”** e zero campos de cartão. Nenhum campo foi preenchido; requisições não observacionais foram bloqueadas no navegador. O primeiro classificador do harness não reconhecia essa frase exata; corrigido o matcher ao estado observado, a inspeção passou. Não houve nova tentativa de pagamento. O Redis descartável dedicado foi parado após conferir o label e removido automaticamente, sem alterar outros contêineres.

Readback Vercel nominal, sem valores: Production continua no deployment dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP/SHA5620a098. ABACATEPAY_API_KEY está presente; os nomes de composição live ainda não estão configurados. Essa leitura não usa a credencial do provedor nem altera variável/deployment. A configuração Sandbox existente do Preview foi preservada.

## 51. CI final, composição isolada e incidente TISS — 12/11/2026

A [CI 43327683818](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43327683818), SHA `04a4fd7332795be9c83906c8edefffaa8b30137a`, passou **7.139/7.139 testes e 22 E2E sem SKIP**, build, tipos, lint, cobertura, arquitetura, migrations, inventário, isolamento, bundle e HTTP. Semgrep, Snyk e Vercel também passaram. Agent Review NEUTRAL não é revisão humana. Isso encerra a asserção de texto antigo registrada na seção 50, sem apagar a execução que falhou. O commit documental posterior deve ter seus próprios checks conferidos.

A consolidação de código foi feita **somente em cópia descartável**, por merge-tree do financeiro 04a4fd73 com TISS 62edb485 e depois com o HEAD `9b463168f438f5ec59d192351b2f96179e81d197`. Não houve merge de branch nem edição do worktree TISS. A atualização TISS acrescentou páginas/artefatos e pool XSD, sem alterar SQL ou schema da cadeia aplicada. Três conflitos mecânicos foram delimitados: journal, inventário gerado e allowlist DB. O journal da cópia usa o pacote congelado de 160 entradas; o schema agregado reúne os exports dos dois PRs; os dois operadores DB mantêm suas entradas nominais. O inventário foi regenerado, sem referência não resolvida, variável pública não registrada ou rota nova sem teste.

O teste do journal TISS ainda assumia que 0136–0142 estavam ausentes e classificava toda sucessora como TISS. Na união completa isso duplicava sete entradas e confundia a 0159. A correção preserva os asserts de ordem/colisão e acrescenta a conferência exata do manifesto/hash da 0159: **36/36 testes dirigidos passaram**, além do lint desse arquivo. O [patch de integração](migrations/tiss-ledger-integration.patch) foi aplicado e verificado em cópia do arquivo 9b463168; seu resultado é idêntico ao ensaiado. Não foi aplicado sobre o trabalho do agente TISS. Não houve renumeração nem alteração de SQL aplicado.

O snapshot 62edb485 passou TypeScript integral e arquitetura DB em 1.995 arquivos. Para o snapshot 9b463168, arquitetura DB passou em **1.999 arquivos** e o [build conjunto na Vercel](https://vercel.com/clinic-os-v2-s-projects/project-os/Ax33ANpMpfUoSsQWMJ2jUEafYCC9) terminou **READY**, em **5 min 35 s**, com compilação, lint, tipos, geração estática e tracing aprovados. Os hashes LF dos arquivos resolvidos estão no registro canônico. O Preview usa exclusivamente Sandbox e novos checkouts estão bloqueados por overrides desse deployment, sem mudar variáveis persistentes ou Production.

As tentativas não aprovadas continuam distinguidas: falha inicial de trust TLS ao obter fontes no build local; uso da CA do sistema somente na cópia, sem desativar TLS; build local interrompido sem conclusão; tsc local do snapshot novo excedeu o heap padrão de 2 GB. No primeiro upload remoto, e2e foi excluído apesar do import de e2e/vercel-bypass no Playwright config. Foi corrigido somente o manifesto de upload, preservando testes e validações. O build remoto seguinte passou. Não se declara que essas tentativas locais passaram.

**Incidente informado pelo founder:** Issues 7595411874 e 7845618264 compartilham o trace `9b37e1ca2ab54e76becfdcc69358f5f1`, às 01:20:35 UTC de 13/11 (22:20:35 de 12/11 no Brasil), release TISS 9b463168. O erro genérico do browser corresponde ao TypeError do servidor. A página `convenios/solicitacoes/[requestId]/page.tsx:43` chama CARE_TYPES.find, importado de `_lib/sadt-ui.tsx`, marcado com use-client. Essa [fronteira React](https://react.dev/reference/rsc/use-client) impede utilizar o valor no servidor como um array local. O diagnóstico usa a correlação fornecida e o código; não foi declarado como reprodução de uma jornada clínica por este operador.

Correção recomendada ao responsável do PR #55: constante em módulo compartilhado sem diretiva, importada em ambos os lados, mais teste de renderização RSC no build de produção. **Não requer migration ou alteração de dados.** O agente TISS já iniciou essa correção em seu próprio worktree: constants.ts, import servidor ajustado e testes de fronteira/página presentes. A inspeção foi somente de status/diff; alterações não foram copiadas nem validadas como commit. Portanto, build e tipos aprovados **não encerram essa falha funcional conhecida**. O próximo fechamento exige o SHA corrigido e a prova RSC do responsável, sem repetir as cinco compras financeiras.

A URL afetada é de **Preview TISS**, apesar da tag Sentry production. No SHA 9b463168, client/server usam NODE_ENV como ambiente; a candidata financeira já diferencia VERCEL_ENV/NEXT_PUBLIC_VERCEL_ENV e tem testes dessa política. Não alterar Production para corrigir a classificação de um Preview. Nenhum erro financeiro AbacatePay é demonstrado por esses dois eventos.

Smoke HTTP do build combinado: login 200 com shell Qoro/“Carregando acesso” e cron financeiro anônimo 401 (unauthorized), sem disparar processamento. É prova da fronteira HTTP, **não do login hidratado completo**; este já tem prova financeira no Preview efdf4722. O acesso foi pela CLI autenticada da Vercel e não comprova que o Preview seja público. O readback nominal final manteve Production no SHA 5620a098, sem alterações de configuração. **NO-GO da publicação conjunta permanece**, com as causas separadas na matriz.

## 52. Reconciliação final com TISS e prova operacional — 13/11/2026

Esta seção substitui os estados correntes da §51, preservando as evidências históricas. Inputs: financeiro `5144e6b5` mais o diff desta revisão; TISS `e14408d3d947ec426c36abd390d5f4c3002264c8`. Não houve merge, DDL compartilhado, alteração no worktree TISS, novo checkout, pagamento ou escrita em Production. O PR53 permanece draft. O registro verificável é `finalTissReconciliation` no [JSON canônico](evidencias/recuperacao-financeira-20261111.json).

### A. Banco e integração

Readback DEV em 13/11, 02:43 UTC: projeto `pqhkirrszzpwezdaqrai`, **160 entradas** Drizzle; 0144–0158 presentes e 0159 já aplicada, com when `1795036973858` e SHA256 LF `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74`. **Não reaplicada.** As seis diferenças históricas anteriores a 0144 continuam documentadas, sem reescrever hashes. Os SQLs 0143–0158 e schema do pin e144 não mudaram desde a aplicação DEV. Foram lidas definições de 45 relações financeiras/TISS: índices prontos/válidos, constraints validadas e segurança das tabelas privadas conferidos. Fingerprints de 227 tabelas preexistentes permaneceram iguais durante a auditoria. Zero invoice cruzada e zero ciclo duplicado.

Os journals raiz das duas branches independentes não são iguais ao journal composto: financeiro termina em0142; TISS não inclui a faixa financeira0136–0142. O gerador/manifesto reproduz a união160 com os SQLs imutáveis e a0159 congelada; não é permitido substituir um journal aplicado para ocultar divergências. Os cinco contratos DEV sem titular ativo se dividem em **dois fixtures e2e-hi do proprietário TISS e três registros históricos**. Não foram alterados, atribuídos ou removidos. Isso não demonstra órfão equivalente em Production.

Na cópia descartável composta: tipos, lint, arquitetura e build Next passaram; **711 testes TISS PASS e três SKIP preexistentes do corpus XML sem bytes por desenho**, sem novo SKIP. O teste estrito de journal passou7/7. PostgreSQL real: financeiro125; ledger18; glosas/pagamentos16; conciliação19; repasses12; coparticipação8; SP/SADT11; união10; gate premium11. São escopos distintos, não uma soma de casos únicos ou de pagamentos externos.

Dois helpers de teste pressupunham a ausência da faixa financeira e usavam git relativo a uma subpasta; a fixture premium tentava liberar trial apenas mudando status. A composição foi ajustada **somente na cópia**: verifica igualdade dos SQLs antes de deduplicar e prova que status active sem pagamento continua negado, inserindo depois invoice sintética e passando pelo markInvoicePaid real. Patch revisável: [compatibilidade dos harnesses](migrations/tiss-composition-harness.patch). Nenhum guard comercial foi desativado.

O responsável TISS publicou posteriormente `e2d0cf1f` (configuração/coparticipação) e mantém alterações locais em andamento. A leitura do delta commitado não encontrou alteração de SQL/schema/contexto billing. **Esta prova não homologa automaticamente esse código posterior**; a composição final de publicação deve fixar os SHAs escolhidos e revalidar só o delta afetado. Nenhum trabalho do outro agente foi copiado para sua branch.

### B. Financeiro

As cinco contratações iniciais Sandbox, o fechamento/readbacks, o MFA e a notificação414eb196 anteriores continuam válidos no escopo registrado. Nenhum pagamento foi repetido. Os125 checks financeiros e o scanner22 cobrem pagamentos, estornos, proveniência, idempotência, calendário, ausência de webhook e mais de10.000 movimentos por finalidade. A prova operacional nova usa provedor HTTP **sintético**, não comprova renovação externa.

Renovação mensal natural, alteração de plano efetivada em uma renovação e os eventos negativos não simuláveis continuam **PARTIAL externo**. A resposta do suporte confirma que não existe acelerador de assinatura no Dev mode nem listagem de faturas por subs_. A configuração de vencimento futuro não é uma cobrança observada. Risco: extensão tardia de acesso ou necessidade de revisão financeira se a evidência externa estiver incompleta; impacto alto, probabilidade não quantificável com as amostras disponíveis. Controles: inbox durável, receipt por identidade, scanner com cursor/fencing, revisão explícita de ambiguidades, alerta/backlog e aquisições limitadas. Não houve aceite formal desse risco nesta rodada.

### C. Infraestrutura e Preview

O erro Sentry **7845728659**, Preview de13/11 03:02 UTC, foi reproduzido: o deployment composto não recebeu os cinco overrides Sandbox restritos à branch financeira. A ausência da configuração levou ao fallback legado e ao guard `provider_operation_unavailable`. Não era evidência de erro de cobrança em Production. A página agora apresenta estado específico de indisponibilidade, sem controles Asaas para AbacatePay; erros inesperados de banco continuam propagados. Teste de regressão:6/6.

Preview corrigido: **https://project-m6qti314r-clinic-os-v2-s-projects.vercel.app**, deployment `dpl_7DwFaKuAJxSrbHAUGNUdJeQnhmDW`, READY. Foram resolvidos somente os cinco valores Preview da branch em memória e aplicados como overrides do deployment; nenhuma variável persistente ou Production foi alterada/lida pelo valor. Aquisições continuam fechadas. A clínica sintética já paga foi reutilizada: login real, readback, tela em1440/390px, cota5 médicos, recusa de checkout repetido e gates pagos passaram, sem erro de browser e sem nova compra. O503 exato de nova aquisição é esperado pelo kill switch false, não um pagamento falho.

O TISS e144 contém a constante compartilhada que corrige CARE_TYPES e os ajustes XSD/WASM/pool; o build composto e os testes SP/SADT/XSD passaram. A prova de navegador TISS do responsável permanece vinculada ao seu código; **não foi repetida uma jornada TISS autenticada na composição**, pois as credenciais dos fixtures são do proprietário e o navegador conectado estava indisponível. Não resetar fixtures para conseguir essa prova. Isso continua gate do módulo TISS, operacionalmente desligado para clínicas reais, e não é licença para habilitá-lo por pagamento SaaS.

O bundle composto inicial confirmou inicialização Sentry preview e nenhuma production; o evento real reportado também tem tag preview. Não foi criado novo alerta. A entrega414eb196 e MFA anteriores não foram refeitos. Source maps/alertas live ainda devem integrar a janela final.

### D. Escala e falhas — infraestrutura local isolada

Novo harness `QORO_ABACATEPAY_OPERATIONAL=1`: rota real de webhook através de HTTP Node loopback, HMAC real, Redis7.4 Docker com ponte REST local executando EVAL real, inbox/leases/worker do app e PostgreSQL migrado. Provedor HTTP sintético, sem chave real. Redis e banco foram de fato interrompidos e recuperados; worker filho foi encerrado após reservar e retomado após expiração **real de60s** do lease;429/Retry-After e cinco503 abriram o circuito; houve recuperação sem duplicação. Cache de extrato sintético teve apenas a idade de frescor controlada; períodos financeiros, vencimentos e leases não foram antecipados.

| Clínicas / concorrência | Par de entregas por clínica: p50 / p95 / p99 | Vazão de pares/s | Backlog antes → depois | Drenagem |
| --- | --- | --- | --- | --- |
|100 /1|1195 /2569 /3116ms|0,79|1 →0|1,38s|
|500 /2|807 /2303 /3839ms|2,28|39 →0|17,14s|
|1000 /4|298 /1533 /2438ms|6,24|91 →0|82,49s|

As coortes são progressivas e repetem os eventos já aplicados da rodada anterior: não comparar esses percentis como ganho causal ou1000 novas compras simultâneas. Foram6680 leituras ao provedor sintético,15564 comandos Redis, zero vínculo financeiro cruzado, zero ciclo duplicado e zero erro nas invariantes finais. HTTP:1201 respostas200,870 respostas202,1133 respostas503 por backpressure/falhas injetadas e uma401 intencional. Portanto não existe taxa de erro HTTP zero; a garantia provada é recuperação final idempotente dos eventos persistidos. Memória máxima amostrada do processo principal254MiB,13 conexões DB e3 waiters de lock; CPU do processo270s user/182s system. Contagem de waiters não mede duração de lock; o histórico de duração de transação está na prova de domínio anterior.

**Limites:** isto não certifica Vercel, Redis gerenciado ou capacidade/latência real da AbacatePay, nem o RTO total. O worker local foi drenado até zerar e não equivale ao cron de minuto, batch10 e orçamento35s do ambiente publicado. O Preview não executa cron automaticamente. Recomenda-se piloto limitado a **até10 clínicas explicitamente listadas**, como limite operacional conservador sujeito a aprovação, sem promessa de SLA. Conferir inbox recebido/idade/retry/review e capacidade antes de expandir. A lista máxima100 do código é um teto de configuração, não capacidade certificada.

### E. Segurança

Trial14 dias desde Auth permanece com cotas e sem integrações operacionais/convites; pagamento comprovado libera somente recursos do plano, sem habilitar TISS ou IA indisponíveis. Foram preservados RLS, multi-tenant, HMAC, deadlines, circuitos, hashes e contratos Asaas. Nenhum segredo está nas evidências. Testes de carga não tocaram DEV compartilhado. Os quatro arquivos de vídeo previamente removidos do worktree financeiro foram preservados como alterações alheias e excluídos do commit.

### F. Decisão de release

- **GO técnico condicionado:** código financeiro e composição fixada e144 com provas locais/Preview positivas; confirmar CI do commit final deste incremento. A referência posterior do TISS requer revisão do delta antes de eventual publicação conjunta.
- **NO-GO operacional live:** falta configurar/validar catálogo, loja, segredo/webhook, agenda, observabilidade Production, responsáveis e cohort; renovação externa depende de observação ou aceite formal específico.
- **NO-GO comercial:** nenhuma autorização nesta rodada para cobrar clientes reais, migrar contratos, aplicar Production, fazer merge ou deploy.

A chave ABACATEPAY_API_KEY já existe em Production e não deve ser recriada nem usada neste ensaio. A próxima decisão humana é a avaliação do risco residual de renovação e do piloto proposto; isso não substitui os preflights técnicos da futura janela. A CI e o SHA definitivos devem ser conferidos no PR53 antes de qualquer GO, sem atribuir7139 testes da baseline a este diff.

## 53. Composição atual, fechamento live preparado e piloto — 13/11/2026

Este checkpoint substitui as decisões correntes anteriores. Base financeira16d9062b mais este incremento; TISS fixado em4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269. O intervalo e144→bf59 acrescenta configuração, coparticipação, exportação assíncrona delegada e ajustes mobile; bf59→4d0 altera somente testes, fixtures e documentação, sem runtime, SQL, schema, journal ou dependências. Os arquivos em edição do proprietário não foram importados. Fonte e resultados finais estão em liveFinalization no [registro canônico](evidencias/recuperacao-financeira-20261111.json).

### A. Desenvolvimento e integração

Implementado um export de composição reproduzível em scripts/security/abacatepay-code-composition.ts: recebe dois SHAs completos, usa objetos Git imutáveis, admite somente os três conflitos conhecidos, aplica patches revisados e journal160/0159 de hash congelado, regenera inventário e recusa sobrescrever um export anterior. Não faz merge, não escreve em outro worktree nem em banco. O pacote composto precisa passar por tipos/lint/build/regressão próprios; a projeção por si só não é validação.

DEV auditado somente por leitura:160 entradas,0159 já aplicada e não reaplicada;45 relações financeiras/TISS,227 fingerprints preservados durante a auditoria, sem invoices cruzadas ou ciclos duplicados. A contagem corrente de contratos DEV sem titular ativo é **seis: três fixtures TISS e três registros históricos**, corrigindo a fotografia anterior de cinco. Nenhum vínculo foi inventado ou alterado. Não inferir desse DEV a existência de órfão em Production.

PostgreSQL descartável: **129/129 verificações financeiras**, sem I/O externo; inclui as125 anteriores e quatro novas provas de fechamento live sintético. Composição SQL/journal:9/9 no migrator real,144→160, segunda execução noop e rollback em lock. Na composição bf59 foram aprovados os harnesses configuração13, lote assíncrono10, premium11 e cadeia10. Os demais testes compartilhados permanecem nas evidências anteriores, pois seus arquivos não mudaram. O novo delta4d0 não altera runtime/DDL e não exige repetir carga financeira TISS.

### B. Financeiro e consumidores live preparados

A lacuna operacional encontrada era o fechamento disponível somente pelo operador Sandbox. A candidata agora seleciona, no cron já existente, **uma geração live paga por tick**, exige invoice integral, binding, loja, cliente, assinatura e produto corretos, atesta devMode=false, usa journal durável e registra auditoria idempotente. Nenhuma transação de banco atravessa HTTP. Timeout fica unknown e não repete DELETE; a assinatura e o período pago não são revertidos. As cinco fixtures Sandbox retidas não são encerradas automaticamente. A janela entre pagamento e fechamento ainda é risco R1; não existe promessa de link absolutamente de uso único.

O watch de renovação passou a integrar o mesmo tick de minuto, junto à recuperação/inbox/outbox e ao fechamento. Os cinco trabalhos independentes são aguardados com allSettled; falha impede heartbeat de sucesso. Não houve alteração de agenda, vercel.json, plano ou variável persistente nem contratação. O custo das leituras adicionais no ambiente-alvo ainda não foi medido. O Preview não recebe cron automático. O ensaio local chama as mesmas funções do runtime, sem afirmar que mediu o scheduler remoto.

As cinco compras197/397/544/691/838 e a prova externa de fechamento/readbacks continuam preservadas. Nenhuma compra, pagamento, refund ou cancelamento externo novo foi executado. Renovação natural, change-plan efetivado em novo ciclo e eventos negativos não simuláveis permanecem PARTIAL externo. O [dossiê de risco/piloto](PLANO-FINAL-GO-LIVE-ABACATEPAY.md#dossiê-de-decisão-e-piloto-executável--13112026) separa probabilidade desconhecida de impacto alto e propõe critérios de observação/aceite, sem retirar requisito ou aceitar risco pelo founder.

### C. Segurança e rotação

Foi preparado ABACATEPAY_WEBHOOK_PREVIOUS_SECRET, opcional e privado: JSON com secret e expiresAt UTC absoluto, sobreposição máxima24h, comparação segura e HMAC obrigatória. O segredo anterior expira no instante configurado; o atual continua válido. Conta, modo, hash e inbox únicos não foram flexibilizados. Cinco testes novos cobrem sobreposição, duplicata entre os dois segredos, expiração exata, assinatura inválida e configuração inválida. **106/106 testes dirigidos** em cinco arquivos passaram; tipos/lint e gates finais têm registro próprio. Nenhuma rotação de provedor real ou variável Production foi executada.

Production foi conferida nominalmente, sem ler valores: deployment dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP/SHA5620a098 preservado. A APIkey já existe; catálogo/loja/segredo live, seletor/ambiente e cohort/flag ainda não foram configurados. O auxiliar exato retornou404 e não foi removido novamente. Quatro deleções preexistentes de vídeos foram excluídas dos commits desta revisão.

### D. Escala e resiliência

A carga100/500/1000 já aprovada foi preservada, sem repetição. O perfil novo pilot usa10 clínicas sintéticas, HTTP/HMAC reais locais, Redis Docker real, PostgreSQL migrado e dois workers filhos com ticks reais de60s. A idade de72h é simulada coerentemente nos eventos, pagamentos e períodos; não representa três dias realmente aguardados. Backoff/leases usam relógio real. Pane de Redis/banco,429, circuito503 e worker morto continuam exercitados. A prova de pagamento sem webhook usa receipt, período e checkout original coerentes, não ACTIVE isolado.

Tentativas reprovadas foram mantidas nos logs locais: uma fixture antiga associava evento de72h a pagamento de hoje e foi corretamente recusada; outra não fornecia período/checkout da descoberta e foi para revisão. Corrigiram-se apenas dados sintéticos. Um teste XSD de injeção de memória atingiu primeiro o timeout sob execução paralela; o reteste serial23/23 passou sem modificar o teste ou o guard TISS. A execução composta final e os resultados operacionais completos são vinculados ao pacote no JSON; não herdam o PASS de um código anterior.

### E. Operação, piloto e decisão

Proposta executável: uma clínica nova consentida, depois até3 mediante conferência e decisão, até10 apenas com prova de ciclo ou aceite adicional. Cohort explícito e flag de aquisição não param obrigações emitidas. Limiares propostos, responsáveis, cobertura, leitura de invoice/período/cota, critérios de parada e rollback compatível estão no dossiê/runbook; não são SLA ou autorização. Sem nomes reais de operação, configuração live e aprovação de risco/janela, não há piloto autorizado.

**GO técnico condicionado** aos checks do commit final e ao pacote composto fixado. **NO-GO operacional live** até catálogo/webhook/consumidores/alertas/responsáveis/risco preparados e autorizados. **NO-GO comercial e de Production:** nenhum merge, deploy, DDL, cobrança ou migração de contrato real autorizado nesta rodada. Asaas de pacientes, contratos legados, anuais existentes, descontos e gates TISS permanecem preservados. A próxima ação humana é decidir o risco residual e a população/responsáveis do piloto após receber as evidências finais; não repetir pagamento, MFA ou alerta já comprovados.

**Resultado operacional final:** PASS,13/11 11:15:42–11:20:36 UTC. Dez eventos de idade simulada72h recuperados em4 ticks,10→10→4→1→0,201,87s; dois processos frios por tick,8 partidas, p50 de inicialização6,94s/p95 19,32s. Pagamento sem webhook recuperado uma vez pelo seam real de recuperação, sem evento fabricado.187 GETs sintéticos,446 comandos Redis,14 conexões DB máximas amostradas, memória do processo principal202,7MiB. As14 respostas503 foram falhas/backpressure intencionais e não uma taxa zero de erro. Sem retentativa de transporte no run final, sem acesso externo. Não mede capacidade serverless, RTO completo, tempo real de72h ou renovação temporal externa.

### F. Evidência final do pacote e checks

Código publicado na branch draft: **1703b3f2acfa4f31d1c74a3d1649d532bc1a4ecd**. [CI43416581923](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43416581923) SUCCESS: **7.147 testes/631 arquivos e22 E2E semSKIP**, tipos/lint/build/cobertura/isolamento/segurança aprovados; Semgrep/Snyk/VercelSUCCESS. Agent Review NEUTRAL não é revisão humana. O commit documental posterior registra estes resultados e não muda runtime; seus checks próprios são conferidos no PR53.

Composição exportada1703b3f2 +TISS4d0ed1d5, árvore projetada adbaee2de72aae6366d871a4ad6c6dd83859d49e,160 entradas: **tipos PASS** após heap local4GiB, **lint PASS**, **836 testes PASS/54 arquivos**, três SKIP preexistentes do corpus XML e zero falha. O primeiro tsc esgotou o heap Node2GiB sem diagnóstico TypeScript; o reteste não mudou configuração, código, CI ou guards. O proprietário avançou depois para82049a79: leitura do delta confirmou nenhuma mudança src/drizzle/package/lockfile; não foram incorporados seus arquivos locais nem provas novas sem execução.

**Preview final READY:** https://project-gepwnmxih-clinic-os-v2-s-projects.vercel.app — deployment dpl_Ag4mvsaUTPHbX6hhxbFKdg6etLgR. Os dois inputs foram conferidos por metadata autenticada e composition-inputs.json; não é um merge Git. Login real, readback DEV/invoice/assinatura, desktop1440/celular390, cota5, gates pagos e recusa de checkout repetido passaram, sem nova compra. Os18 bundles lidos contêm inicialização Sentrypreview, nenhuma production e a release **qoro-financial-1703b3f2-tiss-4d0ed1d5** em dois bundles. Não equivale a novo alerta entregue ou simbolicação verificada no painel.

Readback final de Production continua dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP/SHA5620a098, sem ler valores ou alterar configurações. Auxiliar404 preservado. Nenhuma migration compartilhada, envio, cobrança real, merge ou contrato modificado. Os quatro vídeos removidos previamente continuam fora dos commits.

**Decisão final desta preparação:** GO técnico **delimitado ao código e composição comprovados**; não é Production Ready integral. NO-GO operacional live e comercial até configurar catálogo/loja/webhook/cron/alertas próprios na janela autorizada, nomear responsáveis/cohort, tratar formalmente R1–R4 e obter autorização de publicação/cobrança. A observação natural de um novo ciclo ainda é PARTIAL externo. Não há novo pagamento Sandbox ou instalação solicitado ao founder.


## 54. HOMOLOGAÇÃO FINAL PREVIEW/SANDBOX — R1 A R4 — janela de 13/11/2026

### A. Production: configuração concluída; consumidor ainda não publicado

Janela autorizada e encerrada em **13/11, 11:48:44–12:06:43, America/Fortaleza**. Founder confirmou disponibilidade, responsabilidade operacional e canal Sentry Production/chat. Projeto Vercel project-os, prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ, time team_ml9fFeF262JqUMwFB6Vy61Cj. O deployment dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP/SHA5620a098 permaneceu inalterado. Nenhuma migration, publicação, checkout live, assinatura, cobrança ou mudança de contrato.

A loja live store_EsLPwdCKpH4aSD3TcrYBZWMC (qoro.dev) respondeu autenticada. Antes: zero produtos/zero webhooks. Foram criados cinco produtos exclusivos live e uma segunda listagem independente confirmou **devMode=false, BRL, MONTHLY, ACTIVE, sem trial nativo**. A fonte dos valores é quoteProposedOffer, sem nova condição comercial:

| Plano | Médicos | Administrativos incluídos | Centavos | Produto live |
|---|---:|---:|---:|---|
|Consultório|1|3|19700|prod_SsBGWnFA5Qk1dED3DLRkzSDT|
|Clínica|2|3|39700|prod_4sn4YU2Q3P3jbXs3a6UXMgzd|
|Clínica|3|3|54400|prod_CXMmb0y0FJHRDFDsy0Lj4MAW|
|Clínica|4|3|69100|prod_pNectEHBe356SAystDzmMJbD|
|Clínica|5|3|83800|prod_YtHhRgEbMxLZasE5KsqS4s3c|

Vercel Production recebeu somente cinco nomes antes ausentes: ABACATEPAY_ENVIRONMENT=production, ABACATEPAY_STORE_ID, ABACATEPAY_PLAN_PRODUCTS, ABACATEPAY_WEBHOOK_SECRET e ABACATEPAY_NEW_CHECKOUTS_ENABLED=false. O segredo é exclusivo live, salvo como sensitive na Vercel e com DPAPI/ACL privada local, sem valor neste documento. Chave API e variáveis anteriores preservadas; SAAS_SIGNUP_PROVIDER não foi alterado; cohort live não selecionado. Configuração salva **não atualiza deployments existentes**. [Vercel](https://vercel.com/docs/environment-variables).

**Bloqueio comprovado, não bug novo:** a release Production atual não contém /api/webhooks/abacatepay; POST inválido retornou404. A API de criação do webhook não documenta campo para criá-lo desativado. Por isso nenhum webhook live foi cadastrado/ativado, nem consumidor/cron declarado operacional. A autorização exclui release e migrations; será necessário aprová-los numa janela posterior antes da entrega live. Não apontar pagamentos para o404. [Contrato oficial de webhook](https://docs.abacatepay.com/pages/webhooks/create).

**Alerta Production PASS:** um único evento sintético ed622a74, sem paciente/pagamento, foi aceito HTTP200 às12:00:45 de Fortaleza; founder confirmou a notificação correspondente. Não se atribui ao probe a prova de instrumentação financeira ainda não publicada. A API administrativa Sentry retornou401 nas alternativas oficiais e o navegador não pôde determinar a URL com segurança; nenhuma regra anterior foi editada.

Rollback desta configuração: conferir metadata/IDs no JSON canônico e remover **somente** as cinco entradas recém-criadas, se ainda inalteradas. Não apagar chave API, outras variáveis, webhooks de terceiros ou produtos; manter catálogo sem consumidor não cria cobranças. Não houve deployment para reverter. Um release futuro com pagamentos exige rollback próprio compatível com bindings e histórico, nunca restauração automática sobre pagamentos novos.

### B. Homologação independente de pagamento executada

O operador reconhecia apenas143/144 migrations e importava transporte antes de vincular o ambiente DEV. Agora confere hashes/when exatos do prefixo0136–0142 e da cauda revisada0143–0159, contra o manifesto congelado e SQL financeiro; rejeita parcial, drift e migration desconhecida. Não aplica/copía SQL nem altera TISS. Importação passa a ocorrer após os guards DEV. GETs têm retentativa limitada; POST desconhecido não recebe replay cego. Processos filhos preservam apenas os flags de proxy/CA autorizados, sem desativar TLS.

Nova ação stage prepara a contratação antecipada mantendo Auth real da fixture e trial absoluto14dias, executa login e a jornada real de escolha de plano, e exige zero checkout/operation/invoice/receipt e nenhuma liberação paga. A fixture ficou pronta:

- Run d2d0e84d-059b-4b29-9074-f3305a3fc97f; clínica8b12f2da-b881-4409-815f-a18ec71fd1c6; assinatura1c21ff83-9e46-4eee-bffa-d19aa2be9135.
- Preview imutável https://project-agdxvdvv9-clinic-os-v2-s-projects.vercel.app; SHA f493dccc. O runtime financeiro não mudou neste incremento, apenas tooling/testes/documentação.
- Trial termina27/11/2026 15:12:42.157 UTC, exatamente14dias desde Auth, sem envelhecimento artificial nesta fixture.
- **PASS** login, resumo1–5 médicos em1440/390, um clique para iniciar trial, persistência, assinatura desktop/mobile, botão de contratação opcional e integrações WhatsApp/Asaas bloqueadas. Zero erro de browser; zero checkout/pagamento novo. Auth foi confirmado administrativamente: não é nova prova de entrega de e-mail.
- Credencial sintética permanece em DPAPI/ACL privada; não enviar por chat. Fixture retida e retomável, sem limpeza por timeout. A mesma identidade foi usada após falhas transitórias de leitura; nenhuma duplicata criada.

**R4 adicional PASS:** perfil small em PostgreSQL migrado/Redis Docker/HTTP reais locais, provedor sintético. Uma clínica: p50/p95/p99 de ingresso duplicado3528,62ms; três clínicas:1532,32/1815,63/1815,63ms, backlog1→0 em5502,77ms. Zero ciclo duplicado/invoice cruzada,31GETs sintéticos,64 comandos Redis, pico amostrado7conexões/95,24MiB no processo. Amostras1/3 não são estimativa estatística nem SLA. Quatro503 foram backpressure intencional e recuperado. Provas anteriores10/100/500/1000 e falhas/leases preservadas, sem repetir cargas.

### C. Matriz de pagamento mínimo preparado — nenhum link criado

| ID | Risco/jornada | Por que precisa de pagamento novo | Fixture e produto | Valor / ambiente | Evento e verificação esperados | Reuso / irreversibilidade / fim |
|---|---|---|---|---|---|---|
|EARLY-01|R3 conversão antes do fim do trial; suporte à provaR1 na mesma geração|As cinco compras anteriores provam contratação inicial; não comprovam esta fixture com14dias ainda vigentes e retirada antecipada das restrições|Run/clínica acima; Consultório; produto Sandbox prod_NTxhdRJzM0cG5MgDeeF54RL2|R$197 mensal, somente Sandbox|subscription.completed autêntico + GETs; uma invoice paga/attempt/receipt, binding correto, período pago, cotas e gates/UI após novo login|Reutilizar mesma conta/intent; criar só após founder dizer “posso pagar”; pagar uma vez. Reter até conciliar. Fechamento remoto somente após prova integral, na geração identificada, sem cancelar assinatura automaticamente|

Não repetir197/397/544/691/838 como nova bateria básica. Renovação natural/change-plan/refund/disputa sem simulador não são resolvidos com outro checkout inicial. Não há valor inventado, link placeholder ou autorização de cobrança live. Antes de criar EARLY-01, repetir apenas preflight temporal (origem/loja/modo/produto/hash/checkout inexistente); criar pelo botão real do Preview, nunca diretamente pela API do provedor. A aplicação/operador fazem readback; não depender só de “paguei”. Se houver configuração alterada ou intent existente, reconciliar e reutilizar, não criar outra fixture.

### D. Riscos: prova delimitada e observação externa

|Risco|Prova preservada/ampliada|Estado residual / ação|
|---|---|---|
|R1 reutilização/fechamento|Uma closure Sandbox externa já comprovada; journal/CAS, duplicata, concorrência, timeout/unknown e automático live cobertos nos129PG; catálogo/secret live agora preparados|PARTIAL externo. O link não é nativamente de uso único. Não pagar novamente um link já pago. Consumidor automático Production depende do release autorizado; a janela pagamento→fechamento permanece risco não aceito|
|R2 renovação/conciliação|Receipts, eventos atrasados/ausentes/duplicados, calendário e ambiguidade nos129PG; scanner e recuperação reais locais; fixture paga retida|PARTIAL externo. Índice/CLI oficial revistos13/11: não foi localizado simulador de renovação de assinatura, apenas pagamento transparente. Manter observação do ciclo real; payload sintético não é cobrança externa. [CLI](https://docs.abacatepay.com/pages/cli/overview)|
|R3 ciclo de vida|Cancelamento/recontratação, próxima cota só no ciclo pago, trial/expiração/falhas/transação/negativos cobertos localmente; EARLY-01 preparada sem pagamento|PARTIAL externo. Pagar EARLY-01 após autorização específica; mudança de cota efetiva em renovação e refund/disputa continuam dependentes de eventos suportados. Sem estorno/cobrança real ou cancelamento de fixture retida|
|R4 capacidade/operação|1/3 adicionais PASS;10/ticks frios/Redis/DB/429/circuito/lease e100/500/1000 preservados; alerta live agora entregue|PASS isolado/PARTIAL alvo. Não mede scheduler/custo/capacidade do provedor/Vercel. Piloto live1→3→10 continua proposto, não ativado|

Nenhum R1–R4 foi aceito implicitamente. A confirmação do responsável da janela técnica não nomeia responsáveis/cohort do piloto comercial.

### E. Qualidade e limites

PASS7.161 testes/632 arquivos;64 dirigidos após alterações do operador, tipos/lint registrados. Os resultados de build/CI do commit final serão acrescentados abaixo após execução; o PASS7147/22E2E do baseline f493dccc continua preservado, sem ser atribuído antecipadamente ao incremento. O teste real de stage acima é separado da suíte pública. O primeiro build local encontrou UNABLE_TO_VERIFY_LEAF_SIGNATURE nas fontes externas; não flexibilizar certificados nem chamar isso de bug financeiro.

### F. Próxima decisão

A fixture de trial e as observações estão prontas; nenhum link foi criado. Consumidores/webhook live não podem ser fechados sem release/migrations especificamente autorizados. Ainda falta confirmar os gates do commit final. Não declarar Production Ready nem iniciar piloto, merge, migração de contratos, TISS/IA ou cobrança real. Depois de todos os gates de preparação, o founder poderá dizer “posso pagar” para gerar **somente EARLY-01**. Nenhuma compra adicional resolve artificialmente uma renovação futura.

**Validação local adicional:** o primeiro build também esgotou o heap padrão de2GiB. O reteste com CA confiável do Windows/4GiB foi cancelado por pressão de memória do host, sem mudança de CI/build do repositório. Um teste que inicia subprocesso atingiu20s sob essa carga; o reteste serial **64/64 PASS** manteve o timeout e os guards. Tipos e lint PASS. Build/22E2E públicos devem ser confirmados pela CI do commit deste incremento antes da conclusão.

**Build do incremento comprovado:** Vercel READY para `3b16386f256718cd13323471f26ef71e414f452a`, deployment `dpl_7iCXDyLzWtLCQViriZKrkz3rt92P`, https://project-edr23fzoi-clinic-os-v2-s-projects.vercel.app. A limitação local de certificado/memória não foi omitida nem contornada. O delta de src/package/lockfile/drizzle desde1703b3f2 contém somente dois arquivos de teste; o runtime da composição TISS validada continua aplicável.

**Fixture reconciliada após o build:** a origem do webhook Sandbox é o alias da branch e acompanha o deployment novo. Preflight de3b16386f comprovou novamente modo/loja/cinco produtos/assinatura DEV/histórico160 e401 de autenticação inválida. Sob lock local e transação READ ONLY, conferiram-se UUID/marker/owner/plano e zero checkout/operação/invoice/release. Somente origin/sha do manifesto privado foram atualizados, com cópia anterior preservada; nenhuma linha de banco ou provedor foi modificada nessa reconciliação. A mesma conta passou de novo no login/assinatura1440/390/gates sem checkout em https://project-edr23fzoi-clinic-os-v2-s-projects.vercel.app. Comandos futuros usam a origem do manifesto, não um endereço antigo fixo.

**CI3b16386f:** run43454379507 aprovou7.161 testes/632 arquivos e cobertura, tipos/lint/arquitetura; reprovou no documento gerado de inventário desatualizado. Regenerado docs/security/acoes.md pelo comando oficial e revisado:31linhas de diff, apenas referências dos scripts/contagem531→532, nenhum guard ou registro público removido. Check localPASS com0guard pendente/0variável pública sem registro/0teste de rota regredido. Semgrep/Snyk/VercelSUCCESS. Build e22E2E da CI completa do HEAD devem ser conferidos nos [checks atuais do PR53](https://github.com/joaomarcos-techia/Project_OS/pull/53/checks); não se apresenta a execução reprovada como sucesso integral.

**Continuação após EARLY-01:** a mesma fixture nova poderá servir aos comandos nativos de mudança de plano no próximo ciclo, mediante conferência do contrato/API antes da mutação, conservando o período e a cota pagos atuais. As cinco fixtures anteriores não serão alteradas apenas para esse ensaio. Agendamento/readback remoto e aplicação numa renovação são provas distintas; o segundo continua dependente de ciclo real, não de outro checkout inicial.

## 55. EARLY-01 paga e incidente de hidratação — 13/11/2026

Este é o checkpoint corrente. Preserva a seção 54 como histórico: o founder autorizou expressamente a criação e depois realizou o pagamento. **Não criar nem pagar novamente EARLY-01.** O código executado foi `dc95caa4eb15827049f27d2e7e6c00994017f17d`, Preview `dpl_AFDdqxqM3a4Cs7v25SVC25ZUuk1F`, [origem imutável](https://project-7nu27u287-clinic-os-v2-s-projects.vercel.app). A [CI 43457077686](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43457077686) concluiu SUCCESS: 7.161 testes/632 arquivos e 22 E2E sem SKIP, build, tipos, lint e segurança. Os checks próprios do commit documental posterior devem ser conferidos no PR; não atribuir antecipadamente o resultado do código a outro SHA.

### A. Conversão antecipada: PASS externo Sandbox + banco + interface

O preflight confirmou DEV `pqhkirrszzpwezdaqrai`, metadata Preview, loja e produtos com `devMode=true`, preço do servidor 19700, produto Consultório `prod_NTxhdRJzM0cG5MgDeeF54RL2`, webhook na mesma release e rejeição 401 de autenticação inválida. Antes do pagamento: trial, sem invoice/receipt/liberação paga; uma única operação de criação. Reutilizada a identidade sintética da seção 54; nenhum novo usuário e nenhuma repetição das cinco compras anteriores.

| Registro | Evidência real |
|---|---|
| Checkout | `bill_KJRNEFgyUExtx4EKFwZA2WFk`, criado pela interface Qoro, R$ 197, Consultório/1 médico, somente Sandbox |
| Assinatura remota | `subs_e1A14YHx3uK3sFWYPEJpna2F`, ACTIVE, CARD, `devMode=true`, sem trial nativo, cliente/produto/loja vinculados |
| Pagamento | `card_bBQD4TCMWH4yRZ00YT2ubhZg`; checkout PAID, valor pago 19700 conferido no provedor antes do fechamento |
| Webhook/inbox | `log_jaLBkPph3zryHCuUUcJPndXS`, `subscription.completed`, recebido 17:44:28.510671 UTC, aplicado 17:44:31.926163 UTC, uma tentativa |
| Invoice | `98938ed5-b274-48bc-a22c-e03bac03ef7d`, uma invoice paga de R$ 197; uma payment_attempt confirmada e um paid_checkout |
| Período Qoro | 13/11 17:44:27.418 UTC até 13/12 17:44:27.418 UTC; início anterior ao fim do trial de 27/11 15:12:42.157 UTC |
| Liberação | `released_by_invoice_id` aponta para essa invoice; liberação 17:44:31.926163 UTC; cotas do plano: 1 médico e 3 administrativos |
| UI paga | Login real, assinatura desktop 1440/celular 390, pagamento confirmado, nova contratação recusada 409/already_paid, gates temporários WhatsApp/Asaas e convite retirados; nenhum erro de página |

O período acima é o calendário de **acesso do Qoro**, não uma afirmação sobre próximo débito no provedor. Autenticação do evento é requisito do endpoint que persistiu o inbox; o readback financeiro independente também conferiu valor e vínculos. Não é prova de liquidação em saldo nem de renovação mensal externa.

Readback operacional posterior: **TISS habilitado=0, WhatsApp ativo=0, conta Asaas ativa=0, conversas de IA=0** nesta clínica sintética. Pagar retirou a restrição temporária; não conectou integrações, não iniciou IA e não habilitou TISS. Isso não substitui a homologação de todas as ações do PR55 nem concede direitos de outro plano/perfil.

### B. Fechamento e idempotência: provas distintas

Fechamento controlado **Sandbox** pelo seam existente `closeConsumedAbacatePayCheckout`: journal `close_paid_checkout=confirmed`, um evento `subscription.checkout.closed` às 17:57:23.677730 UTC. Leitura independente posterior: checkout ausente da listagem, assinatura ACTIVE preservada, invoice, comprovante, período e vínculos preservados. Nenhum cancelamento, estorno ou segundo pagamento.

**Não foi fechamento automático Sandbox.** O código reserva fixtures Sandbox ao operador; o fechamento automático live continua coberto pelos ensaios PostgreSQL anteriores e depende de release autorizado. Ausência da listagem não demonstra, sozinha, que o link hospedado jamais aceitará outro pagador. R1 permanece delimitado, sem aceite implícito.

Reapresentação interna dos mesmos IDs/hash ao inbox: `duplicate`. Worker direcionado ao mesmo evento: zero scanned/applied/review. Recuperação direcionada à assinatura já ativa: zero nova aplicação. Comparação integral de contrato, invoice, tentativa, receipt, inbox, operações e auditoria: inalterada. **Não foi replay HTTP HMAC externo** nem uma segunda entrega fabricada do provedor. Falha de cota, tenant incorreto, timeout, lease e rollback continuam com as provas isoladas anteriores; não foram induzidos no DEV compartilhado.

Um assert inicial do harness falhou por representação temporal: importar Drizzle alterou os parsers do client de leitura, comparando `Date` truncado a milissegundos com timestamp textual contendo microssegundos. Corrigida a consulta do harness para comparar `timestamptz::text` desde o início; reteste PASS com mesmos registros. O fechamento já confirmado não foi repetido. Também ocorreram falhas transitórias `UND_ERR_SOCKET` em GETs locais; nenhuma retentativa cega de POST e nenhuma alteração de estado para encobri-las.

### C. Issue 7730223576 / R51: FAIL reproduzido, causa raiz ainda aberta

| Fonte | Ambiente/deployment confirmado | Resultado |
|---|---|---|
| Evento fornecido pelo founder | Preview TISS, SHA `60cd228c2d01dc218be58fbc93e34f957458c84a`, `dpl_GwhzTXoVX63JyiYXnKjx2Q8soVfp`, [release exata](https://project-cc1euw7yp-clinic-os-v2-s-projects.vercel.app) | Breadcrumb de #418 seguido de `$RS`/parentNode; não é evidência de Production afetada |
| Preview TISS seguinte | SHA `a04a153586d6557bb0cd71306516a6e978dc4375`, `dpl_HvDg8AxSmmuGCuLQy747iycWP5JK`, [origem imutável](https://project-lpl2nfr41-clinic-os-v2-s-projects.vercel.app) | #418 reproduzido no dashboard, Chromium limpo, pt-BR/Tóquio/1440. HTTP200, h1/main presentes e sem error boundary após recuperação; 1 ocorrência em 7 navegações concluídas antes de um timeout do harness mobile |
| Release exata, repetição | Mesmo `60cd228c` | 20 navegações + 2 verificações de logout em Tóquio/São Paulo, desktop/mobile, sem pageerror nessa amostra |
| Ensaio instrumentado | Mesmo `60cd228c`, Chromium/CDP, 1500 kbps, latência 20 ms | 8 cargas/recargas + logout, sem falha capturada; não comprova eliminação nem origem |
| Preview financeiro | `dc95caa4`, mesma conta EARLY-01 paga | 20 navegações + 2 verificações de logout, desktop/mobile e ambos os fusos, sem pageerror; checkout/ativação pagos também passaram separadamente |

A primeira bateria adicional foi interrompida por seletor de navegação mobile antes de hidratar; o harness passou a esperar e abrir o menu real. Tentativas posteriores de login atingiram timeout, sem diagnóstico suficiente para atribuir ao produto. Não apagamos contadores, burlamos CAPTCHA ou alteramos o limiter. A execução final financeira, após intervalo natural, concluiu as 22 verificações. Resultados incompletos não foram contados como PASS.

**Confirmado:** #418 indica divergência de hidratação ([React](https://react.dev/errors/418)); o helper inline `$RS` do React procura o segmento e o placeholder por ID, remove o contêiner temporário e insere seus filhos no pai do placeholder. Um `null` nessas buscas explica a classe `parentNode`; o nó/ID e a causa da remoção no evento original **não foram capturados**. A versão canary é vendorizada no Next App Router; o projeto fixa Next15.5.28 e React19.2.6. Nenhum upgrade/downgrade especulativo.

**Hipóteses abertas:** corrida entre parser/hidratação/streaming e substituição da árvore após #418; cache/navegação concorrente; mutação externa do DOM. Há [relato upstream com assinatura semelhante](https://github.com/react/react/issues/37321), mas isso não prova a causa no Qoro nem autoriza aplicar o workaround ao scheduler. Fuso diferente é contexto de reprodução, não causa demonstrada. Datas do dashboard são produzidas em Server Components; não se concluiu que a correção de datas de outros componentes do PR55 resolveu este incidente.

Próximo experimento do responsável pela UI/TISS: estender `e2e/hydration-r51-preview.spec.ts` para cargas com chunks quentes e rede fragmentada; capturar, no throw, fiber esperado, cursor de hidratação, `document.readyState` e IDs B:/P:/S: sem conteúdo clínico; comparar entrega streaming com resposta integral da mesma fixture. Preservar a recusa de qualquer pageerror. Nenhum `suppressHydrationWarning`, desligamento de SSR, tolerância ao #418 ou supressão do Sentry foi adicionado.

### D. Classificação Sentry: correção já existente no PR53, pendente de composição no PR55

Leitura de bundles dos releases exato/atual TISS: 19 scripts por release, inicialização `production=1`, `preview=0`. Fonte: `src/instrumentation-client.ts` usa `NODE_ENV`, que também é production no build Preview. No Preview financeiro: 18 scripts, `preview=1`, `production=0`, SHA correspondente presente. A correção existente `a5984e23` usa `NEXT_PUBLIC_VERCEL_ENV`, com fallback local, e mantém `VERCEL_ENV` no server/edge. **17/17 testes** de ambiente/sanitização passaram nesta rodada. Não duplicada nem aplicada unilateralmente no worktree TISS.

Sentry API de issue/latest retornou401; os sourcemaps pareados aos main-app chunks dos três deployments retornaram404. Não foram usados mapas de outro SHA nem declarada simbolicação completa. `$RS` é código inline de streaming; a classificação errada não é sua correção. O alerta Production `ed622a74` foi preservado; nenhuma regra editada, novo probe deliberado ou evento histórico alterado. A reprodução do #418 pode gerar captura natural pelo SDK da Preview; sem acesso à API não se afirma ausência de novos eventos/notificações dessa captura.

### E. Decisão e próxima ação

EARLY-01: **PASS delimitado** para pagamento antecipado, aplicação real, período, cotas, UI e idempotência; fechamento Sandbox controlado comprovado. Automático live e renovação externa permanecem PARTIAL. R51: **FAIL de hidratação reproduzido / causa PARTIAL**, com encaminhamento ao PR55; `parentNode` atual não foi reproduzido. Dados detalhados, comandos e separação das provas no JSON canônico, chave `earlyPaymentAndHydration20261113`.

Nenhuma migration, mudança de runtime/configuração/CI, contrato real, merge, deploy Production ou nova cobrança real nesta rodada. Quatro remoções anteriores de vídeos continuam fora do commit. PR53 e PR55 em draft. **NO-GO para ativação financeira em Production** até consumidor/schema compatíveis, R1–R4 tratados, responsáveis/cohort definidos e autorização específica; a composição final também deve tratar o R51. Não pedir novo pagamento para repetir EARLY-01.

## 56. Consolidação EARLY-01 e observação reutilizável — 13/11/2026

Baseline confirmado: PR53 OPEN/draft em1078332d, CI43505580904 SUCCESS com7161 testes/22E2E semSKIP; PR55 OPEN/draft ema04a153586d6557bb0cd71306516a6e978dc4375. Os quatro vídeos removidos anteriormente foram preservados fora dos commits. **EARLY-01 é PASS de contratação antecipada Sandbox** no runtime dc95caa4: o conjunto financeiro e as22 navegações do§55 permanecem congelados. Nenhuma compra, conta, cobrança, closure ou ativação foi repetida.

### A. Observador real de renovação, sem mutações

Implementados `scripts/abacatepay-observe-renewal.ts` e a classificação testada em `scripts/abacatepay-renewal-observation.ts`. Reutilizam manifesto verificado, marker do usuário sintético, loja por hash, vínculo completo, conexão DEV guardada, client central e reader Sandbox. Apenas GET e transações REPEATABLE READ/READ ONLY; sem senha, sessão de navegador, comando financeiro, replay ou alteração de direitos. A observação antes/depois dos GETs precisa ser idêntica; alteração concorrente exige repetir somente a leitura.

Execução real em21:21:11UTC: ACTIVE/CARD, próxima cobrança oficial `2026-12-13`, período Qoro até `2026-12-13T17:44:27.418Z`, closure confirmada, zero ciclos novos, um completed aplicado. Resultado `awaiting_next_cycle`; data oficial não foi inferida do período do app. **Isso não comprova que a renovação ocorrerá nem antecipa PASS externo.** O observador identifica duplicidade/inconsistência de receipts/invoices, acesso estendido sem ciclo e status desconhecido como revisão. Ciclo registrado localmente ainda exige conferência externa; não substitui os readers financeiros/worker existentes.67 testes do observador/manifesto PASS, incluindo15 casos novos. Nenhuma variável de serviço nova.

### B. Fechamento automático:131 checks PostgreSQL PASS

O harness existente recebeu dois cenários: falha nos GETs anteriores ao comando, sem POST e sem bloquear outro link pago; crash com reserva running preservada, sem novo POST para aquela obrigação e sem impedir outra geração. Rodaram funções reais, journal/CAS e Redis Docker, PostgreSQL migrado e HTTP de provedor sintético: **131/131 PASS, zero rede externa**. Falha de readback após reserva fica unknown para revisão; não se promete retry automático quando não há garantia de ausência de efeito. Assinatura/invoice/período permaneceram intactos.

O primeiro ensaio interrompeu antes desses cenários porque o Docker Engine estava desligado; foi iniciado o Docker existente, sem instalação/configuração nova. Reteste integral passou. O PASS é de execução automática **local com ambiente live sintético**, não de command live. Mantidos limite1closure/tick, deadline20s e nenhum processo permanente. Capacidade máxima de admissão1/minuto, quando o scheduler e demais dependências funcionam, não é SLA; pico10 exige ao menos10ticks e requisições/limites reais podem ampliar a fila. Não aumentar concorrência pelo resultado sintético.

**Divergência documental externa:** em13/11 a [referência atual de assinaturas](https://docs.abacatepay.com/pages/cobrar/assinaturas) passou a afirmar que o checkout pago não aceita outro pagamento. Isso contradiz a resposta anterior do suporte registrada no projeto. Não tratar a mudança textual como prova do comportamento da loja/versão, nem retirar closure/inbox/tenant guards. R1 continua residual sem aceite; nenhuma segunda compra para sondar o link.

### C. R51: reprodução adicional, sem patch especulativo

No mesmo TISS a04a1535:16 cargas/recargas+logout,1440/390,pt-BR/Tóquio, uma ocorrência de#418 na carga mobile com resposta HTML integralmente coletada antes da entrega pelo Playwright. As demais12 entregas preservaram streaming normal; isso não isola a causa nem desliga o parser do navegador. Ensaio seguinte com debugger pausando exceções:12 cargas mobile+logout, zero falhas/capturas. Não reproduzido parentNode. A instrumentação pode mudar o timing; ausência nessa amostra não encerra o incidente. Nenhum conteúdo clínico, HTML bruto, cookie ou senha foi guardado.

Não é possível classificar R51 como exclusivamente TISS apenas pelo host: dashboard/shell também são usados pela operação essencial. Os22 casos financeiros anteriores sem erro não provam ausência de regressão compartilhada. O encaminhamento ao PR55 está publicado, mas não houve resposta/novo HEAD até a conferência. Sourcemaps/API permanecem nas limitações descritas no§55. Dono: responsável TISS/UI para seu release; engenharia financeira para a composição. Sem worktree paralelo alterado ou correção concorrente.

### D. Composição e configuração

Nova exportação isolada: financeiro1078332d + TISSa04a1535. A árvore SQL TISS permanece idêntica à cauda congelada4d0ed1d; o exportador passou a aceitar somente descendentes com **zero diff em toda a árvore de migrations**, mantendo o manifesto aprovado intacto. Os três conflitos conhecidos foram resolvidos só na cópia pelo procedimento existente. Não há novo SQL ou reaplicação0159. Trabalho TISS ainda não commitado foi excluído da composição.

Preview composto criado com aquisição desligada: `dpl_9gRnLSXHFpqdkLV74F1CCqMV3s6x`, [origem imutável](https://project-j0oqx6f43-clinic-os-v2-s-projects.vercel.app). Criação não equivale a READY ou homologação; conferir os resultados do build e navegação do checkpoint de evidências. A tipagem local da cópia foi interrompida por pressão de memória do host; não foi contada como PASS. Tipos/lint do incremento financeiro passaram. Inventário oficial regenerado:536 referências, zero guard/variável pública/teste de rota pendente. Build/CI do commit final devem ser conferidos nos [checks do PR53](https://github.com/joaomarcos-techia/Project_OS/pull/53/checks); o baseline7161 não é atribuído ao incremento sem executar.

Production lida em21:28UTC: mesmo deployment dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP, SHA5620a098, READY. Nenhuma variável, webhook, dado, contrato, deployment ou migration Production alterado. Catálogo/segredo/alerta live anteriores preservados; consumidor, journal composto e cron financeiro ainda dependem da janela autorizada. Não apontar entrega ativa para endpoint ausente.

### E. Decisão de prontidão

GO limitado às provas Sandbox iniciais/EARLY-01 e aos ensaios locais indicados. R1–R4 não aceitos. Renovação natural e mudança de cota efetivada em ciclo seguinte permanecem PARTIAL externo; manter fixture. Próximos atos humanos: decisão delimitada de riscos e responsáveis/cohort do piloto **depois** dos gates de composição/R51, mais autorização específica para Production. Não há novo pagamento Sandbox solicitado.

### F. Avanço TISS061e9ad9 e correção do exportador de composição

Durante os testes o PR55 avançou para `061e9ad953e2776cb9ec4ade30ad3c8a267e211f`: credenciamento/regras, sem diff em migrations/dashboard/shell. Nova cópia com financeiro271d214e foi preparada. **Falha real do nosso harness de composição:** o patch legado sem contexto (`--unidiff-zero`) inseriu o comprovante de teste no meio de um template SQL após o TISS adicionar linhas. O deployment dpl_4dk5QKXViGyPtSwU9mcr4cEtCxyg reprovou na tipagem; não foi publicado em Production. Corrigidos os dois patches para exigir contexto; adicionada checagem sintática TypeScript dos alvos antes da exportação e três testes de regressão. Esta checagem não substitui tipos/build.

Houve também colisão aleatória de horário na fixture de coparticipação (`Math.random`, domínio500): a constraint real recusou um agendamento sintético repetido. O patch de composição agora usa sequência determinística. Após correção na cópia: **12 provas de coparticipação e11 de gate premium PASS**, sem API/pagamento externo ou relaxar constraints. Não alterado worktree TISS. A regressão dirigida da nova fonte passou **778 testes/51arquivos**, com3 SKIP antigos do corpus XML: não foram removidos nem apresentados como PASS. O primeiro ensaio local havia falhado por ausência do WASM na instalação compartilhada; a cópia isolada anterior já continha a dependência5.3.0 aprovada. Reutilizado esse caminho pelo mecanismo de desenvolvimento existente, com versão/hashes conferidos pelo motor;25 testes XSD passaram no reteste. Nenhuma dependência nova instalada.

A composição anterior1078332d+a04a1535 chegou a READY e completou26 observações reais:22navegações/logout mais4leituras da assinatura paga em1440/390/Tóquio/SãoPaulo, sem pageerror. **O alcance de renderização foi corrigido na seçãoG abaixo; não atribuir26 páginas prontas nem transferir a prova ao061e9ad9 ou à cópia corrigida.** Conferir o build/Preview posteriores no checkpoint canônico e nos checks. O histórico de falhas foi preservado. R51 ainda exige o responsável; coincidência com o Preview TISS não demonstra exclusividade do módulo.

### G. Composição congelada e correção do alcance da prova de navegador

**Fonte fixada:** financeiro `c2431ab79a34e52c58650f578654d5771e43db06` + TISS `30126efff8aec0aa8284fceb908e3e49e0a892da`, UI de referência `e47ec2f0`. Export `dist/abacatepay-code-c2431ab7-30126eff`, árvore projetada `e1dff476c15ec5b871cf56569c30d40a1d830a76`, journal160 e hash financeiro `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74`. Nenhum merge, SQL remoto ou alteração em outro worktree. O alias móvel não substitui este pin. Entre061e9ad9 e30126eff mudaram a escolha do plano da carteirinha e sua validação de cobertura, mais a prova correspondente; não mudaram migrations/dashboard/shell.

**Build composto PASS:** deployment `dpl_4kk22srPhRSRBZAq4aCmE1F8A5i3`, [Preview imutável](https://project-9tgdeqhy2-clinic-os-v2-s-projects.vercel.app), READY, metadata financeira/TISS conferida e aquisição desligada. A cópia anterior corrigida c2431ab7+061e9ad9 também chegou a READY, mas seu navegador parou por timeout após uma leitura de assinatura; continua BLOCKED nessa execução, não PASS.

**Regressão do pin:**778 testes/51 arquivos PASS,3 SKIP preexistentes do corpus XML;7 provas PostgreSQL de credenciamento e13 de cobertura/worker/recebível/LGPD PASS, sem rede externa. As12 provas de coparticipação e11 premium da cópia061e9ad9 continuam associadas àquela fonte. O teste novo30126eff confirmou que, sem seleção na agenda, o plano vem da carteirinha e é validado/persistido corretamente. Não foi uma jornada autenticada completa do módulo TISS; ele segue desligado para clínicas reais.

**Correção de transparência do harness:** a execução antiga1078332d+a04a1535 terminou26 observações sem pageerror, mas4 capturas de navegação interna ainda não tinham h1. Assim, não demonstravam26 páginas integralmente prontas. No primeiro navegador do pin30126eff ocorreu1 captura semelhante. Esses registros foram preservados; não se transformam em falha comprovada do produto, nem em PASS de renderização. **Reteste estrito PASS26/26**:20navegações,4leituras da assinatura paga e2guardas de logout;1440/390,pt-BR,Tóquio/SãoPaulo. Aguardou URL correta, shell e h1 visível, verificou árvore única, ausência de overflow/error boundary/pageerror, tela paga e logout. Zero erro de página; não houve nova fixture/compra/mutação financeira. A amostra não comprova a eliminação do R51 intermitente.

**CI do código financeiro:**[run43516219770](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43516219770), c2431ab7, SUCCESS: **7.179 testes/634 arquivos,22 E2E sem SKIP**, tipos/lint/build/cobertura/inventário/isolamento/bundle/HTTP. Semgrep e Snyk SUCCESS, assim como Vercel; Agent Review é NEUTRAL, não uma aprovação humana. O commit anterior271d214e também passou CI43512540421,7176/633 e22E2E. Não atribuir automaticamente esses runs ao commit documental final; conferir seu próprio SHA nos checks do PR.

**R51:** ensaio adicional de14 cargas com cache+logout e outro de16 cargas com breakpoint dirigido ao throw+logout não capturaram falha. Juntos com os ensaios já descritos, reduzem hipóteses sem provar causa ou correção. A reprodução mobile de#418 continua válida; parentNode não foi reproduzido novamente. Handoff publicado no [PR55](https://github.com/joaomarcos-techia/Project_OS/pull/55#issuecomment-6866090429), sem confirmação de leitura. Responsável TISS/UI para seu release; engenharia financeira para preservar o resultado na composição. Dependência exata: capturar fiber/cursor e origem da árvore divergente, implementar correção comprovada e executar o spec de hidratação no SHA correspondente. Não classificar como risco exclusivo do TISS enquanto o dashboard compartilhado não estiver isolado.

**Contrato externo de renovação:** a [documentação atual](https://docs.abacatepay.com/pages/webhooks/events/subscriptions) descreve o checkout original nas renovações, diferente da resposta histórica do suporte sobre um bill próprio por ciclo. O reader já trata ambas as formas com prova financeira inequívoca: checkout original exige período autoritativo e novo receipt exato; ambiguidade fica em revisão. Os casos PostgreSQL `PERIOD two original-checkout renewals` e `PERIOD late original-checkout payment` passaram dentro dos131; não equivalem a renovação natural observada. R1/R2 permanecem, sem necessidade de nova compra inicial.

**Configuração e próximo ato:** auditoria Vercel de nomes/escopos confirmou57 referências sem valores expostos ou mudanças. A tentativa de GET live nesta consolidação terminou em timeout de rede antes de uma resposta HTTP; não comprova validade/invalidez da chave nem reconfirma catálogo. Preservada a prova5/5 da janela anterior e exigido novo preflight na futura janela. Endpoint/consumer/schema/cron/webhook live continuam dependentes de release autorizado; sem ativação financeira nesta rodada. Não há pagamento ou instalação a pedir ao founder. **NO-GO Production**: R51 compartilhado aberto, observação natural PARTIAL, R1–R4 sem aceite/cohort e janela final ainda não autorizada.

## 57. Billing SaaS independente de Convênios — 14/11/2026

### A. Por que havia dependência e qual é o limite correto

A composição anterior reuniu código financeiro e TISS para testar o release conjunto. Isso não significa que uma assinatura dependa de uma guia ou da homologação com operadoras. A condução anterior misturava compatibilidade mínima com prontidão do pacote inteiro; o candidato desta seção separa esses critérios. **As117tarefas TISS, suas telas, o R54 de coparticipação e a homologação da operadora não são gates do billing SaaS.**

| Dependência / natureza | Código ou contrato real | Motivo | Bloqueia o billing SaaS? | Responsável |
|---|---|---|---|---|
| Trial e direito comercial | `src/lib/trial-access/index.ts`, `src/lib/entitlements/{index,policy}.ts`, `src/contexts/billing/internal/subscriptions.ts` | Liberação por invoice SaaS paga, período, plano e clínica; trial não opera Asaas de pacientes/IA/TISS | Sim, se o gate falhar; não depende de guias, lotes ou operadora | Billing SaaS |
| Disponibilidade TISS | PR55: `src/lib/premium-access`, `src/contexts/health-insurance`, `hi_clinic_settings.enabled`, triggers0148/0151 | Permissão comercial é necessária; habilitação operacional e permissões continuam próprias do módulo | Não é pré-requisito para contratar/pagar SaaS. Pagamento não habilita o módulo | TISS, com contrato comercial compartilhado |
| Schema/journal | `drizzle/migrations/meta/_journal.json`, `migrations/release-manifest.json`, SQL0159 | Histórico Drizzle único: conservar sequência/hashes143–159 já aplicados no DEV | Exige compatibilidade com o SQL congelado, não conclusão das funcionalidades TISS | Coordenação de banco |
| Dinheiro de pacientes | `src/contexts/payments`, `src/lib/payments/account-store.ts`, `/api/webhooks/asaas/patient/[ref]` | Asaas por clínica, `patient_charges`/`lancamentos`; coparticipação vem do TISS | Não é o checkout SaaS; não migra para AbacatePay | Payments/Asaas; TISS para coparticipação |
| Assinatura Qoro | `src/contexts/billing/internal/abacatepay-*`, `src/lib/payments/{saas,abacatepay}`, `/api/webhooks/abacatepay` | Conta/loja, binding, inbox, `subscriptions`, `invoices`, ledger privado | Sim: são obrigações SaaS. Não consultam operação TISS | Billing SaaS |
| Registry/outbox compartilhado | `src/app/api/cron/outbox/{route,handlers}.ts` | Vários módulos registram consumidores no mesmo processo | O boot estático podia impedir jobs SaaS; isolado nesta rodada sem esconder a falha | Infra compartilhada + dono do handler |
| UI própria e homologação de convênio | PR55: `src/app/(app)/(shell)/convenios`, XML/PDF, lotes/glosas e operadora | Operação exclusiva do módulo | Não. Não incluída no candidato SaaS | TISS/UI |
| Dashboard/login/layout e R51 | `src/app/(app)/(shell)/dashboard`, `src/components/painel`, `src/app/layout.tsx` | Interface global utilizada pela clínica paga | Avaliar alcance real; não classificar como exclusivo TISS pelo hostname | UI compartilhada, com participação do financeiro apenas nos fluxos SaaS |
| Renovação/closure/risco externo | Reader, inbox, scanner/watch/closure e fornecedor | Ciclo natural, garantias do link e capacidade do alvo | Gates financeiros delimitados R1–R4, independentes da operadora TISS | Billing, provedor e operação |

Dois testes de fronteira por imports reais protegem a separação: serviços SaaS não importam o contexto operacional TISS nem Payments de pacientes; Payments e seu webhook Asaas não importam o adaptador AbacatePay SaaS. O barrel declarativo `src/lib/db/schema` permanece compartilhado por projeto; isso não representa uma chamada a guias/operadoras. O gate TISS consulta estado comercial, sem conhecer checkout/card/payment.id da AbacatePay. Nenhuma nova camada de domínio foi criada.

### B. Correção e candidato exclusivo SaaS

**Correção real no cron:** antes, `./handlers` e o catálogo eram carregados no topo da rota. Falha de import de um consumidor de outro módulo podia impedir até o início dos jobs SaaS. Agora o boot ocorre dentro da tarefa `runRegisteredOutbox`, junto ao worker, enquanto recovery/inbox/closure/watch iniciam e terminam independentemente. `Promise.allSettled` aguarda todos; o erro original continua na fronteira cron/alerta e não há heartbeat de sucesso falso. Não se processa registry parcial. Isso não isola defeito no banco/client/schema essencial nem corrige o R51 de renderização.

`scripts/abacatepay-saas-release.ts` exporta **apenas o commit financeiro**, acrescentando o SQL compartilhado congelado. Não faz merge de código TISS, não copia seu worktree e não exige seu HEAD atual. A versão final reconstrói os blobs SQL pelo Git ref congelado e pelo manifesto aprovado; não depende de um pacote dist de uma execução anterior. Arquivo/tag/ordem/timestamp/hash são conferidos; export existente não é sobrescrito. O journal160 existe só no pacote, sem renumerar ou alterar histórico remoto.

O journal original TISS contém152 entradas, mas termina no índice158: ele não traz as sete migrations financeiras136–142. A primeira versão do novo exportador confundiu quantidade com índice e parou antes de exportar. Corrigido por composição validada do prefixo financeiro143 + cauda143–158 + sucessora159, com7 testes, incluindo drift, duplicidade, ordem e timestamp. Não faltavam migrations no DEV; não foi aplicada nenhuma para corrigir esse erro de tooling.

**Preview SaaS:** código365b4287, [deployment imutável](https://project-2476wgjht-clinic-os-v2-s-projects.vercel.app), `dpl_FZEfTTKGuYurXsxPFvbBEtfZ5LWJ`, build READY e aquisição desligada. Nenhum código/tela/menu operacional TISS incluído. PASS26 verificações estritas:20 navegações do dashboard,4 leituras da assinatura paga e2 guardas de logout,1440/390,Tóquio/SãoPaulo, zero pageerror/overflow e zero link Convênios. A conta EARLY-01 existente foi reutilizada; nenhum checkout/pagamento/fixture remoto novo. Alterações posteriores de exportador/testes não mudam o runtime desse Preview; a igualdade dos arquivos de produção é conferida antes do fechamento.

### C. Provas de banco, entitlements e preservação

- **51/51 sem TISS:** PostgreSQL descartável com143 migrations financeiras, sem `hi_guides`, sem `hi_clinic_settings` e sem `qoro_premium_denial`. Trial, checkout/webhook por HTTP sintético, invoice/ativação/cotas/cancelamento/recontratação/recuperação passaram. Zero chamada externa. Não substitui as compras Sandbox já homologadas.
- **52/52 com SQL compartilhado:** mesmo runtime SaaS, journal160 congelado, sem contexto operacional/UI TISS. Gate compartilhado presente; TISS começou desabilitado e permaneceu assim após pagamentos. Regras SaaS e RLS passaram. Prova local, não operação de clínica real.
- **DEV somente leitura:** transação REPEATABLE READ READ ONLY,160 hashes/timestamps iguais ao pacote aprovado,0159 inalterada;22 tabelas auditadas com RLS, zero invoice entre clínicas e zero ciclo duplicado. Triggers TISS em `appointments`/`lancamentos` foram inventariadas; o caminho de ativação SaaS não escreve nessas duas tabelas. Há3 habilitações TISS no DEV; não foram atribuídas a clientes reais nem modificadas, e não provam qualquer ativação Production.
- **Qualidade local:**7183 testes/635 arquivos PASS antes dos7 testes finais do journal; regressão final dirigida70 PASS, tipos/lint/inventário PASS. CI completa e checks externos precisam corresponder ao SHA final no PR53; não herdar o baseline por inferência. Fechamento/renovação131 e cargas anteriores permanecem aplicáveis porque os serviços financeiros não foram alterados.

O primeiro ensaio PostgreSQL não iniciou porque55491 estava na faixa Windows excluída55417–55516. Adicionado `--port` validado somente ao harness local e escolhido socket livre pelo SO. Reteste passou; nenhuma regra de firewall/reserva/segurança foi alterada. As falhas iniciais de mocking dos imports também foram corrigidas no teste, sem relaxar a verificação do erro/causa ou da conclusão dos jobs independentes.

**Exportação final verificada:** financeiro `d10e40af426e5320b282d7abf76c6f203600d718`, SQL compartilhado `4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269`,160 entradas. Journal e160 hashes SQL iguais aos do pacote365b4287 aprovado; os arquivos de produção em `src` permanecem idênticos, exceto testes adicionais. Assim, build e navegador desse Preview continuam aplicáveis ao runtime. Não atribuir um novo build ao pacote final sem executá-lo; o resultado de CI do HEAD final fica nos checks do PR53.

### D. R51: responsabilidade sem bloqueio artificial

Os16 arquivos de produção comparados do dashboard/PainelShell/root layout são byte a byte iguais em97e2c306 e no TISS30126eff. O shell financeiro acrescenta somente o aviso de trial. Portanto não há evidência para declarar a variante rara exclusiva das guias TISS. As causas determinísticas tratadas pelo outro agente continuam válidas no alcance dos seus testes; não encerram automaticamente essa variante.

O fluxo SaaS do candidato acima não reproduziu o erro nas26 verificações. Isso dá PASS à amostra, sem comprovar desaparecimento global. **R51 não bloqueia a conclusão do domínio financeiro nem exige117 tarefas; permanece revisão da UI compartilhada para o rollout do aplicativo.** O responsável pelo componente deve fechar a causa/regressão ou demonstrar isolamento suficiente; o financeiro não assume telas/guias do PR55 e não suprime Sentry/erros. O risco compartilhado não foi aceito implicitamente.

### E. Decisão e implantação somente SaaS

**Candidato técnico de domínio preparado**, condicionado aos checks finais; **NO-GO operacional/comercial Production**. Não é necessário esperar guias, glosas, R54 ou homologação de operadora. Permanecem: validação da UI compartilhada/R51, tratamento explícito de R1–R4, clínica/cohort e responsáveis, autorização da janela e consumidores/schema live efetivamente publicados. Renovação natural segue PARTIAL;13/12 é a próxima data informada, não um pagamento garantido.

O rollout usa código SaaS e SQL congelado compatível, TISS desabilitado e sem suas rotas/consumidores. Não gerar nova migration pelo modelo parcial do pacote nem tentar remover DDL TISS já aplicado. Na janela: cadastro fechado por novo deployment; preflight/backup/contratos/hashes; SQL aprovado antes de consumidor; deployment com novas aquisiçõesfalse; endpoint/HMAC+segredo/inbox/cron/Redis/scanner/watch/closure; só então webhook ativo e allowlist aprovada. Asaas de pacientes e contratos SaaS antigos permanecem operacionais. Reabertura e flags exigem novo deployment.

Rollback: fechar novas aquisições/allowlist, preservar consumidores de obrigações já pagas e ledger/invoices; reverter app somente para versão compatível com o schema e corrigir adiante. Nenhum DOWN destrutivo, cancelamento ou estorno automático. A próxima decisão humana é o aceite/rejeição delimitado dos riscos financeiros e a definição do piloto, após a avaliação técnica da UI; não novo pagamento Sandbox nem conclusão do módulo TISS. O runbook e o plano existente são as fontes operacionais únicas.

### F. Avanço TISS durante o fechamento e escopo das leituras

O PR55 avançou para `1b09267edf93c50e1e692cad2e9241fa9a62af3e`: candidata0160 de estorno externo de **pacientes Asaas/R54**, novos handlers/sweep e testes próprios. Diff dirigido confirmou que não mudou o prefixo SQL até0158, trial/entitlements, serviços SaaS ou dashboard/PainelShell/root layout. A0160 acrescenta enum/coluna/índice/tabela de paciente; não toca `billing_gateway`, `subscriptions` ou `invoices`. Não foi incorporada ao candidato SaaS nem precisa ser entregue para concluí-lo.

Readback DEV adicional em14/11 **03:42:06UTC**, justificado pelo novo DDL:160 entradas/hashes aprovados,0159 preservada,0160 **ainda não aplicada**, zero invoice cruzada/ciclo duplicado. A ordem futura deve conservar0159 antes de0160; nenhuma renumeração, hash alterado ou DDL executado aqui. [Coordenação entregue ao PR55](https://github.com/joaomarcos-techia/Project_OS/pull/55#issuecomment-6871160942), sem presumir aprovação ou leitura. Não é prova completa do novo runtime R54, cuja validação continua com seu responsável.

**Escopo de “somente leitura”:** as consultas de DEV foram transações READ ONLY, sem DML/DDL de aplicação ou alteração financeira. O navegador utilizou login/logout legítimos da fixture já existente; essas operações criam/revogam sessões e podem atualizar metadados Auth/auditoria do próprio usuário sintético. Não houve nova conta, convite, compra, alteração de plano ou dado clínico. Os contadores de escrita da evidência distinguem essas sessões das mutações diretas de aplicação/schema; não significam ausência absoluta de qualquer efeito no serviço Auth.

### G. Build isolado: localização correta do utilitário

A CI43552406377 de `db7ffed1` passou testes/cobertura, mas **reprovou o build isolado**: o allowlist de cópia inclui `scripts/security`, sem os utilitários financeiros da pasta superior. O novo exportador estava nessa subpasta e seu import do helper não existia no sandbox do build. Preview completo havia passado porque contém ambos. Correção focada: mover o exportador para `scripts/abacatepay-saas-release.ts`, junto dos outros operadores financeiros, ajustando o import e este runbook. Nenhuma regra de build/CI, exclusão de teste, tipo ou dependência foi alterada para contornar o erro. O build do SHA corretivo precisa passar nos próprios checks; o FAIL anterior fica preservado.

## 58. Release candidate final, riscos e piloto controlado — 14/11/2026

O [dossiê A–H](ABACATEPAY-SaaS-GO-NO-GO-FINAL.md) é o documento autossuficiente para decisão. O [runbook vigente](../../runbooks/abacatepay-operacao.md#fases-vigentes-ad--piloto-controlado) contém os passos e paradas A/B1/B2/C/D. Evidência nova anexada à chave `releaseCandidateClosure20261114` do JSON canônico, sem substituir provas anteriores. Runtime financeiro permanece7208d505; não houve alteração de fonte, regra comercial, configuração, schema compartilhado, TISS ou dependência nesta rodada.

| Verificação diferencial | Resultado | Limitação preservada |
|---|---|---|
| HEAD/checks baseline7208d505 | CI43553549307 PASS7190/636,22E2E zero SKIP,Semgrep/Snyk/Vercel SUCCESS;Agent Review NEUTRAL | Conferir também a CI do SHA documental final nos checks do PR53 |
| Observer Sandbox EARLY-01,10:34:13UTC | GET/READ ONLY PASS;próxima data oficial13/12/2026,fim Qoro17:44:27.418UTC;closure confirmada,zero novo ciclo | **R2 PARTIAL**,não renovar por ACTIVE;primeira tentativa indisponível,reteste com CA do Windows passou |
| Catálogo live,10:35:06UTC | GET5/5,R$197/397/544/691/838,MONTHLY,sem segundo trial;webhooks HTTP200,quantidade0 | Não comprova consumers/permissãoDELETE/closure live;zero mutação |
| Vercel,10:35:03UTC | Nomes/escopos/deployment lidos com `decrypt=false`,Production5620a098 inalterada | Valores não lidos;seleção de aquisição AbacatePay ausente no escopo Production observado |
| DEV,10:35:35UTC |161 entradas,0160 reconhecida;prefixo160/0159 íntegros,22 tabelas RLS,zero invoice cruzada/ciclo duplicado |0160 aplicada por outra execução;nenhuma migration ou runtime TISS incorporado |
| Compatibilidade0160 | PostgreSQL isolado,**52PASS**,161 migrations,10:41:59UTC;fonte7208d505+DDL0160 do blob congelado | Sem rede externa/produção;release continua SQL160,sem depender do HEAD PR55 |
| Controles operacionais | **45PASS/3arquivos**,zero SKIP:aquisição/ambiente/observador;guard SQL do pacote160 saída0 | Não atribuir capacidade live ou prova externa a esses testes |
| Prefixo Production,10:54:48UTC |136 entradas;32 hashes equivalentes CRLF/LF,ordem/timestamps coerentes,zero SQL desconhecido;quatro tabelas centrais com RLS forçado | Catálogos/histórico READ ONLY,sem linhas clínicas/contratuais;24 entradas0136–0159 pendentes |

O primeiro comparador Production somente LF apontou diferenças ainda não classificadas. Comparação exata de bytes demonstrou CRLF equivalente; nenhum hash persistido ou arquivo SQL foi corrigido. O ensaio161 foi chamado uma vez antes de terminar a cópia e não iniciou o banco; a execução completa posterior passou52. Esses erros de preparação não são falhas financeiras nem provas aprovadas.

**Decisão técnica:**GO CONDICIONAL PARA DEPLOY FECHADO como recomendação, sem execução autorizada. Não há novo defeito determinístico SaaS identificado que justifique prolongar o desenvolvimento. Piloto ainda exige aceite/rejeição individual R1–R4,clínica consentida,responsáveis,janela e consumidores/endpoint/cron/Redis/alertas efetivamente validados. R51 raro continua com o responsável da UI compartilhada;há26 checks SaaS anteriores sem erro,não encerramento global. Handoff documentado,sem afirmar leitura pelo outro agente.

**Parada importante:** aquisiçãofalse não desliga consumidores. B1 sem obrigações live pode propor ambiente AbacatePay ausente por novo deployment autorizado;B2 autoriza separadamente runtime/consumidores com aquisição ainda fechada. Após obrigação paga,conter somente aquisição e preservar processamento/schema/histórico. Nenhuma dessas configurações foi executada aqui. RACI nominal e clínica continuam **A DEFINIR PELO RESPONSÁVEL**. Expansão1→3→10 é proposta,não regra automática.

**Encerramento de escopo:** sem novo checkout,pagamento,conta,e-mail,probe Sentry,merge,DDL,deploy ou consumidor financeiro live. Quatro exclusões antigas de vídeos permanecem fora desta alteração e não serão incluídas no commit. Checks finais e SHA documental devem ser consultados no PR53; o resultado da baseline não se apresenta como execução de uma revisão posterior.

### Restrição da CI e verificação local de fechamento

Commit documental14414498 publicado no PR53 draft. [CI43588496105](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43588496105) e advisory43588496058 foram recusados pelo GitHub **antes de qualquer step**, por pagamento da conta ou limite de gastos. O check registra FAILURE; diagnóstico **BLOCKED_AMBIENTE**, não FAIL de implementação. Nenhum orçamento/plano/runner/workflow alterado. Falta o titular verificar Billing and licensing ou suporte; instruções no início do runbook. Após liberar, executar os checks do HEAD final,sem considerar esta execução como aprovada.

Verificação local14414498,justificada pelo bloqueio do runner: **7190 testes/636 arquivos PASS,zero SKIP**, TypeScript/lint/inventário/drift de observabilidade PASS. Vercel/Semgrep/Snyk desse SHA SUCCESS; Agent Review NEUTRAL. Fonte/scripts/SQL/dependências/configuração idênticos a7208d505;exportação14414498 preserva160 hashes. E2E22 e26 checks de Preview continuam provas anteriores,não novas execuções. Metadados,comandos,horários e hashes dos logs em `releaseCandidateClosure20261114.localFinalVerification`/`remoteRunnerRestriction`. Não retirar o gate remoto:nenhum GO de execução foi concedido.


## 59. Actions recuperado e fechamento136→160 —14/11/2026

**Follow-up da CI:** o primeiro commit novo21e7e587 teve testes/cobertura PASS, mas o run43638406953 reprovou o inventário gerado desatualizado. Regenerado pelo comando existente `scripts/security/inventory.ts --write`; revisar somente novas referências de ambiente do preflight/harness. Zero superfície sem guard/variável pública sem registro/regressão de teste de rota no diagnóstico. Scanner, regras, allowlists e CI permanecem intactos. Build/E2E desse run foram interrompidos e não contam como PASS. O novo SHA precisa de execução completa; resultado nos checks e checkpoint final do PR53.

- **CI oficial:** f94248ef, tentativa2 de43589401561,7.190 testes/636 arquivos e22 E2E sem SKIP; advisory43589401548 SUCCESS. Titular confirmou franquia incluída; plano/billing não são acessíveis aos escopos da CLI. Sem compra, orçamento ou workflow alterado.
- **Lacuna corrigida no procedimento:** o migrator genérico não confere todo o prefixo aplicado. Novo preflight específico, somente leitura, valida Git/journal/SQL/hashes conhecidos e objetos críticos. Não altera o runner compartilhado nem repara histórico. Ainda exige janela exclusiva e reconferência se o alvo mudar.
- **Ensaio isolado:** SQL real0–135 e cinco legados sintéticos; Drizzle aplicou24 entradas0136–0159, chegou a160, preservou todos os campos anteriores dos contratos e catálogo, segunda aplicação no-op.16 verificações PASS, incluindo arquivos/histórico inválidos, rollback por schema/dependência incompatível, RLS, triggers e último titular. Não é restore de backup real ou ensaio do Auth gerenciado.
- **Readbacks:** Production136 com32 equivalências CRLF e zero diferença inexplicada; DEV161 com0160 preservada,0159 intacta,22 relações SaaS com RLS,zero invoice cruzada/ciclo duplicado. Nenhuma escrita remota.
- **Regressão afetada:**16 testes novos do preflight;14 testes existentes de ambiente Sentry e página de assinatura PASS. Guard de arquitetura detectou import direto de Drizzle no harness: substituído pelo pool central local, sem ampliar allowlist. Ensaio completo e gates reexecutados após essa alteração. CI do novo HEAD é obrigatória e registrada no checkpoint final do PR53.
- **UI:** [handoff autocontido](HANDOFF-UI-BILLING-SaaS.md), com rotas existentes, DTOs, permissões, trial, estados, SSR/Sentry e regressões. Nenhum agente UI disponível nesta árvore; publicar não comprova leitura. Não editar worktree de redesign/TISS.
- **Operação:** checklist futuro de webhook live no [runbook](../../runbooks/abacatepay-operacao.md), distinguindo registro, autenticidade/entrega e processamento. Sem ativação, configuração, consumidor, pagamento ou deploy Production. R1–R4 continuam PARTIAL; natural13/12 futura.
- **Decisão:** candidato controlável encaminhado; GO de produção não concedido. Gates1–6 independentes, backup/preflight atuais, responsáveis, clínica/consentimento, risco e escopo precisam de decisão humana. Provas históricas e seus limites preservados no checkpoint canônico `ciRecoveryAndReleaseFreeze20261114`.
