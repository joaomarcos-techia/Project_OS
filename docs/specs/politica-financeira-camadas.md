# Política financeira de cobranças de pacientes e repasse profissional

**Registro principal desta implementação.** As decisões, mudanças, provas, falhas e bloqueios de cada camada devem ser atualizados aqui durante o desenvolvimento. `docs/qorov2.md` permanece apenas como índice e fotografia histórica desta frente; não acrescentar nele novas entradas de progresso da política financeira.

**Estado em 07/10/2026:** especificação e implementação em camadas. As migrations 0108–0113 foram aplicadas e lidas de volta **somente em DEV** (a 0113, revisão humana do repasse, com backup completo e restore dirigido testado antes); houve backup completo anterior à 0110 e cópia binária da tabela de contas de pagamento anterior à 0111, mas a cópia binária **não é um backup completo do banco**. RLS e guardas SQL foram exercitados em transações revertidas. A correção tardia de tarifa já possui lançamento de delta imutável e foi exercitada no PostgreSQL DEV com evento de outbox e handler reais, crash/retry e replay; ainda não foi observada uma **correção tardia real** no Asaas nem feita a jornada completa provider → webhook → Caixa no navegador. O Checkout hospedado foi exercitado no Sandbox com intervenção humana: cartão teve estorno terminal confirmado pelo runner; PIX gerou cobrança paga, mas o estorno solicitado terminou `CANCELLED`, sem devolução comprovada. O Preview com banco DEV exibiu configurações, fatos econômicos sintéticos no Caixa e o ciclo de pausa/desconexão da conta no Sandbox em 6/6 E2E; a serialização pausa × reserva de Checkout entre dois processos foi provada no PostgreSQL DEV (seção de 07/10, retomada). Ainda em 07/10, um pagamento Pix real no Sandbox foi feito por pessoa num Checkout criado antes da pausa. O webhook chegou com a conta pausada e foi conciliado pelo Preview deste PR. Bruto, tarifa e líquido coincidiram em `GET /payments`, extrato, banco e Caixa (9ª execução do runner). A revisão humana do repasse passou no E2E do Preview com papéis reais (5/5). As camadas 2–5 **não estão aceitas para produção**: faltam a prova externa da correção de tarifa, a prova completa da IA até o link e a promoção das migrations 0108–0113 no ambiente-alvo. Revalidar o estado antes de cada promoção.

## 1. Decisão de produto e disponibilidade

As **configurações avançadas** desta funcionalidade são exclusivas dos planos **Clínica** e **Pro**: preço por meio de pagamento, base/regra de repasse profissional e relatórios econômicos avançados. O Solo conserva cobrança de paciente, conta Asaas, sinal, recebível e Caixa já existentes. Em todos os planos, inclusive Solo, cada cobrança deve permitir conferir o **bruto cobrado, a tarifa real do provedor e o líquido real recebido**, com estado `desconhecido/pendente` quando o Asaas ainda não informou o fato. Isso é transparência da cobrança existente, não autorização para configurar políticas avançadas. O servidor decide pelo código do plano da assinatura atual; esconder controles na UI não basta. Sem assinatura ou com código desconhecido, as configurações avançadas falham fechadas.

**Decisão de produto aceita em 02/10/2026:** o Solo tem um assento, por isso não recebe repasse entre profissionais. Preço por método também pode ser útil ao profissional individual, mas permanece em Clínica/Pro por posicionamento comercial. A transparência factual da cobrança passa a ser obrigação de todos os planos. O Caixa carrega a projeção alocada ao atendimento e mostra também os fatos de cada cobrança Asaas no Solo; a visualização básica e o bloqueio das configurações avançadas foram exercitados no Preview com fixture DEV. Esta decisão não libera as actions de configuração no Solo.

O armazenamento dos fatos reais do pagamento pode ocorrer em qualquer plano para manter a contabilidade íntegra. Isso não concede acesso às políticas comerciais avançadas. Após downgrade para Solo, configurações antigas ficam guardadas para auditoria, mas deixam de determinar **novos** preços e **novos** repasses. Snapshots históricos não são apagados; sua reconciliação continua necessária. Um upgrade posterior deve reexibir as configurações, sem recalcular atendimentos passados.

Defaults para Clínica/Pro sem configuração: `ABSORB_FEES` para o preço, `GROSS` para a base do repasse e **nenhum repasse automático sem regra explícita para profissional elegível**. O Qoro não desconta automaticamente a taxa do meio de pagamento do repasse do profissional. A clínica é titular da cobrança e dos fundos em sua conta Asaas; Qoro registra e reconcilia, sem criar um segundo ledger.

**Decisão de produto aceita em 03/10/2026:** quando o paciente escolhe PIX ou cartão de crédito em 1x na conversa com a IA, essa escolha determina o preço total do atendimento pelo catálogo da clínica. A **primeira cobrança**, quando houver política de sinal ativa e atendimento elegível, é somente o **sinal percentual configurado**, calculado sobre esse preço total. O restante segue o fluxo próprio após o atendimento. Sem sinal ativo, a IA não promete nem cria link alternativo de valor integral. A criação do Checkout e o envio do link continuam assíncronos e sujeitos às guardas existentes de identidade, conta Asaas, valor mínimo, janela e estado do agendamento.

## 2. Fronteiras e modelo econômico

| Conceito | Dono | Significado | Pode ser desconhecido? |
| --- | --- | --- | --- |
| Preço bruto do atendimento | `scheduling` | preço comercial acordado, snapshot do agendamento | não depois de criado |
| Cobrança e readback Asaas | `payments` | instrumento de cobrança, método, parcelas, bruto, tarifa, líquido e estado do provider | sim, até readback |
| Crédito, recebível e despesa financeira | `financial` | obrigação, dinheiro recebido/alocado e custo do meio de pagamento | tarifa/líquido podem ser `NULL` |
| Regra e snapshot do repasse | `financial` | base `GROSS`/`NET`, profissional, regra efetiva e resultado em centavos | `NET` fica pendente enquanto o líquido for desconhecido |
| Custo de antecipação | `financial` | despesa própria, separada da tarifa ordinária | sim, se não informado pelo provider |

Para consulta de **R$ 250,00**, tarifa real **R$ 5,00** e líquido real **R$ 245,00**, o atendimento e o recebível continuam **R$ 250,00**. A tarifa é despesa da clínica. Regra de 50% gera **R$ 125,00** em `GROSS` ou **R$ 122,50** em `NET`. Para PIX comercialmente oferecido a R$ 240,00, o novo bruto é R$ 240,00; os R$ 10,00 de diferença não são tarifa Asaas. Antecipação jamais muda o bruto e não reduz repasse automaticamente.

Fonte de verdade: [ADR-051](../adr/051-conciliacao-sinal-e-recebivel.md) define `lancamentos` como obrigação e `patient_charges` como instrumento. [ADR-049](../adr/049-pagamentos-paciente-sinal.md) e [ADR-050](../adr/050-identidade-de-pagamento-do-paciente.md) delimitam cobrança, identidade e conta da clínica. [ADR-052](../adr/052-risco-e-reversao-de-pagamento-do-paciente.md) delimita reversões. O catálogo de planos está em [subscriptions.md](../billing/subscriptions.md); não criar plano `Pro+` nem confundir esta feature com a assinatura SaaS da Qoro.

## 3. Camadas e critério de saída

| Camada | Objetivo | Saída necessária | Estado nesta rodada |
| --- | --- | --- | --- |
| **1 — elegibilidade e invariantes de entrada** | Plano Clínica/Pro no servidor; Solo usa defaults mesmo após downgrade; SQL rejeita combinações nulas inválidas | testes de plano, action negativa, leitura e cálculo; typecheck/lint/build | código e testes locais; rollout não realizado |
| **2 — fatos do Asaas e ledger** | Bruto, tarifa, líquido e antecipação reais; evento compatível; despesa original e ajustes imutáveis; reconciliação | DEV com readback, webhook repetido/fora de ordem, legado e refund; saldo consistente | 0110 e correção tardia exercitadas no PostgreSQL DEV; sem correção tardia real do provider nem pagamento real desta política; não aceito |
| **3 — preço comercial por método** | PIX/dinheiro/cartão, parcelas e snapshot imutável antes da cobrança | preço mostrado = cobrado; método/parcelas efetivos conferidos; cross-tenant e tampering negados | código, testes locais e guarda SQL DEV exercitada; pagamento real bloqueado pelo reCAPTCHA; não aceito |
| **4 — repasse profissional** | Regra por profissional/procedimento, base versionada, cálculo em centavos e snapshot | owner sem repasse, `GROSS`/`NET`, mudanças futuras sem retroatividade, refund e duplicidade | elegibilidade revalidada e reversão suspensa localmente; decisão de revisão humana após estorno aceita, fluxo de revisão ainda não implementado; não aceito |
| **5 — interface, E2E e promoção** | Configurações e Caixa claros; migrations; Preview/DEV; rollout e evidência externa | fluxos reais e regressão integral; dados existentes preservados | Preview/DEV com 5/5 E2E de configurações e Caixa sintético; jornada com pagamento real e promoção não executadas |

Uma camada só é `PASS` com execução funcional e assertions. Código presente, teste criado, teste skipado, migration registrada no journal ou provider respondendo `200` isoladamente não são prova de conclusão.

### Camada 1 — implementação desta rodada

1. O contrato versionado `billingApiV1.hasAdvancedFinancialPolicies(clinicId, tx?)` lê `subscriptions → plans` no tenant. O `tx` opcional permite que consumidores usem a **mesma transação e conexão** sem abrir outra; no isolamento padrão `READ COMMITTED`, isso não garante o mesmo snapshot entre statements. O resultado é verdadeiro apenas para `clinica` e `pro`.
2. As Server Actions de preço e repasse exigem usuário, `MANAGE_FINANCIAL`, clínica autenticada e plano elegível **antes** de criar idempotency/audit mutation. O browser nunca escolhe `clinicId` nem plano.
3. A página `/configuracoes/pagamentos` mantém conta Asaas e política de sinal para Solo, mas não consulta nem oferece as políticas avançadas. O Caixa deve carregar os fatos básicos da cobrança em Solo sem expor base/regra de repasse ou relatórios avançados. Essa extensão da visualização foi aceita depois da validação local inicial da camada 1 e requer teste próprio.
4. A resolução de preço retorna `ABSORB_FEES` e o preço padrão em Solo, inclusive se existirem preços antigos após downgrade. A criação de agendamento bloqueia snapshot `payment_method_pricing` no core de servidor e no walk-in. A criação de novo snapshot de repasse fica bloqueada em Solo; fatos antigos podem ser conciliados sem apagar histórico.
5. A migration 0108 rejeita `NULL` em percentual/valor fixo obrigatório, parcelas obrigatórias e método comercial obrigatório. Os `CHECK` equivalentes no schema Drizzle devem permanecer iguais: em PostgreSQL, `CHECK UNKNOWN` é aceito. Ela contém tabelas das camadas seguintes; foi aplicada e lida de volta somente em DEV. Preview e produção continuam sem esta prova neste diff.
6. Testar Solo, Clínica, Pro, ausência de assinatura, downgrade com configuração persistida, chamada direta das actions, e ausência de escrita ao negar. Não provar apenas que o controle sumiu da tela.

Arquivos centrais: `src/contexts/billing/api.ts`, `src/contexts/payments/pricing-{actions,queries}.ts`, `src/contexts/financial/payout-{actions,queries}.ts`, `src/contexts/financial/internal/professional-payout.ts`, `src/contexts/scheduling/internal/appointment-core.ts`, `src/contexts/scheduling/actions.ts`, páginas de Pagamentos/Caixa, schemas e `drizzle/migrations/0108_patient_payment_economics.sql`. Nenhum arquivo dessa camada exige cadastrar taxa estimada.

### Camada 2 — instruções de implementação e prova

1. Ler o adapter Asaas atual e confirmar os campos realmente retornados para `value`, `netValue`, `billingType`, `installment`, `status`, timestamps e antecipação. Não deduzir taxa por percentual fixo. Se o provider não informar a tarifa ou o líquido, persistir `NULL`, não zero.
2. Em `payments`, reconciliar a cobrança após readback autoritativo, mantendo `patient_charges.amount` e `appointments.valor` imutáveis. `provider_gross_amount`, `provider_fee_amount`, `provider_net_amount`, método e parcelas são fatos distintos. Em pagamento parcial e múltiplas cobranças por atendimento, agregar por **crédito efetivamente alocado**, em centavos, sem duplicar bruto.
3. Usar o evento existente `payments.patient_credit.granted` para o crédito. Se a economia chegar depois, usar o evento complementar `payments.patient_payment.economics_reconciled`, com produtor em `payments`, consumidor em `financial`, chave idempotente por cobrança e fato reconciliado, publicação na mesma transação da atualização e retry do outbox. O consumer deve tolerar payloads antigos já persistidos, sem inventar valores históricos.
4. Em `financial`, criar uma despesa `payment_processing_fee` por cobrança/fato real quando taxa conhecida e positiva. `early_settlement_fee` é identidade distinta e só nasce de fato real do provider. A restrição única deve impedir duplicidade em webhook/replay; não alterar o recebível bruto.
5. Provar com fixture DEV isolada: pagamento sem taxa, taxa zero, taxa conhecida, reconciliação tardia, duplicate e out-of-order webhook, refund parcial/total, crédito/alocação, falha entre evento e consumer. Comparar banco, provider e Caixa. Há contenção local para não manter `NET` calculado após reversão explícita; faltam prova transacional/externa e o fluxo de revisão humana do repasse após estorno parcial.

Contrato a estabilizar antes do rollout: `payments.patient_credit.granted` deve continuar consumível quando um evento persistido antes da 0108 não trouxer `providerGrossAmount`, `providerFeeAmount`, `providerNetAmount`, `earlySettlementFeeAmount` ou `installmentNumber`. O evento complementar `payments.patient_payment.economics_reconciled` carrega `chargeId`, `clinicId`, `appointmentId`, **bruto obrigatório**, tarifa e antecipação anuláveis, líquido conhecido, parcelas, `paidAt` e método; não carrega conteúdo clínico nem segredo. O parser/consumer aceitam o payload legado inteiro e persistem fatos ausentes como `NULL`, com regressão local. A 0110 acrescentou `payments.patient_payment.economics_corrected`: a leitura posterior da cobrança incrementa uma revisão monotônica, publica evento na mesma transação, e o handler atualiza crédito/repasse e grava **somente o delta assinado** em novo lançamento imutável. A despesa original permanece intocada; a revisão identifica cobrança, pagamento externo, evento e horário. O smoke DEV exerceu publicação e handler, mas não prova uma tarifa realmente alterada pelo Asaas nem ingestão do extrato como fonte independente do `GET /payments/{id}`.

### Camada 3 — instruções de implementação e prova

