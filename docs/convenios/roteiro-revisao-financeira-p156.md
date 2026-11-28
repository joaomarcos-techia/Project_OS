# Roteiro da revisão financeira com o fundador (P15.6)

**O que é:** uma sessão reproduzível, numa clínica sintética do DEV, aberta no Preview, para você conferir o
ciclo financeiro do convênio com valores conhecidos. **Os testes automáticos não substituem esta revisão:** a
P15.6 só fecha com o seu aceite ou com os ajustes que você pedir.

## 1. Como a sessão é preparada (reproduzível)

1. **Clínica zerada:** fixture `setup-config`, clínica `e2e-hi-config`, contas sintéticas.
2. **Jornada real pela tela:** `e2e/convenios-config-preview.spec.ts`, no navegador remoto. Ela configura do
   zero, agenda, atende, emite a guia, monta o lote, envia, glosa, recorre, recebe, estorna, repassa e confirma
   a coparticipação. São os mesmos passos que a gestora faria.
3. **Conferência prévia, só leitura:** eu leio os valores no DEV e preencho a coluna "Lido antes da sessão".
   Se algo divergir do esperado, a sessão não começa: primeiro investigo.
4. **Sessão:** você entra no Preview com a conta sintética da gestora. A senha vai por canal separado, nunca pelo
   chat.

## 2. Valores de entrada da jornada

| Entrada | Valor |
| --- | --- |
| Procedimento contratado (Consulta) | R$ 150,00 |
| Coparticipação fixa | R$ 45,00 |
| Glosa parcial (código 1705, tabela 38) | R$ 30,00 |
| Recurso: valor aceito pela operadora | R$ 20,00 |
| Pagamento do demonstrativo | R$ 100,00 (alocado, estornado e alocado de novo) |
| Repasse da médica | 40% sobre o recebido |

## 3. Casos e resultados esperados

A fórmula do aberto é sempre `valor − valorPago − valorGlosado`.

| # | Caso | Onde conferir | Esperado | Lido antes da sessão | Seu aceite |
| --- | --- | --- | --- | --- | --- |
| F1 | faturado: guia emitida e enviada no lote | Convênios › Guias; Lotes | guia de R$ 150,00, lote enviado com protocolo | | |
| F2 | recebível da operadora nasce só no envio | Financeiro (origem "Operadoras de convênio") | um recebível de R$ 150,00, ligado à guia, selo "Operadora" | | |
| F3 | glosa parcial, recurso e glosa definitiva | guia › Glosas e Recursos | glosa de R$ 30,00; recurso aceito em R$ 20,00; glosa definitiva de R$ 10,00 | | |
| F4 | recebido, com estorno no meio | Convênios › Conciliação; guia › Pagamentos | demonstrativo de R$ 100,00; alocação, estorno e nova alocação; líquido R$ 100,00; o mesmo demonstrativo repetido é recusado | | |
| F5 | pendente da operadora | Financeiro, "A receber" por origem | R$ 150,00 − R$ 100,00 − R$ 10,00 = **R$ 40,00** em Operadoras | | |
| F6 | repasse | Convênios › Repasses | 40% de R$ 100,00 = R$ 40,00; autorizado e registrado | | |
| F7 | coparticipação | Convênios › Conciliação › Coparticipação | conferida e confirmada em R$ 45,00; a cobrança do paciente é de R$ 45,00, **nunca** R$ 150,00 | | |
| F8 | separação paciente × operadora (P10.6) | Financeiro, filtro "Origem" | a coparticipação em "Pacientes e outros"; o recebível da guia em "Operadoras de convênio"; as duas parcelas somam o "A receber" | | |
| F9 | o Caixa só com o que a recepção cobra | Caixa | aparece a coparticipação de R$ 45,00; o recebível da operadora **não** aparece | | |
| F10 | relatório por operadora | Convênios › Relatórios (e CSV) | faturado R$ 150,00, recebido R$ 100,00, glosado R$ 10,00, aberto R$ 40,00 | | |
| F11 | livro: dinheiro de verdade | Financeiro | entradas − estornos da guia = R$ 100,00; a glosa fica só em "glosado", nunca como saída de caixa | | |
| F12 | auditoria | histórico da guia e trilha | glosa, recurso, pagamento, estorno, repasse e coparticipação com autor e data | | |

**Antes da sessão eu confirmo três valores no DEV, por leitura:**

- o valor do recebível da guia em F2: o esperado é o valor contratado, R$ 150,00;
- a glosa definitiva em F3;
- a base do repasse em F6.

São os únicos derivados das regras, e não lidos diretamente da jornada.

## 4. O que já foi provado automaticamente (apoio, não substitui o aceite)

- ponte do livro: 19 cenários (pagamento integral e parcial, duplicado, glosa parcial e definitiva, recurso,
  estorno, lote com várias guias, concorrência, isolamento, assinatura suspensa e trial, Caixa só com dinheiro,
  separação por origem);
- relatório por operadora somado contra o livro (P9.10);
- jornada de configuração no Preview (21 etapas, já executada em ciclos anteriores);
- benchmark do outbox com integridade financeira em todas as rodadas.

## 5. Resultado da sessão

| Resultado | Efeito |
| --- | --- |
| Aceite | P15.6 concluída, com a data e a sua aprovação registradas no plano |
| Ajustes | cada ajuste vira tarefa; a P15.6 fica aberta até o novo aceite |

A P15.8 (liberação) só pode ser pedida depois da P15.6.

## 6. Pré-auditoria técnica automática (25/11/2026, noite)

