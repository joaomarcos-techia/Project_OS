# Continuidade — renovação e homologação financeira

Iniciada em 09/11/2026, vinculada ao [plano mestre](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md), ao [diário anterior](PLANO-EXECUCAO-CONTINUIDADE.md) e à [matriz financeira](MATRIZ-CENARIOS-E-TESTES.md). Não redefine preços, trial, cotas, contratos legados ou pagamentos dos pacientes. O anexo desta rodada termina no início da seção R4; os requisitos completos R1–R3 e as pendências enumeradas permanecem aplicáveis.

## Baseline e destinos conferidos antes das edições

- Branch `feat/billing-abacatepay-20261107`, worktree `C:/dev/Qoro_billing_abacatepay_20261107`, HEAD inicial `049c2e033269777e648e683e2b5e25506cd55b2b`. PR #53 aberto/draft; CI, Vercel, Semgrep e Snyk SUCCESS; revisão automática NEUTRAL. Worktree inicialmente limpo.
- Preflight de leitura em `2026-11-09T04:40:32Z`: DEV conhecido com 140 migrations, nenhuma pendente/aplicada e nenhuma escrita em Produção.
- Readback Sandbox em `2026-11-09T04:40:35Z`: checkout retido PAID, 39.700/39.700 centavos; assinatura retida CANCELLED/CARD, sem trial nativo. Nenhuma mutação. Não reutilizar o pagamento inicial para renovar; não reativar essa assinatura para testar.
- Período preservado da fixture: `2026-11-09T00:31:10.888Z` até `2026-12-09T00:31:10.888Z`, correspondente ao término em **08/12/2026, 21:31:10.888, America/Sao_Paulo**. É um dado dessa fixture, nunca uma data global.
- Os 6.558 testes, 47 verificações PostgreSQL, cancelamento externo e inspeções anteriores permanecem evidências históricas válidas. Os dois SKIP de Turnstile não recebem PASS.
- Worktree principal e branch de UI não serão editados. Nenhuma migration remota, nova cobrança ou alteração de configuração de deploy está implicitamente autorizada.

## Descoberta e limites confirmados

