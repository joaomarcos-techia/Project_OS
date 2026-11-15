# Matriz de permissões I.2 de Convênios (P1.12): proposta para decisão

**Situação (15/11/2026, noite):** proposta. Nada aplicado. Código-base: HEAD `50319d2f` do PR #55 (draft). DEV com
162 migrations (a última é a 0161), 28 códigos de permissão e **nenhum** override individual (sonda só leitura de
15/11, sem dado pessoal). A migration candidata está em
[`migrations/0162_hi_permission_matrix.candidate.sql`](migrations/0162_hi_permission_matrix.candidate.sql), fora do
journal. A prova em Postgres descartável é
[`scripts/security/health-insurance-permission-matrix-db.ts`](../../scripts/security/health-insurance-permission-matrix-db.ts):
escrita, mas **ainda não executada**, porque a máquina está reservada à janela do AbacatePay.

A direção funcional foi aprovada pelo fundador em 15/11 **como diretriz de desenho**:
- a recepção opera sem ver valores;
- o financeiro fatura sem gerenciar o cadastro;
- a médica vê só o próprio atendimento.

A matriz completa abaixo é o que falta para a decisão. Não há autorização para aplicar a 0162 nem para mudar
permissões efetivas.

## 1. Resumo para decisão

| Papel | Hoje em Convênios | Com a I.2 | Efeito |
| --- | --- | --- | --- |
| owner, gestor | vê e age em tudo | vê e age em tudo | nenhum |
| recepção (`attendant`) | **vê tudo, inclusive valores** (tem `view:financial` pelo papel); cadastra carteirinha e cobertura; não confere nem aprova | opera (carteirinha, cobertura, autorização, solicitação SP/SADT, conferência e correção), **sem valores** | ganha operação; **perde a visão de valores** em Convênios |
| financeiro (`financial`) | vê e age em tudo, **inclusive cadastro de operadoras, contratos e credenciais da operadora** | fatura (aprovação, lotes, glosas, recursos, conciliação, repasses) e vê valores; não gerencia o cadastro nem as credenciais | **perde o cadastro e as credenciais** |
| médica (`doctor`) | não entra em Convênios; preenche a indicação clínica da solicitação interna; cadastra carteirinha (por `edit:patient`) e marca o atendimento como convênio (por `edit:agenda`) | entra em Convênios e vê **só as próprias guias**; a indicação clínica continua igual | ganha a visão das próprias guias; **perde** carteirinha e cobertura (vão para a recepção). Decisão D-3 |

Os códigos de hoje (`view:financial`, `manage:financial`) **continuam** nos pacotes. O Caixa, o Financeiro e as
demais áreas não mudam. A I.2 só troca a base de acesso **dentro de Convênios**.

## 2. Estado de hoje (verificado no código)

| Superfície | Portão de hoje | Onde |
| --- | --- | --- |
| Todas as telas de `/convenios/*` | `view:financial` para entrar; `manage:financial` para agir | `convenios/_lib/access.tsx` |
| Aba Convênios do paciente | `view:financial` | `pacientes/[id]/page.tsx` |
| 40 server actions de `actions.ts` (guias, lotes, glosas, recursos, pagamentos, conciliação, SP/SADT, repasses, coparticipação) | `manage:financial` pelo `gate()`; exceção listada: indicação clínica | `health-insurance/actions.ts`, `actions-gate.test.ts` |
| Cadastro (prestador, operadoras, planos, contratos, regras, credenciamento, credenciais da operadora, importação de contrato) | `manage:financial` | `health-insurance/config-actions.ts` |
| Carteirinhas (criar, substituir, editar, ativar, preferida) | `edit:patient` | `config-actions.ts` |
| Número completo da carteirinha | por finalidade: atendimento e autorização `edit:patient`; guia e faturamento `manage:financial`; exportação `export:patient`; leitura auditada | `internal/membership-access.ts` |
| Cobertura e forma de atendimento na agenda | `edit:agenda` | `config-actions.ts` |
| Guia emitida, PDF, download de arquivo, guias do lote | `view:financial` (permissão fresca, leitura auditada) | `internal/guide-access.ts` |
| XML do lote, faturamento, reprocessamento | `manage:financial` | `internal/guide-access.ts` |
| Pedido de exportação do lote | `manage:financial` (fresca) | `convenios/_lib/batch-export-actions.ts` |
| Coparticipação: conferir / confirmar e dispensar | `edit:patient` / `manage:financial` | `convenios/_lib/copay-review-actions.ts` |
| Busca na terminologia oficial | `view:financial` | `config-actions.ts` |

