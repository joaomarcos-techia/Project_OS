# ADR-032 — Modelo de identidade do MVP: colapso User=Employee=Practitioner + predicado `isPractitioner`

- **Status:** accepted · **Data:** 2026-07-04 (founder decidiu os 4 itens — ver "Decisões")
- **Camada:** Identity (C3) — base para os specs `convite-e-gestao-de-equipe.md` e `onboarding-owner-atende-branch.md`
- **Refs:** ADR-008 (identity patterns — P6 capacidade vs escopo), ADR-013 (ownership de dado clínico),
  ADR-016 (lifecycle de clínica), ADR-017/021 (retenção/LGPD), ADR-027 (onboarding). VisãoGeral §1.5.2
  (opinativo > configurável), §4.1.

## Context

Revisão arquitetural (2026-07-04) apontou que `profiles` acumula **três conceitos** — *User* (auth),
*Employee* (vínculo com a clínica) e *Practitioner* (atende pacientes) — numa tabela só, e que o sistema
está começando a tratar **CRM como identidade** (`crm != null ⇒ médico`) em vez de credencial. O predicado
`isPractitioner` é citado em specs mas **não existe** — enquanto isso, checks hard-coded `role === 'doctor'`
estão espalhados (grep: ≥ 17 arquivos, incl. `scheduling/config-actions.ts`, `consultorio/actions.ts`,
`dashboard/data.ts`). O onboarding está prestes a gravar CRM no owner e o convite a criar médicos — os dois
passariam a depender de um conceito ainda informal.

Sem registro, daqui a meses alguém tenta resolver terceirizado/temporário/multi-clínica/agenda-sem-login
**dentro de `profiles`**, e a inconsistência de `role === 'doctor'` vira grep no sistema inteiro.

## Decision

### 1. Colapso consciente (🔓 temporário — MVP)

`profiles` **é** User + Employee + Practitioner numa tabela só, **por decisão de MVP**, não por modelo
definitivo. O caminho de decomposição futuro é conhecido:

```
User  →  Employment (vínculo: clínica, período, tipo, ativo)  →  Practitioner (credencial, agenda)
```

Gatilhos que forçam a decomposição (quando ≥1 aparecer de verdade): médico terceirizado/temporário,
profissional em duas clínicas, agenda sem login, profissional inativo com histórico preservado. **Não
implementar agora** (YAGNI); apenas registrar que a simplificação é consciente e reversível.

### 2. `isPractitioner` é o predicado canônico de capacidade clínica (construir JÁ)

- **Predicado único:** `isPractitioner(profile) = role === 'doctor' || crm != null`, em UM lugar em
  `identity` (ex.: `src/contexts/identity/predicates.ts`), exportado pela superfície pública.