Fonte oficial atual conferida: `AbacatePay/documentation`, SHA `b221a381d3363ab3eb384134ff4567e60c001225`, igual ao snapshot anterior. [Eventos de assinatura](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [GET assinatura](https://docs.abacatepay.com/pages/subscriptions/get), [extrato](https://docs.abacatepay.com/pages/bank-statement/reference), [CLI pagamentos](https://docs.abacatepay.com/pages/cli/payments).

- `subscription.renewed` tem IDs próprios de pagamento e checkout do ciclo. O `checkoutId` do GET de assinatura é o checkout de **origem**. O leitor anterior de CARD_APPROVED, vinculado ao checkout original, não basta para provar a cobrança de outro checkout.
- O GET de assinatura não documenta início/fim do período ou próximo vencimento. `ACTIVE`, `createdAt` e `updatedAt` não provam uma nova cobrança. Os exemplos do webhook não substituem o readback financeiro.
- O extrato identifica pagamento/checkout, valor bruto e aprovação do cartão. `CARD_APPROVED` não é liquidação. A ligação com a assinatura deve vir de evento autenticado e vínculo persistido; não inferir por cliente, preço ou proximidade das datas.
- Não foi localizada rota oficial de aceleração de renovação. O comando CLI `payments simulate` chama somente `/transparents/simulate-payment`, destinado a cobranças transparentes. Não usá-lo como se renovasse uma assinatura.
- Inadimplência existente: `dunning.ts`, `tenant-access` e crons. Não ampliar/reduzir carência por decisão técnica. Falha do provider e cancelamento por esgotamento de retries precisam de evidência e política própria, sem reaproveitar o cancelamento voluntário.
- Eventos negativos ficam em revisão no worker atual, sem modificar direitos. Refund parcial, disputa ganha/perdida e restauração de acesso não serão inventados a partir de status genérico.

## Decisões aprovadas em 09/11

O founder aprovou: **“Sim, manter o calendário original e revisar ambiguidades”**. O calendário mensal de acesso parte da primeira geração paga; confirmação atrasada não inicia outro mês. Isso não comprova o próximo vencimento do provedor. O avanço exige cobrança integral, cliente/assinatura/checkout/pagamento vinculados, produto e valor corretos e ciclo verificável. Datas ambíguas permanecem em revisão.

A autorização posterior **“pode aplicar as migrations”** cobre somente a pendência **0140 no DEV**, dentro do escopo desta branch. A 0139 já estava aplicada e não foi executada novamente. A 0140 foi aplicada e passou no postflight em **09/11, 05:30 UTC**, conforme o registro abaixo. Produção, contratos reais, novos pagamentos e mudanças de política continuam fora do escopo.

## Roadmap operacional e arquivos previstos

| ID | Objetivo e arquivos | Dependências / procedimento | Testes e edge cases | Evidência / gate / status | Risco / rollback |
| --- | --- | --- | --- | --- | --- |
| R0 | Este documento, plano mestre e matriz | Conferir Git, DEV, Sandbox e contrato V2 antes de código | IDs, ambiente, origem e preservação da fixture | Leituras acima; PASS no preflight | Sem mutação; preservar histórico |
| R1a | `lib/payments/abacatepay/renewal-payment.ts`, `card-statement.ts` e testes | Separar checkout de origem/ciclo e pagamento; readback de conta, produto, assinatura, checkout e extrato | REN-001–008, 011–015, 018–020 no escopo do leitor; páginas, valor parcial, cliente/ambiente errado, pagamento inicial, saldo versus aprovação | PASS: 43 testes novos do leitor e 28 testes existentes de recibo, HTTP sintético; renovação externa NOT RUN | Não concede acesso isoladamente; manter composição atual |
| R1b | Migration `0140_saas_recurring_payment_observations.sql`, `abacatepay-recurring-observations.ts`, `abacatepay-renewals.ts` e prova PostgreSQL | IDs por cobrança; unicidade; snapshots; transação; DEV autorizado expressamente | Concorrência, rollback, privilégios/RLS, imutabilidade, geração anterior e isolamento | PASS local: 22 verificações, 141 migrations reais; PASS DEV: histórico 140 → 141, postflight e dados anteriores preservados | Preservar tabelas/obrigações; schema antigo fecha o processamento novo em revisão |
| R1c | `billing/internal/abacatepay-processing.ts`, `abacatepay-renewal-period.ts` e reconciliador | Calendário aprovado + identidade/ciclo verificáveis; efeito uma vez e auditoria | Atraso, mês/ano, timezone, cancelamento, geração antiga, ordem invertida, retry e corrida | PASS local: 15 testes de calendário, 16 do worker e ensaio PG; PARTIAL global: renovação externa e recuperação de evento totalmente ausente NOT RUN | Não estender acesso por evento ambíguo; nenhuma assinatura paralela |
| R2 | Falhas/inadimplência e testes | Ler semântica de retries e motivo de cancelamento; reaproveitar política existente | Falha antes/depois do sucesso, atrasado, tolerância, regularização e evento perdido | Sem suspensão prematura; NOT RUN | Falha de API não é recusa financeira; revisão |
| R3 | Refund/disputa e testes | Readback ligado à cobrança; impacto no acesso somente com política explícita | Total/parcial, ciclo anterior, duplicidade, pós-cancelamento/upgrade e reversão | Estado financeiro separado dos direitos; NOT RUN | Não apagar invoice nem revogar automaticamente |
| R4 | Journal/reader de checkout desconhecido | Pesquisa documentada por referência, sem retry de POST; identidade completa, resultado único | Vazio, múltiplo, cursor repetido, conta errada, replay e retorno perdido | Sem segunda recorrência; NOT RUN | Resultado ambíguo permanece retido |
| R5 | Upgrade/downgrade/médico extra | ADR-068 C: cota só após próxima renovação paga no novo valor; depende de R1 | Ocupação, substituição pendente, cancelamento e preço incorreto | Sem cobrança proporcional ou benefício antecipado; NOT RUN | Manter cota anterior e histórico |
| R6 | Recontratação externa e E2E | Fixture cancelada preservada até o prazo; sem deslocar datas de DEV | Nova geração, sem novo trial, invoice/IDs antigos preservados | Local já PASS; externo NOT RUN | Não pagar checkout antigo ou criar conta redundante |
| R7 | Turnstile e encerramento | Investigar dois SKIP e execução isolada com chaves oficiais de teste, sem alterar Produção/CI | Backend positivo/negativo, widget e configuração coerente | SKIP histórico preservado; NOT RUN nesta rodada | Não usar always-pass como prova negativa |

O recorte R1 acima foi implementado sem dependências novas, alterações de CI/deploy ou de contratos públicos. R2–R7 não herdam PASS dos testes R1. Reembolso/disputa/falha continuam em revisão; os ensaios que confirmam ausência de efeitos nesses eventos não comprovam a gestão completa dessas situações.

## Rastreabilidade e registro de execução

Requisito → regra aprovada → implementação → teste → evidência → gate. REN-016 anual novo permanece indisponível: o caso deve provar recusa e preservação do Asaas anual legado, não oferecer recorrência anual AbacatePay. REN-017 depende da ADR-068 C e de prova do novo produto/valor; aceite de `PENDING` não libera assentos.

O primeiro checkpoint foi somente investigação. A execução posterior implementou R1a–R1c conforme as decisões acima, sem criar cobrança, nova conta ou evento financeiro externo. A prova PostgreSQL usa dados sintéticos e HTTP de fixture; **não é renovação temporal Sandbox**.

### Limites do avanço de acesso

- `RecurringPaymentEvidence` não possui datas de período/vencimento remoto. O calendário fica no domínio Qoro.
- A criação do checkout do ciclo precisa coincidir com um aniversário mensal, com tolerância técnica de 60 segundos. Fora disso, o código não deduz qual mensalidade foi paga: mantém revisão. Essa regra conservadora ainda precisa ser confrontada com uma renovação externa; não é promessa de que o provedor emite a cobrança nesse exato instante.
- Aritmética de calendário usa a âncora original e UTC: 31/jan → último dia de fev → 31/mar. O SQL também verifica os dois limites em UTC, independentemente do timezone da conexão.
- A janela de busca de recibo é fixa em relação ao recebimento durável do evento, limitada a 31 dias anteriores e 60 segundos posteriores. Evento muito antigo ou fora dessa janela exige revisão; não renovar usando o recibo inicial.
- Cancelamento solicitado, geração antiga, assinatura anual, alteração de plano pendente, valor divergente ou recorrência parada não liberam um período novo. Pagamento verificado pode ser preservado como histórico financeiro sem reativar direitos.
- Há recuperação de retry do evento já recebido e rollback atômico. **Ainda não há descoberta de uma renovação cujo evento nunca entrou no inbox**: o extrato não demonstra sozinho o vínculo ao contrato. Não inferir esse vínculo por cliente/preço nem fabricar evento.

### Verificações locais executadas

1. Leitor novo (43), leitor anterior (28), calendário (15) e worker anterior (16): **102/102 PASS**, quatro arquivos, `dist/renewal-focused.log`.
2. `tsx --conditions=react-server scripts/security/abacatepay-renewal-db.ts`: **22/22 PASS**, 141 migrations reais, zero chamadas externas e 16 chamadas HTTP sintéticas. Evidência: `dist/abacatepay-renewal-db.json`.
3. TypeScript, ESLint e Prettier dos arquivos de código: PASS. Guarda de DB: 1.730 arquivos, zero achados; segurança de migrations: PASS. Inventário regenerado para registrar quatro acessos de ambiente do novo ensaio sintético; nenhuma superfície/variável pública adicionada.
4. A primeira tentativa de coverage não iniciou testes por conflito entre `minWorkers` automático e `maxWorkers=2`; não é falha de produto nem execução aprovada. A repetição `vitest run --coverage --minWorkers=1 --maxWorkers=2` passou: **6.616/6.616 testes, 606 arquivos**, zero falhas, exit0, duração 565,62s. Cobertura: linhas/statements 62,49%, funções 66,42%, branches 83,07%; todos os pisos preservados. Log: `dist/renewal-coverage-retry.log`.
5. Preflight DEV em `2026-11-09T05:19:44Z`: 140 migrations, somente 0140 pendente, histórico comparado por timestamp e hash, diferenças históricas conhecidas preservadas, schema novo ausente integralmente, zero escrita. Evidência: `dist/gateway-dev-0140-preflight.json`.
6. Regressão PostgreSQL `signup-free-trial-db.ts`: **47/47 PASS**, 141 migrations, zero chamadas externas, 332 chamadas HTTP sintéticas; confirma preservação do trial, cancelamento e duas gerações de recontratação após a mudança do worker. Arquitetura circular: zero ciclos; observabilidade: 21 crons/14 eventos coerentes; registry: 72 eventos/32 handlers e 40 produtores adiantados permitidos.

### Aplicação autorizada 0140 no DEV

Transação iniciada em `2026-11-09T05:29:53Z` e postflight concluído em `2026-11-09T05:30:03Z`. Histórico **140 → 141**, somente `0140_saas_recurring_payment_observations`, SHA-256 `98269c83b754785a7e9ecf0b2b4b142ff121cc22b56b8f3055575299ba8ca330`.

- Destino limitado ao projeto DEV conhecido; SSL obrigatório, conexão de sessão, guard de projeto, histórico e schema parcial. Não houve conexão/escrita em Produção pelo operador.
- Lock transacional compartilhado com o migrador, `lock_timeout=5s` e `statement_timeout=120s`. Falha de pré-condição, preservação ou privilégio abortaria a transação inteira.
- Comparação por contagem e digest de **18 tabelas existentes**: subscriptions, clinics, profiles, cotas, planos/preços, invoices, tentativas e os nove históricos privados anteriores. Conteúdo e privilégios anteriores preservados.
- As duas tabelas novas ficaram vazias: nenhum pagamento, invoice, benefício ou evento foi fabricado para validar a migration.
- Schema privado agora com 11 tabelas. Nas duas novas: FORCE RLS, zero acesso anon/authenticated, service_role somente SELECT/INSERT, duas constraints de calendário UTC e dois triggers de imutabilidade.
- [Evidência sanitizada e nível de prova](evidencias/renewal-0140-20261109.json). O checkpoint não declara build/CI do novo commit concluídos: conferir os checks do HEAD no PR #53 antes de qualquer avanço de ambiente.

A aplicação do schema não comprova a renovação no provedor. O próximo gate financeiro continua sendo a prova específica do ciclo externo e a recuperação de uma renovação totalmente ausente do inbox, sem reutilizar o checkout inicial, criar cobranças desnecessárias ou modificar as datas da fixture retida.
