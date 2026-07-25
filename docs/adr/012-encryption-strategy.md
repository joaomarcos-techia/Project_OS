# ADR-012 — Encryption Strategy (per-tenant AES-256-GCM + lookup HMAC)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C5
- Refs: ADR-002 (RLS), ADR-007 (RLS patterns), ADR-011 (outbox/audit), PlanoAção §5

> Nota: PlanoAção §5.12 chama este ADR de "ADR-008 (encryption strategy)". Esse
> número já foi consumido por `008-identity-patterns.md` em C3 (junto de 009/010/011).
> Este é o ADR de encryption, numerado **012** (próximo livre). Referência no
> plano está obsoleta, não o contrato.

## Context

C5 (Patient) é o primeiro contexto a persistir dados pessoais sensíveis (CPF,
telefone, endereço). LGPD exige proteção at-rest; um `pg_dump` ou vazamento de
backup não pode revelar CPF/telefone em claro. Ao mesmo tempo o produto precisa
**buscar** paciente por CPF e por telefone — o que é incompatível com cifragem
não-determinística se a busca for sobre o ciphertext.

Restrições herdadas (congeladas): RLS é a defesa de isolamento de tenant
(ADR-002/007); cada clínica é "uma folha de caderno" (sem cruzamento de dados
entre clínicas).

## Decision

### 1. Cifragem at-rest — AES-256-GCM, chave derivada por tenant
- Algoritmo: **AES-256-GCM** (autenticado: confidencialidade + integridade).
- Chave por clínica derivada via **HKDF-SHA256**(ikm = master key, salt =
  `clinic_id`, info = `"patient-data-encryption"`, 32 bytes). Derivação por
  chamada (sem cache da chave derivada).
- Wire format **congelado**: `base64( version(1B) || nonce(12B) || ciphertext || tag(16B) )`.
  - `version` = versão da master key (rotação).
  - `nonce` = aleatório por cifragem (`randomBytes(12)`).
  - `tag` = auth tag GCM (16B).
- Campos cifrados: `patients.cpf_encrypted`, `patients.telefone_encrypted`,
  `patient_addresses.logradouro_encrypted`, `patient_addresses.cep_encrypted`,
  `patient_emergency_contacts.telefone_encrypted`.
- Implementação única: `src/lib/crypto/encryption.ts`. `clinicId` é sempre
  obrigatório (nunca opcional).

### 2. Isolamento cross-tenant por construção
A chave de A é derivada de `clinic_id=A`. Um ciphertext de A descriptografado
com `clinic_id=B` falha na verificação do auth tag GCM (erro, não lixo). Soma-se
ao RLS: B não lê a linha de A (RLS) **e** não a decifra (auth tag). Teste 5.6.3.

### 3. Master key — Secret Manager, nunca em `.env` em produção
Abstração `SecretProvider` (`src/lib/crypto/secret-provider.ts`):
- `EnvSecretProvider` (dev/test): lê `CRYPTO_MASTER_KEY_V{n}` + `CRYPTO_LOOKUP_SALT`
  do env. Aceitável fora de produção (5.7 qualifica "não em `.env` em produção").
- `GcpSecretManagerProvider` (produção): lê do Google Secret Manager. SDK
  `@google-cloud/secret-manager` é dependência **opcional**, carregada por
  specifier computado em runtime — dev/test nunca a exigem.
- Backend resolvido por `CRYPTO_SECRET_BACKEND` (default: `gcp` se
  `NODE_ENV=production`, senão `env`). `assertCryptoRuntimeReady()` valida na
  primeira necessidade (não no import — `next build` permanece verde).

### 4. Rotação de master key
Novo ciphertext usa `MASTER_KEY_VERSION` (default 1). Leitura escolhe a versão
pelo byte `version` embutido no ciphertext, então linhas antigas continuam
legíveis com a master key antiga após rotação. Re-encrypt em massa é job ad-hoc
(débito aceitável §5.8 — sem rotação automática no MVP).

### 5. Lookup determinístico — HMAC-SHA-256 com salt global
- `hashForLookup(plaintext) = HMAC-SHA-256(plaintext, globalSalt)` → hex.
- Salt **global** (não por tenant) para que `UNIQUE (clinic_id, cpf_hash)` e
  buscas exatas funcionem. Salt vem do Secret Manager (nunca SHA puro, nunca
  sem salt — 5.9).
- Busca SEMPRE por hash exato indexado; **nunca** `LIKE` sobre ciphertext.
- **Desvio do pseudocódigo do plano**: `hashForLookup` é `async` (o salt vem de
  um provider assíncrono). Call sites já são `async`.

### 6. Ponto único de decrypt
`getPatientWithDecryptedFields` e `getPatientExportBundle/collectExportBundle`
(`src/contexts/patient/queries.ts`) são os ÚNICOS pontos de decrypt. Listagens
não decifram (5.13). Audit/eventos jamais carregam `*_encrypted`/plaintext —
as actions retornam apenas projeções não-sensíveis; `cpf_encrypted`/`telefone_encrypted`/
hashes também entram em `SENSITIVE_KEYS` (defesa em profundidade).

