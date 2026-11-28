# Runbook — interrupção da troca TISS (requisito 72 da ANS)

**Requisito 72:** "A interrupção do serviço de troca eletrônica de informações entre prestadores e operadoras deve
ser solucionada em até 48 (quarenta e oito) horas corridas, salvo caso fortuito ou de força maior devidamente
justificado." **RN 501, art. 18:** na interrupção, usar o Plano de Contingência do Padrão TISS, sem descontinuar o
atendimento.

**Isto é procedimento interno, não SLA contratual.** Prometer 48 h a clínicas depende de capacidade operacional e
de aprovação comercial (fundador). Até lá, a meta interna é resolver em 48 h e registrar.

## 1. O que conta como interrupção

- o Qoro não consegue gerar, validar ou exportar guia/lote (erro do app, XSD indisponível — `/api/health/tiss-xsd`);
- o envio pelo conector falha para uma operadora por mais de 1 h (`insurance.batch.send_failed`, circuito aberto);
- o portal/webservice da operadora está fora (a interrupção é dela, mas a clínica precisa do plano de contingência).

## 2. Registro (em até 1 h da detecção)

Abrir o registro do incidente com: início (data/hora), quem detectou, clínicas e operadoras afetadas, sintoma,
evidência (métrica, log, print), causa provável, e o relógio das 48 h.

## 3. Escalonamento

| Tempo desde o início | Ação | Responsável |
| --- | --- | --- |
| 0–1 h | diagnóstico; avisar as clínicas afetadas pelo canal de suporte; orientar o Plano de Contingência (guia em papel/PDF da ANS) | suporte de plantão |
| 1–8 h | correção ou contorno; se for da operadora, contatar o Coordenador TISS dela (Portal TISS) | engenharia |
| 8–24 h | atualização às clínicas a cada 4 h | suporte |
| 24–48 h | escalar ao fundador; decidir se é caso fortuito/força maior (documentar a justificativa) | fundador |

## 4. Recuperação

1. Corrigir a causa (deploy pelo procedimento normal; nunca alteração direta em produção).
2. Conferir: `/api/health/tiss-xsd` ok; um lote sintético exporta e valida.
3. Guias feitas em contingência: lançar no Qoro depois (a guia emitida fora não é duplicada; conferir número).
4. Reenvio: nunca automático; a pessoa confere o portal da operadora antes (o conector já exige isso).

## 5. Comunicação

Aviso inicial, atualizações e encerramento com a causa e o que muda. Sem dado de paciente nas mensagens.

## 6. Teste de resposta (sem incidente real)

A cada trimestre, simular no Preview: desligar o validador (variável de ambiente de teste), cronometrar
detecção → aviso → contorno, registrar o tempo e as falhas do roteiro. Primeiro ensaio: antes da P15.8.