1. Preços explícitos por procedimento, método (`pix`, `cash`, `credit_card`) e quantidade de parcelas. `ABSORB_FEES` é o default; no modo explícito, opção não cadastrada não recebe preço padrão silenciosamente. Persistir versão imutável com `effective_from/to`, ator e tenant.
2. O servidor resolve o preço e grava no agendamento o ID da versão, método, parcelas e bruto. A UI pode escolher método/parcelas; não pode escolher valor, `clinicId` ou versão arbitrária. Chamadas diretas ao core de agendamento e walk-in precisam validar a correspondência preço/versão/tenant, além do gate do plano.
3. Confirmar a semântica do Checkout hospedado: `maxInstallmentCount` representa **máximo**, não garantia de quantidade exata escolhida. Não oferecer preço específico de 3x se o Checkout permitir pagar 1x pelo mesmo bruto sem conferência. Ou restringir legitimamente o Checkout a uma condição exata suportada pelo Asaas, ou manter um preço único para a faixa e explicar “até N×”; conferir o método/parcelas efetivos no readback antes de concluir o cenário.
   A [documentação oficial do Checkout para cartão](https://docs.asaas.com/docs/checkout-for-credit-card) confirma que o pagador escolhe até esse máximo. A [API de criação de pagamento](https://docs.asaas.com/reference/create-new-payment) possui `installmentCount` para uma quantidade exata, mas trocar o Checkout hospedado por esse fluxo exige decisão arquitetural separada; não equivale a preencher outro campo no Checkout.
4. Testar PIX com desconto comercial, dinheiro sem Asaas, cartão 1x/Nx, preço ausente, troca de configuração, tampering de valor/ID, downgrade para Solo, checkout renovado e múltiplas tentativas. Não confundir diferença de preço com tarifa real.
5. Na conversa com a IA, **o paciente escolhe o meio**. Para uma clínica com PIX a R$ 240 e cartão a R$ 260, a IA deve consultar as opções vigentes no servidor, perguntar quando a escolha faltar, apresentar o preço correspondente no resumo e exigir um novo consentimento antes de criar o atendimento. A implementação atual oferece **PIX ou cartão 1x** pela IA; dinheiro é manual/Agenda, e somente preço em dinheiro configurado gera orientação para procurar a clínica. O payload da ação pendente deve carregar a cotação resolvida pelo servidor; a confirmação deve revalidar versão, tenant, método, parcelas e bruto na transação. A IA não escolhe valor por conta própria e não cria a cobrança diretamente: a automação de Payments usa o método gravado no atendimento quando uma cobrança for elegível pela política existente. Isso **não garante link imediato nem cobrança integral**. Se a opção não estiver configurada ou o Checkout não garantir as parcelas anunciadas, bloquear aquela condição com orientação clara, sem retornar ao preço padrão. A criação pela recorrência, o aceite de oferta da lista de espera e a importação histórica continuam bloqueados no modo explícito até carregarem uma cotação válida ou um contrato histórico próprio.

### Camada 4 — instruções de implementação e prova

1. Versionar a base `gross|net` e as regras `percentage|fixed`, por profissional e opcionalmente procedimento. Apenas profissional ativo/elegível da mesma clínica; owner não é alvo de repasse automático. Validar essa elegibilidade **novamente ao criar o snapshot**, pois uma regra criada quando o profissional era elegível pode sobreviver à desativação ou mudança de papel. Regra ausente significa ausência de passivo, não repasse de 100%.
2. **Decisão aceita em 04/10/2026:** na conclusão do atendimento, resolver a regra e a base pelo instante `scheduledAt` do agendamento que efetivamente foi concluído. Remarcação cria novo agendamento com novo `scheduledAt` e preserva o preço comercial já escolhido; a regra de repasse acompanha o novo horário. Atraso na conclusão não altera a regra. Uma regra alterada antes da conclusão pode alcançar atendimentos já reservados para uma data futura; após o snapshot, mudança posterior não recalcula o passado. O timestamp tem fuso (`timestamptz`); comparar instantes, não apenas o dia no calendário. Criar um único snapshot por appointment, com regra, versão, bruto e status. `GROSS` pode calcular antes do líquido; `NET` permanece `pending_economics` até receber o líquido real. **Código:** `transitionPayload` lê o `scheduledAt` da linha concluída; o handler o passa a `createProfessionalPayoutSnapshot`; a consulta compara `effective_from <= scheduledAt < effective_to`. **Prova DEV:** o smoke transacional descrito abaixo cobre remarcação, atraso e mudança de regra/base. Ainda falta a jornada pelo navegador até a conclusão real do atendimento e o readback de tarifa/líquido do Asaas.
3. Cálculo puro recebe valores/regra explícitos e usa centavos com arredondamento uma vez no resultado final. Taxa de antecipação é despesa da clínica e não entra automaticamente na base. Não chamar `payout_amount` de transferência efetivamente realizada: o rascunho calcula uma obrigação, não executa split/transferência ao médico.
4. **Decisão aceita em 04/10/2026:** após estorno parcial ou perda, suspender o repasse automático e exigir revisão humana do valor devido; não calcular proporção automática nem transferir enquanto pendente. O cálculo original e a reversão devem permanecer auditáveis. A contenção local já distingue pagamento parcial sem reversão, que preserva `GROSS` e deixa `NET` pendente, de estorno/perda explícitos, que suspendem GROSS e NET em `cancelled` até decisão humana. `pending_economics` fica reservado ao NET sem fatos suficientes do provedor. Esses estados sozinhos **não representam** uma tarefa de revisão nem uma decisão final. Desde 07/10, o estado `reviewed`, as versões imutáveis da decisão, a action autorizada e a UI do Caixa existem e passaram no E2E do Preview (seções da camada 4 de 07/10). Desde 05/10, a primeira suspensão de um repasse calculado por estorno/perda grava o valor anterior em `audit_events` na mesma transação, antes de limpar `basis_amount`/`payout_amount`; o replay não duplica o registro. A decisão de revisão é a ação autorizada que tira o repasse da suspensão, e cada uma vira uma versão no histórico; reconciliações posteriores não a reabrem sozinhas. Eventos de reversão chamam o refresh na mesma transação, e a projeção do Caixa subtrai principal revertido sem inventar tarifa devolvida. Provar idempotência, concorrência, crédito misto, owner, múltiplos profissionais, regra fixa acima da base (decidir se é permitido), mudança GROSS→NET e downgrade.

### Camada 5 — UI, migração e promoção

1. Configurações: mostrar política de preço, base de repasse e regras somente a `MANAGE_FINANCIAL` **e** plano Clínica/Pro. Textos devem dizer que a taxa é despesa da clínica e que NET é opção explícita. Caixa: em **todos** os planos, mostrar fatos conhecidos de bruto/tarifa/líquido com `desconhecido/pendente` quando o provider não informar, sem substituir `NULL` por R$ 0,00; apenas Clínica/Pro recebem base/regra de repasse, antecipação detalhada e relatórios avançados. `listAppointmentFinancialEconomics` agrega a **parte alocada ao atendimento**, não o bruto total de cada cobrança quando há múltiplas cobranças ou alocação parcial; a UI conserva esse rótulo e agora traz, em bloco separado, os fatos individuais das `patient_charges` via leitura tenant-scoped de Payments. A lista individual cobre somente os atendimentos carregados no Caixa do dia; consulta histórica por cobrança continua fora deste checkpoint. `requestedAmount` não é apresentado como dinheiro recebido. Após estorno, os valores do provedor continuam rotulados como fatos do pagamento original, não saldo atual. Os E2E do Caixa Solo e Pro com fatos sintéticos estão registrados abaixo. O readback econômico do Asaas na tela passou em 07/10 com um pagamento Pix real (9ª execução do runner); cartão e múltiplas cobranças por atendimento seguem sem prova visual. Na comparação de planos do cadastro e da landing, anunciar as **configurações avançadas** apenas em Clínica/Pro **depois** de sua validação funcional e promoção; não criar promessa comercial enquanto as camadas 2–4 estão abertas.
2. A migration `0108_patient_payment_economics.sql` contém colunas e tabelas de várias camadas. Antes de aplicá-la, verificar journal, backup, `check:migrations`, SQL `CHECK` com `NULL`, RLS `ENABLE+FORCE`, grants, funções/triggers, FKs tenant, índices únicos e readback em DEV. **Não** preencher taxa/líquido de pagamentos antigos por estimativa. Não aplicar em produção nesta fase.
3. Rodar testes de domínio, webhook, cron, RLS/cross-tenant, autenticação direta, plano Solo/Clínica/Pro e E2E real em Preview/DEV com Asaas Sandbox. Usar fixture isolada e limpar somente ela. Separar `PASS`, `FAIL`, `BLOCKED` e `NOT TESTED`; provider aceitando um request não prova webhooks, saldo nem UI.
4. Revalidar TypeScript, ESLint, Prettier, build Next, suíte integral, migrations e inventário de Server Actions. Promover só com diff revisado, migration no ambiente-alvo ordenada e confirmação dos cenários externos. Após release, monitorar duplicidade, pendências econômicas, valor bruto divergente e falhas do outbox; rollback de app não deve apagar dados.

## 4. Matriz mínima de aceitação

| Caso | Esperado |
| --- | --- |
| Solo, inclusive após downgrade | preço padrão; policies não visíveis/escrevíveis; nenhum novo payout; cobrança existente intacta; bruto/tarifa/líquido factual visíveis quando conhecidos, `desconhecido` quando não |
| Clínica e Pro | políticas permitidas com `MANAGE_FINANCIAL`; role sem permissão negada na action |
| R$ 250, tarifa R$ 5, owner | bruto 250; despesa 5; líquido 245; nenhum repasse automático |
| R$ 250, 50% GROSS | base 250; repasse 125 |
| R$ 250, 50% NET | base 245; repasse 122,50 após readback |
| PIX explícito R$ 240 | bruto da cobrança/atendimento 240; diferença comercial não vira tarifa |
| Cartão parcelado | preço e quantidade escolhidos correspondem ao que o provider efetivamente processou |
| Taxa desconhecida | `NULL`/pendente; nenhuma tarifa inventada |
| Antecipação | despesa separada; bruto e repasse não alterados implicitamente |
| Webhook duplicado/out-of-order | um crédito, uma despesa de taxa, um snapshot por atendimento |
| Refund/chargeback | obrigação e repasse refletindo reversão real; nenhum payout sobre valor estornado |
| Tenant A tenta ID do B | leitura e escrita negadas; nenhuma chamada externa para B |

## 5. Pendências conhecidas após a revisão do rascunho

- **Parcelamento com preço específico fica bloqueado:** o Checkout hospedado recebe `DETACHED` para cartão 1x e PIX sem parcelas; preço de cartão 2–12x é recusado na gravação nova e no core, opção histórica 2–12x aparece desabilitada na Agenda, e a ativação do modo explícito ignora preço que não é utilizável. `maxInstallmentCount` é apenas um teto, não uma escolha exata. O readback agora rejeita `installmentId` ou número incompatível com 1x, mas ainda falta pagamento real no Sandbox para comprovar o comportamento do formulário.
- **Corrigido apenas localmente:** a criação do atendimento lê o modo efetivo na mesma transação, considera o entitlement e rejeita cotação ausente, alterada ou forjada antes de gravar atendimento/outbox. A IA agora consulta o catálogo, exige escolha explícita, resume o preço do servidor e carrega a cotação na ação pendente para revalidação na confirmação. A automação do sinal e do restante carrega método e parcelas do atendimento até o Checkout; dinheiro não entra na fila de cobrança por link. Recorrência e aceite da lista de espera ainda não coletam a condição comercial e devem falhar fechados no modo explícito; não podem ser apresentados como fluxos disponíveis. A importação histórica ainda precisa de proveniência interna e valor histórico próprio, sem reprificação pelo catálogo. Essas barreiras têm testes locais, mas não foram exercitadas em PostgreSQL/Preview.
- **Link após escolha do paciente: decisão de valor fechada, jornada externa ainda não comprovada.** A primeira cobrança é o sinal percentual configurado sobre o preço do PIX ou cartão 1x escolhido. A confirmação do agendamento pela IA agora publica `scheduling.appointment.deposit_requested` na mesma transação da criação. Um handler detached relê o agendamento no tenant e tenta a criação existente do sinal fora da transação do outbox; o cron de 15 minutos permanece como backstop. O evento não contém link, CPF ou dado clínico. A fila C14 envia o link por template depois de `payments.patient_charge.link_ready`, respeitando a janela e guardas de envio. Sem sinal ativo ou elegibilidade, não há link; não se cria cobrança integral substituta. O campo da ferramenta permanece `hosted_checkout_supports_option` porque compatibilidade técnica não significa link emitido. A sequência real IA → Asaas → fila → Meta → paciente continua `NOT TESTED`. O pagamento real de um Checkout de sinal passou no Preview em 07/10, mas fora dessa sequência. Não prometer entrega no mesmo turno.
- **Migrations 0108–0109 em DEV:** a 0108 impede snapshot explícito com preço inativo/futuro, política incompatível ou plano inelegível. A revisão encontrou que ela ainda permitia `absorb_fees` por INSERT direto sob política explícita; a 0109 acrescentou esse ramo e preservou remarcação histórica exata. O readback e a prova transacional DEV desse ramo passaram, com rollback sem resíduos. A mesma prova não foi feita em Preview/produção.
- O painel básico do Caixa usa economia **alocada por atendimento** e agora identifica os fatos de cada cobrança em um bloco separado, sem somá-los ao total alocado. Essa distinção passou nos testes locais e no readback DEV com fixture sintética; ainda falta E2E visual em Preview, inclusive com mais de uma cobrança por atendimento.
- **Antecipação ainda não tem produtor real:** a camada de Payments grava/emite `earlySettlementFeeAmount: null` nos caminhos atuais de readback. Coluna, evento e consumer preparados não comprovam custo de antecipação separado. Identificar fato autoritativo no Asaas Sandbox, correlacionar à cobrança e provar evento → despesa → Caixa antes de anunciar essa parte.
- O repasse após refund/perda tem contenção local: a existência de reversão suspende a obrigação sem estimar proporção, mesmo que um novo pagamento deixe o recebível `pago`. A decisão de produto é revisão humana do valor final após estorno parcial. Ação, persistência e UI dessa revisão foram implementadas em 07/10 e passaram no E2E do Preview com papéis reais (5/5). Sem uma versão registrada, o status conservador não pode ser anunciado como reconciliação concluída. A UI precisa explicar que `cancelled` em GROSS significa obrigação suspensa por reversão, não transferência realizada.
- A criação do snapshot agora revalida o profissional na mesma transação, com o mesmo predicado da criação da regra e bloqueio `FOR SHARE`; regra antiga de profissional desativado/owner/inelegível deixa de criar novo passivo. Falta prova com perfil real em DEV e concorrência de desativação.
- A seleção da versão da regra usa `scheduledAt` do agendamento concluído, inclusive após remarcação; atraso na conclusão não o altera. A decisão de 04/10 fechou a semântica, mas o teste de integração entre reserva, remarcação, conclusão e snapshot ainda falta.
- O parser do evento e o consumer aceitam payloads legados **inteiros** sem campos econômicos, gravando valores desconhecidos como `NULL`; payload moderno parcialmente preenchido continua recusado. Regressões locais passaram; replay de eventos persistidos em outbox DEV continua `NOT TESTED`.
- O readback do Asaas agora confirma o pagamento mesmo se `netValue` vier negativo, não finito ou maior que o bruto: deixa tarifa/líquido pendentes e emite métrica sem PII, em vez de causar 500 no webhook. O backstop também não publica fato econômico inválido. A schema atual não representa ajuste positivo `líquido > bruto`; nesses casos a economia continua pendente até desenho contábil específico e prova com resposta real do Sandbox.
- `createEstorno` agora compara refunds acumulados com **todos** os pagamentos do lançamento, não com `valorPago` corrente. Um teste vermelho antes da correção reproduziu: pagamento 100, perda 30, nova baixa 30, refund manual 70; o ledger ainda retém 30 e não pode virar `estornado`. Falta teste transacional em DEV desse encadeamento e da tentativa posterior de estornar os 30 restantes.
- **Correção tardia de tarifa: implementação DEV, prova externa pendente.** A 0110 versiona o fato econômico; o cron relê periodicamente cobranças pagas e já conciliadas por `GET /payments/{id}`. Se `netValue` mudar, `payments` publica revisão monotônica e `financial` projeta o delta assinado em lançamento novo, preservando o original. O smoke PostgreSQL DEV confirmou 5→7→5→7→9, rollback após aplicação do handler, retry, dez replays e valor final de tarifa 9/líquido 141/repasse NET 42,30. O provedor não apresentou uma **correção tardia real** durante esta prova. O [extrato oficial do Asaas](https://docs.asaas.com/reference/retrieve-extract) também expõe transações com IDs, `PAYMENT_FEE` e `PAYMENT_FEE_REVERSAL`; **a 0110 não o ingere**. Se o extrato mudar a tarifa sem que `GET /payments/{id}.netValue` mude, este reconciliador não detectará o ajuste. Antes do rollout, provar a consistência entre os dois recursos no Sandbox e definir ingestão de transações por ID caso a divergência seja possível. Faltam concorrência entre duas transações independentes e E2E da projeção no Caixa após a correção.
- **Sondagem do extrato Sandbox em 04/10, somente leitura:** `GET /v3/financialTransactions` com `ASAAS_CHAVE_TESTE_2` retornou exit 0 nos períodos fechados consultados. Em 01/10 havia 8 transações, 2 `PAYMENT_FEE`; em 04/10 havia 4 transações, 1 `PAYMENT_FEE`. A resposta trouxe `paymentId`, e os pagamentos de teste conhecidos tiveram correspondência com uma transação de tarifa cada. Isso comprova a chave de correlação disponível nesse Sandbox, **não** a estabilidade definitiva da tarifa, uma correção tardia real, a ausência de outras tarifas/estornos em páginas adicionais nem qualquer projeção contábil no Qoro. A pendência de versionar o fato e contabilizar o delta permanece aberta.
- **Divergência de pagamento:** `getPayment` agora preserva `netValue` e parcelas. Método, parcelas ou bruto divergentes ficam em `failure_code` com ID do pagamento; o evento não consome dedup, não concede crédito e o cron relê o provedor. Um readback corrigido recuperou uma cobrança sintética no PostgreSQL DEV. Divergência persistente continua exigindo resolução operacional/refund; métrica e reconsulta não provam conciliação de dinheiro divergente.
- **Sandbox hospedado, checkpoint automatizado anterior:** tentativas separadas de cartão e PIX com `ASAAS_CHAVE_TESTE_2` retornaram `recaptchaV2Enabled: true` e “Tente novamente e verifique o recaptcha.” Na reexecução não interativa de 04/10, o runner exigiu a resposta do Asaas com o mesmo ID e `status: CANCELED` para cada Checkout; não houve GET independente. Nesse checkpoint ainda não havia pagamento, webhook nem refund. A intervenção humana posterior está registrada na seção de 04/10 abaixo.
- O E2E provider → webhook → crédito → Caixa passou no Preview em 07/10 (Pix, conta pausada, 9ª execução do runner). Ainda faltam o trecho até o repasse e a regressão de plano após downgrade. Até essa prova, as camadas 2–5 permanecem em desenvolvimento.

## 6. Procedimento de verificação e promoção

Neste worktree, use os binários via `npx`; não use `pnpm <script>` porque o gerenciador tenta modificar o `node_modules` compartilhado. Para a camada 1, execute e registre **exit code** e totais:

```powershell
npx vitest run src/contexts/billing/api-financial-policies.test.ts src/contexts/payments/pricing-actions.test.ts src/contexts/payments/pricing-queries.test.ts src/contexts/financial/payout-actions.test.ts src/contexts/financial/payout-queries.test.ts src/contexts/financial/internal/professional-payout.test.ts src/contexts/financial/payout.test.ts src/contexts/scheduling/internal/appointment-financial-plan.test.ts "src/app/(app)/(shell)/configuracoes/pagamentos/data.test.ts"
npx tsc --noEmit
npx eslint .
npx prettier --check .
npx tsx scripts/check-migration-safety.ts
npx tsx scripts/security/inventory.ts --check
npx vitest run
```

O build sem `.env.local` deve usar `npx tsx scripts/security/local-build.ts`: o runner copia o código para `dist/security-local/app` e injeta **somente valores sintéticos**. Antes da execução, confirme que esse destino resolvido está dentro do worktree; o runner apaga o próprio artefato anterior. `npx next build` sem as variáveis mínimas falha no carregamento do ambiente e não prova compilação.

Para um ambiente que ainda não recebeu a 0108, rode primeiro o runbook de [migrations](../runbooks/migrations.md), revise o SQL e o journal, selecione explicitamente o alvo, faça backup/snapshot conforme a operação vigente e só então execute o runner apropriado. Em DEV, a aplicação e o readback constam abaixo; **não** repetir para deixar suíte verde. A migration 0108 **não é pré-requisito para testar a elegibilidade da camada 1**. Para Preview/produção, a promoção continua separada e não autorizada por este registro DEV. Use fixtures separadas de dados reais e confirme estado terminal no banco e no provider.

Antes de um PR/merge, releia `git diff`, `git status`, o inventário de actions e esta especificação. **O registro de progresso abaixo** deve conter os comandos executados, o que passou e o que permanece `BLOCKED`/`NOT TESTED`. `docs/qorov2.md` só aponta para este registro. Não promover a camada seguinte porque a anterior tem testes de unidade: cada linha da matriz de aceitação exige sua própria evidência funcional.

## 7. Registro de progresso e evidências

Registrar aqui cada avanço com data, commit/base, camada, comandos e totais medidos, estado externo, defeitos encontrados/corrigidos e próxima condição de saída. **PASS local, execução DEV/Preview e promoção são marcos diferentes.** Não substituir o registro anterior por um resumo otimista nem duplicar o progresso em `qorov2.md`.

| Data | Camada | Estado comprovado | Próxima condição de saída |
| --- | --- | --- | --- |
| 02/10/2026 | 1 — elegibilidade | `PASS LOCAL`: 34/34 testes focados, build e checks; `NOT TESTED` em banco/Preview | corrigir as dependências das camadas seguintes e provar a 0108 em DEV antes de implantar o diff inteiro |
| 02/10/2026 | Decisão do recorte dos planos | Solo tem um assento e já pode cobrar pelo Asaas; usuário aceitou transparência factual da cobrança em todos os planos e manteve configurações avançadas em Clínica/Pro | implementar a visualização mínima no Solo e provar que actions e repasse continuam bloqueados |
| 02/10/2026 | 2–4 — economia, preço e repasse | `RASCUNHO`: código e testes locais existem, mas há defeitos de legado, parcelamento e reversão | corrigir cada invariante da seção 5 e executar os cenários DEV/Asaas Sandbox de cada camada |
| 02/10/2026 | 5 — interface e promoção | `NOT TESTED` ponta a ponta | implementar a transparência mínima do Solo, executar E2E e fazer readback antes de divulgar o recurso |
| 03/10/2026 (checkpoint local anterior) | 2–3 — preço, IA e cobrança | `PASS LOCAL`: PIX e cartão 1x com preço do catálogo, consentimento separado, revalidação transacional, método preservado até o Checkout; dinheiro fora do scan; 4.739/4.739 testes em 462 arquivos | E2E real com Asaas Sandbox; a decisão então pendente foi fechada no checkpoint do sinal abaixo |
| 03/10/2026 (checkpoint local anterior) | 2–4 — economia e repasse | `PASS LOCAL` para bruto/líquido/tarifa válidos e pagamento com economia fora de faixa pendente; naquele instante a 0108 só tinha verificação estática | provar webhooks, reversões e repasse no banco; decidir estorno parcial e correção tardia de tarifa |
| 03/10/2026 | 2–4 — banco DEV e guardas | `PASS DEV`: 0108 aplicada após backup gerado e índice legível (restauração não testada); `_schema_version` e journal avançaram, 6 tabelas com RLS `ENABLE+FORCE`, 17 policies, 8 triggers e 18 colunas conferidos; isolamento e trigger testados com `ROLLBACK`; smoke de Checkout 7/7 e ajustes financeiros 7/7 com cleanup | Preview/Asaas real, pagamento/estorno e repasse ponta a ponta |
| 03/10/2026 | 3 — Checkout Sandbox | `BLOCKED`: cartão e PIX chegaram ao formulário, ambos exigiram reCAPTCHA; pedidos de cancelamento aceitos, sem readback terminal | concluir desafio humano no Sandbox e repetir pagamento, readback, webhook e cleanup |
| 04/10/2026 | 3 — Checkout Sandbox interativo | cartão: Checkout e cobrança correlacionados, estorno terminal por readback do runner; PIX: Checkout e pagamento correlacionados, estorno depois `CANCELLED` e cobrança ainda `RECEIVED` por readback independente | investigar motivo do cancelamento no painel/suporte Asaas; refund PIX e webhook Qoro/Caixa/repasse ainda não comprovados |
| 03/10/2026 | 2–3 — backstop e Caixa | `PASS LOCAL` 4.770/4.770 testes em 465 arquivos; baixa manual com meio divergente bloqueada no servidor; cron prioriza recebíveis, limita chamadas externas e alterna candidatos persistentes; build sintético Next exit 0; guarda SQL 0109 exercitada em DEV | E2E Preview e pagamento Sandbox |
| 03/10/2026 | 3 — sinal após escolha na IA | Decisão: cobrar o percentual de sinal configurado, nunca o valor integral nessa etapa. Evento transacional acelera o fluxo da IA; leitura tenant-scoped e handler detached; testes direcionados e smoke de outbox em DEV com rollback/cleanup | fluxo real Asaas → Meta → paciente e pagamento ainda pendentes |
| 03/10/2026 | 5 — fatos por cobrança no Caixa | Bloco individual para sinal/restante em todos os planos; 25/25 testes direcionados, consulta tenant-scoped e readback sintético no PostgreSQL DEV com isolamento; regressão final 4.779/4.779, build Next e checks exit 0 | E2E visual em Preview com cobrança Asaas real, tarifa real e estorno |

Em 02/10/2026, no worktree isolado `fix/post-merge-validation-20261001` (`9b63746f` antes destas alterações), a camada 1 passou em **34/34 testes focados, 9 arquivos**. A regressão `npx vitest run` passou em **4.666/4.666 testes, 456 arquivos** (exit 0, 181,54 s). `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `npx tsx scripts/check-migration-safety.ts`, `npx tsx scripts/security/inventory.ts --check` e `git diff --check` tiveram exit 0. O build `npx tsx scripts/security/local-build.ts`, com variáveis sintéticas, compilou e gerou 18 páginas estáticas (exit 0). Esses resultados provam compilação e comportamento exercitado localmente, **não** a execução em banco real.

No checkpoint de 02/10, a aplicação/readback da 0108, RLS real, Preview, Asaas, Caixa e repasse eram **NOT TESTED**; não houve escrita externa naquele checkpoint. As operações DEV e Sandbox de 03/10 estão registradas separadamente abaixo. As camadas 2–5 permanecem em desenvolvimento e o diff completo não deve ser implantado sem os cenários externos.

As linhas de 02/10 acima são checkpoints históricos. A visualização mínima do Solo e a discriminação local por cobrança existem no código; as ações pendentes são prova E2E em Preview, readback externo no Asaas e publicação controlada, não uma segunda implementação da mesma tela.

Antes da operação DEV de 03/10, no mesmo worktree/base, `npx vitest run` passou em **4.739/4.739 testes, 462 arquivos** (exit 0, 110,40 s), e os checks de TypeScript, ESLint, Prettier, migrations, inventário, diff e build sintético Next passaram (18 páginas estáticas). Estes totais são históricos, não a regressão final após as correções seguintes.

### 03/10/2026 — operação DEV e prova de anomalia

- **Alvo:** o runner recebeu `DATABASE_URL_DEV` somente em memória, depois de confirmar a referência do projeto DEV `pqhkirrszzpwezdaqrai`, `sslmode=require` e ausência da referência de produção. `SUPABASE_PROJECT_ENV=dev`. Nenhum comando deste registro apontou para produção.
- **Backup antes da escrita:** `pg_dump` em formato custom no diretório local `C:\Users\joaom\.codex\backups`, arquivo `qoro-dev-pre-0108-20261003-140334.dump`, 1.495.672 bytes; `pg_restore --list` retornou exit 0. Este backup não foi versionado.
- **Migration:** `npx tsx scripts/db-migrate-dev.ts` retornou exit 0. Readback: `_schema_version` contém 0108; o journal do Drizzle passou de 108 para 109 registros; seis tabelas novas com RLS `ENABLE` e `FORCE`, 17 policies, oito triggers e 18 colunas esperadas foram conferidos. Grants críticos conferidos: `anon` sem `SELECT` e `authenticated` sem `UPDATE` na versão append-only.
- **Provas SQL transacionais:** com duas clínicas DEV preexistentes, `authenticated` viu somente a própria política; tentativa de `UPDATE` cross-tenant afetou zero linhas. O trigger aceitou preço PIX vigente e rejeitou preço futuro e preço inativo. Todas as fixtures dessas provas rodaram com `ROLLBACK`.
- **Integração com PostgreSQL DEV:** `npx tsx --conditions=react-server scripts/smoke-patient-checkout-db.ts` passou 7/7 (exit 0): lease, dedup, RLS cross-tenant, link ativo, quarentena por método divergente, reprocessamento do mesmo evento após leitura corrigida, um único evento de crédito enfileirado, rotação do backstop e cleanup sem resíduos. O worker não foi executado nesta prova. A resposta do Asaas foi **sintética**; ela valida lógica e transações, não o provider. `scripts/smoke-patient-money-adjustments-db.ts` passou 7/7 (exit 0) após a 0109, incluindo `CANCELLED` versus `DONE`, perda/reversão, replay, isolamento e cleanup.
- **Asaas Sandbox real:** `scripts/asaas-checkout-e2e.ts` com `ASAAS_CHAVE_TESTE_2`, host `api-sandbox.asaas.com`, modo não interativo, executou cartão e PIX separadamente. Ambos retornaram `recaptchaV2Enabled: true`, mensagem sanitizada “Tente novamente e verifique o recaptcha”, exit 1; em ambos o POST de cancelamento foi aceito, sem readback terminal. **BLOCKED para pagamento/refund/webhook**, apesar de criação e solicitação de cancelamento do recurso terem sido exercitadas. A documentação oficial descreve `DETACHED` como cartão à vista e `INSTALLMENT`/`maxInstallmentCount` como parcelamento até um teto; ela não substitui o pagamento real no Sandbox.
- **Correções após revisão independente:** `getPayment` voltou a mapear `netValue`, `installmentId` e `installmentNumber` (teste vermelho antes, verde depois); método, parcela ou bruto divergentes agora persistem identidade/código de falha sem consumir dedup; o cron relê a anomalia e só recupera quando o readback satisfaz a condição original. Preço com fração de centavo e cartão 2–12x são rejeitados antes de gravar; recorrência fica indisponível na UI com modo explícito. A resolução de **divergência persistente** ainda exige ação operacional ou estorno: reconsulta não autoriza creditar valor/método diferente.
- **Nova revisão de orçamento e justiça do cron:** com 50+5 leituras sequenciais, o backstop podia exceder os 60 s da rota antes de abrir pendências de recebíveis. Candidatos antigos sem `netValue` ou conta Asaas podiam impedir indefinidamente a consulta dos próximos. Agora a obrigação primária roda antes do Asaas; no máximo duas leituras econômicas e uma anomalia por tick usam timeout de 4 s cada e só começam dentro do orçamento inicial de 30 s. A 0109 adicionou `provider_reconcile_checked_at` e índices parciais; o scan marca cada tentativa inclusive quando o provedor não traz dado. O smoke DEV de Checkout passou **7/7** após incluir duas cobranças sintéticas e comprovar que dois scans de limite 1 escolhem cobranças diferentes, com cleanup. Esta mitigação não prova que todo cron sempre termina antes do limite quando o próprio banco está lento; há métrica própria quando o backstop é pulado por orçamento.
- **Baixa manual no Caixa:** um atendimento com preço explícito de dinheiro podia ser baixado como PIX mantendo o bruto original. `confirmPayment` agora lê o snapshot do atendimento no mesmo tenant/transação e recusa método divergente antes de update, insert ou outbox; a tela filtra o seletor para o método acordado. `absorb_fees` continua flexível. Testes focados 27/27 em três arquivos passaram; falta E2E em Preview para esse caminho.
- **0109 somente DEV:** backup pré-migration `C:\\Users\\joaom\\.codex\\backups\\qoro-dev-pre-0109-2026-10-03T22-20-48-202Z.dump`, 1.554.510 bytes, `pg_dump` exit 0 e índice `pg_restore --list` exit 0; restauração em scratch não testada. `npx tsx scripts/db-migrate-dev.ts` exit 0. Readback: ledger Drizzle 110, coluna `provider_reconcile_checked_at`, dois índices parciais e novo ramo da função SQL presentes. Nenhuma migration desta rodada foi aplicada em produção.
- **Guarda SQL 0109 em DEV:** `scripts/smoke-appointment-pricing-guard-db.ts` passou, exit 0, após corrigir uma falha da própria fixture (`Date` passado diretamente ao driver). Em transação isolada, INSERT direto `absorb_fees` sob política explícita e remarcação com valor alterado foram recusados; remarcação histórica exata e novo snapshot PIX vigente foram aceitos. A transação sofreu rollback deliberado e o readback comprovou zero resíduos da fixture. Não houve pagamento nem chamada ao Asaas nessa prova.
- **Regressão local antes do gatilho da IA:** `npx vitest run` passou em **4.770/4.770 testes, 465 arquivos**, exit 0, 115,40 s. O teste direcionado de migrations, cron, adapter Asaas e Caixa passou 89/89 em oito arquivos. `npx tsx scripts/security/local-build.ts` compilou o Next com variáveis sintéticas e gerou 18 páginas estáticas, exit 0. Os checks estáticos desse checkpoint retornaram exit 0. Esses totais não incluem o smoke SQL direto, registrado acima, nem prova de provider.
- **Decisão do sinal e prova do novo gatilho, DEV em 03/10:** a confirmação pela IA publica um pedido mínimo e idempotente na transação do agendamento. `scripts/smoke-patient-checkout-db.ts` retornou exit 0 com 7/7 cenários anteriores mais leitura do candidato elegível, bloqueio cross-tenant e de atendimento cancelado, publicação dupla colapsada em um evento por tipo, rollback do outbox de prova e cleanup sem resíduos. Os testes direcionados de agendamento, handler, sinal, prompt e ação pendente passaram **49/49 em cinco arquivos**. Essa prova usa resposta de provedor sintética e não executa o envio ao paciente.
- **Transparência de cada cobrança em DEV, 03/10:** a nova leitura de Payments retorna somente ID interno, atendimento, tipo, estado, valor solicitado e fatos econômicos do provider; não seleciona link, identidade nem credencial. A página do Caixa escopa os IDs pelo tenant e exibe sinal e restante individualmente em todos os planos; repasse continua restrito. Testes direcionados de query, página e UI passaram **25/25 em três arquivos**. `scripts/smoke-patient-checkout-db.ts` passou **7/7** após o acréscimo: com fixture sintética, readback individual de R$ 75,00 bruto, R$ 2,50 de tarifa e R$ 72,50 líquido; consulta de outra clínica retornou zero, seguida de cleanup sem resíduos. O primeiro ensaio do smoke parou na validação de ambiente porque faltava `NEXT_PUBLIC_SUPABASE_URL`; o segundo, porque faltava a publishable key. O terceiro, com URL pública e chave do projeto DEV injetadas apenas no processo, passou. Não houve tela em Preview nem resposta econômica externa do Asaas nessa prova.
- **Regressão final deste checkpoint:** `npx vitest run` passou **4.776/4.776 testes em 467 arquivos**, exit 0, 128,02 s. `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, `npx tsx scripts/check-migration-safety.ts`, `npx tsx scripts/security/inventory.ts --check` e `git diff --check` retornaram exit 0. `npx tsx scripts/security/local-build.ts` compilou o Next com ambiente sintético e gerou 18 páginas estáticas, exit 0. O cenário Asaas Sandbox → Meta real segue sem PASS.
- **Regressão após o bloco por cobrança:** `npx vitest run` passou **4.779/4.779 testes em 468 arquivos**, exit 0, 152,45 s. `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, checks de migrations e inventário de segurança passaram, exit 0. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24 e gerou 18 páginas estáticas, exit 0. O smoke DEV acima passou com cleanup; nenhuma dessas provas é pagamento real, E2E visual em Preview ou autorização para promover o diff inteiro.
- **Limites:** Preview, webhook externo real, Caixa/repasse ponta a ponta, correção tardia de tarifa, antecipação, estorno parcial e a jornada IA → link → pagamento continuam `NOT TESTED` ou `BLOCKED` conforme acima. A decisão do valor da primeira cobrança foi fechada para o sinal configurado; o código não envia link na mesma conversa. Nenhum merge na `main` ou escrita em produção ocorreu.

### 04/10/2026 — provas isoladas sem intervenção humana

- **Checkout Sandbox:** o runner passou a exigir que a resposta ao `POST /checkouts/{id}/cancel` contenha o mesmo `id` e `status: CANCELED`; HTTP 200 sozinho não basta. A guarda passou **23/23 testes** no helper de cleanup. Reexecuções separadas de PIX e cartão, usando somente `ASAAS_CHAVE_TESTE_2` e `api-sandbox.asaas.com`, terminaram com exit 1 porque o formulário respondeu `recaptchaV2Enabled: true`. Em ambos, o Asaas respondeu `CANCELED` para o Checkout correspondente no cleanup. Isto comprova o estado retornado pelo cancelamento, **não** um GET independente, pagamento, webhook ou refund. O desafio humano segue `BLOCKED`.
- **Payload legado no PostgreSQL DEV:** `npx tsx --conditions=react-server scripts/smoke-patient-checkout-db.ts` retornou exit 0. Além dos sete cenários anteriores, a fixture executou o schema do catálogo e o handler transacional real sob `withTenant` com um evento antigo sem campos econômicos, duas vezes. Readback: um crédito, bruto/tarifa/líquido `NULL`, nenhuma despesa inventada. O evento complementar, também entregue duas vezes, terminou com um crédito de bruto R$ 75,00, tarifa R$ 2,50, líquido R$ 72,50 e uma única despesa da tarifa. O cleanup removeu as clínicas sintéticas, cobranças, gerações, créditos e eventos de outbox da fixture; readback de resíduos zero. O worker global **não** foi acionado porque poderia consumir eventos pendentes de outras clínicas. Portanto, replay integral da fila segue `NOT TESTED`.
- **Regressão desta rodada:** `npx vitest run` passou **4.784/4.784 testes em 468 arquivos**, exit 0, 117,21 s. `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, `npx tsx scripts/check-migration-safety.ts` e `git diff --check` passaram. O primeiro `npx tsx scripts/security/inventory.ts --check` falhou porque o inventário gerado ainda contava 180 actions; `--write` atualizou `docs/security/acoes.md` para as 192 actions do diff atual, sem itens não resolvidos; o novo `--check` passou, exit 0. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24, gerou 18 páginas estáticas e terminou com exit 0.

### 04/10/2026 — Checkout interativo e decisões de produto

- **Cartão, Asaas Sandbox:** o usuário executou `npx tsx scripts/asaas-checkout-e2e.ts` com `ASAAS_CHAVE_TESTE_2` somente no processo, método `CREDIT_CARD` e intervenção humana no reCAPTCHA. O runner registrou Checkout hospedado correlacionado e `cleanup: estorno confirmado por readback`; não houve evidência nesta rodada de webhook recebido pelo Qoro, lançamento no banco, Caixa ou repasse. Este resultado é PASS para pagamento/estorno **da fixture isolada no provedor**, não para a integração financeira completa.
- **PIX, Asaas Sandbox:** o mesmo runner registrou Checkout hospedado e pagamento correlacionado, mas o primeiro pedido de estorno recebeu HTTP 400 `invalid_action` com a orientação do provedor para tentar novamente mais tarde. Consulta posterior, antes de qualquer novo POST, confirmou `api-sandbox.asaas.com/v3`, cobrança sintética de R$ 10,00, método PIX, `checkoutSession` presente, status `RECEIVED` e nenhum estorno. Um único novo POST foi aceito; readback imediatamente posterior mostrou um estorno de R$ 10,00 em `AWAITING_CRITICAL_ACTION_AUTHORIZATION` e a cobrança ainda em `RECEIVED`. **BLOCKED para estorno terminal até autorização da ação crítica no Sandbox.** Não repetir POST enquanto esse estorno existir. A fixture é a cobrança `pay_hddp2egolrwj07i3`; nenhum dado de cartão, token ou segredo foi documentado.
- **Runner:** após observar a recusa transitória, o cleanup ganhou tentativas limitadas somente para HTTP 400 `invalid_action`. Antes de cada repetição ele relê cobrança e estornos; se algum estorno já existir, não repete o POST. Falha de rede, autenticação e outros códigos continuam sendo propagados. O helper teve 29/29 testes direcionados. `npx vitest run` passou **4.790/4.790 testes em 468 arquivos** (exit 0); `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check` dos arquivos alterados e `git diff --check` passaram (exit 0). `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24 e gerou 18 páginas estáticas (exit 0). A mudança no retry **não foi reexecutada contra um novo pagamento real**; o estorno PIX existente não pode receber novo POST.
- **Readback após intervenção humana:** o usuário informou que concluiu o estorno na interface. A API do Sandbox, porém, mostrou a cobrança PIX ainda `RECEIVED` e o único estorno de R$ 10,00 em `CANCELLED`. O extrato completo da conta Sandbox tinha 12 lançamentos; quatro pertenciam à fixture: `PAYMENT_RECEIVED` +R$ 10,00, `PAYMENT_FEE` −R$ 0,99, `PAYMENT_REVERSAL` −R$ 10,00 e `PAYMENT_REFUND_CANCELLED` +R$ 10,00. Essa sequência é consistente com solicitação revertida, não devolução terminal ao paciente. O objeto do estorno não oferece `cancelReason`, `failureReason` nem `errorCode`; a causa não foi estabelecida. `GET /finance/balance` retornou R$ 67,03 disponíveis, acima dos R$ 10,00 da cobrança, mas esse saldo foi medido **após** o cancelamento e não prova qual era o saldo no instante da tentativa. Pela documentação oficial do Asaas, só `DONE` confirma devolução; `CANCELLED` não deve entrar na conciliação. Não repetir o POST automaticamente enquanto a causa estiver desconhecida. Pagamento/refund Sandbox não exercitaram webhook, banco ou UI Qoro nesta prova.
- **Trava de falso verde descoberta no runner:** o helper local aceitava `CONFIRMED`, `COMPLETED` ou `REFUNDED` como status de um item de estorno, e `payment.status = REFUNDED` como confirmação suficiente, embora a API de estornos do Asaas documente apenas `DONE` como devolução concluída. Cinco assertions novas falharam antes da correção; agora o cleanup exige valor integral somado em itens `DONE` e trata status de cobrança `REFUNDED` sem item `DONE` como espera de readback. Os 33 testes direcionados passaram após a correção; a regressão integral passou **4.794/4.794 testes em 468 arquivos** (exit 0). `npx tsc --noEmit --incremental false`, `npx eslint .`, Prettier dos arquivos alterados e `git diff --check` também passaram (exit 0). `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24, gerou 18 páginas estáticas e terminou com exit 0.
- **Repasse:** decisão aceita para usar o `scheduledAt` do agendamento concluído, inclusive o novo instante após remarcação. Mudança de regra anterior ao horário agendado pode atingir reserva futura, mesmo criada antes da mudança; snapshot concluído não muda. Estorno parcial/perda suspende o repasse automático para revisão humana; os estados conservadores locais existem, mas ação/registro/UI de revisão ainda faltam. Essas decisões não equivalem a E2E ou aceitação da camada 4.

- **Dois webhooks interrompidos no Asaas Sandbox (ASAAS_CHAVE_TESTE_2):** GET /v3/webhooks retornou exatamente duas configurações de cobrança de paciente, ambas enabled=true, interrupted=true, com 12 eventos e destino no mesmo Preview antigo. Os dois endereços responderam GET 405 (rota presente); um POST diagnóstico com token deliberadamente inválido e corpo vazio retornou 404 para cada referência. Na rota do Qoro, 404 ocorre antes da validação do token quando a referência não resolve. Readback do PostgreSQL DEV encontrou uma conta de pagamento ativa, com referência diferente das duas URLs; nenhuma das duas referências interrompidas existe nesse banco. Isso comprova que esses destinos **não conseguem identificar a clínica agora**, e o log do painel confirmou `404` histórico para a primeira fila; o HTTP histórico da segunda segue não verificado, pois logs de entrega estão disponíveis somente no painel Asaas. Não reativar as filas sem corrigir destino/referência; não apontar eventos de uma clínica para outra. Essas filas interrompidas podem impedir conciliação de eventos, mas **não explicam** o status CANCELLED do estorno no próprio provedor. A causa do cancelamento segue desconhecida.

- **Log de entrega recebido do painel (02/10/2026, 07:12 UTC):** para uma das filas da conta `ASAAS_CHAVE_TESTE_2`, o Asaas tentou enviar `PAYMENT_REFUND_DENIED` da cobrança sintética PIX de **01/10**, e o Preview respondeu `404` com corpo `not found`. Um segundo recorte fornecido pelo operador mostra **04:12** no mesmo dia, mesmo ID de evento e mesmo payload; 04:12 em Brasília corresponde a 07:12 UTC. Sem identificação inequívoca da configuração de webhook, esses recortes **não provam duas entregas distintas**. O payload informa `additionalInfo.denialReason = "Falha ao processar a transferência."`; isto é o motivo genérico da negativa **daquela cobrança de 01/10**, não um diagnóstico do estorno de Checkout de **04/10**. Readback independente do pagamento de 01/10: `RECEIVED`, R$ 10, dois estornos `CANCELLED`, nenhum comprovante. O `404` é falha de entrega posterior à decisão financeira do Asaas, não causa comprovada do cancelamento. A segunda fila também respondeu `404` em probe atual, mas seu log histórico específico ainda não foi identificado.
- **Causa de criação de órfãos no E2E:** `e2e/payments-account-lifecycle.spec.ts` removia a clínica isolada e o usuário Auth no teardown sem remover o webhook cadastrado no Asaas Sandbox. Agora o teardown procura exclusivamente a ref da fixture em hosts Preview Vercel, remove somente os recursos correspondentes, exige `deleted=true` e `GET 404` por ID antes de apagar a clínica. Falha de listagem, remoção ou readback interrompe o cleanup e preserva a fixture para investigação. Cinco testes direcionados passaram; a regressão integral passou **4.799/4.799 em 469 arquivos**. TypeScript, ESLint dos arquivos alterados, Prettier, `git diff --check` e build Next 15.5.24 passaram. O Playwright local executou contra o Preview isolado `project-os-git-integration-estad-04a442-...`: **2/2 PASS**, incluindo conexão, persistência, desconexão e teardown. Readback independente: a conta Sandbox voltou a ter exatamente os dois webhooks antigos (nenhum terceiro da fixture) e o DEV tinha zero clínicas com slug `e2e-payments-%`. Esta prova valida o cleanup do runner local contra um Preview anterior; **não** valida webhook financeiro da política nova, nem reativa as duas filas antigas. As duas configurações antigas foram preservadas: não reativar nem excluir eventos pendentes até concluir a análise do histórico e decidir o destino seguro.
- **Risco residual no produto, distinto do runner:** `disconnectPaymentAccount()` chama `deactivatePaymentAccount()`, que apaga localmente a credencial e o token do webhook, mas não desativa nem remove o recurso no Asaas. Portanto, uma desconexão normal pode deixar o provedor entregando eventos a uma referência que o Qoro já não aceita. A correção do teardown E2E não altera esse comportamento. Antes de corrigir o fluxo de produto, definir a política para eventos pendentes e falha do provedor durante a desconexão; não apagar as duas configurações antigas automaticamente.

### Pendências Asaas por fixture e por camada — leitura de 04/10/2026

| Cenário | Última prova identificada | O que falta para PASS integral |
| --- | --- | --- |
| D50, estorno parcial de excedente do restante | Readback documentado em 07/09: cobrança `CONFIRMED`, refund único `PENDING`, intenção local `confirmation_pending`. Não é um refund cancelado. | Novo readback sem POST; observar `DONE` ou falha terminal, projetar ledger/estado pelo reconciliador, replay e cleanup exato. |
| D77/D80, estorno do sinal PIX | Readback documentado em 06/09: cobrança `RECEIVED`, refund `CANCELLED`; duas provas pós-rollout terminaram sem devolução. | Diagnóstico do Asaas antes de nova fixture; obter refund `DONE` e provar `refund → patient_charge → crédito → Caixa` por webhook/readback, sem retry cego. |
| Refund PIX genérico de 01/10 (`pay_6j64ee4ek6knln67`) | Readback de 04/10: `RECEIVED`, dois refunds `CANCELLED`; evento `PAYMENT_REFUND_DENIED` informou falha ao processar a transferência. Uma entrega histórica recebeu `404`. | Diagnóstico do provedor para a negativa; webhook saudável e conciliação real; não criar terceiro POST para esta fixture. |
| Checkout PIX hospedado de 04/10 (`pay_hddp2egolrwj07i3`) | Pagamento `RECEIVED`, refund único `CANCELLED`; motivo não aparece no objeto do refund. | Diagnóstico do Asaas e refund terminal `DONE` em fixture segura; depois webhook, banco, Caixa e UI Qoro. Não atribuir a este caso a razão do evento de 01/10. |
| Cartão hospedado de 04/10 | Pagamento e estorno terminal no Sandbox confirmados pelo runner; nenhuma prova de webhook, banco ou UI Qoro nesta execução. | Jornada Qoro completa: autorização, checkout, webhook, reconciliação, Caixa e estado final. |
| Nova política financeira, camadas 2–5 | Migrations/fixtures DEV e testes locais; Checkout isolado no Sandbox, sem atravessar a política nova em Preview. | PIX/cartão com preço de catálogo e sinal configurado, bruto/tarifa/líquido reais, webhook e replay, repasse, Caixa, IA → link, correção tardia de tarifa e antecipação com fato autoritativo. |
| Dois webhooks antigos interrompidos | Ambas as refs ausentes do DEV e da produção; dois registros Sandbox desativados por API em 05/10, com readback `enabled=false`. | Não reativar filas sem destino e identidade válidos; examinar eventos pendentes no painel antes de qualquer descarte definitivo. |

`scripts/asaas-refund-e2e.ts` ainda contém uma lista local de estados terminais mais ampla que o contrato documentado do Asaas; o caminho principal usa `classifyCheckoutCleanup`, que exige `DONE`, mas o check posterior de repetição usa essa lista ampla. Harmonizar o runner e cobrir a classificação antes de usar seu resumo como prova final de refund.

### 04/10/2026 — auditoria da autorização do estorno PIX

- **Fato observado:** o código informado no painel foi aceito, mas as provas D80, o PIX genérico de 01/10 e o Checkout PIX de 04/10 terminaram com item de estorno `CANCELLED`, cobrança ainda `RECEIVED` e lançamento `PAYMENT_REFUND_CANCELLED` devolvendo o débito à conta. O Asaas não devolveu o dinheiro ao pagador nessas provas. O `invalid_action` inicial do Checkout foi anterior ao POST posteriormente aceito; não explica o cancelamento terminal.
- **Duas autorizações diferentes:** a confirmação de ação crítica no painel não conclui a operação. A configuração opcional **Ativar autorização de saque para estornos Pix** acrescenta um webhook especial `PIX_REFUND`, distinto do webhook normal de eventos de cobranças. Se estiver ligada, o Asaas exige resposta `{"status":"APPROVED"}`; três falhas ou resposta inválida cancelam a operação. Em 04/10, o operador verificou na conta Sandbox usada neste diagnóstico que **a opção está desligada**. Assim, esse mecanismo não explica os cancelamentos da conta `ASAAS_CHAVE_TESTE_2`; a informação é leitura do painel pelo operador, não readback de configuração por API. O Qoro hoje não implementa esse webhook especial. Não ativar essa opção apontando para `/api/webhooks/asaas/patient/[ref]`, que não responde com esse contrato. A conta D80 anterior é outra e não foi reavaliada por esta leitura.
- **Webhook 404 não é a origem comprovada:** o evento `PAYMENT_REFUND_DENIED` da cobrança PIX de 01/10 recebeu 404 em um Preview órfão **depois** da negativa. Isso impede a entrega daquele evento ao Qoro, mas não pode, por sua ordem temporal, explicar por que o Asaas negou a transferência. A documentação de eventos do Asaas diz que esse evento só existe para boleto, enquanto o payload observado era PIX; pedir esclarecimento formal ao suporte sobre essa divergência.
- **Falha de conciliação encontrada e corrigida localmente:** `confirmRefundIntentFromReadback` aceitava `payment.status=REFUNDED` mesmo com item `PENDING`, e aceitava item identificado `DONE` com valor menor que o pedido. Dois testes reproduziram o falso `confirmed` antes da correção. Agora só um item identificado `DONE` de valor suficiente ou, quando a API não fornece ID do item, aumento suficiente do total `DONE` sobre o baseline confirma a intenção. Um item identificado `PENDING` não é substituído por outro `DONE`. Isso impede falso sucesso, mas **não resolve o cancelamento do Asaas** nem prova devolução PIX real.
- **Risco residual de correlação:** o `POST /refund` retorna o ID da cobrança, não um ID confiável do item de estorno. Quando o item não tem ID, o Qoro usa a diferença do total `DONE` sobre o baseline. Um estorno concorrente externo do mesmo valor poderia ser atribuído à intenção errada. Antes de liberar estorno automático com dinheiro real, definir e comprovar uma correlação por operação ou uma revisão humana segura para o caso sem ID; não declarar essa lacuna fechada pelos testes unitários.
- **Readback somente leitura após a verificação do painel:** `GET /payments/{id}`, `GET /payments/{id}/refunds`, `GET /pix/transactions/{id}`, listagem paginada `GET /pix/transactions?type=CREDIT_REFUND` e `GET /financialTransactions` na conta `ASAAS_CHAVE_TESTE_2` retornaram HTTP 200. Os dois PIX originais estão `DONE`, `canBeRefunded=true`, `refundedValue=0`, sem `refundDisabledReason`; ambos registram ISPB 19540550 (Asaas) como instituição de origem. A cobrança de 01/10 permanece `RECEIVED` com dois refunds `CANCELLED`; a de 04/10 permanece `RECEIVED` com um refund `CANCELLED`. As três transações de devolução são `CREDIT_REFUND/REFUSED`, cada uma com `refusalReason="Falha ao processar a transferência."`. O `refundDisabledReason` exibido nas **transações de devolução** diz que uma transação desse tipo não pode ser estornada; ele não é a causa da recusa do estorno da cobrança original. O saldo contábil do extrato era R$ 58,02 antes de cada tentativa de 01/10 e R$ 67,03 antes da tentativa de 04/10; cada tentativa gerou débito de R$ 10 seguido de crédito de cancelamento de R$ 10. O saldo contábil torna insuficiência simples improvável, mas não revela eventuais reservas/bloqueios operacionais. A origem Asaas pode refletir a simulação do Sandbox, mas isso ainda não é conclusão causal. A fixture direta de 04/10 não passou pelo código ou webhook do Qoro; a recusa ocorreu no processamento do provedor depois de aceitar o POST.
- **Gate de produção:** não promover a nova política financeira ou afirmar refund PIX pronto. A opção `PIX_REFUND` desligada elimina a hipótese do webhook especial **nesta conta**; faltam o diagnóstico interno do Asaas para `CREDIT_REFUND/REFUSED` e a confirmação de eventuais bloqueios operacionais no instante do pedido. Depois, repetir **uma** fixture isolada no Sandbox, exigir `DONE`, readback, webhook 2xx, banco, crédito e Caixa coerentes. Não repetir POST nas cobranças já estornadas/canceladas nem reativar webhooks órfãos sem destino válido.
- **Validação local desta correção:** os dois novos casos negativos reprovaram antes da mudança (`received: confirmed`, esperado `pending`); depois, os testes focados passaram 55/55 em três arquivos e a suíte integral passou 4.801/4.801 em 469 arquivos. `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, `git diff --check` e o build Next otimizado com ambiente sintético (`npx tsx scripts/security/local-build.ts`, 18 páginas estáticas) passaram com exit 0. Não houve novo POST de refund nem validação externa nesta correção.

Fontes oficiais: [ações críticas](https://docs.asaas.com/docs/como-testar-a%C3%A7%C3%B5es-cr%C3%ADticas), [validação de saques por webhook](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks), [estornos](https://docs.asaas.com/docs/estornos), [listar estornos](https://docs.asaas.com/reference/listar-estornos-de-uma-cobranca) e [eventos de cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas).

### 04/10/2026 — decisão de produto: devolução assistida pela clínica

O dono da clínica decide e executa o estorno na própria conta Asaas, em contato com o paciente. O Qoro **não solicita novos estornos automaticamente** no fechamento de sinal pago ou de valor excedente. O cancelamento dentro da janela, a ausência do médico, o falecimento/exclusão do paciente e o reagendamento continuam gerando obrigação de devolução; a decisão não transforma esses valores em receita da clínica. O Qoro registra a pendência, mantém a cobrança como paga enquanto não houver prova de devolução e a mostra no Caixa com paciente, valor, tipo (sinal ou excedente) e ID da cobrança Asaas. A causa específica do cancelamento ainda não é exibida nessa fila. A clínica deve verificar se já existe estorno em andamento **antes** de iniciar outro no painel. Só um item `DONE` de valor suficiente autoriza a projeção `refunded`; `PENDING`, autorização por código, HTTP 200 e `CANCELLED` não a autorizam.

**Implementação local:** `charge-closeout.ts` passa a registrar a obrigação pelo caminho `queueManualDepositRefund`; o handler de excedente usa `queueManualExcessRefund`. Ambos persistem uma intenção idempotente sem chamar `POST /refund`, leem o baseline antes da ação da clínica e mantêm o reconciliador por webhook/cron. Se a conta estava desconectada, a pendência permanece visível; após reconexão, o cron prepara o baseline. Se a leitura inicial do Asaas falha, a intenção fica `pending` com `provider_readback_unavailable`, aparece no Caixa com aviso para conferir o painel antes de qualquer devolução e continua elegível ao cron; uma nova leitura bem-sucedida grava o baseline e troca o aviso pela ação manual. Uma tentativa manual `CANCELLED` continua visível e pode convergir depois que uma nova tentativa manual gerar `DONE`, sem POST automático do Qoro. O Caixa carrega a fila mesmo fora do dia corrente e mostra as tentativas antigas que falharam. `payment.status=REFUNDED` isolado não fecha mais o sinal: é necessário conferir o total de itens `DONE`. Mesmo quando o fechamento encontra `DONE` suficiente, ele cria ou recupera a intenção e deixa a reconciliação decidir o fechamento; um refund identificado ainda `PENDING` não é substituído por outro `DONE` externo. O runner `asaas-refund-e2e.ts` também passou a contar somente `DONE` na verificação de repetição.

**Operação da clínica:** abrir Caixa → “devoluções que exigem ação da clínica”; localizar a cobrança indicada na conta Asaas da própria clínica; conferir se há devolução em andamento ou concluída; solicitar a devolução quando devida; acompanhar o resultado e informar o paciente. Se o Asaas responder `CANCELLED`, o valor **não** foi devolvido: a clínica deve tratar a pendência com o provedor e o paciente. Se a devolução ocorrer fora do Asaas, o Qoro não pode conciliá-la automaticamente como refund do provider; não usar a baixa/estorno contábil do Caixa como prova de transferência ao paciente.

**Validação desta alteração, somente local:** após remover as duas funções de POST automático e seus seis testes exclusivos, e acrescentar cenários de falha de readback e fechamento conservador, `npx vitest run` passou 4.814/4.814 em 469 arquivos, exit 0. `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, `npx tsx scripts/security/inventory.ts --check`, `npx tsx scripts/check-migration-safety.ts` e `git diff --check` passaram. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24 e gerou 18 páginas estáticas, exit 0 após o último ajuste de código. Os testes dirigidos cobrem reentrega sem POST, conta desconectada, falha e recuperação do readback, `CANCELLED → DONE`, `PENDING` sem falso fechamento, valores parciais, escopo de tenant da fila, renderização no Caixa e a reconciliação obrigatória antes de fechar um pagamento `REFUNDED`. Nenhum POST real de refund, migration nova, deploy, alteração no Asaas ou mudança no banco de produção ocorreu nesta rodada.

**Ainda não aprovado para produção:** não houve E2E de uma clínica executando devolução real no Asaas → webhook/readback → Caixa; a correlação por aumento do total `DONE` continua ambígua se ocorrer outro estorno externo simultâneo do mesmo pagamento e valor. Uma cobrança paga sem `provider_payment_id` agora fica sinalizada e visível no Caixa para investigação, sem instruir a clínica a estornar sem identificar a cobrança. Intenções legadas de **sinal integral** com tentativa `failed` voltam à varredura e podem convergir quando o total `DONE` atingir o valor inteiro do sinal; excedentes legados falhos continuam exigindo revisão, pois outro estorno do mesmo pagamento não identifica qual obrigação foi quitada. O Sandbox PIX continua com `CREDIT_REFUND/REFUSED` sem causa confirmada pelo Asaas. Não promover 0108/0109 nem anunciar estorno automático ou devolução garantida enquanto essas provas faltarem.

### 04/10/2026 — prova DEV da devolução assistida e lacunas remanescentes

O E2E específico `e2e/manual-refund-dev.spec.ts` usa app local, Auth e Postgres **DEV** com clínica, assinatura Pro, usuário e cobranças sintéticas isoladas. A fixture recusa banco/Auth de projetos diferentes e alvo HTTP fora de localhost. Nenhum POST de estorno é enviado ao Asaas; os itens de readback `PENDING`, `CANCELLED` e `DONE` são fornecidos pelo teste ao reconciliador real. O teste verifica a fila no navegador `/caixa`, a cobrança paga sem ID do provedor, isolamento por tenant, transição `CANCELLED → DONE`, a intenção legada `failed → confirmed` após devolução integral, replay sem evento duplicado e redução da fila. O `afterAll` remove clínica/usuário de teste e confere ausência por readback. Esta é prova integrada **do Qoro em DEV**, não prova de estorno externo.

Na primeira execução o E2E falhou por texto de plural incorreto (“devoluçãoões”); a UI foi corrigida e o teste passou duas vezes após a correção. O smoke de banco `scripts/smoke-patient-money-adjustments-db.ts` passou 7/7 e fez cleanup. Os testes focados de Payments/Caixa passaram 108/108 depois da atualização das expectativas da UI. A compilação TypeScript e a formatação dos arquivos tocados passaram neste checkpoint. A regressão integral e o build final devem ser registrados apenas após a execução desta rodada.

**Pendências para aceitação:** (1) devolução real feita por uma clínica no Asaas Sandbox com item terminal `DONE`, webhook/readback e Caixa Qoro; (2) causa da recusa `CREDIT_REFUND/REFUSED` no PIX Sandbox; (3) correlação inequívoca de estornos parciais/concorrentes de excedente, inclusive legado; (4) tratamento seguro de webhooks na desconexão normal de conta ativa e decisão sobre os eventos pendentes nas duas filas antigas, agora desativadas; (5) validação funcional das camadas 2–5, incluindo revisão humana do repasse e fatos econômicos reais. Nenhuma dessas pendências é convertida em PASS pelo E2E sintético.

**Regressão final desta rodada:** `npx vitest run` 4.818/4.818 em 469 arquivos, exit 0; `npx eslint .`, `npx prettier --check .` e `npx tsc --noEmit --incremental false`, todos exit 0. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24, validou tipos e gerou 18 páginas estáticas, exit 0. O E2E `e2e/manual-refund-dev.spec.ts` passou novamente 1/1 após a última alteração de cleanup, com readback de ausência da clínica, das intenções, do profile e do usuário Auth. Não houve migration, deploy, escrita em produção nem chamada de estorno ao Asaas nesta rodada.

**Outras provas DEV reexecutadas neste estado:** `scripts/smoke-appointment-pricing-guard-db.ts` passou no plano Pro: INSERT direto incompatível recusado, remarcação histórica e preço por método aceitos, rollback sem resíduos. `scripts/smoke-patient-checkout-db.ts` passou 7/7 com clínicas sintéticas: claim/geração idempotentes, tenant isolado, leitura de sinal da IA, quarentena de divergência, dedup de crédito, evento econômico legado e cleanup sem resíduos. Esses smokes não chamam Asaas/Meta; o segundo entrega eventos ao handler transacional da fixture, não executa o worker global do outbox. `scripts/smoke-payments-journey.ts` não foi reexecutado nesta rodada porque seu `runOutboxOnce` varre o outbox DEV global e pode processar eventos de outras clínicas; essa precondição precisa de isolamento antes de usá-lo como prova segura.

Após a suíte integral, a consulta da fila recebeu um ajuste pequeno para preservar a ordenação cronológica que existia antes do `UNION ALL`. Nesse estado final, os testes dirigidos de Payments/Caixa passaram 99/99, TypeScript e Prettier passaram, o E2E de navegador passou 1/1 novamente, e o build otimizado concluiu com exit 0 e 18 páginas estáticas. A suíte integral de 4.818 testes foi executada antes desse último ajuste; não a confundir com uma segunda execução integral posterior.

### 05/10/2026 — filas órfãs do Sandbox e token do webhook

`GET /v3/webhooks` na conta `ASAAS_CHAVE_TESTE_2` retornou exatamente dois registros, sufixos de ID `611c` e `0ddd`, ambos `enabled=true`, `interrupted=true` e apontando para o Preview antigo. Consultas somente de leitura confirmaram que as duas referências não existem em `clinic_payment_accounts` nem no banco DEV nem no banco de produção. Após conferir nome, host, pathname e estado, `PUT /v3/webhooks/{id}` com **apenas** `enabled:false` desativou os dois. Novo GET confirmou `enabled=false`, `interrupted=true` nos dois; eles não foram excluídos, e a fila não foi reativada. A [documentação oficial do Asaas](https://docs.asaas.com/reference/atualizar-webhook-existente) confirma que o PUT aceita alteração parcial e que `interrupted:false` reenvia eventos pendentes. Não fazer esse reenvio enquanto não houver destino seguro e identidade de tenant recuperável. Isso resolve os dois endpoints órfãos desta conta Sandbox, mas não corrige a desconexão normal do produto, que ainda pode criar novos órfãos.

Readback independente, somente GET, das cobranças PIX `pay_hddp2egolrwj07i3` e `pay_6j64ee4ek6knln67` confirmou `payment.status=RECEIVED` em ambas; a primeira tem um refund `CANCELLED`, a segunda tem dois `CANCELLED`, e nenhuma tem item `DONE`. Portanto, a devolução terminal PIX continua **BLOCKED** e não houve novo POST de estorno nesta investigação.

Na geração do token para webhook, o regex continha um caractere de controle em vez da referência ao caractere anterior. Assim, a regra de repetição não era aplicada. A [regra atual de complexidade do Asaas](https://docs.asaas.com/changelog/valida%C3%A7%C3%A3o-de-complexidade-em-tokens-de-webhook) rejeita quatro letras repetidas e sequências numéricas simples. O gerador agora rejeita quatro caracteres iguais ou cinco dígitos consecutivos; teste dirigido força as duas amostras inválidas antes da válida e passou 18/18. A mudança permanece local, sem deploy. Não há evidência de que esse defeito tenha causado os dois 404: nesses casos a referência deixou de existir no banco antes da validação do token.

O E2E `e2e/manual-refund-dev.spec.ts` foi repetido nesta versão. A primeira invocação falhou **antes das assertions financeiras** porque faltava `NODE_OPTIONS=--conditions=react-server` ao importar `server-only` no processo Playwright; o cleanup da fixture deixou `clinics=0` e `auth.users=0` com os prefixos de teste. Com a condição correta, a jornada DEV passou **1/1 em 2,2 min**: Caixa, `CANCELLED → DONE`, replay e isolamento entre tenants. Novo readback após cleanup: `clinics=0`, `auth.users=0`. O readback do provedor é sintético neste spec e não transforma os refunds PIX externos `CANCELLED` em `DONE`.

**Regressão após essas alterações, em 05/10:** `npx vitest run` passou **4.829/4.829 em 469 arquivos**, exit 0. TypeScript, ESLint global, Prettier, inventário de segurança, checagem das migrations e `git diff --check` passaram. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24, validou tipos e gerou 18 páginas estáticas, exit 0. Esses gates provam consistência local; ainda não há Preview HTTPS com este diff, readback econômico real do Asaas no Caixa, refund PIX `DONE` ou correção tardia de tarifa. A situação dos dois webhooks desativados permanece como no readback acima.

### 05/10/2026 — Checkout e conta Asaas no Preview atual

- Base publicada: `41cc9704`, PR #26 em draft; CI `37264076373` concluiu com sucesso, incluindo typecheck, lint, testes, build e E2E público. O Preview HTTPS isolado usou Auth/Postgres DEV e Asaas Sandbox; nenhum dado de produção foi alterado.
- `e2e/signup-confirmation.spec.ts`, cenário `checkout recorrente`, passou **1/1** com zero retry no Preview. O navegador chegou ao Checkout hospedado do Sandbox e exibiu “Informações da assinatura”; o readback DEV encontrou `billing_attempt_state=checkout_pending`, ID/URL do Checkout presentes e customer/subscription ainda ausentes. A primeira tentativa falhou por uma expectativa desatualizada do **teste**: o Asaas serve `/000/checkoutSession/show/...`, enquanto o matcher exigia `/checkoutSession/show/...`. O matcher agora mantém HTTPS e host Sandbox exatos e aceita o segmento numérico opcional. A fixture e o lock foram removidos no teardown. Isto comprova abertura e persistência do Checkout, **não** pagamento, webhook, assinatura ativa ou dashboard.
- `e2e/payments-account-lifecycle.spec.ts`, fixture isolada no mesmo Preview, passou **2/2 em 45,3 s**, zero retry. A chave inválida foi recusada com mensagem específica, apagada do campo e ausente do HTML, sem mudar o estado da conta. A segunda prova conectou a conta Sandbox da clínica, conferiu persistência após reload e desconectou; o teardown removeu somente o webhook da referência da fixture, exigiu `deleted=true` e GET 404 antes de apagar clínica e usuário Auth DEV, e confirmou ausência da fixture no banco. Uma tentativa anterior falhou **no teste**: o seletor confundia três alertas informativos da nova política financeira com o alerta de chave recusada. A asserção passou a exigir a mensagem de recusa do contrato de domínio; o produto não foi alterado para acomodar o teste.
- Estes PASS não cobrem pagamento PIX/cartão até estado final, entrega de webhook, reconciliação de crédito/tarifa, Caixa nem repasse profissional. A desconexão **normal** do produto ainda pode deixar webhook remoto ativo; o cleanup restrito da fixture E2E não corrige essa lacuna.

### 05/10/2026 — prova funcional dos planos no mesmo Preview

O E2E da conta foi ampliado na fixture descartável com um procedimento sintético. No Pro, a tentativa de ativar preço por meio sem preço cadastrado foi recusada sem criar política; depois o navegador salvou PIX a R$ 240, cartão 1x a R$ 260, ativou o modo explícito e escolheu base líquida para repasse. Após reload, a UI conservou as escolhas e o PostgreSQL DEV confirmou os dois preços ativos, a política `payment_method_pricing` e a base `net`.

O teste então mudou **somente a assinatura da fixture** para Solo. A sessão antiga foi recusada após o trigger de `claims_version`; a rota real `/auth/session-refresh` emitiu claims atualizadas. A UI Solo ocultou as configurações avançadas e o replay direto da Server Action capturada no Pro retornou a recusa do backend. Ao trocar a mesma fixture para Clínica e renovar as claims, os controles e valores persistidos reapareceram. Esta prova não usa outro tenant nem altera plano de uma clínica real.

Houve duas falhas de teste antes do PASS final: o Playwright tentou clicar no input de rádio visualmente oculto, enquanto o clique real é no label; e uma execução conjunta excedeu o limite legítimo de **10 logins/IP em 15 minutos** do Preview. O spec passou a clicar no texto do card, guardar cookies somente em memória da fixture entre casos e usar a rota normal de refresh após mudança de plano. Nenhum limitador foi desativado nem houve bypass de desenvolvimento. A execução final conjunta `e2e/payments-account-lifecycle.spec.ts` passou **3/3 em 1,7 min**, zero retry; readback independente posterior encontrou `clinics=0` e `auth.users=0` para os prefixos da fixture.

As provas transacionais `scripts/smoke-appointment-pricing-guard-db.ts` e `scripts/smoke-patient-checkout-db.ts` foram reexecutadas no mesmo DEV, ambas **exit 0**. A primeira recusou INSERT incompatível, aceitou remarcação e preço por método e fez rollback sem resíduos; a segunda passou **7/7**, incluindo isolamento entre tenants, claim idempotente, dedup de crédito, evento econômico legado e cleanup. O segundo smoke usa resposta de provider sintética e entrega eventos ao handler da fixture, não ao worker global; não comprova dinheiro ou webhook externo.

### 05/10/2026 — leitura econômica no Caixa Solo, Preview

No mesmo Preview HTTPS, `e2e/payments-account-lifecycle.spec.ts` foi ampliado para **4/4 PASS em 2,1 min**, sem retry. A quarta prova criou uma fixture financeira descartável no PostgreSQL DEV, com dois fatos de cobrança para um atendimento: sinal de R$ 50,00 com tarifa R$ 1,00 e líquido R$ 49,00; restante de R$ 100,00 inicialmente sem tarifa/líquido. Depois de trocar **somente** a assinatura da fixture para Solo e renovar a sessão pela rota real, o navegador abriu `/caixa`. A UI mostrou R$ 150,00 recebidos/alocados, tarifa e líquido agregados como “Não informado”, e cada cobrança em separado com seus fatos conhecidos. Não exibiu repasse profissional no Solo. Após atualizar apenas a segunda cobrança e crédito da fixture para tarifa R$ 2,00 e líquido R$ 98,00, um reload mostrou tarifa alocada R$ 3,00 e líquido alocado R$ 147,00. O readback independente após teardown encontrou `clinics=0` e `auth.users=0` para os prefixos de teste.

Os fatos financeiros deste quarto cenário foram **sintéticos**; a execução exercita a consulta sob o tenant da fixture, a composição visual, a ausência de zero inventado e a persistência após reload. Não testa leitura cross-tenant nem prova que o Asaas informou esses números, que o webhook/worker os conciliou, que o pagamento foi liquidado ou que um repasse foi efetuado. A primeira execução falhou na fixture por usar o enum inexistente `concluido` em vez de `atendido`; a seguinte falhou por clicar no `<details>` antes da hidratação; a primeira execução conjunta falhou porque a troca de plano invalidou uma sessão que o próprio teste tentou reutilizar. Corrigidos o enum, a espera de hidratação e a ordem autenticação → downgrade → refresh, a execução conjunta passou 4/4. TypeScript, ESLint do spec, Prettier e `git diff --check` passaram localmente. A CI do commit `1b506bd8` passou no run `37305569718`, assim como o deploy Preview, Semgrep e Snyk.

### 05/10/2026 — regra temporal do repasse no PostgreSQL DEV

`scripts/smoke-professional-payout-date-db.ts` executou com `npx tsx` e `NODE_OPTIONS=--conditions=react-server`, carregando apenas em memória as variáveis DEV já existentes. O script recusaria banco ou Auth fora do projeto DEV, criou um médico Auth sintético e montou clínica, assinatura Pro, paciente, procedimento, agendamentos e duas versões de regra/base numa transação que terminou em rollback. **PASS, exit 0:** um atendimento agendado antes da alteração e concluído tardiamente produziu snapshot de 50% sobre `gross` de R$ 150,00, isto é, R$ 75,00; o atendimento remarcado para depois da alteração selecionou regra de 30% sobre `net` e ficou em `pending_economics` sem inventar líquido; replay não criou segundo snapshot. O readback encontrou zero clínica, payout, regra ou agendamento da fixture, e o usuário Auth foi removido e retornou 404.

As duas primeiras tentativas falharam **na fixture**: SQL bruto recebia `Date` diretamente (`ERR_INVALID_ARG_TYPE`). A conversão para ISO-8601 corrigiu o parâmetro preservando o instante; não houve mudança na função do produto. `appointment-completed.test.ts` já cobre que o handler passa o horário agendado ao snapshot. Esta prova chama o serviço real com PostgreSQL DEV, mas não executa o clique de conclusão na UI, o outbox global, pagamento Asaas, webhook ou repasse efetivamente transferido.

Validação desta alteração: cinco arquivos de teste financeiro, **42/42 PASS**; suíte Vitest integral, **4.829/4.829 em 469 arquivos**, exit 0; `npx tsc --noEmit`, `npx eslint .`, Prettier dos arquivos alterados e `git diff --check`, todos exit 0. `npx tsx scripts/security/local-build.ts` compilou o Next 15.5.24, verificou tipos e gerou 18 páginas estáticas, exit 0. Essas verificações não substituem as provas externas ainda abertas.

### 05/10/2026 — Caixa Pro e repasse NET no Preview

`e2e/payments-account-lifecycle.spec.ts` passou **5/5 em 2,7 min**, zero retry, no Preview HTTPS com Auth/PostgreSQL DEV e conta Asaas Sandbox da fixture. O quinto cenário retornou a assinatura sintética ao Pro, criou um médico Auth DEV distinto, gravou um atendimento com preço PIX vigente de R$ 240,00 e fatos econômicos sintéticos de tarifa R$ 4,00 e líquido R$ 236,00. O navegador abriu `/caixa`, exibiu esses três valores, a base **Líquido** e o repasse profissional de **R$ 70,80**; o readback do banco encontrou `status=calculated` e `payout_amount=70.80`. O teardown removeu a clínica e os dois usuários Auth sintéticos, conferindo GET 404 para ambos. TypeScript e ESLint do spec passaram.

Esse caso prova consulta tenant-scoped e apresentação persistida no Pro, complementando o cenário Solo. **Não** prova que o Asaas informou esses números nem que o handler calculou esse snapshot: ambos foram inseridos pela fixture. O smoke transacional anterior testa a seleção real de regra/base pelo serviço. Permanecem pendentes o caminho completo pagamento → webhook → reconciliação → Caixa/repasse, a revisão humana após reversão e a correção auditável de tarifa tardia.

### 05/10/2026 — histórico do repasse suspenso após reversão

Antes de limpar o valor de um repasse `calculated` por perda ou estorno, `refreshProfessionalPayout` agora grava na **mesma transação** um `audit_events` com base, valor calculado, tarifa, líquido, instante do cálculo e motivo da suspensão. O lock do repasse e o teste de transição `calculated → suspenso` evitam outra linha no replay; se a auditoria falhar, a suspensão falha junto, sem gravar a alteração sem rastro. A linha de auditoria preserva o valor anterior, mas **não** constitui autorização para pagar nem substitui o fluxo de decisão humana ainda ausente.

Prova dirigida: `professional-payout.test.ts` **14/14 PASS**, incluindo replay e falha da auditoria. `smoke-professional-payout-date-db.ts` no PostgreSQL/Auth DEV reproduziu uma perda sintética após um repasse GROSS de R$ 75,00, conferiu uma única linha de auditoria com o valor original e estado `cancelled`, repetiu o refresh, reverteu toda a transação e confirmou zero resíduo de clínica, repasse, regra, agendamento e auditoria; o usuário Auth sintético foi removido. O smoke terminou **PASS, exit 0**. Regressão local deste diff: `npx vitest run` **4.831/4.831 em 469 arquivos**, `npx tsc --noEmit --incremental false`, `npx eslint .`, Prettier dos arquivos alterados, inventário de segurança e build Next 15.5.24 com 18 páginas estáticas, todos **exit 0**. A CI da auditoria no commit `c336bb99` passou integralmente no run `37332785126`; a suspensão persistente descrita a seguir exige sua própria regressão e CI.

### 05/10/2026 — suspensão persistente de GROSS e NET

Após reversão explícita, `refreshProfessionalPayout` põe os dois tipos de repasse em `cancelled` e não os recalcula automaticamente em leituras futuras, mesmo quando o marcador de perda muda para `reversed`. `pending_economics` continua significando somente ausência dos fatos necessários para calcular NET. O Caixa Pro/Clínica mostra “Suspenso” e orienta a revisão do valor devido antes de pagar o profissional; Solo continua sem seção de repasse. O registro de auditoria anterior permanece para o primeiro cálculo que chegou a existir.

Validação dirigida: `professional-payout.test.ts` **15/15**, `caixa-view.test.tsx` **25/25**, ambos exit 0. O smoke PostgreSQL/Auth DEV atualizou o marcador de perda após suspender GROSS e NET, repetiu o refresh, conferiu que ambos continuaram `cancelled` sem valor a pagar, manteve uma única auditoria do cálculo original GROSS de R$ 75,00 e terminou com rollback/readback zero e remoção do usuário Auth, **exit 0**. A regressão local desta alteração passou com **4.833/4.833 testes em 469 arquivos**, TypeScript, ESLint, Prettier, inventário de segurança e build Next 15.5.24 com 18 páginas estáticas, todos **exit 0**. No Preview HTTPS com PostgreSQL/Auth DEV e fixture isolada, `npx playwright test e2e/payments-account-lifecycle.spec.ts --project=chromium --workers=1` passou **5/5 em 2,6 min**, sem retry: o quinto cenário confirmou o repasse NET de R$ 70,80, persistiu a suspensão sintética, recarregou o Caixa e leu “Suspenso” e a orientação de revisão; o teardown conferiu ausência de clínica e usuários Auth da fixture. Não houve transferência ao médico nem revisão humana; a ação autorizada para registrar essa decisão ainda precisa ser implementada. Estes testes não substituem estorno/webhook reais do Asaas.

### 05/10/2026 — readback pontual dos estornos PIX no Sandbox

Com a chave de teste autorizada e sem nova mutação, `GET /v3/payments/{id}/refunds` retornou um estorno `CANCELLED` para a cobrança com sufixo `wj07i3` e dois `CANCELLED` para a cobrança com sufixo `knln67`; **zero `DONE`** nos dois casos. O `GET /v3/payments/{id}` retornou `RECEIVED` e não trouxe a lista de estornos nesta leitura, portanto não serve como prova terminal isolada. A [referência oficial do Asaas](https://docs.asaas.com/reference/listar-estornos-de-uma-cobranca) define `DONE` como condição de devolução concluída e recomenda webhook para acompanhar mudanças. A aprovação da ação crítica no painel e o HTTP 200 de uma solicitação anterior não alteram esse resultado observado. Não houve novo POST, pagamento, estorno ou escrita em produção.

### 06/10/2026 — diagnóstico independente dos refunds PIX no extrato Sandbox

Somente GET, com a mesma conta `ASAAS_CHAVE_TESTE_2`: `/payments/{id}` confirmou as duas cobranças `RECEIVED` de R$ 10,00, `netValue` R$ 9,01 e transações Pix originais `CREDIT/DONE`, ambas com `canBeRefunded=true` e EndToEnd ID presente. `/payments/{id}/refunds` manteve uma e duas tentativas `CANCELLED`, respectivamente, sem `effectiveDate` e sem `DONE`. `/pix/transactions?type=CREDIT_REFUND` encontrou as três tentativas correspondentes em `REFUSED`, todas com `refusalReason="Falha ao processar a transferência."`. O extrato `/financialTransactions` paginado, com `hasMore=false` nos dias consultados, mostrou para cada pagamento `PAYMENT_RECEIVED +10`, `PAYMENT_FEE -0,99`, `PAYMENT_REVERSAL -10` por tentativa e `PAYMENT_REFUND_CANCELLED +10` por tentativa. Portanto o saldo foi restituído à conta após cada tentativa frustrada; nenhum Pix saiu comprovadamente ao paciente. A causa operacional específica da recusa **não consta nos recursos consultados**. Não atribuir a culpa a saldo, autorização por código, webhook do Qoro ou à configuração de validação de saque sem prova adicional. A [referência de transações Pix](https://docs.asaas.com/reference/listar-transacoes), a [referência do extrato](https://docs.asaas.com/reference/retrieve-extract) e a [referência de estorno](https://docs.asaas.com/reference/estornar-cobranca) sustentam a leitura desses estados; a última esclarece que taxa de cobrança não é devolvida no estorno e que saldo insuficiente normalmente responde HTTP 400, não o `REFUSED` tardio observado. Nenhum novo POST foi feito.

**Ação externa preparada:** pedir ao suporte Asaas Sandbox a causa interna das transações `CREDIT_REFUND` com IDs `fa756abc-79b4-47af-ba7b-d20fb6218408`, `8a4ae9b9-a584-46c7-9328-c3dc2d07e513` e `f0919714-07fd-4d08-8060-d890b1f07add`, vinculadas respectivamente às cobranças `pay_hddp2egolrwj07i3` (04/10) e `pay_6j64ee4ek6knln67` (01/10). Perguntar se o Sandbox suporta a devolução de Pix simulado nesta modalidade, qual verificação falhou após a autorização crítica e qual condição objetiva permite obter `DONE`. Até uma resposta ou um `DONE` real, a prova terminal permanece **BLOCKED BY ASAAS**; o Qoro deve manter a obrigação visível e não fechar a devolução.

### 06/10/2026 — revisão tardia de tarifa, migration 0110 e regressão

`0110_patient_payment_fee_corrections.sql` adiciona revisão econômica monotônica à cobrança e ao crédito, preserva o lançamento original de tarifa e permite lançamentos imutáveis de ajuste por revisão, com chave única. O produtor relê `GET /payments/{id}` para cobranças pagas já conciliadas, confere bruto e líquido, faz CAS da revisão e publica `payments.patient_payment.economics_corrected` na mesma transação. O consumer, na transação do outbox, bloqueia o crédito, rejeita tenant/bruto divergentes, atualiza tarifa/líquido, grava o delta assinado e recalcula o repasse NET. Replay da mesma revisão não gera outra linha econômica. Webhook antigo não rebaixa a tarifa corrigida: o caminho de marcação do pagamento não autoriza correção; só o readback periódico autoriza.

**Prova DEV:** backup completo antes da migration, aplicação apenas no projeto `pqhkirrszzpwezdaqrai`, readback do marker, das duas colunas de revisão e dos três índices, todos presentes. `smoke-professional-payout-date-db.ts` usou clínica/usuário Auth sintéticos isolados, publicou eventos no outbox e chamou o handler transacional real. Confirmou tarifa 5→7→5→7→9, líquido final R$ 141,00, repasse NET de 30% em R$ 42,30 e total dos ajustes de R$ 4,00 sobre a despesa original de R$ 5,00. Uma falha deliberada após aplicar a revisão foi revertida por savepoint; retry aplicou uma vez. Dez replays da última revisão e um evento antigo não alteraram saldo. A transação principal foi revertida; o usuário Auth sintético foi removido e o readback de cleanup passou. O smoke terminou **PASS, exit 0**. Essa prova usa fatos de tarifa sintéticos e **não** é um pagamento Sandbox nem uma correção tardia real observada no provedor.

**Gates locais após a mudança:** `npx vitest run --maxWorkers=4 --minWorkers=1` **4.856/4.856 em 470 arquivos**, exit 0; `npx tsc --noEmit --incremental false`, `npx eslint .`, `npx prettier --check .`, `npx tsx scripts/security/inventory.ts --check`, `npx tsx scripts/check-migration-safety.ts` e `git diff --check`, todos exit 0. `npx tsx scripts/security/local-build.ts` compilou Next 15.5.24 e gerou 18 páginas estáticas, exit 0. A primeira suíte integral com concorrência padrão terminou **4.852 PASS / 4 FAIL**: três expectativas do teste ficaram antigas após a adição da 0110 e do novo scan, foram corrigidas e passaram direcionadas 7/7; o PDF excedeu 60 s sob carga, mas passou isolado 4/4 em 19,5 s e na suíte integral repetida com quatro workers. Não houve mudança de timeout ou desativação de teste.

**Limites ainda abertos:** nenhuma correção tardia real foi observada no Asaas. O reconciliador usa `getPayment.netValue`, não ingere IDs do extrato `financialTransactions`; é necessário provar se os dois recursos permanecem consistentes quando uma tarifa muda tardiamente. Concorrência de dois workers em transações independentes e Caixa no navegador após ajuste não foram executados. A 0110 ainda não foi aplicada em Preview/produção. Não promover esta camada como concluída apenas pelos gates locais/DEV.

### 06/10/2026 — pausa segura da conta Asaas e ciclo do webhook (0111–0112)

O botão de desconexão agora separa **pausar novas cobranças** de **apagar a credencial**. A migration 0111 adiciona `accept_new_charges`, impede por CHECK que uma conta inativa autorize cobrança e dá leitura dessa coluna ao papel autenticado. A 0112 corrige o default para `false`: uma linha criada inativa não pode nascer autorizada a cobrar. As duas migrations foram aplicadas **somente no PostgreSQL DEV** e relidas: marcadores presentes, default final `false`, constraint validada e zero contas inativas com `accept_new_charges=true`. A reserva do Checkout lê esse estado na transação sob o mesmo advisory lock da pausa, antes de qualquer POST ao Asaas; a conta pausada continua capaz de receber e reconciliar eventos antigos.

Ao desconectar uma conta **sem nenhuma cobrança de paciente**, o Qoro pausa primeiro, busca pelo pathname da referência aleatória, pede `enabled=false` no webhook do Asaas e exige GET de confirmação antes de limpar chave e token locais. A busca não depende do nome editável do webhook nem do host de Preview. Falha, lista incompleta ou readback divergente preservam a credencial cifrada e a pausa para nova tentativa. Se houver qualquer cobrança histórica, a operação **mantém a conta pausada e o webhook ativo** para conciliar estornos, chargebacks e correções posteriores; não remove dados financeiros. Reconectar com a mesma chave retoma sem trocar token nem invalidar entregas em trânsito. Conexão e desconexão serializam a configuração remota sob o mesmo lock. A UI distingue conta pausada de desconectada e atualiza o estado também após erro remoto.

**Evidência e limite:** os testes direcionados após a última alteração passaram **94/94 em quatro arquivos**, exit 0, incluindo pausa, retomada, concorrência de configuração, webhook renomeado e recusa de lista incompleta. A suíte integral passou **4.872/4.872 em 470 arquivos**, exit 0. `scripts/smoke-patient-checkout-db.ts` passou **7/7 no PostgreSQL DEV**, com fixture isolada e limpeza: `accept_new_charges=false` bloqueou o claim, e a retomada permitiu o claim. O smoke não chama o Asaas. Tentativas de `pg_dump` completo antes da 0111 expiraram; foi concluída apenas uma cópia binária da tabela `clinic_payment_accounts` (1 linha, cabeçalho verificado), cuja restauração **não foi testada**. Nenhum webhook Sandbox foi desativado nesta validação; o `PUT enabled=false` e seu readback foram testados com respostas controladas, não no provedor real. O Preview ainda não recebeu as migrations 0111–0112 nem o código novo, então **não há PASS E2E externo** desta mudança. Antes de promover, aplicar 0111 e 0112 em sequência no ambiente-alvo, testar com conta/fixture Sandbox isolada a pausa, a desativação e a reativação do webhook, confirmar entregas antigas e novas e executar o ciclo de build/regressão do commit a ser promovido.

### 07/10/2026 — fechamento local e riscos ainda abertos

O diagnóstico histórico de desconexão nas seções anteriores descreve o código **anterior** à 0111–0112. No estado atual desta branch, uma conta com qualquer `patient_charges` não é desconectada: ela fica pausada e mantém chave cifrada e webhook para reconciliação. Uma conta sem histórico só perde a chave após confirmação remota de `enabled=false`. Esta é a política conservadora implementada; ainda falta decidir um procedimento de encerramento definitivo para contas com histórico quando não houver mais obrigações, sem perder a capacidade de processar estorno ou chargeback tardio. As duas filas antigas desativadas no Sandbox não devem ser reativadas ou descartadas como parte desse teste.

O lock de configuração do webhook usa uma transação `withTenant` no pool de runtime e cobre conexão, pausa e tentativa de desativação remota. A escrita de credencial continua no seam `dbAdmin` permitido; o pool worker fica reservado ao outbox. O claim do Checkout usa o mesmo identificador de lock para serializar a reserva com a pausa. Isso foi exercitado por testes de concorrência locais e pelo smoke DEV; **não** foi provado sob concorrência real com o Asaas Sandbox. Nenhuma migration desta frente foi aplicada em produção. A migração 0111 teve apenas cópia binária da tabela afetada, não dump completo nem restauração comprovada. A promoção requer backup restaurável adequado ao ambiente-alvo, readback pós-migration e fluxo E2E isolado em Preview.

Continuidade operacional e instruções de validação estão em `docs/prompts/retomada-politica-financeira-2026-10-07.md`. O teste terminal de refund PIX permanece bloqueado pelo `CREDIT_REFUND/REFUSED` observado no Sandbox; aprovação de ação crítica ou HTTP 200 de solicitação não equivalem a `DONE`. Revisão humana de repasse após refund parcial ainda depende da definição de como limitar e aprovar o valor revisado. A correção tardia de tarifa tem prova transacional DEV, mas não foi observada no provider nem no Caixa após evento real. A cadeia IA → Asaas → Meta → paciente e o webhook externo de conta recém-desconectada continuam sem prova integral.

**Gates deste checkpoint:** build Next 15.5.24 isolado com ambiente sintético (`scripts/security/local-build.ts`) concluiu compilação, checagem interna e 18 páginas estáticas, **exit 0**. `scripts/security/inventory.ts --check` concluiu **exit 0**, com 192 actions, 51 métodos de rota, `unresolved=[]`, `missingForNew=[]` e `regressed=[]`; `docs/security/acoes.md` foi regenerado para refletir números de linha alterados. Prettier nos documentos e no spec E2E alterado e `git diff --check` passaram, exit 0. O E2E `payments-account-lifecycle.spec.ts` foi ajustado para o novo botão e ganhou readback remoto do webhook `enabled=false` e readback de credenciais nulas após desconexão da fixture sem histórico. Antes de qualquer escrita, ele também exige prova assinada de que **Auth e banco do próprio Preview** são o projeto DEV fixado; comparar apenas a configuração local não bastaria. **Teste atualizado não equivale a execução no novo Preview.** A execução externa e os gates remotos deste SHA ainda devem ser registrados separadamente.

**CI do primeiro commit desta mudança:** o job remoto parou no `pnpm audit --prod --audit-level high` por `sharp` 0.35.4, afetado pelo advisory [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w); os gates posteriores não rodaram nesse job. O override já existente foi atualizado para a versão corrigida 0.35.5 e o lockfile foi regenerado com `pnpm install --lockfile-only --ignore-scripts`, sem alterar `node_modules` compartilhado. `pnpm audit --prod --audit-level high` passou localmente com **exit 0** e uma vulnerabilidade moderada fora do threshold. O build local anterior usou as dependências já instaladas; somente CI/Preview instalando o novo lockfile pode provar a compatibilidade do `sharp` 0.35.5 neste PR. Não chamar a CI de verde antes dessa reexecução.

**CI do segundo commit:** o audit de produção avançou; o job parou no gate `arch:db-check` porque `account-store.ts` importava `dbWorker`, cuja allowlist reserva o pool ao outbox. A implementação foi corrigida para segurar o advisory lock em `withTenant` (pool runtime separado do `dbAdmin`), sem ampliar a allowlist de segurança. Reexecutar o gate local, testes e CI no novo SHA antes de afirmar resolução.

**Revalidação após a correção arquitetural:** `scripts/arch-db-check.ts` varreu 1.428 arquivos com zero achados, exit 0; testes direcionados da conta/adapter/checkout passaram **104/104 em quatro arquivos**, exit 0; TypeScript e ESLint dos arquivos alterados passaram, exit 0; a suíte Vitest integral passou **4.872/4.872 em 470 arquivos**, exit 0, em 264,97 s. O build Next 15.5.24 isolado repetido concluiu 18 páginas estáticas, **exit 0**. A prova assinada do Preview anterior confirmou `environment=preview` e as referências de Auth e banco do projeto DEV; o readback DEV confirmou os markers 0111/0112, default `false`, `NOT NULL`, CHECK validado e zero linhas inativas autorizadas a cobrar. Essa sondagem só de leitura não substitui o E2E do commit corrigido. A CI do novo SHA ainda precisa de resultado final registrado.

### 07/10/2026 — E2E externo da pausa e fechamento do checkpoint

O commit de aplicação `1cc90e69` foi publicado apenas no Preview `project-os-git-fix-post-merge-va-5fdd7c-clinic-os-v2-s-projects.vercel.app`. Antes de criar cada fixture, o runner exigiu resposta assinada de `/api/signup/runtime-fingerprint` confirmando `environment=preview` e **Auth + banco do projeto DEV**. O banco DEV foi relido após 0111–0112: ambos os marcadores presentes, coluna `accept_new_charges` `NOT NULL` com default `false`, CHECK validado e zero contas inativas autorizadas a cobrar. Nenhuma migration foi aplicada em produção. O CI do SHA `1cc90e69` concluiu **PASS** em audit de dependências, lint, TypeScript, testes, build e gate arquitetural (run 37570257227); Semgrep, Snyk e Vercel também reportaram PASS no PR #26. Isso prova o commit publicado, não uma futura alteração do PR.

O E2E `e2e/payments-account-lifecycle.spec.ts` foi executado contra esse Preview com clínica, usuário e cobranças **sintéticos isolados em DEV**, e chave da conta **Asaas Sandbox da clínica**. A execução final foi **6/6 PASS, exit 0, 3,1 min, sem retry**. Os cenários comprovaram: chave inválida recusada sem alterar conta nem voltar ao HTML; conexão e persistência; conta **sem histórico** desconectada só após readback remoto `enabled=false`, com chave/token locais nulos; Pro/Clínica configuráveis e Solo bloqueado na UI e na action direta; Caixa Solo distinguindo bruto/tarifa/líquido por cobrança; Caixa Pro exibindo base NET e repasse suspenso; conta **com histórico** pausada com chave cifrada e webhook ainda habilitado no Sandbox, retomada pela mesma chave sem trocar referência/token e nova pausa idempotente. O teardown removeu somente o webhook da fixture com readback `GET 404`, apagou clínica e usuários Auth DEV da fixture e exigiu readback sem resíduos; passou sem erro. O teste não criou cobrança real nem executou transferência, refund ou webhook de pagamento.

Duas tentativas anteriores **não** foram PASS: a primeira parou em `patient_charges_economics_revision_chk` porque a fixture sintética preenchia `economics_reconciled_at` sem a revisão `1` exigida pela migration 0110 (3 PASS, 1 FAIL, 1 não executado). A fixture foi corrigida para preencher a revisão de `patient_charges` e `patient_credits`; a execução seguinte passou 5/5. Ao adicionar o sexto cenário, a primeira tentativa terminou 5 PASS/1 FAIL porque o helper usou cookies anteriores à renovação de sessão do quinto teste e foi redirecionado ao login. O helper agora salva os cookies finais e reautentica quando o cookie antigo já não vale; a reexecução passou 6/6. Nenhuma constraint de produto foi afrouxada, e nenhum teste foi desativado.

**Limite para promoção:** o E2E prova o ciclo de configuração do webhook no Sandbox, não uma entrega real tardia de refund/chargeback, nem a concorrência de dois processos independentes com chamada Asaas. O backup disponível da 0111 é uma cópia binária de uma tabela sem restore testado, insuficiente como backup completo do banco de produção. Permanecem sem prova externa: mudança tardia real de tarifa Asaas → Caixa, jornada pagamento → webhook → crédito/repasse, refund PIX `DONE` e fluxo integrado IA → cobrança → Meta. O estado de PR #26 continua **não promovido à main** até esses riscos e a estratégia de backup/rollout serem decididos explicitamente.

### 07/10/2026 — retomada: estado remoto, concorrência entre processos e precondições do pagamento real

**Estado conferido, somente leitura.** Worktree `C:\dev\ClinicaOS_V2_2e2_integration`, branch `fix/post-merge-validation-20261001`, HEAD `85c59466` igual ao remoto, árvore limpa antes desta rodada. Após `git fetch` somente leitura, `origin/main` está em `772f70ad`, que também é o merge-base; a branch está 31 commits à frente e 0 atrás. O PR #26 continua **draft**, `MERGEABLE`/`CLEAN`. Os commits posteriores a `1cc90e69` (`8de32d98` e `85c59466`) alteram somente `e2e/payments-account-lifecycle.spec.ts`, esta spec e o prompt de retomada; nenhum arquivo de produto. Para `85c59466`: CI run `37601877871` (audit, lint, typecheck, testes, build e gates) **success**, ADR advisory `37601877869` success, Semgrep, Snyk e deployment Vercel Preview `6906631491` success. O CI de `8de32d98` (run `37601497242`) foi **cancelado** por supersessão e não conta como PASS.

**DEV, transação `READ ONLY` no pooler do projeto `pqhkirrszzpwezdaqrai`:** `_schema_version` contém 0108, 0110, 0111 e 0112; a 0109 não grava marcador por desenho, e seus artefatos (coluna `provider_reconcile_checked_at` e os dois índices parciais) estão presentes. O ledger `drizzle.__drizzle_migrations` tem 113 linhas, igual às 113 entradas do journal. `accept_new_charges` é `NOT NULL DEFAULT false` e `clinic_payment_accounts_inactive_cannot_charge_chk` está validada. Há uma única conta de pagamento no DEV, da clínica `clinica-a`, ativa, aceitando cobranças e com duas cobranças históricas; zero contas inativas autorizadas a cobrar e zero resíduos `e2e-payments-%` em clínicas ou Auth. Nenhum SQL de migration foi reaplicado.

**Asaas Sandbox, somente GET.** Na conta `ASAAS_CHAVE_TESTE_2`, os webhooks `…611c` e `…0ddd` seguem `enabled=false`, `interrupted=true`; as cobranças `pay_hddp2egolrwj07i3` e `pay_6j64ee4ek6knln67` seguem `RECEIVED`, com um e dois refunds `CANCELLED` e **zero `DONE`**. Na conta da clínica (`ASAAS_CLINIC_SANDBOX_KEY`) há dois webhooks habilitados e não interrompidos: `…1e3a`, rota de paciente cuja ref corresponde à conta da `clinica-a` no DEV, com host no alias do Preview desta branch; e `…f85a` ("qoro dev"), apontando para a rota **de assinatura da plataforma** `/api/webhooks/asaas` de um Preview antigo (`feat-qorov2-pagamentos`). As três chaves Sandbox (clínica, plataforma DEV e teste 2) são distintas; a comparação ocorreu em memória e só o booleano foi impresso. Portanto `…f85a` é um webhook de plataforma registrado na conta da clínica, pré-existente e fora do fluxo do produto. Qualquer pagamento real nessa conta será entregue a **todos** os webhooks dela: o da `clinica-a` resolve outro tenant e, pela busca da geração de Checkout sob RLS, deve responder `unknown_charge` sem creditar; o "qoro dev" entregava à rota de plataforma de um Preview antigo. **Decisão do usuário em 07/10: desativar sem excluir.** Depois de reconferir sufixo, nome, pathname e host, `PUT /v3/webhooks/{id}` somente com `enabled:false` retornou HTTP 200; o GET de readback mostrou `enabled=false`, `interrupted=false`, mesmo nome, rota e host, e os 7 eventos preservados. O `…1e3a` da `clinica-a` continuou `enabled=true`. Reativar é um PUT reversível, mas não deve ocorrer sem destino legítimo.

**Concorrência entre dois processos — `scripts/smoke-payment-account-pause-race-db.ts`.** O coordenador cria uma fixture DEV isolada: usuário Auth sintético, clínica, paciente, procedimento, três agendamentos, uma cobrança histórica paga e conta de pagamento com segredos-placeholder. Ele segura uma barreira no mesmo advisory lock da conta (`71101`, `hashtext(clinic_id)`), dispara dois processos Node independentes, cada um com seus próprios pools e sessões, e só solta a barreira depois que `pg_locks` mostra exatamente um e depois dois processos esperando, na ordem desejada. O processo de pausa chama `deactivatePaymentAccount`; o de reserva chama `createInitialHostedCheckout` com um cliente-contador local que registra tentativas de `POST /checkouts` e nunca sai da máquina. O launcher local injetou DEV/Auth somente em memória a partir do `.env.local` do checkout principal, removeu variáveis `*_PROD` do processo, fixou o Asaas no Sandbox e usou `NODE_OPTIONS=--conditions=react-server`. Duas execuções consecutivas terminaram **PASS, exit 0**, em 82 s e 86 s:

1. **Pausa primeiro:** pausa `{changed: true, state: 'paused'}`; reserva `account_paused`; **zero** tentativas de POST; nenhuma dívida ou geração para o agendamento; conta `active=true`, `accept_new_charges=false`, chave e token inalterados.
2. **Reserva primeiro:** a reserva persistiu dívida e geração antes da pausa (`patient_charges.created_at` anterior ao `audit_events` da pausa, ambos pelo relógio do banco); a pausa esperou o lock, encontrou histórico e manteve credencial e token; o único POST da intenção persistida terminou **depois** de a pausa estar gravada; geração `active`, com `payments.patient_charge.created` e `link_ready` uma vez cada.

Cleanup: outbox, auditoria e clínica da fixture removidos; usuário Auth com DELETE e GET 404; readback do próprio script e consulta independente `READ ONLY` com zero clínicas e usuários `e2e-pause-race-%`. `tsc --noEmit --incremental false` com o script incluído passou, exit 0, em 176 s; ESLint e Prettier do script passaram, exit 0.

**Leitura do resultado.** O smoke comprova a serialização no PostgreSQL entre dois processos independentes e a ausência de POST quando a pausa vence o lock. **Não** prova POST real ao Asaas, entrega de webhook, duas instâncias serverless da Vercel nem latência real do provedor. O cenário 2 expõe uma propriedade de desenho: a pausa não cancela intenção já persistida, então o Checkout correspondente ainda pode ser criado e o evento `link_ready` publicado depois de a tela mostrar "Pausada". A conta continua conciliável, porque o histórico preserva chave e webhook. Cabe decisão de produto: aceitar esse comportamento ou fazer a ativação reler a pausa e cancelar o Checkout recém-criado.

**Gates locais da árvore com o novo script e estes documentos**, cada um com saída e exit code próprios: `tsc --noEmit --incremental false` exit 0 (111 s); `eslint .` exit 0; `madge --circular` sem ciclos, exit 0; `arch-db-check` 1.429 arquivos e zero achados, exit 0; `check-migration-safety` exit 0; `check-observability-drift` 19 crons coerentes, exit 0; `prettier --check .` exit 0; Vitest integral **4.872/4.872 em 470 arquivos**, exit 0, 295 s; `scripts/security/local-build.ts` compilou o Next, gerou 18 páginas estáticas, exit 0; `git diff --check` exit 0. Duas execuções iniciais falharam e foram explicadas antes de prosseguir: `check-handler-registry --strict` falhou em `server-only` porque o runner local passou `--conditions` ao `node` pai em vez de ao `tsx`; com a invocação do `package.json` (`tsx --conditions=react-server`) e os fakes de env da CI, passou com catálogo 71 ⇔ registry 29, exit 0. `inventory.ts --check` falhou porque o novo script acrescentou três acessos a `process.env`; `--write` regenerou `docs/security/acoes.md` (274 → 277 acessos; actions 192 e métodos de rota 51 inalterados) e o novo `--check` passou, exit 0.

**Precondições descobertas para a prova com pagamento real.** (1) O sinal só nasce pelo cron `payments-deposit` ou pelo worker do outbox. A Vercel executa crons somente no deployment de produção; no Preview, o worker `runOutboxOnce` é global e sem filtro por clínica, e no DEV ele só avança por chamada manual ao cron ou pelo dreno que a rota do webhook Meta executa após cada ingresso. Assim, mesmo com um webhook real chegando ao Preview, crédito, despesa de tarifa, Caixa e reconciliação tardia só aparecem se alguém processar o outbox: o worker global afetaria outras clínicas DEV, e o caminho seguro é um despachante restrito à fixture, ainda inexistente. (2) O pagamento do Checkout hospedado exige reCAPTCHA humano. (3) O webhook `…f85a` descrito acima, agora desativado. **Decisão do usuário em 07/10:** construir um runner com fixture isolada e despachante de outbox restrito a ela; o próprio usuário pagará o Checkout Sandbox quando avisado. O worker global no DEV foi descartado. Até a execução, "evento real de cobrança antiga em conta pausada" e a revisão econômica externa permanecem **BLOCKED**, não FAIL.

**Decisão de produto aceita em 07/10 — contrato da revisão humana do repasse após estorno parcial ou perda.** Exemplo de referência: consulta de R$ 150,00, regra 50% `GROSS`, repasse calculado R$ 75,00; estorno comprovado (`DONE`) de R$ 50,00. (1) **Valor:** quem revisa informa o valor final entre R$ 0,00 e o valor calculado originalmente (R$ 75,00), com motivo obrigatório. A proporção (R$ 50,00) pode aparecer apenas como referência e nunca é aplicada sozinha. (2) **Aprovação e correção:** qualquer usuário com `MANAGE_FINANCIAL`, em plano Clínica/Pro, registra a decisão. Cada decisão é uma versão nova, imutável e auditada; corrigir significa registrar outra versão, nunca editar a anterior. Até existir decisão, a suspensão conservadora continua valendo. Esta decisão define o contrato; a implementação e as provas da camada 4 seguem pendentes.

**Resumo por camada nesta data:**

| Frente | Resultado | Motivo |
| --- | --- | --- |
| 1 — elegibilidade | PASS local e CI em `85c59466`; PASS E2E de plano no Preview de `1cc90e69` | rollout NOT RUN |
| 2 — fatos do Asaas e ledger | PASS DEV com fatos sintéticos; pagamento Pix real → webhook → crédito → tarifa → Caixa PASS no Preview (9ª execução); correção tardia real NOT RUN | o provedor não produziu correção tardia; antecipação sem produtor |
| 3 — preço por método | PASS local/DEV da guarda; pagamento com preço de catálogo NOT RUN | o pagamento real usou o preço do agendamento, sem método comercial; falta cenário no modo explícito |
| 4 — repasse | suspensão conservadora PASS; revisão humana PASS local, no Postgres descartável (8/8) e no E2E do Preview com papéis reais (5/5, `e1aae7c7`); 0113 só no DEV | sem prova no Preview: base NET, perda/chargeback e dois revisores simultâneos; regra fixa acima da base sem decisão |
| 5 — UI, E2E e promoção | Preview 6/6 PASS em `1cc90e69` (fatos sintéticos); Caixa com fatos reais do Sandbox PASS (9ª execução); promoção NOT RUN | backup restaurável e plano de rollout ainda sem decisão |
| Conta pausada | ciclo de configuração PASS no Sandbox; concorrência PASS no DEV; evento real de cobrança antiga com a conta pausada PASS no Preview (9ª execução); encerramento definitivo implementado (0115 no DEV), E2E manual na seção final; cron de inatividade NOT RUN | no ciclo 6/6 de `1cc90e69`, o webhook apontava para outro deploy (`APP_BASE_URL`); a 9ª execução refez conexão e pausa com o host correto |
| Estorno | fora do escopo agora | decisão de 04/10, reafirmada em 07/10: a clínica devolve ao paciente pela própria conta Asaas; a automação vem depois. O `CREDIT_REFUND/REFUSED` do Sandbox fica como histórico |
| IA → Asaas → Meta | PARCIAL: Meta → Preview → IA PASS em 08/10 (override por WABA); sinal, link e pagamento pela jornada NOT RUN | o Preview não processa o próprio outbox (sem cron) e a C14 só envia em produção, das 8h às 20h. Corrigidos no caminho: `thoughtSignature` do Gemini 3 e nome exato de procedimento (`docs/qorov2.md` §58) |

### 07/10/2026 — runner do pagamento real em conta pausada

**Runner:** `e2e/payments-paused-account-real-payment.spec.ts`, com humano no circuito e opt-in triplo (`E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`, `E2E_REAL_PAYMENT=human`, `E2E_CHECKOUT_LINK_FILE`). Ele usa o Preview do PR com Auth/banco DEV, prova assinada do runtime, a conta Sandbox da clínica e uma fixture DEV isolada: owner Auth, plano Pro, política de sinal de 50%, dois pacientes com CPF sintético válido, dois agendamentos e um recebível em aberto criado pela fixture. Esse recebível equivale a um lançamento manual; concluir o atendimento exigiria prontuário. A sequência é:

1. conexão pela UI do Preview;
2. `createDepositCharge` real criando o Checkout no Sandbox;
3. pausa pela UI e nova reserva bloqueada;
4. pessoa abre o link, escolhe Pix e resolve o reCAPTCHA, e o runner liquida pelo endpoint de simulação `POST /v3/sandbox/payment/{id}/confirm`;
5. readback banco × `GET /payments/{id}` × `GET /financialTransactions`;
6. despachante restrito à fixture e aos eventos `patient_charge.created/paid`, `patient_credit.granted` e `economics_reconciled`, com replay — `link_ready` e a mensageria ficam de fora;
7. Caixa no Preview.

O caso de uso e o despachante rodam em `scripts/e2e-paid-pause-ops.ts` via tsx: o carregador ESM do Playwright não resolve `next/headers` nessa cadeia. O helper recusa clínica fora do prefixo `e2e-paid-pause-` e Asaas fora do Sandbox. O link de pagamento vai para um arquivo local, nunca para o log. Um arquivo de parada (`E2E_PAID_PAUSE_ABORT_FILE`) encerra a espera sem pular o cleanup. A retomada (`E2E_PAID_PAUSE_RESUME_CLINIC`) continua uma fixture preservada a partir do passo 4.

**Execuções em 07/10, todas contra o Preview do commit `cb898599`:**

- **1ª:** passo 1 **PASS**, com conexão pela UI, webhook habilitado e a chave mestra local decifrando a credencial gravada pelo Preview — precondição do Checkout local. O passo 2 falhou antes de chamar o Asaas por `Cannot find module next/headers` no carregador do Playwright; foi um defeito do runner, corrigido com o helper tsx. Cleanup PASS.
- **2ª:** passos 1–3 **PASS**:
  - o caso de uso real fez o `POST /checkouts` no Sandbox e gravou cobrança de R$ 10,00, geração `active` e link;
  - a pausa pela UI manteve `active=true`, `accept_new_charges=false`, credencial e token idênticos e o webhook habilitado no Sandbox;
  - a nova reserva para o segundo agendamento criou **zero** cobranças.

  No passo 4, após 13,9 min de espera, um `GET /payments` ao Sandbox falhou com `ConnectTimeoutError`, e o loop não tolerava falha transitória. O cleanup falhou com `ECONNRESET` na conexão de banco ociosa, e a fixture ficou preservada para investigação. Correção: leituras do Sandbox com nova tentativa em erro de rede; o POST de liquidação só se repete após releitura; o cliente Postgres recicla conexões ociosas e o cleanup repete operações de banco.
- **3ª, retomada da mesma fixture:** a espera de 60 min absorveu **7** falhas transitórias de rede e terminou **BLOCKED**, sem pagamento iniciado. O operador relatou que o Checkout do app abria com "erro desconhecido" e pedia recarga. Depois do cancelamento, a recarga mostrou "Página não encontrada", o que é esperado. Cleanup PASS: Checkout `CANCELED`, webhook da fixture removido com GET 404, clínica, outbox, auditoria e usuário Auth em zero, e só os dois webhooks pré-existentes no Sandbox.
- **4ª e 5ª:** abortadas na criação da fixture por falha de rede local (`ENOTFOUND` no DNS do pooler Supabase; `ConnectTimeoutError` para o Supabase Auth). Readback: zero clínicas e zero usuários `e2e-paid-pause-%`.

**Diagnóstico do Checkout que não abriu.**

- **Configuração da conta descartada:** `GET /myAccount/status` deu `APPROVED` em geral, informações comerciais, conta bancária e documentação, e há uma chave Pix EVP `ACTIVE`, igual à conta de teste 2, onde o pagamento humano funcionou em 04/10.
- **Rede do operador instável no mesmo período:** DNS levando 0,4–2,1 s, `ENOTFOUND` e timeouts para os IPs de `sandbox.asaas.com`. Esta é a hipótese principal.
- **Hipótese de produto ainda aberta:** o Checkout de sinal do app não envia `customerData`, e um Checkout `DETACHED` assim nunca tinha sido aberto por um humano. O runner de 04/10 sempre enviou `customerData`; o Checkout de assinatura, também sem ele, renderizou em 05/10, mas é `RECURRENT`. Para separar as hipóteses, foi criado na mesma conta um Checkout de controle com o corpo idêntico ao do app mais `customerData`. O Asaas recusou o controle enquanto `customerData` vinha incompleto: com ele exige `phone`, `address`, `addressNumber`, `postalCode` e `province`. O controle completo nasceu `ACTIVE` e foi cancelado com readback `CANCELED`, sem ser aberto, porque a rede seguia instável.

Na próxima tentativa, entregar ao operador os dois links ao mesmo tempo. Se só o controle renderizar, o Checkout de sinal do app tem defeito de produto e precisa enviar dados do pagador ou adotar outro fluxo.

**Resultado:** a conexão, a criação real do Checkout e a pausa com bloqueio de nova cobrança estão **PASS** contra o Asaas Sandbox. O evento real de cobrança antiga chegando à conta pausada, a conferência econômica externa e o Caixa com fatos reais continuam **BLOCKED**, por rede instável no operador e pelo passo humano do reCAPTCHA. Nenhum dado de produção foi tocado. A cobrança paga ainda não existe, então não há pagamento Sandbox residual desta frente.

### 07/10/2026 — pagamento humano concluído; webhook entregue a outro Preview

**6ª execução do runner (Preview do commit `fcb47071`):**

- Os passos 1–3 passaram de novo.
- O operador abriu o link do app, escolheu Pix e resolveu o reCAPTCHA. O Checkout renderizou normalmente, sem repetir o "erro desconhecido", com a rede local estável naquele momento. O link de controle não precisou ser aberto e foi cancelado com readback `CANCELED`. A hipótese de defeito por falta de `customerData` não se confirmou.
- O runner encontrou o pagamento `pay_pvm1h4gtsf49te26` e o liquidou pela simulação do Sandbox. `GET /payments/{id}` mostrou `RECEIVED`, `value` 10, `netValue` 9,01 e PIX.
- O banco DEV registrou a cobrança `paid` com o `provider_payment_id` correto **enquanto a conta estava pausada**.
- A asserção seguinte **falhou**: `provider_gross_amount` nulo ou zero, em vez de R$ 10,00.

**Causa, comprovada sem novo pagamento:** a 7ª execução rodou só os passos 1–3 e parou no 4 pelo arquivo de parada, sem pagamento. Ela registrou o host do webhook que a UI do Preview cadastrou: `project-os-git-integration-estad-04a442-…vercel.app`, com `webhookHostIsTestedPreview: false`. O `APP_BASE_URL` do Preview desta branch aponta para o Preview da branch `integration/estado-completo-atual-2026-09-27` (`49b677f1`, 28/09). Esse deploy usa o mesmo banco DEV, não contém os commits de pagamento deste PR e seu `charge-store.ts` não grava `providerGrossAmount`. Logo, o webhook real foi conciliado por código antigo.

Não é defeito do PR, mas **invalida como prova de Preview** tudo o que depende do destino do webhook: o pagamento desta rodada e o "webhook preservado/habilitado" do E2E de ciclo da conta, cujo recurso existe e está ativo, mas aponta para outro deploy. A mesma configuração afeta outros usos de `APP_BASE_URL` no Preview: callbacks de Checkout criados pelo próprio Preview, links transacionais e redirecionamentos de Auth.

**Efeitos e cleanup:**

- O deploy antigo marcou a cobrança da fixture como paga sem fatos econômicos.
- O cleanup removeu clínica, outbox, auditoria, webhook (com GET 404) e usuário Auth; o readback mostrou zero `e2e-paid-pause-%`.
- O pagamento Sandbox `pay_pvm1h4gtsf49te26` (R$ 10,00 `RECEIVED`) permanece na conta Sandbox da clínica como resíduo inevitável: não há exclusão de pagamento recebido, e o estorno Pix deste Sandbox termina `REFUSED`.

**Próxima condição:** corrigir o `APP_BASE_URL` do Preview desta branch na Vercel e repetir o pagamento. A alternativa só de teste é o runner redirecionar o webhook da fixture para o Preview testado. Até lá, "evento real chegando à conta pausada **e conciliado pelo código deste PR**" segue BLOCKED.

**Correção aplicada pelo usuário em 07/10:** na Vercel, `APP_BASE_URL` do ambiente Preview, só para a branch `fix/post-merge-validation-20261001`, passou a `https://project-os-git-fix-post-merge-va-5fdd7c-clinic-os-v2-s-projects.vercel.app`; a entrada geral de Preview e a de Production ficaram como estavam.

- Logo após o redeploy, uma sondagem ainda viu o host antigo.
- Depois do deploy do commit `54c3e92d` (status Vercel `success` às 18:23:56 UTC), a sondagem sem pagamento registrou `webhookHostIsTestedPreview: true`.
- O passo 1 do runner passou a **exigir** isso antes de qualquer pagamento humano.
- Na mesma sondagem, a reserva pós-pausa caiu de novo por falha de rede no helper (`Failed query` no primeiro `SELECT`). O helper passou a expor o código da causa, e o runner repete até duas vezes as operações em erro de rede. A repetição é segura: o caso de uso é idempotente e o despachante só pega eventos `pending`.

**8ª execução (Preview do `54c3e92d`):** passos 1–3 **PASS**, com o webhook no Preview testado. Às 18:31 UTC o link Pix foi entregue. O operador ficou indisponível naquele momento, e a espera foi encerrada pelo arquivo de parada: passo 4 **BLOCKED**, sem pagamento. Cleanup verificado de forma independente: Checkout sem pagamento associado, webhook da fixture removido, zero clínicas e zero usuários `e2e-paid-pause-%` no DEV, e só os dois webhooks pré-existentes no Sandbox. Repetida na 9ª execução, abaixo.

### 07/10/2026 — 9ª execução: pagamento real em conta pausada conciliado por este PR

**Alvo:**

- runner no commit `283039d1`, que desde `54c3e92d` só mudou `e2e/` e `scripts/`;
- Preview do commit `54c3e92d`, no alias da branch (`project-os-git-fix-post-merge-va-5fdd7c-…vercel.app`);
- Auth e banco DEV `pqhkirrszzpwezdaqrai`;
- conta Sandbox da clínica (`ASAAS_CLINIC_SANDBOX_KEY`).

**Comando:** launcher local que injeta o ambiente DEV só em memória e roda `playwright test e2e/payments-paused-account-real-payment.spec.ts --project=chromium --workers=1`. Variáveis: `E2E_BASE_URL` (o Preview), `E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`, `E2E_REAL_PAYMENT=human`, `E2E_CHECKOUT_LINK_FILE`, `E2E_REAL_PAYMENT_WAIT_MIN=60` e `E2E_PAID_PAUSE_ABORT_FILE`.

**Estado inicial (readback):** zero clínicas e zero usuários `e2e-paid-pause-%` no DEV. Na conta Sandbox, só os webhooks `…f85a` (desativado) e `…1e3a` (da `clinica-a`, habilitado).

**Resultado: exit 0, 7/7 PASS em 16,5 min.**

1. Conexão pela UI. O webhook da fixture ficou habilitado e apontando para o **Preview testado** (`webhookHostIsTestedPreview: true`), e a chave cifrada pelo Preview decifrou localmente.
2. `createDepositCharge` real criou o Checkout de R$ 10,00 (sinal de 50% sobre R$ 20,00), geração `active`.
3. Pausa pela UI: credencial preservada, webhook habilitado, e a reserva do segundo agendamento não criou cobrança.
4. Link entregue às 18:47 UTC. A pessoa escolheu Pix e resolveu o reCAPTCHA, e o runner liquidou pelo endpoint de simulação.
   - `PAYMENT_RECEIVED` chegou às 18:59:46 UTC e `CHECKOUT_PAID` às 18:59:47 UTC, **com a conta pausada o tempo todo** (`accountPausedThroughout: true`).
   - Banco: cobrança `paid` com `pay_28prjdjknecjvnl0`, PIX, bruto 10,00, tarifa 0,99, líquido 9,01, revisão 1.
   - Outbox no instante do pagamento: `patient_charge.created`, `link_ready`, `paid` e `patient_credit.granted` pendentes; o último já levava o bruto 10.
   - Nas outras clínicas do DEV, cobranças, créditos e eventos de webhook ficaram iguais antes e depois (2/2/39).
5. Revisão econômica externa: `GET /payments/{id}` deu `RECEIVED`, `value` 10 e `netValue` 9,01; `GET /financialTransactions` deu `PAYMENT_RECEIVED` +10,00 e `PAYMENT_FEE` −0,99; o banco bateu com ambos.
6. O despachante da fixture processou `created`, `paid` e `credit.granted`, e o replay dos três não duplicou nada. Resultado:
   - um crédito de 10,00 alocado (bruto 10,00, tarifa 0,99, líquido 9,01) e uma despesa de tarifa de 0,99;
   - recebível manual de R$ 20,00 `parcial`, com 10,00 pago;
   - sinal `paid` e agendamento `confirmado`.
7. Caixa do Preview: solicitado R$ 10,00, bruto R$ 10,00, tarifa − R$ 0,99, líquido R$ 9,01.

**Cleanup e readback independente:** o runner removeu o webhook da fixture e apagou clínica, outbox, auditoria e usuário Auth. A releitura separada (DEV em transação somente leitura, Sandbox só com GET) mostrou:

- zero clínicas e zero usuários `e2e-paid-pause-%`;
- nenhuma cobrança com `pay_28prjdjknecjvnl0` e nenhuma conta pausada no DEV;
- nenhum evento de webhook gravado em outra clínica nas últimas 3 h. O webhook `…1e3a`, da `clinica-a`, fica na mesma conta Sandbox e assina os mesmos eventos;
- só os dois webhooks pré-existentes no Sandbox, nenhum interrompido.

**Resíduo:** o pagamento `pay_28prjdjknecjvnl0` (R$ 10,00 `RECEIVED`, sem estorno) fica na conta Sandbox da clínica, como o `pay_pvm1h4gtsf49te26` da 6ª execução. Não houve tentativa de estorno: o Pix deste Sandbox termina `REFUSED`, e repetir a mesma falha não acrescenta prova.

**Alcance da prova.** No Preview deste PR e contra o Asaas Sandbox, ficou comprovado que:

- um Checkout criado antes da pausa continua pagável;
- o webhook real chega e é conciliado enquanto `accept_new_charges=false`;
- bruto, tarifa e líquido coincidem entre provider, extrato, banco e Caixa.

Fica **sem prova**:

- correção tardia real de tarifa, antecipação, cartão e estorno `DONE`;
- preço de catálogo por método: o sinal usou o preço do agendamento, sem método comercial;
- worker e cron do Preview: o despachante é restrito à fixture e deixa de fora `link_ready` e a mensageria;
- a jornada IA → link → Meta;
- o repasse: a fixture não tem regra de profissional nem atendimento concluído.

### 07/10/2026 — camada 4: revisão humana do repasse (implementação, prova local e 0113 no DEV)

**Contrato implementado**, conforme a decisão de 07/10 acima:

- **Teto:** o valor que a regra do snapshot produzia sobre o pagamento original. Em `GROSS`, a base é o bruto do snapshot. Em `NET`, é o líquido original das cobranças alocadas ao atendimento, sem descontar a reversão; sem esse líquido não há teto e a revisão fica bloqueada com aviso.
- **Referência:** proporção do teto pelo dinheiro que ficou com a clínica, teto × (pago − estornado) ÷ pago, e zero quando há perda do provedor. Aparece só como informação e nunca é aplicada sozinha.
- **Decisão:** valor entre R$ 0,00 e o teto, com motivo de 3 a 500 caracteres. Fica registrada em `professional_payout_reviews` como versão `máx + 1`, sob `FOR UPDATE` do repasse. O repasse passa a `reviewed`, com o valor decidido.
- **Estado da reversão:** cada versão grava o total estornado e a perda considerados. `refreshProfessionalPayout` mantém `reviewed` enquanto esse estado não muda. Estorno novo, perda nova ou perda desfeita re-suspendem o repasse para `cancelled`, com auditoria `payment_reversed_after_review`, até nova versão.

**Código:**

- `drizzle/migrations/0113_professional_payout_reviews.sql` e journal;
- `src/contexts/financial/internal/payout-review.ts`;
- `refreshProfessionalPayout`;
- Server Action `reviewProfessionalPayout`, com a ordem usuário → `MANAGE_FINANCIAL` → clínica da sessão → plano Clínica/Pro → Zod estrito sem `clinicId` do navegador → `idempotentMutation` com auditoria `financial.professional_payout.reviewed`;
- wrapper `reviewProfessionalPayoutAction` no Caixa;
- formulário `payout-review-form.tsx`, exibido só a `MANAGE_FINANCIAL` em Clínica/Pro.

A leitura do Caixa passa a entregar o `id` do repasse, a versão vigente e os limites. O texto do motivo fica apenas na versão: o resultado auditado e a resposta idempotente levam só valores.

**Migration 0113:**

- o CHECK de status ganha o ramo `reviewed`, que exige base, valor e instante;
- a tabela de versões tem teto, decisão, motivo e estado da reversão, com `UNIQUE (payout_id, version)`;
- trigger confere que a clínica da versão é a do repasse; trigger bloqueia qualquer `UPDATE`;
- RLS `ENABLE+FORCE` com policies só de `SELECT` e `INSERT`;
- `authenticated` recebe só `SELECT, INSERT`; `anon` nada;
- `decided_by` é snapshot opaco, sem FK;
- marcador `0113-professional-payout-reviews`.

**Provas locais:**

- **Testes dirigidos:**
  - `payout-review.test.ts` 13/13, com o exemplo de R$ 150 (teto R$ 75, referência R$ 50), base NET pelo líquido original, NET sem líquido bloqueado, perda com referência zero, versões, valor acima do teto, status inválido, outra clínica e motivo vazio;
  - `professional-payout.test.ts` 17/17, incluindo `reviewed` mantido e re-suspensão auditada;
  - `payout-actions.test.ts` 11/11, com Solo bloqueado, sem `MANAGE_FINANCIAL` sem consulta nem gravação, cinco entradas inválidas recusadas como `ZodError` antes da mutação, clínica e autor da sessão e motivo fora do resultado;
  - `caixa-view.test.tsx` 29/29, com formulário com teto e referência, recusa visual acima do teto, chamada da action, ocultação sem permissão, versão vigente e NET sem teto;
  - `page.test.tsx` 3/3 e teste estático da migration 5/5.
- **`scripts/security/payout-review-db.ts`:** Postgres local descartável com **todas** as migrations reais até a 0113 e código de produção por `withTenant`, **8/8 PASS**, exit 0, em 47 s:
  1. exemplo decidido, com versão 1 e repasse `reviewed` de R$ 60,00 sobre base R$ 150,00;
  2. R$ 75,01 recusado sem nova versão;
  3. versão 2 de R$ 0,00 preservando a 1;
  4. `UPDATE` negado (42501) para `authenticated` e bloqueado pela trigger até para o dono da tabela;
  5. outra clínica não lê, não grava (RLS 42501 e trigger de tenant) e não revisa;
  6. estorno posterior re-suspende com auditoria, a versão 3 volta a valer com referência R$ 45,00 e o refresh seguinte mantém `reviewed`;
  7. CHECK recusa `reviewed` sem valor;
  8. a leitura do Caixa entrega versão e limites, sem cruzar tenant.

**DEV, somente o projeto `pqhkirrszzpwezdaqrai`:**

- **Backup completo antes da migration:** `pg_dump -Fc` pelo pooler em modo sessão, com credenciais só em variáveis do processo, exit 0, 1.586.821 bytes, 250 s. Arquivo `C:\Users\joaom\.codex\backups\qoro-dev-pre-0113-2026-10-07T17-22-46-702Z.dump`, não versionado. O índice do `pg_restore --list` tem 2.612 entradas e 180 blocos de dados.
- **Teste de restore dirigido em cluster local descartável:** exit 0. `professional_payouts` restaurou 0 linhas, igual ao DEV, e `_schema_version` restaurou 92, igual ao DEV; o cluster foi removido. É um restore **dirigido**, não do banco inteiro.
- **Migration:** `scripts/db-migrate-dev.ts`, exit 0.
- **Readback `READ ONLY`:**
  - marcador presente e ledger com 114 linhas (último `when` 1791436800000);
  - RLS `ENABLE+FORCE`, policies `SELECT` e `INSERT`;
  - triggers `immutable` e `validate`;
  - `authenticated` com `SELECT/INSERT` e sem `UPDATE/DELETE`; `anon` sem privilégios;
  - `professional_payouts_status_chk` validada e com `reviewed`;
  - zero versões e zero repasses no DEV.

**Rollback, enquanto não houver repasse `reviewed`:** `DROP TABLE public.professional_payout_reviews` e recriar `professional_payouts_status_chk` com o corpo da 0108. Com versões já gravadas, não fazer rollback destrutivo; reverter o app e manter a tabela.

**Ainda não comprovado:**

- E2E do formulário no Preview com papéis reais (owner, financeiro e profissional) e sessão revogada;
- re-suspensão disparada por estorno ou chargeback reais do Asaas;
- regra fixa acima da base: o teto segue o cálculo original e a decisão de produto continua aberta.

A camada 4 continua **não aceita para produção** até o E2E no Preview e a promoção das migrations 0108–0113 no ambiente-alvo.

### 07/10/2026 — camada 4: E2E da revisão humana do repasse no Preview

**Alvo:**

- spec novo `e2e/payout-review-preview.spec.ts`, mais o helper `e2e/preview-dev-runtime.ts` com a prova assinada do runtime, executados antes do commit que os versiona e sem alteração depois da execução;
- Preview do commit `e1aae7c7`, no alias da branch, com deploy Vercel `success` às 19:08 UTC e CI do mesmo SHA verde (lint, typecheck, testes, build, Semgrep e Snyk);
- Auth e banco DEV `pqhkirrszzpwezdaqrai`.

**Comando:** o mesmo launcher local, que injeta o ambiente DEV só em memória, com `E2E_BASE_URL` (o Preview) e `E2E_PAYOUT_REVIEW_MUTATION=dev`. Roda `playwright test e2e/payout-review-preview.spec.ts --project=chromium --workers=1`. O spec aborta sem o opt-in, fora de Preview Vercel, fora do projeto DEV ou sem a prova assinada do próprio Preview.

**Estado inicial (readback):** zero clínicas e zero usuários `e2e-payout-review-%`, zero versões de revisão e zero repasses `reviewed` no DEV.

**Fixture:**

- duas clínicas Pro, A e B;
- cinco usuários Auth com papéis reais: `owner`, `financial`, `attendant` e `doctor` em A, e `financial` em B;
- procedimento de R$ 150, política `GROSS` e regra de 50% para a médica;
- atendimento `atendido` com recebível pendente de R$ 150;
- snapshot do repasse `calculated` de R$ 75. É o único dado que nasce por INSERT, porque o Preview não roda o worker do atendimento concluído.

**Resultado: exit 0, 5/5 PASS em 4,7 min, na primeira execução.**

1. **Pagamento e primeiro estorno.** O dono confirmou R$ 150 e reembolsou R$ 50 pelo Caixa. Depois do pagamento, o repasse seguiu `calculated` em R$ 75. O estorno o suspendeu na mesma transação: `cancelled`, com base e valor nulos e auditoria `suspended` (antes 75,00, motivo `payment_reversed`). A composição mostrou "Suspenso" e o botão de revisão.
2. **Versão 1 pelo financeiro.** O usuário `financial` abriu a revisão e viu teto de R$ 75,00 e referência de R$ 50,00.
   - Com R$ 80, o campo deu erro e o botão ficou desabilitado.
   - Registrou R$ 60,00, e o Caixa passou a mostrar o valor revisado com base de R$ 150,00.
   - No banco, a versão 1 gravou teto 75, referência 50, decisão 60, estorno 50, sem perda e o financeiro como autor; o repasse ficou `reviewed` em 60.
   - A auditoria `reviewed` é única, tem o financeiro como autor e traz os valores **sem o motivo**. Nenhuma resposta idempotente da clínica contém o motivo.
3. **Negativas.** Nenhuma gravou versão.
   - **Atendente:** vê o Caixa e o valor revisado, mas não o formulário. A action direta respondeu "Você não tem permissão para esta ação.".
   - **Médica, beneficiária do repasse:** o Caixa mostra "Sem acesso", e a action direta teve a mesma recusa.
   - **Financeiro de A:**
     - R$ 80 enviado direto à action foi recusado com "O valor revisado não pode passar de R$ 75,00, o cálculo original.";
     - motivo de dois caracteres teve recusa genérica.
   - **Financeiro da clínica B:**
     - com o ID do repasse de A, a action respondeu "Repasse não encontrado nesta clínica.";
     - com a mesma chave de idempotência usada em A, houve recusa (`retry`), sem devolver a resposta guardada de A.
   - **Banco:** uma versão em A, nenhuma em B e uma auditoria `reviewed`.
4. **Versão 2, re-suspensão e planos.**
   - O dono registrou a versão 2, de R$ 55,00. A versão 1 ficou intacta, e um `UPDATE` direto nela foi recusado pela trigger.
   - Um novo estorno de R$ 20 pelo Caixa suspendeu o repasse de novo: `payment_reversed_after_review`, com antes `reviewed`, 55,00 e versão 2.
   - No plano Clínica, o financeiro viu a referência recalculada (R$ 40,00) e registrou a versão 3, de R$ 40,00, com estorno de 70.
   - No plano Solo, a composição perdeu o detalhe de repasse e o formulário. A action respondeu "Políticas de repasse estão disponíveis nos planos Clínica e Pro.".
5. **Sessão revogada.** O plano voltou a Pro. Com a sessão viva, a action chegou ao domínio e o teto recusou o valor. Depois do "Sair", o cookie copiado antes recebeu "Sua sessão expirou. Entre novamente." e nada foi gravado.

**Cleanup e readback independente:** o spec apagou repasses (e, em cascata, as versões), outbox, auditoria e clínicas, e removeu os usuários Auth com GET 404 depois do DELETE. O readback do próprio spec deu zero. A releitura separada também deu zero clínicas e usuários `e2e-payout-review-%`, zero versões e zero repasses `reviewed` no DEV.

**Alcance da prova.** No Preview, com papéis reais, ficaram comprovados:

- permissão por papel, gate de plano Solo/Clínica/Pro e isolamento entre clínicas;
- sessão revogada pelo "Sair";
- versões imutáveis e auditoria sem o motivo;
- re-suspensão por um estorno novo.

Ficam **sem prova no Preview**:

- base `NET`, inclusive o bloqueio quando falta o líquido original;
- perda ou chargeback como gatilho;
- dois revisores simultâneos (lock `FOR UPDATE`);
- o papel `gestor`, que também tem `MANAGE_FINANCIAL`.

Esses pontos estão cobertos só pelos testes locais e pelo Postgres descartável. O snapshot inicial é sintético, e o pagamento foi manual, não Asaas. A camada 4 segue **não aceita para produção** até a promoção da 0113 e das migrations anteriores no ambiente-alvo e a decisão sobre regra fixa acima da base.

### 07/10/2026 — decisões da conta pausada, da regra fixa e do encerramento

**Decisão do usuário em 07/10/2026:** adotar as três recomendações.

- **A, link emitido antes da pausa:** continua pagável e é conciliado. A tela de Pagamentos mostra quantos links seguem abertos ao lado do botão de pausar e no aviso de conta pausada. Não há cancelamento automático na pausa.
- **B, regra fixa acima da base:** é permitida, e o cálculo não muda. O Caixa mostra "Repasse acima do recebido: R$ X para uma base de R$ Y", sempre que o repasse calculado ou revisado passa da base.
- **C, encerramento definitivo:**
  - Uma conta pausada pode ser encerrada pela clínica quando nada está em aberto: nenhum link pagável (`patient_charges.status = 'pending'`), nenhuma devolução sem confirmação (`patient_refund_intents.status <> 'confirmed'`) e nenhuma contestação em andamento (`requested`, `in_dispute` ou `awaiting_reversal`, em cobranças ou créditos).
  - Sem movimentação por 180 dias, ela é encerrada automaticamente, com aviso por e-mail aos donos 30 dias antes.
  - Movimentação nova invalida o aviso e reinicia a contagem. Retomar ou reconectar zera o aviso.

**Implementação:**

- `src/lib/payments/account-closure.ts`: prazos e bloqueios em funções puras.
- `src/lib/payments/account-store.ts`:
  - `readPaymentAccountClosureState` lê bloqueios, última movimentação (maior instante entre conta, cobranças e eventos do webhook) e aviso;
  - `closePausedPaymentAccount` roda sob o mesmo lock da pausa e da reserva de Checkout. Desativa o webhook no Asaas e só então apaga chave e token, com auditoria `payments.account.closed` (`trigger` manual ou de inatividade). Falha externa desfaz tudo e a conta segue pausada;
  - `recordPaymentAccountClosureNotice` grava o aviso com auditoria `payments.account.closure_notice_sent`.
- Action `closePaymentAccount`, com a mesma permissão de conectar e desconectar. Pendência vira mensagem que lista o que impede; falha do Asaas vira "Nada foi apagado; tente de novo".
- Tela de Pagamentos:
  - contagem de links abertos;
  - cartão "Encerrar definitivamente" com confirmação, o que impede o encerramento, a data prevista do automático e a data do aviso;
  - o botão "Tentar desconexão" saiu, porque com histórico não fazia nada.
- Cron diário `/api/cron/payments-account-closure` (10:00 UTC, só em produção pela Vercel):
  - aos 150 dias envia o aviso, com chave idempotente por janela de inatividade e destinatário;
  - aos 180 dias encerra, se o aviso saiu há 30 dias;
  - falha numa clínica não interrompe as outras.
- E-mail `payment-account-closure-notice`; donos ativos lidos por `identity/internal/owner-contacts.ts`. Esse arquivo é uma exceção estreita registrada no ESLint: só `getUserById` no Auth, sem escrita.

**Migration 0115, só no projeto DEV `pqhkirrszzpwezdaqrai`:**

- Adiciona `clinic_payment_accounts.closure_notice_sent_at timestamptz`, anulável e sem grant para `authenticated`.
- Backup completo antes: `qoro-dev-pre-0115-2026-10-07T22-27-11-988Z.dump`, 1.607.072 bytes, 151 s, exit 0, fora do repositório.
- Migração por `scripts/db-migrate-dev.ts`, exit 0.
- Readback `READ ONLY`: marcador presente; ledger com 116 linhas (último `when` 1791609600000); coluna `timestamptz` anulável sem default; `authenticated` e `anon` sem SELECT ou UPDATE na coluna; nenhuma conta com aviso.

**Provas locais:**

- regra de prazos: 8 testes, incluindo aviso atrasado, aviso sem encerramento e movimentação que invalida o aviso;
- action: 5 testes novos (encerra, pendência listada, conta não pausada, falha do Asaas, permissão);
- cron: 6 testes (sem segredo, aviso aos 150 dias, encerramento aos 180, pendência, sem destinatário, falha isolada);
- e-mail: 3 testes;
- status: 2 testes novos e 1 ajustado (conta conectada com links, conta pausada com bloqueios e previsão, conta inativa sem leitura privilegiada);
- donos: 2 testes;
- tela de Pagamentos: 5 testes novos e 1 ajustado, 8 no arquivo;
- Caixa: 2 testes novos;
- teste estático da 0115: 3 testes.

**E2E de Preview:** `e2e/payments-account-lifecycle.spec.ts` passou a provar o encerramento manual contra o Asaas Sandbox. Uma contestação em andamento bloqueia, na tela e sem botão; sem pendência, o encerramento desativa o webhook remoto (`enabled=false`), apaga chave e token e grava a auditoria. **Execução em 07/10/2026:**

- **Alvo:** Preview do commit `2ba6466b`, com deploy Vercel `success` às 22:48 UTC; fixture isolada em DEV; conta Sandbox da clínica; opt-ins `E2E_PAYMENT_ACCOUNT_ISOLATED=1` e `E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`.
- **Resultado:** **6/6 PASS na primeira execução, exit 0, 3,9 min.** O 6º caso provou, nesta ordem:
  - pausa com o cartão de encerramento e sem "Tentar desconexão";
  - contestação em andamento bloqueando, na tela e sem botão;
  - encerramento confirmado: conta inativa, chave e token nulos, aviso nulo e `disconnected_at` gravado;
  - uma auditoria `payments.account.closed` com `trigger: manual` e `remoteWebhookDisabled: true`;
  - o webhook da fixture no Sandbox com `enabled=false`.
- **Estado inicial e final, relidos à parte:** no Sandbox, só os webhooks pré-existentes `…f85a` (desativado) e `…1e3a` (ativo, da `clinica-a`). O cleanup removeu o da fixture. No DEV, zero fixtures `e2e-payments-%`, uma conta de pagamento e nenhuma pausada.

O encerramento automático depende do cron de produção: aviso e encerramento reais por inatividade seguem **NOT RUN**.

### 08/10/2026 — sinal ligado exige cadastro no agente do WhatsApp

**Decisão do usuário em 08/10/2026:** "com o sinal ligado exige o cadastro".

- **Problema:** com `ai_clinic_config.can_schedule_anonymous = true`, o agente marcava consulta para um
  contato sem cadastro. O sinal só pode ser cobrado de paciente identificado com CPF
  (`createDepositCharge` sai sem paciente), então a consulta ficava sem sinal, em silêncio. Visto no
  DEV em 08/10 às 02:24 UTC.
- **Regra:** a opção "agendar sem cadastro" só vale com a política de sinal desligada. É lida no
  instante da decisão, ao preparar e de novo no "SIM", porque a clínica pode ligar o sinal no meio da
  conversa (`anonymousSchedulingAllowed` em `src/contexts/ai-agent/internal/pending-action.ts`).
- **Junto:** o paciente já cadastrado passa a ser reconhecido em qualquer grafia do número (com ou sem
  55, com ou sem o nono dígito). Antes, o cadastro era pedido de novo e falhava no CPF já existente.
- **Prova no Preview, 08/10 (WA-sim→real, conta Sandbox `…08d70a`):** cadastro exigido com o sinal
  ligado; nome, CPF e motivo conduzidos pelo servidor; consulta de 12/10 às 10:00 marcada com o
  paciente; sinal de **R$ 75,00** (50% de R$ 150) criado no Sandbox (cobrança `30e72c2f`) e job
  `deposit_link` enfileirado. No reagendamento, o sinal antigo foi fechado no Sandbox e a varredura
  criou o novo (`cd1c2e3c`). O tick da C14 às 08:01 locais enviou o template do link, mas a Meta o recusou
  com 131042 (moeda/pagamento da WABA de teste não configurados): **BLOCKED** até configurar o Billing da
  Meta. O pagamento segue **NOT RUN**. A recusa posterior da Meta ficava sem retorno ao job da C14, que
  continuava `sent` (EC-32). Corrigido em `84b3b413`: uma nova recusa leva o job a `failed` com o
  código da Meta (`meta_131042`).
- Registro completo: [`docs/quality/whatsapp-ai-hardening-2026-10-08.md`](../quality/whatsapp-ai-hardening-2026-10-08.md).

### 08/10/2026 — dinheiro na recepção, sinal pelo link e "já paguei"

**Decisão do usuário em 08/10/2026:** "quando o sinal está ativo, ele só confirma agendamento mediante
o pagamento pix do sinal, o restante pode ser entregue em dinheiro. quando ele está desativado, o
agendamento pode ser feito sem o sinal. em ambas as opções, deve haver a opção de pagou o restante em
dinheiro ou pagou em dinheiro no sistema" — e "isso deve ficar claro para o usuário na UI". Junto, para
o "já paguei": fazer o recomendado e "adicionar a lógica de pago com dinheiro".

- **Agendamento pelo WhatsApp (`prepare_appointment`):**
  - **Com sinal aplicável** (política ligada, tipo de consulta no escopo, valor acima do mínimo do
    gateway): "tudo em dinheiro" não vale para marcar. O agente oferece os preços com link e diz que o
    restante pode ser pago na clínica, inclusive em dinheiro.
  - O resumo traz o sinal e o restante com valores. Eles vêm de uma prévia sem efeito
    (`previewDepositForBooking`), que repete a decisão do `createDepositCharge`.
  - A confirmação diz que o horário fica reservado por até 24 horas até o pagamento do sinal.
  - **Sem sinal:** dinheiro aparece como opção, com o preço configurado. O agendamento sai com
    `commercial_payment_method = cash`: sem Checkout e sem link do restante, como a recepção já fazia.
  - **Cartão em 1x continua** onde a clínica tem preço de cartão. A frase do usuário fala em "pix do
    sinal"; restringir o sinal só a Pix é decisão em aberto.
- **Caixa:**
  - Dinheiro sempre quita o recebível do atendimento, pelos botões "Pagou em dinheiro" e "Pagou o
    restante em dinheiro" (`assertAppointmentPaymentMethod`).
  - A condição comercial continua valendo para os outros meios: cartão no lugar do Pix combinado segue
    recusado.
  - O recebível só nasce com o atendimento concluído, então o botão nunca aparece com o sinal ainda
    pendente.
- **Link do restante:**
  - Um registro manual no Caixa (`financial.lancamento.paid` com `source: manual`) fecha o link do
    restante que ainda estiver aberto (`closeRemainderAfterManualPayment`).
  - Se o paciente pagar o link no mesmo instante, o erro é retentável: nenhum pagamento real é apagado,
    e o excedente segue o fluxo de devolução existente.
  - Depois de um registro manual, a cobrança do saldo é da recepção e o link não volta.
  - O envio do link do restante agora espera 2 horas depois da conclusão (`REMAINDER_LINK_DELAY_MS`),
    para a recepção registrar o dinheiro antes. O link do sinal continua imediato.
- **"Já paguei":** o servidor responde pelo status real da cobrança (`listPatientChargeStatuses`):
  - paga: confirma, com o valor;
  - pendente: diz que a confirmação ainda não chegou; se o paciente insiste, vai para a equipe;
  - pagamento em dinheiro: vai para a equipe (o sinal é só pelo link);
  - sem cobrança: vai para a equipe.

  Nunca dá nada como pago pela palavra do paciente nem por foto de comprovante. Arquivo recebido vai
  para a equipe.
- **Na tela:** o quadro "Como o paciente paga" na configuração do sinal, e os botões de dinheiro no
  Caixa.
- **Fora do modelo:** sinal pago em dinheiro antes da consulta. Não há como registrar; a equipe orienta
  o pagamento pelo link.

### 12/10/2026 — prova integrada do sinal ainda pendente

Foi preparado um modo do `scripts/payments-meta-e2e.ts` que preserva um único
Checkout de sinal no **Asaas Sandbox** depois do template consentido, para que
o paciente de teste possa pagar pelo link recebido. O preflight mede banco/Auth
DEV, Preview, callback e janela C14; a configuração do webhook Sandbox só muda
com opt-in adicional e readback. A execução externa parou antes da fixture porque
era 00h local e o envio C14 só é permitido a partir de 08h. Portanto, a cadeia
Meta → pagamento → webhook → crédito → Caixa permanece **NOT RUN**, não PASS.
Comandos, evidência e retomada: [registro operacional](../quality/integracao-2026-10-09.md).
