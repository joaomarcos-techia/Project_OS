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
