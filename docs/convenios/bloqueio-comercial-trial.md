# Bloqueio comercial do trial (D24) — auditoria, regra central e integração com o #53

**Decisão do fundador (11/11/2026, definitiva):** o trial de 14 dias é para conhecer o Qoro. Três recursos só
funcionam para clínica com assinatura **paga e ativa**, no plano que os inclui: **Convênios TISS**, **cobrança de
pacientes pelo Asaas** e **Agentes de IA**. Mostrar o recurso não é liberar o uso. Para Convênios, a assinatura paga é
condição necessária, mas não substitui a habilitação operacional controlada do módulo.

Este documento registra o que existia, o que foi encontrado, o que o PR #55 implementou e o que depende do PR #53.
Nada aqui altera preço, plano, limite de trial, dado financeiro histórico ou o worktree do #53.

## 1. Como o trial funciona hoje (código lido em `main` 5620a098 e no #53 `e8309aee`)

| Pergunta | Resposta (com a fonte) |
| --- | --- |
| Como a clínica é identificada em trial | `subscriptions.billing_status = 'trial'` (enum `trial / active / past_due / cancelled`) e `clinics.status = 'trial'`. No #53, a assinatura nova da oferta 2026 entra também em `trial_access_policies` com `released_at` nulo (0136, gatilho `enroll_new_subscription_trial_limits`). |
| Como os 14 dias são calculados | Oferta 2026: `PROPOSED_OFFER.proposedTrialDays = 14`, contados da criação da conta, gravados em `subscriptions.trial_ends_at` com `enforce_trial_deadline = true` (`signup-trial.ts`). Um novo login não reinicia nada: o prazo é uma coluna do backend. Ainda existe `QORO_SELF_SERVICE_TRIAL_DAYS = 7` no caminho de cadastro antigo; ver a seção 6. |
| Fim do trial sem pagamento | `assertClinicCanWriteTx` (`src/lib/tenant-access`) trata `trial` vencido com prazo obrigatório como `pending_payment`: a escrita de negócio para. A política do #53 continua sem liberação. |
| Como se confirma assinatura paga | No #53, só `releaseTrialAfterVerifiedPaymentTx` libera a política, dentro da transação que materializa a fatura **paga** (> 0) lida do provedor. Nenhum callback, status `ACTIVE` ou pagamento de paciente libera. |
| Permissões comerciais por plano | Só permissões granulares e políticas financeiras avançadas dependem do plano (`planHasAdvancedFinancialPolicies`, 0133). Não havia catálogo de recurso por plano para IA, cobrança ou convênio. |

## 2. O que já existia e as brechas encontradas

| Recurso | Proteção que já existia | Brecha |
| --- | --- | --- |
| Convênios TISS | Flag operacional `hi_clinic_settings.enabled` (nasce `false`, nenhuma clínica ligada) | **Nenhuma regra comercial.** Uma clínica em trial com o módulo ligado gerava guia (o próprio harness da cadeia unida do ciclo anterior provava isso) e a coparticipação batia no limite de 15 recebíveis do trial (R33). O worker e o reconcile não olhavam a assinatura. |
| Cobrança de pacientes (Asaas) | #53: gatilho `trial_asaas` em `clinic_payment_accounts` e `assertTrialPaidFeature('asaas')` antes de chamar o Asaas | (a) Só vale para assinatura **inscrita** na política (oferta 2026 nova). Trials antigos e planos legados não são inscritos ("Existing subscriptions, including existing trials, are deliberately not enrolled"). (b) Depois de liberada, a política não volta: clínica paga que cancela continua com a conta Asaas ativa, e os fluxos automáticos (sinal, saldo, régua) rodam como ator de sistema, que ignora o status da clínica (ADR-016). |
| Agentes de IA | #53: gatilho `trial_whatsapp` em `clinic_whatsapp_numbers` (o canal do agente) | Mesmas (a) e (b). O webhook de entrada e os crons proativos (`proactive-*`) não conferem assinatura nem status da clínica; só o interruptor global `isProactiveEnabled`. |

