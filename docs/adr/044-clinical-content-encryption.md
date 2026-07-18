# ADR-044 — Cifra do conteúdo clínico (estende o ADR-012 ao registro médico)

**Status:** accepted
**Date:** 2026-07-17
**Camada:** C7 (Clinical) + C5 (Crypto)
**Emenda:** ADR-012 (estende o ESCOPO da cifra, não troca o mecanismo) · ADR-013 (registra o adiamento de `patient_clinical_data`)
**Fecha:** achado A1 da auditoria de banco (e o bloqueante descoberto no desenho)

## Context

O ADR-012 cifra at-rest **apenas** dado cadastral: `patients.cpf`, `telefone`,
`endereço`. Todo o **conteúdo clínico** — o texto SOAP do prontuário, a lista de
medicamentos das prescrições, os documentos médicos (atestado/exame/etc.) —
ficava em `jsonb`/`text` **em claro**.

Isso é uma **inversão de proteção**: o CPF (identificador recuperável por outras
vias) era cifrado, e o **registro médico** — a categoria de "dado pessoal
sensível de saúde" (LGPD Art. 5º-II e Art. 11), a de maior valor e maior dano em
vazamento — não. Um `pg_dump`, snapshot de backup ou credencial de banco
comprometida expunha prontuários inteiros em texto legível. A auditoria (A1)
classificou como a exposição de maior severidade potencial do banco.

### O bloqueante que só apareceu ao desenhar

**Cifrar a coluna não bastava.** O conteúdo era copiado, em claro, para mais dois
lugares que a cifra da coluna não alcança:

- **`audit_events.before`/`.after`:** `signProntuario` passa `before =
  getProntuarioOrThrow(...)` (um `ProntuarioDetail` **com `content`**) e
  `idempotentMutation` grava `after: result` — também o DTO completo. `logAudit`
  sanitiza, mas `'content'` **não** estava em `SENSITIVE_KEYS` (só
  `content_encrypted`, de C10/C11). Medido em dev: **32 audit_events já carregavam
  a chave `content`**.
- **`idempotency_keys.response`:** `capJsonSize(result)` guardava o mesmo DTO.

Sem fechar isso, cifrar a coluna entregaria um dump ainda legível — o aceite do A1
**falharia**. (Bug latente de brinde: `audit_events` tem `CHECK
pg_column_size(before) <= 64KB`, e `FreeText` permite ~220 KB por prontuário — um
prontuário grande **já hoje** tornava a assinatura impossível. Tirar `content` do
audit corrige de graça.)

## Decision

### 1. Estende `encryptForTenant` ao conteúdo clínico — mesmo mecanismo

Colunas novas `*_encrypted text`, cifradas com o **mesmo** wire format do ADR-012
(HKDF por `clinic_id`, AES-256-GCM, byte de versão para rotação). O mecanismo é
reusado sem alteração; muda só **o que** é cifrado.

| Tabela | Coluna cifrada | Original (dropada na 0047) |
|---|---|---|
| `prontuarios` | `content_encrypted` | `content` (jsonb) |
| `prontuario_versions` | `content_encrypted` | `content` (jsonb) |
| `prescriptions` | `medicamentos_encrypted` + `observacoes_encrypted` | `medicamentos`, `observacoes` |
| `medical_documents` | `content_encrypted` | `content` (jsonb); `type` fica em claro (discrimina o render) |

### 2. O freeze "jsonb NUNCA text" é reinterpretado, não violado

`clinical/schema.ts` congelava *"content é jsonb (NUNCA text) — perde estrutura
SOAP (Regra 2)"*. A Regra 2 protege **"o prontuário são campos SOAP nomeados, não
um blob"** — e isso **continua garantido**, só muda onde é enforçado: o
`ProntuarioContentSchema.strict()` roda **antes de cifrar** (já rodava,
`actions.ts`), e o tipo `Encrypted<ProntuarioContent>` marca a coluna. Perde-se a
introspecção SQL da estrutura — custo **medido = zero**: nenhum índice/query
filtra/ordena/projeta por dentro de `content` (a busca é por
`snapshot_patient_nome`, que **fica em claro**).

