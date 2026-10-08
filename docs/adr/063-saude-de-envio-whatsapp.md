# ADR-063 — Saúde de envio da conta WhatsApp e a C14 com a conta bloqueada

## Status

Accepted — implementado em código e no DEV em 08/10/2026 (branch
`fix/waba-health-status-20261008`, PR draft para `fix/post-merge-validation-20261001`). A
migration 0116 foi aplicada **só no DEV**. Produção não foi tocada.

## Contexto

Em 08/10/2026, no DEV, a WABA de teste "Qoro" (clinica-a) não tinha moeda nem forma de pagamento.
Dois links de sinal da C14 (template `link_deposito`, 11:01 e 11:48 UTC) foram **aceitos** pela Cloud
API e **recusados** pela Meta 10–11 s depois, no callback, com 131042. As respostas dentro da janela
de 24 h continuavam chegando, então a clínica via a IA funcionando enquanto lembretes, links de sinal,
cobranças e ofertas de vaga não chegavam a nenhum paciente.

O motivo só aparecia no Graph. Leitura read-only do `health_status` com o token da própria clínica:

| Entidade | `can_send_message` | Erros | Observação |
| --- | --- | --- | --- |
| WABA | BLOCKED | 141006 | forma de pagamento |
| BUSINESS | LIMITED | 141010 | negócio não verificado |
| PHONE_NUMBER | LIMITED | 138024 (SIP) | nome de exibição pendente, só em `additional_info` |
| APP | AVAILABLE | 138025 (SIP) | — |

O EC-32 (`84b3b413`) já marca cada recusa no job da C14 **depois** que ela acontece. Faltava avisar
**antes**.

## Decisão

1. **Leitura.** `GET /{phone-number-id}?fields=health_status` com o token da clínica
   (`decryptForTenant`), pelo `graphFetch` do contexto `messaging`. A resposta do nó do número já traz
   PHONE_NUMBER, WABA, BUSINESS e APP: uma chamada cobre a WABA e o número. `currency` e
   `primary_funding_id` ficam de fora — pedidos juntos devolvem o erro 10 (exigem BSP).
2. **Veredito** (`internal/messaging-health.ts`, puro):
   - entidade a entidade. O agregado do topo não serve: no exemplo oficial da Meta, um problema só de
     SIP põe o topo em BLOCKED com todas as entidades em AVAILABLE;
   - a família 138xxx é de chamadas e nunca vira aviso de mensagem (138000–138023 na página de
     Calling, 138024/138025 na de Health Status);
   - LIMITED só conta quando um código de mensagem o explica; BLOCKED conta sempre;
   - código desconhecido fora de 138xxx conta (falha para o lado do aviso).
3. **Persistência** (migration 0116): `clinic_whatsapp_numbers.messaging_health`
   (`available`/`limited`/`blocked`), `messaging_health_codes` e `messaging_health_checked_at`, com
   CHECK amarrando estado e data. Escrita só pelo seam privilegiado; `authenticated` tem SELECT nas
   três colunas e mais nada. Leitura que falha não apaga a anterior. Auditoria
   `messaging.whatsapp.messaging_health_changed` só na mudança de estado ou de códigos.
4. **Gatilhos:** conclusão do Embedded Signup (no `after()` do connect), abertura da tela de WhatsApp
   (ao vivo, como o META-001), cron diário `/api/cron/whatsapp-messaging-health` às 10:30 UTC (relê
   quem não foi lido em 20 h, antes da janela da C14) e callback `failed` com 131042 ou 141006 (no
   `after()` do webhook, no máximo uma leitura a cada 10 min por conexão).
5. **Superfícies:** alerta no card da conexão em `/configuracoes/whatsapp` (o selo deixa de dizer
   "Ativo" com os envios bloqueados) e uma faixa no painel para quem tem `manage:settings`. Ação para
   141006/131042: "Adicione uma forma de pagamento à sua conta do WhatsApp Business na Meta." A faixa
   do painel é a **única** superfície de mensagens automáticas que não chegam: ela tem o espaço
   `refusals` para as recusas por mensagem, que a sessão "Mostrar à clínica a recusa de mensagem
   proativa" preenche.
