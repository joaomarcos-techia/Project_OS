# Fechamento operacional da AbacatePay — 10/11/2026

## Escopo e baseline preservada

**Checkpoint mais recente — lote sob pedido 10/11:** [relatório §37](RELATORIO-HOMOLOGACAO-FINAL.md#37-dev-recuperado-inventário-financeiro-e-lote-sob-pedido--10112026). Data API DEV foi habilitada pelo founder e REST voltou 200; schema financeiro privado e dados anônimos protegidos. Preflight144 passou, incluindo a 0143 TISS exata revisada, sem aplicar/copiar migrations. CI `fd90ded7` passou 6.897 testes e 18 E2E/zero SKIP. A regressão nova passou 2.247 testes; a CI própria do incremento é registrada no PR. O founder agora pediu **aguardar “crie os checkouts”**: Consultório 1 e Clínica 3/4/5 pendentes,2 pago preservado. [Auditoria Vercel](AUDITORIA-VARIAVEIS-VERCEL.md) e [inventário financeiro](INVENTARIO-FLUXOS-FINANCEIROS.md) distinguem legado, paciente, Sandbox e live. Esta preparação não dispensa B1–B4 ou implementa composição live; **NO-GO financeiro Production** permanece.

Execução na branch `feat/billing-abacatepay-20261107`, worktree `C:/dev/Qoro_billing_abacatepay_20261107`, PR #53 draft. Baseline `c712b743dbb14556c2878d05a1877f77a055b623`: CI `42723322325` aprovada, 6.777 testes, build e gates; E2E público 8 PASS / 2 SKIP de Turnstile sem chaves. A `main` contém o PR #54, merge `5620a0987ec53db7d7358728eb7d457d9d373df3`, publicado com autorização anterior. Não reimplementar o cadastro. Quatro exclusões antigas de vídeos no worktree são alheias e ficam fora dos commits.

Produção, contratos Asaas, desconto vitalício, pagamentos de pacientes e a fixture paga retida ficam intactos. Não há merge, ativação financeira, nova cobrança ou deleção remota nesta rodada. O agente de UI trabalha separadamente.

**Decisão complementar do founder, 10/11:** permitir **2–5 médicos já na primeira contratação AbacatePay**, a R$ 397/544/691/838 por mês, mantendo Consultório R$ 197 e 3 administrativos incluídos. Implementada na candidata, preservando trial, bloqueios e preços do servidor; mudanças após uma assinatura já paga continuam na próxima renovação paga. A UI `ui/refactor-qoro-20261108` foi lida e já aceita o mesmo protocolo; não foi reescrita nem mesclada neste incremento. PASS 222 testes dirigidos e 18 checks PostgreSQL de criação/recuperação/primeiro pagamento (10 novos). [Evidência](evidencias/contratacao-inicial-catalogo-20261110.json). Isso não equivale a novo pagamento externo de 3–5 médicos nem à junção visual das branches. Gates de go-live abaixo permanecem.

## Fonte e garantias

**Checkpoint posterior de integração visual:** [relatório, seção 36](RELATORIO-HOMOLOGACAO-FINAL.md#36-fechamento-da-primeira-contratação-e-integração-visual--10112026) e [evidência de source](evidencias/fechamento-primeira-contratacao-ui-20261110.json). A moldura e o resumo do plano do redesign foram integrados de forma limitada, com handlers financeiros preservados. PASS 236 testes dirigidos/tipos/lint; os novos oito E2E de apresentação e os dois testes Turnstile antes ignorados entram na CI isolada do incremento. O estado remoto final é registrado no PR #53, sem herdar a CI anterior. A preparação/compra Sandbox de cinco médicos foi autorizada no pedido desta rodada, mas pagamento, webhook e cinco vagas não recebem PASS antes da prova real. Nenhum gate live abaixo foi dispensado.

Para reproduzir os testes de UI sem contas ou credenciais reais, no worktree financeiro: `pnpm security:build`, `pnpm security:bundle`, `pnpm security:http`, `pnpm test:e2e:ci`. O primeiro comando gera uma cópia em `dist/security-local/app` com backends sintéticos e um harness público somente dentro dessa cópia; não gera rota publicável no source. O par Turnstile é público/oficial de teste. O teste de UI utiliza respostas HTTP controladas, portanto não substitui a fixture externa. Build/CI novos foram expressamente autorizados; não há modificação da Vercel ou de secrets de Production.

Inventário de nomes/escopos em 10/11 às 15:36 UTC, sem decrypt: **Production não contém** `SAAS_SIGNUP_PROVIDER`, `ABACATEPAY_API_KEY`, `ABACATEPAY_STORE_ID`, `ABACATEPAY_SANDBOX_PLAN_PRODUCTS` ou `ABACATEPAY_WEBHOOK_SECRET`; contém os nomes Asaas e Turnstile esperados. Presença de nomes não prova valores, saldo ou operação. Composição live continua ausente e não se resolve copiando chaves Sandbox. Nenhuma configuração foi alterada.

Ver [resposta integral encaminhada pelo founder](SUPORTE-RESPOSTA-INTEGRAL-20261110.md), [solicitação e matriz E1–E4](SOLICITACAO-SUPORTE-HOMOLOGACAO.md), ADR-068 a ADR-071 e [relatório anterior](RELATORIO-HOMOLOGACAO-FINAL.md). Consulta oficial de 10/11: [eventos de assinatura](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [webhooks](https://docs.abacatepay.com/pages/webhooks/reference), [fonte oficial de exclusão](https://github.com/AbacatePay/documentation/blob/main/pages/subscriptions/checkouts-delete.mdx).

O suporte confirma múltiplas assinaturas por checkout, ausência de API de histórico por assinatura e ausência de simulador de renovação/reembolso/disputa recorrente. Não confirmou invalidação do link pago e preservação de todas as consultas após exclusão. A documentação não complementa essa garantia. Portanto, fechamento remoto permanece bloqueado, sem comando implementado por inferência.

## Plano de execução

| ID | Objetivo | Dependências | Arquivos | Implementação | Testes | Evidência | Risco | Rollback | Gate | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| B1.1 | Preservar contratação individual, CAS e quarentena | Baseline | adapters, inbox, integrity | Existente; revisar cenários afetados | Regressão dirigida | CI baseline e relatório | Link remoto pode ser compartilhado | Manter aquisição bloqueada | B1 | PASS local; garantia externa BLOCKED |
| B1.2 | Fechar URL sem prejudicar recorrência | Garantia e ensaio externo oficial | Nenhum comando novo | Proibido até confirmação | Não executar na fixture retida | Suporte item 3 | Cobrança remota duplicada | Não chamar delete/cancel | B1 | BLOCKED externo |
| B2.1 | Detectar fim do período sem renovação comprovada | Período pago e geração atuais | `abacatepay-renewal-watch.ts`, cron | Implementado: alerta e resolução sem alterar direitos | PostgreSQL, concorrência, datas e cancelamento | OPS-009–012 e prova 66/66 | Atraso não prova pagamento perdido | Preservar auditoria; conter aquisição | B2 | PASS local; notificação externa NOT RUN |
| B2.2 | Reprocessar evento em revisão com autorização | Superadmin MFA, snapshot e auditoria | 0142, `abacatepay-review.ts`, admin/operacao | Implementado: uma tentativa extra, sem editar prova financeira | PostgreSQL, RBAC, CAS, lease e duplicidade | OPS-001–008/013–015; migration DEV PASS | Operador não substitui prova remota | Não autorizar novos reprocessamentos; preservar histórico | B2 | PASS local/DEV; jornada admin real NOT RUN |
| B2.3 | Operar ausência completa de evento | Suporte/prova oficial do ciclo | Runbook | Coleta e recuperação via canal oficial; sem lançamento financeiro arbitrário | Revisão do procedimento | API sem histórico por assinatura | Pagamento não reconstruível automaticamente | Suspender novas aquisições, preservar consumidores | B2 | CONDITIONAL, aceite pendente |
| B3 | Homologar ciclo/refund/disputa reais | Capacidade externa ou tempo natural | Fixtures existentes e matriz | Preservar testes locais e fixture paga | Apenas testes locais afetados | Suporte itens 1/4 | Sem simulador recorrente | Sem cobrança/estorno artificial | B3 | BLOCKED externo |
| B4 | Preservar cadastro PR #54 | Main já integrada | Código de cadastro sem alteração | Validado na baseline | Regressão afetada e CI | Relatório seções 28–29 | Regressão de integração | Reverter correção isolada | B4 | PASS baseline |
| B5/B6 | Revisão adversarial e regressão | Implementações B2 | Novos testes e scripts | Executada revisão pelo mesmo executor | Types/lint/inventário, 793 testes financeiros + 63 finais afetados, PG 66/66 | Snapshots e CI própria no PR | Não é auditoria independente | Corrigir e repetir afetados | Segurança | PASS local; build/CI a registrar no PR |
| B7 | Roteiro, riscos e decisão de lançamento | B1–B6 | Este plano e runbooks | Preparação sem ativar | Revisão de configuração/código | Diário abaixo | Sandbox não habilita produção | Preservar provider por contrato | Produção | NO-GO |

## Decisões que não mudam

- Trial de 14 dias desde Auth, sem cartão inicial; cotas e bloqueios continuam até pagamento integral confirmado.
- Calendário mensal original; novo plano/cota somente após renovação paga correspondente. `ACTIVE`, valor/data semelhantes e relato do cliente não são comprovantes de ciclo.
- Cancelamento remoto irreversível, acesso até o período pago; nova contratação depois desse fim, sem novo trial.
- ADR-071: reembolso/disputa mantém período pago e gera revisão; evento antigo não encurta período novo. Nenhuma nova carência será introduzida.
- Um operador poderá solicitar nova leitura de um evento já autenticado; não poderá fornecer valor, período, identificador de pagamento substituto ou marcar como pago.

## Diário

- 10/11: verificados HEAD, PR #53 draft e CI verde; PR #54 mesclado e presente na branch financeira. Leitura da resposta integral e da fonte oficial: B1 externo continua sem garantia. Identificada lacuna B2: monitor de recorrência não alerta sobre período local vencido sem renovação. Ainda não há resultado de novos testes nesta rodada.
- 10/11: implementados monitor de período, ledger de autorização, ação superadmin com TOTP atual e painel operacional. O worker conserva contador cumulativo, lease e readback; não existe override financeiro.
- 10/11, 04:36 UTC: 0142 aplicada somente no DEV após preflight de 142 migrations. As seis diferenças históricas de hash coincidem exatamente com a baseline registrada em 30/10; não foram regravadas nem reaplicadas. Pós-aplicação: 143 migrations, RLS forçada, service_role somente SELECT/INSERT e fingerprint dos contratos preservado. Nenhuma chamada ao provedor ou escrita em Production.
- 10/11: 66/66 verificações PostgreSQL, 143 migrations reais, 202 chamadas HTTP sintéticas, zero rede externa. A suite anterior de 51 checks foi repetida porque o claim/budget do worker mudou; 15 checks operacionais são novos. Três preparações de teste anteriores falharam: asserção não lia o `cause` do Drizzle, fixture tentava mudar provider imutável, slug excedia a constraint. Os controles do produto recusaram essas operações; as fixtures/asserções foram corrigidas, sem retirar validações. A primeira execução da UI pediu jsdom ausente; passou após usar happy-dom já adotado no repositório, sem nova dependência.
- 10/11: regressão dirigida 793/793; após os últimos incrementos de cobertura, 63/63 testes finais nos cinco arquivos afetados. Não somar essas duas contagens: elas se sobrepõem. TypeScript, lint integral e inventário passaram; os checks remotos do SHA publicado ficam no PR #53 para não repetir a suite inteira por uma atualização documental.
- 10/11: Chromium identificou que o `pattern` HTML do identificador de incidente precisava escapar o hífen para o modo de regex usado pelo navegador. Corrigido sem mudar a validação server-side. PASS 5/5 restrições nativas em Chromium e 5/5 testes de tela repetidos. Isso não é jornada autenticada admin/MFA no Preview. Script reproduzível `scripts/security/abacatepay-review-form-browser.ts`, sem conta nem rede externa.
- 10/11: detectado risco de uma próxima migration receber versão lógica anterior à 0142, cujo `when` equivale a 16:00 UTC. A 0142 já aplicada foi preservada. Acrescentado ao checker existente um gate de ordem lógica/prefixos, com teste de regressão; não modifica CI/deploy nem timestamps históricos. O [runbook de migrations](../../runbooks/migrations.md#ordem-lógica-do-journal) orienta somente a próxima entrada ainda não aplicada. Esse incremento não exige outra migration ou repetir provas financeiras.
- 10/11: commit financeiro `5f216739`, [CI 42758707597](https://github.com/joaomarcos-techia/Project_OS/actions/runs/42758707597) SUCCESS: **6.807/6.807 testes**, build, segurança/isolamento e E2E público **8 PASS / 2 SKIP** Turnstile. Preview `dpl_ED6z2Zeqv5binTJLHETjA2DepBsv` READY; fronteira anônima nova **3/3** (1440 px, 390 px e RSC), sem conta, acesso a dados ou chamada financeira. O incremento posterior de ordem lógica mantém os 16 hashes anteriores e runtime do app iguais; seu check adicional local passou 24/24 e sua CI própria é registrada no PR #53.

- 10/11, fechamento da matriz solicitada pelo founder: **85/85 checks PostgreSQL** (19 novos sobre os 66 anteriores), 143 migrations, 349 chamadas HTTP sintéticas e zero rede externa; **168/168 testes dirigidos** (14 novos), TypeScript/lint/formato PASS. A matriz cobre 3/4/5 médicos, R$ 544/691/838, pagamento exato, deduplicação, cota/CRM, teto administrativo e downgrade. A contratação inicial continua restrita aos planos de entrada; extras entram na próxima renovação paga. As opções correspondentes foram conferidas na UI real da fixture paga, sem POST financeiro. [Evidência](evidencias/checkout-variantes-20261110.json). Sem nova cobrança ou mudança comercial/runtime. A CI de `49b2df95` passou com 6.855 testes/build e 8 E2E PASS/2 SKIP; a CI própria da matriz fica no PR #53.

## Implementações e arquivos

- `src/contexts/billing/internal/abacatepay-renewal-watch.ts`: somente contratos AbacatePay Sandbox com prova inicial paga, geração vigente e período vencido. Até 10 por chamada, backoff de uma hora, orçamento de 7 segundos, SQL 5 segundos/lock 2 segundos. Um comando SQL iniciado dentro do orçamento pode terminar depois dele; o cron reavalia o orçamento antes de iniciar GETs. Registra abertura/resolução por fingerprint sob lock e sinal seguro de incidente/cobertura adiada. Não cria invoice, cobrança, extensão de acesso ou nova carência.
- `src/contexts/billing/internal/abacatepay-review.ts` e `abacatepay-processing.ts`: CAS de snapshot, conta/clínica/cliente/assinatura verificáveis, tentativa adicional única. Até 3 autorizações por evento/24h; não reiniciar o limite padrão de 10. Leases abandonadas são encerradas sem GET extra além do orçamento autorizado.
- `drizzle/migrations/0142_saas_review_replays.sql` e journal: tabela privada com FK composta, snapshot imutável, trigger de vínculo/ator/limite, RLS FORCE e privilégios mínimos. Nenhum backfill, alteração de contrato ou edição de migration histórica. Aplicação futura em Production continua proibida sem janela autorizada.
- `src/app/(admin)/admin/actions/abacatepay-review.ts`: guard de superadmin AAL2, TOTP novo, autorização e `super_admin_actions` na mesma transação, leitura imediata do worker após commit. Em timeout, a autorização permanece durável; nunca retornar “pago” por uma decisão do operador.
- `src/app/(admin)/admin/billing/operacao/*` e repositório: fila, revisões, renovações sem comprovação e quarentena sem formulário quando falta vínculo. Referência do incidente aceita só código opaco, sem valor/período/recibo. Até 50 por lista; backlog maior não é ocultado na contagem.
- `src/app/api/cron/billing-reconcile/route.ts`, testes e `e2e/admin-boundary-rbac.spec.ts`: integração no cron existente com orçamento, nova rota no teste de fronteira. A agenda diária das 09:00 UTC não foi modificada.
- `scripts/security/abacatepay-renewal-db.ts`: 15 novos cenários reais de banco, incluindo corrida de operadores, falta de privilégio, estados terminais, rollback, mesma cobrança em eventos diferentes, monitor concorrente e consulta da quarentena.

## Matriz de cenários e prova

| ID | Requisito | Implementação | Teste | Ambiente | Resultado | Evidência | Risco | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-001/002 | Nova leitura sem override financeiro | Ledger + mesmo worker | Contador preservado; GET falho; recuperação paga uma vez | PG isolado/HTTP sintético | PASS | [snapshot](evidencias/operacao-final-20261110.json) | Não prova renovação temporal | PASS local |
| OPS-003–008 | Operador autorizado e limite | Trigger + MFA + CAS | 8 concorrentes, owner recusado, cross-tenant, terminal, 3/dia, grants | PG + unidade | PASS | Mesmo snapshot e fontes de teste | MFA real externo não ensaiado | PASS local |
| OPS-009–012 | Detectar/resolver sem inventar pagamento | Monitor local | 8 scans, nova renovação, cancelamento/futuro, trial/Asaas | PG isolado | PASS | Mesmo snapshot | Alerta externo e capacidade pendentes | PASS local |
| OPS-013/014 | Atomicidade e duplicidade | Transação e prova por pagamento | Rollback após autorização; 2 eventos/mesmo pagamento | PG isolado | PASS | Mesmo snapshot | Nenhum provider POST | PASS local |
| OPS-015 | Quarentena acessível sem edição | Repositório admin | Evento não vinculado visível, sem formulário elegível | PG isolado | PASS | Mesmo snapshot | Não resolve falta de correlação | PASS local |
| UI-OPS | Interface e RBAC | Página/ação novas | 5 UI, 15 ação, 8 entrada; sem editar preço/período; TOTP e guard | happy-dom/unitário | PASS | Fontes de teste; 63 finais incluem regressões | Não é sessão admin real no Preview | PASS local |
| DEV-0142 | Schema privado sem alterar contratos | Migration aditiva | Histórico, RLS, grants e fingerprint | DEV | PASS | [readback](evidencias/0142-dev-20261110.json) | Seis hashes antigos preservados | PASS DEV |
| EXT-B1 | URL paga efetivamente invalidada | Operação remota bloqueada | Não executar delete sem garantias | Sandbox | Não executado | Suporte item 3 | Reutilização e duplicidade remota | BLOCKED |
| EXT-B3 | Renovação/refund/disputa recorrente reais | Código existente preservado | Sem simulador, sem pagamento repetido | Sandbox | Não executado nesta rodada | Suporte itens 1/4 | Não substituído por mocks | BLOCKED |

## Operação, conciliação, monitoramento e contingência

Procedimento operacional completo: [runbook AbacatePay](../../runbooks/abacatepay-operacao.md). Não existe API oficial comprovada de replay/histórico de cobranças por assinatura. A ação administrativa recupera **evento recebido**, não um evento inteiramente ausente. Sem correlação oficial, permanece revisão sem alteração de direitos.

Os alertas usam métricas e captura Sentry sanitizada existentes, sem contratação. Antes do piloto, o responsável precisa receber um sinal sintético e comprovar acompanhamento da fila/heartbeat. Rotina diária atual não equivale a cobertura horária: até 10 contratos locais e 3 gerações remotas por chamada, além de 1 evento do inbox no cron. A entrega normal do webhook continua acionando o worker; o cron é contingência. Atraso e volume acima da capacidade exigem conter aquisição/rever cohort. Sem SLA aprovado não autorizar expansão.

Política de falha: manter a carência/prazo já vigente da ADR-069/070, nunca conceder período provisório por relato ou por ACTIVE. Se o cliente afirma ter pago, verificar evento original, IDs e extrato; se insuficientes, abrir incidente com suporte. Não cobrar de novo. ADR-071 continua para refund/chargeback. Não existe nesta rodada decisão nova de acesso/carência.

## Termos de aceitação de risco — todos pendentes

| Risco | Causa/probabilidade | Impacto financeiro e cliente | Prevenção/detecção/recuperação | Responsável e interrupção | Alternativa e recomendação | Decisão |
|---|---|---|---|---|---|---|
| R1 URL compartilhada antes/depois do webhook | Uso único inexistente; invalidação/histórico não garantidos. Probabilidade desconhecida, sem amostra suficiente para percentual | Uma segunda assinatura pode cobrar indevidamente; exposição depende do preço e do número de recorrências extras. Não há evidência de caso real nesta rodada | Checkout por tentativa, vínculo e CAS; GET/lista, quarentena e monitor. Revisão pelo provedor para cessar/refundar duplicata com autorização; nenhuma ação automática | Financeiro + engenharia, titulares a nomear. Qualquer duplicata suspende novas aquisições do piloto | Permanecer Asaas para novas vendas até confirmação/controle suficiente. Não recomendar liberação irrestrita com este risco aberto | NÃO ACEITO pelo agente; resposta e decisão pendentes |
| R2 Renovação paga sem evento | API não reconstrói histórico/ciclo; sem replay API comprovado. Frequência de falha desconhecida | Pagamento não conciliado pode deixar cliente sem escrita após o prazo vigente; risco de suporte e retrabalho, sem base para estimativa numérica | Inbox durável, leases, monitor de fim de período, auditoria, uma releitura autorizada; solicitar entrega original ao suporte se não existe inbox. Sem correlação não conceder ciclo | Financeiro + plantão engenharia; incidente não recuperável ou backlog sem cobertura contém aquisição | Asaas mantém rota atual; piloto só com canal de recuperação oficial, capacidade, responsável e aceite explícito | PENDENTE |
| R3 Cenários financeiros externos não simuláveis | Ausência de simulador oficial e tempo natural. Probabilidade de defeito residual desconhecida; testes locais não fornecem taxa real | Falha pode prejudicar continuidade/financeiro; ADR-071 limita efeitos indevidos em acesso, não elimina risco de cobrança remota | 66 checks PG, leitores autoritativos, calendário e idempotência; observar ciclos reais em cohort autorizado e preservar evidência | Engenharia/financeiro; divergência financeira/tenant encerra expansão | Aguardar evidência natural/assistida ou avaliar piloto explicitamente autorizado. Não dispensar gate unilateralmente | PENDENTE |
| R4 Operação e capacidade | Destino do alerta, operador real e SLA ainda não ensaiados | Atraso na detecção/resolução; cron diário e volume limitado podem prolongar incidentes | Painel, métricas, captura de cobertura adiada, backoff/limites. Ensaio de sinal e jornada admin antes do piloto | Founder nomeia responsáveis e aprova capacidade; ausência de plantão/sinal mantém NO-GO | Manter aquisição atual sem AbacatePay até operação comprovada | PENDENTE |

O aceite deve registrar risco/versão, cohort máximo, responsável, prazo de revisão, limites de exposição e critério de abort. A assinatura do founder não substitui garantia indispensável nem autoriza alterar segurança. Não foi feito aceite fictício.

## Preparação de ativação e rollback

1. **Sem execução nesta rodada:** rever matriz, provas e termos; resolver B1 ou propor controles suficientes para piloto. Manter PR #53 draft.
2. Confirmar backup recuperável e preflight exato do schema/contratos; não usar apenas contagem. A 0142 não está em Production. Preparar aplicação aditiva autorizada, lock/statement timeout e pós-verificação de RLS/grants/contratos. Parar em qualquer divergência nova.
3. Implementar/revisar composição Production e cohort restrito em etapa explícita: hoje só existem `asaas` e `abacatepay_sandbox`; o runtime recusa AbacatePay em Production. **Não basta inserir chave live.** Não usar `abacatepay_sandbox` como bypass, relaxar `devMode` ou copiar segredos do DEV.
4. Somente nessa etapa: criar segredos específicos e endpoints de produção no cofre/Vercel, manter conta/ambiente/provider nos bindings, exigir store/`devMode` coerentes, catálogo mensal e preço aprovados. Produção não deve receber segredo de webhook/credencial Sandbox. Site de retorno não prova pagamento.
5. Provar receber/validar HMAC, persistir e processar eventos na composição nova, manter consumidores das assinaturas antigas, medir cron/backlog e ensaiar alerta/MFA admin sem tocar clientes.
6. Após autorização específica de janela: fechar cadastro/novas aquisições com mecanismos existentes e **novo deployment**, comprovar bloqueio; aplicar migrations aprovadas e verificar contratos. Habilitação por cohort ainda não existe como flag nesta candidata: implementá-la antes do piloto, sem chamar a flag global de allowlist.
7. Primeiro contrato real e eventual custo exigem autorização específica. Conferir checkout → webhook → DB → invoice → período/cota → UI e extrato; observar pagamentos tardios e monitor. Não repetir cobrança para produzir evidência.
8. Expandir somente após tempo/volume/alertas aprovados. Não migrar contratos Asaas automaticamente. Anual e pagamento de pacientes continuam fora desta troca.
9. Em incidente, interromper aquisição, manter consumidores/webhooks dos dois providers e reconciliar efeitos em andamento. Reverter só para release compatível com bindings/esquema; caso contrário, correção à frente. Não fazer DOWN, refund/cancel, restore sobre produção ou apagar ledger para “voltar”. Rollback de código não desfaz efeito remoto. [Roteiro](../../runbooks/abacatepay-operacao.md#6-contenção-e-rollback).

## Checklist verificável e matriz GO/NO-GO

| Área | Gate | Estado de fechamento desta rodada | Próxima prova |
|---|---|---|---|
| Checkout e janela pré-webhook | Garantia externa e controles suficientes | BLOCKED; uso único não garantido | Resposta do item 3 + ensaio seguro em fixture nova se necessário, sem alterar a retida |
| Renovação/inbox | Idempotência, lease, prova financeira | PASS local/PG; evidências externas históricas preservadas | Ciclo natural não acelerado |
| Ausência de webhook | Detecção e operação viável | CONDITIONAL; monitor e replay recebidos implementados | Canal oficial para evento ausente, plantão e alerta efetivo |
| Conciliação | Nenhum ciclo por valor/data/ACTIVE | PASS local | Preservar correlação e revisar toda ambiguidade |
| Refund/disputa | ADR-071 e prova externa | PASS local / BLOCKED externo | Sem simulador; não inventar refund de assinatura via API avulsa |
| Cadastro PR #54 | Código publicado preservado | PASS baseline integrada e regressão financeira | CI própria do novo SHA; nenhum reenvio a leads |
| Segurança | MFA, CAS, tenant e privilégios | PASS local e PG | Jornada superadmin real no Preview e alerta de teste |
| Banco | 0142 aditiva, histórico e contratos | PASS DEV | Janela Production futura autorizada; seis desvios históricos DEV não regravados |
| Asaas/legados | Binding e desconto vitalício preservados | PASS regressão; nenhuma alteração de contrato | Readback na janela aprovada |
| Sandbox | Não repetir compra inicial | PASS nas provas anteriores; B1/B3 continuam pendentes | Somente mecanismo oficial novo ou tempo natural |
| Build/CI/Preview | Checks no SHA correto | Resultado remoto no corpo do PR #53 | Não usar CI da baseline como aprovação do incremento |
| Turnstile | Dois cenários sem chaves na CI isolada | SKIP histórico explícito | Não reduzir proteção nem usar dummy em Production |
| Produção | Composição live, cohort e autorização | BLOCKED; não implementados/ativados nesta rodada | Fechar gates externos/operacionais e preparar incremento específico |

## Pendências externas antes de produção

**Atualização do pedido em 10/11:** a contratação inicial **Sandbox** solicitada pelo founder foi concluída e verificada às 13:49 UTC. O [operador](PROXIMO-CHECKOUT-SANDBOX.md) executou preparação → checkout real pelo Qoro → pagamento humano → webhook aplicado → DB/invoice/período/cotas → UI desktop/mobile, **PASS**, com repetição recusada (HTTP 409). [Evidência](evidencias/checkout-pago-20261110.json). Não há outro pagamento humano solicitado. As perguntas abaixo continuam sendo lacunas de garantia para produção; a aprovação deste teste não aceita R1–R4 nem dispensa B1/B3. A fixture paga fica retida; não repetir a compra para tentar comprovar renovação.

Não repetir pagamentos, cadastro PR #54 ou instalar ferramenta. Encaminhar ao atendimento **já aberto** apenas: “A exclusão do checkout de assinatura bloqueia novos pagamentos pela URL? Quais garantias e efeitos sobre recibo, extrato, renovações, webhooks e change-plan? Para uma renovação cujo webhook não chegou, qual procedimento oficial entrega novamente o evento original com payment.id e bill da renovação?” Os demais pontos já foram respondidos. Não enviar fixture paga para exclusão nem autorizar operação financeira.

Antes de piloto, nomear responsável financeiro/plantão técnico e ensaiar o recebimento do alerta e a página admin com MFA. Aceites R1–R4 e qualquer alteração de configuração/capacidade exigem decisão concreta. Nenhum pagamento humano novo foi solicitado nesta rodada.

## Decisão provisória

**NO-GO financeiro de produção.** B2 ganhou implementação verificável, schema DEV e procedimento auditável; B1/B3 continuam limites externos e a operação ainda exige prova de alerta/MFA real. A composição live/cohort é trabalho futuro explícito, não uma configuração entregue. Nenhuma nova condição comercial ou risco foi aceito em nome do founder. Asaas e o cadastro publicado continuam ativos; nenhuma publicação financeira, merge, cobrança, refund ou mutação da fixture paga foi executada.
