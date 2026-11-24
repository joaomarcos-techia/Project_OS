# Decisão P8.4-r: item executado sem solicitação prévia (ficha para aprovação, 23/11/2026)

**O caso.** Numa sessão de SP/SADT, a clínica faz um procedimento além do que foi agendado e solicitado (exemplo: uma segunda técnica na mesma sessão).

O Qoro já registra esse item. **A decisão aqui é só uma:** se ele entra na guia e na cobrança à operadora, e quando.

**As duas regras abaixo valem em qualquer alternativa:**
1. O registro clínico legítimo nunca se perde por falta de solicitação financeira.
2. Nenhum item sem a autorização exigida é faturado automaticamente.

## Como está hoje

Funciona sem decisão e com as duas regras protegidas:
- **Registro:** o item fica registrado (quem, quando, código e quantidade do contrato), com a pendência "regra de faturamento aguardando decisão".
- **Guia:** a guia nasce só com o procedimento agendado. Nada é cobrado a mais.
- **Aprovação:** a guia pode ser aprovada sem o item. **Não há bloqueio nem aviso no momento da aprovação**, só a pendência no painel.

**Provas:** banco 18/18, ensaio da 0167 11/11, política 9/9, ações 5/5, painel 5/5. O que cada prova cobre está no dossiê.

## As alternativas

Elas **não se excluem**: a recomendação combina as três.

| | A — Registrar e manter pendente, sem faturar | B — Regularização posterior com autorização válida, auditada | C — Conferência administrativa antes de qualquer transmissão |
| --- | --- | --- | --- |
| **O que acontece** | o item fica registrado e sinalizado e nunca entra na guia | o item entra na guia quando a regularização é válida: autorização concedida com saldo, quando o contrato exige; sem exigência no contrato, pela regra que você escolher (ver texto 2) | a guia com item pendente não é aprovada sem que alguém do faturamento decida o item: incluir (se regularizado) ou aprovar sem ele, com motivo |
| **Operação** | nenhum trabalho a mais; o item vira só histórico | a recepção ou o faturamento liga a autorização ao item | uma decisão por guia com item pendente, na conferência |
| **Financeiro** | o procedimento feito não é cobrado (receita perdida, sem risco de glosa por falta de autorização) | cobra o que foi feito e autorizado; nunca acima do saldo autorizado | nada sai para a operadora sem decisão humana; a cobrança do item agendado pode atrasar até a decisão |
| **Guia** | só o agendado | ganha o item regularizado antes da aprovação; depois de aprovada, só por substituição (P7.5) | a aprovação passa a ter uma etapa a mais quando há item pendente |
| **Tela** | o painel mostra "não será faturado" | o painel mostra "aguardando autorização" ou "pronto para entrar na guia", e a ação de ligar a autorização | na conferência, aviso que bloqueia "Aprovar e emitir" com duas saídas: incluir ou aprovar sem o item |
| **Auditoria** | registro e cancelamento (já existe) | inclusão na guia: quem, quando, qual autorização e quanto do saldo | decisão de aprovar sem o item: quem, quando e motivo obrigatório |

## Recomendação técnica

É a sua preferência de segurança, escrita como regra:

1. **Registrar sempre (A).** O item executado fica no registro, com autor, data e código do contrato. Isso já existe.
2. **Nunca faturar automaticamente.** Nenhum item entra na guia sozinho, nem quando o contrato dispensa autorização.
3. **Regularização válida antes do envio (B):**
   - contrato que **exige** autorização: o item só entra na guia com autorização **concedida** e **saldo suficiente**, ligada ao item. A emissão consome esse saldo;
   - contrato que **não exige**: o item só entra na guia com a **confirmação** de quem tem o faturamento ("incluir na guia"), registrada.
4. **Conferência antes da transmissão (C).** Guia com item pendente não é aprovada em silêncio:
   - ou o item é regularizado e incluído;
   - ou o faturamento aprova **sem** o item, com motivo obrigatório. O item fica como "não faturado por decisão", nunca apagado.
