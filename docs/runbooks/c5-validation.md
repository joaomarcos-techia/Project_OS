# Validação C5 — paciente e LGPD

## Status

Reference — checklist atual.

```bash
pnpm smoke:c5
pnpm smoke:c5:idem
```

Valide em DEV: PII cifrada/lookup, RLS A/B, consentimento, export JSON/PDF privado, signed URL de 24 h, delete/soft-delete, retenção clínica e cleanup. Teste de URL expirada/cross-tenant deve usar objetos sintéticos e removê-los.

Não rode hard-delete nem migration sem autorização explícita.
