# ADR-017 — Retenção de prontuário (CFM) vs hard-delete LGPD do paciente

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C7 (Clinical)
- Refs: ADR-013 (clinical-data ownership), PlanoAção §7.9/§7.10, C5 (patient hard-delete)

## Context

C5 implementa o hard-delete de paciente (LGPD Art. 18): após a janela de
soft-delete, um job apaga fisicamente o paciente e tudo que tem FK
`patient_id ON DELETE CASCADE` some junto (ADR-013).

C7 cria `prontuarios`, `prescriptions` e `medical_documents` com `patient_id`.
Esses são **registros médico-legais**: a Resolução CFM 1.821/2007 exige guarda
do prontuário por no mínimo 20 anos. A LGPD, por sua vez, tem exceção explícita
para cumprimento de obrigação legal/regulatória (Art. 7º, II; Art. 16, I) —
prontuário médico é o caso clássico de dado que **não** é apagado a pedido.

Há, portanto, um conflito direto: o cascade do hard-delete da C5 destruiria um
registro que a lei manda preservar.

## Decision

1. As FKs `patient_id` de `prontuarios`, `prescriptions` e `medical_documents`
   são **`ON DELETE RESTRICT`** (não CASCADE). O registro clínico é a fonte da
   verdade legal e **prevalece**: preservar, não apagar.
2. Consequência operacional **assumida**: o job de hard-delete da C5, ao tentar
   apagar um paciente que possui prontuário/prescrição/documento, **falha** (o
   RESTRICT aborta o DELETE). Em produção isso é o comportamento correto até
   existir anonimização.
3. A **anonimização** do paciente em registros clínicos retidos (remover PII
   cadastral do paciente mas manter o registro clínico para fins legais) é
   trabalho de uma **camada futura** — fora do escopo de C7. Quando existir, o
   fluxo LGPD passa a: anonimiza cadastro → mantém prontuário anonimizado →
   hard-delete do restante.
4. O nome do paciente exibido em documentos legais (prescrição/atestado/etc.) é
   **snapshot** na linha no momento da emissão (`snapshot_patient_nome`), não um
   JOIN com `patients` — o documento histórico permanece íntegro e legível mesmo
   que o cadastro mude ou seja anonimizado depois.

## Consequences

- (+) Nenhum registro médico-legal é destruído silenciosamente por um fluxo de
  exclusão cadastral — cumpre CFM e a exceção da LGPD.
- (+) Documentos emitidos permanecem reproduzíveis (snapshots de paciente + médico).
- (−) O hard-delete LGPD de um paciente **com** registro clínico falha até a
  anonimização existir. Aceito: prontuários em produção são raros nas primeiras
  semanas; o caso precisa de decisão jurídica antes de automatizar.
- (−) A obrigação de anonimização fica explícita e rastreável (herança de C7),
  não uma surpresa de uma camada futura.

## Alternatives rejected

- **`ON DELETE CASCADE`** (apagar o prontuário junto do paciente): viola a guarda
  obrigatória do CFM; transforma exclusão cadastral em destruição de prova médica.
- **`ON DELETE SET NULL` no `patient_id`**: produz registro clínico órfão sem
  paciente — pior dos mundos (mantém PII no snapshot, perde o vínculo auditável).
- **Anonimizar já em C7**: fora do escopo da camada; exige decisão jurídica e um
  fluxo dedicado. Documentado como dívida consciente, não improvisado agora.

## References

- PlanoAção §7 (Clinical), §7.9 (débito proibido), §7.10 (riscos)
- [ADR-013](013-clinical-data-ownership.md) — dono da obrigação de dados clínicos
