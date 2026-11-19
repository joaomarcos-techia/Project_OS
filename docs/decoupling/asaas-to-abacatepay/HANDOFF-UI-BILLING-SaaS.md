# Handoff da AbacatePay para a repaginação do Qoro

## Investigação adicional de R51 — 18/11/2026

[Actions 44419752659](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44419752659), harness `2b44f88c60caab3929e3b8f1780e91cc62238224`, aplicativo imutável `bd776c15`: **PASS**. Foram três voltas por quatro telas em duas larguras (1440/390), cada visita seguida de reload: 24 pares de navegação/reload em Dashboard, Pacientes, Procedimentos e Assinatura, além das verificações pagas iniciais/finais. Fuso do navegador `Asia/Tokyo`; zero `pageerror`, nenhum corte horizontal ou retorno indevido dos gates de trial. O registro e o plano continuaram disponíveis na nova sessão. Nenhuma criação de registro, convite, integração, checkout ou pagamento nessa rodada. A credencial temporária do Actions foi removida ao concluir.

**Não reproduzido nesta amostra; causa não determinada; R51 continua PARTIAL.** A rodada antiga falhou após quinze criações sucessivas, sem stack suficiente. O ensaio novo repete leituras/reloads, não aquela sequência de escrita. Não há evidência para atribuir o incidente ao código financeiro ou declarar a UI global corrigida. Ao alterar shell, hidratação ou o formulário de procedimentos, o agente UI deve executar a sequência original em fixture própria, além desta amostra. Nenhuma alteração no PR #56 ou em seu worktree foi feita.

## Observação do trial DEV em 18/11/2026

Após pagamento manual Sandbox, as rodadas [paga 44352088498](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44352088498) e [nova sessão 44353873186](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44353873186) passaram em 1440/390 px, sem erros de navegador: cotas temporárias removidas, integrações e convite disponíveis, pagamento/reload corretos e persistência após logout/nova autenticação. Dois registros além do teto antigo foram criados numa tentativa anterior e preservados; a rodada verde retomou esses dados, sem repetir a sequência de quinze criações. Isso não encerra a ocorrência antiga descrita abaixo. Nenhum componente do aplicativo foi corrigido por estes testes.

Na candidata imutável `bd776c15783a3637a1f6053cd53765833a28864f`, a [rodada Actions 44221156413](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44221156413) criou quinze procedimentos sintéticos, recusou a criação excedente e conferiu a assinatura, mas falhou no gate de runtime: um erro de hidratação e quinze exceções de navegador. O diagnóstico antigo preservou classes, sem stack suficiente para atribuir causa. Não concluir que houve erro financeiro nem declarar o incidente corrigido.

