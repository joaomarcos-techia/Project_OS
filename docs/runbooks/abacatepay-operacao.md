# Operação e recuperação AbacatePay

## Escopo prevalente — ensaio somente Sandbox, 17/11/2026

**O fundador escolheu usar a candidata do PR #53 exclusivamente no Sandbox. Não criar clínica, checkout ou cobrança em Production.** A indicação anterior de “nova clínica” passa a se referir a uma fixture sintética no DEV; não solicitar dados de um titular real para este ensaio. C3/C4 reais continuam não autorizados. O procedimento de C3 abaixo foi preparado, mas não é uma ordem vigente de execução.

A cópia da main permanece isolada e sem alterações: branch local `test/abacatepay-main-sandbox-20261117`, worktree `C:/dev/Qoro_main_abacatepay_sandbox_20261117`, HEAD `5620a0987ec53db7d7358728eb7d457d9d373df3`. A main não contém AbacatePay; não incorporar o PR #53 nessa cópia. Usar a branch `feat/billing-abacatepay-20261107` e seu Preview, nunca `app.qoro.dev`. O Preview `project-z8imt6mg4-clinic-os-v2-s-projects.vercel.app`/`75b41401` estava READY no primeiro preflight; a CI desse SHA passou com 7.338 testes e 27 E2E. Checks e Preview de qualquer commit posterior precisam ser conferidos separadamente.

### Compatibilidade do operador com o DEV compartilhado

O preflight somente leitura de **17/11 às 15:26:13 UTC**, com TLS `verify-full`/CA, confirmou o projeto DEV `pqhkirrszzpwezdaqrai` e **166 entradas** no histórico. O operador antigo reconhecia até160 e interrompeu antes de criar Auth, clínica ou checkout. Os hashes/horários das seis entradas `0160–0165` coincidem exatamente com o source TISS `4aaff5446f251d23e709360bcc84ef9bceed37ff`; revisão encontrou extensões de reembolso de pacientes e tabelas/permissões/gatilhos HI, sem DDL sobre contratos/invoices SaaS. Não tratar contagem isolada como aprovação.

Correção restrita a `scripts/abacatepay-checkout-session.ts`: reconhecer um prefixo contíguo dessas seis entradas já aplicadas por timestamp e SHA256, somente após conferir o release financeiro congelado. Hash alterado, lacuna, nova entrada desconhecida, financeiro divergente ou contagem sem explicação continuam bloqueando. O manifesto/journal SaaS de160 entradas e o SQL não mudaram; nenhuma migration foi copiada ou aplicada, e nenhum worktree TISS/UI foi modificado. **53 testes do operador PASS**, sem SKIP; lint/formatação PASS. CI do novo SHA deve ser ligada no PR, sem atribuir a ela a CI75b41401.

### Executar o ensaio após os guards

1. Conferir Preview READY e SHA da candidata; runtime assinado deve apontar Auth e banco ao DEV. Validar loja, probe e cinco produtos com `devMode=true`, catálogo/valores, webhook Sandbox apontando à mesma release e rejeição de segredo inválido. A credencial central de Production não é usada. O primeiro preflight passou essas etapas; houve uma falha transitória de leitura da loja, recuperada pela retentativa de GET, sem POST financeiro.
2. Usar o operador existente em `prepare` e depois `stage`, cenário `early_payment`, para criar somente fixture sintética, trial e perfil pelo fluxo real do Preview. Senha em DPAPI/ACL privada, sem envio a pessoa real e sem criação de checkout em `stage`. Não reaproveitar fixtures já pagas nem mover relógio de conta provisionada. O plano da fixture é dado de teste, não contratação real.
3. Conferir UI, persistência, clínica/assinatura/binding/política/claim e ausência de invoice paga/liberação antecipada. Para teste manual, usar apenas o Preview conferido e a credencial da fixture sob custódia protegida. Registrar o resultado real no PR; não antecipar PASS enquanto o navegador/banco não concluírem.
4. Se for solicitado um checkout, executar somente depois de novo preflight Sandbox e correlação da mesma obrigação. O usuário fará o pagamento de teste; não pagar, simular pagamento como real ou criar contratação live. Não repetir as cinco compras Sandbox já homologadas apenas para reproduzir evidência.

Uma nova migration de outro agente depois deste inventário deve voltar a bloquear o operador até revisão exata; não remover essa proteção para acelerar o ensaio. Preservar fixtures e manifests em timeout/estado desconhecido, sem recriar identidades ou obrigações cegamente. Nenhum build pesado local ou alteração de configuração Production é necessário para esta correção do operador.

## Gate C3 — procedimento assistido preparado em 17/11/2026