## 3. A regra central (implementada no #55)

- **Uma decisão, no banco:** `public.qoro_premium_denial_for(clinic, feature)` (0151). Devolve `NULL` (liberado) ou um
  motivo fixo: `clinic_unknown`, `no_subscription`, `trial`, `trial_expired`, `payment_pending`, `clinic_suspended`,
  `subscription_cancelled`, `subscription_inactive`, `plan_excludes`. Lê o estado que o backend já mantém:
  - `subscriptions.billing_status` (trial = negado em qualquer dia; `trial_ends_at` vencido = `trial_expired`);
  - a política do #53 quando a tabela existir (`trial_access_policies` sem liberação = negado, mesmo com
    `billing_status = 'active'`): consulta dinâmica, sem dependência de DDL entre as branches;
  - `clinics.status` escrito pelo dunning (`pending_payment`, `suspended_readonly`, `suspended`, `cancelled`);
  - `past_due` com a clínica ainda `active` é a **graça do dunning** (ADR-016/046: quem reduz o acesso de uma clínica
    paga é o status que o dunning escreve). Se o fundador preferir bloquear já no `past_due`, é uma linha da função;
  - plano: `qoro_plan_includes(plano, recurso)`. Hoje nenhum plano pago exclui os três recursos (é o comportamento
    atual); código de plano desconhecido fica de fora (falha fechada). Incluir ou excluir por plano é decisão comercial
    e muda só essa função.
- **Para o app:** `qoro_premium_denial(clinic, feature)` presa à clínica da sessão (42501 para outra clínica) e a
  primitiva `src/lib/premium-access` (`getPremiumDenialTx`, `assertPremiumFeatureTx`, `PremiumAccessError`,
  `premiumAccessErrorFrom`). Falha **fechada**, ao contrário do gate de escrita.
- **Mensagem:** restrição comercial, não erro técnico. Ex.: "Convênios: este recurso está disponível para clínicas com
  assinatura ativa. Conheça os planos do Qoro para habilitar esta funcionalidade." Assinatura caída: "a assinatura da
  clínica não está ativa… Os registros já feitos continuam disponíveis para consulta."

## 4. Como Convênios fica bloqueado (todas as portas)

| Porta | Bloqueio |
| --- | --- |
| Ligar o módulo (operador ou API) | gatilho `hi_aa_premium_settings` (só ligar; desligar sempre pode) |
| Marcar atendimento como convênio | gatilho `a0_hi_premium_appointment` |
| Carteirinha, cobertura, autorização | gatilhos nas tabelas + `recordAppointmentCoverage` |
| Guia (criar, reavaliar, emitir) | gatilhos em `hi_guides` e `hi_guide_snapshots` + serviços |
| Arquivo emitido | gatilho em `hi_files` (o retorno da operadora continua entrando) |
| Lote (criar, validar, exportar, enviar) | gatilho em `hi_batches` + serviços |
| Coparticipação (confirmar/cobrar) | gatilho em `hi_copayments` + `confirmCopay` |
| Worker da conclusão e reconcile | `processInsuranceBilling` lê a decisão na mesma transação: nenhuma guia; pendência **automática** `subscription_inactive` (gestor), reavaliada a cada 24 h, sem teto; regularizada a assinatura, o reconcile gera a guia sozinho |

Os gatilhos comerciais disparam **antes** dos de validação (nomes `hi_aa_*`/`a0_*`): no trial, a resposta é a restrição
comercial, não um erro de dado incompleto.

**Dados existentes:** nada é apagado nem escondido quando a assinatura cai. Leitura e download do que já foi emitido
continuam (auditados); protocolo, retorno, análise e processamento de lote **já enviado** continuam entrando (são fatos
da operadora sobre trabalho entregue: recusá-los perderia dado financeiro); cancelar e desligar continuam. Só operação
nova é barrada. Retenção: `docs/convenios/retencao-lgpd.md`.