O harness `scripts/security/health-insurance-financial-preaudit-db.ts` executa os 12 casos com os valores da seção 2,
pelo código real, em Postgres descartável (cadeia do DEV), com o gateway da coparticipação simulado. O dossiê (cenário,
valor inicial, operação, esperado, observado, diferença, evidência, SHA e resultado) sai no log e no resumo do job
"Convênios — provas sintéticas de banco (legado)".

**Resultado no `022063b0` (run 45705495819): 13/13 PASS** (F1–F12 e o isolamento de apoio), sem diferença em nenhum
valor:

| # | Observado (igual ao esperado) |
| --- | --- |
| F1 | guia de R$ 150,00; lote em análise com protocolo |
| F2 | nenhum recebível antes do envio; depois, 1 recebível de R$ 150,00, sem paciente, método convênio, pendente |
| F3 | glosa R$ 30,00; durante o recurso nada baixa; revertido R$ 20,00; definitiva R$ 10,00; glosado no livro R$ 10,00 |
| F4 | pago depois do estorno R$ 0,00; movimentos pagamento, estorno, pagamento; líquido R$ 100,00; demonstrativo repetido recusado (duplicate) |
| F5 | aberto R$ 40,00 no livro e na conta da guia; status parcial |
| F6 | elegível R$ 40,00; autorizado e repassado R$ 40,00; devido R$ 0,00; R$ 0,01 acima recusado |
| F7 | confirmada R$ 45,00; recebível do paciente R$ 45,00; cobrança e teto do gateway R$ 45,00 |
| F8 | operadora R$ 40,00 (1); paciente R$ 45,00 (1); soma R$ 85,00 = "A receber" R$ 85,00 |
| F9 | o Caixa mostra a coparticipação e não mostra o recebível da operadora |
| F10 | relatório: faturado R$ 150,00, recebido R$ 100,00, glosado R$ 10,00, aberto R$ 40,00; CSV sem nome de paciente |
| F11 | entradas R$ 200,00 − estornos R$ 100,00 = R$ 100,00; glosa nunca como saída; divergência da ponte vazia |
| F12 | glosa, recurso, pagamento, estorno, repasse e coparticipação com autor e data |

**Isto é a pré-auditoria, não o aceite.** A P15.6 fecha só com a sua aprovação. A sessão pode ser curta: ler esta
tabela e, se quiser ver com os próprios olhos, abrir no Preview os casos que escolher pela jornada da seção 1.

## 7. Ficha de aceite (27/11/2026) — o que falta é só a sua decisão

**Validade da evidência:** entre o `022063b0` (pré-auditoria 13/13) e o HEAD do #55, nenhum arquivo de faturamento,
glosa, pagamento, repasse, coparticipação, livro ou Caixa mudou (`git diff --stat 022063b0 HEAD` nesses caminhos: só
`historical-coverage.ts` da P4.7, `platform.ts` da P1.13, `security-footprint.ts` do S1 e exportações). O mesmo
harness continua no job "provas sintéticas de banco (legado)", verde no `3d210289` (run 45946347984).

| Item | Esperado | Observado | Diferença |
| --- | --- | --- | --- |
| F1–F12 (tabela da seção 6) | valores da seção 3 | idênticos | **R$ 0,00 em todos** |
| A receber (F8) | R$ 40,00 operadora + R$ 45,00 paciente | R$ 85,00 | R$ 0,00 |
| Caixa (F9) | só a coparticipação | só a coparticipação | — |
| Livro (F11) | R$ 100,00 líquido; glosa fora do caixa | R$ 100,00; glosa só em "glosado" | R$ 0,00 |

**Decisão (sua):** ( ) aprovado — a P15.6 vira PASS com esta data · ( ) reprovado no caso F__, com o que esperava.
Ver no Preview é opcional (seção 1); não precisa repetir a bateria. **Até a sua marcação, P15.6 = PENDING.**

## 8. Reconciliação 12 × 13 e recomendação técnica (27/11/2026, noite)

- **12 conferências (F1–F12)** são os casos financeiros da seção 3; a pré-auditoria tem **13 verificações** porque
  soma uma de apoio, o **isolamento** (outra clínica não vê nem altera nada da jornada). As 13 passaram no
  `022063b0` (run 45705495819) e o mesmo harness passou de novo nos SHAs posteriores do #55, no job "provas
  sintéticas de banco (legado)": `3d210289`, `d3801b4f` e `15ab4a9a` (run 46006035434).
- **Valores:** os da seção 6, idênticos aos esperados da seção 3 (diferença R$ 0,00 em todos).
- **Escopo:** guia de Consulta, lote, glosa parcial com recurso, demonstrativo com estorno, repasse,
  coparticipação, separação paciente × operadora, Caixa, relatório por operadora, livro e auditoria.
- **Alterações posteriores:** nenhuma nos caminhos do dinheiro desde o `022063b0` (seção 7).
- **Ressalvas materiais:** nenhuma encontrada. Limite conhecido: o gateway da coparticipação é simulado no harness
  (a cobrança real com o Asaas foi homologada à parte no Sandbox, P10.5).

**Recomendação técnica: APROVAR.** Isto não é o aceite: a P15.6 só fecha com a marcação do fundador na seção 7.

## 9. Resumo executivo para o aceite (28/11/2026)

12 conferências financeiras e 1 de isolamento, todas iguais ao esperado (diferença **R$ 0,00**); nenhum código do
caminho do dinheiro mudou desde a pré-auditoria; sem ressalva material. **Recomendação técnica: aprovar.**
**Campo de aceite: seção 7** — marcar "aprovado" ou "reprovado no caso F__". Até essa marcação, P15.6 = PENDING.