**PREPARAÇÃO; EXECUÇÃO NÃO AUTORIZADA.** C2 homologado nas quatro horas existentes. Production continua no C2 `25d01b17` com aquisição fechada. CI/Snyk da baseline documental `90817b13` passaram; a correção posterior de ambiente na troca de plano exige CI própria e composição identificada antes do deployment autorizado. [Evidências, defeito e pré-requisito do piloto](../decoupling/asaas-to-abacatepay/ABACATEPAY-SaaS-GO-NO-GO-FINAL.md#preparação-c3--17112026-após-08h00-utc). Este checkpoint prevalece; os formulários antigos abaixo são históricos.

### Parada inicial: obter um piloto elegível

Consulta somente leitura de 07:57:52 UTC: **cinco contratos Asaas e nenhuma clínica AbacatePay elegível**. Não selecionar clínica, migrar contrato ou criar titular fictício. O fundador informa UUID/consentimento e médicos; se disser “nova clínica”, o GO terá de incluir seu provisionamento restrito antes de qualquer checkout. Confirmar Auth verificado/proprietário correto e usar a transação já testada de onboarding para formar assinatura trial, binding, política e trial claim coerentes. A leitura do checkout não faz esse provisionamento. Convite legado e edição manual de provider não substituem a transação. Não reutilizar o operador DEV/Sandbox contra Production. A execução de provisionamento live ainda precisa ser delimitada/validada com o beneficiário definido.

Após existir o piloto, em transação explicitamente READ ONLY verificar **um** contrato da clínica: `billing_provider=abacatepay`, `asaas_subscription_id IS NULL`, status trial, sem cancelamento, política não liberada, binding da conta Production/loja esperada e sem assinatura externa paga; Auth/claim/proprietário e plano/preço devem coincidir. Zero ou múltiplos resultados, claim ausente, qualquer assinatura Asaas ou geração já paga: PARAR. Não corrigir esses estados durante o preflight nem criar segunda obrigação.

### Configuração exata proposta, somente após GO

| Variável/barreira | Atual | C3 proposto |
| --- | --- | --- |
| `SIGNUP_ENABLED` | `false` | Manter `false` |
| `SAAS_SIGNUP_PROVIDER` | `asaas` | Manter `asaas` |
| `ABACATEPAY_ENVIRONMENT` | `production` | Manter `production` |
| `ABACATEPAY_NEW_CHECKOUTS_ENABLED` | `false` | `true` |
| `ABACATEPAY_CHECKOUT_CLINIC_IDS` | Vazia | Exatamente o UUID aprovado, sem lista adicional |
| WAF cadastro | Ativo v5 | Manter bloqueio dos POSTs `/api/signup/sessions` e `/api/signup/checkout` |
| Receiver/consumidores/scanner/cron | Ativos | Preservar; não dependem da flag de aquisição |
| Chave/loja/catálogo/secret | Production central | Preservar; nenhuma chave da clínica ou novo segredo |

O teste de aquisição comprova essa combinação com provedor de signup Asaas e um único UUID. Isso autoriza checkout apenas para contrato AbacatePay elegível; não habilita o cadastro público. O POST `/api/billing/checkout` exige sessão, tenant, origem confiável e `MANAGE_SETTINGS` fresca; aceita apenas `{}`. Valor/ciclo/produto são calculados pelo contrato/catálogo do servidor. Trocas de plano e cancelamento de contratos existentes têm seus próprios guards; a flag de aquisição **não é** um bloqueio geral dessas operações.

A futura publicação deve partir da composição SaaS C2 identificada (`25d01b17`, manifesto `f56ed41b370d065ce65900a60fcaa0d923500279dc0cd9a6cfa2a71d69f1a042`), com somente o delta aprovado `environment: account.environment` em `abacatepay-plan-changes.ts`. Exigir CI do SHA da correção, novo manifesto da composição e READY no deployment sem promoção automática; sem migrations, TISS `0160+`, merge ou alterações de preço. Os checks do C2 não substituem o build dessa nova composição. A configuração só vale no deployment novo; testar preflight e então promover `app.qoro.dev` dentro da janela autorizada. Registrar deployment/configuração antes/depois, sem valores secretos.

### T0–T4: uma clínica, uma obrigação

| Etapa | Operação e evidência exigidas | Ponto de parada |
| --- | --- | --- |
| T0 — antes | Confirmar GO, consentimento, UUID/owner/RBAC, plano/preço BRL mensal/médicos/equipe, runtime/CI/manifesto, flags/coorte, loja/webhook/secret presente, health/Redis, inbox/outbox/leases e heartbeats. Capturar somente IDs e agregados sanitizados; cinco Asaas separados. Repetir elegibilidade acima e conferir inexistência de checkout/operação pendente para a mesma obrigação. | Clínica ainda não provisionada, ausência de permissão, valor/loja divergente, fila travada, operação desconhecida ou falha de monitoramento: não abrir. |
| T1 — criação | Responsável autenticado abre `/configuracoes/assinatura` e solicita checkout uma vez. Associar intenção, business key, operation, binding, checkout, produto, preço e clínica. GET da loja/produto/checkout e listagem por checkout confirmam geração esperada. Registrar horário, status e ID sem link de pagamento em logs públicos. | Timeout/unknown: consultar a operação/estado remoto; não criar outra cobrança nem clicar repetidamente para “resolver”. |
| T2 — pagamento | Pagador consentido conclui no checkout oficial, ciente do valor e recorrência mensal. Nenhum pagamento é executado pelo agente, API mestra ou simulador. | Divergência ou segundo pagador/assinatura: conter novas aquisições e preservar evidências. |
| T3 — conciliação | Acompanhar webhook autenticado, inbox/event ID/lease/outcome e readback autoritativo. Correlacionar payment/receipt/checkout/customer/subscription/produto/valor/moeda/loja/ambiente. Conferir invoice paga única, paid_checkout, binding, período calculado pela âncora aprovada, liberação da política trial e entitlements/cotas para a mesma clínica. | ACTIVE isolado, webhook isolado, invoice em aberto, receipt incompatível ou preço parcial não liberam direitos. Divergência abre revisão, sem status artificial. |
| T4 — depois | Aguardar fechamento automático pelo cron; conferir operação `close_paid_checkout` e auditoria `subscription.checkout.closed`, link remoto fechado, assinatura preservada e uma geração paga. Recarregar Assinatura e testar nova sessão do proprietário; conferir preço/plano, período, médicos e equipe. Readbacks devem continuar convergentes, sem segunda cobrança/invoice/entitlement nem backlog. | Link aberto além do limiar, lease vencida, desconhecido, duplicidade ou direito incorreto: conter. Não fechar manualmente para fabricar R1 PASS. |

As leituras necessárias estão nos readers e serviços reais: `initial-payment.ts`, `approved-card-receipt.ts`, `abacatepay-processing.ts`, `abacatepay-checkout-closure.ts`. Usar GET da loja, produtos, `/subscriptions/checkouts/get`, `/subscriptions/list?checkoutId=...` e recursos financeiros correlacionados conforme os readers; após o pagamento, não executar o helper de pré-C3 que exige zero assinaturas/checkouts live. SQL somente leitura nas tabelas `bindings`, `checkout_intents`, `operations`, `event_inbox`, `paid_checkouts`, `subscriptions`, `invoices`, `trial_access_policies`, `billing_events`, scans e heartbeats, sempre filtrado por clínica/assinatura/conta aprovadas. Não exportar payload, recibo, e-mail ou dados clínicos; não chamar cron manualmente nem reprocessar financeiramente como parte da leitura.

O período mensal do Qoro usa a âncora verificada de criação da assinatura externa após pagamento integral; não é confirmação da data da próxima cobrança no provedor. O reenvio/worker utiliza a mesma obrigação persistida. O journal evita um segundo POST com resultado desconhecido; isso pode exigir revisão humana em vez de tentativa automática cega. O fechamento remove a oportunidade do link conforme readback, preservando a assinatura e histórico; prova live ainda pendente. As cinco compras Sandbox anteriores são evidência reutilizada, não pagamentos repetidos neste ciclo.

### Monitoramento e contenção propostos para aprovação no GO

- Uma contratação por vez. Outbox esperada a cada minuto; conferir worker/Redis, idade das filas, leases e scan. Pagamento/inbox sem progresso por mais de 2min: alertar; mais de 5min: conter. Fechamento elegível aberto por mais de dois ticks: alertar; mais de 5min: conter. 429 persistente por mais de dois ticks: conter. Esses limiares são propostas para piloto, não SLA ou alertas já configurados.
- Qualquer tenant/loja/valor/receipt divergente, duplicidade, estado externo desconhecido, autenticação legítima falhando, Redis indisponível ou persistência perdida: interrupção imediata de novas contratações e acionamento técnico/financeiro. Preservar a obrigação, inbox/journal/invoices e os consumidores. Não cancelar, estornar, apagar ou recriar automaticamente.
- **Contenção de aquisição:** prever no GO a possibilidade de bloquear POST `/api/billing/checkout` no WAF de Production para todos os hostnames do deployment, sem bloquear receiver/cron/Asaas, e voltar as duas flags de aquisição ao estado fechado por deployment identificado. Validar bloqueio antes de considerar contenção completa. Alterar env ou promover o C2 fechado não altera retroativamente a configuração do URL imutável C3; conferir essa exposição explicitamente.
- Fechar a rota impede novas criações, mas **não invalida um link externo já emitido**. Nesse caso, acompanhar a mesma obrigação e seu fechamento seguro; qualquer ação externa adicional fora do fechamento automático contratado exige escopo autorizado. Um checkout reutilizável permanece risco R1 até prova real; não prometer uso único por `customerId` ou allowlist.
- Não desarmar `ABACATEPAY_ENVIRONMENT`, receiver, webhook, Redis ou consumidores para conter aquisição. Preservar cinco Asaas, cobranças de pacientes, crons e obrigações AbacatePay que passem a existir. Sem rollback automático de migrations ou reversão de webhooks legítimos.

### Pedido único preparado — GO C3, ainda não concedido

| Campo | Proposta/evidência ou dado indispensável |
| --- | --- |
| Identificação | `joaomarcos-techia/Project_OS`, PR #53 draft. SHA final/CI/manifesto da correção deverão ser transcritos do PR após conclusão, sem usar CI de outro SHA. Runtime atual C2 `25d01b17`; nova composição deve conter somente a correção localizada e configuração autorizada. |
| Beneficiário | **Fundador define:** clínica, UUID (ou nova clínica), responsável autorizado e consentimento explícito; ausência de elegibilidade atual exige provisionamento restrito previamente validado e incluído no GO. Não autorizar migração dos cinco Asaas. |
| Oferta | **Fundador escolhe:** 1/2/3/4/5 médicos por R$197/397/544/691/838 ao mês, até três pessoas administrativas, cartão no checkout oficial, sem trial nativo, anual, desconto ou prorrata novos. Plano/preço persistidos antes da abertura. |
| Responsáveis | Execução técnica/observação/rollback nesta sessão Codex, a reconfirmar disponível; **fundador nomeia/confirma** operacional, financeiro, suporte e incidentes. Podem ser a mesma pessoa, mas não presumir disponibilidade herdada do C2. |
| Janela | Proposta até60min após GO específico, fuso America/Sao_Paulo. Data/hora e disponibilidade a confirmar. Encerrar/fechar aquisição após uma contratação, sem expansão automática. |
| Alterações a autorizar | Provisionamento restrito se necessário; publicação da composição corrigida/validada; somente duas flags de aquisição para um UUID; preservação de signup fechado e WAF; contenção imediata da rota se incidente. Sem essas autorizações não executar. |
| Aceite específico | Ratificar riscos R1 live ainda não observado, R2 renovação natural13/12 futura, R3 eventos negativos parcialmente externos e R4 capacidade de uma clínica; B1-B segue DEFERRED/RISK ACCEPTED/NOT VERIFIED. Não confundir ratificação com PASS. |
| Condições antes do primeiro POST | CI/Snyk/segurança novos verdes, composição íntegra, elegibilidade e catálogo, responsáveis/consentimento, health/filas/cron/Sentry conferidos e contenção preparada. Falha fecha a janela. |
| Exclusões | Sem C4/expansão, cadastro público, migração Asaas, pagamento pelo agente, cancelamento/reembolso real de teste, migration, merge, mudança de preço/cota, TISS/UI ou restore real. |

**Parecer:** solicitação preparada; execução **NO-GO** até identificar/provisionar o piloto, concluir CI/composição da correção e receber GO C3 específico com riscos/janela/responsáveis. Não há autorização implícita neste documento. O êxito financeiro será registrado separadamente em T1–T4, nunca antecipado.

## Fechamento operacional C2 — 17/11/2026, após 04h15 Brasília

**C2 HOMOLOGADO NO RECORTE OBSERVADO — APTO PARA SOLICITAR GO C3. AQUISIÇÃO FECHADA; C3/C4 NÃO AUTORIZADOS.** [Dossiê e limites da prova](../decoupling/asaas-to-abacatepay/ABACATEPAY-SaaS-GO-NO-GO-FINAL.md#fechamento-c2--quatro-horas-conferidas-em-17112026). As instruções de observação pendente abaixo foram preservadas como histórico; não repetir deploy, migração ou quatro horas já comprovadas sem justificativa técnica.

- Janela UTC **03:15:27–07:15:27**, consultada após o marco: **240/240 ticks naturais da outbox HTTP 200**; **300 crons naturais**, oito rotas, todos 200. **1.187 requisições**, zero 5xx/429/499/status desconhecido, sem paginação restante ou intervalo excluído. **1.443 logs** parseados; zero falha de job, transporte/GET ou Redis. Worker 564–1.000ms, medida parcial do corpo do worker, não tempo HTTP total.
- SQL final **07:17:22 UTC**, `READ ONLY`, TLS/CA verificados: inbox/operações/scans/bindings/leases **0**; outbox ativa **0**, **691 processed + 36 skipped**; heartbeat outbox `success` às 07:16:28 UTC. Zero obrigação AbacatePay, duplicidade ou invoice entre clínicas. Cinco contratos permanecem Asaas.
- Hashes de planos/preços iguais. Hashes de invoices/assinaturas alterados por **webhooks Asaas legítimos** às 04:00:55 e 06:09:35 UTC: `RECEIVED` de invoice já paga e `OVERDUE` de obrigação existente, ambos autenticados, com readback, dedup e persistência. A transição `active→past_due` foi esperada pelo estado `OVERDUE`, sem troca de plano. Cinco notificações terminais `skipped_no_handler` não carregam trabalho financeiro pendente: os efeitos foram aplicados no próprio webhook.
- Sentry `7851117028`: evento enviado pelo fundador às **03:14:28 UTC**, request `bqdx8-1794885267160-ac2e89bba919`, confirmado na Vercel como **500 do deployment antigo** `dpl_Dar6PpR89Lc3Zy8Ufdn2LW3i3GQF`/`44323990…`. A issue `7851119668` do anexo histórico também pertence ao antigo. Nenhum sinal equivalente no corretivo durante quatro horas. API Sentry ainda 401; histórico integral/alertas não lidos diretamente e issues não encerradas.
- Provedor/saúde/fechamento reconfirmados: loja/cinco produtos/webhook corretos, zero checkouts/assinaturas live, health autenticado 200, cadastro fechado, flags corretas, coorte vazia, WAF v5 ativo. Runtime `25d01b17e9ee950c5760124445e4d1b2d9c0291e`, alias e 21 crons preservados. Nenhum comando financeiro ou mutação de Production pelo operador.

**Próxima decisão específica:** usar a solicitação C3 preparada abaixo para **uma** clínica consentida. O fundador define UUID/consentimento, plano/quantidade/preço, janela/responsáveis e aceita ou rejeita separadamente R1–R4. A proposta não está aprovada. Até o GO expresso, não mudar flag/coorte/WAF, não criar checkout e não executar deployment. Manter consumidores e obrigações existentes. R1–R4 PARTIAL; B1-B DEFERRED/RISK ACCEPTED/NOT VERIFIED; retry em testes PASS e em falha natural live NOT OBSERVED. O canal Sentry tem comprovação histórica do fundador, não um novo teste de notificação neste ciclo.

## Retomada somente leitura — C2 em observação, 17/11/2026

Checkpoint de 04:03:52 UTC/01:03:52 Brasília: **49/49 ticks naturais da outbox HTTP 200**, mais 12 execuções naturais de outros crons HTTP 200; zero HTTP 5xx/429 nas 250 requisições retornadas. Consultas Vercel sem páginas restantes ou intervalos excluídos. Filas lidas diretamente sem backlog/leases; hashes de planos/preços/invoices/assinaturas legadas iguais ao snapshot anterior; loja central e zero contratações live conferidos por GET. Flags/WAF continuam fechados, 21 crons preservados e health autenticado Auth/Redis/Asaas/outbox aprovado. [Recortes e limites no dossiê](../decoupling/asaas-to-abacatepay/ABACATEPAY-SaaS-GO-NO-GO-FINAL.md#leitura-operacional-prevalente--17112026-040352-utc--010352-brasília).

**C2 PARTIAL / OBSERVATION PENDING; C3/C4 NO-GO.** O término mínimo permanece **07:15:27.232 UTC/04:15:27.232 Brasília**. A captura do Sentry mostra 10 eventos `unavailable`/3 `binding_mismatch`, mas não mostra a release ou o horário absoluto; a API retornou 401. Obter apenas os metadados do último evento pelo painel autorizado. Não chamar cron, reprocessar eventos ou forçar falha live.

### Leitura de encerramento reproduzível

Após o marco, conferir alias/runtime `25d01b17e9ee950c5760124445e4d1b2d9c0291e` e deployment `dpl_J5FPbdLDxBwcoBuRMgrkcwJrVbHL`. Consultar separadamente requisições e runtime, usando a CLI autenticada existente:

```powershell
vercel logs requests --project project-os --scope clinic-os-v2-s-projects --deployment dpl_J5FPbdLDxBwcoBuRMgrkcwJrVbHL --since 2026-11-17T03:15:27Z --until 2026-11-17T07:15:27Z --limit 10000 --json
vercel logs runtime --project project-os --scope clinic-os-v2-s-projects --deployment dpl_J5FPbdLDxBwcoBuRMgrkcwJrVbHL --since 2026-11-17T03:15:27Z --until 2026-11-17T07:15:27Z --limit 10000 --json
```

Esses comandos são para o operador autorizado. Processar em memória e registrar apenas agregados sanitizados; não colar logs brutos no chat ou no Git. Conferir `pagination.hasMore=false` e `excludedIntervals=[]`; caso contrário, paginar antes de classificar cobertura. A CLI arredonda os limites para segundos; registrar essa precisão e usar o relógio após 07:15:27.232 UTC para atestar as quatro horas. Contar somente registros `type=request`, caminho exato `/api/cron/outbox` e agente `vercel-cron/1.0` como ticks naturais de outbox. Inventariar também os outros caminhos cron. Duração `worker.tick.duration_ms` mede só o corpo do worker; não apresentá-la como duração HTTP completa. Obter os metadados de duração total no provedor se disponíveis; quando ausentes, manter **NOT VERIFIED** nesse detalhe.

Repetir leitura SQL em `qoro-prod` com TLS `verify-full`/CA oficial e transação explicitamente `READ ONLY`: inbox por estado/tentativas/idade, outbox por estado/tentativas/idade, operações e scans por estado, leases ativas/expiradas, heartbeat, bindings, assinatura/invoice/períodos AbacatePay, duplicidade e vínculo entre clínicas. Comparar hashes dos campos originais de planos/preços/invoices/assinaturas com a referência existente. Não imprimir linhas, resultados de operações, payloads ou segredos. Conferir loja/catálogo/webhook por GET, sem reconfiguração. A prova HTTP, o snapshot SQL, a autenticação e o processamento financeiro têm limites distintos.

Classificar `RETRY EM TESTES: PASS` pela evidência da CI existente; `RETRY EM FALHA NATURAL LIVE: NOT OBSERVED` se nenhum evento transitório o exercitar. O wrapper só registra heartbeat `success` após todos os jobs resolverem; rejeições produzem `worker.job_failed`, captura de erro e HTTP 500. Verificar esses sinais conjuntamente. Uma outbox vazia demonstra ausência de trabalho pendente conhecido; não homologa pagamento real ou recuperação de uma falha que não aconteceu.

### Solicitação C3 preparada — ainda não emitida como recomendação de GO

Somente após C2 homologado, apresentar ao fundador um pedido único com estes campos e condições:

| Campo | Valor/condição |
| --- | --- |
| Release | PR #53 draft; runtime corretivo `25d01b17e9ee950c5760124445e4d1b2d9c0291e`; confirmar identidade e CI vigentes antes da janela |
| Clínica | UUID e consentimento a serem definidos expressamente pelo fundador; nenhuma selecionada pela engenharia |
| Oferta | Escolher e confirmar Consultório 1 médico/R$ 197 ou Clínica 2–5 médicos/R$ 397/544/691/838 mensais; sem anual ou preço especial implícito |
| Responsáveis/janela | Fundador confirma disponibilidade operacional/incidentes e janela; executor técnico identificado na sessão; confirmação anterior não abre uma janela futura automaticamente |
| Escopo financeiro | Um checkout para a clínica consentida, pagamento feito pela pessoa autorizada; sem migração de contratos Asaas ou expansão automática |
| Aquisição | GO deve especificar exatamente a coorte de um UUID, flags/barreira que precisam mudar e o novo deployment; demais clínicas continuam bloqueadas |
| Riscos | Decisão expressa sobre R1 fechamento live, R2 renovação futura, R3 eventos negativos e R4 capacidade do piloto; B1-B continua adiado com risco aceito e restore real não verificado |
| Monitoramento | Alias/release, Sentry Production e logs, webhook/inbox/outbox/leases, scanner e heartbeat acompanhados durante a primeira contratação |
| Prova da contratação | Valor/loja/cliente/identificação do checkout, assinatura externa única, evento autenticado, pagamento único, invoice única, período correto e cota aplicada à mesma clínica; readback do provedor e banco |
| Fechamento/recuperação | Observar fechamento automático e reconciliação reais; reutilização do link, assinatura/invoice duplicada, estado externo desconhecido ou falha persistente exigem interrupção |
| Contenção | Fechar somente novas aquisições pelo procedimento aprovado, preservando consumidores e obrigações pagas; sem refund/cancelamento automático, DOWN de migration ou atualização artificial de status |
| Resultado exigido | Registrar separadamente cada evidência; falha concreta impede continuidade. Piloto e expansão 1→3→10 exigem autorizações próprias |

Este formulário é preparação operacional. Nenhum checkout, pagamento, abertura de coorte, deployment ou aceite R1–R4 está autorizado por ele.

## Checkpoint operacional — C2 corretivo publicado em 17/11/2026

O deployment **`dpl_J5FPbdLDxBwcoBuRMgrkcwJrVbHL`** (candidato `25d01b17e9ee950c5760124445e4d1b2d9c0291e`, CI 43982947396 GREEN) atende `app.qoro.dev` desde cerca de **03:14 UTC/00:14 Brasília**. Foi criado sem promoção automática, teve build `READY`, smoke no endereço imutável e só depois recebeu o alias. Não houve migration, mudança de WAF/variáveis, merge ou operação financeira. Aquisição: **fechada**. Gate C3/C4: **NO-GO**. O bloco abaixo que diz “não promover este código” é histórico, anterior ao GO corretivo; a observação de estabilidade ainda está em andamento.

**Antes da promoção:** Supabase Production lido com TLS `verify-full`: inbox/operações/varreduras/bindings AbacatePay 0; outbox ativa 0; leases 0; identidade técnica central 1; zero assinaturas e checkouts live AbacatePay; cinco assinaturas Asaas. Vercel Production: cinco flags de fechamento corretas, WAF v5/regra de fechamento, 21 crons, chave e secret presentes sem revelar valores. Provedor: cinco produtos live e webhook único correto por GET. O pacote usa TAR-base `6038df0d…` mais as diferenças de `src` do SHA corretivo; manifesto completo `f56ed41b370d065ce65900a60fcaa0d923500279dc0cd9a6cfa2a71d69f1a042`, 160 migrations, sem `0160+`.

**Depois da promoção:** alias/SHA/21 crons e host conferidos; `/cadastro` continua fechado; health Auth/Redis/Asaas 200; receiver rejeitou POST sintético sem autenticação com 401; webhook live permaneceu registrado. Os primeiros quatro ticks naturais da outbox foram 200 entre 03:15:27 e 03:18:28 UTC, sem erro de runtime no recorte então lido. Inbox/operações/varreduras/bindings e outbox ativa continuaram zeradas, heartbeat `success`, cinco assinaturas Asaas e zero AbacatePay. Não acionar cron, checkout, replay ou pagamento para ampliar a amostra.

**Próxima leitura obrigatória:** após **07:15:27 UTC/04:15:27 Brasília**, comparar somente logs do novo deployment a partir de 03:15:27 UTC. Contar ticks 200/500 e correlacionar qualquer 500 por `requestId` com `worker.job_failed`, operação `billing.abacatepay.read_attempt_failed`, categoria `read_transport_failed` ou `coordination_unavailable`; conferir heartbeats, inbox, outbox, leases, duplicidade e estado de Asaas. Se não houver falha natural, classificar retry live como **não observado** (prova de CI preservada). Não declarar quatro horas PASS antes da hora ou sem leitura completa. Erro financeiro persistente ou pendência ambígua mantém C3 bloqueado. O canal Sentry Production foi confirmado pelo fundador na janela anterior, mas os issues autenticados `7851117028` e `7851119668` não foram lidos diretamente nesta sessão. [Evidência e limites](../decoupling/asaas-to-abacatepay/ABACATEPAY-SaaS-GO-NO-GO-FINAL.md).

## Diagnóstico de `unavailable` após C2 — candidato local de 16/11/2026

**Não abrir C3 nem promover este código sem GO corretivo específico.** O deployment C2 registrou nove `/api/cron/outbox` HTTP 500 de 18:40 a 23:36 UTC, cada um com `worker.error: GatewayReadError unavailable`. A instrumentação candidata ainda não estava publicada nesses eventos; não inferir que os nove falharam no mesmo GET. Sentry autenticado e fila atual não foram verificados nesta rodada.

No próximo deployment autorizado, correlacionar pelo `request_id` do cron: `worker.job_failed.job` identifica `outbox`, `abacatepay_recovery`, `abacatepay_inbox`, `abacatepay_closures` ou `abacatepay_renewal_watch`; `billing.abacatepay.read_attempt_failed.operation` identifica o caminho GET fixo sem query; `billing.abacatepay.read_transport_failed` classifica fetch/stream sem causa bruta; `billing.abacatepay.request_control.outcome=coordination_unavailable` aponta para Redis. Conferir código/status, tentativa, duração e `willRetry`. HTTP 401/403/429 e falha de coordenação não recebem retry automático; somente GET transitório pode fazer uma segunda tentativa dentro do deadline. O HTTP 500 e o heartbeat de erro permanecem se algum job falhar. Uma resposta 200 não comprova que a fila está vazia.

Antes de pedir C3, ler inbox/outbox/leases/heartbeat por canal administrativo autorizado, observar as execuções naturais após o corretivo por janela proporcional às recorrências, confirmar ausência de duplicidade e preservar Asaas/pagamentos de pacientes. Sem leitura autorizada de filas, classificar **ESTADO DA FILA NÃO VERIFICADO**. Não executar cron manual, replay, limpeza de leases ou cobrança para gerar evidência.

## Alerta posterior à janela — 16/11/2026, 22:25 UTC

O deployment C2 `dpl_Dar6PpR89Lc3Zy8Ufdn2LW3i3GQF` atendeu o cron compartilhado após a janela e teve **cinco HTTP 500 em 224 execuções** desde 18:40:13 UTC; as outras 219 retornaram 200. A consulta foi somente leitura, filtrada por esse deployment e por `/api/cron/outbox`, limite 1.000 sem truncamento. Horários dos 500: 19:01:27, 19:58:27, 20:38:27, 22:00:27 e 22:18:27 UTC. Em cada um, a métrica de runtime `worker.error` classificou a falha como `GatewayReadError: unavailable`. As execuções mais recentes até 22:24:27 UTC voltaram a 200. **Não declarar o incidente de transporte resolvido nem iniciar C3 enquanto esta recorrência não for tratada ou decidida expressamente.** A antiga falha `binding_mismatch` não reapareceu nos cinco erros observados.

O stack do alerta original 7851117028 aponta para o GET do produto de verificação; a telemetria posterior só confirma a classe `unavailable`, sem stack por ocorrência. O probe usa timeout de 1,5 s e uma tentativa padrão. Não atribuir os cinco novos erros ao mesmo ponto sem prova. Preservar o alerta e a falha HTTP; investigar etapa/latência de forma sanitizada e, se indicado, preparar retry limitado com teste de falha, sem renovar a janela de Production implicitamente. O `Promise.allSettled` espera a outbox e os demais trabalhos antes de devolver 500, mas o status HTTP isolado não comprova perda de eventos. Nenhuma alteração de Production foi feita nesta leitura.

## Checkpoint prevalente — C1/C2 executados, 16/11/2026

**C1 PASS / C2 PASS técnico não monetário; aquisição FECHADA; C3/C4 sem autorização.** Janela encerrada 2026-11-16T18:40:12.813Z, após 46.6min. Atual: dpl_Dar6PpR89Lc3Zy8Ufdn2LW3i3GQF em app.qoro.dev; ABACATEPAY_ENVIRONMENT=production, receiver e quatro jobs ativos. SIGNUP_ENABLED=false, SAAS_SIGNUP_PROVIDER=asaas, ABACATEPAY_NEW_CHECKOUTS_ENABLED=false, coorte vazia e WAF5 preservados. PR53 draft/sem merge. [Dossiê da execução](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#checkpoint-prevalente--c1c2-executados-16112026).

### Pré-requisito central descoberto e conferido

O scanner exige a identidade da loja em billing_gateway.accounts antes de aceitar trabalho; a ativação anterior ao primeiro onboarding encontrou tabela vazia. O onboarding normalmente cria essa identidade apenas ao provisionar a primeira clínica AbacatePay. **Não abrir aquisição para resolver isso, não criar clínica fictícia em Production e não ignorar binding_mismatch.**

Nesta janela, após conter C2 no deployment anterior e conferir loja/ambiente/catalogo/constraints/triggers, foi inserida somente a identidade técnica provider=abacatepay/environment=production da loja central autenticada. INSERT idempotente equivalente ao existente em signup-free-trial.ts, numa transação com lock/statement timeout. Não armazena API key nem cria cliente, clínica, assinatura, binding, pagamento, invoice ou entitlement. Não houve migration nem backfill de contratos. Futuro preflight deve conferir **exatamente a identidade esperada**, sem presumir que accounts=0 seja requisito ou que qualquer conta sirva; identidade divergente exige parada, não sobrescrita. Não apagar essa linha para ocultar o incidente.

### Incidentes desta janela

- **7851117028 / unavailable,18:23,18:24 e18:35UTC:** GET do probe sem resposta HTTP. Rejeição de transporte comprovada, causa DNS/TLS/reset/timeout não identificada pelo erro sanitizado; não alterar timeout/TLS nem ocultar alerta sem diagnóstico.
- **7851119668 / binding_mismatch,18:25–18:27UTC:** SELECT da identidade central não encontrou linha. Retorno temporário ao Gate B18:27:24UTC, bootstrap técnico conferido18:33:50UTC e reativação da mesma versão18:34:22UTC. 4 execuções naturais200/zero5xx e zero worker.error no recorte estável desde18:36UTC. Métricas recovery/inbox/watch ociosas; handler aguarda closure e demais jobs antes de200. Isso não prova operações financeiras externas.
- CLI60.1.3 de promote falhou por dependência luxon ausente antes de alterar o alias; leitura confirmou domínio anterior. Promoção executada pelo mesmo endpoint oficial usado pela CLI e confirmada assincronamente por GET. Sem reinstalar/alterar cache compartilhado. Primeiro deploy não criado por limite do buildCommand; candidato intermediário READY sem atestação não foi promovido. O candidato aceito possui o marcador de atestação real e overlay declarado; preservar esse histórico.

### Chave mestra — conferência exigida

| Item | Estado e alcance |
| --- | --- |
| Chave Production correta | PASS: Sensitive na Vercel e autenticação da loja dentro do build real; valor não exportado |
| Nome da variável | PASS: ABACATEPAY_API_KEY, somente servidor |
| Checkout SaaS usa a central | PASS de código/testes preservados; nova chamada monetária live NÃO EXECUTADA |
| Cinco produtos da loja | PASS: MONTHLY/BRL/devMode=false, R$197/397/544/691/838, sem trial nativo |
| Webhook da mesma loja | PASS: único webh_prod_CzMcusdfp5CzFNKWegnjxcaP, oito eventos aceitos e secret distinto correspondente |
| Consumidores/ambiente/conta | PASS técnico ocioso: runtime Production + identidade central correta + crons naturais; sem evento financeiro real |
| Vínculo individual clínica/assinatura | PASS de schema/código/testes anteriores; zero binding AbacatePay live, não alegar contratação real |
| Chave AbacatePay por clínica | PASS da revisão: não utilizada; pagamentos de pacientes/Asaas são separados |
| Exposição da chave | PASS no escopo revisado/build/bundle/relatório, sem valores públicos; não é garantia absoluta contra toda vulnerabilidade |
| Pronto para primeira cobrança | PARTIAL: C1/C2 técnicos concluídos; C3 exige autorização/coorte consentida/valor e prova externa, R1–R4 não encerrados |

### Recuperação e próxima execução

O secret de C1 foi mantido protegido na Vercel; não rotacionar a chave mestra para resolver falha de rede ou dado técnico ausente. Backup de configuração local DPAPI/ACL depende do perfil Windows e não é cofre independente. Fonte/TAR aprovados permanecem congelados; overlay de buildCommand está identificado separadamente e original exportado foi restituído. Não copiar segredos de um worktree ou substituir Sensitive por credencial local.

Antes de outra janela, confirmar alias, flags/WAF, identidade central, fila/leases, contratos, CI do SHA executor, catálogo e canal de incidente. Com zero obrigações AbacatePay é possível conter C2 usando o deployment anterior dpl_8uzoX6ngA66EgYcmMwcJn831UiBp e remover a variável de runtime; foi ensaiado nesta janela. **Se surgir obrigação real, não desligar receiver/cron/cancelamento/reconciliação necessários:** fechar aquisição/coorte, preservar obrigações e usar versão compatível. Sem DOWN ou exclusão de inbox/ledger.

Próximo GO é **C3 independente**, ainda não autorizado: informar clínica já provisionada/consentida, UUID, plano/médicos/valor, pagador, responsáveis, janela e decisão dos riscos residuais. Preparar uma única contratação e acompanhar provider/readback/inbox/invoice/binding/período/cota/closure; qualquer duplicate/unknown/tenant/valor divergente interrompe. Não fabricar webhook financeiro, marcar pagamento ou abrir cadastro público para comprovar conectividade. Renovação natural13/12 e eventos negativos não observados continuam pendentes.

Evidência: bloco gateCProductionWindow20261116 em recuperacao-financeira-20261111.json. Sentry5c780b15 com recebimento externo confirmado; issues históricas não foram alteradas no painel. B1-B permanece DEFERRED/RISK ACCEPTED/NOT VERIFIED. Checkpoints abaixo são históricos quando divergirem deste.

## Checkpoint prevalente — C0 PASS e pedido de C1/C2

[CI 43898026077/tentativa 2](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43898026077) **SUCCESS** no SHA 4f683402d62489f1b9ed385da904b27792c6e849, 16/11,15:44:28–15:59:34UTC: **7.329 testes/647 arquivos, 27 E2E, zero SKIP**, TypeScript/lint/build/segurança/isolamento PASS; ADR 43898026138 SUCCESS. Actions voltou a executar após correção do orçamento pelo fundador. Saldo/custo mensal não acessível à API; nenhum orçamento ou configuração foi alterado pelo agente. Estados BLOCKED dos checkpoints anteriores são históricos.

C0 técnico concluído no alcance da evidência. Este registro altera somente documentação; o HEAD documental subsequente terá seus checks conferidos e registrados no PR #53, sem transferir o GREEN anterior ou criar commit apenas para registrar a própria CI. A aplicação implantada permanece44323990b3f1fb9282418fec44a3182b02148c66, TAR 6038df0da3a6afaee68528c2f38c08743356ef6bdf6ece7ca808fd41672d0e64. Aquisição fechada, runtime AbacatePay desarmado. Nenhuma nova mutação Production.

### Solicitação pronta — C1/C2 sem contratação

| Campo                  | Proposta concreta e condição                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositório/PR         | joaomarcos-techia/Project_OS,PR #53 OPEN/DRAFT, sem merge                                                                                                                                                                                                                                                                 |
| SHA/artefato           | Evidência CI 4f683402 acima; HEAD documental final e CI próprios devem ser lidos no PR. Implantação C2 usa o mesmo TAR 6038…/aplicação44323990, sem novo código financeiro                                                                                                                                                |
| Alvos                  | Vercel project-os/prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ/time team_ml9fFeF262JqUMwFB6Vy61Cj; Supabase qoro-prod/shlcbxawrxuaebazuiue; loja live já conferida                                                                                                                                                                    |
| Janela proposta        | Até60min após GO específico e confirmação de disponibilidade,America/Sao_Paulo. Limite operacional conservador baseado na janela Gate B de 57 min 39 s que também incluiu DDL; não é SLA nem medição da futura etapa C. Data/hora inicial ainda dependem do fundador                                                      |
| Responsáveis propostos | Fundador: operação/incidentes; esta sessão: execução técnica/rollback; Sentry Production + chat. Disponibilidade/canal devem ser reconfirmados; a janela Gate B está encerrada                                                                                                                                            |
| GO C1                  | Registrar um webhook em https://app.qoro.dev/api/webhooks/abacatepay com secret seguro/eventos da sequência abaixo, após GET de duplicidade e conferência loja/ambiente. Readback de ID/devMode=false/endpoint/eventos. Sem runtime/consumer/checkout; 503 esperado antes de C2                                           |
| GO C2                  | Autoriza separadamente configuração+novo deployment+receiver e quatro consumidores com ABACATEPAY_ENVIRONMENT=production. Manter SIGNUP_ENABLED=false,SAAS_SIGNUP_PROVIDER=asaas,ABACATEPAY_NEW_CHECKOUTS_ENABLED=false, coorte vazia, WAF e obrigações Asaas. Receiver também processa inbox; não prometer receiver-only |
| Antes de executar      | CI final GREEN; reconferir alias/alvos/configuração/secret sem revelar valores, catálogo, duplicidades, filas e contratos; preservar snapshot de configuração. B1-B segue adiado com risco aceito, não convertido em restore PASS. Nenhuma nova migration prevista                                                        |
| Parada C1              | Evento necessário recusado, loja/modo divergente, duplicidade ou timeout com resultado desconhecido: GET/revisão,sem segundo POST cego. Não omitir evento necessário para obter sucesso                                                                                                                                   |
| Parada C2              | Autenticação incorreta, fila/lease sem progresso, 5xx persistente, contrato/tenant/valor divergente ou efeito financeiro inesperado: conter novos negócios e preservar obrigações/consumidores necessários; não apagar histórico ou usar DOWN                                                                             |
| Pós-voo C2             | Alias/env/flags/WAF,health,execuções naturais do cron, inbox/outbox, autenticidade negativa e entrega técnica não monetária autorizada/identificada; zero nova invoice/entitlement indevidos; monitoramento e registro sanitizado                                                                                         |
| Recuperação            | Antes de obrigação AbacatePay live, retornar configuração/deployment compatível fechado se necessário. Depois de existir obrigação, preservar receiver/cron/cancelamento/reconciliação; fechar aquisição em vez de desligar runtime/outbox compartilhada                                                                  |
| Exclusões              | Sem aquisição/coorte aberta,clínica piloto, pagamento real, cancelamento/reembolso real, contrato legado alterado, migration, merge ou expansão. C3/C4 exigem GO independente; R1–R4 não mudam para PASS                                                                                                                  |

**Recomendação: APTO PARA SOLICITAR GO C1/C2 quando os checks do HEAD final estiverem GREEN. Execução continua NÃO AUTORIZADA.** O único pedido neste ponto é autorizar explicitamente cada etapa e confirmar a nova disponibilidade; clínica/plano/pagamento só serão solicitados no C3. C1 não autoriza C2; C2 não autoriza C3.

Evidência: gateC0CiRecovery20261116 no registro financeiro existente. Os checklists técnicos C0–C4 abaixo permanecem aplicáveis, exceto o bloqueio histórico de Actions e a espera de CI 4f683402 já resolvidos. Não repetir pagamentos/ensaios aprovados ou pedir novamente host/cofre para B1-B.

## Checkpoint prevalente — C0 pós-Gate B, 16/11/2026

Autorização `a51a97b8-a2f2-4f7b-a049-d02bcf75a9c4`: DEV/Sandbox/CI e Production somente leitura. **Gate B concluído; aquisição fechada, AbacatePay live desarmada. C1/C2/C3/C4 não autorizados.** Os estados divergentes abaixo são históricos. Nenhuma nova migration, implantação, alteração live ou operação monetária foi executada.

Leituras15:18–15:25UTC: mesmo deployment `dpl_8uzoX6ngA66EgYcmMwcJn831UiBp`, aplicação `44323990b3f1fb9282418fec44a3182b02148c66`, TAR6038df0d…;160 migrations por ordem/hash, zero pendentes,22 relações críticas protegidas. Sete fingerprints de catálogo iguais ao pós-Gate B, índices/constraints válidos, sem locks pendentes/transações longas. Cinco contratos Asaas e hashes dos campos financeiros originais preservados.21 crons conferidos por rota/agenda/host; outbox sem pending/processing/failed, heartbeat success há6s e8 execuções naturais200/zero5xx no recorte observado. Nenhum worker invocado manualmente.

Catálogo live por GET15:19:40UTC: cinco produtos MONTHLY/BRL/devMode=false,197/397/544/691/838, sem trial nativo; webhooks200/zero. A chave local autenticou a loja esperada; **isso não prova igualdade entre segredos locais e Vercel**. Na Vercel foram lidos nomes de segredos e valores das flags não secretas. Sentry administrativo401; alertas ed622a74/414eb196 e Dashboard/Assinatura mantêm suas evidências anteriores, sem novo probe ou navegação autenticada.

**368 testes dirigidos PASS/20 arquivos/zero SKIP**, dois processos sequenciais com heap128MiB, sem segredos herdados, banco/browser/gateway real. São provas unitárias/contratuais novas, não novos ensaios PostgreSQL/Redis/HTTP ou pagamentos externos. Runtime/SQL/dependências congelados e inalterados. CI43831334234/35c6 GREEN é prova anterior; e5c84f3a/reexecução2 da CI43882384504 e ADR43882384626 não iniciaram runner por pagamento/limite. Timing desses dois runs:0ms billable, não gasto mensal da conta. OrçamentoUS$10 informado pelo fundador; escopo/saldo não acessíveis pela CLI, navegador indisponível. Não ampliar limite ou reexecutar cegamente. **Consultar a CI do HEAD final no PR53.**

### Sequência de C1–C4 preparada — executar somente após GO próprio

Alvos: PR53 draft; Vercel `project-os`/`prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ`, time `team_ml9fFeF262JqUMwFB6Vy61Cj`; Supabase `qoro-prod`/`shlcbxawrxuaebazuiue`; loja do catálogo conferido. Usar o mesmo TAR6038df0d…/aplicação44323990 se não houver correção. Sem merge, TISS funcional,0160–0162 ou redesign novo.

| Etapa | Ação após autorização específica                                                                                                                                                                                                                                                                        | Evidência e parada                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C0    | Testes sintéticos, leitura do alvo e revisão de evidências anteriores                                                                                                                                                                                                                                   | Sem defeito financeiro novo reproduzido; CI final bloqueada externamente                                                                                                                                                                                                       |
| C1    | GET/list antes de criar; um POST `/v2/webhooks/create` com name, endpoint HTTPS `https://app.qoro.dev/api/webhooks/abacatepay`, secret exclusivo≥32 caracteres e events. Obter secret de cofre/configuração aprovada, nunca argv/log/Git. Timeout após POST exige listagem/reconciliação antes de retry | Registrar ID/devMode=false/endpoint sem query/eventos. Parar por duplicidade, loja/ambiente/evento divergente. Registro não comprova entrega/efeito. Não armar runtime                                                                                                         |
| C2    | Reconfirmar responsáveis/janela/CI/alvos/chave/loja/catalogo/secret. Novo deployment identificado com `ABACATEPAY_ENVIRONMENT=production`; preservar `SIGNUP_ENABLED=false`, `SAAS_SIGNUP_PROVIDER=asaas`, `ABACATEPAY_NEW_CHECKOUTS_ENABLED=false`, coorte explicitamente vazia e WAF atual            | Conferir alias/env, health, cron natural, filas, rejeição de secret/HMAC/mode inválidos e uma entrega técnica não monetária aprovada/identificada. Sem invoice/ativação indevida. Parar por falha de autenticação, backlog/lease sem progresso ou efeito financeiro inesperado |
| C3    | GO independente com clínica já provisionada/consentida, UUID/plano/médicos/valor; novo deployment libera somente essa coorte em `/configuracoes/assinatura`. Cadastro público/WAF continuam fechados                                                                                                    | Uma contratação, pagamento pelo responsável, receipt/readback/inbox/invoice/binding/período/cota/closure/UI convergentes. Parar em duplicate/unknown/tenant/valor divergente ou fechamento persistente; não recriar cobrança por timeout                                       |
| C4    | GO próprio para1→3 e depois3→10 conforme observação/renovação/capacidade propostas abaixo                                                                                                                                                                                                               | Nenhuma ampliação automática; exceção aos critérios exige decisão explícita                                                                                                                                                                                                    |

**Acoplamento real:** `ABACATEPAY_ENVIRONMENT` arma conjuntamente receiver e quatro jobs financeiros em `/api/cron/outbox`; o receiver também tenta conciliar a inbox após aceitar o evento. Não existem flags independentes para prometer autenticação sem consumidores. C1 registra ainda desarmado: entrega recebe503 até C2, sem prova positiva de conectividade/autenticidade. C2 precisa autorizar **configuração + novo deployment + receiver/consumidores**, sem aquisição. Alterar variável não modifica deployment antigo. Outbox/crons/Asaas compartilhados permanecem ativos.

**Eventos propostos:** `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled`, `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`. Trial é interno; notificação de plano não antecipa cotas. A página de eventos descreve `payment_failed`/`plan_changed`, mas o enum publicado de criação omite ambos: **divergência documental externa**, não validação da API. Em C1, confirmar aceitação/retorno; se um evento necessário for recusado, parar sem omiti-lo ou inventar `*`. Não houve POST neste ciclo. Fontes: [criação](https://docs.abacatepay.com/pages/webhooks/create), [eventos](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [segurança](https://docs.abacatepay.com/pages/notificacoes/seguranca).

**R1/R2:** o [guia atual](https://docs.abacatepay.com/pages/cobrar/assinaturas) informa checkout individual e mesmo checkout nas renovações; a [transcrição histórica](../decoupling/asaas-to-abacatepay/SUPORTE-RESPOSTA-INTEGRAL-20261110.md) descreveu reutilização/bill por ciclo. Não dispensar closure nem inferir pagamento dessa divergência. O reader suporta bill de ciclo e, com período/receipt suficientes, bill original; ambiguidade segue para review, sem extensão paga automática. `nextChargeAt` não prova pagamento. Homologação externa continua dependente do evento real.

**Contenção:** depois de existir obrigação paga AbacatePay, fechar novas aquisições/coorte/WAF preservando runtime, receiver, cancelamento e reconciliação dos contratos existentes. Não remover runtime, desligar outbox compartilhada ou voltar para código incompatível como kill switch genérico. POST desconhecido exige GET/revisão; lease expirada usa recuperação existente; review/replay exige MFA/auditoria. Sem status financeiro artificial, nova cobrança cega, DOWN ou exclusão de histórico. Renovar snapshots de configuração antes da futura janela.

**Formulário preparado, não vigente:** GO C1 registro apenas; GO C2 configuração/deployment/receiver/consumidores com aquisição fechada; GO C3 contratação de uma clínica. Informar SHA final/CI/TAR acima, data/hora/fuso, duração proposta até60min, fundador operacional/incidentes **a reconfirmar**, execução técnica/rollback desta sessão e Sentry Production+chat **a reconfirmar**. Disponibilidade do Gate B encerrado não se transfere à nova janela. Nenhum gate libera o seguinte; não solicitar execução enquanto faltar CI final.

Evidência: `gateC0Homologation20261116` no [registro financeiro](../decoupling/asaas-to-abacatepay/evidencias/recuperacao-financeira-20261111.json). B1-B real permanece DEFERRED/RISK ACCEPTED/NOT VERIFIED; não reabrir pedido de host/cofre/PITR. R1–R4 mantêm o aceite residual já delimitado ao eventual piloto assistido, sem se tornarem homologação live ou autorização de expansão.

## Estado operacional prevalente — 16/11/2026, reta final

Catálogo live reconferido08:02:16UTC por GET:5produtos,R$197/397/544/691/838,MONTHLY,devModefalse,semtrialnativo;webhooksHTTP200/0. Isso não habilita consumidor nem comprova processamento. GateC continua sem ativação e exige GO específico. Preservar matriz existente de eventos/inbox/idempotência/leases/scanner/outbox/alertas e12provas; nenhum novo pagamento/cancelamento/reembolso real.

R1–R4PARTIAL,aceite residual limitado ao eventual piloto assistido1clínica;renovação13/12futura,expansão1→3→10 nãoautomática. B1-BDEFERRED/RISKACCEPTED/NOTVERIFIED não será reaberto neste ciclo. Responsáveis/janela ainda devem ser confirmados; executorB3 Windows nativo preparado com opt-in/ACL,sem backup real/Actions; Production semmutações. Procedimento único de preparação/autorizaçõesB2-B/B3 no [GateB vigente](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#checkpoint-prevalente--reta-final-e-contenção-16112026); checkpoints anteriores divergentes são históricos.

## Checkpoint operacional prevalente — 16/11/2026

Ver [execução e gate de cancelamento](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#checkpoint-prevalente--autorização-e-execução-de-16112026). B2-A passou em leitura de catálogos/histórico Production, com TLS verificado; não houve DDL ou ativação. R1–R4 permanecem PARTIAL com aceite residual limitado ao futuro piloto assistido de uma clínica, sem autorizar seleção/contratação. B1-B real continua bloqueado por host/cofre/roles; B2-B/B3 e consumidores live não executados.

**Cancelamento por obrigação persistida:** Asaas legado continua na ação de Configurações → Assinatura → Cancelar assinatura. Pausa recorrência e remove/reconfere pendências antes de gravar o cancelamento local; conserva invoices pagas e vigência. AbacatePay usa Cancelar renovação → endpoint próprio → binding persistido e GET/POST/GET. Pedido, confirmação, estado financeiro e direito de acesso são separados. Falha ambígua exige releitura/reconciliação; não prometer cancelamento definitivo nem tentar outro gateway. Não reembolsar automaticamente. A regressão de carregamento da tela Asaas com runtime novo desarmado foi corrigida pontualmente e tem nova revisão de artefato/gates.

**Rollback:** antes da primeira obrigação AbacatePay, o main anterior só pode ser retomado se compatível com o schema aditivo. Depois de existir contrato live AbacatePay, não trocar cegamente para esse main: ele não fornece a gestão do novo provedor. Fechar aquisição preserva gestão, cancelamento, processamento/reconciliação e obrigações já existentes; usar release compatível com os dois provedores. Nunca executar DOWN financeiro ou reabrir checkout para corrigir um cancelamento desconhecido.

O novo backup recorrente é uma preparação para host protegido fora de Actions, não uma rotina já instalada. Health local não detecta sozinho a perda total do próprio host: o cutover exige monitor independente/heartbeat ou conferência operacional externa e canal de incidente comprovado. Templates/manifestos não substituem restore real, recuperação da chave fora do host nem evidência de execução agendada. Workflow antigo permanece ativo até transição aprovada.

## Operação final preparada — provas e autorizações separadas

Prevalece o [checklist B2-C e novo aplicador B3](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#ciclo-final--operadores-executáveis-e-paradas-de-autorização). Notebook excluído de Docker/build/backup real, GitHub somente sintéticos/CI; não repetir restore20/build composto aceitos. Operador B2-A agora exige psql/CA explícita/verify-full e verifica timeouts/locks; B3 usa uma conexão/transação/lock e SQL congelado. Provas novas ainda dependem da CI do novo HEAD. O checkpoint antigo de BLOCKED por RAM abaixo é histórico, não o estado do ensaio Linux já PASS.

### Matriz definitiva de catálogo — snapshot histórico, não nova consulta live

| Produto/plano    | Médicos / administrativos | Mensal BRL | ID live já conferido          |
| ---------------- | ------------------------- | ---------- | ----------------------------- |
| consultorio_2026 | 1 /até3                   | 197        | prod_SsBGWnFA5Qk1dED3DLRkzSDT |
| clinica_2026_2   | 2 /até3                   | 397        | prod_4sn4YU2Q3P3jbXs3a6UXMgzd |
| clinica_2026_3   | 3 /até3                   | 544        | prod_CXMmb0y0FJHRDFDsy0Lj4MAW |
| clinica_2026_4   | 4 /até3                   | 691        | prod_pNectEHBe356SAystDzmMJbD |
| clinica_2026_5   | 5 /até3                   | 838        | prod_YtHhRgEbMxLZasE5KsqS4s3c |

Fonte: bloco catalog de13/11 e readback5/5 de14/11 no registro existente; BRL/MONTHLY/devModefalse/sem trial nativo. ExternalIds qoro-2026-<plano>-monthly. Presença anterior não comprova configuração atual nem habilita checkout. Fonte de preço/cota é o servidor; seleção inicial1/2/3/4/5 corresponde à assinatura/invoice/receipt/binding e clínica correta, nunca metadata de navegador isolada. Novas anuais desativadas, legados preservados, trial14dias desde Auth com cotas10pacientes/15por categoria e sem conexão WhatsApp/Asaas/convites; módulos AI/patient_payments bloqueados no backend por entitlements. TISS funcional permanece fora do pacote, sem operação no trial.

### Gate C — do registro ao efeito, doze provas distintas

| Prova                  | Evidência existente / condição externa restante                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Registro             | Último inventário live tinha zero webhooks; Gate C NOT AUTHORIZED. Registrar somente POST HTTPS app.qoro.dev/api/webhooks/abacatepay após endpoint/segredo/eventos aprovados; guardar ID/configuração sem URL com segredo |
| 2 Autenticidade        | Secret exclusivo/constante e HMAC do corpo bruto cobertos por testes. Chave pública HMAC sozinha não prova origem; verificação live exige entrega autorizada                                                              |
| 3 Idempotência         | Inbox/event/payment/operação/chaves de negócio e concorrência transacional testados; não deduplicar somente por horário                                                                                                   |
| 4–5 Clínica/assinatura | Conta/loja/ambiente/checkout/customer/binding/geração e FKs compostas; conflito entra em revisão sem mover assinatura                                                                                                     |
| 6 Pagamento            | Receipt e leitura autenticada/valor/BRL/método/ciclo coerentes; evento recebido, checkout.completed isolado ou ACTIVE não concede dinheiro/direitos                                                                       |
| 7 Direitos             | Uma invoice paga vinculada libera cotas, mantém período e calendário; quota extra/troca só no próximo ciclo integral pago aprovado                                                                                        |
| 8 Fechamento           | Geração paga elegível é fechada pelo consumidor, preserva assinatura/recibos. R1 live ainda não observado; fechamento manual Sandbox não é essa prova                                                                     |
| 9 Reentrega            | Duplicado e fora de ordem cobertos, zero novo efeito; não reprocessar applied por conveniência                                                                                                                            |
| 10 Recuperação         | Inbox/leases/backoff/scanner/watch/replay com MFA/auditoria; unknown mantém revisão e impede novo POST cego                                                                                                               |
| 11 Período pago        | Cancelamento/refund/disputa não apagam período; falha/ACTIVE não prorrogam mês sem prova; eventos antigos não regridem ciclo novo                                                                                         |
| 12 Invoices            | Transação única e unicidade por obrigação/ciclo/tenant; falha de persistência não deixa meia invoice/cota/período                                                                                                         |

Eventos/contratos oficiais relidos nesta rodada, sem API de conta: [assinaturas](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout), [índice](https://docs.abacatepay.com/llms.txt). subscription.completed e renewed sustentam a trilha recorrente; checkout.completed também pode chegar no mesmo pagamento e não deve duplicar acesso. payment_failed mantém evidência de tentativas, cancelled encerra recorrência, plan_changed é solicitação/efetivação a distinguir. Refund/disputa/lost permanecem no fluxo negativo/revisão. Sem trial nativo, pró-rata inventado, reativação irreversível ou novas regras de carência. Matriz N01–N17 do dossiê preservada; Sandbox não oferece observação antecipada de renovação natural nem simulação completa de refund/disputa. Nada novo foi homologado externamente nesta rodada.

### R1–R4 — critérios concretos de fechamento

| Risco               | Ação preparada / responsável ainda a designar                                                                                                                  | Evidência que fecha / interrupção                                                                                                                                                                                                                               | Estado                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1 fechamento       | Em C/D autorizados, uma clínica consentida/uma contratação; observar consumidor automático, não executar closure manual para fabricar prova                    | Uma assinatura/invoice/receipt/período/cota, operação closure confirmada, link tratado e obrigações preservadas. Múltiplo, unknown, aberto>2ticks avisa/>5min contém; sem segundo POST cego                                                                     | PARTIAL; prova live NOT AUTHORIZED             |
| R2 renovação        | Manter EARLY-01; leituras12/12 e13/12 e após evento. Operador técnico/financeiro acompanha payment.id novo, invoice paga, período, cota, reconciliação e filas | Renovação natural somente após ocorrência externa; comparar provider/statement/inbox e não inferir pelo ACTIVE. Falha/ausência não estende direitos; abrir incidente/revisão                                                                                    | PARTIAL; evento futuro13/12/2026               |
| R3 negativos/trocas | Usar N01–N17; reentrega/fora de ordem/duplicado e estados adversos controlados já testados. Financeiro decide ambiguidades, sem novo contrato comercial        | Evidência externa dos casos disponíveis e decisão delimitada dos indisponíveis; nenhuma regressão histórica, liberação sem pagamento ou aplicação precoce de cota                                                                                               | PARTIAL; lacunas externas/decisões não aceitas |
| R4 capacidade       | Medir no runtime Vercel/DB/Redis real apenas com piloto autorizado1clínica, uma contratação por vez; não confundir VM de restore com capacidade SaaS           | Heartbeat/filas/leases/latência/erros/429/circuito e alertas coletados; qualquer divergência financeira/tenant contém. Proposta:p95ingresso<5s, idadefila<2min normal/>5min contém;2ticks sem avanço/429 persistente contém. Não é SLA nem regra já configurada | PARTIAL; prova de alvo e limiares a aprovar    |

R2 não depende deste notebook: o manifesto de fixture sintética é JSON, não DPAPI. Após aprovação de local/custódia da fixture Sandbox, o observador existente pode rodar em Linux com LOCALAPPDATA apontando para raiz privada compatível, --session next-checkout-earlypayment-20261113 e --settings-file explícito em tmpfs/cofre, **somente chaves Sandbox**; nunca usar o default C:/dev/.../.env.local. Esse local não foi criado e a fixture não foi copiada nesta rodada. O observador faz GET/leitura e comparação estável, não reconcilia nem concede acesso; inbox/cron dependem de seu próprio ambiente publicado. Preservar alerta/resultado se devido sem prova; sem recriar, pagar ou cancelar fixture.

### Piloto, expansão e recuperação

D exige clínica consentida, plano/médicos/preço/condições, responsáveis técnico/financeiro/operacional/suporte/incidentes/rollback e canal/plantão aprovados. Abrir somente UUID autorizado por novo deployment e uma obrigação. Capturar T0 antes de checkout, aceite do cliente, pagamento pelo próprio cliente e T1 após provider→inbox→invoice→binding→entitlement→closure→UI. Zero nova cobrança de paciente para esse teste. Falha fecha aquisição preservando status, webhooks, cron e contratos existentes; configurar flags não muda deployment antigo.

Proposta1→3:48h de observação saudável, R1 externo comprovado, conciliação sem unknown/duplicidade, recuperação/alerta comprovados, responsáveis disponíveis e **renovação natural observada** com ambiente identificado; se ainda não ocorreu, expansão BLOCKED. Proposta3→10:mais7dias estáveis, capacidade observada da coorte3, limite de uma contratação por vez/volume revisado e renovação/reconciliação sem divergências. Qualquer aprovação excepcional de lacuna exige decisão nova, nunca automática. Guard de loja50req/s é limite de projeto conservador, não throughput live medido; revisar filas/closure1por tick ao ampliar, sem prometer fechamento de10 em5min. Cada aumento exige Gate E próprio.

Rollback por camadas permanece: aquisição/allowlist fecham novos negócios; código/config precisam de novo deployment compatível com schema/obrigações; inbox/ledger/invoices/receipts não são apagados; SQL committed exige correção à frente/recuperação aprovada. Não usar restauração sobre ativo, DOWN, cancel/refund/replay como reação automática. O [plano de continuidade de backup](disaster-recovery.md#auditoria-efetiva-da-rotina-antiga-e-plano-de-continuidade--1511) separa host do drill da rotina recorrente.

Segurança revisada por código/evidências: guards de tenant/MFA/RLS/entitlements, secrets fora do bundle, scrub sem dados clínicos/token/body e Preview/Production separados por VERCEL_ENV/NEXT_PUBLIC_VERCEL_ENV. Testes de ambiente cobrem browser/server/edge; Sentry Preview414eb196 e Productioned622a74 são provas anteriores de notificação, não novos alertas. Não houve acesso ao painel/fechamento de issue/probe nesta rodada. CI final deve confirmar os gates afetados; nenhum SLA, criptografia do futuro host ou processamento live é presumido.

> **15/11 — teste sintético e segurança, checkpoint prevalente:** [relatório executável e condições B1-B](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#ensaio-sintético-e-segurança--15112026-após-b1-a). GPG real7/7 PASS; causa confirmada no formato dos caminhos MSYS, sem instalar/desabilitar segurança. Operador37 testes com doubles PASS: endpoint Docker local fixado, ID completo e cancelamento. Backup passa a exigir verify-full; a cadeia TLS real ainda não foi testada. Sem SQL aberto, dados reais, gateway ou Production. Não usar operadores históricos do TAR congelado no lugar do novo HEAD operacional validado.
>
> Docker Engine parado; RAM livre1.098→598MiB e disco8,8GiB impedem iniciar contêiner/build composto com segurança. Restore sintético completo e build composto **BLOCKED — INSUFFICIENT RESOURCES / NOT RUN**. Pagefile sem criptografia, BitLocker não verificado e hibernação disponível exigem conferência antes de dados reais; preparar ACL privada efetiva do novo destino. Aprovados apenas correções/testes sintéticos/documentação/push; **B1-B/B2/B3/C/D/E não autorizados**. Backups físicos: oito COMPLETED confirmados também pelo titular; plano/retenção e recuperação física ainda não comprovados. R1–R4 PARTIAL sem aceite. Nenhum processo/worktree alheio alterado. CI do novo HEAD precisa ser conferida; a13802e5 é baseline histórica. PR53 draft; Production NO-GO.

> **B1-A15/11 — prevalece sobre o escopo B0 abaixo:** [metadados,proveniência e proposta B1-B](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#b1-a--consulta-administrativa-de-15112026). Consulta administrativa autorizada e executada,sem SQL/dados reais: oito backups físicos COMPLETED,último registro15/11 às09:14:14.727UTC;PITRfalse. Plano/retenção não retornados pela CLI;conferência humana no painel pendente,sem novo PAT. Restore real e B2/B3 continuam não autorizados. Contexto Docker local conhecido,Engine parado,memória insuficiente;27 testes com doubles +1 UTF8 PASS,sem inferir restore. Ensaio GPG sintético complementar bloqueado por agent em home novo. B1-B exige fixture real isolada positiva antes de dados reais. Clone Supabase pode iniciar jobs de extensões e gerar custo;preferir proposta lógica local sem rede,condicionada aos controles descritos. R1–R4 não aceitos.

> **15/11 — autorizações progressivas:** [roteiro B0/B1/B2/B3](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md#autorizações-independentes--formulários-prevalentes) prevalece sobre o pedido conjunto anterior. Somente B0 autorizado; financeiro congelado em94f6da4a/CI43666101807. Backup gerenciado habilitado segundo o titular não comprova cópia/restore atual. Inventário/cópia/restore B1, leitura B2-A, WAF/flags B2-B e SQL/deploy B3 exigem aprovações próprias. Nunca usar direto o drill histórico que aplica migrations antigas. Novo helper de restore isolado só aceita contêiner privado/sem rede/log/volume persistente, cron desligado e autorização explícita; 22 testes com doubles não são prova de Docker real. A cópia limpa de deployment fica separada da cópia SQL que cria backups. Sem Gate C/D, sem Production nesta rodada.

> **Preparação Gate B — checkpoint prevalente14/11:** [matriz,backup/preflight,rollback e solicitação de autorização](../decoupling/asaas-to-abacatepay/GATE-B-DEPLOY-CONTROLADO.md). A baseline10e5d43b está preservada;foi reproduzida/corrigida a criação por sessão anterior com `SIGNUP_ENABLED=false`. A rota de criação agora fecha antes de banco/provedor;status de pagamento continua disponível.123 testes dirigidos,tipos e lint PASS;novo SHA exige CI própria. Não usar a CI anterior para o código corrigido. Este documento não executa GateB;barreira WAF proposta exige autorização específica,backup atual/restore e preflight são paradas antes de DDL. Nenhum segredo/configuração/SQL Production alterado.

**Checkpoint vigente: [dossiê final do release candidate](../decoupling/asaas-to-abacatepay/ABACATEPAY-SaaS-GO-NO-GO-FINAL.md), 14/11/2026.** Runtime7208d505, SQL e configuração congelados. CI oficial25127abf: **7.206 testes e22 E2E sem SKIP**, SUCCESS; conferir checks de qualquer commit documental posterior. Pacote160 e ensaio136→160 preservados. Snapshots: DEV161 com0160; Production136 com24 entradas0136–0159 pendentes; compatibilidade52PASS. EARLY-01 já paga e encerrada: não repetir pagamento. SaaS não espera guias/glosas/R54 ou repaginação integral. **Não há GO para configuração, migration, deploy, consumidor ou piloto live.** Seções antigas são histórico, não ordens de execução.

## Gates atuais A–E e fases operacionais — piloto controlado

| Gate de decisão | Procedimento operacional deste runbook | Estado e autorização |
|---|---|---|
| A — candidato técnico | CI, segurança, composição, ensaios | VALIDADO no25127abf; novo commit documental exige checks próprios |
| B — deploy controlado | Pré-voo A + schema/deploy fechado B1 | PREPARADO, NÃO AUTORIZADO; backup/preflight/rollback atuais e responsável/janela antes de executar |
| C — ativação financeira live | B2: endpoint/webhook/inbox/consumidores/observabilidade | PREPARADO, NÃO CONFIGURADO/ATIVADO; GO próprio, sem aquisição |
| D — primeira contratação real | C: piloto de uma clínica consentida | NÃO AUTORIZADO; R1–R4 tratados e autorização financeira explícita |
| E — expansão | D: avaliação e ampliação do piloto | NÃO AUTORIZADO; cada ampliação tem decisão própria |

As letras das fases antigas abaixo são nomes de procedimentos, não autorizações cumulativas. **Gate B não autoriza C/D/E.** Preparado, configurado, publicado, ativado e homologado são estágios distintos. Nenhuma operação live foi executada neste fechamento. O incidente local 7590707702 foi encaminhado pelo founder à UI; não reabrir aqui sem evidência financeira compartilhada, nem reiniciar seu servidor.

Esta sequência prevalece sobre comandos e decisões históricas abaixo. Os nomes dos responsáveis e a clínica continuam **A DEFINIR PELO RESPONSÁVEL**. Cada autorização deve registrar SHA, ambiente, escopo, data/hora America/Sao_Paulo e responsável disponível. Nenhuma fase avança automaticamente.

### GitHub Actions — desbloqueio concluído, não repetir compra

O bloqueio de 14414498/zero steps é histórico. Após o titular informar Pro/franquia disponível, workflows existentes executaram. A [CI43641356914](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43641356914), **25127abfeccd09f19b2decc5689ef901d8e8ce0f**, terminou SUCCESS com **7.206 testes/637 arquivos e 22 E2E sem SKIP**, logs lidos por HTTPS autenticado/TLS validado. TypeScript, lint, build, segurança e isolamento PostgreSQL passaram; os 16 checks do ensaio 136→160 e 52 de compatibilidade são provas locais separadas. SHA256 do log: `52a6044bc55434990a50711b7e5a7356b0a0d201929a55373a5c481940af0320`. Vercel/Semgrep/Snyk/advisory SUCCESS; Agent Review NEUTRAL não é aprovação humana. Nenhum orçamento, runner ou workflow alterado. A CLI não comprova billing por falta de escopo; não há nova compra solicitada. O commit documental posterior exige CI própria antes do checkpoint final. Se reaparecer bloqueio financeiro, registrar anotação/conta e consultar o titular antes de excedentes, sem inferir a causa financeira.

**Próxima decisão mínima:** Gate B apenas, com SHA, janela definida e responsável técnico/operacional disponível, condicionado a backup recuperável, preflight e rollback antes de qualquer mudança. Clínica, pagamento e aceite R1–R4 para piloto não precisam ser preenchidos para aprovar somente deploy fechado. Se já existirem obrigações AbacatePay live, parar e revisar B1 antes de desarmar consumidores; não prejudicar pagamentos existentes.

### Preflight verificável — pacote160 e alvo136

Executar somente a leitura abaixo na janela aprovada, com o **ambiente Production autorizado carregado por meio seguro**, sem imprimir variáveis. O script não carrega `.env.local` nem copia configuração DEV. Pré-requisitos: Node22, dependências existentes, Git com blobs congelados, pacote exportado e revisado, fingerprint do projeto aprovado, `SUPABASE_PROJECT_ENV=prod`, `DATABASE_URL_PROD` com TLS e credenciais corretas. PGSSLROOTCERT deve apontar para a CA confiável aprovada e psql precisa estar disponível. O novo preflight não importa src/lib/env nem exige chaves públicas da aplicação; elas continuam sendo verificadas separadamente no deploy.

Na pasta do repositório financeiro, substitua os três campos entre `<...>` pelos dados revisados; não cole senhas no comando:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
node --conditions=react-server --import tsx scripts/abacatepay-release-preflight.ts --release '<CAMINHO_ABSOLUTO_DO_PACOTE_APROVADO>' --ref '<SHA_COMPLETO_APROVADO>' --project '<REF_DO_PROJETO_PRODUCTION>' --phase before
```

Exige136 entradas exatas até0135 e devolve24 pendentes0136–0159, hashes e fingerprint. Confere4 relações críticas com RLS forçado e ausência de estruturas futuras sem journal. Saída `PASS_READ_ONLY_PREFLIGHT`, código0 e `productionWrites=0` **não autorizam aplicar SQL**. Qualquer `BLOCKED_PREFLIGHT`, schema parcial, novo sufixo, hash/ordem/timestamp desconhecido ou arquivo SQL extra/ausente implica parar. Não normalizar hashes gravados, apagar histórico ou aceitar um hash novo só porque está no destino.

Este é um snapshot **REPEATABLE READ READ ONLY**, não reserva/lock do lançamento nem hook automático do migrator genérico. Conferir imediatamente antes da aplicação sob janela exclusiva; se outra execução mudar journal/schema/artefato entre as etapas, parar e repetir a revisão. O migrator existente mantém seu guard, backup, sentinel e advisory; ele não compara sozinho todo o prefixo de hashes.

Depois da aplicação futura autorizada, usar o mesmo comando com `--phase after`. Exige160 entradas,22 relações críticas com RLS forçado, colunas/constraint de período, triggers de origem habilitados e índices válidos. Não é certificação completa do schema Supabase: comparar também contratos, preço/desconto, FKs, permissões e sinais de negócio previstos na fase B1.

**Ensaio repetível, exclusivamente descartável:** o comando abaixo não usa URLs remotas; cria PostgreSQL próprio em loopback com SQL real, journal sintético136 e cinco contratos de teste. Não o executar para repetir pagamento ou restaurar Production. Repetir apenas se mudar SQL, preflight ou pressuposto de lançamento:

```powershell
node --conditions=react-server --import tsx scripts/abacatepay-release-rehearsal-db.ts --release '<CAMINHO_ABSOLUTO_DO_PACOTE_APROVADO>' --ref '<SHA_COMPLETO_APROVADO>'
```

Em14/11 passou16 verificações, aplicou24 migrations, preservou os campos dos cinco legados e recusou cenários negativos; arquivo de resultado `dist/abacatepay-release-rehearsal-db.json`. `realBackupRestored=false`: não confundir com clone do banco real, Auth gerenciado ou prova de RTO. Cluster encerra no `finally`; nenhum SQL aprovado é alterado.

### A — pré-voo, antes de qualquer alteração live

1. Conferir HEAD/checks do PR53 e aprovação do pacote **apenas SaaS**. Runtime aprovado7208d505; exportação por `scripts/abacatepay-saas-release.ts`, SQL compartilhado congelado `4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269`,160 entradas. Não compor com o HEAD atual TISS. Conferir manifesto e hash0159; não gerar DDL pelo modelo parcial nem incorporar0160 automaticamente.
2. Conferir destino Supabase de produção por fingerprint, TLS e histórico completo, sem dados de pacientes nos logs. Snapshot14/11:136 entradas;32 diferenças de hash são equivalências CRLF/LF demonstradas, não drift a corrigir. Esperadas24 entradas pendentes0136–0159, na ordem/hashes da evidência canônica. **Parar** se faltar prefixo, houver timestamp/ordem/SQL inexplicado ou sufixo novo não revisado.
3. Conferir backup cifrado recuperável, senha/chave em destino aprovado, acesso independente e procedimento de recuperação. Conferir Node22, `pg_dump`, `gpg`, espaço, conectividade e permissões. Não gravar dump em Git, CI pública ou destino não aprovado. Aceite anterior de perda entre backups não aceita R1–R4.
4. Identificar se já há obrigações AbacatePay live. A ausência de `billing_gateway` no snapshot atual indica que o runtime novo não está aplicado, mas isso não dispensa conferir obrigações remotas na janela. **Nunca desligar consumidores de obrigações pagas para apenas conter aquisição.**
5. Conferir nomes/escopos e origem dos segredos, catálogo mensal5/5, loja, endpoint confiável, Redis/cron, MFA e canal de incidente. Presença de variável não comprova valor ou saúde. Registrar responsável técnico/financeiro/suporte/plantão/substituto e revisão UI/R51 das rotas comerciais. Não copiar `.env.local` para o pacote nem segredos Sandbox para Production.
6. Registrar backup/rollback, preflight e o GO exato para a próxima fase. **PARADA A:** sem responsável, autorização, backup verificável, schema conhecido ou rollback compatível, não executar env, SQL ou deploy.

### B1 — schema e deploy fechado, somente após GO específico

O GO deve cobrir explicitamente fechamento de cadastro por novo deployment, configurações necessárias, SQL exato e publicação do candidato. Se não cobrir, parar antes dessa operação. O cadastro fechado no deployment antigo deve ser comprovado antes da aplicação; alteração na Vercel não muda deployments existentes.

**Aquisição fechada não significa consumidores desligados.** `ABACATEPAY_NEW_CHECKOUTS_ENABLED=false` preserva os consumidores. Para uma primeira B1 **sem qualquer obrigação live**, a proposta é deixar `ABACATEPAY_ENVIRONMENT` ausente e não selecionar aquisição AbacatePay no deployment autorizado; o guard existente fecha o runtime em Production sem ambiente explícito. Isso requer autorização de configuração e redeploy. Se já houver obrigação live, não usar esse desarme; revisar escopo/rollback antes de continuar.

No terminal do operador autorizado, com segredos carregados pelo mecanismo aprovado e sem imprimi-los, somente na pasta do pacote exportado aprovado:

```powershell
Set-Location '<CAMINHO_ABSOLUTO_DO_PACOTE_APROVADO>'
$env:NODE_ENV = 'production'
$env:SUPABASE_PROJECT_ENV = 'prod'
node --import tsx scripts/db-backup-prod.ts
```

Conferir saída0, arquivo cifrado, integridade, destino e capacidade de recuperação antes de prosseguir. **Sem isso, parar.** Somente com GO de SQL e preflight atual confirmado:

```powershell
node --import tsx scripts/db-migrate-prod.ts
```

O operador de migrations executa o guard SQL, cria backup e usa lock/advisory e sentinel. Não remover sentinel, editar histórico ou executar arquivos avulsos para forçar sucesso. Esperado: apenas0136–0159,24 entradas, e160 no total. O futuro alvo pode ter mudado: a diferença real deve conferir com o manifesto autorizado, não somente com a contagem.

Depois do SQL, conferir hashes/ordem, RLS/FKs, contratos/preços/descontos/períodos anteriores, último titular e ausência de duplicação/cross-tenant. Registrar contagens/assinaturas sanitizadas antes/depois, nunca conteúdo clínico. Publicar o pacote SaaS aprovado somente com autorização; manter contratos e consumidores Asaas legados.

Conferir cadastro bloqueado, login/MFA, rotas essenciais, assinatura/UI, logs, isolamento e ausência de consumo financeiro AbacatePay indevido. Webhook503 com runtime desarmado é esperado nessa B1 e **não** prova autenticação/HMAC. **PARADA B1:** não criar webhook ativo, checkout ou ativar consumidores. Não chamar esse deployment de piloto financeiro aprovado.

### B2 — consumidores e entrega, com GO próprio e aquisição ainda fechada

Após autorização explícita: conferir segredos live/loja/catálogo/allowlist e selecionar runtime `ABACATEPAY_ENVIRONMENT=production`; seleção de aquisição futura usa `SAAS_SIGNUP_PROVIDER=abacatepay_production`. Manter `ABACATEPAY_NEW_CHECKOUTS_ENABLED=false` e gerar novo deployment. Nenhuma chave/produto Sandbox é reaproveitada.

Validar endpoint HTTPS/secret/HMAC, persistência e isolamento da inbox, Redis, cron outbox/reconcile, leases, scanner, renewal-watch, closure e alertas. A lista live atual tem zero webhooks; somente configurar entrega ativa depois que o endpoint correto estiver publicado e autenticando. Não apontar eventos para404/503, nem interpretar presença de segredo como teste funcional. Testes não monetários live precisam estar no GO dessa fase.

**PARADA B2:** sem saúde/observabilidade, conter aquisição; sem autorização específica de clínica/pagamento/R1–R4, não iniciar piloto. Consumidores operacionais não autorizam nova venda.

### Checklist futuro do webhook live — não executar nesta rodada

Estado conhecido da listagem autenticada live: **zero configurações**. Endpoint implementado, segredo existente e Sandbox aprovado não significam entrega live configurada. Registro, conectividade/autenticação e processamento financeiro são três provas separadas.

1. **Versão/schema:** após GO de B1, conferir SHA do deployment em `app.qoro.dev`, pacote160 aprovado, postflight e saúde. Não entregar a Preview,404 ou runtime503. Se o endpoint não existir no código publicado, exige deploy autorizado; não criar um endpoint alternativo.
2. **Ambiente/segredos:** com GO de B2, conferir loja live, API key live, catálogo mensal e `ABACATEPAY_ENVIRONMENT=production`; manter `ABACATEPAY_NEW_CHECKOUTS_ENABLED=false`. Credencial e `ABACATEPAY_WEBHOOK_SECRET` são exclusivos de Production. Valor secreto deve ter32–1024 caracteres sem espaços, conforme parser; não colocar URL com query no relatório, screenshot, log ou chat. Novo valor na Vercel exige novo deployment.
3. **Destino/método:** configurar futuramente no painel oficial [AbacatePay](https://app.abacatepay.com/), área de webhooks, **POST HTTPS** para `https://app.qoro.dev/api/webhooks/abacatepay`. A query `webhookSecret` deve conter exatamente uma ocorrência do segredo esperado; cabeçalho `X-Webhook-Signature` valida o HMAC do corpo bruto. A chave pública de integridade do provedor sozinha não autentica remetente.
4. **Eventos:** conferir a versão2 e habilitar a entrega dos eventos consumidos: `subscription.trial_started`, `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`. Trial nativo não é ofertado; evento recebido não concede novo prazo. Não registrar eventos inventados nem criar prova financeira fictícia para testar URL. Eventos desconhecidos ficam auditáveis e não concedem direitos.
5. **Prova1 — configuração:** após autorização de criação/ativação, registrar ID do webhook, ambiente/loja, host/path sem query, lista de eventos e estado; conferir por GET/readback. Não ativar entrega se o receptor ainda estiver desarmado. Essa prova não demonstra que chegou evento.
6. **Prova2 — conectividade/autenticação:** com autorização para teste não monetário, conferir HTTPS, rejeição de segredo/assinatura ausente ou inválida e ambiente incorreto. Payload autêntico de teste, se disponível no painel, deve permanecer não financeiro/sem liberar direitos. Se não houver mecanismo oficial seguro, marcar entrega autêntica PENDENTE até evento real expressamente autorizado; não criar cobrança para preencher essa prova. Não usar logs de URL com segredo.
7. **Prova3 — persistência/consumo:** conferir inbox durável, hash do evento, deduplicação, lease/tentativas, worker e auditoria. Primeiro recebimento pode responder202; duplicata200; autenticação401; corpo inválido400/413; conflito409; indisponibilidade de persistência503. Ver código/resultado específico, pois retries de conciliação podem responder503. **2xx da inbox não comprova invoice paga, período ou cota aplicada.** Conferir o efeito real somente para operação financeira autorizada e com readback do provedor.
8. **Retries/recuperação:** distinguir retentativa de entrega do provedor da retentativa do worker local. Não afirmar prazo/SLA externo não conferido. O inbox preserva ID/hash, até10 tentativas locais, lease60s e backoff; replay administrativo exige superadmin/MFA, motivo e autorização. Timeout de POST remoto não autoriza novo POST cego. Pagamento confirmado sem webhook exige conciliação/scanner com prova própria, não avanço por statusACTIVE.
9. **Operação:** cron outbox de minuto e reconcile diário, Redis/circuito, scanner, renewal-watch, closure, métricas e canal Sentry comprovados no deployment alvo. Provas antigas de entrega de alerta não atestam saúde atual; heartbeat e idade da fila precisam conferir. Logs somente com identificadores técnicos e estados sanitizados, sem dados clínicos/payload/segredos.
10. **Parada:** manter aquisição fechada até GO específico de C. Autenticação falha, tenant/valor divergente, duplicidade, estado desconhecido, worker preso ou período inconsistente exigem conter novas vendas e acionar plantão, preservando obrigações existentes. Não cancelar/reembolsar/apagar ledger automaticamente.

Campos de evidência: `SHA / UTC / ID webhook / host+path / eventos / HTTP / ID inbox / estado worker / readback / invoice+período+cota ou não aplicável / responsável`. Nenhum segredo. Conferir os contratos em `src/app/api/webhooks/abacatepay/route.ts`, `src/lib/payments/abacatepay/webhook.ts` e stores/handlers SaaS; não alterar endpoint para satisfazer o checklist.

### C — uma clínica assistida, somente após GO específico do piloto

O founder escolhe clínica/plano e registra consentimento, condições, responsáveis e aceite/rejeição separado R1–R4. Não escolher cliente por conta própria, migrar Asaas, cancelar contrato ou criar cobrança retroativa. Proposta: uma clínica e uma obrigação por vez, allowlist com um UUID aprovado; novo deployment para configuração autorizada.

A pessoa autorizada conclui o pagamento. Correlacionar loja/checkout/customer/produto/valor/assinatura/geração, webhook autêntico, invoice/receipt/período/cota/UI e auditoria; conferir única assinatura e fechamento automático confirmado. Checkout pendente não libera direito pago. R1 externo só pode receber PASS com essa evidência, não por comando manual.

**PARADA C:** desconhecido/duplicidade, tenant/valor divergente, falha de banco/Redis/autenticação, closure ou renovação sem prova além do limiar aprovado, erro de UI que impeça navegação comercial. Fechar novas aquisições e preservar o processamento das obrigações confirmadas; acionar técnico/financeiro, sem novo comando remoto cego.

### D — expansão proposta, sem aprovação automática

Proposta **1→3→10**. Cada transição exige aprovação e revisão de risco, notificações, fila/idade, conciliação, saúde do alvo e cobertura de renovação ou aceite delimitado. Limiares do dossiê são propostas, não SLAs configurados. Dez closures podem exigir pelo menos dez ticks elegíveis; revisar o limite do piloto1 antes de ampliar. Nunca expandir apenas porque a CI ficou verde.

**Recuperação:** após uma obrigação paga, conter aquisição por novo deployment sem desligar o runtime/consumidores que conciliam seu pagamento. Preservar schema, inbox, invoices, receipts, períodos e contratos. Reverter app somente para versão compatível; preferir correção adiante quando uma versão anterior perder consumidores AbacatePay. Não executar DOWN, apagar ledger, restaurar sobre produção, estornar ou cancelar contratos automaticamente. Voltar código não desfaz cobrança.

## Candidato SaaS independente — procedimento vigente de14/11

**Responsabilidades:** AbacatePay cobra o SaaS Qoro e mantém `subscriptions`/`invoices`/ledger; Asaas continua cobrando pacientes por credencial da clínica; TISS mantém operadoras, guias, lotes, glosas, repasses e coparticipação Asaas. O contrato comercial é lido por `src/lib/entitlements` e pelo gate compartilhado; disponibilidade operacional continua separada. Pagamento não ativa `hi_clinic_settings.enabled`. Trial não opera pagamentos de pacientes, IA ou TISS. Não alterar contratos Asaas existentes.

**Não usar os comandos históricos de composição abaixo como pré-requisito do release SaaS.** O pacote atual inclui código do financeiro e apenas a sequência SQL congelada compatível, sem código/menu/rotas TISS. Em PowerShell, na pasta `C:\dev\Qoro_billing_abacatepay_20261107`, para exportar um commit aprovado ainda não exportado:

```powershell
$env:QORO_FINANCIAL_REF = (git rev-parse HEAD).Trim()
node --conditions=react-server --import tsx scripts/abacatepay-saas-release.ts
Remove-Item Env:QORO_FINANCIAL_REF
```

Isso **não** migra banco, faz merge ou deploy. Gera `dist/abacatepay-saas-<sha8>` e `dist/abacatepay-saas-release.json`. Exige manifesto igual ao do commit e blobs Git congelados disponíveis; falha se o diretório já existe. Nessa situação confira seu `saas-release-inputs.json`, sem sobrescrever/apagar automaticamente. Não depende do worktree/HEAD TISS nem de um pacote antigo. Verifique160 entradas sequenciais, timestamps e hashes do manifesto;0159 deve manter `eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74`. O journal TISS original tem152 entradas e omite136–142 financeiras: não o copie diretamente para substituir o prefixo.

No export finald10e40af os160 SQL/journal equivalem aos do Preview365b4287; o runtime `src` também é igual, excluindo testes. O [Preview SaaS](https://project-2476wgjht-clinic-os-v2-s-projects.vercel.app) passou build e26 verificações estritas. Ensaios de trial/cotas/invoice:51 sem TISS,52 com schema compartilhado/TISS desabilitado; DEV160 confirmado somente leitura. Não reaplicar0159 no DEV. Não gerar migrations do modelo parcial do pacote: estruturas TISS existentes ficam preservadas; novos DDL exigem coordenação do journal.

**Janela futura, ainda não autorizada:** checks do SHA final; revisão da UI compartilhada/R51 (sem gate das117tarefas); riscosR1–R4/cohort/responsáveis tratados; cadastro fechado por novo deployment; backup/preflight/contratos/hashes; SQL aprovado antes do consumidor; deployment com aquisição desligada; endpoint/HMAC/segredo/inbox/Redis/cron/scanner/watch/closure comprovados; só então webhook ativo e piloto allowlist. Usar seletores existentes, sem criar nomes alternativos: `SAAS_SIGNUP_PROVIDER=abacatepay_production`, `ABACATEPAY_ENVIRONMENT=production`, catálogo/loja/segredo live específicos. `ABACATEPAY_NEW_CHECKOUTS_ENABLED=false` até autorização e `ABACATEPAY_CHECKOUT_CLINIC_IDS` somente com UUIDs aprovados. Alteração exige novo deployment; não cria efeito em deployments anteriores. Nenhuma dessas configurações foi alterada nesta rodada.

**Contenção/rollback:** desligar novas aquisições e restringir allowlist, preservando consumers e ledger de obrigações pagas. Nunca desligar processamento financeiro apenas por fechar novas vendas. Reverter código somente para versão compatível com o schema; sem DOWN destrutivo, migração automática de contratos, reembolso ou cancelamento. Monitorar fila/idade/leases/revisão e entrega no canal já comprovado, sem novo probe desnecessário. A observação natural de13/12 permanece READ ONLY; não antecipar calendário ou criar pagamento para declarar renovação.

O boot do registry/handlers agora ocorre dentro de `runRegisteredOutbox`; recovery/inbox/closure/watch ainda executam se esse boot falhar. O cron aguarda os jobs e depois propaga a falha: alerta/erro não é ocultado e heartbeat de sucesso não é emitido. Isso não resolve indisponibilidade do banco/schema essencial nem o R51 de UI.

## Incremento operacional de12/11 — contenção e escala

Estado corrente: [relatório §48](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md#48-inbox-de-minuto-estornos-e-tiss-até-0158--12112026), [matriz G01–G28](../decoupling/asaas-to-abacatepay/MATRIZ-CENARIOS-E-TESTES.md#matriz-corrente-g01g28--scanner-incremental-12112026) e seção final deste runbook. Nenhum comando autoriza DEV compartilhado ou Production. As provas e instruções explicitamente históricas abaixo não substituem este checkpoint.

O transporte usa o par `UPSTASH_REDIS_REST_URL/TOKEN` já existente, com chave opaca por loja. Redis indisponível fecha o acesso ao provedor; não contornar desligando o guard.502/503/504 e falha de rede alimentam circuito;401/403 pausam60s;429 respeita cooldown limitado. Investigue disponibilidade/permissões pelo painel sem copiar a chave e sem repetir POST desconhecido. O circuito é distribuído; reiniciar uma instância não o limpa. Uma resposta positiva não apaga uma pausa vigente.

O inbox continua durável, com lease60s, até10 tentativas e revisão autorizada. Falha transitória aguarda5s,10s,20s…até3600s, contadas a partir de `processed_at`; evento recebido pela primeira vez não espera. Não alterar `attempts/processed_at` no ambiente compartilhado para forçar retry. O replay administrativo existente exige superadmin/MFA, motivo e autorização. O cron processa até10 eventos, sem iniciar item adicional depois de15s do job compartilhado; seu primeiro item conserva a admissão até35s. Cada item mantém reserva independente e só faz consultas financeiras verificadas. Métrica nova: `billing.abacatepay.inbox_batch` com `scanned/limit`.

Métricas de contenção: `billing.abacatepay.request_control`, outcomes `deferred`, `provider_rate_limited`, `provider_failure`, `coordination_unavailable`, sem corpo/credenciais/IDs de paciente. Persistência/revisão e heartbeat continuam as fontes operacionais; Sentry indisponível não é confirmação de saúde. Alertas propostos: qualquer401/403 ou coordenação indisponível;429 persistente; idade de inbox>2min; lease>60s sem resolução; período pago vencido sem receipt novo. Antes de Production, testar regras e entrega no canal aprovado. Não criar probes financeiros reais.

**Capacidade ainda não homologada remotamente:** a candidata reutiliza o tick de minuto de outbox para recuperação em lotes, além do cron diário. Não foi alterada a agenda externa. Com SQL aprovado, o scanner CARD_APPROVED retoma cursores entre execuções sem teto acumulado de 500; sem as tabelas, permanece o fallback limitado. Estornos também usam checkpoint de finalidade própria; o limite de cinco páginas permanece somente no fallback N-1. As cargas locais preservaram invariantes, mas não comprovam capacidade HTTP/worker/provedor. Nenhum novo índice, plano pago ou configuração de Production foi ativado.

## Reproduzir as novas provas locais

Em PowerShell, pasta `C:\dev\Qoro_billing_abacatepay_20261107`, usando Node22 e as dependências existentes:

```powershell
$env:QORO_TISS_WORKTREE='C:\dev\Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF='120e8195e4ad267a64157239cb9bc0c22b432033'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-composition-checks-db.ts
$env:QORO_ABACATEPAY_SCALE='1'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_ABACATEPAY_SCALE
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
```

O primeiro comando gera `dist/abacatepay-tiss-release-158-120e8195`, com 160 entradas somente no pacote descartável. O migrador real ensaiou 144→160, preservou catálogo/hashes históricos e comprovou segunda execução sem reaplicar. A posição financeira após 0156 não está reservada; há trabalho TISS posterior em edição. **Não usar essa proposta no DEV compartilhado.** O `when` é chave de ordenação posterior à cauda fixada, não data de criação. Manifest e queries ficam em `dist/abacatepay-tiss-{composition.json,preflight.sql,postflight.sql}` e foram exercitados no scratch. O journal do repositório permanece intacto. A carga grava `dist/abacatepay-scale-db.json` e `dist/abacatepay-scale-concurrency-N-db.json`: p50/p95/p99, pool/transação, conexões, locks, RSS e plano SQL, sem dados reais. O padrão é 32 tarefas; use `QORO_ABACATEPAY_SCALE_CONCURRENCY=8` apenas no ensaio local para comparar a fila. Falha interrompe o teste; arquivo antigo não comprova PASS. Após congelar uma nova cauda, revisar o helper e repetir apenas os gates afetados.

O ensaio Redis usa exclusivamente um contêiner descartável identificado, porta `127.0.0.1:63799`, imagem oficial Redis7.4, sem persistência ou API financeira. Com Docker disponível:

```powershell
docker run -d --name qoro-abacate-scale-20261112 --label qoro.synthetic=abacate-scale-20261112 -p 127.0.0.1:63799:6379 redis:7.4-alpine redis-server --save '' --appendonly no
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-rate-db.ts
docker stop qoro-abacate-scale-20261112
```

Se esse contêiner identificado já existir parado, use `docker start qoro-abacate-scale-20261112` em vez de criar outro. O harness confere o label e recusa outro destino. `QORO_DOCKER_BIN` pode apontar ao executável oficial quando não estiver no PATH. O teste não comprova o plano, a latência ou a capacidade do Redis gerenciado. Não subir carga em Preview, DEV compartilhado ou Production.

RPO continua dependente do backup efetivamente saudável; não declarar perda zero. A restauração de banco/Storage/Auth tem evidências históricas próprias e o aceite anterior sem PITR permanece restrito a esse risco. Um replay financeiro após restore precisa consultar o provedor e preservar IDs/ledger, sem recriar checkout/pagamento. O ensaio local de recuperação financeira não mede o RTO de reconstrução de todos os serviços.

Atualizado em 12/11/2026. Executável somente na candidata Sandbox do PR #53. Não usar em Produção. Não substituir o gateway de uma assinatura Asaas nem modificar pagamentos de pacientes. A seção 11 preserva o ensaio histórico com 0151; a seção 47 do relatório e o início deste runbook registram o snapshot revisado até 0158. O SQL candidato não foi aplicado ao DEV compartilhado. Sentry Preview e jornada normal MFA já passaram; não repetir probes/login para esses gates.

## 1. Detectar e abrir incidente

1. Abra [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) e o Preview do SHA indicado no corpo do PR. Não use um deployment histórico para testar uma função nova. Entre legitimamente com o superadmin DEV e MFA.
2. Nesse mesmo host de Preview, abra `/admin/billing/operacao` (também há link em **Pagamentos** do admin). A página é restrita a superadmin AAL2; uma conta de clínica não deve acessá-la.
3. Confira a fila, o horário do evento mais antigo e as renovações sinalizadas. A página mostra no máximo 50 ocorrências por lista. Contagem maior que a lista exige triagem: ausência na primeira página não significa resolução.
4. **Renovação sem comprovação local** significa fim do período pago sem avanço conciliado; não prova pagamento nem perda de webhook. Registre um incidente protegido, por exemplo `INC-20261110-001`. Guarde os IDs técnicos e horários estritamente necessários, sem dados do paciente, cartão, payload bruto ou URL de recibo neste repositório/chat.
5. Confira o heartbeat de `billing-reconcile` na página **Saúde da plataforma**, o run mais recente e os sinais abaixo. Nunca use uma lista vazia como prova de que o monitor rodou.

Responsável proposto: financeiro pelo vínculo e valor; engenharia pelo processamento e incidente. A pessoa de plantão e o destino efetivo dos alertas precisam ser definidos e ensaiados antes de qualquer piloto real. A implementação de captura não comprova entrega da notificação.

## 2. Conferir a prova no provedor

1. Abra o [painel AbacatePay](https://app.abacatepay.com/) da loja correta, explicitamente em Sandbox. Não crie nova cobrança, refund, portal ou cancelamento para investigar.
2. Correlacione o `subscription.id`, cliente, checkout e geração com o binding já registrado. A documentação atual permite o mesmo `checkout.id` original nas renovações. Exija **um novo `payment.id`**, correspondente ao `paymentIntentId` do extrato, com prova inequívoca de receipt, valor e período. Não exigir um bill diferente, nem usar apenas o estado PAID do checkout inicial para estender acesso. Os formatos antigos só são aceitos quando o leitor comprova a mesma obrigação, sem aproximar datas/valores.
3. Confira moeda, valor integral, produto/plano, ciclo, estado financeiro e eventual refund/disputa. Valores ou datas parecidos não identificam uma obrigação. `ACTIVE` sozinho não confirma pagamento.
4. Guarde a evidência no registro protegido do incidente. O campo da tela recebe só o identificador desse registro; ele não valida a existência do ticket nem substitui o readback remoto.
5. Sem evento original, a recuperação GET-only da seção 9 pode conciliar o período atual somente com cliente, assinatura, receipt, valor e período exatos. Ela depende do schema candidato e não foi ativada no DEV/Production. Não existe histórico completo de cobranças por assinatura comprovado. Se faltar correlação ou o ciclo for antigo/ambíguo, manter revisão e solicitar ao canal já aberto a entrega/reentrega autenticada do evento original e a correlação oficial. Não invente endpoint de replay nem reconstrua webhook a partir de valor/data.

## 3. Uma nova leitura de evento em revisão

Usar quando o evento original já foi recebido e autenticado, mas sua prova ainda não estava disponível ou a API estava indisponível. A ação não serve para anexar uma cobrança desconhecida a outra clínica.

1. Localize o evento na tela de operação e compare **clínica, tipo, evento e motivo** com o incidente. Só aparecem formulários onde há vínculo verificável entre conta, cliente e assinatura original/recontratação. Referências insuficientes ou conflitantes aparecem em revisão sem formulário.
2. Escolha o motivo: **Provedor voltou a responder**, **Vínculo conferido** ou **Evidência remota disponível**. Informe o código interno do incidente (8–80 caracteres; letras, números, hífen ou sublinhado). Não informe senha, link, e-mail ou comprovante.
3. Abra seu autenticador e informe os seis dígitos atuais. Clique **Autorizar uma nova leitura** uma vez. O MFA é verificado novamente nessa operação; uma sessão antiga AAL2 não dispensa esse passo.
4. A autorização, o snapshot e o log `super_admin_actions` são persistidos na mesma transação. O contador não é zerado. A seguir ocorre uma tentativa imediata do worker, usando somente os leitores e efeitos financeiros já validados. Se o processo cair, a autorização fica na fila e o cron pode retomá-la.
5. **Continua em revisão:** a prova ainda é insuficiente; não houve liberação por decisão manual. Investigue a causa registrada. **Leitura executada:** confira inbox, observação financeira, invoice, período e cota; o texto da tela sozinho não comprova pagamento.
6. A tela desatualizada ou um segundo operador não pode reaproveitar o mesmo snapshot. Atualize antes de nova avaliação. Há no máximo **3 autorizações por evento em 24 horas**, somadas entre operadores; após isso, encaminhe à engenharia e ao provedor. Não edite a tabela para ultrapassar o limite.
7. Cada autorização permite uma tentativa adicional; não amplia automaticamente o limite original de 10 leituras. Uma lease final abandonada pode gerar uma reserva extra somente para encerrar a tentativa em revisão, sem novo GET. O histórico cumulativo continua íntegro.

**Proibido:** editar invoice, preço, plano, período, provider, cliente, payload/hash ou ID de pagamento para conciliar; reaproveitar token/OTP; inserir evento fictício; reabrir `applied`/`ignored`; gerar cobrança substituta. O operador não pode informar valor ou período na ação.

## 4. Resolver e encerrar

1. Após confirmação autoritativa, conferir uma única observação/invoice por pagamento e período coerente com o calendário original. Um replay com outro event ID não pode gerar outro ciclo para o mesmo pagamento.
2. O monitor registra `subscription.renewal_watch.observed` com `state=resolved` quando o período avançou ou deixou de exigir renovação (por exemplo, cancelamento já registrado). **Resolved não significa necessariamente pago**: confira a causa e a situação financeira. Não há botão para declarar um pagamento por intervenção humana.
3. Registrar no incidente: SHA/ambiente, event ID, autorização, resultado, horário da conciliação e causa do encerramento. Sem dados pessoais ou recibos públicos. Medir tempo de resolução a partir da primeira detecção, distinguindo atraso do cron de atraso do provedor.
4. Para refund/disputa, manter ADR-071 e a revisão financeira. Evento antigo não encurta ciclo novo. O painel não emite reembolso, não cancela e não promete recuperar externamente uma cobrança ausente.

## 5. Monitoramento e capacidade

| Sinal | Significado | Ação |
|---|---|---|
| `billing.abacatepay.renewal_watch` | `scanned`, `due`, `opened`, `resolved`, `deferred` do lote local | Investigar `opened>0`; `resolved` não comprova pagamento; conferir cobertura se adiado |
| `subscription.renewal_watch.checked/observed` | Auditoria local com contrato/geração/período e fingerprint | Correlacionar no ambiente protegido; não exportar conteúdo financeiro |
| `billing.abacatepay.integrity_review/integrity_failed` | Duplicidade remota, vínculos ou GET inconclusivo | Preservar contrato e encaminhar ao responsável; não cancelar/reembolsar automaticamente |
| `billing.abacatepay.integrity_scan` | Cobertura de até 3 gerações por chamada | `deferred` exige reduzir cohort ou aprovar capacidade adicional |
| `billing.abacatepay.reconcile_failed/reconcile_deferred` | Falha técnica ou orçamento insuficiente | Conferir heartbeat e fila, recuperar a mesma operação |
| `billing.abacatepay.event_reconciled` | Resultado do worker | Cruzar com commit da invoice/período; não usar como substituto da prova |
| `billing.abacatepay.negative_event_review` | Refund/disputa/falha a revisar | Aplicar ADR-071 sem inventar desfecho financeiro |
| `super_admin.action` e `abacatepay_review_replay_authorized` | Autorização administrativa | Conferir ator, incidente e snapshot no histórico privado |

O cron atual é **diário às 09:00 UTC**, não horário. Nenhuma configuração de agenda foi alterada. O monitor novo processa até **10 contratos por chamada**, com backoff de uma hora, orçamento local de 7 segundos, timeout SQL de 5 segundos e lock de 2 segundos. Parada pelo orçamento marca lote adiado; o próximo lote retoma pela auditoria. O monitor remoto existente inspeciona até 3 gerações por chamada. Em cohort maior que esses limites, não existe SLA de detecção em 24 horas comprovado. O cron preserva seu orçamento de 35 segundos para iniciar trabalho AbacatePay e não inicia GET após esgotá-lo.

Antes do piloto, definir volume, capacidade, responsável e alerta Production. Em 11/11 o founder confirmou o recebimento do probe Preview específico 414eb196, além do teste de canal; esse gate Preview está concluído. Não repetir o probe nem atribuir essa prova ao roteamento/SLA de Production. Alertas de cobertura adiada também usam captura Sentry sanitizada.

## 6. Contenção e rollback

1. Duplicidade remota, correlação incorreta, qualquer efeito cruzado, falha persistente de inbox ou renovação não recuperável exige conter novas aquisições da candidata e preservar as obrigações existentes. Acione o responsável; nenhuma concessão provisória de acesso foi criada.
2. Na candidata, `SAAS_SIGNUP_PROVIDER` controla aquisição; os consumidores continuam baseados no binding quando a aquisição está parada. Alterar env exige deployment novo. `SIGNUP_ENABLED=false` fecha o cadastro, não remove checkouts já emitidos nem cancela recorrências.
3. **Não aplique esses ajustes em Production nesta rodada.** O runtime atual da AbacatePay é deliberadamente Sandbox; `abacatepay_sandbox` em Production é rejeitado. A composição Production e o cohort restrito precisam de implementação/revisão específica antes de ativação; copiar variáveis do Preview não a prepara.
4. Retornar a release somente se ela entender os bindings já criados e mantiver os consumidores dos dois provedores. Não retornar ao código Asaas antigo eliminando recebimento de eventos AbacatePay. Se isso não puder ser garantido, manter aquisição parada e corrigir à frente.
5. Preservar a migration aditiva 0142 e os históricos. Não fazer DOWN, delete/reset, reassociar contrato ao Asaas, reativar cancelamento irreversível, apagar checkout pago ou restaurar banco antigo por cima de produção. Rollback de código não desfaz cobrança remota.

## 7. Reproduzir as provas locais

Para o próximo pagamento humano **Sandbox**, não repetir a fixture antiga nem esta suíte PostgreSQL: seguir [operação preparada do checkout](../decoupling/asaas-to-abacatepay/PROXIMO-CHECKOUT-SANDBOX.md). O comando `prepare` deixa somente manifesto/credencial locais; `create` depende do pedido explícito “criar checkout” e `verify` confere o pagamento informado. Não há limpeza automática em caso de demora do founder.

No PowerShell, na branch financeira com dependências instaladas:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:NODE_OPTIONS = '--conditions=react-server'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-renewal-db.ts
```

O script inicia um PostgreSQL loopback descartável com todas as migrations reais, usa identidades sintéticas, bloqueia rede externa e para o cluster ao terminar. O resultado fica em `dist/abacatepay-renewal-db.json`. O snapshot versionado da execução aprovada está ligado no plano final. **Não é um comando de replay em DEV/Production, nem simula financeiramente uma renovação real no Sandbox.** Não precisa ser repetido para cada operador.

## 8. Fechamento operacional de 11/11/2026

As cinco primeiras compras estão homologadas e preservadas. **Não criar checkout, pagar, cancelar, excluir ou reenviar o pagamento antigo para executar este roteiro.** [Evidência e limites atuais](../decoupling/asaas-to-abacatepay/evidencias/operacao-continua-20261111.json).

### Conferir o alerta sem credenciais no chat

1. Abra o [Sentry](https://sentry.io/) na sua conta administrativa. Selecione o projeto cujo ID é **4511646341726208**. Não precisa criar conta nem contratar plano.
2. Em Issues, filtre o ambiente **preview** e procure a mensagem **Qoro Sandbox operational alert probe**. O evento aceito tem ID `fc2862ce570d48c6966747db2022aa5b`; run `f4b90206-b481-4764-a227-4bc8066aa9d1`, enviado em 11/11 às **08:43:25 de Brasília**. Não contém pagamento ou paciente. Encontrar o evento confirma visibilidade; não confirma recebimento de notificação.
3. Abra [Monitors → Alerts](https://sentry.io/monitors/alerts). Confira a regra desse projeto e ambiente **preview**, seus filtros e a ação de entrega ao responsável. A documentação atual é [Creating an Alert](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/). Não altere a regra de Production nesta validação. Se faltar regra Preview, informe isso antes de escolher destinatários ou canal.
4. Se já existe uma regra, confira se você recebeu a notificação do probe no canal previsto. Se a regra foi criada depois dele, o evento anterior não prova entrega: a engenharia pode enviar **um novo probe sintético**, sem cobrança, após a regra estar pronta.
5. Responda somente: `Sentry: evento visível [sim/não]; regra Preview [presente/ausente]; notificação [recebida/não recebida]; responsável [função]`. Não envie token, screenshot de eventos clínicos ou configuração com segredos.

A API administrativa disponível retornou **401**, por isso a engenharia não conseguiu ler destinatários/regras automaticamente. O HTTP 200 obtido comprova apenas ingestão de um envelope sintético, não a passagem de um pagamento pelo webhook ou a entrega de e-mail/Slack. Não é necessário trocar uma chave financeira para resolver isso.

### Conferir MFA operacional

1. Abra o [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53), confirme o commit do relatório e acesse o Preview pelo check Vercel correspondente. Entre com seu **superadmin DEV** e o MFA legítimo; não compartilhe senha ou código.
2. Abra `/admin/billing/operacao`. Confira que uma sessão comum/sem MFA não obtém a função de autorizar nova leitura e que o superadmin precisa de TOTP atual na ação. **Não faça replay de nenhum evento ou contrato deste lote**: a engenharia deverá preparar uma fixture específica antes de ensaiar a autorização positiva completa.
3. Informe apenas `MFA Qoro: login confirmado [sim/não]; operação exige código atual [sim/não]`. A consulta automática já encontrou **2/2 superadmins DEV com fator nativo verificado**; não é necessário cadastrar outro operador. Isso não prova a jornada interativa positiva.
4. MFA de Qoro, GitHub, Vercel, AbacatePay e cofre são independentes. Não presuma que a autenticação no GitHub protege a conta do provedor. Nenhuma política global foi alterada; o campo de MFA não foi informado pela API própria do GitHub, e os demais painéis não foram auditados por sessão autenticada.

### Coordenar o SQL financeiro com TISS

O [SQL candidato](../decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql) está testado somente no PostgreSQL local. **Não execute esse arquivo manualmente em DEV ou Production.** O PR #55 contém 0143–0147, e o financeiro não escolheu um prefixo concorrente nem editou o journal desse agente. A estratégia e os ensaios atualizados estão na seção 9.

A engenharia precisa conciliar o histórico exato das duas branches e do DEV, registrar o candidato na próxima versão livre, executar os gates e obter a autorização específica antes da aplicação remota. A sua parte é aprovar essa integração de schema quando apresentada; não há comando SQL que você precise executar agora. Não há autorização implícita de merge/main/Production.

### Condições de interrupção e níveis de alerta

| Sinal | Prioridade | Deduplicação e responsável | Ação |
|---|---|---|---|
| Mais de uma assinatura por checkout, vínculo/tenant divergente | P1 | Audit por fingerprint/geração; financeiro + engenharia | Conter novas aquisições; conferir IDs sem cancelar/refundar por suposição |
| Evento autenticado não persistido ou conteúdo conflitante | P1 | Inbox e agrupamento Sentry; plantão técnico | Preservar retorno não-2xx e a mesma obrigação; não cobrar novamente |
| Tentativas esgotadas/revisão de prova | P1 | Estado terminal por lease; uma captura na transição | Releitura autorizada com MFA, sem zerar contador |
| Ativação concluída depois de 120s | P2 | Somente aplicação efetiva, sem alertar duplicate | Medir idade e duração; investigar o HTTP sanitizado |
| Período pago do provedor à frente do Qoro | P1 | Audit deduplicado, sem fabricar evento/invoice | Recuperar a origem oficial; não conceder mês por ACTIVE/valor/data |
| Webhook não autenticado | Métrica de segurança | Não enviar alerta por request; investigar agregados | Recusar antes da persistência; não expor a URL com segredo |

Destinatário e recebimento ainda dependem da conferência Sentry acima. Não há SLA de aviso em 120 s: o sinal é emitido na próxima execução/conclusão, e o cron de contingência continua diário. Nenhuma agenda, custo ou plano foi alterado. A recuperação sem webhook agora está implementada conforme seção 9, mas depende do schema ainda não aplicado e de prova financeira inequívoca; o código novo não significa ativação no DEV ou em Production.

### Kill switch e rollout futuro, sem execução agora

`ABACATEPAY_NEW_CHECKOUTS_ENABLED=false` recusa novas obrigações antes do journal/POST. `ABACATEPAY_CHECKOUT_CLINIC_IDS` aceita UUIDs exatos separados por vírgula; inválidos/duplicados bloqueiam. Consumidores, conciliação e cancelamento não dependem dessas flags. Alterar env na Vercel exige **novo deployment**. As flags foram implementadas, sem configurar qualquer ambiente externo.

**O runtime permanece Sandbox e rejeita Production.** Não copie credenciais nem configure `abacatepay_sandbox` no ambiente real. Antes de um piloto: schema coordenado e aplicado com autorização, recovery sem evento completo, contrato de leitura após fechamento de checkout validado, MFA/alerta reais, composição live implementada/testada e janela aprovada. Backup/rollback e consumidores Asaas continuam obrigatórios. Nenhuma alteração de contrato, pagamento de paciente ou desconto vitalício está incluída.

### Retorno do operador sobre o probe

Em 11/11 o founder confirmou a Issue **7842026780** no painel e informou que **não recebeu notificação fora do Sentry**. Não precisa procurar o evento ou repetir o probe novamente. Falta conferir/criar a regra de alerta de Preview, definir responsável/canal e, só depois, ensaiar uma nova notificação sintética. A API administrativa retornou 401; nenhuma regra ou destinatário foi alterado automaticamente. Os erros históricos de localhost e de hidratação em outro Preview não são falhas financeiras deste probe; a classificação do ambiente no browser foi corrigida na candidata, sem afirmar reparo da hidratação.

## 9. Recuperação sem webhook, fechamento e integração de schema

### O que a engenharia executa

O novo worker só faz GETs externos, exige geração paga e confere loja, assinatura, cliente, produto/valor, período e um receipt de cartão exato. Guarda uma origem API imutável, sem fabricar webhook. Aplicação financeira é atômica e idempotente; fonte insuficiente fica em revisão. O cron existente é diário, processa um candidato por chamada e respeita o orçamento restante; não há SLA de recuperação em 120s. A ausência do schema novo o mantém inativo, sem fallback permissivo.

Uma assinatura marcada ACTIVE, um checkout PAID antigo, `nextChargeAt` ou uma coincidência de valor/data não permitem completar a conciliação. Não criar outra cobrança, editar status manualmente ou preencher um paymentId por suposição. Uma ambiguidade/ausência de histórico de ciclos exige triagem financeira, preservando os direitos já pagos.

O comando interno de fechamento exige uma invoice já paga e vínculo imutável. Tem journal `close_paid_checkout`, um único POST e resultado `confirmed` ou `unknown`. Em `unknown`, não repetir com outro UUID/chave: inspecionar a assinatura, o journal e os readbacks. Fechamento de link não cancela assinatura. O código está preparado, mas não há fechamento automático habilitado nem autorização para apagar as cinco fixtures retidas nesta rodada.

### Estratégia coordenada com PR55

1. Manter os dois PRs draft. **Não importar nem misturar migrations TISS na branch financeira.** Não editar journal/migrations no worktree TISS. A primeira prova fixou `b450a560897d4004b2de305ac91c3ffa1197ec89` até0149; depois de a 0150 ser publicada, o ensaio foi estendido ao snapshot remoto `6b101e892e4e856c5653e7bb89a1791ce452815c`. Ambos só leem objetos Git imutáveis. Não é merge dos módulos nem homologação funcional integral do TISS.
2. Conferir no DEV hashes **e timestamps**, não só contagem: readback de 11/11 às 20:49 UTC,144 entradas;0143 exata aplicada,0144–0150 ausentes, sem conflitos de timestamp e candidato financeiro ausente. O preflight da aplicação futura deve incluir os hashes finais e qualquer migration posterior. Qualquer deriva interrompe o preparo.
3. Preservar os números/hashes TISS. **0149 e0150 são da frente TISS.** Não reservar qualquer número financeiro unilateralmente. A ordem de revisão PR53→PR55 não autoriza aplicar SQL fora da sequência compartilhada. O candidato financeiro fica separado, sem número, até o histórico futuro ser acordado.
4. Não registrar o financeiro com timestamp alto e tentar aplicar TISS antigo depois. O Drizzle usa o último timestamp aplicado; migrations inseridas para trás podem ser ignoradas. Não renumerar/recriar 0143 já aplicada. Caso a ordem SQL precise mudar, acordar a alocação dos ainda não aplicados com TISS e repetir somente o ensaio afetado.
5. Após registro conjunto, executar gates de migrations e o ensaio abaixo. Só solicitar autorização de aplicação DEV com diff, número, hash e ordem definitivos. **O founder não precisa rodar SQL manualmente.**

Ensaio reprodutível, somente PostgreSQL descartável e arquivos TISS lidos sem modificá-los:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:\dev\Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '6b101e892e4e856c5653e7bb89a1791ce452815c'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-tiss-schema-db.ts
node --conditions=react-server node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-renewal-db.ts
```

Essa é uma prova local, executada pela engenharia. O primeiro comando confere 21 checks de ordem, rollback, dados preservados, índices/constraints/RLS, definições dos gatilhos compartilhados, cobertura congelada e correção administrativa da0149. O segundo executa os120 cenários reais de aplicação financeira com151 migrations compostas em memória (0000–0150) mais candidato; HTTP do provedor é sintético e rede externa proibida. O journal da branch não muda. Sem `QORO_TISS_REF`, a suíte financeira mantém sua execução anterior com143 migrations próprias e salva outro artifact; as provas históricas até0147/0149 são preservadas. O helper aceita somente snapshots revisados que terminem em0149 ou0150 e exige SHA completo. Mudou o SQL TISS ou o histórico? Revisar e fixar outro commit, não ampliar o teto apenas para obter PASS.

**Schema agregado de código:** a comparação dos índices das duas branches mostra exports exclusivos em ambos os lados (`billing/gateway-schema` no financeiro e `health-insurance/schema` no TISS). A integração de código futura deve preservar ambos e resolver os handlers/eventos/configuração, com typecheck, arquitetura e registro estrito. A composição SQL comprovada não prova essa integração TypeScript e não autoriza substituir um índice pelo outro.

**Sequência recomendada depois do congelamento TISS:** preservar a revisão independente dos PRs; deixar a ativação financeira bloqueada sem seu schema; o responsável TISS integra seu histórico sobre a base financeira aprovada; então preparar uma migration financeira em etapa separada, com a próxima posição realmente livre, timestamp posterior e preflight exato do DEV. Nada disso autoriza merge ou aplicação agora. Não inserir uma migration financeira de timestamp alto e tentar aplicar TISS mais antigo depois.

| Alternativa | Consequência | Avaliação atual |
|---|---|---|
| Revisar PR53 primeiro, sem ativar o SQL candidato | Preserva as branches; código permanece inativo quando falta schema | Compatível com a ordem pedida, não é ativação da integração |
| Registrar o SQL financeiro numa etapa posterior e separada | Permite preservar0143–0149 e validar o histórico efetivamente congelado | Recomendada após o acordo entre responsáveis; nenhum número reservado agora |
| Compor os journals nesta branch agora | Importaria trabalho TISS ainda em elaboração e anteciparia uma decisão compartilhada | Não executar, conforme instrução posterior do founder |

### Preflight e postflight do candidato financeiro

A engenharia deve confirmar backup recuperável e versão compatível do código; schema de origem até0142 e histórico0143/TISS reconciliado; constraints originais esperadas; inexistência da nova tabela/colunas/categoria; permissões do executor; nenhuma duplicidade financeira preexistente por payment/statement/ciclo; zero outra janela de schema em andamento.

O SQL usa `lock_timeout=2s` e `statement_timeout=15s`. ALTER TABLE requer lock forte em `operations` e `recurring_payment_observations`, mantido até commit; pode competir com webhook/worker. Não prometer duração ou disponibilidade de Production com base no banco pequeno do teste local. Interromper em timeout, schema/hash inesperado, lock prolongado, violação de constraint ou mudança em contratos/valores. Não repetir cegamente.

No postflight conferir: todos os contratos/invoices/bindings anteriores preservados; unicidade por pagamento/extrato e ciclo mantida; origem XOR webhook/API e FK compostas; tabela nova com RLS forçada; anon/authenticated/runtime sem acesso; service_role só SELECT/INSERT, sem UPDATE/DELETE; operação de fechamento suportada; contagem/hash exatos no journal. Verificar readiness em Preview antes de ensaiar uma fixture.

Recuperação: antes de commit uma falha aborta a transação. Depois de commit, não executar DOWN, apagar ledger, cancelar assinatura nem restaurar banco compartilhado por iniciativa própria. Conter novas aquisições, manter consumidores dos dois provedores e usar correção à frente/release compatível. Se houver perda/inconsistência, parar e executar o plano de recuperação autorizado. Reverter código não desfaz comando remoto.

### Prova externa futura do fechamento, sem novo pagamento

Depois do schema DEV autorizado, a engenharia apresentará **um checkout Sandbox já pago**, a clínica sintética exata e o snapshot anterior para autorizar seu fechamento. Não precisa criar/pagar outro checkout.

O ensaio deve: comprovar devMode e loja; preservar invoice/receipt/IDs; chamar uma única vez o endpoint documentado; conferir que o link não aceita novo pagamento sem efetuar transação; reler assinatura e lista pelo checkout; reler extrato e os IDs já pagos; verificar histórico/recibo; conferir mudança de plano e cancelamento somente nos limites autorizados; testar reprocessamento local sem invoice/vaga nova. Renovação futura não vira PASS por fechar o link. Se a resposta se perder, preservar `unknown` e não reenviar o comando. Enquanto essa prova não existir, B1 permanece PARTIAL.

## 10. Ações humanas que continuam necessárias

### 10.1 Alerta Preview — prova de entrega concluída

**PASS operacional em 11/11:** o founder confirmou a criação da regra Preview, o recebimento do **Send Test Notification** e depois o alerta específico **414eb196**. Um único probe foi enviado às **15:29:32 BRT**; ingestão HTTP200, evento `04822f778d5649b3a0a19e28ce798236`, `environment=preview`, `flow=billing.abacatepay.sandbox_probe`. Nenhum pagamento, paciente ou dado sensível no evento. A regra Production não foi alterada. Não repetir essa prova nem criar outra regra.

A API administrativa retornou HTTP401 e o acesso visual estava indisponível. Condições, destinatário e histórico interno da regra não foram auditados diretamente pela engenharia; o recebimento confirmado do evento exato comprova a cadeia externa para esse flow. O probe usa ingestão Sentry direta, não provoca erro de banco/cron no Preview: os testes de captura do worker são uma evidência separada. Isso não mede SLA, todos os tipos de alerta ou futura entrega em Production.

**O roteiro abaixo fica somente para diagnóstico futuro se o canal parar; não é uma tarefa humana pendente agora.**

1. Abra [Monitors → Alerts no Sentry](https://sentry.io/monitors/alerts), entre na organização do projeto **qoro** e abra **a regra Preview que você já criou**. Se ela não aparecer, informe o nome/tela; não crie outra.
2. Sem mudar nada, confira os rótulos da regra: projeto `qoro`, ambiente `preview`, regra ativa, evento capturado, filtros `flow` começando por `billing.abacatepay.` e nível pelo menos `error`, destinatário sendo sua conta/canal, sem silenciamento. Confira o limite de frequência, recomendado em 5 minutos. Se os valores forem diferentes, informe somente a divergência. Não altere Production.
3. No bloco de notificação, clique uma vez em **Send Test Notification**. Confira caixa de entrada e spam do destinatário configurado. Esse botão verifica o canal; não comprova o disparo de um evento financeiro. Não precisa pagar, alterar credencial ou configurar outra regra.
4. Responda `Regra Preview [nome]; teste de canal [recebi/não recebi]; horário [BRT]`. Se não recebeu, confira o destinatário, as [preferências pessoais](https://sentry.io/settings/account/notifications/), spam e eventual silenciamento. Envie somente os estados/rótulos, sem dados de paciente, tokens ou screenshot de segredos.
5. **Somente depois da confirmação de recebimento**, a engenharia enviará **um único probe** com `environment=preview`, `flow=billing.abacatepay.sandbox_probe`, identificador próprio e nenhum dado financeiro ou clínico. Correlacionará o evento, regra/disparo e notificação. O responsável confirma o recebimento externo com horário. Ingestão aceita e Issue visível, sozinhas, continuam insuficientes para PASS. Não repetir pagamento nem enviar probes para forçar o alerta.

Se alguma opção não aparecer, informe só seu rótulo/permissão e a etapa. Não criar regra All Environments como substituto. A fonte dos controles é a [documentação oficial atual de alertas](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/). O intervalo de throttle e preferências pessoais podem impedir aviso mesmo com evento visível; não declarar entrega antes de recebê-lo.

### 10.2 Conferir MFA do operador e dos serviços externos

**Jornada normal PASS, confirmada pelo founder em 11/11:** no Preview `b18407c3`, login com autenticador, acesso a `/admin/billing/operacao`, logout com bloqueio da página e novo login com MFA. Não é necessário repetir esse roteiro para fechar essa prova. A resposta foi “tudo ok”; não foram solicitadas senhas/OTP e nenhum reprocessamento financeiro foi executado.

O DEV já tinha 2/2 superadmins com fator nativo verificado. A ação financeira com TOTP novo/replay, sessão expirada à força, recuperação após perda do fator, revogação global e MFA dos provedores externos não foram testados interativamente nessa confirmação. Os testes locais cobrem as recusas correspondentes, sem transformar simulação em operação real. Para um ensaio destrutivo, preparar operador sintético e autorização específica; não usar contas existentes nem fixtures pagas. A engenharia prepara uma ocorrência sintética antes do ensaio positivo da ação de reprocessamento.

Roteiro de referência já cumprido nos passos 1–3, sem alterar fatores ou credenciais:

1. Abra o Preview financeiro informado no PR53, use `/login` e conclua o desafio normal do autenticador. Se o sistema enviar para `/account/security?force=1`, não remova fator: informe a tela encontrada.
2. Abra `/admin/billing/operacao`. O superadmin com segundo fator deve alcançar a página; não clique em autorizar reprocessamento de uma fixture paga. Registre só acesso aprovado/erro, sem nomes de pacientes, OTP ou cookies.
3. Saia pelo comando normal do Qoro, volte à URL administrativa e recarregue. O conteúdo financeiro deve ficar inacessível. Faça novo login e conclua novamente o segundo fator. Não usar apenas o botão Voltar como prova de sessão válida.
4. Se quiser conferir outro dispositivo, faça login legítimo em janela privativa ou outro aparelho, com o próprio autenticador. A sessão do primeiro navegador não deve ser tratada como autenticação do segundo. Não enviar senha/código pelo chat.
5. Expiração, remoção do fator, recuperação após perda do aparelho e revogação global não serão forçadas na conta administrativa existente. Os testes automatizados cobrem recusa de sessão/fator/operador inválidos, mas não são prova dessa operação real. Um ensaio destrutivo exige operador sintético dedicado e autorização própria.
6. O Qoro informa em sua tela de segurança que o TOTP do Supabase não emite códigos de recuperação. Confira se o backup do autenticador/segredo original já está em cofre, sem mostrá-lo. Redefinir a senha não deve ser usado como procedimento presumido de remoção de MFA. Na ausência do fator e de seu backup, parar e solicitar recuperação assistida aprovada; não desativar proteção por script.

Resposta segura: `Preview [SHA]; login/MFA [PASS/erro]; operação financeira [acessível/negada]; logout e novo login [PASS/erro]; segundo dispositivo [PASS/não executado]; recuperação em cofre [disponível/pendente]`. Isso não confirma MFA das plataformas externas abaixo.

Depois confira separadamente as contas de administração usadas nestes serviços:

| Acesso | Página inicial | O que confirmar, sem compartilhar códigos |
|---|---|---|
| GitHub | [Settings → segurança](https://github.com/settings/security) | 2FA habilitado na conta que revisa/mescla; recuperação disponível em cofre |
| Vercel | [Conta](https://vercel.com/account) | Proteção de acesso/MFA da conta ou do IdP efetivo; equipe correta |
| AbacatePay | [Dashboard](https://app.abacatepay.com/) | Segurança/MFA oferecido para o administrador financeiro; se não aparecer, informar a ausência para tratamento operacional, não presumir proteção |
| Supabase | [Conta/projetos](https://supabase.com/dashboard) | MFA da conta administrativa/IdP e responsáveis de recuperação |
| Sentry | [Segurança pessoal](https://sentry.io/settings/account/security/) | MFA/IdP efetivo da conta que administra alertas |
| Cofre | Conta corporativa já aprovada | MFA e recuperação independente do mesmo aparelho; não enviar chave/código |

Os painéis externos não foram inspecionados em sessão autenticada nesta rodada; seus menus internos podem variar. A proteção de um serviço não prova a dos outros. Responda `MFA: GitHub [...], Vercel [...], AbacatePay [...], Supabase [...], Sentry [...], cofre [...]` usando `ativo`, `pendente` ou `indisponível no painel`. Nenhuma autenticação global do Qoro foi alterada.

### 10.3 Aprovações técnicas que ainda não são comandos para o founder

Depois da coordenação com TISS e do diff/hash definitivos, aprovar ou rejeitar o schema financeiro **somente no DEV**. Separadamente, aprovar o fechamento de uma fixture Sandbox já paga para comprovar os readbacks posteriores. A engenharia executará as operações e a limpeza autorizada. Não editar journal, rodar SQL, deletar checkout ou pagar links antigos manualmente. Production, merge e credenciais reais continuam fora da autorização.

## 11. Trial, entitlements e composição com 0151 — 12/11

**Regra vigente da candidata.** Avaliação de 14 dias desde o Auth original, com as cotas anteriores. Asaas de pacientes e agentes de IA são recusados pelo gate comercial no backend enquanto não houver pagamento verificado; WhatsApp/conexão Asaas/convites continuam sob os bloqueios existentes. TISS permanece indisponível operacionalmente nesta branch. Leitura histórica e processamento financeiro de reconciliação não são apagados/bloqueados como se fossem novas vendas.

O titular pode contratar durante ou após o trial. Um clique abre o checkout correspondente ao catálogo; cliques repetidos reutilizam o journal. Criar checkout, voltar ao app ou receber evento sem readback financeiro válido não libera módulos. Na conversão antecipada, o primeiro período começa na contratação confirmada, não no fim dos 14 dias. O claim privado comprova a origem Auth; a avaliação nunca reinicia. Uma recontratação continua impedida até acabar o período pago anterior.

### Reproduzir somente em banco local descartável

Os comandos abaixo não aplicam SQL ao DEV. Só usar o SHA completo revisado; o helper rejeita outro histórico comum/ordem e não importa arquivos em edição. Na pasta financeira:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '2a70788046752df4c8b349b871a089bc432a8609'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-tiss-composition.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-tiss-schema-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_TISS_WORKTREE,Env:QORO_TISS_REF -ErrorAction SilentlyContinue
```

Resultados de 12/11: **33/33 composição SQL**, **49/49 trial/entitlements**, **120/120 financeiros**, sem rede externa ou escrita remota. Resultados em `dist/abacatepay-tiss-0151-schema-db.json`, `dist/signup-free-trial-tiss-0151-db.json`, `dist/abacatepay-renewal-tiss-0151-db.json`; snapshot versionado na evidência canônica. A suíte de trial sem TISS também passou 49/49, cobrindo a compatibilidade N/N-1. Não somar números sobrepostos como novos cenários externos.

O gate central usa a mesma transação/escopo da clínica e consulta `qoro_premium_denial(uuid,text)` quando presente. `patient_payments` é traduzido para o nome SQL `patient_charges`. Qualquer recusa SQL vence; resultado ausente/malformado falha, sem autorização implícita. A proteção da aplicação acrescenta período/invoice e indisponibilidade operacional; ela não substitui permissões, flags ou autorização de liberar TISS. A fusão final dos controles ainda precisa de revisão dos dois PRs, não foi simulada como merge TypeScript concluído.

### Sequência proposta antes de qualquer aplicação compartilhada

1. Congelar/acordar a cauda TISS. O snapshot ensaiado termina na **0151**, SHA acima; arquivo 0151 com SHA256 `a0e446dbce4121c538c4a3e206a406e0977d5d1729ed14b03417a3937b71ae0b`.
2. Preservar 0000–0143 já registradas no DEV. Leitura somente leitura de 12/11, 04:09 UTC: 144 entradas, 0143 com hash/timestamp exatos; 0144–0151 ausentes, sem conflito, candidato financeiro ausente. Revalidar antes da janela.
3. Propor o candidato financeiro **depois da cauda TISS acordada**, sem reservar 0152 nem editar journal agora. Seu SHA256 normalizado LF é `5a1c7bd1a6f073972d7010998703d6f26667ee133f404dd358153fc5e2164b1a`. Número e `when` definitivos dependem do histórico congelado; não inserir timestamp anterior ao último aplicado.
4. Revisar o diff/journal composto e repetir somente os gates afetados pelos inputs finais. Novo SQL TISS posterior à 0151 invalida a aprovação automática da composição, não as provas históricas.
5. Apresentar a sequência/hashes finais para **aprovação específica do DEV**. Só então executar preflight, backup aprovado, transação com `lock_timeout`/`statement_timeout` e postflight dos contratos, RLS/grants, índices/constraints/funções, isolamento e gate de trial.
6. Interromper por qualquer drift, conflito de timestamp, lock, invariantes ou recusa de permissão inesperada. Reverter a transação falha; após commit, recuperação por correção à frente/backup aprovado. Não apagar ledger/histórico nem inventar DOWN.

**Nenhuma ação humana ou pagamento novo é necessário para repetir os gates já aprovados.** Dependências restantes são acordo do schema final, autorização da aplicação compartilhada, prova externa de renovação/fechamento e implementação/revisão da composição live. A variável live já cadastrada não dispensa nenhuma dessas etapas.

**Verificação posterior do código4b666cc0:** CI43154102122 PASS7061/22E2E semSKIP, build/segurança/isolamento; E2E autenticado ativo PASS1/1 no Preview, desktop/celular, usando fixture antiga sem nova conta/checkout/invoice. Readbacks antes/depois preservados. A autenticação de teste não é leitura pura do Auth. Não repetir a prova para fechar gates já aprovados; consultar os checks do PR53 para o commit documental posterior.

## Restrição operacional após o incidente da CLI

Não usar `vercel env run` neste ambiente até esclarecer o despacho observado em12/11. Uma tentativa Preview/local criou um projeto auxiliar remoto, sem alterar o Qoro. Não repetir comandos de deploy/ambiente para diagnosticar. Preferir inspeções GET explícitas com projeto/time/ambiente conferidos; não usar `env pull` para criar cópia em texto claro de segredos. Operadores antigos de `dist` não são o runbook e não devem ser executados por inferência, especialmente os que escolhem uma chave genérica.

A limpeza pendente diz respeito somente a `run-scale-preview-redis` / `prj_htYpK9lthoj7LG78fVa8JsH3VzRn` e `dpl_HX9mrERFQab1U74efzo4NjX7yKdh`; exige a confirmação específica já solicitada. Não remover `project-os`, projeto Supabase, Git, integrações ou contratos. O arquivo do auxiliar é um wrapper sem credenciais, protegido por SSO; inventário/prova do SHA estão no registro canônico. Esta exceção não autoriza Production, nem deve ser ocultada pelo resultado verde dos testes.

## Scanner incremental e tick de recuperação — candidato de 12/11

O SQL `saas_period_snapshot.candidate.sql` continua fora do journal. Sem suas tabelas novas, a aplicação usa o caminho N-1 limitado: **não declarar a fila incremental operacional no DEV/Preview antes da aplicação especificamente autorizada**. A numeração financeira deve ser escolhida após congelar a cauda TISS; 0155/0156 já são da outra frente e há trabalho posterior em edição.

O serviço persiste páginas de até 100 registros por loja/mês/finalidade (card_approved ou adjustments), sem misturar prova de pagamento e observação de estorno. Cada execução faz no máximo dez páginas no lote de cron e duas na leitura interativa. Não há limite acumulado de 500. Um snapshot completo é necessário antes de usar os comprovantes. Depois, a leitura curta do topo evita repetir toda a loja por clínica; varredura integral periódica alcança backfills antigos. Horizonte de frescor e revisão integral: 60 segundos/15 minutos na candidata. Sem tick saudável isso não é garantia temporal.

`/api/cron/outbox` já tem agenda de minuto; o código candidato reutiliza esse tick, com lote financeiro paralelo de até 35 segundos, **ainda bloqueado em Production**. Não foi alterada a agenda externa. O reconciliador diário permanece adicional. A Vercel executa crons no ambiente de produção; publicar um Preview não prova execução recorrente. Validar a rotina em Preview com chamada autenticada de teste após o schema aprovado, preservando fixtures e sem expor CRON_SECRET. A futura composição live deve ativar consumidores por binding e preservar Asaas; não remover o guard Sandbox para fazer um teste passar.

### Diagnosticar atraso sem criar nova cobrança

1. Identificar o ambiente e o SHA. Consultar somente metadata e a clínica autorizada; não copiar chave live para Preview.
2. Conferir heartbeat `outbox`, `billing.abacatepay.recovery_batch` e `billing.abacatepay.statement_scan`: páginas/linhas, `pendingPartitions`, `oldestPendingMs`, falhas, `leaseLost`, `providerMs`, `databaseMs` e duração total. Os tempos de banco incluem admissão no pool; não representam tempo puro de CPU/lock.
3. Em banco autorizado, consultar apenas estado, contadores e idade dos jobs. Não copiar payload, cursor, token de lease ou identificadores de clientes em alertas. `next_attempt_at` futuro indica backoff; lease válida não deve ser removida manualmente.
4. Verificar os eventos privados `subscription.renewal_recovery.checked`/`observed` e o inbox. `statement_scan_pending` significa continuidade automática; não é prova de pagamento nem exige criar outro checkout.
5. Falha transitória retoma sem reenviar POST. Cursor inválido reinicia geração com backoff. Conflito de identidade, valor, cliente ou período exige revisão, sem crédito provisório.
6. Persistência de cinco falhas no scanner gera alerta. Monitorar também ausência de heartbeat/backlog crescente: um job que nunca roda não emite seu próprio alerta. Preparar regra Production equivalente à de Preview; configuração externa ainda exige aprovação.
7. Se o provedor não informar vínculo/período suficiente para uma renovação sem webhook, manter revisão. O scanner não inventa a associação `subs_` ausente no extrato. Guardar `payment.id`/evento autenticado existente; usar somente o operador de revisão autorizado.

**SLOs propostos, ainda não aprovados nem comprovados em Production:** confirmação HTTP do inbox p95≤500 ms; ativação assíncrona usual≤5 min; alerta de pagamento não tratado/backlog sem progresso≤10 min. Medir ingresso, fila, provider/Redis, admissão no banco, transação e processamento separadamente. Carga do domínio não prova latência HTTP, SLA do provedor ou capacidade da Vercel. Registrar indisponibilidade externa e limites da máquina; não aumentar pools/planos sem avaliar limites e custos.

### Ensaiar localmente, sem serviços remotos

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = '120e8195e4ad267a64157239cb9bc0c22b432033'
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-statement-scan-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-composition-checks-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/signup-free-trial-db.ts
Remove-Item Env:QORO_TISS_WORKTREE,Env:QORO_TISS_REF -ErrorAction SilentlyContinue
```

Esses scripts exigem PostgreSQL local e recusam rede externa. Produzem JSON em `dist`, com ambiente `loopback_synthetic`. Não adicionar `--env-file`, chave real ou endpoint remoto. A prova do scanner distingue cache de comprovantes de invoices/acesso; a prova financeira valida sua aplicação transacional. Não somar testes locais como pagamentos externos.

### Inspeção e futura remoção exclusiva do auxiliar

Preflight: `node node_modules/tsx/dist/cli.mjs scripts/security/vercel-auxiliary-preflight.ts '<caminho absoluto do vercel/dist/vc.js já instalado>'`. O helper valida ID/time, lista domínios/recursos e confere o Qoro por GET. Saída sanitizada em `dist/vercel-auxiliary-preflight.json`. Não usa comandos default da CLI nem lê valores de env.

Após **aprovação específica** e novo preflight, a operação exata prevista é `DELETE /v9/projects/prj_htYpK9lthoj7LG78fVa8JsH3VzRn?teamId=team_ml9fFeF262JqUMwFB6Vy61Cj`. Não executada. Conferir ausência de domínio personalizado, variável, Git, recurso vinculado e uso por outro operador. Parar se qualquer dependência aparecer. O Qoro `prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ` deve permanecer intacto. Depois, exigir GET404 do auxiliar e readback inalterado do Qoro. Não presumir custo zero nem apagar recurso externo associado por inferência.

### Atualização final do tick e do schema revisado

Além da busca sem webhook, o tick retoma até dez eventos já recebidos no inbox, com lease/backoff e deadline propagado a todos os leitores. Aguarda outbox, recuperação e inbox terminarem antes de responder com erro. Comprovantes de cartão são imutáveis; movimentos do cache de estornos podem ser atualizados sob a mesma identidade, preservando o histórico processado no audit. Alteração de identidade gera revisão e nunca contamina a finalidade de cartão.

Snapshot SQL revisado até 0158 (120e8195), 160 entradas no pacote de laboratório, sem reserva do número financeiro. Provas atuais: scanner 22, financeiro 122, trial 50, SQL 41 e Drizzle 8. As verificações adicionais de TISS cobrem compatibilidade e segurança; não substituem a homologação funcional do PR #55. Acordar a cauda e aprovar os hashes antes de qualquer DDL compartilhado.

**Preview não recebe a agenda automática:** a [Vercel invoca cron somente em deployments Production](https://vercel.com/docs/schedules/cron-jobs/quickstart). Portanto, o código de minuto está preparado, não comprovado como scheduler ativo do Sandbox. A validação futura precisa de uma execução autenticada e restrita à fixture financeira, depois da aprovação do schema. Não disparar o outbox global do DEV compartilhado para medir Redis: ele também contém handlers de mensagens e outras clínicas. Não usar `vercel crons run` como se aceitasse Preview nem recorrer ao caminho `env run` do incidente. A ausência de tick automático não é um bug de código ou autorização para ativar Production.

## Aprovação executiva de 12/11 — aplicação DEV e preparação live

A cadeia completa 0144–0158 + financeira0159 foi autorizada para DEV, após esclarecimento do journal único. Inputs fixos em [release-manifest.json](../decoupling/asaas-to-abacatepay/migrations/release-manifest.json). Nunca usar esse pacote em Production. Antes de aplicar, conferir refs e ausência de edição na cauda, hashes, histórico real, DDL concorrente, transações longas, locks, backup e os relatórios locais125/22/41/50/9. Qualquer drift interrompe a aplicação; não renumerar ou corrigir hashes históricos. O migrator oficial deve executar o journal composto, e a segunda execução deve ser vazia.

O backup DEV cifrado de12/11 fica sob LOCALAPPDATA/Qoro/Recovery/dev-before-0159-20261112; a evidência registra hash e decifragem sem conteúdo SQL. A recuperação primária de uma falha na aplicação é rollback transacional; não restaurar o DEV inteiro nem apagar trabalho de outros agentes automaticamente. Depois de commit, preferir correção à frente sob revisão e preservar todos os fatos financeiros.

A composição live está preparada no código, com variáveis descritas na auditoria. Não basta a API key. Production permanece sem ativação; manter a aquisição parada até configuração, catálogo, webhook, observabilidade e gates externos aprovados. Uma volta do seletor de aquisição para Asaas não migra contratos AbacatePay já emitidos; seus consumidores devem continuar ativos.

Incidente auxiliar: exclusão do projeto prj_htYpK9lthoj7LG78fVa8JsH3VzRn confirmada em12/11 às22:20UTC, após preflight e autorização específica. Não repetir a remoção. Production Qoro e superfícies legítimas preservadas. O preflight anterior é histórico, não representa ausência de autorização atual.

### Aplicador DEV da composição congelada (12/11)

Somente após autorização específica e backup cifrado com decifragem verificada. No worktree financeiro, defina `QORO_TISS_WORKTREE` para a pasta TISS autorizada (somente leitura), `QORO_TISS_REF` para o SHA do manifesto e `QORO_LOCAL_ENV_FILE` para o `.env.local` já existente, sem copiá-lo. Execute `pnpm exec tsx scripts/security/abacatepay-tiss-composition.ts` e `pnpm exec tsx scripts/security/abacatepay-dev-release.ts` (padrão: preflight). Após commit dos inputs, a execução autorizada é `pnpm exec tsx scripts/security/abacatepay-dev-release.ts --apply --commit=<SHA completo revisado>`. O destino fixo é DEV pqhkirrszzpwezdaqrai; Production é recusada. O operador aceita baseline144,159 ou160 após conferir cada hash; aplica apenas pendentes pelo migrator oficial, nunca insere histórico manualmente. Bloqueia cauda de migrations em alteração, ref remoto diferente, DDL ativo observado, transações longas e locks esperando. O lock consultivo só coordena operadores que o respeitam; os timeouts continuam obrigatórios. Relatórios sanitizados em `dist/abacatepay-dev-release-*.json`. Não usar este script para Production ou desfazer a aplicação do outro agente.

### Checkpoint executado — DEV160 e fechamento Sandbox (12/11/2026)

A aprovação da cadeia foi reconciliada com a execução independente do agente TISS:0144–0158 já estavam aplicadas; este operador aplicou somente0159 pelo pacote fixado, sem reaplicar ou editar o histórico. O readback passou159→160,224 tabelas existentes preservadas e segundo migratornoop. Backup cifrado privado c499ab2d… antes da aplicação; não restaurar compartilhado automaticamente. Fonte: relatório§50/registro executiveFollowup. O root journal das branches independentes não deve ser sobrescrito por cópia inteira; o manifesto e o gerador preservam todos os SQLs/hashes da composição reproduzível. Antes de futura migração Production, integrar/aprovar esse pacote e conferir seu histórico real; a autorização DEV não o autoriza.

O fechamento **já foi executado uma vez** no Sandbox, no bill_WDnCdCcreJeqUyz65paa4WXt. Não repetir POST nem novo pagamento. O journal devolveu resultado confirmado sem outro POST; assinatura, invoice, período, liberação e extrato preservados. O checkout saiu da listagem e continua consultável por GET(PAID). Evento tardio sintético assinado percorreu o Preview sem mutação financeira. Esses readbacks não comprovam cobrança após um mês. A documentação oficial atual ([índice](https://docs.abacatepay.com/llms.txt), item subscriptions/checkouts/delete) declara bloqueio do link excluído; a resposta HTTP200 do link não demonstra capacidade de pagar. Respeitar a inspeção observacional registrada, sem tentar novo pagamento.

A prova Preview utilizou credencial Sandbox já cifrada com DPAPI e bypass legítimo da Vercel somente em memória; não exportou variáveis sensíveis, mudou Production ou criou endpoint de teste. Falha/circuito429 e volume permanecem provas em ambiente isolado; não desligar Redis nem rodar um tick global para produzir evidência às custas de outras clínicas DEV.

### Composição de código reproduzível — engenharia, sem merge/publicação

Inputs: financeiro04a4fd7332795be9c83906c8edefffaa8b30137a eTISS9b463168f438f5ec59d192351b2f96179e81d197. A diferença SQL/schema desde o pin operacional62edb485 é vazia. O manifesto aplicado DEV continua preservado; novo HEAD de código não autoriza alterar um registro de migration.

1. No worktree financeiro, executar `git merge-tree --write-tree --name-only 04a4fd7332795be9c83906c8edefffaa8b30137a 9b463168f438f5ec59d192351b2f96179e81d197`. O resultado conhecido é a árvore f747432246f026581cfcf5885b19a0be1f35c4d4, com conflitos somente em docs/security/acoes.md, drizzle/migrations/meta/_journal.json e scripts/arch-db-check.ts. Exit1 nesse comando descreve conflitos; não é aprovação do merge. Se a lista mudar, parar e revisar. Não executar git merge no worktree do outro agente.
2. Exportar essa árvore com git archive para uma pasta nova em dist. Nenhum arquivo .env ou credencial deve ser copiado. A extração não é um novo branch e não altera index/refs.
3. Usar na cópia o journal160 e0159 produzidos pelo gerador da composição congelada; a0159 deve ter SHA256 LF eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74. Preservar exatamente as entradas0000–0158. Não ordenar timestamps para ocultar conflito.
4. Resolver a allowlist mantendo nominalmente abacatepay-dev-release.ts e o operador TISS guardado já revisado, sem liberar diretórios inteiros. Regenerar docs/security/acoes.md com `pnpm exec tsx scripts/security/inventory.ts --write` na cópia; inventário não é resolvido escolhendo um lado do conflito.
5. Aplicar somente na cópia o patch docs/decoupling/asaas-to-abacatepay/migrations/tiss-ledger-integration.patch. O patch não contém linhas de contexto vazias para passar no gate de whitespace. Usar `git apply --check --unidiff-zero <patch>` e depois `git apply --unidiff-zero <patch>` somente sobre o arquivo do SHA fixado; o check passou contra o arquivo9b463168; não reaplicar se já contiver a correção. O teste passa tanto com a faixa financeira histórica ausente quanto integralmente presente e aceita somente a sucessora congelada.
6. Rodar typecheck, arch:db-check e os três testes migration-journal, migration-safety e health-insurance/migration-ledger. Na cópia,36/36 passaram. Build não dispensa o E2E autenticado das páginas alteradas pelo TISS; o incidente CARE_TYPES deve ser corrigido pelo responsável PR55 antes de um GO conjunto.
7. Um Preview exclusivo foi criado para o build da composição, com SAAS_SIGNUP_PROVIDER=abacatepay_sandbox, ABACATEPAY_ENVIRONMENT=sandbox e ABACATEPAY_NEW_CHECKOUTS_ENABLED=false como overrides somente desse deployment. Não usar para pagar ou substituir as cinco fixtures. Não copiar a configuração para Production. A Vercel não aceita --skip-domain em Preview; a primeira tentativa foi recusada antes de criar deployment. O retry permaneceu explicitamente Preview, no ID existente do Qoro, com referência exclusiva de verificação.

O fechamento Sandbox já comprovado revelou currentPeriodStart2026-11-11/currentPeriodEnd2026-12-11/nextChargeAt2026-12-11 no GET da assinatura. Isso comprova a configuração/consulta futura, **não** uma renovação realizada. Não repetir checkout, pagamento, fechamento, MFA ou probe para obter esse mesmo resultado.

**Build composto confirmado:** Preview exclusivo https://project-dnyxo3r3q-clinic-os-v2-s-projects.vercel.app, READY,5min35s. É um artefato de verificação com checkout bloqueado, não o destino de novas homologações de pagamento nem substituto do Preview financeiro do PR53. O snapshot contém o TISS9b463168 com incidente RSC conhecido; não usar o build verde para fechar esse incidente. O tsc local desse snapshot parou por heap2GB; Next remoto verificou tipos/lint sem desabilitar gates.

## Checkpoint executável — 13/11, composição e144 e infra isolada

Estado comprovado: DEV160/0159 já aplicada, apenas readback nesta rodada; catálogo45 relações e227 fingerprints preservados. Não executar migration novamente. Composição testada: financeiro5144e6b5 mais diff do incremento, TISS e14408d3. Mudanças posteriores do proprietário não estão automaticamente homologadas. Ver relatório§52 e finalTissReconciliation na evidência canônica.

### Reproduzir somente quando o código afetado mudar

No worktree financeiro, PowerShell, sem carregar .env nem usar chave real:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE = 'C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF = 'e14408d3d947ec426c36abd390d5f4c3002264c8'
$env:QORO_ABACATEPAY_OPERATIONAL = '1'
$env:QORO_FINANCIAL_REF = (git rev-parse HEAD)
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/abacatepay-renewal-db.ts
Remove-Item Env:QORO_ABACATEPAY_OPERATIONAL
```

Pré-requisitos: Docker Engine ativo, PostgreSQL local compatível com o helper scratch, porta55492 livre e dependências já instaladas. Esse comando cria somente banco descartável e Redis com label qoro.synthetic=billing-operational em loopback. Fonte do provedor é HTTP sintético; saída de êxito: dist/abacatepay-operational-http.json com status PASS. Redis é removido e cluster é parado pelo harness. Não reaproveitar esses dados, executar contra DEV, passar --env-file ou interpretar esse teste como renovação externa. Se houver falha, preservar o diagnóstico; não alterar status no banco para fazê-lo passar.

A composição descartável usa merge-tree/export, journal gerado160, patches tiss-ledger-integration.patch e tiss-composition-harness.patch. Para aplicá-los a uma pasta aninhada no repositório, executar a partir da **raiz financeira** com --directory apontando para essa pasta; git apply dentro da subpasta pode ignorar paths que considera fora do prefixo. Usar --unidiff-zero nos dois patches e sempre verificar --check antes, confirmando que o arquivo foi realmente alterado. O segundo patch só adapta testes do SHA e144; não altera regras de TISS, dados, SQL ou worktree do proprietário.

### Preview e falha de configuração

Preview composto atual: https://project-m6qti314r-clinic-os-v2-s-projects.vercel.app/configuracoes/assinatura. Login/cota/readbacks/desktop/mobile passaram com fixture já paga. Novas aquisições ficam fechadas (503 esperado). Não criar/pagar checkout nessa URL. A mensagem de indisponibilidade de gestão é segura, mas **não equivale a configuração correta**: verificar os nomes/escopo Sandbox e o caminho pago antes de fechar incidente. Nunca habilitar controles Asaas para um binding AbacatePay para contornar a mensagem. A correção não altera contratos.

### Monitorar eventual piloto, somente após autorização

1. Fixar commits/checks, catálogo/live, loja atestada, segredo HMAC próprio, cohort aprovado e plantão. Não usar recursos Sandbox como live. A presença da APIkey não libera aquisições.
2. Com aquisição parada, conferir recebimento/consumidores por binding, cron de minuto e scanner. Preview não recebe cron automático; operação Production só na janela autorizada, sem tick global no DEV para ensaiar.
3. Medir idade do inbox, attempts, filas em received/processing/review, lease vencido, falha de ativação e scan pendente. Pagamento comprovado sem invoice/período/cota correto é incidente; aquisição deve parar sem parar reconciliação.
4. Proposta conservadora de início: até10 clínicas listadas; nenhuma expansão automática. Rever com base na cobertura efetiva do cron/alertas e comportamento do provedor. Isso é proposta operacional, não capacidade garantida.
5. Em renewal ausente/ambíguo, manter revisão explícita; confirmar payment.id, loja, cliente, valor, competência e obrigação pelo leitor/receipt/extrato suportados. Usar reprocessamento existente com MFA e audit. Nunca estender acesso por texto da IA, inventar vencimento ou fazer novo POST de cobrança para reconciliar.
6. Uma prova de renovação futura exige evento/receipt de um novo ciclo, invoice única, período único, cota correspondente, UI, duplicata recusada e alerta/reconciliação consistentes. Consulta de data futura e fixtures não encerram esse aceite.

Interromper novas aquisições por: vínculo cruzado, duplicidade financeira, recibo sem proveniência, drift de contrato legado, ativação sem comprovação, worker/alerta sem cobertura ou backlog sem recuperação. Desligar aquisição não apaga obrigações nem autoriza rollback destrutivo. Preservar inbox/invoices/readbacks/journal e corrigir à frente se o release anterior não suporta os bindings.

## Operação preparada — fechamento live, watch e rotação,13/11

Checkpoint corrente: relatório§53 e dossiê de decisão no plano final. TISS bf59cbc3, SQL sem delta desde e144; DEV160/0159 apenas conferido. O gerador scripts/security/abacatepay-code-composition.ts exporta fontes imutáveis, resolve apenas os três conflitos conhecidos, aplica os patches revisados e registra inputs; nunca mescla branches ou escreve no worktree TISS. Executar antes o gerador SQL com os refs completos do manifesto. Se a exportação já existir, ele recusa substituí-la; preserve a prova e use outro par de SHAs revisado, sem remover pastas às cegas.

### Fechamento após pagamento e cobertura de renovação

O consumidor preparado fecha **somente checkout live comprovadamente pago**, com invoice/vínculo/loja/modo/assinatura/cliente/produto/valor conferidos, journal at-most-once e audit idempotente. Atéuma geração por tick, orçamento20s, independente da flag de aquisição. Não cancela a recorrência nem reverte acesso/invoice. Sandbox continua exclusivamente no operador manual anterior: não fecha as cinco fixtures retidas. Operação running/unknown fica em revisão, sem novo POST; concorrência in_progress não é tratada como nova autorização de executar. Falha autenticada gera alerta e não registra heartbeat saudável.

O observador de período também participa do cron de minuto, além da conferência diária existente: o gate por assinatura/hora, locks e fingerprint impedem alertas/audit duplicados. É uma detecção de divergência para revisão, sem conceder período provisório. Ver limites/backoff/cohort e regras de parada no plano de piloto. Alteração do código só chega a Production depois do GO; nenhum cron remoto foi chamado para produzir evidência.

### Rotação planejada do segredo, sem perda intencional de pendências

1. Abrir janela de rotação e conferir captura de alertas; pausar novas aquisições com flagfalse e novo deployment, mantendo consumidores. Guardar segredo atual e novo no cofre com acesso restrito; não enviar valores por chat/terminal visível.
2. Configurar o novo ABACATEPAY_WEBHOOK_SECRET e, na variável opcional ABACATEPAY_WEBHOOK_PREVIOUS_SECRET, JSON privado com secret antigo e expiresAt UTC absoluto de no máximo24h. Verificar antes em Preview. Criar novo deployment e comprovar que ambas as autenticações previstas são aceitas com HMAC e mesmo inbox; nada libera acesso por segredo apenas.
3. No painel/API oficiais, apontar o webhook para o novo segredo durante a sobreposição, preservando o mesmo endpoint e eventos. A API documentada expõe criar/listar/consultar/excluir; não existe update comprovado. Se for necessário criar outra configuração, registrar ambos IDs e aceitar duplicatas idempotentemente. **Não excluir o anterior enquanto houver entregas pendentes:** a documentação informa que a exclusão as descarta. Não imprimir URLs com webhookSecret.
4. Conferir logs e inbox do destinatário para o segredo novo, pendências do anterior e ausência de duplicação financeira. Se a janela não for suficiente, interromper a rotação e decidir formalmente a transição; não manter segredo anterior indefinidamente nem estender datas automaticamente. A rotina de reconciliação continua como contingência, sem substituir prova financeira ausente.
5. No prazo absoluto, o antigo é recusado401, inclusive sem redeployment. Depois de drenar/conferir a configuração anterior, retirar o JSON antigo na Vercel por novo deployment, remover a configuração obsoleta somente com autorização própria e arquivar a evidência sanitizada. A chave API não participa dessa rotação e não deve ser recriada.

Teste unitário controla o relógio e prova aceitação atual/anterior, HMAC inválido, deduplicação e recusa na expiração; isso não é uma rotação operacional já executada no provedor. Nunca copiar o segredo do Sandbox para live.

### Recuperação operacional e significado do ensaio

O modo QORO_ABACATEPAY_OPERATIONAL_PROFILE=pilot usa10 clínicas sintéticas, Redis/PG isolados, dois processos frios e ticks separados por60s reais. A fixture de indisponibilidade72h deve ter pagamento/período históricos coerentes com received_at: envelhecer só o evento e deixar o pagamento no futuro é corretamente recusado. O ensaio não antecipa lease/backoff nem comprova renovação externa. A perda de resposta HTTP permite redelivery limitado de ECONNRESET/UND_ERR_SOCKET e exige inbox durável/finais únicos. Consultar a evidência para o resultado efetivamente medido; falha do harness não recebe PASS por documentação.

O harness financeiro completo agora usa Redis Docker isolado nos cenários de comando com contexto live sintético. Isso preserva a exigência de coordenação, sem introduzir bypass Production. Não carregar chave live. O provider HTTP continua sintético e o banco exclusivamente loopback.

Auxiliar run-scale-preview-redis: GET do ID exato retornou404 em13/11 10:35UTC; limpeza anterior concluída. Não tentar excluí-lo novamente nem usar buscas amplas para apagar outros projetos. QoroProduction permaneceu no5620a098.

### Reproduzir somente o pacote de revisão, sem DDL/deploy

Inputs usados nesta rodada: financeiro1703b3f2acfa4f31d1c74a3d1649d532bc1a4ecd e TISS4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269. Execute no worktree financeiro, não na main ou no worktree TISS:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:QORO_TISS_WORKTREE='C:/dev/Qoro_convenios_tiss_20261110'
$env:QORO_TISS_REF='4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269'
$env:QORO_FINANCIAL_REF='1703b3f2acfa4f31d1c74a3d1649d532bc1a4ecd'
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-tiss-composition.ts
node node_modules/tsx/dist/cli.mjs scripts/security/abacatepay-code-composition.ts
```

Os dois comandos apenas projetam arquivos em dist e usam git show/merge-tree; não fazem merge nem migration. O segundo recusa sobrescrever o export existente. Nesse caso, leia composition-inputs.json e confira os dois SHAs/hash0159; preserve o pacote, não o apague para forçar reexecução. O journal160 gerado só pertence à composição, não substitui journals aplicados das branches por conveniência.

Para validar um export novo, instale as mesmas dependências do lockfile, sem copiar .env; execute nele types/lint e regressões afetadas. Neste Windows, o tsc do pacote atingiu o heap padrão2GiB e passou com **node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit**. Foi somente parâmetro de processo local; não foi modificado tsconfig, CI, build, versão, teste ou política de segurança. O build remoto e o login/readback/UI1440/390 do pacote também passaram. Falta de memória não deve ser registrada como erro TypeScript nem como PASS sem o reteste.

O Preview de composição não herda overrides restritos à branch apenas por metadata. Seus cinco valores Sandbox precisam ser resolvidos por acesso autorizado e aplicados apenas em memória ao deployment, como nesta rodada; nenhum valor Production é permitido. Conferir source metadata e release antes de usar a fixture já paga. O Preview não gera cron automático; o perfil pilot chama o seam real em dois processos frios com intervalo60s, sem se apresentar como medição do scheduler Vercel.

## Janela técnica 13/11 encerrada e EARLY-01 preparada

**Já executado, não repetir:** catálogo live 5/5 (mensalidades R$ 197/397/544/691/838), cinco nomes Production com checkouts desativados, segredo exclusivo e alerta sintético Production `ed622a74` recebido. Janela 11:48:44–12:06:43, America/Fortaleza. Release `5620a098` preservada; endpoint financeiro 404. Nenhum webhook live cadastrado, migration, checkout live ou contrato alterado. Ver relatório §54/JSON canônico para antes/depois e IDs de rollback. Configuração salva não altera deployment antigo.

**Sandbox preparado:** run `d2d0e84d-059b-4b29-9074-f3305a3fc97f`, clínica `8b12f2da-b881-4409-815f-a18ec71fd1c6`, assinatura `1c21ff83-9e46-4eee-bffa-d19aa2be9135`. Trial de 14 dias desde Auth, até 27/11 às 15:12:42.157 UTC. E2E real PASS em 1440/390; zero checkout, invoice, operação e liberação paga. Senha sintética protegida com DPAPI; nenhum envio de e-mail. Não reconstruir a conta nem repetir os cinco pagamentos iniciais.

### Histórico da criação EARLY-01 — já executada, não repetir

O comando abaixo é **para a engenharia após essa mensagem**, não uma solicitação para o founder executá-lo agora. O operador confere ambiente/loja/produtos/branch/hashes DEV antes de qualquer mutação. Se houver checkout, faz readback e reutiliza; não cria outro intent. Entregar somente o link realmente devolvido pelo Qoro.

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$qoroSessionPath = Join-Path $env:LOCALAPPDATA 'Qoro\SandboxBilling\next-checkout-earlypayment-20261113\session.json'
$qoroPrepared = Get-Content -LiteralPath $qoroSessionPath -Raw | ConvertFrom-Json
node --use-env-proxy --use-system-ca --conditions=react-server --import tsx scripts/abacatepay-checkout-operator.ts --action create --preview $qoroPrepared.origin --vercel-cli C:/Users/joaom/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js --plan consultorio_2026 --scenario early_payment --session next-checkout-earlypayment-20261113
```

Após pagamento humano Sandbox, usar os mesmos argumentos com **--action verify**, sem trocar session/origin/plan. Consultar o provedor antes de declarar pago; evento completed e efeito local são conferidos separadamente. Exigir uma invoice/attempt/receipt, binding correto, período pago, cotas e UI. Se a rede falhar, preservar manifesto e retomar; nunca limpar por timeout. A ativação antecipada usa Auth como limite inferior do período, sem exigir que o trial termine.

Se o Preview/webhook mudar de release, o preflight bloqueia antes do checkout. Reconciliar origem/manifesto e comprovar novamente ausência de operação; não ignorar o guard, copiar segredo live ou criar outra fixture. Não pagar duas vezes o mesmo link. O pagamento não ativa TISS automaticamente nem autoriza conectar integrações reais durante o teste.

### Riscos e encerramento

R1: closure automática live e consumidores exigem release compatível autorizado; não ativar endpoint 404. R2: renovação natural e R3: mudança efetivada em novo ciclo não possuem acelerador localizado no Sandbox em 13/11. Coortes locais 1/3 passaram e complementam 10/100/500/1000 preservadas; não representam capacidade remota. Nenhum risco R1–R4 foi aceito.

Para reverter a configuração desta janela, conferir IDs no JSON e remover somente as cinco entradas criadas, se inalteradas. Manter API key, variáveis anteriores e produtos intactos. Não apagar webhook compartilhado nem parar consumidores existentes. O segredo está protegido pelo Windows CurrentUser e na Vercel sensitive; não é uma cópia de DEV. A ficha de responsáveis/cohort do piloto real permanece no plano; disponibilidade nesta janela não equivale a plantão permanente.

### Estado corrente EARLY-01 — pagamento e fechamento comprovados em 13/11

**Não executar novamente create nem pagar o link antigo.** Checkout `bill_KJRNEFgyUExtx4EKFwZA2WFk`, assinatura remota `subs_e1A14YHx3uK3sFWYPEJpna2F`, R$197 Sandbox. Pagamento real Sandbox/completed/inbox/invoice/cotas/UI PASS; uma invoice paga e um receipt. Período Qoro13/11–13/12, conversão antes do trial terminar27/11. Prova e IDs completos no relatório §55/JSON canônico, sem credenciais.

O fechamento foi realizado pelo operador no seam Sandbox, com journal/audit únicos e readback posterior. Assinatura ACTIVE e invoice preservadas. Esse comando não cancela recorrência. Fixtures Sandbox não entram no reconciliador automático live. Não chamar fechamento manual de automático nem ausência da listagem de prova de uso único do link.

Após o fechamento, o GET do checkout apagado pode não estar disponível. Portanto o operador `verify`, que usa esse GET, não é o caminho para conferir de novo essa geração encerrada. Usar o receipt imutável/journal/audit, GET da assinatura e readback da invoice/período/cota; não criar outro checkout para substituir a prova. Credencial e manifesto ficam retidos com DPAPI/ACL privada; sem cleanup por timeout.

Idempotência desta geração: reapresentação interna dos mesmos IDs/hash retornou duplicate; worker e recuperação não reaplicaram nada; snapshot inalterado. Não se fez replay HTTP assinado do provedor nem falha artificial no banco compartilhado. As provas isoladas dessas falhas continuam referenciadas no relatório.

Incidente R51 permanece aberto: erro #418 reproduzido no dashboard da Preview TISS a04a1535, sem demonstrar Production afetada. Não suprimir erros. A correção de ambiente Sentry já existe no PR53 e precisa ser preservada na composição com o PR55; a causa de hidratação exige investigação própria. As 22 verificações de navegação/logout na Preview financeira sem pageerror são uma amostra, não prova de eliminação do R51.

## Observação segura da próxima renovação EARLY-01 — vigente em13/11

**Apenas para o operador técnico. Não pagar, recriar, fechar novamente ou cancelar esta fixture.** O código abaixo usa somente GET do provedor e transações SQL READ ONLY. Não precisa abrir navegador, descriptografar a senha de teste ou copiar chaves. Usa a chave **Sandbox** já existente no arquivo local; recusa Production e qualquer manifesto não verificado.

No PowerShell, execute estas duas linhas separadamente:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
node --use-env-proxy --use-system-ca --conditions=react-server --import tsx scripts/abacatepay-observe-renewal.ts --session next-checkout-earlypayment-20261113
```

Resultado comprovado13/11: `observationStatus=PASS`, `state=awaiting_next_cycle`, `officialNextChargeDate=2026-12-13`, `recordedCycles=0`, `closureConfirmed=true`. O período Qoro termina13/12 às17:44:27.418UTC; **a API informou só a data da cobrança, sem garantir horário ou sucesso**. O relatório sanitizado fica em `dist/abacatepay-renewal-observation-d2d0e84d-059b-4b29-9074-f3305a3fc97f.json`; o manifesto privado original não muda.

Agenda proposta: executar uma leitura em12/12, outra em13/12 e após a chegada de evento/aviso. Não instalar tarefa recorrente nem depender de processo permanente para conceder acesso. Os crons reais de inbox/watch/scanner são a automação do produto e precisam estar publicados/operacionais no ambiente autorizado; o observador é uma prova separada. A existência de cron no repositório/Preview não prova execução agendada em Production.

| Resultado | Ação segura |
|---|---|
| `awaiting_next_cycle` | Preservar fixture e aguardar; ACTIVE/data futura não são renovação paga |
| `due_unobserved` (saída2) | Verificar inbox/recibo/extrato pelos fluxos existentes; abrir incidente no canal configurado; não prorrogar acesso manualmente |
| `renewal_recorded_requires_external_review` | Conferir novo payment.id, invoice paga, período, cota e prova do provider/statement. Registrar observação natural separada da simulação; o observador não concede PASS temporal sozinho |
| `recurrence_stopped` | Conferir cancelamento documentado, manter direitos até o fim pago; não reativar ou pagar por conta própria |
| `review_required` / `BLOCKED` | Conferir motivo sanitizado e vínculos. Se mudança concorrente, repetir **somente leitura**. Nunca executar create/POST por causa de erro do observador |

Se houver webhook tardio ou ausente, usar a recuperação/inbox e revisão com MFA já documentadas neste runbook, preservando conta/ambiente/payment.id/ciclo. Não inserir comprovantes manualmente, alterar datas, zerar tentativas ou reaplicar um evento applied. Refund/disputa preservam acesso até fim pago e exigem revisão, conforme decisão comercial anterior.

Fechamento automático:131 cenários PostgreSQL PASS no incremento, incluindo crash e falha antes do POST sem duplicidade. Limite atual1geração/tick, deadline20s; reserva running/unknown exige revisão e não é retomada às cegas. Backlog10 consome no mínimo10ticks elegíveis; monitorar idade da fila, operações pendentes, heartbeat outbox, Redis/429/circuito e entrega do alerta. Isso não é SLA de Vercel/AbacatePay. Nenhuma regra/canal Sentry comprovado precisa ser configurado ou testado de novo por este incremento.

### Pin atual de composição — execução local, não publicação

Em13/11 a cópia revisada é financeiro `c2431ab79a34e52c58650f578654d5771e43db06` + TISS `30126efff8aec0aa8284fceb908e3e49e0a892da`. Diretório `dist/abacatepay-code-c2431ab7-30126eff`, Preview [dpl_4kk22srPhRSRBZAq4aCmE1F8A5i3](https://project-9tgdeqhy2-clinic-os-v2-s-projects.vercel.app), build READY e aquisição fechada. As exportações mais antigas deste documento são históricas. Não fazer merge/publicar por esses comandos. O estado completo está no relatório§56G e no checkpoint canônico.

O exportador exige patches com contexto e checagem sintática antes de concluir. Não usar `--unidiff-zero`: a evolução do harness TISS já causou inserção dentro de template SQL. Se um patch não casar, interromper e revisar o diff; não aceitar deslocamento por número de linha nem ignorar erros. Checagem sintática não substitui tipos/lint/build e regressão.

O navegador de composição deve aguardar o conteúdo esperado, além do shell, e reprovar qualquer pageerror. A observação antiga de26 navegações sem erro não comprovava h1 pronto em todas as capturas; preservada e corrigida no relatório. A conta EARLY-01 retida já serve ao readback pago; não criar conta ou pagar novamente para testar navegação.

As referências atuais do provedor divergem de respostas históricas sobre uso único do checkout e ID original nas renovações. Preservar closure, inbox e correlação por novo payment.id/período/receipt. Não retirar controles por mudança de texto da documentação. Nova cobrança, API avulsa ou data artificial não substitui observação natural do segundo ciclo.