**Liberação depois do pagamento:** o #53 libera a política e ativa a assinatura; a decisão passa a `NULL` e o módulo
pode ser ligado pela habilitação controlada (`hi_clinic_settings.enabled`, operador). Nenhuma ação do #55 libera nada.

## 5. Provas (Postgres 17 descartável, migrations reais; nada no DEV)

| Harness | Resultado | O que cobre |
| --- | --- | --- |
| `health-insurance-premium-gate-db.ts` | 10/10 | trial 1º e 14º dia, expirado, sem assinatura, pagamento pendente, ativa, cancelada, suspensa (dunning), plano sem o recurso, API direta, serviço, worker com evento atrasado, reprocesso, recuperação após regularização, trial → paga, módulo desligado, isolamento; **carência limitada (0152)**: período em curso, assinatura antiga sem período, período vencido sem carência, `past_due` dentro e fora do `grace_period_until`, cancelada no fim do período |
| `health-insurance-union-chain-db.ts` (main + #53 `9ddc432a` + #55) | 9/9 | política REAL do #53; R33; "ativa" sem fatura paga verificada negada; fatura paga libera; **a decisão do banco e o código REAL do #53 (`evaluateModuleAccess` + a consulta dele, lidos por `git show`) concordam em 8 estados** para cobrança de pacientes e Agentes de IA; Convênios segue indisponível no #53 até a liberação controlada |
| `health-insurance-glosses-payments-db.ts` | 16/16 | com a assinatura cancelada, glosa do demonstrativo e conciliação de pagamento de lote já enviado continuam aceitas (preservação) |
| `health-insurance-batches-db.ts` | 16/16 | assinatura cancelada: lote novo, exportação e envio barrados; protocolo, retorno e processado do lote enviado entram; XML emitido legível e baixável (auditado) |
| Unitários | `premium-access/policy.test.ts`, `billing-gap-policy.test.ts`, `consulta-guide-service.test.ts`, `glosses-migration.test.ts` | contrato motivo ⇔ banco (vigente na 0152), mensagens, decisão com a assinatura caída |

Permissão do usuário continua no lugar de sempre (`requireFreshPermission`) e não é afrouxada pelo gate comercial;
os dois se somam. Feature flag operacional (`hi_clinic_settings.enabled`) também se soma: assinatura paga com o módulo
desligado não opera Convênios.

## 6. Integração com o PR #53 (estado em `9ddc432a`) e nota para o agente da AbacatePay

**O que o #53 já fechou** (lido no diff `e8309aee..9ddc432a`, sem tocar o worktree dele): central própria
`src/lib/entitlements` (`getOperationalModuleAccess`), que consulta a `qoro_premium_denial` do #55 quando ela existe
(N/N-1); gate na entrada do Agente de IA (`inbound-received`), nos jobs proativos (sinal, saldo e dunning = cobrança;
o resto = IA; job negado é cancelado com o motivo), revalidação dentro da transação da ferramenta do agente, gate no
checkout hospedado de cobrança e prazo único de trial (`QORO_TRIAL_DAYS` no lugar do `QORO_SELF_SERVICE_TRIAL_DAYS`).

**Alinhamento provado:** a 0152 trouxe para o banco a mesma regra de período e carência do `evaluateModuleAccess`
(período vencido sem carência, carência expirada e cancelamento no fim do período negam). A cadeia unida compara as
duas decisões em 8 estados e elas concordam.

**Nota objetiva para o agente do #53** (nada foi alterado no worktree dele):

1. **Conexão da conta Asaas e do WhatsApp com assinatura paga que caiu:** os gatilhos `qoro_trial_limit_*` cobrem o
   trial inscrito; para clínica paga que cancelou ou foi suspensa, conferir se `account-store` e a conexão do
   WhatsApp também consultam `getOperationalModuleAccess` (o diff de `9ddc432a` não mostra mudança nesses arquivos).
2. **Trials antigos não inscritos em `trial_access_policies`:** a decisão do banco nega por `billing_status = 'trial'`,
   inscrito ou não, e a do #53 também (`billing_status === 'trial'`). Fica coberto pelas duas.
3. **`grace_period_until`:** a regra do banco (0152) depende de o billing gravar a carência, como o #53 já faz
   (fim do período + dias de dunning; cancelamento = fim do período). Assinatura antiga sem período registrado segue o
   status que o dunning escreve na clínica. Se o #53 mudar essa política, a 0152 precisa acompanhar (a prova da cadeia
   unida falha na hora se divergir).