- **Migrar os checks `role === 'doctor'` para `isPractitioner`** ANTES de o onboarding gravar CRM no owner.
  Ordem obrigatória (top-5 #1 do review): predicado primeiro, depois os features que dependem dele.
- **CRM é ATRIBUTO (credencial), não identidade.** A dependência correta é:
  `isPractitioner` → (para **emitir documento**) exige CRM via `assertDoctorHasCrm` (já existe). **Nunca**
  espalhar `crm != null ⇒ médico` como regra de negócio — só dentro do predicado. O schema já aponta certo
  ([schema.ts:77](../../src/contexts/identity/schema.ts#L77): *"CRM obrigatório p/ emitir documento, não p/
  assinar prontuário"*).
- **Upgrade futuro:** quando existir profissional-sem-CRM (psicólogo/nutri), trocar `crm != null` por coluna
  booleana `is_practitioner` dedicada — o predicado muda num lugar só.

### 3. Canal de identidade = e-mail (MVP)

Identidade e convites são por **e-mail** (Supabase Auth exige e-mail; SMTP→Resend já configurado). Convite
por **WhatsApp é futuro e NÃO trivial** — depende do Auth do Supabase. Registrado para que o dia que alguém
pedir "convite por WhatsApp" saiba que é mudança estrutural, não um toggle.

### 4. Ciclo de vida do profissional — decisão mínima + débito explícito

Desativar profissional (`profiles.ativo = false`):
- **PRESERVA histórico** — prontuários e documentos emitidos sobrevivem via **snapshot** (`snapshot_doctor_crm`
  nos appointments/documentos já existe; o documento emitido não muda se o médico sai). **Nunca** hard-delete
  de profissional com histórico clínico (retenção — ADR-017/021).
- **BLOQUEIA acesso** — `ativo=false` + `signOut` (P2).
- **Responsabilidade jurídica** de documento já emitido = fixada no snapshot do momento da emissão.

**✅ Decidido (2026-07-04):** a desativação é **bloqueada enquanto houver agenda futura ou consulta aberta**
do médico — a UI exige **reatribuição ou cancelamento explícito** antes de desativar. Nunca silencioso.

### 5. Políticas de credenciamento (CRM)

- **Unicidade — ✅ decidido (2026-07-04):** `UNIQUE(clinic_id, crm)` (migração aditiva) + validar `crm_uf`.
  Hoje `profiles` **não tem** essa constraint (confirmado no schema) — entra antes de coletar CRM em escala.
  (Validação contra o CFM está **fora** do MVP — registrado como não-feito.)
- **Autoridade de alteração — ✅ decidido (2026-07-04):** CRM alterável **só por quem tem `manage:employees`,
  sempre auditado** (`internal.user.credential_changed`); o próprio médico pode preencher no 1º acesso.
  Alterar CRM **depois** de documentos emitidos **não** reescreve os snapshots já emitidos (integridade jurídica).

### 6. Overrides são exceção, não regra (contra "permission drift")

Sem **hard cap** arbitrário (o "máx. 3" do review é número mágico). Em vez disso: **visibilidade + nudge** —
a Equipe mostra "+N acessos extras" de forma proeminente e, **a partir de ~3-4 acessos extras** (✅ decidido
2026-07-04), sugere *"esse usuário tem muitos acessos extras — talvez o papel esteja errado"*. É **aviso, não
trava**. Governança por transparência, não por bloqueio rígido.

## Invariantes

- `role === 'doctor'` **não** é mais o gate de capacidade clínica em código novo — usa-se `isPractitioner`.
- CRM nunca vira predicado de negócio fora de `isPractitioner`/`assertDoctorHasCrm`.
- Colapso de `profiles` é 🔓 (temporário) e citável — não tratar como definitivo.
- Enum de role continua append-only (ADR-008); nada aqui remove role.

## Consequences
- (+) Ataca de uma vez os gaps 1, 2, 6, 8(fatia válida), 16 do review, e ancora 4/9/17.
- (+) Predicado único mata o risco de `role === 'doctor'` espalhado antes que ele cresça.
- (+) Débitos (lifecycle, unicidade CRM, autoridade CRM) ficam **explícitos e rastreáveis**, não surpresa.
- (−) Exige um passo de migração dos checks `role === 'doctor'` → `isPractitioner` antes do onboarding (custo conhecido, aceito).
- (−) Introduz `UNIQUE(clinic_id, crm)` — clínicas com CRM duplicado legado (se houver) precisam limpeza antes da migração.

## Decisões (2026-07-04 — founder)
1. **Lifecycle de desligamento:** **bloquear** a desativação enquanto houver agenda futura/consulta aberta;
   exigir reatribuição ou cancelamento explícito (§4).
2. **Unicidade de CRM:** `UNIQUE(clinic_id, crm)` (migração aditiva) + validar `crm_uf` (§5).
3. **Autoridade de alteração de CRM:** só `manage:employees`, sempre auditado; não reescreve snapshots de
   documentos já emitidos (§5).
4. **Nudge de overrides:** a partir de ~3-4 acessos extras a UI sugere revisar o papel — aviso, não trava (§6).

## Amendment (quando implementar)
As decisões acima são LEI. O enforcement entra junto das features: o `UNIQUE(clinic_id, crm)` num
`ALTER TABLE` aditivo; a migração `role === 'doctor'` → `isPractitioner` **precede** o onboarding gravar CRM.
