# P4.7-b: importação de histórico com convênio, plano da opção (b) (25/11/2026)

**Decisão pendente do fundador:**

- (a) o histórico entra como particular;
- (b) registra a forma de atendimento e o convênio **sem gerar guia**;
- (c) gera guia.

A recomendação é **(b)**. Nada aqui foi ativado como política.

## O que já vale hoje (independe da escolha)

**Guarda implementada em `0005813e`:** um atendimento importado (`created_via = 'import'`) nunca vira faturamento
TISS. Não gera guia, pendência nem reprocessamento, por nenhum caminho: evento, reconcile ou correção da cobertura.

**Prova:** legado 45613349947, P7.4 com 20 de 20, incluindo um atendimento de convênio, atendido, com cobertura e
importado.

**Achado que motivou a guarda:** o esquema da importação (`HistoricalAppointmentItemSchema`) herda
`billingMode` dos campos do agendamento comum. Hoje um gestor pode colar `"billingMode": "convenio"` no JSON. A
linha entrava no reconcile do TISS e podia virar guia de atendimento já faturado fora do Qoro.

## O que a opção (b) acrescenta (a implementar depois da decisão)

| Parte | Desenho |
| --- | --- |
| Arquivo | colunas opcionais por linha: `billingMode` (`particular` \| `convenio`), `insurerAnsRegistry` (registro ANS de 6 dígitos) e `planCode` (opcional). **Sem carteirinha**: o número não vem por arquivo de importação |
| Validação por linha | convênio exige o módulo ligado e a assinatura paga (D24); a operadora tem de ser da clínica, pelo registro ANS, e estar ativa; o plano, se informado, tem de ser dessa operadora. Linha inválida recusa o lote inteiro com o número da linha e o motivo (a importação já é atômica) |
| Dados incompletos | `convenio` sem operadora: recusado. Operadora desconhecida na clínica: recusado, com a mensagem "cadastre a operadora em Convênios antes de importar" |
| Gravação | `billing_mode = 'convenio'` no atendimento e a operadora numa referência **histórica** própria (tabela aditiva `hi_historical_coverages`: atendimento, operadora, plano, lote de importação). Não usa `hi_appointment_coverages`, que exige registro antes do atendimento e alimenta o faturamento |
| Sem guia | garantido pela guarda: a referência histórica nunca é lida pelo faturamento |
| Sem recebível duplicado | a importação só publica o evento de criação, nunca o de conclusão, então nenhum recebível nasce (já é assim no particular) |
| Auditoria | a do lote de importação (`appointment_import_batch`), com contagem de linhas de convênio, sem dado pessoal |
| Isolamento | a operadora é procurada só na clínica da sessão (RLS + predicado explícito); uma operadora de outra clínica é "desconhecida" |
| Relatórios | as linhas históricas aparecem nos relatórios de atendimento como "convênio (histórico)", **fora** dos relatórios de faturamento TISS |

## Testes previstos

1. Unitários do esquema: combinações válidas e inválidas por linha.
2. Harness de banco (Postgres descartável, migration aditiva):
   - linha de convênio grava a referência histórica e nenhuma guia ou pendência;
   - operadora de outra clínica é recusada;
   - módulo desligado e trial são recusados;
   - reprocessar e reconciliar não geram nada.
3. E2E no Preview: importar um arquivo misto (particular + convênio), ver as linhas na agenda como convênio
   histórico e conferir que Convênios › Guias não mudou.

## Dono do código

- A tela e o esquema da importação ficam na agenda (`agenda/importar`, contexto `scheduling`), área comum ao #56.
- A referência histórica e a regra ficam no TISS.
- A implementação entra **depois** do rebase final do #55 sobre #53 → #56, para não editar arquivos do #56 antes
  do merge dele.