5. **Depois de aprovada,** a guia só muda pela substituição da P7.5, que exige o recibo de cancelamento da operadora.

**Consequências da recomendação:**
- **Operação:** uma decisão a mais por guia com item pendente, só nesses casos.
- **Financeiro:** cobra o que foi feito e regularizado, sem passar do autorizado. O risco que sobra é a operadora recusar o item por regra própria (glosa), tratado pelo fluxo de glosa que já existe.
- **Guia e tela:** uma ação "incluir na guia", uma ação "aprovar sem o item" e o aviso na conferência.

## O que muda no código depois da decisão

Hoje a troca de política é uma linha (`ACTIVE_EXTRA_ITEM_POLICY`). Com a recomendação, o trabalho é maior:
- política nova que exige regularização: autorização com saldo **ou** confirmação, e trava a aprovação;
- ação "incluir na guia", que liga a autorização quando preciso e é auditada;
- ação "aprovar sem o item", com motivo obrigatório e auditada;
- a montagem da guia passa a levar os itens incluídos, com o valor do contrato vigente na data da sessão e o consumo do saldo na emissão;
- o aviso e os botões na conferência.

**Fica para a decisão:** a 0167 precisa entrar no DEV (pedido de GO em `go-0167-dev.md`). Para gravar a inclusão e a decisão de "aprovar sem o item", pode ser preciso um estado novo do item. Se for preciso, isso entra **antes** da 0167 ir para o DEV, para não exigir uma migration extra depois.

## Casos de teste que vão provar a decisão