Pacotes de hoje que importam aqui:

| Código | owner | gestor | attendant | financial | doctor |
| --- | :-: | :-: | :-: | :-: | :-: |
| `view:financial` | ✔ | ✔ | ✔ | ✔ | — |
| `manage:financial` | ✔ | ✔ | — | ✔ | — |
| `edit:patient` | ✔ | ✔ | ✔ | — | ✔ |
| `edit:agenda` | ✔ | ✔ | ✔ | — | ✔ |
| `create:prontuario` | ✔ | ✔ | — | — | ✔ |

## 3. Códigos e pacotes propostos

| Código | owner | gestor | attendant | financial | doctor |
| --- | :-: | :-: | :-: | :-: | :-: |
| `view:convenios` | ✔ | ✔ | ✔ | ✔ | ✔ (só as próprias guias) |
| `manage:convenios` | ✔ | ✔ | — | — | — |
| `operate:convenios` | ✔ | ✔ | ✔ | — | — |
| `view:faturamento_convenio` | ✔ | ✔ | — | ✔ | — (ver o ajuste abaixo) |
| `manage:faturamento_convenio` | ✔ | ✔ | — | ✔ | — |

**Ajuste técnico em relação à I.2 do plano (a decidir, D-4).** A I.2 dá à médica `view:faturamento_convenio`
"só nas guias dos próprios atendimentos". A proposta **não** dá esse código à médica. O "próprio" vira filtro de
posse no servidor, como manda o catálogo (`permissions.ts`: "NÃO criar permissions por instância"):
- **ver a clínica inteira** exige `operate:convenios` ou `view:faturamento_convenio`;
- **sem nenhum dos dois**, a lista e a tela mostram só as guias em que a pessoa é executante ou solicitante
  (`hi_guides.executant_professional_id` / `requester_professional_id`, que já existem e o banco confere contra a
  clínica);
- **valores da própria guia**: a I.2 diz que sim (a médica vê a própria produção). Se o fundador preferir que não,
  basta não mostrar. O código fica igual.

A troca não usa `role === 'doctor'`, que o teste de arquitetura proíbe (ADR-032). Vale para qualquer pessoa sem
visão ampla.

## 4. Matriz por operação

Legenda das colunas:
- **Escopo:** **C** = só a clínica da sessão (`withTenant` + RLS + `WHERE clinic_id`); **P** = só as próprias guias
  e atendimentos (posse).
- **Valores:** se a operação mostra valores de faturamento.
- **D24:**
  - **nova** = operação nova, recusada em trial e com a assinatura parada;
  - **preserva** = preservação do que já foi faturado, permitida com a assinatura suspensa (0151/0152, decisão de
    11/11);
  - **livre** = leitura ou desfazer.
- **Risco:** risco de regressão da troca.

### 4.1 Cadastro e configuração (`manage:convenios`)

