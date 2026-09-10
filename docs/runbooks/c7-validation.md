# Validação C7 — clínico

## Status

Reference — checklist atual.

```bash
pnpm smoke:c7
```

Valide draft/rowVersion, assinatura, trigger de imutabilidade, correção legal, snapshot, permissions,
CRM quando exigido, PDF no bucket privado e cleanup. Para o acesso ao PDF, prove que o `iframe` usa
somente `/prescricoes/:id/pdf/arquivo` ou `/documentos/:id/pdf/arquivo`, que não há signed URL/token do
Storage no DOM/rede, que anônimo não baixa e que outro tenant recebe 404. Nunca use prontuário real
como fixture.
