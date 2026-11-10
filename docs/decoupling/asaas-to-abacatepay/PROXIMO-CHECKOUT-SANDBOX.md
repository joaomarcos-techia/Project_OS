# Próximo Checkout Sandbox — operação preparada

Atualizado em 10/11/2026. Pedido do founder: deixar a operação preparada para ele dizer **“criar checkout”**, pagar no Sandbox e ter o resultado conferido. Não aguardar nova resposta do suporte para essa contratação inicial suportada. Isso não dispensa os gates financeiros de produção.

**Pedido posterior desta rodada:** o founder autorizou homologar a primeira compra de cinco médicos após integrar a apresentação do plano. Usar **outro slot `next-checkout-five-ui-20261110`, plano `clinica_2026_5`, R$838**, e o Preview imutável do novo HEAD. O slot de R$397 abaixo já está pago e não deve ser recriado. O antigo preparo de cinco médicos em `4e120afe` não criou identidade ou transação; preserve-o, sem substituir seu SHA. A engenharia executa `prepare` e `create`; só o pagamento hospedado que exigir intervenção humana é delegado ao founder. Não criar um segundo checkout se o resultado da primeira criação ficar incerto.

**Pagamento conferido em 10/11 às 13:49 UTC (10:49 Brasília): PASS.** Slot `next-checkout-20261110`, run `2d072b20-dab5-4073-bdaf-2c8f1989c739`, checkout `bill_6WgrJ0S5pfFrkZyhJcyNTKLE`, Clínica mensal **R$ 397 PAID no Sandbox**. `verify` confirmou uma assinatura remota ativa, webhook aplicado, uma invoice paga, uma tentativa confirmada, um receipt, retirada das cotas de trial e UI em 1440/390. Repetir o checkout no Qoro retornou HTTP 409 `already_paid`. Acesso do primeiro período até **10/12/2026 às 13:44:26.186 UTC**, conforme a âncora aprovada; isso não é confirmação da data da próxima cobrança no provedor. [Evidência sanitizada](evidencias/checkout-pago-20261110.json).

**Nenhuma ação humana pendente para este pagamento.** Não pagar de novo, criar outra fixture, cancelar nem limpar a atual. Fase final `verified`; histórico e credencial protegidos ficam retidos. A prova usou o Preview imutável `ea45fb8e` e o mesmo destino de webhook. A correção do roteiro pode agora ser publicada no PR draft; o manifesto histórico conserva seu SHA. Se o alias avançar depois, a checagem estrita de mesma release recusará uma nova execução sobre esse manifesto: isso não invalida a prova registrada nem autoriza trocar seu SHA para contornar a proteção.

## O que o founder precisa fazer

1. Dizer **“criar checkout”**. O padrão preparado é **Clínica mensal, R$ 397 no Sandbox**. Para testar Consultório, dizer “criar checkout Consultório”; o valor aprovado é R$ 197. Não há cobrança real nem contratação anual nesta rodada.
2. Abrir o link que a engenharia enviar, conferir a indicação de Sandbox/modo de teste e concluir usando somente o mecanismo/dados fictícios do provedor. Não usar cartão real nem enviar dados de cartão, recibos, códigos ou tokens pelo chat.
3. Dizer **“pago”**, ou informar somente a mensagem de erro. Não pagar de novo se o Qoro ainda estiver aguardando conciliação.

Não é necessário criar outro produto, instalar ferramentas, fornecer credenciais ou acionar o suporte para começar esse teste inicial. A engenharia refaz somente o preflight de ambiente antes de criar e antes de verificar; credenciais/Preview indisponíveis serão um bloqueio concreto, não uma autorização para usar Production.

## Implementação e efeitos por comando

Operador versionado: `scripts/abacatepay-checkout-operator.ts`. Persistência e validações: `scripts/abacatepay-checkout-session.ts`. O E2E existente `e2e/abacatepay-trial-preview.spec.ts` foi reaproveitado; a conferência da invoice agora usa o preço do plano selecionado, permitindo também Consultório, em vez de fixar R$ 397.

