# C7 — Clinical Context — Validation Runbook

Valida a camada C7 (PlanoAção §7.6 testes + §7.7 checklist). Dividido em
**automated** (vitest + checks estáticos, rodam no CI) e **manual/integração**
(precisam de DB `qoro-dev` + sessão da app + bucket de Storage).

## 0. One-time setup

### 0.1 Supabase Storage bucket (PDFs clínicos)
Criar **manualmente** no Supabase um bucket **privado** `clinical-pdfs` (sem acesso
público — download só via signed URL de 24h). Mesmo procedimento do bucket
`lgpd-exports` da C5.

### 0.2 CRM do médico
Para emitir prescrição/documento, o profile do médico precisa de `crm` preenchido:
```sql
UPDATE profiles SET crm = '123456', crm_uf = 'SP', especialidade = 'Clínica Médica'
WHERE id = '<doctor_user_id>';
```
> Assinar prontuário NÃO exige CRM (R6). Prescrição/documento exigem (`assertDoctorHasCrm`).

### 0.3 White-label da clínica (opcional, p/ ver o cabeçalho completo)
```sql
UPDATE clinics SET logo_url = 'https://…/logo.png', primary_color = '#0F766E',
  endereco = 'Rua A, 100 — São Paulo/SP', cnpj = '00.000.000/0001-00', cnes = '1234567'
WHERE id = '<clinic_id>';
```

## 1. Automated (CI)

```bash
pnpm typecheck            # tipos (inclui os renderers .tsx do PDF)
pnpm lint                 # boundaries, no-console, etc.
pnpm arch:check           # sem ciclos (madge)
pnpm arch:db-check        # origem de conexão + nome de migration
pnpm check:migrations     # nenhuma operação destrutiva não-aprovada
pnpm check:registry:strict # handler clinical.appointment-started registrado + no catálogo
pnpm test                 # vitest: Zod (content/sign/prescription/document), eventos, CRM, PDF puro
pnpm db:migrate:dev       # aplica 0017_clinical_core.sql em qoro-dev
pnpm smoke:c7             # qoro-dev: handler round-trip (#11) + trigger (#5/R2) + versão (#6/R1) + RLS (#13) + GRANTs; cria e LIMPA dados de teste
```

> `pnpm smoke:c7` automatiza a maior parte da PARTE B abaixo (cria clínica/médico/
> paciente/appointment próprios, emite `scheduling.appointment.started`, roda o
> worker, valida e faz rollback/cleanup). A PARTE B manual continua útil para
> inspecionar dados reais gerados pela UI.

Cobertura vitest (itens dos testes obrigatórios que NÃO dependem de DB):
- #7 geração de PDF → `src/lib/pdf/pdf.test.ts` (Buffer `%PDF`, 4 renderers).
- #12 needs_return → `validation.test.ts` + `events.test.ts`.
- #6/#2 versionamento/conteúdo estruturado → `validation.test.ts` (ProntuarioContent strict).
- #14 permissão (parte estática) → seed em `0003_identity_core.sql` (doctor tem `sign:prontuario`,
  attendant não); arch-test de `CRITICAL_ACTIONS` exige `requireFreshPermission` em sign/editSigned.
- R6 CRM → `internal/doctor.test.ts`.

## 2. Manual / integração (qoro-dev + sessão)

Os itens abaixo dependem de DB e/ou sessão. Use `psql "$DATABASE_URL"` para os checks SQL.

### 2.1 — Imutabilidade pós-assinatura (#1, #4, #5, R2)
1. UI: criar prontuário → escrever conteúdo → **Assinar**.
2. UPDATE direto no banco (deve **falhar**):
   ```sql
   UPDATE prontuarios SET content = '{"conduta":"hack"}'::jsonb WHERE id = '<pid>';
   -- ERROR: Prontuário assinado é imutável.
   ```
3. Bypass + alterar SÓ conteúdo (deve **passar**):
   ```sql
   BEGIN;
   SELECT set_config('app.allow_signed_edit','on', true);
   UPDATE prontuarios SET content = '{"conduta":"corrigido"}'::jsonb WHERE id = '<pid>';
   COMMIT;
   ```
