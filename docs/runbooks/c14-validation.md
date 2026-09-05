# Validação C14 — mensagens proativas

## Status

Reference — checklist atual.

## 1. Gate determinístico

```bash
pnpm smoke:c14
```

## 2. O que o smoke prova

O `smoke:c14` DEV cobre nove cenários: consentimento/suppression, dedup, reminders, dunning, follow-up,
waitlist, fila humana, isolamento e encerramento de evento cujo tenant foi removido; ele **não cria cobrança de paciente**. O routing de pagamentos é coberto
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

**Evidência vigente (31/08–02/09/2026):** o runner controlado criou as cobranças de sinal/restante,
publicou `link_ready`, drenou C14, obteve dois `providerMessageId` distintos, confirmou replay zero e
fez cleanup. O operador confirmou a chegada das duas mensagens com links no aparelho. Repetir somente
se o contrato, template ou pipeline mudar; nunca usar o smoke stubado como substituto dessa evidência.