### 3. Enforcement por tipo, não por convenção — `Encrypted<T>`

`src/lib/crypto/brand.ts`: `type Encrypted<T> = string & { __encrypted: (t:T)=>void }`.
Type-only, sem runtime, **sem `import 'server-only'`** (o `schema.ts` é lido pelo
drizzle-kit). Um call-site que esqueça de decifrar **não compila** — cobertura que
um arch-test (grep) não dá.

Isso pegou o bug mais perigoso do PR: `isContentEmpty(row.content)` lê de um
`SELECT ... FOR UPDATE` cru. Sem decifrar, receberia base64 → `Object.values` de
uma string → nunca "vazio" → a regra "não assinar prontuário vazio" **morreria em
silêncio**. O branded type força o decrypt ali.

### 4. Ponto único de decifra + `assertClinicOwnership`

`clinical/internal/content-crypto.ts` (inline, 1º uso). As 3 projeções de
`clinical/queries.ts` que expõem conteúdo (`toProntuarioDetail`,
`toPrescriptionSummary`, `toMedicalDocumentSummary`) viram `async` + `clinicId` e
decifram. `toProntuarioSummary` **fica síncrona e sem decrypt** — é ela que
alimenta listagem e o audit (contrato ADR-012 §6: listagens não decifram). O feed
`/documentos` não decifra (só campos de snapshot em claro).

`assertClinicOwnership` roda antes de todo decrypt. Enquadramento honesto: o
decrypt **já** falha fechado (HKDF usa `clinicId` como salt → clínica errada =
chave errada = tag GCM falha); o ganho é **erro preciso** e o invariante sobreviver
a um refactor que desacople a chave do tenant.

### 5. Não vazar para audit/idempotência — seam `project`

`idempotentMutation` ganhou `project?: (result:T)=>T` (default identidade),
aplicado ao `after` do audit **e** à resposta idempotente. Os call-sites clínicos
passam `redactProntuario` (`{...d, content:{}}`) e um `before` já redigido. O valor
**retornado ao usuário** continua completo; só o que vai **pra disco** é redigido.
Mantém o tipo T (cache-hit type-honest); os callers já só usam `id`/metadados do
retorno. Já era o 2º uso do padrão — `hard-delete.ts:88-92` é a gambiarra pós-fato
que existe porque esse seam não existia.

### 6. `editSignedProntuario` copia o CIPHERTEXT verbatim

Ao arquivar a revisão em `prontuario_versions`, copia
`contentEncrypted: row.contentEncrypted` — mesmo `clinicId`, sem round-trip.
Preserva os bytes exatos da trilha jurídica. `Encrypted<T>` → `Encrypted<T>`.

### 7. Deploy incremental em 2 migrations, SEM fallback

`0046` (aditiva, reversível): `ADD COLUMN *_encrypted text` nullable + `DROP NOT
NULL` em `prontuario_versions.content` (senão o código novo, que só escreve
cifrado, violaria o NOT NULL sem default na janela de transição). `0047`
(destrutiva, não-retorno): guard `RAISE EXCEPTION` que aborta se o backfill não
cobriu tudo, depois `SET NOT NULL` + `DROP` das colunas em claro.

**Sem fallback de texto-claro** (`isEnvelope(x)?decrypt:x`): ele transformaria
"esqueci de cifrar neste write-path" de crash em **cleartext-at-rest silencioso** —
o próprio A1. A coluna nova já dá o discriminante (NULL = não migrado). E a
heurística é indeterminada justamente em `observacoes` curto (`"abcd"` é base64
válido). Prod tem 0 linhas; dev tem 12 descartáveis — não há dado velho a tolerar.

Backfill: `scripts/encrypt-clinical-content.ts` (`pnpm db:encrypt-clinical`), por
linha com o `clinicId` dela, `--dry-run`, idempotente. **Liga
`app.allow_signed_edit='on'`** — a trigger de imutabilidade bloqueia UPDATE de
prontuário assinado independente de role (é trigger, não RLS; `dbAdmin` não ajuda).

