# Repasse de guia cancelada: contrato da revisão humana (especificação para decisão)

**Situação (16/11/2026):** especificação. **Nada implementado.** Nenhuma migration, nenhuma mudança de ledger,
nenhuma alteração no contrato do repasse. A direção foi aprovada pelo fundador como proposta de segurança financeira
(confirmação explícita na tela, pendência de revisão humana idempotente, pagamento bloqueado até a revisão). Antes de
implementar, o fundador pediu este contrato e os testes de não regressão.

## 1. O problema, medido

Prova em Postgres descartável, `scripts/security/health-insurance-payout-db.ts`, seções 13 e 14 (job sintético do
Actions):

| Caso | Hoje, depois de cancelar a guia |
| --- | --- |
| Sem repasse autorizado | elegível R$ 0,00; nada a revisar |
| Repasse **autorizado**, não pago | a obrigação continua devida e o excesso aparece (pendente de autorização negativo). **Com uma chave de idempotência nova, o saldo autorizado ainda pode ser registrado como pago** (seção 14, item v) |
| Repasse **pago** | o pagamento fica registrado, nada é estornado, o excesso aparece |
| Em todos | nenhum recebível, livro (`hi_ledger_entries`), `lancamentos` ou caixa é tocado; o histórico tem o autor |

O que já protege hoje (seção 14, itens i a iv), e que a correção precisa manter:
- a mesma chave não duplica o pagamento ("reutilizar a ação antiga" com a mesma chave é recusado);
- pagamento acima do autorizado é recusado;
- repasse com pagamento não se cancela; a correção é por ajuste;
- o ajuste é humano, com motivo, e não deixa o autorizado negativo.

O que falta: distinguir **a obrigação existente** (preservada) de **uma operação ainda apta a pagamento**. Uma guia
cancelada com repasse autorizado e não pago não pode receber um pagamento novo só porque alguém usou o botão de novo,
com outra chave.

## 2. Onde mora

Tudo do contexto Convênios: `hi_payouts`, `hi_payout_movements`, `hi_payout_position()` e a visão
`hi_payout_positions` (0157). Lê `professional_payout_rules` (tabela do repasse particular) **só para leitura**, e
continua assim. O repasse particular (`professional_payouts`, `relatorios/repasses`) e o domínio financeiro
compartilhado (`lancamentos`, `payment_transactions`, Caixa) **não mudam**. O "pagamento" do repasse no Qoro é o
registro de um pagamento feito fora (data, referência); não move dinheiro.

## 3. Contrato proposto, ponto a ponto