| Operação | Hoje | Proposta | Papéis | Escopo | Valores | Auditoria | D24 | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identificação do prestador; ligar e desligar o módulo | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `config.provider_identity_saved` (antes/depois) | ligar: nova (gatilho `hi_aa_premium_settings`); desligar: livre | financeiro perde |
| Operadoras: criar, editar, ativar e desativar | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `config.insurer_*` | livre (cadastro) | financeiro perde |
| Planos e categorias | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `config.plan_*` | livre | financeiro perde |
| Tabela de preços do contrato (linhas, revisão, importação) | `manage:financial` | `manage:convenios` | owner, gestor | C | **sim** | `config.contract_line_*`, importação validada antes de aplicar | livre | financeiro perde. **Decisão D-1** |
| Regras da operadora (lote, prazos, agrupamento SP/SADT) | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `config.insurer_rules_updated` | livre | financeiro perde |
| Credenciamento e perfil profissional (conselho, CBO) | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `config.credential_*`, `config.professional_profile_saved` | livre | financeiro perde |
| Credenciais da operadora (segredo cifrado; salvar, revogar) | `manage:financial` | `manage:convenios` + permissão **fresca** | owner, gestor | C | — | `config.insurer_credential_saved/revoked` (sem o segredo) | livre | financeiro perde (redução desejada: segredo) |
| Política de repasse da clínica (`on_receipt`, `on_approval`, `on_completion`) | `manage:financial` | `manage:convenios` | owner, gestor | C | — | `payout.policy_changed` | livre | financeiro perde. **Decisão D-2** |

### 4.2 Recepção (`operate:convenios`)

| Operação | Hoje | Proposta | Papéis | Escopo | Valores | Auditoria | D24 | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Carteirinha: criar, substituir, editar, ativar, preferida | `edit:patient` | `operate:convenios` | owner, gestor, recepção | C | — | `config.membership_*` (número cifrado; nunca no log) | criar: nova (`hi_aa_premium_memberships`); editar: livre | **médica perde**. **D-3** |
| Ver o número completo da carteirinha | por finalidade (`edit:patient` / `manage:financial`) | atendimento e autorização: `operate:convenios`; guia e faturamento: `manage:faturamento_convenio`; exportação: `export:patient` | idem | C | — | leitura auditada `card_number_viewed` (finalidade, tela) | livre | médica perde a leitura de atendimento |
| Cobertura e elegibilidade no check-in | `edit:agenda` | `operate:convenios` | owner, gestor, recepção | C | — | `coverage.recorded` | nova (`hi_aa_premium_coverages`) | **médica perde**. **D-3** |
| Forma de atendimento "Convênio" na agenda | `edit:agenda` | **sem mudança** (`edit:agenda`) | owner, gestor, recepção, médica | C | — | `appointment.modality_changed` | nova (`a0_hi_premium_appointment`) | nenhum (é agenda) |
| Autorização: pedir, registrar a resposta da operadora, anexar comprovante (P6.1/P6.3) | — (serviços da P6.1, sem tela) | `operate:convenios` | owner, gestor, recepção | C | — | `authorization.*`; senha da operadora cifrada | nova (gatilho + serviço) | nenhum (novo) |
| Ler comprovante de autorização | — | `operate:convenios` ou `manage:faturamento_convenio` | owner, gestor, recepção, financeiro | C | — | leitura auditada `authorization.receipt_read`; nunca devolve byte adulterado | livre | nenhum (novo) |
| Solicitação SP/SADT: criar, conferir, registrar autorização, negar, cancelar, concluir, cancelar item, vincular sessão, documento | `manage:financial` | `operate:convenios` | owner, gestor, recepção | C | — | `sadt_request.*` | criar: nova (`hi_aa_premium_sadt_requests`); demais: serviço | recepção ganha; **financeiro perde** a operação de solicitação (fatura a guia, não pede) |
| Indicação clínica da solicitação | interna: `create:prontuario`; externa: `manage:financial` | interna: **sem mudança**; externa: `operate:convenios` | interna: owner, gestor, médica; externa: owner, gestor, recepção | C (+ P para a médica) | — | `sadt_request.indication_set` | serviço | nenhum |
| Conferir a guia ("marcar como conferida") | `manage:financial` | `operate:convenios` ou `manage:faturamento_convenio` | owner, gestor, recepção, financeiro | C | **não** para a recepção | `guide.reviewed` + histórico | nova (serviço, D24 desde 15/11) | recepção ganha |
| Corrigir dados da Consulta antes da conferência (P4.6) | `manage:financial` | `operate:convenios` ou `manage:faturamento_convenio` | idem | C | — | `guide.consulta_fields_updated` (só o nome do campo no histórico) | nova (serviço) | recepção ganha |
| Devolver para correção | `manage:financial` | `operate:convenios` ou `manage:faturamento_convenio` | idem | C | — | `guide.returned` | nova (serviço, D24 desde 15/11) | recepção ganha |
| Coparticipação: conferir o valor | `edit:patient` | `operate:convenios` | owner, gestor, recepção | C | valor da coparticipação (do paciente) | `copay.checked` | serviço | médica perde |

