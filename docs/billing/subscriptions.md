---
title: "Assinaturas e cobrança do SaaS"
description: "Contratação, trial, mudança de plano, cancelamento e reconciliação da assinatura Qoro no Asaas."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Responsabilidade

`billing` controla o contrato entre a clínica e a Qoro. O pagamento do paciente
à clínica pertence a `payments`; recebíveis, créditos e repasses pertencem a
`financial`. Veja a [política financeira](/domains/financial-policy).

Asaas é o provedor implementado. Plano e preço são entidades diferentes; o preço
efetivo da assinatura pode ter condição contratual própria. A nova oferta e os
contratos legados convivem. A tabela atual e a classificação de médicos/equipe
ficam em [planos e acessos](/billing/plans-and-seats), sem duplicar o catálogo aqui.

Fontes: `src/contexts/billing`, `src/contexts/onboarding`,
`src/app/api/webhooks/asaas`, `scripts/seed-plans.ts` e migrations.

## Contratação e trial

O [cadastro autônomo](/onboarding/signup) preserva identidade, confirmação e
plano antes de abrir o Checkout hospedado. Os valores são resolvidos no servidor.
O [convite de clínica](/onboarding/invitations) é um fluxo distinto, mantido
por compatibilidade; não deduza sua regra a partir da tela de cadastro autônomo.

Na oferta 2026, o trial termina **14 dias após `auth.users.created_at`**. Reenvio de
código, retomada e provisionamento não reiniciam esse prazo. A recorrência e uma
cobrança futura podem ser cadastradas antes do término; isso não significa uma
cobrança paga antecipadamente. O primeiro vencimento usa a data UTC seguinte ao
fim exato do prazo. Se o Checkout ocorrer após o trial, o vencimento pode ser
hoje e a liberação depende do pagamento confirmado.

`OFFER_2026_ANNUAL_NEW_SALES_ENABLED` tem default `false`. A contratação anual
nova é filtrada e recusada no servidor quando a flag está desativada. O código
anual e os contratos existentes permanecem preservados. Verifique a configuração
efetiva do deployment antes de declarar a modalidade disponível.

## Checkout, webhook e persistência

1. O servidor registra a intenção e reutiliza um Checkout pendente compatível.
2. O Asaas recebe a contratação no ambiente correspondente.
3. Webhook autenticado e reconciliação consultam fatos no provedor.
4. Os registros locais de invoice, assinatura e provisionamento avançam de forma
   idempotente. Retorno do navegador não é comprovante de pagamento.
5. A interface consulta o estado persistido e comunica pendência ou conclusão.

O endpoint SaaS é `/api/webhooks/asaas`. Ele não se confunde com
`/api/webhooks/asaas/patient/...`. Eventos duplicados são controlados em
`processed_webhooks`; confirmações e cancelamentos de invoice têm tratamento
terminal. Não repita uma operação financeira após timeout sem reler o provedor.

## Upgrade e médico adicional

O upgrade calcula a diferença proporcional em centavos sobre o preço efetivo,
cria uma cobrança avulsa e só aplica a mudança após a confirmação exigida.
`syncProviderPlanChange` confirma o valor recorrente no Asaas e as parcelas
editáveis do novo ciclo antes de aplicar o plano local. A cota não pode aumentar
apenas porque o cliente abriu o link ou voltou da página de pagamento.

Na Clínica 2026, comprar um médico adicional é uma mudança para a variante de
plano correspondente. Não existe compra online de um quarto acesso administrativo
nesta oferta. Convites, reativação, papel e CRM devem respeitar as cotas separadas.

## Downgrade e mudança de ciclo

Downgrade fica agendado para o fim do ciclo. A solicitação e a aplicação conferem
novamente os usuários ativos não excluídos e, na oferta 2026, as cotas de médicos
e equipe. Se a clínica deixar de caber, a mudança falha sem desativar pessoas
automaticamente.

A sincronização usa `updatePendingPayments: false` para não reprecificar dívidas
anteriores indiscriminadamente. Parcelas editáveis a partir do novo ciclo são
ajustadas explicitamente e relidas. Valor incompatível em cobrança processada
impede aplicação local e exige revisão; histórico pago não é apagado.

Troca mensal/anual vale no próximo vencimento, sem acerto proporcional de ciclo.
A oferta anual nova começa por cartão; migração de mensal Pix/boleto para anual
não deve contornar a necessidade de um meio de pagamento compatível. A política
de vendas anuais desativadas continua valendo para novas contratações.

## Cancelamento e reativação

O fluxo cancela a renovação no provedor e confere o resultado antes de registrar
o cancelamento local. Cobranças abertas abrangidas pela operação têm remoção e
releitura; pagamentos anteriores e auditoria são preservados. O acesso segue até
o fim do período pago ou trial segundo a política aplicável; inadimplência tem
tratamento próprio.

Repetir a solicitação não deve criar nova operação financeira. “Manter assinatura”
revoga o cancelamento agendado após sincronizar o provedor; reativação de um
contrato já cancelado segue o caminho auditado correspondente. No anual pré-pago,
cancelar a renovação mantém o período contratado e não dispara estorno automático.

## Permissões e inadimplência

O acesso depende da identidade, perfil ativo, estado da clínica, assinatura e
política de autorização. Não use a frase “inadimplência nunca bloqueia login”
como garantia universal: o gate de mutações de cobrança e a revogação individual
de acesso são mecanismos diferentes.

Consulte `src/contexts/billing/internal/access.ts`, o gate de mutações e
`src/lib/auth` para a política vigente. Direitos avançados da nova oferta ficam
na Clínica; os direitos dos contratos legados são preservados conforme seu plano.

## Diagnóstico e evidência

Compare intenção, Checkout, assinatura e payment no Asaas com invoice, assinatura,
outbox e auditoria no Qoro. Use ids sanitizados; nunca registre chave, link com
bypass, conteúdo de cartão ou dados pessoais. Teste com fixture rastreável e
limpeza definida, em ambiente autorizado.

Os [relatórios](/quality/index) preservam as provas datadas de upgrade,
downgrade, cadastro e médico adicional. Esta revisão documental não criou novos
Checkouts, não consultou contratos reais e não comprovou renovação após um ano.
