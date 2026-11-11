# Checkouts Sandbox — lote pago e verificado

**Atualização 11/11/2026:** o founder pediu a criação e informou **“todos pagos”**. Consultório1 e Clínica3/4/5 estão **PAID e verificados de ponta a ponta**. Clínica2 permanece homologada sem repetição. Não criar nem pagar novamente estes checkouts. [relatório §38](RELATORIO-HOMOLOGACAO-FINAL.md#38-cinco-contratações-iniciais-homologadas--11112026); [evidência](evidencias/checkouts-lote-20261111.json). Links ficam somente no chat e nos slots protegidos, fora do Git. Não há outra ação humana de pagamento inicial pendente; gates de ciclo/operação/live continuam no plano final.

## Histórico de preparação — superado pelo pagamento acima

Registro de 10/11/2026. Última orientação do founder: **deixar preparado para dizer “crie os checkouts”, pagar os pendentes e ter cada resultado conferido**. Substitui a autorização anterior de criar imediatamente cinco médicos. **Não criar agora.** Nenhuma identidade, clínica ou checkout novo foi criado nesta rodada. Sem Production, anual, cobrança real ou alteração de contratos.

## Lote pendente

| Plano | Mensalidade Sandbox | Médicos / administrativos | Slot local separado |
|---|---|---|---|
| Consultório | R$ 197 | 1 / até 3 | `next-checkout-batch-consultorio-20261110` |
| Clínica 3 médicos | R$ 544 | 3 / até 3 | `next-checkout-batch-three-20261110` |
| Clínica 4 médicos | R$ 691 | 4 / até 3 | `next-checkout-batch-four-20261110` |
| Clínica 5 médicos | R$ 838 | 5 / até 3 | `next-checkout-batch-five-20261110` |

**Clínica 2/R$ 397 já está paga e validada. Não repetir.** O [inventário financeiro](INVENTARIO-FLUXOS-FINANCEIROS.md) separa estas compras de renovação, troca de plano, recontratação, cancelamento e reembolso. Uma primeira compra não comprova ciclos sem simulador oficial.

Cada slot tem manifesto rastreável e senha sintética cifrada com DPAPI/ACL privada. `prepare` só produz estado local; não cria Auth, clínica, cliente, assinatura ou checkout. O resultado da preparação no **HEAD final com CI aprovada** fica no checkpoint do PR #53, com SHA, Preview e fases reais. Se houver nova release antes do pedido, repetir somente o preflight e conferir o estado; nunca reescrever o SHA de uma fixture em andamento.

## O que o founder faz

1. Dizer **“crie os checkouts”**. A engenharia relê o lote para excluir qualquer compra já concluída e cria somente os quatro pendentes, uma vez cada.
2. Abrir os links enviados no chat, conferir Sandbox e os quatro valores. Usar somente o cartão/mecanismo fictício do provedor; nunca cartão real. Pode haver reCAPTCHA humano. Não enviar dados de cartão, recibo, senha ou tokens.
3. Informar **“todos pagos”**, ou identificar os planos pagos. A engenharia valida individualmente. Se uma tela falhar ou demorar, informar apenas plano/mensagem; não pagar novamente por conta própria.

Não precisa configurar outra chave Vercel, criar produto nem fornecer credencial para esse lote. O DEV voltou a responder após o founder ativar a Data API. A prontidão será conferida antes de criar/verificar: uma indisponibilidade posterior não autoriza Production nem outra fixture para a mesma operação incerta.

## Critérios de aprovação de cada pagamento

O `verify` exige pagamento integral do plano correto, assinatura remota vinculada à fixture, webhook autenticado aplicado, invoice paga, tentativa/receipt/operação únicos, período ancorado corretamente e retirada das cotas temporárias de trial. Confere UI desktop/mobile, cotas e recusa HTTP409 de nova compra já paga. Retorno do navegador, relato “pago” ou assinatura apenas ACTIVE não bastam.

Antes de pagar, o E2E preserva o trial vencido e verifica retomada do mesmo checkout após abandono/refresh, sem outra operação. Identidades são confirmadas administrativamente; isso não prova entrega de e-mail nem passagem natural de 14 dias.

## Operação da engenharia

Operador: `scripts/abacatepay-checkout-operator.ts`; guards e persistência: `scripts/abacatepay-checkout-session.ts`. Não foi criado novo framework ou endpoint para o lote.

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
$env:NODE_OPTIONS = '--conditions=react-server --use-system-ca'
$vercelCliQoro = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\67eb4586ca667318\node_modules\vercel\dist\vc.js'
```

A engenharia define `$previewQoro` com o deployment **imutável READY do HEAD aprovado**, conferindo o mesmo SHA no destino do webhook. Não usar alias como prova de release congelada. Preparo de cinco médicos, sem efeito financeiro:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/abacatepay-checkout-operator.ts --action prepare --preview $previewQoro --vercel-cli $vercelCliQoro --session next-checkout-batch-five-20261110 --plan clinica_2026_5
```

Após o pedido, usar `--action create` com os mesmos argumentos. Após pagar, `--action verify`. Repetir para Consultório (`--plan consultorio_2026`), três (`clinica_2026_3`) e quatro (`clinica_2026_4`), nos slots da tabela. Nunca substituir slot com identidade/checkout para outro plano.

Preflight: projeto/time/branch Vercel, DEV assinado (`pqhkirrszzpwezdaqrai`), cinco produtos devMode/BRL/mês/preços aprovados/sem trial nativo, loja correta, webhook V2 na mesma release e HTTP401 para segredo inválido. Banco READ ONLY; as sete migrations financeiras 0136–0142 devem corresponder ao journal/SQL. Baseline 143; só se admite também a **0143 TISS exata revisada**, explicando as 144 atuais. Apêndice desconhecido, hash divergente ou contagem inexplicada bloqueiam. Não aplica/copia migrations nem substitui a auditoria completa dos seis hashes DEV históricos preservados.

## Retenção e segurança

Slots em `%LOCALAPPDATA%\Qoro\SandboxBilling`. `session.json` tem correlação/hash do draft, nunca senha ou sessão. `password.dpapi` depende do perfil Windows atual. `preflight.json`/`verified.json` são sanitizados. Links só na pasta protegida e no chat; fora do Git. Trace, vídeo, screenshots de sessão e stdout bruto do Playwright ficam desativados.

Manifesto e lock antecedem efeitos externos. Execuções concorrentes não criam duas compras. Crash/resposta incerta conserva lock/journal para investigação; não remover por timeout nem inventar outro run. Sem limpeza automática por expiração, fechamento do navegador ou ausência do founder. Pagamento tardio conserva a fixture para conciliação. Excluir checkout pago continua proibido sem garantia suficiente dos efeitos.

## Evidências históricas preservadas

- **Pago/verificado:** `next-checkout-20261110`, run `2d072b20-dab5-4073-bdaf-2c8f1989c739`, Clínica 2/R$ 397. [Evidência](evidencias/checkout-pago-20261110.json). Conferido em 10/11, 13:49 UTC, runtime `ea45fb8e`: webhook aplicado, invoice/receipt/tentativa únicos, UI 1440/390, repetição 409. Não recriar/cancelar/limpar. Primeiro período Qoro até 10/12/2026, 13:44:26.186 UTC; não prova a próxima cobrança remota.
- **Só preparo antigo:** `next-checkout-five-20261110` em `4e120afe` e `next-checkout-five-ui-20261110` em `fd90ded7`; sem identidade/checkout. Preservados sem reescrever SHAs. O lote usa slots novos porque houve nova release de validação.
- **Cancelado anteriormente:** `qoro-trial-deferred-20261108/ui-expired.json`, período pago até 09/12. Não reativar, encurtar período, excluir checkout nem usar sua identidade neste lote.

## Limites do lote

Produção continua **NO-GO financeiro**. Composição live/cohort ausente, checkout reutilizável, recuperação de renovação inteiramente sem evento, ciclos externos sem simulador, operação superadmin/MFA/alerta e aceites de risco têm gates próprios. As quatro primeiras compras não os removem. Ver [plano final](PLANO-FINAL-GO-LIVE-ABACATEPAY.md).
