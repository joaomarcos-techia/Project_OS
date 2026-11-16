# Substituição de guia já enviada (P7.5): estudo do contrato

**Situação (16/11/2026):** estudo. **Nenhum fluxo novo foi implementado.** O fundador proibiu inventar a substituição
sem contrato TISS ou regra de negócio comprovada. Este documento separa o que o padrão e o banco já dizem do que
depende de decisão ou da operadora.

## 1. O que o padrão TISS 4.03.00 diz (fonte: XSD oficial no repositório)

| Peça | Onde | Conteúdo |
| --- | --- | --- |
| Pedido de cancelamento | `cancelaGuia` (`ct_guiaCancelamento`), mensagem prestador → operadora; também `cancelaGuiaWS` no WSDL | dados do prestador e **um** destes: cancelar o lote (`numeroLote`, `numeroProtocolo` opcional) ou cancelar guias (cada uma com `tipoGuia`, `numeroGuiaPrestador`, `numeroGuiaOperadora` e `numeroProtocolo` opcionais) |
| Recibo da operadora | `reciboCancelaGuia` (`ct_guiaCancelamentoRecibo`); `reciboCancelaGuiaWS` | por lote ou por guia, com `statusCancelamento`; ou `mensagemErro` |
| Situação do cancelamento | `dm_statusCancelamento` = **Tabela 46 da TUSS** (versão 202609, carregada em `data/tiss/terminologia/202609/tab-46.json`) | 1 Cancelado com sucesso; 2 Não cancelado; 3 Guia inexistente; 4 Em processamento; 5 Lote inexistente; 6 Protocolo inexistente |

O padrão **não** tem um campo "esta guia substitui aquela". Para a operadora, substituir é **cancelar a original** (pelo
pedido acima, pelo portal ou pelo canal combinado) e **enviar uma guia nova**, com o próprio número do prestador.

## 2. O que o banco já garante (0147 e 0153, aplicadas no DEV)

- `hi_guides.replaces_guide_id`: a substituta aponta a original (mesma clínica, mesma operadora, mesmo tipo e mesmo
  paciente, por FK composta e gatilho);
- só se substitui guia **exportada, enviada ou em análise**. Antes disso, reabre-se; depois do resultado, usa-se o
  recurso de glosa (mensagem do gatilho `hi_guide_refs`);
- uma substituição em andamento ou concluída por guia (`hi_guides_replaces_uniq`);
- a substituta em rascunho não "segura" o atendimento (`live`). Quando ela é **aprovada**, a original passa a
  `replaced` na mesma transação (`hi_guide_apply_replacement`), com a original travada;
- o número do prestador nunca se repete, nem na substituição;
- o recebível da original é cancelado só se a conta dela não tem pagamento nem glosa ("Guia substituída com valores
  na conta: concilie antes", 0153);
- não há action nem tela para substituir.

## 3. A lacuna, objetivamente

O banco marca a original como `replaced` quando a substituta é **aprovada**, sem nenhum registro de que **a operadora
cancelou a original**. Se a operadora não cancelou (situação 2) ou ainda está processando (situação 4), as duas guias
existem para ela: risco de cobrança dupla ou de glosa da substituta por duplicidade. É por isso que o fluxo não foi
ligado.

## 4. Desenho que o contrato sustenta (para decisão; não implementado)

| Passo | Estado da original | Efeito | Regra |
| --- | --- | --- | --- |
| 1. Pedir o cancelamento à operadora | `exported`, `sent` ou `under_review` (não muda) | registro do pedido (canal, data, autor), sem mexer na guia | só nos três estados acima |
| 2. Registrar o recibo da operadora | não muda | guarda `statusCancelamento` (Tabela 46), protocolo e comprovante, como a evidência da autorização | recibo é fato da operadora; sem recibo, não há cancelamento |
| 3a. Situação 1 (cancelado com sucesso) | continua até a substituta ser aprovada | libera criar e aprovar a substituta; ao aprovar, a original vira `replaced` (0147) e o recebível dela é cancelado se não houver valores (0153) | a aprovação da substituta passa a exigir o recibo 1 |
| 3b. Situação 4 (em processamento) | não muda | espera; a substituta não é aprovada | nova consulta de situação depois |
| 3c. Situação 2 (não cancelado) | não muda | sem substituição; depois do resultado, recurso de glosa | mensagem clara na tela |
| 3d. Situações 3, 5 ou 6 (inexistente) | não muda | divergência de dados entre clínica e operadora: investigar antes de qualquer reenvio | nunca substituir às cegas |
| 4. Enviar a substituta | `replaced` | a substituta entra num lote **novo**; o lote da original fica como estava (histórico) | o lote não aceita a mesma guia duas vezes (já existe) |

**Efeitos fora da guia:**
- **Repasse:** se a substituta cobre o mesmo atendimento, o repasse continua sobre ela. Se não houver guia viva para o
  atendimento, vale o contrato da revisão humana (`cancelamento-repasse-contrato.md`).
- **Recebível e conciliação:** pagamento ou glosa já registrados na original impedem a substituição (regra da 0153).
- **XML:** o pedido `cancelaGuia` pode ser gerado e validado no XSD como os outros XML (peça técnica possível depois
  da decisão); o envio eletrônico é a P6.5 (`cancelaGuiaWS`), sem operadora homologada.

## 5. Dependências

1. **Decisão do fundador:** exigir o recibo de cancelamento da operadora (situação 1) antes de aprovar a substituta.
   Recomendação: **sim**.
2. **Operadora piloto (B5):** se aceita cancelar guia em análise, prazos, canal (portal ou serviço) e se exige o mesmo
   número ou número novo na substituta. O banco hoje exige número novo.
3. **Migration nova** para guardar o pedido e o recibo do cancelamento (número na autorização, depois da 0162).
4. **P6.4/P6.5:** o adaptador manual registra o recibo do portal; o eletrônico depende de homologação.

## 6. Testes necessários (quando aprovado)

- original fora de `exported`/`sent`/`under_review`: pedido de cancelamento recusado;
- recibo situação 1 → substituta aprovada → original `replaced` na mesma transação; recebível cancelado sem valores;
- situações 2, 3, 4, 5 e 6 → aprovação da substituta recusada, cada uma com a mensagem certa;
- original com pagamento ou glosa → substituição recusada (0153);
- corrida: duas substituições da mesma original → uma só (índice único);
- XML do `cancelaGuia` válido no XSD oficial (camada 1) e reprovado com campo faltando;
- repasse: substituta viva no mesmo atendimento → sem revisão; sem guia viva → revisão humana;
- outra clínica e id adulterado → "não encontrada"; D24 e módulo desligado: pedir cancelamento é preservação (classe C),
  aprovar a substituta é classe A.

## 7. Situação da P7.5

Continua **em execução**. O que falta depende das decisões e da operadora acima. Nada foi simulado.