## A8 — PII de negócio (CNPJ da clínica + document do cliente)

Mesmo mecanismo, no PR4. `clinics.cnpj` e `billing_customers.document` (CPF/CNPJ
fiscal) eram PII em claro. Agora `cnpj_encrypted`/`document_encrypted`, salt HKDF =
id da clínica. Sem branded type (diferente do conteúdo clínico): o modo de falha de
um decrypt esquecido aqui é **visível** (CNPJ errado no PDF/admin), não silencioso —
segue o padrão de `patients.cpf_encrypted`.

- `clinics.cnpj`: 5 read-sites religados p/ decifrar (PDF `whitelabel.ts`, perfil
  `tenancy/queries.ts`, admin `clinics.repo.ts`; a saga/profile cifram na escrita; o
  audit de perfil guarda o ciphertext). `id` gerado na app antes do insert (o salt é
  o próprio id).
- `billing_customers.document`: **write-only** (zero read-site) — só cifra na escrita.
- `checkout_sessions.document`: **não tocado** — coluna morta (o único escritor,
  `provisionTenant`, não é chamado por ninguém). Vale um issue de limpeza.

### A11 (UNIQUE no CNPJ) — ADIADO, com motivo concreto

O achado A11 quer `UNIQUE(cnpj)` contra cadastro duplicado. **Adiado**, decisão do
founder:

1. **Sem normalização o UNIQUE é proteção falsa.**
   `hash("12.345.678/0001-99") ≠ hash("12345678000199")` → duas grafias do MESMO
   CNPJ geram hashes diferentes e **ambas passam** pela constraint. A própria
   auditoria condiciona a UNIQUE a "após normalizar o CNPJ".
2. **O salt do HMAC é global** (ADR-012 F-16) → a unicidade seria **global da
   plataforma** ("um CNPJ = uma clínica em todo o SaaS"), o que colide em
   re-assinatura pós-cancelamento e exigiria a saga devolver `asConflict`.

> ⚠️ **Correção (2026-07-18):** a 1ª versão deste ADR e o comentário do schema
> diziam "adiado **até C13**" / "validation only in C13". **Ponteiro morto** — o C13
> (Tenancy & Billing) fechou em **2026-06-17** e não entregou validação/normalização
> de CNPJ. É o mesmo modo de falha já registrado no projeto (doc apontando para algo
> que não existe: o cron dual-factor do ADR-011, o "ADR-008 D6" que nunca foi
> escrito). A migration `0048` carrega a menção antiga no comentário e **não foi
> editada** — migration aplicada é imutável; este ADR e o schema são a autoridade.

**Estado real:** o CNPJ **não é validado nem normalizado em lugar nenhum** do
código. `cnpj_hash` é adicionada e **populada** (`hashForLookup`, não nasce morta),
pronta para o índice.

**Gatilho real (não é camada):** **antes do 1º cliente pagante via onboarding
self-serve** — é quando cadastro duplicado passa a ser possível (hoje: 1 clínica
seed, só o founder). Mesmo portão do D1/D8. **Pré-requisito:** normalizar o CNPJ na
escrita (strip de máscara) e recomputar o hash existente; só então
`CREATE UNIQUE INDEX ... ON clinics (cnpj_hash) WHERE cnpj_hash IS NOT NULL` +
capturar a violação na saga como `asConflict` (ADR-036), não 500.

## Sequência de deploy das migrations (clínico e PII)

Ambas em 2 fases (aditiva → backfill → destrutiva), e a regra vale para prod:

1. Aplicar a migration **aditiva** (0046 clínico / 0048 PII) junto com o deploy do
   código que escreve/lê cifrado.
2. Rodar o **backfill** (`pnpm db:encrypt-clinical` / `pnpm db:encrypt-business-pii`).
3. Aplicar a migration **destrutiva** (0047 / 0049).