| Ação | Efeitos autorizados | Critério e saída |
| --- | --- | --- |
| `preflight` | GETs autenticados; prova assinada Preview/DEV e POST negativo ao webhook, sem evento aceito; transação DB `READ ONLY` | `PASS preflight`, sem identidade ou transação criada |
| `prepare` | Mesmo preflight; manifesto e senha aleatória somente locais, ACL do Windows restrita e cifra DPAPI CurrentUser | `PASS prepared`; reabertura conserva run/credencial. Não cria Auth, clínica, cliente ou checkout |
| `create` | Somente após o pedido: identidade sintética DEV, draft identificado e jornada real na UI até a rota do Qoro criar o checkout com journal | `PARTIAL awaiting_human_sandbox_payment`, um checkout e um link. Não paga nem preenche cartão |
| `verify` | Leitura autenticada no provedor e DEV; quando pago e conciliado, login da fixture para E2E desktop/mobile e teste de repetição recusada | `PASS` só com pagamento integral, webhook aplicado, invoice/receipt/tentativa únicos e UI paga. Antes disso, `PARTIAL` |

Um resultado incerto não é “ausente”: Auth iniciado sem readback impede outro POST de criação; operação financeira incerta permanece no journal e usa a recuperação existente. Um checkout pago nunca é devolvido como link pendente. Duas execuções locais competindo não entram juntas. Um crash preserva o lock para investigação; não remover por timeout nem inventar outro run para contornar resultado desconhecido.

## Preflight obrigatório da engenharia

O operador confere: projeto/time/branch exatos na Vercel, deployment READY não Production; Auth e DB apontando para `pqhkirrszzpwezdaqrai` por prova assinada; loja atestada pelos catálogos já aprovados; **cinco produtos** em `devMode=true`; BRL, mensal, preços aprovados e ausência de trial nativo; webhook V2 `subscription.completed` apontando para a mesma release e runtime DEV; segredo inválido recusado com HTTP 401; 143 migrations e hash da última 0142, schema efetivo e conta Sandbox; preço vigente de tabela sem campanha. As correlações completas vêm de `%LOCALAPPDATA%\Qoro\SandboxBilling\plan-catalog-20261109\products.json`, sem alterar o catálogo retido de 08/11.

A checagem rápida de histórico não substitui a auditoria completa já aprovada nem regrava os seis hashes históricos DEV. Qualquer mudança posterior de schema/release exige reconferir a preparação. Não trocar a URL/SHA do manifesto de uma fixture em andamento para fazer o preflight passar.

## Comandos da engenharia

Executar **no worktree financeiro**, em PowerShell. A CLI da Vercel deve continuar autenticada legitimamente. O caminho abaixo já foi conferido nesta máquina; se a cache for removida, localizar a instalação oficial em vez de substituir por um executável desconhecido. Nenhum valor secreto vai no comando.

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:NODE_OPTIONS = '--conditions=react-server --use-system-ca'
$vercelCli = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\67eb4586ca667318\node_modules\vercel\dist\vc.js'
```

O parâmetro `--preview` deve receber o **Preview imutável da release preparada**, obtido pelo deployment do HEAD do PR #53. O alias pode avançar; não fixar o link antigo desta prova como se fosse o HEAD futuro. Os exemplos usam `$previewQoro`, a ser definido pela engenharia com o deployment READY verificado, sem query string ou token:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/abacatepay-checkout-operator.ts --action prepare --preview $previewQoro --vercel-cli $vercelCli --session next-checkout-20261110
```

**Somente depois de “criar checkout”:**

```powershell
node node_modules/tsx/dist/cli.mjs scripts/abacatepay-checkout-operator.ts --action create --preview $previewQoro --vercel-cli $vercelCli --session next-checkout-20261110
```

**Depois de “pago”:**

```powershell
node node_modules/tsx/dist/cli.mjs scripts/abacatepay-checkout-operator.ts --action verify --preview $previewQoro --vercel-cli $vercelCli --session next-checkout-20261110
```

