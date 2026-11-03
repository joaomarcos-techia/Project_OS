# Billing SaaS e assinaturas

## Status

Canonical — planos, quotas, Asaas, estados e acesso da clínica.

## Source of Truth

`src/contexts/billing`, `scripts/seed-plans.ts`, onboarding, webhook/cron routes e migrations.

## Provider e catálogo

Asaas é o único provider implementado. Plano e preço são entidades separadas; preços ativos podem incluir campanha. A UI/banco deve ler o catálogo, não hardcodear valores.

Defaults do seed versionado:

| Plano | Mensal | Anual | Assentos | Agendamentos | IA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Solo | R$ 149,00 | R$ 1.519,80 | 1 | 200 | 200 |
| Clínica | R$ 349,00 | R$ 3.559,80 | 5 | 800 | 800 |
| Pro | R$ 699,00 | R$ 7.129,80 | 10 | 2.500 | 2.500 |

Somente **assentos** bloqueiam operação. Agendamentos e IA são contadores/métricas, mesmo quando superam o valor do catálogo. Permissões granulares são feature dos planos Clínica e Pro. Não existe plano `Pro+` nem overage automático.

**Política planejada, ainda não promovida:** configuração de preço por meio de
pagamento, base/regra de repasse profissional e relatórios econômicos avançados
serão recursos dos planos **Clínica e Pro**, não do Solo. A visibilidade básica
de bruto, tarifa e líquido por cobrança pertence a todos os planos, inclusive
Solo. O desenho, os defaults, o tratamento de downgrade e os critérios de
ativação estão em
[Política financeira em camadas](../specs/politica-financeira-camadas.md).

## Ciclo e estados

- ciclos: `monthly`, `annual`;
- assinatura: `trial`, `active`, `past_due`, `cancelled`;
- invoice: `open`, `partial`, `paid`, `overdue`, `cancelled`;
- trial do onboarding por convite (`/join`): 14 dias. O cadastro autônomo é um
  fluxo separado e sua regra de trial não deve ser inferida desta constante.
- na oferta 2026 do cadastro autônomo: **14 dias desde `auth.users.created_at`**,
  sem reinício por reenvio, retomada do draft ou provisionamento. O Checkout pode
  cadastrar a recorrência e uma parcela futura antes do fim; o primeiro vencimento
  é a data UTC seguinte ao fim exato do trial, para evitar cobrança antecipada.
  Se o Checkout ocorrer após o prazo, vence na data corrente e a clínica só é
  liberada após confirmação do pagamento. Fonte: `onboarding/internal/signup-trial.ts`.

Transições são monotônicas para tolerar webhook fora de ordem. `paid`/`cancelled` de invoice são terminais; refund vive em payment attempts. Assinatura `cancelled → active` só ocorre no fluxo auditado de reativação após aceite Asaas.

## Checkout e cobrança

O onboarding por convite (`/join`) cria customer/assinatura com cartão antes da
transação local. Webhook `/api/webhooks/asaas` valida token, deduplica em
`processed_webhooks` e consulta o payment no provider antes de aplicar a
mudança; notificação não é tratada como verdade suficiente.

Reconciliação diária lista/consulta pagamentos e corrige invoices/assinatura/trocas agendadas ausentes. Resultados ambíguos falham fechados e são registrados; não repetir cobrança financeira sem confirmar o estado do provider.

## Troca de plano

### Upgrade

Calcula prorrata em centavos sobre o preço efetivo/campanha, cria cobrança avulsa Asaas e aplica o plano somente após confirmação do pagamento.

**Histórico:** a lacuna identificada em 17/10 foi corrigida na integração da oferta.
`syncProviderPlanChange` exige confirmação do valor recorrente no Asaas e ajusta,
com releitura, as parcelas editáveis do novo ciclo antes de aplicar o plano local.
Parcelas de ciclos anteriores e histórico pago são preservados. A compra de médico
extra e a recorrência R$ 397 → R$ 544 foram comprovadas no Preview/Sandbox;
ver [evidência de 26/10](../quality/finalizacao-oferta-2026-10-26.md).

### Downgrade

Agenda para o fim do ciclo. Confere o teto do plano de destino na solicitação
**e novamente** na aplicação, considerando somente usuários ativos e não excluídos.
Na oferta 2026, confere também as vagas separadas de médicos e equipe. Se a
condição mudou, a troca falha sem desativar pessoas automaticamente.

O sincronizador mantém `updatePendingPayments: false` na mudança da recorrência
para não reprecificar indiscriminadamente dívidas antigas. Depois atualiza
explicitamente cada parcela editável com vencimento a partir do novo ciclo e
relê o resultado; uma cobrança processada com valor incompatível impede a
aplicação local e exige revisão. O downgrade não apaga o histórico financeiro.
O caminho Clínica 3 → Clínica 2 recebeu prova integrada com vencimento controlado
no Preview/Sandbox; isso não equivale a uma troca executada em contrato real.

### Cancelamento

Pode ser solicitado em `trial`, `active` ou `past_due`. A recorrência é pausada
imediatamente no Asaas e as cobranças abertas são apagadas com releitura antes
de o Qoro registrar o cancelamento. O acesso segue até o fim do período já pago
ou do trial; em inadimplência, encerra em até um dia.

A tela mantém uma confirmação visível tanto no cancelamento agendado quanto no
estado final `cancelled`. Uma repetição idempotente retorna confirmação de que a
assinatura já estava cancelada/agendada, sem nova chamada ao Asaas. Enquanto a
mudança ainda não entrou em vigor, “Manter assinatura” religa a recorrência
antes de revogar o registro local. Depois do estado final, “Reativar assinatura”
sincroniza primeiro com o Asaas e reabre a clínica pelo caminho privilegiado.

## Inadimplência e acesso

| Estágio | Efeito |
| --- | --- |
| D+1 | lembrete nativo Asaas |
| D+3 | WhatsApp |
| D+7 | WhatsApp + e-mail |
| D+15 | `suspended_readonly`: mutations de negócio bloqueadas |
| D+30 | `suspended`: mutations bloqueadas |

Inadimplência nunca bloqueia login nem leitura de prontuário. O gate central de mutations abre exceções explícitas para worker/sistema, impersonação, pedido LGPD e reativação de assinatura.

## Eventos e auditoria

Outbox comunica ativações, mudanças, invoices, trial, dunning e acesso. `billing_events` é timeline auditável da conta e não substitui a outbox. Contrato: [events/billing](../contracts/events/billing.md).

## Evidência externa

Código/tests provam a estrutura. Customer, assinatura, webhook configurado, primeira cobrança/settlement, refund e reconciliação reais são `REQUIRES_MANUAL_VALIDATION` no ambiente-alvo.
