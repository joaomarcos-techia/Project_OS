# ADR-013 — patient_clinical_data permanece em C5, mas C7 é o futuro owner

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C5 (com obrigação futura em C7)
- Refs: ADR-001 (bounded contexts), PlanoAção §5.2, §5.18

## Context

PlanoAção §5.2 lista `patient_clinical_data` (alergias, medicamentos em uso,
doenças crônicas, tipo sanguíneo, observações) entre as tabelas do contexto
Patient (C5). Revisão arquitetural apontou: esses são dados **clínicos**, não
**cadastrais**. O dono natural deles é o contexto Clinical (C7), que ainda não
existe. Mantê-los em Patient cria acoplamento latente: quando C7 nascer, ou
duplica o modelo, ou Patient passa a "saber" de domínio clínico.

A documentação é a fonte da verdade e manda construir a tabela em C5 agora
(contrato congelado de C5). Não há autorização para mover domínio entre camadas
fora do escopo de C5.

## Decision

1. `patient_clinical_data` é criada em C5 **exatamente como o plano especifica**,
   no schema do contexto Patient. Nada muda agora.
2. Registra-se formalmente que **C7 (Clinical) será o owner** desses dados. Esta
   tabela é **migration-bound**: ao implementar C7, mover a propriedade do dado
   clínico para lá (provável: nova tabela em `clinical`, migração de dados,
   Patient consome via evento/cache se precisar, conforme ADR-001).
3. Enquanto em C5: a tabela é tenant-scoped com RLS `defaultTenantPolicy()`, FK
   `patient_id ON DELETE CASCADE` (some no hard-delete do paciente), e participa
   do export LGPD como seção `patient` (dado existente no momento da solicitação).
4. Não se constrói nenhuma abstração antecipando C7 (sem "clinical adapter"
   prematuro) — isso seria hidra. Apenas o risco fica documentado.

## Consequences
- (+) Cumpre o contrato congelado de C5 sem inventar escopo.
- (+) O acoplamento fica explícito e rastreável — C7 herda uma obrigação clara,
  não uma surpresa.
- (−) Haverá uma migração de propriedade de dados em C7 (custo conhecido e aceito).
- (−) Até C7, "dado clínico" e "dado cadastral" coabitam um contexto — tolerável
  no MVP, proibido como padrão permanente.

## Alternatives rejected
- **Mover já para um contexto `clinical` em C5**: viola contrato congelado de C5
  e o escopo da camada; C7 ainda não foi desenhado.
- **Deixar implícito (não documentar)**: repõe exatamente o risco de hidra que a
  revisão hostil existe para evitar.

## Addendum (2026-07-17, ADR-044) — cifra de `patient_clinical_data` adiada

A cifra do conteúdo clínico (ADR-044 / achado A1) cobriu prontuário, prescrição e
documento médico, mas **deixou `patient_clinical_data` em claro, de propósito**:

1. A tabela **não tem escritor** — zero INSERT/UPDATE em todo `src/`; `alergias` é
   sempre `[]`. Cifrar 0 linhas sem produtor é trabalho especulativo.
2. `alergias` é lida em **lote** por `listPatientCards` (leftJoin), cujo comentário
   diz explicitamente "NÃO decripta". Cifrar quebraria essa listagem — a mesma
   violação de "listagens não decifram" que barrou `prescription_templates`.

**Gatilho:** quando C7 assumir a escrita de `patient_clinical_data`, cifrar os
campos sensíveis (`alergias`, `medicamentosEmUso`, `doencasCronicas`) no mesmo
esquema do ADR-044 — e então `listPatientCards` precisará de decrypt em lote **ou**
o card para de exibir alergias. Decisão de produto no momento.

## References
- PlanoAção §5.2, §5.18 ("Schema de `patient_clinical_data` (jsonb evolui)")
- [ADR-001](001-bounded-contexts.md), [ADR-012](012-encryption-strategy.md), [ADR-044](044-clinical-content-encryption.md)