### 4.3 Faturamento (`view:` e `manage:faturamento_convenio`)

| Operação | Hoje | Proposta | Papéis | Escopo | Valores | Auditoria | D24 | Risco |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aprovar e emitir (snapshot cifrado) | `manage:financial` | `manage:faturamento_convenio` (fresca) | owner, gestor, financeiro | C | sim | histórico da guia (aprovada, por quem) + snapshot com hash + leitura auditada da carteirinha (`geracao_guia`). Sem linha própria em `audit_events` (lacuna anotada, P12.2) | nova (serviço + gatilho do snapshot) | nenhum |
| Reabrir guia aprovada (motivo obrigatório; revisão nova) | `manage:financial` | `manage:faturamento_convenio` | idem | C | sim | histórico + revisão anterior preservada | serviço | nenhum |
| Cancelar guia (até "aprovada"; motivo obrigatório) | `manage:financial` | `manage:faturamento_convenio` | idem | C | — | `guide.cancelled` + histórico | **livre** (§6) | nenhum |
| Lotes: montar, exportar XML, marcar enviado, protocolo, análise, cancelar | `manage:financial` | `manage:faturamento_convenio` (exportação fresca) | idem | C | sim | `batch.*`; arquivo com SHA-256 | montar/exportar/enviar: nova (`hi_aa_premium_batches`); protocolo e análise: preserva | nenhum |
| Baixar XML, PDF e arquivo emitido | `view:financial` | `view:faturamento_convenio` | owner, gestor, financeiro | C | sim | leitura auditada (`download_arquivo`) | livre | **recepção perde**. **D-5** (PDF para assinatura) |
| Glosas: registrar e decidir | `manage:financial` | `manage:faturamento_convenio` | idem | C | sim | `gloss.*` (só inclusão) | preserva | nenhum |
| Recursos de glosa: criar, protocolar, XML, resposta | `manage:financial` | `manage:faturamento_convenio` | idem | C | sim | `appeal.*` | preserva (o XML é arquivo novo, liberado pela 0152) | nenhum |
| Conciliação: pagamento da operadora, alocar, estornar alocação, conciliar guia, importar demonstrativo | `manage:financial` | `manage:faturamento_convenio` | idem | C | sim | `payment.*`, `guide.reconciled`; estorno é lançamento compensatório | preserva | nenhum |
| Repasse do convênio: autorizar, registrar pagamento, ajustar, cancelar, sincronizar | `manage:financial` | `manage:faturamento_convenio` | idem | C | sim | `payout.*` (só inclusão, idempotente) | sem portão comercial (§6) | nenhum |
| Coparticipação: confirmar e dispensar; cobrança Asaas do paciente | `manage:financial` | **sem mudança** (`manage:financial`; cobrança também com o portão `patient_charges`) | owner, gestor, financeiro | C | sim (do paciente) | `copay.confirmed/waived`, `copay.charge_*` | confirmar: nova (`hi_aa_premium_copayments`) | nenhum. É cobrança de paciente (Asaas), não recebimento de operadora |

### 4.4 Leitura