| # | Ponto | Proposta |
| --- | --- | --- |
| 1 | **Estados afetados** | Guia: as transições que tiram do atendimento a guia viva: cancelar (`pending_data`, `ready_for_review`, `reviewed`, `approved` → `cancelled`) e substituir (`exported`, `sent`, `under_review` → `replaced`). Na substituição, se a substituta aprovada cobre o mesmo atendimento, o repasse continua sobre ela e **não** abre revisão. Repasse: `hi_payouts.status` continua `active` (nada é cancelado sozinho); ganha o estado derivado **"em revisão"** enquanto houver revisão aberta |
| 2 | **Momento de criação** | Na **mesma transação** da transição da guia, por gatilho `AFTER UPDATE OF status` em `hi_guides`, quando o atendimento fica sem item de guia viva **e** o repasse tem autorizado + ajustes − pago > 0 ou pago > 0. Vale para qualquer caminho (tela, script, função do banco). A tela pede confirmação antes ("o repasse de R$ X autorizado ficará em revisão"), mas a garantia é o banco |
| 3 | **Idempotência** | Uma revisão **aberta** por repasse: índice único parcial `(clinic_id, payout_id) WHERE status = 'open'`, inserção com `ON CONFLICT DO NOTHING`. Cancelar de novo é impossível (estado final). Se uma substituta for cancelada depois com a revisão ainda aberta, nada novo é criado; o histórico da guia registra o novo fato |
| 4 | **Identidade do responsável** | Quem abriu: o ator da sessão da transição (`hi_session_actor()`), nunca um id vindo do cliente. Quem decidiu: o usuário da sessão da decisão, com data e hora do banco. **Decisão pedida:** exigir que quem decide seja diferente de quem cancelou (quatro olhos)? Recomendação: **não por padrão** (clínicas de 1 ou 2 pessoas travariam), registrando as duas identidades |
| 5 | **Permissões da revisão** | Ver: `view:faturamento_convenio` (hoje `view:financial`). Decidir: `manage:faturamento_convenio` (hoje `manage:financial`), com permissão **fresca** do banco. Sem portão comercial e sem exigir o módulo ligado: é preservação de obrigação (classe C, D-6). Outra clínica: "não encontrada" |
| 6 | **Registro da decisão** | Três decisões, com motivo obrigatório (10 a 500 caracteres): **manter a obrigação** (o trabalho foi feito; libera o pagamento do saldo autorizado); **reduzir** (grava, no mesmo ato, um movimento de ajuste negativo com o motivo, até o valor decidido); **ciência de repasse já pago** (registra; nenhuma compensação é feita pelo sistema). Guarda os valores no momento da abertura e da decisão (autorizado, ajustes, pago, elegível). Depois de decidida, a revisão não muda (gatilho de imutabilidade) |
| 7 | **Liberar ou impedir o pagamento** | Com revisão aberta: o banco recusa **pagamento e autorização** (`hi_payout_movement_guard`, 55000, "Repasse em revisão: a guia foi cancelada; decida a revisão antes de pagar"). O ajuste continua permitido (é o instrumento da decisão). Depois de "manter": paga até o autorizado (teto de hoje). Depois de "reduzir": paga até o novo autorizado. Autorização nova continua presa ao elegível (zero sem guia viva) |
| 8 | **Concorrência** | O gatilho que abre a revisão trava a linha do repasse (`FOR UPDATE`), a mesma que o guarda dos movimentos já trava. Se o pagamento confirmar primeiro, a revisão nasce com ele nos valores; se o cancelamento confirmar primeiro, o pagamento encontra a revisão aberta e é recusado. Duas decisões ao mesmo tempo: trava da revisão + condição "aberta"; a segunda recebe "revisão já decidida" |
| 9 | **Repasse já pago** | Abre revisão de **ciência** (rastreabilidade): não há saldo a bloquear. Nada é estornado nem apagado. Registrar um crédito contra o profissional (ajuste que deixe o pago acima do autorizado) é decisão humana separada. O sistema não compensa nem cobra o profissional sozinho (decisão (a) do fundador). Pago em parte: o saldo restante fica bloqueado até a decisão |
| 10 | **Histórico e auditoria** | A linha da revisão é o registro (quem abriu, motivo, valores; quem decidiu, decisão, motivo, valores). A decisão grava `health_insurance.payout.review_decided` em `audit_events` na mesma transação, só com identificadores e valores, sem paciente nem guia. A abertura não ganha uma segunda linha de auditoria: o cancelamento da guia já grava `health_insurance.guide.cancelled`, e a revisão aponta para ele |
| 11 | **Caixa e Financeiro** | Nenhum impacto. Nenhuma linha em `lancamentos`, `payment_transactions`, Caixa ou relatórios financeiros compartilhados. O repasse particular não muda |
| 12 | **PR #56 (UI)** | A tela de repasses de Convênios (`convenios/repasses`, `_lib/payout-ui.tsx`) só existe no #55. O #56 altera o relatório do repasse particular (`relatorios/repasses`) e o spec `payout-review-preview` dele, que não é de Convênios. Mudança de tela no #55: selo "Em revisão", botão de pagamento desabilitado com o motivo, diálogo de decisão. Visual pelo design system depois do rebase. Nenhum conflito novo |
| 13 | **Migration** | **Sim:** tabela `hi_payout_reviews` (RLS por clínica, forçada), gatilho em `hi_guides`, nova versão de `hi_payout_movement_guard` (só acrescenta a checagem) e uma coluna nova no fim de `hi_payout_positions`. **Número não reservado**: decidido na autorização, depois da 0162 e da proposta de gatilhos do módulo, pela coordenação com o #53. Fora do pacote SaaS do AbacatePay |
| 14 | **Registros existentes** | Abrir revisão não altera valor nenhum (não é movimento). **Decisão pedida:** abrir revisões também para os casos já existentes (backfill idempotente na própria migration; recomendado, para o bloqueio valer para trás) ou só para os cancelamentos novos. No DEV só há clínicas sintéticas; uma sonda só leitura conta os casos antes. Em produção as migrations TISS não existem (pré-voo pending=26): zero casos. O código que conhece a revisão sobe **depois** da migration no DEV (mesmo procedimento da 0161), e traduz o novo erro para a mensagem da tela no mesmo commit |

## 4. O que o cancelamento continua sem fazer

Apagar pagamento; reescrever o ledger; estorno automático; compensação automática; cobrança nova; mudar obrigação sem
rastro; pagamento duplicado.

## 5. Testes

**Não regressão (já rodam, seções 13 e 14 do harness do repasse):**
- a mesma chave não duplica o pagamento;
- pagamento acima do autorizado é recusado;
- repasse com pagamento não se cancela;
- ajuste não deixa o autorizado negativo; as recusas não gravam movimento;
- repasse pago fica registrado, sem estorno;
- nenhum recebível, livro ou caixa tocado; histórico com o autor.

**Depois da correção aprovada (novos, no mesmo harness):**
1. cancelar guia com repasse autorizado e não pago → revisão aberta; pagamento com chave **nova** recusado (o item v
   da seção 14 muda **por decisão**, junto com a correção); autorização recusada;
2. "manter" → paga até o autorizado; "reduzir" → ajuste gravado no mesmo ato e pagamento limitado ao novo autorizado;
3. repasse pago → revisão de ciência; nada estornado; pago em parte → saldo bloqueado;
4. corrida cancelamento × pagamento, nas duas ordens; duas decisões simultâneas → uma vence;
5. idempotência: substituída e depois cancelada → uma revisão aberta só;
6. permissão: financeiro e gestor decidem; recepção recusada; outra clínica "não encontrada";
7. módulo desligado e assinatura suspensa: a decisão continua permitida (classe C);
8. auditoria da decisão na mesma transação, sem dado de paciente;
9. backfill idempotente (se aprovado);
10. substituição com substituta viva no mesmo atendimento → sem revisão.

**Tela (componente):** confirmação antes de cancelar guia com repasse autorizado ou pago; selo "Em revisão"; botão de
pagamento desabilitado com o motivo; diálogo com as três decisões.

## 6. Decisões pedidas ao fundador

1. Aprovar este contrato para implementação (com migration nova, número na autorização).
2. Quatro olhos na decisão: sim ou não (recomendação: não por padrão).
3. Backfill dos casos existentes: sim ou não (recomendação: sim).