4. **Convênios no #53:** `module_unavailable` até a liberação controlada é coerente com a D24 e com a habilitação
   operacional do #55; não exige mudança.
5. **Teste intermitente da assinatura** (`plan-change-form.test.tsx`): reprodução determinística e correção proposta
   em `docs/convenios/teste-intermitente-assinatura.md`; o arquivo é da área do #53.
6. **Ordem de merge:** #53 antes (ordem do DEV: 0136–0142), depois #55 (0143–0152). A central do #53 já é N/N-1: sem a
   0151/0152 ela decide sozinha; com elas, o banco restringe junto.

## 7. Assinatura com fatura em atraso (`past_due`) e dunning — matriz de estados

Direção do fundador (12/11): não mudar agora a política global de dunning; separar **operações comerciais novas** de
**operações de preservação e regularização**; carência só a prevista; nunca ilimitada; `past_due` nunca é pagamento.

| Estado da assinatura | Operação nova (ligar módulo, criar guia, lote, exportar, enviar, confirmar coparticipação) | Preservação (ler guia, baixar PDF/XML emitido, protocolo e retorno de lote enviado, glosa, recurso, pagamento da operadora, conciliação, auditoria, desligar módulo) |
| --- | --- | --- |
| Trial (qualquer dia) ou trial expirado | **negada** (`trial`/`trial_expired`) | não há o que preservar (nada de Convênios existe no trial) |
| Paga, ativa, período em curso | permitida (com a habilitação operacional) | permitida |
| `past_due` dentro de `grace_period_until` | permitida (carência gravada pelo billing) | permitida |
| `past_due` depois da carência | **negada** (`period_expired`) | **permitida** |
| Cancelada no fim do período, período vencido | **negada** (`period_expired`, sem carência) | **permitida** |
| Cancelada | **negada** (`subscription_cancelled`) | **permitida** |
| Clínica suspensa pelo dunning | **negada** (`clinic_suspended`) | **permitida** (leitura; o gate de escrita da clínica continua valendo para o resto do app) |
| "Ativa" sem fatura paga verificada (#53) | **negada** (`payment_pending`) | permitida |
| Plano sem o recurso | **negada** (`plan_excludes`) | permitida |

Atendimento concluído enquanto a assinatura está caída vira **pendência automática** "assinatura inativa" (reavaliada a
cada 24 h, sem teto); a guia é gerada quando a clínica regulariza — a suspensão nunca apaga nem impede tratar o que já
existe.

**Decisões comerciais que ainda precisam da sua aprovação:**

- **D24-a — Recurso de glosa com a assinatura suspensa:** classifiquei como preservação (contesta obrigação já faturada;
  bloquear pode fazer a clínica perder o prazo do recurso e o dinheiro). Se preferir tratar como operação nova, é uma
  linha no gatilho comercial da 0152.
- **D24-b — Duração da carência:** hoje é a que o billing grava (`DUNNING_READONLY_DAYS` do #53). Se a carência de
  Convênios deve ser diferente da do resto do Qoro, é decisão sua com o agente da AbacatePay.
- **D24-c — Assinatura antiga sem período registrado:** segue o status do dunning na clínica (como no #53). Se quiser
  exigir período registrado também para elas, o banco e o #53 precisam mudar juntos.