| Superfície | Hoje | Proposta | Escopo | Valores |
| --- | --- | --- | --- | --- |
| Entrar em `/convenios` (hub, pendências, atendimentos) | `view:financial` | `view:convenios` | C, ou P sem visão ampla | só com `view:faturamento_convenio` |
| Lista e tela da guia, histórico e revisões | `view:financial` | `view:convenios` | C com `operate` ou `view:faturamento`; senão P | com `view:faturamento_convenio`; P: própria produção (D-4) |
| Lotes, conciliação, repasses (telas) | `view:financial` | `view:faturamento_convenio` | C | sim |
| Configuração (telas) | `view:financial` | ler: `view:convenios`; agir: `manage:convenios` | C | tabela de preços só com `manage:convenios` ou `view:faturamento_convenio` |
| Carteirinhas (tela) e aba Convênios do paciente | `view:financial` | `view:convenios` (número mascarado) | C | — |
| Solicitações SP/SADT (tela) | `view:financial` | `view:convenios` | C, ou P (solicitante) | — |
| Relatórios de Convênios (pendências, envelhecimento, glosas) | `view:financial` | `view:faturamento_convenio` | C | sim |
| Busca na terminologia oficial | `view:financial` | `view:convenios` | — | — |

## 5. Defesa em profundidade

| Camada | Hoje | Com a I.2 |
| --- | --- | --- |
| Banco: RLS | por clínica em todas as tabelas `hi_*` (`app.current_clinic` / `current_clinic_id()`); não olha papel | igual. RLS por papel **não** está proposta (o padrão do projeto é "RLS ≠ RBAC", ADR-007 D27). Custaria levar as permissões efetivas ao `withTenant` e reescrever as políticas de 30+ tabelas, com risco alto de regressão. As tabelas de autorização já são trancadas (0040) |
| Banco: gatilhos | D24 nas operações novas (0151/0152/0156); máquina de estados da guia; congelamento depois da conferência | iguais |
| Server actions | `requireUser` (sessão + `claims_version` por requisição, ADR-037) → permissão → `requireClinicId` → Zod → transação com auditoria | iguais, com o código novo. As críticas (aprovar, exportar, credenciais) usam a permissão **fresca** do banco |
| Services | leitura auditada (carteirinha, guia emitida, comprovante); D24 dentro da transação | iguais. O filtro P entra nas consultas |
| Telas | escondem o que o servidor recusa | escondem valores sem `view:faturamento_convenio`. Esconder não protege: o servidor não devolve o valor (as consultas deixam de selecionar a coluna) |
| Downloads e exportações | permissão fresca + leitura auditada | iguais, com o código novo |
| URL direta | tela "Sem acesso"; action recusa; id de outra clínica não resolve (RLS) | iguais; guia de outra pessoa sem visão ampla = "não encontrada" (não confirma existência) |

## 6. Estado comercial (D24) e cancelamento

A política está escrita na 0151 e na 0152 (decisão do fundador de 11/11):
- **barrado com a assinatura parada:** operação nova (ligar o módulo, convênio no atendimento, carteirinha,
  cobertura, autorização, guia, emissão, arquivo emitido, lote até o envio, coparticipação);
- **permitido:** ler, baixar o que já foi emitido (auditado), **cancelar**, e os fatos da operadora sobre trabalho
  já entregue (protocolo, retorno, análise, glosa, pagamento, recurso);
- **conferir e devolver:** recusados desde 15/11 também no serviço.