As rodadas [ativa 44222587653](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44222587653) e [vencida 44284271573](https://github.com/joaomarcos-techia/Project_OS/actions/runs/44284271573) passaram em 1440/390 px sem erro de navegador; retomaram os registros já criados, não repetiram a sequência de quinze criações. R51 continua PARTIAL, com causa a investigar pelo responsável da UI compartilhada. Preservar as falhas anteriores e repetir a navegação/criação estrita ao alterar esses componentes. O harness atual registra classe, fase, rota, fingerprint e frames estáticos sanitizados; não registra HTML, dados pessoais, tokens ou payloads financeiros.

Nenhum componente do aplicativo, regra financeira ou worktree UI/TISS foi alterado nesta bateria. O [checkpoint do trial](ABACATEPAY-SaaS-GO-NO-GO-FINAL.md#trial-da-conta-dev--verificações-na-nuvem-concluídas-em-18112026) contém o alcance de cada prova e a pendência de pagamento Sandbox.

Atualizado em 14/11/2026. Documento autocontido para o agente de UI. O PR53 continua draft e não autoriza merge, configuração, migration, pagamento ou deploy Production. O domínio financeiro está congelado; esta integração permite reorganizar a apresentação sem reescrever suas regras. Não depende da conclusão do TISS ou do HEAD do PR55.

## Responsabilidades e isolamento de trabalho

**Handoff vigente15/11:** candidato financeiro94f6da4a aprovado tecnicamente; somente B0 autorizado. [Inventário de rotas e pedidos B1/B2/B3](GATE-B-DEPLOY-CONTROLADO.md#inventário-adversarial-dos-caminhos-de-aquisição). A regra WAF proposta de dois paths não cobre Server Actions nem `/api/billing/checkout`; preservar guards, tenant/permissão e composição de runtime. Não converter indisponibilidade de checkout em fallback Asaas nem afetar retorno pago. O worktree UI/Payments não foi alterado e nenhum agente está acessível nesta árvore para confirmação de leitura. A correção/validação da configuração Asaas live com DEV continua com UI/Payments antes de testes externos não mockados; não houve inspeção de segredo ou chamada monetária para verificar essa hipótese.

**Atualização GateB14/11:** `POST /api/signup/checkout` passa a respeitar `SIGNUP_ENABLED=false` também para sessões anteriores. A UI deve preservar dados e exibir indisponibilidade503,sem fallback para outro provedor ou reinício. A rota de status continua reconciliando pagamento existente. [Proposta operacional e matriz](GATE-B-DEPLOY-CONTROLADO.md);baseline anterior10e5d43b preservada,novo SHA/CI no PR53. Não alterar flags,contratos ou worktree financeiro para facilitar o redesign.

**Coordenação Payments/ambiente:** recebido o relato de chave Asaas live com banco DEV. O adapter desta baseline aceita a baseURL/credencial fornecidas; isso não é seleção segura pelo projeto do banco. Até o guard central de ambiente ser comprovado no trabalho UI/Payments, usar mocks ou contenção de saída aprovada nos testes e nunca gateway live. Não copiar/registrar a chave, não usar o kill switch AbacatePay para desligar cobrança de pacientes e não alterar contratos SaaS. Nenhum segredo foi inspecionado ou copiado, nem teste monetário realizado por esta revisão. A referência está publicada no PR #53; nenhum agente UI/TISS está acessível nesta árvore para confirmar leitura.

O agente UI lidera design system, shell/layout, navegação, dashboard, responsividade, acessibilidade e apresentação da assinatura. Billing mantém checkout, preços, planos, cotas, trial, períodos, invoices, integrações, reconciliação e autorização financeira. TISS lidera suas telas exclusivas. Não editar o worktree de outro agente; usar branch e worktree próprios. Antes de alterar um componente compartilhado, informar arquivo/SHA, impacto e regressão planejada; não presumir autorização de merge.

Referência funcional: runtime7208d505, sem redesign nos commits documentais14414498/f94248ef. Não importar esses commits como se contivessem o layout novo. Depois de integrar visualmente, comparar o diff de aplicação e executar as regressões abaixo no SHA resultante.

## Rotas e componentes que existem

| Rota | Fonte/componente | Papel e limite |
|---|---|---|
| `/cadastro` | `src/app/(app)/cadastro/page.tsx`, `signup-questions.tsx`, `signup-identity.tsx`, `signup-code-confirmation.tsx` | Aquisição, identidade e confirmação. Preservar senha somente no Auth, código/limites e continuidade de sessão |
| `/cadastro/plano` | `plano/page.tsx`, `plan-selection-form.tsx`, `plano.module.css` sob a pasta cadastro | Catálogo, quantidade de médicos, seleção persistida e início do trial. O caminho AbacatePay é `trial_first`, sem cartão obrigatório no cadastro |
| `/configuracoes/assinatura` | `src/app/(app)/(shell)/configuracoes/assinatura/page.tsx`, `deferred-subscription.tsx` | Assinatura AbacatePay, pagamento antecipado/pós-trial, processamento, cancelamento e mudança agendada |
| Mesma rota, origem Asaas | `plan-change-form.tsx`, `actions.ts` na pasta assinatura | Caminho legado separado; preservar condições e ações existentes, inclusive anuais contratados |
| Checkout hospedado | Navegação autorizada por `DeferredSubscription.checkout()` | Página externa do provedor. Não existe formulário Qoro para capturar cartão ou confirmar pagamento pelo navegador |
| `/cadastro/pagamento` | `pagamento/page.tsx`, `payment-return.tsx` sob cadastro | Retorno do checkout legado Asaas. Não reutilizar seus textos/polling como confirmação de pagamento AbacatePay |
| `/cadastro/continuar`, `/cadastro/confirmado`, `/cadastro/retomar` | Fontes correspondentes em cadastro | Compatibilidade/retomada de identidade. Não criar um segundo provisionamento ao redesenhar essas telas |
| `/admin/billing/operacao` | `src/app/(admin)/admin/billing/operacao/page.tsx`, `replay-form.tsx` | Conciliação restrita a superadmin/MFA. Não disponibilizar controles de replay ao titular comum |
| `/configuracoes/pagamentos` | Pasta correspondente no shell | Integração **Asaas da clínica para pacientes**, não a assinatura SaaS da Qoro |
| `/dashboard` | `src/app/(app)/(shell)/dashboard/page.tsx`, `src/components/painel`, layout do shell | Superfície compartilhada; aviso de trial deve refletir o servidor e preservar gates |

Histórico financeiro/invoices SaaS existem no banco e na conciliação operacional. **Não há página autônoma de faturas SaaS do cliente nesta candidata.** Não anunciar exportação, portal de reembolso ou tela nova como recurso já entregue. Nova interface que exija dados/API adicionais precisa de revisão de contrato; não usar `/financeiro` de pacientes para exibir cobrança da Qoro.

## Contratos reais de dados e ações

As definições de código prevalecem sobre esta tabela. Não copiar tipos para uma segunda fonte de verdade.

| Contrato | Origem e transporte | Regra de integração |
|---|---|---|
| `SignupPlan`, `SignupPlanState` | `src/contexts/onboarding/internal/signup-draft.ts`; `GET/PUT /api/signup/plan` | IDs, valores em centavos, ciclo, seleção, `rowVersion`, prazo absoluto e `signupFlow`. Preservar controle de versão, validação e resposta indisponível |
| Início do trial | `POST /api/signup/checkout` e `plan-selection-form.tsx` | Na jornada trial-first, provisiona avaliação e continua por sessão; não interpretar provisionamento como cobrança confirmada |
| `DeferredSubscription.Props` | `getDeferredSubscriptionOverview()` em `src/contexts/billing/internal/deferred-checkout.ts`, enviado pelo Server Component | `planName`, `amountMinor`, `trialEndsAt`, `trialActive`, `paid`, `billingStatus`, `paidPeriodActive`, `activationPending`, `checkoutAvailable`, `managementAvailable`, `contractId`, `accessUntil`, `cancellationState`, `canRecontract`, `planChanges` |
| Criar/recuperar checkout | `POST /api/billing/checkout`, corpo `{}` | Clínica e preço são determinados no servidor. `checkout_pending` + URL confiável permite navegação; `already_paid` exige releitura; `reconcile_required` impede sugerir novo pagamento |
| Agendar plano/cota | `POST /api/billing/plan-change`, corpo `{contractId,targetPlanId}` | `scheduled` confirma pedido, **não** nova cota paga. `planChanges.pending.confirmed` não é confirmação financeira de outro mês |
| Cancelar renovação | `POST /api/billing/cancellation`, corpo `{contractId}` | Só `renewal_cancelled` permite mostrar confirmação; timeout preserva intenção e exige releitura. Nova contratação somente depois do período pago |
| Retorno legado | `POST /api/signup/checkout/status`, cancelamento em `/api/signup/checkout/cancel` | Fonte Asaas; redirect/resultado da URL não quita assinatura nem cria segunda conta |
| Entitlements/trial | `src/lib/entitlements`, `src/lib/trial-access`, `src/lib/tenant-access` | Servidor/banco decidem acesso. Botão escondido não substitui autorização ou cota |

`paid` informa que a avaliação já foi liberada por pagamento; **não basta para dizer que o período atual está pago**. Mostrar estado pago corrente exige também `paidPeriodActive`. Status externo ACTIVE, checkout criado, redirect de sucesso, resposta2xx da inbox ou `managementAvailable` não provam pagamento atual.

Não enviar `clinicId`, valor, número de dias pagos ou preço escolhido pelo navegador como autoridade. As rotas verificam origem confiável, sessão HTTP-only, permissão `MANAGE_SETTINGS`, tenant, tamanho/corpo e vínculo `contractId`. Não remover esses controles para facilitar o redesign; não guardar sessão, senha ou tokens em localStorage/URLs.

## Estados visuais sem inventar estados financeiros

| Situação real | Exibição e ação permitida |
|---|---|
| Trial ativo sem pagamento | Avaliação até `trialEndsAt`; oferecer contratação se `checkoutAvailable`; nunca chamar de assinatura paga |
| Plano selecionado | Resumo da seleção persistida; número de médicos e três acessos administrativos claros |
| Checkout iniciado/pendente | Aguardar pagamento; uma tentativa, indicador de processamento e retorno seguro; não ativar acesso pago |
| Pagamento recebido/em ativação | `activationPending`: informar processamento, preservar tentativa e permitir atualização; não solicitar segundo pagamento |
| Pago e período vigente | `paid && paidPeriodActive`: confirmação do plano atual e fim retornado pelo servidor; limites de plano continuam valendo |
| Recusa/falha de pagamento | Não inferir recusa de cartão de um timeout/503. A DTO não fornece todos os motivos do provedor; usar estado pendente/erro recuperável ou suporte conforme resposta real |
| Integração indisponível | `checkoutAvailable=false`, `managementAvailable=false` ou erro503: estado indisponível; não inventar checkout alternativo |
| Cancelamento solicitado | `cancellationState=requested`: pedido preservado, botão de conferir; não afirmar que a recorrência já foi encerrada |
| Renovação cancelada | `cancellationState=confirmed`: acesso até `accessUntil`, sem estorno automático. Não oferecer “Manter assinatura” do Asaas para AbacatePay |
| Período encerrado | `paidPeriodActive=false`: não exibir pago vigente. `canRecontract` governa nova contratação após cancelamento, sem novo trial |
| Mudança agendada | Mostrar plano/cota atuais e destino pendente; a vaga extra só entra no ciclo novo efetivamente pago |
| Suspensão/estado desconhecido | Não criar enum `suspended` na DTO existente (`trial/active/past_due/cancelled`). Exibir indisponibilidade/revisão apenas quando o backend fornecer fundamento |
| Erro recuperável | Preservar seleção/intenção, atualizar estado autoritativo antes de repetir POST; respeitar429/503 |
| Erro de vínculo/ambiguidade | Avisar para não pagar novamente e procurar suporte; não limpar histórico, resetar tentativa ou atribuir clínica por suposição |

Os guards de `useRef`/loading evitam duplo clique, mas a idempotência definitiva fica no servidor. Preservar ambos. O checkout só redireciona para HTTPS e hosts aprovados; não aceitar URL arbitrária recebida do usuário.

## Regras comerciais que a UI deve preservar

- Mensal:1 médico R$197;2 R$397;3 R$544;4 R$691;5 R$838. Três administrativos incluídos. Médico/CRM e atendente administrativo são cotas diferentes; não vender um quarto administrativo online.
- Trial14 dias desde a criação no Auth, sem reiniciar ao escolher plano, trocar dispositivo ou pagar.10 pacientes,15 agendamentos e15 por categoria temporária conforme `TRIAL_RESOURCE_LIMITS`. WhatsApp, Asaas de pacientes, convites, IA operacional e TISS indisponíveis durante a avaliação.
- Pagamento antecipado confirmado remove restrições temporárias; plano/permissões continuam. Pagamento não configura WhatsApp/Asaas/IA nem habilita TISS operacionalmente.
- Upgrade/downgrade AbacatePay: próximo ciclo pago, sem cobrança proporcional avulsa nesta política. Não antecipar cota ao aceitar o pedido.
- Cancelamento: renovar não mais, acesso até fim pago; AbacatePay não oferece desfazer cancelamento. Preservar o comportamento distinto dos contratos Asaas e dos anuais anteriores. Nova venda anual permanece indisponível.
- Reembolso/disputa: revisão humana e período pago preservado conforme ADR071; não adicionar botão que execute reembolso ou bloqueio imediato.

## SSR, hidratação e Sentry/R51

R51 raro não foi encerrado globalmente. A amostra SaaS anterior passou26 checks estritos em1440/390,Tóquio/SãoPaulo,sem pageerror/overflow; isso não prova ausência em toda rota. Dashboard/PainelShell/root layout do runtime congelado coincidem com main5620a098; o shell acrescenta aviso de trial. Não atribuir a variante exclusivamente ao TISS.

Preservar `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, redatores e `src/lib/observability/sentry-environment.test.ts`. Cliente usa `NEXT_PUBLIC_VERCEL_ENV`, servidor/edge `VERCEL_ENV`; `NODE_ENV=production` sozinho não identifica Production na Vercel. Conferir ambiente/release/SHA reais em eventual evento, sem disparar probes repetidos ou copiar segredos para a UI. Não adicionar Session Replay para telas clínicas.

No redesign:mesma árvore inicial servidor/cliente, HTML válido, IDs estáveis e componentes client/server corretamente separados. Datas explícitas de Brasília; não calcular ativação ou expiração com relógio do navegador. Não usar `suppressHydrationWarning`, desativar SSR ou suprimir Sentry para esconder R51. Se navegação, escolha, checkout ou administração da assinatura falharem, o defeito passa a bloquear o release SaaS; componentes globais são liderados pela UI e exclusivos TISS por seu responsável.

## Regressão exigida depois de mudanças visuais

1. Comparar diff com o runtime congelado:nenhuma alteração não aprovada em regras financeiras, RPCs, contratos, cookies, SQL ou variáveis.
2. Executar testes existentes: `plan-selection-form.test.tsx`, `payment-return.test.tsx`, `deferred-subscription.test.tsx`, assinatura `page.test.tsx`/`plan-change-form.test.tsx`, rotas `/api/billing/*` e `sentry-environment.test.ts`.
3. Rodar os E2E existentes `e2e/abacatepay-plan-ui.spec.ts` e `e2e/public-surface.spec.ts` pelo `playwright.ci.config.ts`, no build isolado preparado. Não criar pagamento para testar layout.
4. No Preview autorizado e fixture existente:trial/pago/processando/indisponível, desktop/mobile, valores1–5médicos, duplo clique, retorno, logout e negação de permissão. Não inferir efeitos financeiros de mocks de UI; provas DB/provedor ficam separadas.
5. Se shell/layout mudar, repetir a amostra estrita de SSR/hidratação com console/pageerror, larguras1440/390 e fusos Brasília/Tóquio. Registrar SHA, data, rota, erro sanitizado e limites da amostra.
6. Build/tipos/lint/CI no SHA integrado. Não fazer merge ou publicar Production como consequência automática de testes verdes.

**Aceite do handoff:**a definir. O documento publicado não comprova leitura pelo agente UI. Informar branch/worktree/SHA, arquivos compartilhados planejados e resultado dos testes; coordenação financeira não bloqueia esperando o redesign completo quando não há mudança em contrato compartilhado.
