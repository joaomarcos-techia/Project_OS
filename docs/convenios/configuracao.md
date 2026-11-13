# Convênios — configuração pela interface (R44)

**Situação (13/11/2026):** implementada (`67c2dee6`, `e2d0cf1f`, `bf59cbc3`), testada (harness
`health-insurance-config-db.ts` 13/13) e validada no Preview que usa o DEV
(`e2e/convenios-config-preview.spec.ts`): uma clínica sintética **zerada** configurou tudo pela interface,
sem SQL nem fixture de cadastro.

A fixture `hi-dev-e2e-fixture.ts setup-config` só cria o que não é cadastro da clínica:
- a clínica `e2e-hi-config`;
- as contas;
- a assinatura paga;
- a **habilitação operacional** do módulo, que é decisão do Qoro, nunca da clínica.

## Telas

| Tela | O que faz | Quem altera |
| --- | --- | --- |
| `/convenios/configuracao` | O que falta para faturar (prontidão); identificação do prestador (PJ/PF, nome do contratado, CNES ou declaração de ausência); operadoras; perfil TISS dos profissionais (conselho, número, UF, CBO) | `manage:financial` |
| `/convenios/configuracao/operadoras/:id` | Dados e situação da operadora (rascunho → ativa → suspensa → arquivada → reativada); planos; procedimentos contratados (TUSS, valor, coparticipação, autorização, retorno); versões anteriores; histórico de alterações | `manage:financial` |
| `/convenios/carteirinhas` | Busca do paciente; carteirinhas com só o final visível; cadastrar, substituir o número, validade e plano, desativar e reativar, preferencial; "Ver número" auditado (finalidade `atendimento`) | `edit:patient` (recepção) |
| `/convenios/atendimentos` | Próximos atendimentos de convênio, situação da cobertura e o que falta; registrar ou corrigir a cobertura (inclusive de atendimento remarcado) | `edit:agenda` |
| Agenda › Novo atendimento | Forma de atendimento Particular/Convênio (só com o módulo habilitado): operadora, plano, carteirinha (mascarada), tipo de guia | `edit:agenda` |
| Conciliação › Coparticipações a conferir | Conferir o valor calculado (recepção), confirmar o que cobrar (nunca acima do conferido) ou dispensar com motivo | conferir: `edit:patient`; confirmar e dispensar: `manage:financial` |

Ver é `view:financial` (a médica não vê). Tudo é conferido de novo no servidor e no banco:
- CHECKs e FKs compostas;
- gatilho de mesma clínica;
- contrato imutável;
- carteirinha imutável;
- RLS por clínica.

## Regras que valem

- **Nada inventado.** Registro ANS, código do prestador, CNPJ e CPF vêm da clínica e são conferidos
  (formato e dígitos; CNPJ alfanumérico aceito). Os códigos TUSS (tabela 22), CBO (24), conselho (26) e
  UF (59) só entram se existirem e estiverem vigentes na terminologia oficial carregada. A busca nunca
  oferece código de fora dela.
- **Contrato append-only.**
  - **Reajustar a partir de uma data** encerra a versão anterior na véspera e cria a nova vigência. O
    atendimento antigo sem guia continua com o preço da data dele (provado pela seleção real
    `selectEffectiveContract`).
  - **Corrigir** cria uma versão com a mesma vigência.
  - **Encerrar** cria uma versão com fim.
  - Duas revisões simultâneas do mesmo item: uma vence e a outra recebe "já revisado".
  - **Guia emitida nunca muda** (snapshot congelado).
- **Carteirinha.**
  - O número fica só cifrado, com HMAC de busca sobre `clínica:registro ANS:número` (D21) e os 4
    últimos dígitos.
  - A mesma carteirinha ativa não pode estar em dois pacientes da clínica.
  - Trocar o número é substituição: a antiga fica `replaced` e aponta para a nova.
  - Há uma única preferencial por paciente.
- **Desativar nunca apaga.** Operadora arquivada, plano arquivado e carteirinha inativa continuam no
  histórico e nas guias.
- **Agendamento de convênio.**
  - O atendimento nasce `convenio` no próprio INSERT do Scheduling, e a cobertura entra logo depois. Não
    existe janela "particular" em que um sinal ou um link do saldo cheio possam ser pedidos.
  - Se a cobertura falhar, o atendimento continua convênio com a pendência visível. O paciente não é
    cobrado: o banco só aceita recebível de convênio pela coparticipação confirmada.
  - Remarcar mantém a forma de atendimento. Antes, a remarcação o transformava em particular; corrigido.
- **Coparticipação.**
  1. Estimada na cobertura.
  2. Calculada na conclusão.
  3. Conferida pela recepção.
  4. Confirmada por quem gerencia o financeiro.
  5. Só então vira recebível do paciente, pelo valor confirmado. No exemplo validado: R$ 45,00 sobre uma
     consulta de R$ 150,00.

## Trial e suspensão (D24, sem mudança de política)

O bloqueio comercial do banco é a única decisão:
- no trial, a clínica pode **preparar** o cadastro: prestador, operadora, plano, contrato e perfil;
- carteirinha, cobertura, guia, lote e confirmação da coparticipação são **operações novas** e são
  recusadas;
- as telas mostram Convênios como recurso contratável.

## Processamento na hora (Preview e DEV não têm cron)

O evento da conclusão de atendimento de convênio (consultório → guia automática), o da coparticipação
confirmada (→ recebível) e o pedido de XML em segundo plano (R45) são processados logo depois da
resposta, só pelas chaves que o request publicou (`runOutboxEventsNow` via `after`). O cron do outbox
continua sendo a garantia.

## Ainda não coberto (com tarefa no plano)

- Credenciamento por plano e vigência (P2.2, `hi_credentials`).
- Configurações por operadora: código de validação, prazo de envio, conector SOAP e credenciais
  cifradas (P2.5).
- Importação de tabela contratual por planilha (P2.7).
- Aba "Convênios" na ficha do paciente e item de menu: dependem da branch de UI (P3.2, menu).
- Trocar particular ↔ convênio de um atendimento já criado pela agenda (P4.3). Hoje: pela correção da
  cobertura em Atendimentos.
