# Billing SaaS e assinaturas

## Status

Canonical — planos, quotas, Asaas, estados e acesso da clínica.

## Source of Truth

`src/contexts/billing`, `scripts/seed-plans.ts`, onboarding, webhook/cron routes e migrations.

## Provider e catálogo

Asaas é o único provider implementado. Plano e preço são entidades separadas; preços ativos podem incluir campanha. A UI/banco deve ler o catálogo, não hardcodear valores.

**Oferta vendida no cadastro autônomo (out/2026, [ADR-067](../adr/067-oferta-por-profissional.md)):**

| Plano | Código | Mensal | Profissionais | Equipe administrativa |
| --- | --- | ---: | ---: | --- |
| Consultório | `consultorio_2026` | R$ 197,00 | 1 | até 3 |
| Clínica | `clinica_2026_<n>` | R$ 397,00 + R$ 147,00 × (n − 2) | n = 2 a 10 | ilimitada |

Só mensal. Profissional é quem a agenda trata como profissional (`isPractitioner`: papel `doctor` ou CRM preenchido); convite pendente ocupa vaga. Os tetos vivem em `plan_seat_limits` e são aplicados pela trigger `profiles_plan_seat_limits` em todo write de `profiles`. Incluir profissional é upgrade (rateio + recorrência sincronizada no Asaas antes da vaga); remover é downgrade no fim do ciclo, se a equipe couber.

**Tabela antiga — só para quem já assina** (troca entre eles e convite do fundador; fora do cadastro):

| Plano | Mensal | Anual | Assentos | Agendamentos | IA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Solo | R$ 149,00 | R$ 1.519,80 | 1 | 200 | 200 |
| Clínica | R$ 349,00 | R$ 3.559,80 | 5 | 800 | 800 |
| Pro | R$ 699,00 | R$ 7.129,80 | 10 | 2.500 | 2.500 |

Somente **assentos** bloqueiam operação: total de usuários na tabela antiga, profissionais e equipe na oferta nova. Agendamentos e IA são contadores/métricas, mesmo quando superam o valor do catálogo. Permissões granulares, repasse e preço por meio de pagamento são features da Clínica (nova e antiga) e do Pro. A troca de plano só acontece dentro da mesma tabela; migrar cliente antigo para a oferta nova ainda é decisão comercial aberta. Não existe plano `Pro+` nem overage automático.

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

Transições são monotônicas para tolerar webhook fora de ordem. `paid`/`cancelled` de invoice são terminais; refund vive em payment attempts. Assinatura `cancelled → active` só ocorre no fluxo auditado de reativação após aceite Asaas.

## Checkout e cobrança

O onboarding por convite (`/join`) cria customer/assinatura com cartão antes da
transação local. Webhook `/api/webhooks/asaas` valida token, deduplica em
`processed_webhooks` e consulta o payment no provider antes de aplicar a
mudança; notificação não é tratada como verdade suficiente.

Reconciliação diária lista/consulta pagamentos e corrige invoices/assinatura/trocas agendadas ausentes. Resultados ambíguos falham fechados e são registrados; não repetir cobrança financeira sem confirmar o estado do provider.

## Troca de plano

### Upgrade

Calcula prorrata em centavos sobre o preço efetivo/campanha, cria cobrança avulsa Asaas e aplica o plano somente após confirmação do pagamento **e** da releitura do novo valor recorrente e das parcelas já emitidas do novo ciclo no Asaas (PR #41). Na oferta por profissional, incluir profissional é este fluxo.

### Downgrade

Agenda para o fim do ciclo. A equipe ativa (convites pendentes incluídos) precisa caber no destino na solicitação **e novamente** na aplicação: total de usuários na tabela antiga; profissionais e equipe na oferta por profissional, cuja capacidade de destino fica reservada desde o pedido. Se a condição mudou, a troca falha sem desativar pessoas automaticamente.

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