Os efeitos do cancelamento, verificados no banco, estão no parecer do
[`handoff-ui.md` §10.2](handoff-ui.md#102-parecer-cancelar-guia-com-a-clínica-suspensa). Ponto aberto (D-6): o
**repasse do convênio** não tem portão comercial. É obrigação com o profissional sobre trabalho já feito, coerente
com "preservação", mas a 0151 não o lista.

## 7. Compatibilidade

- **Código publicado com a 0162 aplicada:** nada muda.
  - Os códigos novos entram no token.
  - `sanitizePermissions` (`claims.ts`) descarta o que o catálogo TS não conhece.
  - O teto de 128 códigos fica longe (máximo 33).
  - Nenhum código atual lê os códigos novos.
  - Cada perfil renova o token uma vez (`claims_version`, gatilho da 0040).
- **Clínicas e papéis existentes:** os pacotes de hoje não perdem nada. A I.2 só vale quando o código da P1.12-b
  subir.
- **Overrides individuais (planos com permissões granulares):** a 0162 leva para os códigos novos só o override que
  mudava o acesso. As regras R1–R4 estão no cabeçalho da candidata:
  - negativa de ver o financeiro ⇒ sem Convênios;
  - negativa de gerenciar ⇒ sem gerenciar, operar e faturar;
  - concessão de ver à médica ⇒ vê com valores;
  - concessão de gerenciar à recepção ou à médica ⇒ tudo.

  Override redundante não é levado. No DEV não há nenhum. **Em produção a contagem é desconhecida** (pede o pré-voo
  só leitura, não autorizado).
- **Guias já emitidas, revisões e histórico:** não mudam. A I.2 decide quem vê e quem age, não o conteúdo.
- **Consultas em andamento:** a sessão aberta antes da troca é renovada na próxima requisição (`claims_version`).
  Uma ação em voo é decidida pela permissão do momento.
- **Preview compartilhado:**
  - a P1.12-b (troca dos portões) **não pode subir antes da 0162 no DEV**: sem os códigos, todos perderiam
    Convênios;
  - o catálogo TS e os rótulos sobem junto, porque `scripts/smoke-c3.ts` e `e2e/dev-rbac-matrix.spec.ts` comparam o
    catálogo e os pacotes do banco com o código;
  - mesmo procedimento da 0161: commits locais até a aplicação.
- **Testes E2E:** a spec `convenios-guide-states-preview` usa a recepção (hoje recusada em tudo) e a gestora. Com a
  I.2, a recepção passa a conferir e corrigir. As asserções mudam junto e **por decisão**, não para passar:
  - continua provada a recusa de aprovar, cancelar e ver valores;
  - o DEV não tem perfil `financial`: as provas do financeiro pedem uma conta sintética nova na clínica `e2e-hi-*`.
- **Relatórios financeiros e tabelas compartilhadas:** a 0162 não toca `lancamentos`, `payment_transactions` nem o
  Caixa.
  - O Caixa e o Financeiro continuam com `view:financial`. **A recepção continua vendo, no Caixa, os recebimentos da
    operadora** (forma "convênio"). A separação é da P10.6, junto com a UI.
- **AbacatePay (Gate B 0136–0159):** a candidata só referencia `permissions`, `role_permissions`,
  `user_permission_overrides`, `profiles` (leitura) e `_schema_version`.
  - Não muda `effective_permissions_v` (0133) nem o hook (0055).
  - Fica fora do pacote SaaS e entra depois da 0161, no #55.

## 8. Decisões pedidas ao fundador

| # | Pergunta | Recomendação |
| --- | --- | --- |
| D-1 | Tabela de preços do contrato: só owner e gestor (I.2), ou também o financeiro? | I.2 (só owner e gestor). Preço é cadastro; o financeiro vê e fatura |
| D-2 | Política de repasse (quando o profissional pode receber): cadastro (`manage:convenios`) ou faturamento? | cadastro (owner e gestor): é regra da clínica com os profissionais |
| D-3 | A médica perde carteirinha e cobertura (hoje por `edit:patient` / `edit:agenda`)? | sim, como a I.2: a recepção opera. A forma de atendimento na agenda continua com a médica |
| D-4 | Escopo "próprio" da médica por posse (sem `view:faturamento_convenio`), mostrando os valores da própria produção? | sim aos dois |
| D-5 | PDF da guia para a assinatura do paciente na recepção: com ou sem valores? | gerar o PDF da Consulta para assinatura com `operate:convenios`. Os valores entram no XML e no PDF de faturamento, não na via de assinatura. Exige mudança no gerador (P7.7) |
| D-6 | Repasse do convênio com a assinatura suspensa: permitido como "preservação"? | sim (é obrigação com o profissional sobre trabalho feito); registrar na D24 |
| D-7 | Herança dos overrides (R1–R4) como está na candidata, incluindo a negativa de operar para quem tinha `manage:financial` negado? | sim. Ninguém ganha o que foi negado. A perda pequena (carteirinha do gestor com gerenciar negado) é revertida pela Equipe |
| D-8 | Autorizar a aplicação da 0162 no DEV depois das provas descartáveis, pelo procedimento do §18 da coordenação? | sim, depois do ensaio verde e com a janela de máquina livre |

**15/11 (noite, 2ª rodada): revisão de D-3, D-5 e D-6 depois da orientação do fundador.**

- **D-6:** respondida pelo fundador. Repasse autorizado ou pago é obrigação **preservada**; a compensação negativa
  **não** é automática e vira pendência de revisão humana. Isso não libera operação financeira nova com a assinatura
  suspensa. Medição do comportamento atual: `health-insurance-payout-db.ts`, seção 13.
- **D-3 (médica, carteirinha e cobertura). A recomendação mudou.**
  - Numa clínica sem recepção, como uma clínica de 2 médicos, é a própria médica quem cadastra a carteirinha e
    registra a cobertura no check-in. Tirar isso sem alternativa trava o atendimento.
  - **Nova recomendação (opção B):** acesso limitado à **posse**, sem `operate:convenios` e sem valores.
    - Cobertura e carteirinha só para os **próprios** atendimentos, ou seja, os do paciente que ela vai atender. A
      regra é `appointments.doctor_id` = pessoa da sessão, conferida no servidor.
    - Leitura do número completo da carteirinha só com a finalidade "atendimento" e auditada.
  - **Opção A:** a I.2 literal, em que a médica perde as duas operações. Mais simples, mas trava a clínica sem
    recepção.
  - **Opção C:** manter como hoje (`edit:patient`/`edit:agenda`). Nesse caso a médica opera carteirinha e cobertura de
    qualquer atendimento da clínica.
  - **Testes da opção B:**
    - a médica registra a cobertura do próprio atendimento;
    - a médica é recusada no atendimento de outra profissional, tanto pela action direta quanto pelo id adulterado;
    - a médica não vê valores.
- **D-5 (recepção, PDF e XML). Recomendação mantida, com regra de transição.**
  - **O que os arquivos contêm:**
    - o PDF e o XML da guia têm o nome do beneficiário, o número da carteirinha, o código do procedimento e o
      **valor** (`valorProcedimento` na Consulta; `valorUnitario`/`valorTotal` na SP/SADT);
    - na SP/SADT entra também a **indicação clínica**, quando informada;
    - o XML do lote junta tudo isso para várias guias.
  - **O que a recepção precisa:** a via em papel da guia para a assinatura do paciente, quando a operadora exige.
    Ela não precisa do XML.
  - **Recomendação:**
    1. gerar a **via de assinatura** (PDF sem valores) com `operate:convenios`;
    2. só depois tirar da recepção o PDF completo;
    3. o XML nunca vai para a recepção.
  - **Até a via existir:** nada muda para a recepção. Ela continua com o PDF atual, sob leitura auditada. Assim o
    documento necessário ao atendimento não é retirado sem alternativa.
  - **Testes:**
    - a via de assinatura não contém `valorProcedimento` nem valores;
    - a recepção é recusada no XML e no PDF completo depois da troca;
    - toda leitura gera um evento auditado.

## 9. Testes previstos

- **Banco descartável** (a candidata):
  - harness `health-insurance-permission-matrix-db.ts`, 12 provas: catálogo, pacotes, efetivas, R1–R4, claims, sem
    DDL, hook, reaplicação, runtime sem escrita, reversão, escopo, reaplicação depois da reversão;
  - tudo depois da cadeia do DEV.
- **Unitários (P1.12-b):**
  - mapa ação → código, com um teste estático no padrão do `actions-gate.test.ts`: toda action exportada declara o
    código da matriz;
  - telas sem valores para a recepção;
  - filtro P.
- **Banco descartável (P12.2):** recepção, financeiro, médica, outra clínica e trial/suspensa para cada grupo da
  matriz. Inclui a guia de outra médica: "não encontrada".
- **Preview, com as contas sintéticas `e2e-hi-*`** e uma conta `financial` nova: recepção sem valores e sem aprovar;
  financeiro sem cadastro; médica só as próprias.
- **Não regressão:** `security:inventory`, `permission-enforcement-map.test.ts` (código sem consumidor),
  `critical-actions.test.ts`, `smoke-c3` e `dev-rbac-matrix` com o catálogo novo.
