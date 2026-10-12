# WABA de teste após cadastrar pagamento — leitura de 10/10/2026

Ambiente: WABA consentida da Clínica A, banco e Auth DEV. A página foi acessada
no Preview da PR #34 após prova assinada de que ambos apontavam para DEV. A
sonda SQL foi executada em transação `READ ONLY`. Não houve envio novo à Meta,
cobrança Asaas ou alteração de callback nesta rodada.

| Cenário | Evidência observada | Veredito e limite |
| --- | --- | --- |
| Saúde de envio após o usuário cadastrar pagamento | `GET health_status` da Graph API: `limited`, código 141010; o código 141006 de falta de pagamento sumiu | PASS para remoção do bloqueio de pagamento; entrega de template novo NOT TESTED |
| Tela administrativa no Preview integrado | Fingerprint assinado de Auth/banco DEV PASS; login da conta de teste PASS; `GET /configuracoes/whatsapp` HTTP 200, sem 5xx nem `pageerror`; não mostra ação de adicionar pagamento e mostra ação de verificar a empresa | PASS para leitura/feedback visual; a página atualizou o estado persistido de `blocked` para `limited` às 03:47:58 UTC |
| Mensagem real do número consentido | Ingresso às 03:34:33 UTC; `inbound_messages_raw` presente e `processed_at` preenchido; evento `messaging.inbound.received` `processed` em uma tentativa; uma mensagem `ai_messages` de entrada | PASS para webhook → persistência → consumo do evento no DEV; não prova esse trecho no Preview integrado |
| Resposta da IA à mensagem atual | Nenhuma mensagem de saída nem outbound para esse evento; a conversa estava em `handoff`, com motivo “Solicitação fora do atendimento operacional” | Comportamento intencional: o agente não responde por cima do humano; nova resposta após devolução ao agente NOT TESTED |
| Respostas anteriores, em 08/10 | Quatro turnos desse contato têm mensagem de saída, outbound `delivered` e callback Meta final `read` | PASS histórico para IA → Meta → aparelho; anterior à mudança de pagamento |
| Assinatura da WABA | `GET /{waba}/subscribed_apps`: uma inscrição; `override_callback_uri` aponta para o Preview `fix-post-merge-va-5fdd7c`, diferente do Preview integrado da PR #34 | Ingresso no Preview integrado NOT TESTED. Não mudamos o destino usado pelo outro agente |
| Lista de espera no DEV | `npx tsx --conditions=react-server scripts/probe-waitlist-offer-dev.ts`, exit 0: prazo, vaga passada e varredura, com `READ ONLY` | PASS para essas regras; oferta/aceite/envio E2E NOT TESTED |

A primeira consulta por `from_number_hash` retornou zero e **não era evidência de
ausência de ingresso**. O salt de lookup local não reproduz o hash armazenado pelo
Preview. A sonda corrigida comparou, somente em memória, o telefone
descriptografado das linhas recentes com as variantes do número consentido. Não
imprimiu número, conteúdo, chave, token ou hash completo. Runners locais que
gravam pacientes/mensagens no mesmo DEV não devem ser usados sem provar paridade
do salt; o problema de ambiente já está registrado no §58 de `qorov2.md`.

O usuário informou que concluiu manualmente `/cadastro`. Isso é aceitação humana
relatada, não uma nova execução automatizada. Os sete cenários E2E de cadastro
registrados no [relatório da integração](integracao-2026-10-09.md) são de 09/10.

Para fechar as lacunas: coordenar a troca do callback com o agente que usa a
WABA; devolver a conversa de teste ao agente e enviar outra mensagem real;
executar um template proativo via C14, com readback `delivered/read` depois da
mudança de Billing; e executar oferta e aceite da lista de espera no Preview.
A Meta ainda reporta limitação de volume pela verificação do negócio (141010).
