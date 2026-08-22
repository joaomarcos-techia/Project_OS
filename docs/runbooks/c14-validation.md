# Validação C14 — mensagens proativas

## Status

Reference — checklist atual.

## 1. Gate determinístico

```bash
pnpm smoke:c14
```

## 2. O que o smoke prova

O smoke DEV cobre consentimento/suppression, dedup, reminders, dunning, follow-up, waitlist, fila humana e isolamento. Ele percorre a pipeline até o ponto de envio, com Meta stubada.

## 3. Pré-condições operacionais

Confirme flag da plataforma, janela local, consentimento, suppression, número ativo e jobs elegíveis. A ausência de candidato não prova que o job está saudável.

## 4. Prova Meta real

Confirme template aprovado/idioma, subscription/webhook, número saudável e uma entrega controlada. `wa:send-template` envia mensagem real e exige autorização. Esse é o passo que o smoke não cobre.