⚠️ Se a aditiva e a destrutiva estiverem **ambas pendentes**, o `db:migrate` roda as
duas juntas (transação única) e PULA a janela de backfill. Isso é **seguro** porque o
guard `RAISE EXCEPTION` da destrutiva aborta o lote se achar dado não-migrado —
"não migrou" nunca "migrou pela metade". Só é um problema quando há dado a
backfillar: aí aplique a aditiva, faça o backfill, e **só então** aplique a
destrutiva (commits/janelas separados). Prod está vazio → as duas juntas dropam
limpo. (Observado em dev: 0048+0049 rodaram juntas, dev sem CNPJ → guard passou,
coluna dropada, 0 perda.)

## Escopo cortado, com motivo

- **`prescription_templates.medicamentos` — NÃO cifrar.** É **paciente-agnóstico**
  (sem titular de dado — o Art. 11 não se aplica) e é **listagem** (até 200/médico),
  o que violaria "listagens não decifram". O comentário do schema vence.
- **`patient_clinical_data` — adiar** (registrado em ADR-013). A tabela **não tem
  escritor** (zero INSERT/UPDATE), e cifrar `alergias` quebraria `listPatientCards`
  (leftJoin em lote). Quando C7 assumir a escrita, `listPatientCards` precisará de
  decrypt em lote ou o card para de mostrar alergias.

## Consequences

### Positivas
- O registro médico deixa de existir legível no banco: um `pg_dump` mostra
  ciphertext. Defesa-em-profundidade que faltava no dado mais sensível.
- O branded type torna "esqueci de decifrar" um erro de **compilação**.
- O seam `project` fecha os vazamentos para audit/idempotência **e** o bug do
  `CHECK` de 64 KB que impedia assinar prontuário grande.

### Negativas / riscos aceitos
- **Perder a master key agora perde o PRONTUÁRIO**, não só o CPF. O raio do
  desastre-por-perda-de-chave aumentou. Mitigação: verificar o backup da chave (GCP
  Secret Manager) **antes** do backfill de prod. Herdado do ADR-012, ampliado.
- 1 decrypt por PDF/detail (aceitável — não é listagem).
- **D6 (snapshots):** a 0046/0047 foram escritas à mão (a detecção de rename do
  drizzle-kit é interativa e não roda no nosso ambiente non-TTY). O snapshot mais
  recente segue sendo o `0044`. O journal é contíguo (48/48); só um `db:generate`
  futuro precisará reconciliar — a dívida D6 residual, menor.

### O que fica para a validação de prod (janela manual do founder)
O E2E completo de UI (criar → autosave → **tentar assinar vazio deve BLOQUEAR** →
assinar → editar assinado → PDF de receita simples e de controle especial → 4 tipos
de documento → buscar por nome em `/documentos` → export LGPD) roda contra o app
real. Em dev provei a **mecânica**: backfill 12/12, colunas em claro dropadas,
`audit_events` com 0 conteúdo clínico legível, smoke-c7/c8 verdes (escrita/leitura
cifrada, trigger, versionamento, RLS), round-trip de decrypt, e o branded type
barrando `isContentEmpty` no typecheck.

## Evidência (dev, 2026-07-17)
- Antes do seam: **32 `audit_events`** com a chave `content`. Depois: **0** com
  texto clínico legível; **0** prescrições com medicamentos legíveis.
- Backfill: `prontuarios` 12/12, `prescriptions` 7/7, `medical_documents` 2/2 — **0
  linhas** com `*_encrypted IS NULL`. `observacoes_encrypted` respeitou a nullability
  nas duas direções.
- 0047: guard passou (backfill completo), colunas em claro **dropadas**, cifradas
  `NOT NULL`, 12 prontuários preservados.
- smoke-c7 (8/8) e smoke-c8 (9/9) verdes com as colunas cifradas.
- Gates: lint, typecheck (o branded type barra call-site sem decrypt), 786 testes,
  build, check:migrations (0047 reconhecida como aprovada), arch:db-check.