4. Bypass + tentar alterar `signed_at` (deve **falhar** — R2):
   ```sql
   BEGIN;
   SELECT set_config('app.allow_signed_edit','on', true);
   UPDATE prontuarios SET signed_at = now() - interval '1 day' WHERE id = '<pid>';
   -- ERROR: Prontuário assinado: apenas o conteúdo pode ser corrigido (com motivo).
   ROLLBACK;
   ```
5. UI: campos desabilitados + banner "somente leitura" no prontuário assinado.

### 2.2 — Versionamento (#6, R1) — `editSignedProntuario`
1. Chamar `editSignedProntuario(id, novoConteudo, motivo, key)` (via app/admin).
2. Conferir histórico e que `version` (jurídico) incrementou e `row_version` também:
   ```sql
   SELECT version, row_version FROM prontuarios WHERE id = '<pid>';
   SELECT version, reason, edited_by FROM prontuario_versions WHERE prontuario_id = '<pid>' ORDER BY version;
   ```

### 2.3 — Auto-save + conflito (#2, #15, R1)
1. Editor abre → digitar → aguardar 10s → indicador "Salvo".
2. `SELECT row_version FROM prontuarios WHERE id='<pid>'` incrementa a cada save; `version` NÃO muda.
3. Conflito: em duas abas, editar a mesma; a 2ª recebe banner "alterado em outra janela" (`ProntuarioConflitoError`, rowVersion stale).

### 2.4 — Handler `appointment.started` (#11)
1. `startAppointment(<appt>, key)` (C6) → `pnpm worker:once`.
2. Prontuário rascunho criado e vinculado:
   ```sql
   SELECT id, status, appointment_id FROM prontuarios WHERE appointment_id = '<appt>';
   ```
3. Idempotência: rodar `worker:once` de novo NÃO cria 2º prontuário (unique parcial + onConflict).
   Walk-in (patientId null) → nenhum prontuário (no-op).

### 2.5 — PDF + Storage + signed URL (#3, #8, #9)
1. UI editor → seção Prescrição → 3 medicamentos → **Emitir prescrição (PDF)**.
2. Redireciona a `/prescricoes/[id]/pdf`: abre com logo+nome+CNPJ+CNES, médico+CRM, rodapé
   "Gerado por ClinicaOS — qoro.dev".
3. `SELECT pdf_storage_path FROM prescriptions WHERE id='<id>'` preenchido; objeto existe no bucket.
4. Signed URL expira em 24h (a página gera uma fresca por load — R4).
5. Atestado: seção Documento médico → tipo Atestado → Emitir → `/documentos/[id]/pdf`.

### 2.6 — Evento `clinical.prontuario.signed` + needs_return (#10, #12)
1. Assinar com "precisa retornar" = sim, 90 dias.
2. ```sql
   SELECT payload->>'needsReturn', payload->>'returnDays' FROM outbox
   WHERE event_type = 'clinical.prontuario.signed' ORDER BY created_at DESC LIMIT 1;
   ```
3. Evento de prescrição publicado exatamente uma vez (R10):
   ```sql
   SELECT count(*) FROM outbox WHERE event_type='clinical.prescription.created'
     AND idempotency_key = 'prescription-created:<id>';  -- = 1, mesmo após regenerar
   ```

### 2.7 — RLS clinical (#13)
Como `authenticated`, clínica A não vê prontuário da B:
```sql
SET ROLE authenticated;
SELECT set_config('app.current_clinic', '<CLINIC_A>', true);
SELECT count(*) FROM prontuarios WHERE clinic_id = '<CLINIC_B>';  -- 0
RESET ROLE;
```
`\d prontuarios` mostra `Force row security: enabled`.

### 2.8 — Permissão `sign:prontuario` (#14, 7.6.7)
1. Doctor consegue assinar (tem o bundle).
2. Attendant tenta assinar → **403** (`requireFreshPermission` na action). Attendant também não
   consegue auto-save (`create:prontuario` ausente).

### 2.9 — R8 (snapshot não muda ao regenerar)
1. Emitir prescrição com o médico atual.
2. `UPDATE profiles SET nome='Outro Nome' WHERE id='<doctor>'`.
3. Regenerar PDF (`/prescricoes/[id]/pdf` → Regenerar). O PDF mantém o nome/CRM **do snapshot**
   (não relê o profile) — `snapshot_doctor_nome` inalterado na linha.
