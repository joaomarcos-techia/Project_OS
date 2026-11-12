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
| `health-insurance-premium-gate-db.ts` | 9/9 | trial 1º e 14º dia, expirado, sem assinatura, pagamento pendente, ativa, cancelada, vencida (dunning), graça, plano sem o recurso, API direta (insert como `authenticated`), serviço, worker com evento atrasado, reprocesso, recuperação após regularização (uma guia só), trial → paga, módulo desligado, isolamento entre clínicas |
| `health-insurance-union-chain-db.ts` (main + #53 `e8309aee` + #55) | 8/8 | política REAL do #53: trial nega os 3 recursos; Convênios não liga; gatilhos do #53 barram Asaas e WhatsApp; particular igual ao #53; **R33 resolvido**: no limite de 15 recebíveis não existe convênio, logo não existe coparticipação presa, e o limite não muda; "ativa" sem fatura paga verificada continua negada; fatura paga libera, guia automática e coparticipação de R$ 45 |
| `health-insurance-batches-db.ts` | 14/14 | assinatura cancelada: lote novo, exportação, validação direta e envio barrados; protocolo, retorno e processado do lote enviado entram; XML emitido legível; regularizada, exporta |
| Regressões | 19/19, 29, 13, 6, 9, 24 | P7.4, clínica, cobertura, emissão, serviço da guia e guias, todos com clínica paga |
| Unitários | `premium-access/policy.test.ts`, `billing-gap-policy.test.ts`, `consulta-guide-service.test.ts` | contrato motivo ⇔ banco, mensagens sem termo técnico, tradução só do erro conhecido, decisão do faturamento com a assinatura caída |

Permissão do usuário continua no lugar de sempre (`requireFreshPermission`: `EDIT_AGENDA`, `MANAGE_FINANCIAL`) e não é
afrouxada pelo gate comercial; os dois se somam.

## 6. O que depende do agente do PR #53 (nota objetiva)

O #55 **não** altera Asaas, WhatsApp nem Agente de IA (arquivos do #53 e do núcleo), para não conflitar nem mudar
produção por dentro do PR de convênio. A integração recomendada:

1. **Usar a decisão central** antes de qualquer efeito de cobrança de paciente ou de IA:
   `assertPremiumFeatureTx(tx, clinicId, 'patient_charges' | 'ai_agents')` (de `src/lib/premium-access`, que entra
   com o #55), além do `assertTrialPaidFeatureTx` atual. Pontos: `createInitialHostedCheckout` e
   `renewRemainderHostedCheckout` (`payments/internal/hosted-checkout.ts`), conexão da conta (`account-store.ts`),
   `processProactiveBatch` (crons `proactive-*`), entrada do webhook do WhatsApp antes do turno do agente, e as ações
   de `ai-agent/actions.ts`.
2. **Fechar a brecha (b)** (assinatura paga que cancela): hoje a política liberada não volta e o ator de sistema ignora
   o status. A decisão central já nega `subscription_cancelled`/`clinic_suspended`; basta consultá-la nesses fluxos
   automáticos. Isso não apaga nada: só impede efeito novo (cobrança, mensagem do agente).
3. **Brecha (a)** (trials e planos legados não inscritos): a decisão central nega pelo `billing_status = 'trial'`,
   inscrito ou não. Se o #53 quiser a mesma regra nos gatilhos dele, é ampliar a inscrição; não há prazo comercial
   novo nisso.
4. **Prazo do trial:** a oferta 2026 usa 14 dias; o caminho antigo ainda usa `QORO_SELF_SERVICE_TRIAL_DAYS = 7`. Vale
   confirmar se esse caminho ainda é alcançável, à luz da decisão de 14 dias.
5. **Telas:** o aviso "este recurso está disponível para clínicas com assinatura ativa" deve seguir o redesign; o #55
   não cria tela provisória. `premiumDenialMessage(feature, reason)` dá o texto.
6. **Ordem de merge:** a 0151 do #55 lê `trial_access_policies` só se a tabela existir; com o #53 aplicado antes (ordem
   do DEV), a política dele passa a valer na decisão central sem mudança de código.

Nada disso foi feito no worktree do #53.