1. Item sem solicitação: registrado, pendente, fora da guia.
2. Contrato com autorização exigida e sem autorização: "incluir na guia" é recusado com o motivo; nada é faturado.
3. Autorização concedida com saldo: incluído; a emissão consome o saldo exato; o XML leva o item com o valor do contrato.
4. Saldo menor que a quantidade: recusado; nunca fatura acima do autorizado.
5. Contrato sem exigência: só entra com a confirmação; sem ela, fica pendente.
6. Guia com item pendente: "Aprovar e emitir" bloqueado; com "aprovar sem o item" e motivo, aprova. O item fica "não faturado por decisão", visível e auditado.
7. "Aprovar sem o item" sem motivo: recusado.
8. Guia aprovada: incluir ou excluir é recusado; o caminho é a substituição (P7.5).
9. Concorrência: duas inclusões do mesmo item dão uma só; inclusão × aprovação, nas duas ordens, sem item numa guia já fechada.
10. Reprocessamento e reentrega da conclusão: nada duplica.
11. Papéis: médico não inclui nem decide (só registra no consultório, se a UI do #56 oferecer); recepção registra; faturamento inclui e decide.
12. Outra clínica: não lê nem altera (RLS).
13. Recebível: o valor da guia é a soma do agendado e dos incluídos. A fórmula do livro (`valor − valorPago − valorGlosado`) não muda.
14. Auditoria: inclusão, decisão e motivo, sem dado clínico.

## Compatibilidade da regra recomendada (conferida em 24/11)

| Ponto | Como a regra recomendada se comporta | Onde já existe no código |
| --- | --- | --- |
| Contrato do convênio | o item só vale se for linha SP/SADT da operadora do atendimento, vigente na data da sessão; código, descrição e "exige autorização" vêm da linha | gatilho da 0167 e `recordExtraItemTx` (provas 2 e 4) |
| Regras de autorização | contrato que exige: só autorização **concedida**, com saldo, ligada ao item; a emissão consome o saldo exato e nunca passa do autorizado | política (c) testada (prova 9; `extra-item-policy.test.ts`) |
| Guia | só o agendado até a regularização; depois de conferida, nada entra nem sai (prova 10); a mudança passa pela substituição P7.5 | 0165 e 0167 |
| Exigências de faturamento | XML e recebível só com o que foi incluído; hoje provado que o adicional não vai ao XML nem ao recebível (prova 18) | `exportBatch`, livro |
| Responsável pela regularização | **faturamento** (`bill:faturamento_convenio`) inclui ou aprova sem o item; a recepção registra e liga a autorização, mas não inclui | regra de direitos a criar com a política (hoje registrar = operar ou faturar) |
| Auditoria | registro e cancelamento já auditados; inclusão e "aprovar sem o item" ganham evento próprio com quem, quando, qual autorização e o motivo | `extra-item-actions.test.ts` |
| Consequência para a operadora | ela recebe só o regularizado: sem item sem autorização (evita glosa por falta de senha); o que não foi incluído não é cobrado depois, a não ser por substituição | — |
| Estados da tela | "registrado — aguardando autorização", "registrado — pronto para entrar na guia", "incluído na guia", "não faturado por decisão (motivo)", "cancelado (motivo)"; a tela **nunca** mostra como faturado o que está pendente | painel da conferência (`extra-items-ui.tsx`), a ampliar |
| Negativa da operadora | autorização negada: o item fica "não faturável — autorização negada", visível e auditado; a guia é aprovada sem ele, com o motivo; nada é refeito sozinho | estados da autorização (P6.1) |

## Sua resposta: APROVAR, AJUSTAR ou REJEITAR

**APROVAR** (a regra recomendada, inteira):

> "Aprovo a regra recomendada da P8.4-r: registrar sempre; nunca faturar automaticamente; o item só entra na guia com autorização concedida e saldo quando o contrato exige, ou com a confirmação do faturamento quando o contrato não exige; guia com item pendente só é aprovada depois de incluir o item ou de aprovar sem ele com motivo obrigatório."

**AJUSTAR** (escolha uma variação, ou escreva a sua):
- **(a)** "Aprovo a regra recomendada, mas com contrato sem exigência de autorização o item entra na guia sem confirmação." É fatura automática **só** do item que o contrato dispensa de autorização.
- **(b)** "Aprovo A + C, sem B": registrar; a conferência decide e registra, mas o item nunca entra na guia.
- **(c)** Outra regra, escrita por você. Ela volta como ficha nova antes de qualquer código.

**REJEITAR** (nenhuma das propostas):

> "Rejeito a P8.4-r proposta: o item executado sem solicitação é só registro e nunca é faturado."

Isso é a alternativa A sozinha; o comportamento atual continua como regra definitiva.

**Sem resposta:** fica o comportamento atual (registra, sinaliza e não fatura). A P8.4 continua PARTIAL.

**Antes de responder, confirme também duas coisas:**
- **Operadora que não aceita.** Existe alguma operadora que você já sabe que **não aceita** item executado sem solicitação prévia, nem regularizado depois? Se existir, a regra dela vale por operadora: o item fica pendente e nunca entra na guia dessa operadora.
- **Quem registra no consultório.** O plano diz "registro opcional no consultório; o médico não é obrigado; a recepção completa". A matriz I.2 (aprovada em 16/11) dá ao médico **só leitura** em Convênios, e hoje registrar exige operar ou faturar.
  - Para o médico registrar no consultório, é preciso uma exceção restrita: só o item da **própria** sessão, só pelo consultório, só código e quantidade do contrato, sem valor e sem incluir na guia.
  - Sem a exceção, quem registra é a recepção, na conferência ou no consultório.
  - Responda **"exceção do médico: sim"** ou **"exceção do médico: não"**.

## O que esta ficha não decide

- Regras próprias de cada operadora (prazos de regularização, aceite de guia complementar). Elas dependem do contrato e da homologação real (B5), que não existem ainda.
- Valores: vêm sempre da linha do contrato vigente na data da sessão. Nada é digitado.
- Produção: o TISS continua NO-GO.