Os comandos acima registram a jornada já concluída deste slot; não repetir `create` nem pagar novamente. Uma futura prova explicitamente solicitada deve usar outro slot identificado e o Preview da sua própria release. Para Consultório, por exemplo, usar `--session next-checkout-consultorio-20261110 --plan consultorio_2026`, consistentemente em todas as ações. Nunca alterar um slot que já tenha identidade/checkout para testar outro plano. Não gerar dois checkouts se o founder pediu apenas um.

## Fixture, credenciais e retenção

O slot final fica em `%LOCALAPPDATA%\Qoro\SandboxBilling\next-checkout-20261110`. `session.json` contém correlação e hash do draft, sem senha ou sessão. `password.dpapi` só pode ser aberto pelo perfil Windows atual. `preflight.json` e `verified.json` registram evidências sanitizadas. Link de checkout fica apenas nesse destino restrito e é exibido ao founder na ação de criação. Saídas brutas do Playwright não são gravadas, porque podem conter valores de formulário; trace, vídeo e screenshots de sessão ficam desativados.

Só na criação futura: identidade `abaca-<run UUID>@example.invalid`, confirmada administrativamente, sem e-mail externo. A data Auth **dessa identidade sintética nova e ainda sem profile** simula trial vencido antes do provisionamento. O E2E exige exatamente 14 dias desde Auth; não é observação natural de tempo nem mudança em cliente existente. Manifesto antecede qualquer efeito remoto; o journal financeiro continua no DEV.

Não existe limpeza automática ao fechar navegador, expirar teste ou usuário se ausentar. Após o pagamento, reter assinatura, checkout, binding, invoice, receipt, inbox e evidências. Qualquer cancelamento de recorrência exige a autorização específica e o procedimento existente; exclusão do checkout pago continua bloqueada enquanto não houver garantia suficiente. Não usar DELETE no banco para “limpar” um pagamento tardio.

**Intocável:** a fixture histórica `qoro-trial-deferred-20261108/ui-expired.json`, checkout `bill_dKcTZUwUXYK2kgfqDnu6nLnq`, assinatura já cancelada e período preservado até 09/12. O novo operador apenas lê o catálogo desse diretório; não usa sua identidade, checkout ou assinatura.

## Resultado comprovado e limites

Em 10/11 o preflight real passou sobre `a27be74240bf72bdef088b9017fbb9d6b4f94fbd`, incluindo 2 produtos Sandbox, mesma release no destino do webhook, HTTP 401 negativo, DEV assinado e schema/histórico. `prepare` também passou com roundtrip DPAPI e ACL privada, **sem conta, checkout ou pagamento**; slot de validação `next-checkout-validation-20261110`, run `a9e58df5-a2c0-403f-b967-c698f70c0ccb`. Esse slot prova a preparação e não deve ser confundido com a fixture paga nem com o slot final do novo HEAD.

Os testes focados incluem filesystem real, concorrência entre operadores, retenção após erro, lock após crash, corrupção/limite do manifesto, preços e bindings de ambiente. Após o pedido do founder, `create` passou pelo login real, provisionamento, trial de 14 dias desde Auth, interface desktop/mobile e rota real do Qoro até o checkout hospedado. O readback anterior ao pagamento confirmou valor/produto Sandbox, pendência, nenhuma assinatura remota e uma operação local. **Depois de “pago”, `verify` passou:** pagamento integral por cartão, uma assinatura remota ativa sem trial nativo, um evento `subscription.completed` aplicado, invoice/receipt/tentativa únicos, período Qoro conforme a âncora, cotas liberadas, UI desktop/mobile e nova tentativa de checkout recusada. WhatsApp e Asaas não foram conectados e nenhum convite foi enviado: foram conferidos os gates e a disponibilidade da interface. As provas financeiras anteriores permanecem válidas; o harness da UI foi reaproveitado.

A primeira consulta desta verificação terminou `BLOCKED` antes de ler o pagamento, por indisponibilidade de socket da API do provedor. Repetir a mesma ação `verify` concluiu com PASS. Não houve nova fixture, checkout, cobrança, cancelamento ou replay de webhook pela engenharia. A entrega original já estava aplicada no DEV. Nenhum código do runtime foi alterado nesta verificação.

