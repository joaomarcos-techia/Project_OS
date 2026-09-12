# ADR-021 — Anonimização LGPD quando o hard-delete é bloqueado por retenção clínica

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: remediação forense pós-C10 (F-02 da auditoria 2026-06-10)
- Refs: ADR-017 (retenção CFM vs hard-delete LGPD), ADR-012 (encryption), ADR-013, C5 §5.6.5

## Context

ADR-017 decidiu que `prontuarios`, `prescriptions` e `medical_documents` têm
`patient_id ON DELETE RESTRICT` (guarda CFM ~20 anos) e declarou a anonimização
do cadastro como "trabalho de uma camada futura", com o fluxo-alvo já desenhado:
**anonimiza cadastro → mantém prontuário anonimizado → hard-delete do restante**.

A auditoria forense de 2026-06-10 (F-02, severidade ALTA) demonstrou que, na
prática, essa dívida virou descumprimento material do prazo LGPD:

1. Qualquer paciente expirado (30d) com ≥1 registro clínico violava o RESTRICT.
2. O DELETE era em **lote único por clínica** (uma transação): um paciente
   bloqueado fazia rollback do lote inteiro.
3. O loop por clínica não tinha try/catch: a primeira clínica que falhasse
   abortava o restante do run; o cron re-tentava os mesmos ids para sempre.

Este ADR implementa a camada prevista em ADR-017 item 3.

## Decision

1. **Processamento por paciente** (savepoint aninhado dentro do `withTenant` da
   clínica) em [src/contexts/patient/internal/hard-delete.ts](../../src/contexts/patient/internal/hard-delete.ts).
   Cada paciente termina em exatamente um de três estados: `deleted`,
   `anonymized` ou `failed`. Falha de um paciente/clínica nunca aborta o lote.
2. **Anonimização in-place** quando o DELETE viola FK `23503` (RESTRICT clínico):
   - `nome` → `'Paciente anonimizado (LGPD)'`
   - `cpf_encrypted` → ciphertext **válido** de string vazia (decriptável — o
     ponto único de decrypt não quebra)
   - `cpf_hash` → `anon:<patient_id>` (único; nunca colide com HMAC hex real,
     então não conflita com `UNIQUE(clinic_id, cpf_hash)` nem com lookups)
   - `email` → `anon+<patient_id>@lgpd.invalid` (único por paciente)
   - `telefone_encrypted`/`telefone_hash`/`data_nascimento`/`sexo`/`obito_em` → NULL
   - filhos cadastrais (`patient_consents`, `patient_clinical_data`,
     `patient_addresses`, `patient_emergency_contacts`) → DELETE explícito
     (o CASCADE os removeria no delete normal; aqui o pai permanece)
   - `anonymized_at` → `now()`; `deleted_at` preservado/garantido
3. **Coluna nova `patients.anonymized_at`** (migration `0023`, aditiva,
   nullable, sem backfill). O scan do cron exclui `anonymized_at IS NOT NULL` —
   sem isso o job re-tentaria os mesmos ids diariamente para sempre.
4. **Registro clínico permanece intacto** — `prontuarios`/`prescriptions`/
   `medical_documents` não são tocados; os snapshots imutáveis
   (`snapshot_patient_nome` etc.) preservam o documento legal (ADR-017 §4).
5. **`lgpd_requests` ganha visibilidade**: `type='delete'` pendente vira
   `completed` (+`fulfilled_at`) tanto no delete físico quanto na anonimização
   (a obrigação LGPD é cumprida pela eliminação OU pela anonimização sob a
   exceção do Art. 16, I — obrigação legal CFM); erro inesperado vira `failed`.
6. **`suppression_list` segue intocada** (sem FK, sobrevive — contato do
   paciente eliminado/anonimizado permanece inmensajeável).
7. **Audit trail**: o strip de PII em `audit_events` + scrub de respostas de
   `idempotency_keys` (via dbAdmin, append-only RLS) foi unificado em
   `anonymizePatientAuditTrail` — fonte única usada pela rota cron e pelo
   script dev (fecha F-11: o script removia menos chaves PII que a rota).
8. **Métricas**: `patient.hard_delete.run` agora reporta
   `{deleted, anonymized, failed, clinics}`;
   `patient.hard_delete.blocked_by_clinical` sinaliza o caminho RESTRICT.

## Consequences

- (+) O prazo de eliminação LGPD é cumprível para pacientes COM histórico
  clínico (maioria em uso real) — PII cadastral eliminada, registro legal
  preservado. F-02 (ALTA) eliminado.
- (+) Fila de hard-delete não entope mais; um paciente problemático não trava
  a clínica nem o run.
- (+) Backward compatible: coluna aditiva nullable; nenhuma policy RLS, GRANT,
  evento ou payload alterado; rota mantém o mesmo contrato de auth.
- (−) A linha anonimizada permanece em `patients` (necessário para o FK
  RESTRICT) — listagens já a excluem (`deleted_at IS NOT NULL`).
- (−) `cpf_hash`/`email` anonimizados liberam os UNIQUEs — um novo cadastro com
  o mesmo CPF é permitido (semântica correta de eliminação).
- (−) Reversão: a anonimização é IRREVERSÍVEL por design (é o ponto). O deploy
  é reversível (coluna fica dormente se o código voltar).

## Alternatives rejected

- **Marcar via `cpf_hash LIKE 'anon:%'` sem coluna nova**: economizava a
  migration mas sobrecarregava a semântica de uma coluna de lookup — frágil
  para queries futuras e invisível em inspeção de schema.
- **`lgpd_requests.status='failed'` sem anonimizar** (mínimo absoluto): dava
  visibilidade mas mantinha o descumprimento do prazo LGPD — a auditoria
  classificou como violação material, não aceitável em produção.
- **Apagar o registro clínico junto (CASCADE)**: rejeitado em ADR-017 (CFM).

## References

- [AUDITORIA_C0_C10_COMPLETA.md](../AUDITORIA_C0_C10_COMPLETA.md) §6 F-02
- [ADR-017](017-clinical-record-retention-vs-lgpd.md) — decisão-mãe
- Migration [0023_wooden_risque.sql](../../drizzle/migrations/0023_wooden_risque.sql)