6. **A C14 continua enviando com a conta BLOCKED.** Nenhuma mudança de semântica em
   `proactive-jobs/application/process.ts`.

## C14: segurar o job ou deixar falhar

| | A. Enviar e deixar falhar (adotada) | B. Segurar em `pending` enquanto BLOCKED |
| --- | --- | --- |
| Paciente | não recebe; nada reenvia sozinho | recebe quando a clínica resolver, se ainda fizer sentido |
| Clínica | avisada antes (tela + painel) e depois (EC-32: `meta_131042`) | avisada antes; precisa ver o que está retido |
| Custo na Meta | nenhum: mensagem que falha não é cobrada | nenhum |
| Mudança na fila | nenhuma | data-limite por tipo, contagem de tentativas, releitura ao vivo, tela de retidos |

Evidência que decidiu:

- **A fila não tem validade.** `claimDue` não tem corte por idade e os guards de send-time não olham
  o relógio: o lembrete só confere se a consulta ainda está `agendado|confirmado`. No DEV há um
  `remainder_link` em `pending` há 34 dias (o DEV não roda crons). Liberar uma fila retida depois do
  conserto mandaria lembrete D-1 depois da consulta.
- **O estado gravado envelhece.** Entre leituras diárias ele pode ter até 20–24 h. Segurar pelo valor
  gravado reteria mensagens depois de a clínica já ter cadastrado o pagamento. Segurar com segurança
  exige uma leitura ao vivo por clínica antes de cada lote, o que põe a Meta no caminho da C14 e cria
  a pergunta sem boa resposta "Graph fora do ar: segura ou envia?".
- **A recusa é rápida e já é visível.** 10–11 s entre o aceite e o 131042 no DEV. Com o EC-32 o job
  termina `failed` com o código, e esta ADR põe o aviso na tela antes da primeira recusa.
- **Segurar não salva a conversa em curso.** O link de sinal do DEV saiu no meio de uma conversa
  ativa e mesmo assim falhou: com a conta BLOCKED, template falha também dentro da janela de 24 h.
  Para esse caso o caminho útil é outro (ver Revisitar).

`claimDue` incrementa `attempts` antes do envio. Um "segurar" teria de devolver a tentativa ou ganhar
um estado próprio, e isso é mudança da C14 com testes próprios, fora desta entrega.

## Revisitar quando

- A retentativa real da C14 (sessão "C14: retentativa real para falhas da Meta") criar uma chave de
  envio por recusa definitiva. Aí "segurar" vira "reenviar quando a conta voltar a AVAILABLE" no
  caminho dela, lendo `messaging_health` por uma leitura em `messagingApiV1`.
- A fila ganhar validade por tipo (lembrete até a consulta, oferta de vaga até expirar etc.).
- Houver decisão de produto sobre mandar o link do sinal como texto livre quando a janela de 24 h
  está aberta e a conta está bloqueada.

## Consequências

- Mensagem iniciada pela clínica com a conta bloqueada se perde: não há reenvio automático.
- A clínica vê o bloqueio na tela de WhatsApp e no painel assim que ele é conhecido: na conexão, na
  primeira recusa por forma de pagamento ou, no máximo, na leitura diária.
- Um LIMITED só de `additional_info` (nome de exibição pendente) não gera aviso. É limite de volume
  que a própria Meta resolve.
- A coluna nova entra no INSERT do connect super_admin (Drizzle lista todas as colunas): a 0116 tem de
  ser aplicada antes do deploy, como a 0107.

## Evidência (08/10/2026)

- Parser: 30 testes com as respostas reais do DEV e os dois exemplos oficiais da Meta
  (`src/lib/test/meta-health-status-fixtures.ts`).
- Postgres real (`security:tenant`): o seam grava estado, códigos e data; audita só a mudança; não
  grava com o `clinicId` de outra clínica; `authenticated` lê as três colunas só da própria clínica,
  UPDATE nelas e leitura do token dão 42501; o CHECK recusa estado fora do vocabulário (23514).
- DEV ao vivo, conexão 4153b3ef, código real: `can_send_message=BLOCKED`, códigos `141006,141010`;
  138024/138025 descartados. Gravação: 1ª leitura mudou e auditou; 2ª não mudou e não auditou.