### 7. suppression_list desacoplada de patients (desvio do §5.2)
§5.2 dá a `suppression_list` um `patient_id`, mas §5.6.5 exige que a suppression
**sobreviva** ao hard-delete que faz CASCADE em tudo. Um FK `patient_id` torna
isso impossível (CASCADE apaga; RESTRICT bloqueia o delete). Decisão: modelar
`suppression_list (id, clinic_id, contact_hash, channel, reason, created_at)`
**sem FK para patients**, chaveada por `contact_hash = hashForLookup(telefone|email)`.
"O número não pode ser contatado, mesmo depois do paciente apagado" — e é
exatamente como o AI Agent (C14) checa outbound.

### 8. Eventos `patient.*` — mapeamento 3-segmentos (desvio do §5.2)
O regex congelado do outbox C4 (`catalog.ts` + CHECK em `outbox.event_type`)
exige `<context>.<entity>.<action>` (3 segmentos). Os nomes 2-segmentos do plano
(`patient.created`) não publicam sob esse contrato. Mapeamento congelado:
`patient.core.{created,updated,deleted}`, `patient.consent.{granted,revoked}`,
`patient.suppression.added`, `patient.lgpd.{export_requested,delete_requested}`.

### 9. Audit na erasure (hard-delete)
`audit_events` são **retidos** (integridade forense/legal), mas a PII do paciente
apagado (`nome`/`email`) é removida do JSON `before`/`after` via `dbAdmin` no
cron route (append-only RLS impede o role authenticated de fazê-lo). CPF/telefone
nunca entraram no audit. `suppression_list` permanece.

### 10. Validação de entrada (anti-DoS) + injeção
- **O backend é a fonte da verdade.** A UI (`maxLength`/`inputMode`/`pattern`) é
  só UX/primeira-linha — toda Server Action revalida com Zod
  (`CreatePatientSchema`/`UpdatePatientSchema` em `src/contexts/patient/types.ts`).
- **Limites de tamanho + classe de caractere** rejeitam input gigante/inválido
  em O(n) ANTES de qualquer normalização/crypto/DB (evita gastar CPU cifrando ou
  rodando regex sobre um payload monstro): `nome` ≤120, `cpf` 11–14 e só
  `[\d.\-\s]`, `telefone` 8–20 e só `[\d()\-\s+]`, `email` formato + ≤120.
  `validateCpf` (checksum) é a validação semântica final do CPF.
- **Injeção SQL é impossível por construção:** todo acesso é via Drizzle
  parametrizado (`.values()`, `eq()`, `set_config($1, …)`) — nunca interpolação
  de input em string SQL. RLS (`withTenant`) confina ao tenant.
- **Rate limit:** mutações de paciente exigem `requireFreshPermission` (só
  usuário de clínica autenticado) + `idempotentMutation` (dedup de duplicatas).
  Rate-limit por usuário/clínica em mutações (além do já existente no login,
  C3) fica como hardening de C16 — não é o vetor crítico, pois o input agora é
  bounded e a superfície é autenticada.

## Consequences
- (+) `pg_dump | grep '<cpf>'` retorna vazio (teste 5.6.1).
- (+) Vazamento cross-tenant é impossível por RLS **e** por chave derivada.
- (+) Busca por CPF/telefone é O(1) indexada sem expor plaintext.
- (−) Perda da master key = dados ilegíveis (mitigação: backup seguro da key).
- (−) Decrypt custa CPU; por isso listagens não decifram (só detalhe/export).
- (−) Dependência operacional nova: Google Secret Manager em produção.

## Alternatives rejected
- **pgcrypto / cifragem no banco**: chave passaria pelo SQL/logs; não isola por
  tenant via HKDF; viola "decrypt fora do ponto central".
- **Cifragem não-determinística para CPF + busca por scan**: inviável em 10M linhas.
- **Hash sem salt / SHA puro para lookup**: vulnerável a rainbow table sobre CPF
  (espaço pequeno). Proibido (5.9).
- **patient_id FK em suppression_list**: contradiz hard-delete cascade (§7).

## References
- PlanoAção §5.2, §5.5, §5.6, §5.7, §5.9, §5.18
- `src/lib/crypto/*`, `src/contexts/patient/queries.ts`
- ADR-002, ADR-007, ADR-011, [ADR-013](013-clinical-data-ownership.md)

## Addendum — Remediation (2026-05-30, pré-C6)

- **F-07 (export LGPD):** a signed URL do export passa de **7 dias → 24h**
  (`SIGNED_URL_TTL_SECONDS` + `exportSignedUrlExpiresAt`) — egresso de PII sensível,
  janela menor. Permissão dedicada `export:patient` (ver ADR-008 addendum).
- **F-13:** `decryptForTenant` valida `1 ≤ version ≤ MASTER_KEY_VERSION` ANTES do
  lookup da chave (defesa-em-profundidade contra version byte corrompido/tampering).
- **F-16 (aceito by-design, sem mudança):** o lookup HMAC usa salt **global** —
  necessário para `UNIQUE(clinic_id, cpf_hash)` e busca exata. A correlação
  cross-clinic da mesma pessoa só é possível com **acesso DB sem RLS**
  (privacidade-em-profundidade), NÃO é quebra de isolamento app-layer. Redesenho
  (salt por-clínica) exigiria re-hash de todos os dados — não justificado no MVP.
- **F-10 (LGPD retention):** o hard-delete (cron) passa a remover do audit também
  `dataNascimento`/`sexo`/`obitoEm` (além de nome/email) e a anular
  `idempotency_keys.response` que contenha o paciente apagado.