O primeiro ensaio de criação identificou incompatibilidade de timestamps no roteiro: o cliente canônico do Drizzle trabalha com strings, em vez de aceitar `Date` no SQL bruto. A transação de draft falhou e fez rollback; a identidade foi conservada e reutilizada. Corrigido o parâmetro para ISO com cast `timestamptz` e normalizados os timestamps do readback. PASS 61 testes focados (38 do operador), TypeScript, lint, Prettier e consulta SQL somente de leitura reproduzindo a falha/validando o roundtrip ISO. O E2E de criação real passou após a correção. Runtime da aplicação e Preview não foram alterados; build/CI da baseline permanecem as evidências aplicáveis ao app.

Renovação recorrente externa, falha/retentativa, refund/disputa recorrentes e garantia de invalidação da URL paga continuam separados da contratação inicial. Testar um novo pagamento inicial não encerra esses gates nem autoriza go-live. Ver [plano de produção](PLANO-FINAL-GO-LIVE-ABACATEPAY.md), [operação](../../runbooks/abacatepay-operacao.md) e [resposta do suporte](SUPORTE-RESPOSTA-INTEGRAL-20261110.md).

## Quantidades de médicos e próximos ciclos

A candidata AbacatePay agora oferece **Consultório (1 médico, R$ 197)** e **Clínica com 2 médicos (R$ 397), 3 (R$ 544), 4 (R$ 691) ou 5 (R$ 838) já na contratação inicial**, conforme a decisão complementar do founder em 10/11. O primeiro pagamento integral libera a cota escolhida. São 3 acessos administrativos incluídos em qualquer variante; pagar mais médicos não compra acesso administrativo adicional.

Para uma assinatura **já paga**, a alteração posterior continua valendo somente na próxima renovação integralmente paga, sem pró-rata ou vaga antecipada. A aquisição Asaas publicada permanece com as regras anteriores. O trial continua com 14 dias desde Auth, sem cobrança/cartão inicial e com todas as restrições já aprovadas.

O operador aceita `--plan clinica_2026_3`, `_4` ou `_5` usando outro slot identificado. Para o próximo ensaio representativo de 5 médicos, preparar `--session next-checkout-five-20261110 --plan clinica_2026_5` sobre o Preview do novo HEAD. `prepare` não cria identidade nem transação; `create` só deve ser executado quando o founder pedir o novo checkout, e `verify` depois de “pago”. **Não reutilizar o slot já pago de R$ 397.** Nenhum link novo foi gerado por habilitar essa escolha.

PASS **18/18 checks PostgreSQL**, incluindo 10 novos de primeira contratação nas cinco variantes, e **222/222 testes dirigidos** de catálogo, CAS, provisioning, rotas, UI e operador. A UI do worktree `ui/refactor-qoro-20261108` já renderiza os IDs/valores retornados pelo servidor; foi inspecionada sem alteração ou merge amplo. [Evidência inicial e limites](evidencias/contratacao-inicial-catalogo-20261110.json). As cobranças novas desses testes são somente respostas sintéticas: não equivalem a novos pagamentos externos dos planos de 3–5 médicos.

Essa matriz passou **85/85 checks no PostgreSQL local**, incluindo 19 novos, e **168/168 testes dirigidos**, incluindo 14 novos. Cobertos quantidade paga, owner com CRM, teto de médicos/administração, cliques concorrentes, replay, valor/produto divergentes e downgrade com excesso de equipe. No Preview, as opções reais da fixture paga foram lidas sem executar alteração. [Evidências e limites](evidencias/checkout-variantes-20261110.json). Os testes de renovação utilizam respostas de provedor sintéticas e relógio explícito da aplicação; não representam novas renovações pagas externamente. **Não há outro checkout a pagar para esta matriz automática.**

Referências oficiais conferidas em 10/11: [webhooks de assinatura](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [listar webhooks](https://docs.abacatepay.com/pages/webhooks/list) e [assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference). O checkout pode gerar mais de uma assinatura remota; o teste não promete uso único hospedado.
