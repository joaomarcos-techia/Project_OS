# Validação C14 — mensagens proativas

## Status

Reference — checklist atual.

## 1. Gate determinístico

```bash
pnpm smoke:c14
```

## 2. O que o smoke prova

O `smoke:c14` DEV cobre dez cenários: consentimento/suppression, dedup, reminders, dunning, follow-up,
recuperação após falta, waitlist, fila humana, isolamento e encerramento de evento cujo tenant foi removido; ele **não cria cobrança de paciente**. O routing de pagamentos é coberto
separadamente pela integração controlada de `remainder-link.integration.test.ts` e pelos testes do
worker: `deposit_link`/`remainder_link`, lookup no send-time e cancelamento de cobrança não pagável.
Essas evidências percorrem a pipeline até o ponto de envio com Meta stubada; não são E2E real.

## 3. Pré-condições operacionais

Confirme flag da plataforma, janela local, consentimento, suppression, número ativo e jobs elegíveis. A ausência de candidato não prova que o job está saudável.

## 4. Prova Meta real

Confirme template aprovado/idioma, subscription/webhook, número saudável, destinatário com
consentimento e uma entrega controlada. Exercite separadamente `deposit_link` e `remainder_link`,
registre message id + job terminal e prove ausência de duplicata sem expor telefone/link.
`wa:send-template` envia mensagem real e exige autorização; ele prova o provider/template, mas o E2E
da Camada 1 deve nascer de `link_ready` e atravessar o worker. Esse é o passo que o smoke não cobre.

Para 2.4B, crie no mesmo WABA conectado um template de categoria **Utility**, idioma `pt_BR`, nome
`qoro_no_show_followup`, sem cabeçalho, rodapé ou botões, e corpo:

```text
Atualização do seu agendamento: {{1}}, sua consulta consta como não realizada.

Para reagendar, responda a esta mensagem.
```

Os corpos canônicos vivem em `src/lib/messaging/proactive-template-catalog.ts` e são a fonte da
verdade para o provisionamento automático no connect. Ao editar um template na Meta, edite o catálogo
junto — senão uma clínica nova recebe a versão antiga.

Use `Maria` como exemplo de `{{1}}`. Depois de `APPROVED`, configure o nome — não o ID numérico — em
`META_TEMPLATE_NO_SHOW_FOLLOWUP_ID` no ambiente alvo e faça um novo deploy. A prova isolada autorizada
é `pnpm wa:send-template --clinic <uuid> --to <e164> --type no_show_followup`; o E2E real exige que o
job nasça de uma falta sintética/controlada e atravesse outbox, C14 e Messaging. Não execute nenhum
dos dois contra a Meta sem autorização explícita e destinatário consentido.

**Evidência 2.4B (11/09/2026) — `PASS` até o aparelho.** Template `APPROVED` em `pt_BR`, confirmado
por consulta read-only a `{waba}/message_templates` antes de qualquer envio. Dois níveis: a prova
isolada (`wa:send-template --type no_show_followup`) e o E2E real
`pnpm exec tsx --conditions=react-server scripts/no-show-meta-e2e.ts`, em que o job nasce de uma falta
controlada e atravessa outbox → C14 → Messaging. Resultado: job na segunda 14/09 10h locais (execução
numa sexta — a regra de dia útil pulou o fim de semana no caminho real), `sent=1`, `providerMessageId`
distinto, replay `sent=0` e readback zero. O operador confirmou as duas mensagens no aparelho. Detalhe
em [qorov2 §26.5](../qorov2.md).

> **Atenção:** o template está categorizado como **MARKETING**, não `Utility`. Marketing exige opt-in
> de marketing e está sujeito a limite por usuário — pode não ser entregue a outros destinatários.
> `retorno_consulta` e `lembrete_confirmacao` estão iguais, o que sugere recategorização automática da
> Meta. Solicitar a mudança para `Utility` e **repetir esta prova** se a categoria mudar.

**Evidência vigente (31/08–02/09/2026):** o runner controlado criou as cobranças de sinal/restante,
publicou `link_ready`, drenou C14, obteve dois `providerMessageId` distintos, confirmou replay zero e
fez cleanup. O operador confirmou a chegada das duas mensagens com links no aparelho. Repetir somente
se o contrato, template ou pipeline mudar; nunca usar o smoke stubado como substituto dessa evidência.
