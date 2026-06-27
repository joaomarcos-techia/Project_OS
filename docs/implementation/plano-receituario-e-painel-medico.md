# Plano de Execução — Receituário de Controle Especial + Pendências do Painel Médico

**Status:** plano executável (não implementado) · **Camadas:** follow-up de C7 (Clinical) e
da UI do Painel (pós-C8/C9). ·
**Refs:** [prescricao-psiquiatria.md](prescricao-psiquiatria.md) (spec/decisão + base legal),
VisãoGeral §2.5 (defesa em 4 camadas), §2.9 (não-SAMD), §7 (prescrição/PDF/white-label),
ADR-007 (RLS), ADR-011 (outbox/audit/idempotência), ADR-012 (encryption per-tenant),
ADR-013 (clinical-data ownership).

> **Esclarecimento que motivou este doc.** Existia a percepção de que receituário de controle
> especial exigiria **integração externa / ICP-Brasil** — uma dor de cabeça. **Não exige.** A
> receita **branca de 2 vias** (lista C1 / RDC 20/2011) é um **documento impresso, assinado e
> carimbado fisicamente** pelo médico. O controle legal mora no rodapé (dados do comprador
> preenchidos **na farmácia**, não no nosso sistema). Logo, isto **reusa 100% o pipeline de
> PDF do C7** — sem provedor novo, sem certificado digital, sem assinatura eletrônica. ICP só
> entraria se um dia quiséssemos receita **100% digital sem papel** (talão azul/amarelo) — fora
> deste plano.

---

# PARTE I — Receituário de Controle Especial

## 1. Princípio e enquadramento (conceitos VisãoGeral)

- **Não é SAMD** (§2.9): é **geração de documento**. O médico decide, escreve e assina. Sem
  sugestão de conduta, interação medicamentosa automática ou triagem.
- **Não é SNGPC / dispensação**: não escrituramos venda de controlado. Só imprimimos a receita.
- **Opinionado, anti-vazamento** (§1.5): um tipo a mais de prescrição, sem configurabilidade
  desmedida. O médico marca "controle especial" e o sistema imprime no formato legal, 2 vias.
- **Defesa em 4 camadas** (§2.5) aplicada item a item na §7 (Segurança).
- **Debugável por solo founder** (§1.5): zero infra nova; só schema aditivo + 1 template PDF.

## 2. O que JÁ existe e será reusado (não reconstruir)

| Peça | Arquivo | Papel |
|---|---|---|
| Tabela `prescriptions` (+snapshot R8) | [clinical/schema.ts](../../src/contexts/clinical/schema.ts) | já guarda medicamentos + snapshot de paciente/médico |
| Action `createPrescription` (pipeline congelado) | [clinical/actions.ts](../../src/contexts/clinical/actions.ts) | `requireUser → requireFreshPermission(create:prescription) → Zod → idempotentMutation({audit}) → split-TX` |
| `ensurePrescriptionPdf` (split-TX fase 2/3) | [clinical/internal/pdf-pipeline.ts](../../src/contexts/clinical/internal/pdf-pipeline.ts) | render fora de TX → upload → grava path + publica evento (NULL→path, idempotente) |
| `renderPrescriptionPDF` + `DocShell`/`styles` | [lib/pdf/prescription.tsx](../../src/lib/pdf/prescription.tsx), [lib/pdf/components.tsx](../../src/lib/pdf/components.tsx) | template @react-pdf + casca white-label (header/assinatura/rodapé) |
| Storage privado + signed URL 24h | [lib/storage/clinical.ts](../../src/lib/storage/clinical.ts) | bucket `clinical-pdfs` **privado**; download só via `createClinicalSignedUrl` |
| Página de preview/download | [prescricoes/[id]/pdf/page.tsx](../../src/app/(app)/prescricoes/[id]/pdf/page.tsx) | gera signed URL **fresca** a cada load (R4 — action nunca devolve URL) |
| `assertDoctorHasCrm` / `resolveDoctorSnapshot` | [clinical/internal/doctor.ts](../../src/contexts/clinical/internal/doctor.ts) | CRM obrigatório no snapshot do emitente |
| `loadClinicBranding` | [clinical/internal/whitelabel.ts](../../src/contexts/clinical/internal/whitelabel.ts) | header da clínica (nome/endereço/CNPJ/CNES/logo/cor) |

## 3. Delta — o que falta de fato

1. **Distinguir o tipo** da prescrição (simples vs controle especial).
2. **Snapshotar** dois campos a mais exigidos pela receita: **endereço do paciente** e
   **endereço/telefone do emitente** (consultório).
3. **Um template PDF novo** de 2 vias com os quadros de comprador/fornecedor.
4. **Um toggle** no editor de prescrição.

Nada disso toca o pipeline transacional, a idempotência, o audit ou o RLS — só adiciona um
ramo de layout e dois campos de snapshot.

## 4. Schema — migration aditiva (zero churn)

```sql
-- enum novo
CREATE TYPE prescription_kind AS ENUM ('simples', 'controle_especial');

ALTER TABLE prescriptions
  ADD COLUMN kind prescription_kind NOT NULL DEFAULT 'simples',
  -- snapshot R8 (só preenchidos quando kind='controle_especial')
  ADD COLUMN snapshot_patient_endereco   text,
  ADD COLUMN snapshot_emitente_endereco  text,
  ADD COLUMN snapshot_emitente_telefone  text;
```

- **Aditivo/backward-compatible:** linhas existentes ficam `kind='simples'`, novos campos
  `NULL`. RLS `ENABLE+FORCE` + grants **herdados** (mesma tabela tenant-scoped, ADR-007 §10).
- Drizzle é a fonte da verdade (C1): declarar em `schema.ts` + `pnpm db:generate`. Numeração
  segue a sequência (próxima migration livre).

## 5. Input + Server Action

- **`CreatePrescriptionSchema`** ([types.ts](../../src/contexts/clinical/types.ts)) ganha
  `kind: z.enum(['simples','controle_especial']).default('simples')`. `MedicamentoSchema`
  **intocado**.
- **`createPrescription`**: quando `kind==='controle_especial'`, antes do `idempotentMutation`:
  - resolver **endereço do paciente decifrado** via o seam de Patient (NÃO ler tabela de
    Patient direto — bounded contexts §2.1). Estender o `patient-ref`/`patientApiV1` com algo
    como `getAddressForDocument(patientId)` que **decifra server-side** (ADR-012) e devolve a
    string formatada para snapshot — espelhando como `resolvePatientNome` já faz com o nome.
  - resolver **endereço/telefone do consultório** de `clinics` (via branding) e snapshotar.
  - `assertDoctorHasCrm` **mantido** (no controle especial é inegociável).
- Grava os 3 snapshots na linha. Pipeline (idempotência/audit/split-TX) **inalterado**.
- Evento `clinical.prescription.created` ganha `kind` no payload (aditivo, JSON-safe).

## 6. Template PDF — receituário de 2 vias

Novo `renderReceituarioControleEspecialPDF` em [lib/pdf/](../../src/lib/pdf/) (irmão de
`renderPrescriptionPDF`; **não** usa `DocShell` genérico — precisa de layout próprio). Em
`ensurePrescriptionPdf`, ramificar por `row.kind` para escolher o renderer; **path, bucket,
upload, signed URL e idempotência permanecem idênticos**.

**Layout (validado contra modelo real — ver [prescricao-psiquiatria.md](prescricao-psiquiatria.md) §2.1):**
duas vias **na MESMA página A4** (metade superior / inferior — dica do lead, padrão NotreDame),
cada via contendo:

1. Cabeçalho = **identificação do emitente/estabelecimento** (nome, endereço, telefone — white-label).
2. Título **"RECEITUÁRIO DE CONTROLE ESPECIAL"**.
3. **Nome do Paciente** + **Endereço do Paciente** (do snapshot).
4. Corpo sob rótulo **"Uso Interno"/"Uso Externo"**: medicamentos + posologia + quantidade.
5. **Data** + **"Carimbo e assinatura do prescritor"** (linha de assinatura física).
6. Dois quadros lado a lado: **IDENTIFICAÇÃO DO COMPRADOR** (nome, ident/órgão emissor,
   endereço, cidade, UF, telefone) e **IDENTIFICAÇÃO DO FORNECEDOR** (farmácia + assinatura do
   farmacêutico + data) — **campos em branco** (preenchidos na farmácia).
7. Rótulo da via no topo: "1ª via – …" / "2ª via – …" (texto configurável; default Portaria
   344/98: 1ª via retida na farmácia, 2ª via paciente).

> **Disclaimer impresso:** o documento só tem validade **com assinatura e carimbo físicos** do
> prescritor. Não há assinatura digital — é o mesmo fluxo que o médico já usa hoje.

## 7. Segurança (checklist obrigatório — defesa em 4 camadas §2.5)

| Camada / risco | Mitigação |
|---|---|
| **L3 RLS** | colunas novas na MESMA tabela tenant-scoped → `defaultTenantPolicy` + `FORCE` herdados; nenhuma policy nova. Médico só emite/lê prescrição da própria clínica. |
| **L4 Encryption** | endereço do paciente é decifrado **server-side no ponto de uso** (ADR-012, chave per-tenant), nunca no browser. |
| **PII no snapshot (tradeoff)** | o endereço entra **em claro** na linha de `prescriptions` (como o nome já entra — R8, documento legal imutável). Aceito e documentado: protegido por RLS+FORCE, tenant-scoped; o PDF precisa do texto em claro de qualquer forma. **Não logar** o conteúdo (sanitização do C4 já cobre). |
| **Storage** | bucket `clinical-pdfs` **privado**; download só por **signed URL TTL 24h** gerada a cada load; a Server Action **nunca** devolve URL (R4). Path namespaced por `clinicId/…`. |
| **Idempotência/Audit** | herdados do `idempotentMutation` + split-TX (publica evento só na transição NULL→path). Emissão é auditável (ADR-011). |
| **Imutabilidade** | prescrição é append-only; correção = nova prescrição (snapshot R8/R11 congela emitente/paciente). |
| **Superfície de ataque** | **zero integração externa, zero ICP, zero credencial nova** → nada a vazar/rotacionar. |
| **Não-SAMD / legal** | sem decisão clínica; disclaimer de assinatura física; não cobre tarja preta (talão numerado) — avisar na UI. |

## 8. UI (editor de prescrição, Consultório)

- Toggle **"Receita simples / Controle especial"** no formulário de prescrição
  ([consultorio] inline + a action `emitPrescription`).
- Ao escolher controle especial: nota curta — *"Para benzodiazepínicos e estimulantes (tarja
  preta) use seu talão oficial; este receituário cobre tarja vermelha (antibióticos, tramadol,
  codeína, e a maioria dos psiquiátricos C1)."*
- Preview/download reusa a página existente `/prescricoes/[id]/pdf` (sem mudança).

## 9. Validação / gates

- **Unit**: render do PDF de 2 vias (golden snapshot dos blocos), schema Zod do `kind`,
  helper "quantidade por extenso" se adotado (puro, testável).
- **Smoke** (qoro-dev, padrão C7): emitir prescrição `controle_especial` → PDF no bucket →
  signed URL abre → re-emissão idempotente (não republica evento) → **RLS A/B** (outra clínica
  não lê a prescrição).
- **Gates estáticos**: typecheck/lint/`arch:db-check`/`check:migrations`/`check:registry` ✓;
  migration aplicada em qoro-dev.

## 10. Mapa de arquivos (onde mexer)

| Arquivo | Mudança |
|---|---|
| `src/contexts/clinical/schema.ts` | + enum `prescription_kind` + 3 colunas |
| `drizzle/migrations/00XX_*.sql` | migration aditiva (generate) |
| `src/contexts/clinical/types.ts` | `kind` no `CreatePrescriptionSchema` |
| `src/contexts/clinical/actions.ts` | ramo controle especial (snapshots) |
| `src/contexts/clinical/internal/pdf-pipeline.ts` | branch por `kind` no renderer |
| `src/lib/pdf/receituario-controle-especial.tsx` | **novo** template 2 vias |
| `src/lib/pdf/components.tsx` / `whitelabel.ts` | + `telefone` no branding (emitente) |
| `src/contexts/patient/*` (seam) | método de endereço decifrado p/ snapshot |
| editor de prescrição (Consultório) | toggle + nota |

---

# PARTE II — Pendências do Painel Médico ("Em breve")

Hoje a navegação ([components/painel/modules.ts](../../src/components/painel/modules.ts)) e o
dashboard ([dashboard/page.tsx](../../src/app/(app)/(shell)/dashboard/page.tsx)) marcam alguns
itens como **"Em breve"** — decisão honesta do founder de **não simular o que não existe**
(ADR-018). **Insight central: quase tudo já tem BACKEND pronto (C6/C7/C9/C11–C14/C15); falta a
UI.** Nada aqui é reescrita de regra de negócio.

## Tabela-resumo

| # | Módulo "Em breve" | Backend pronto? | O que falta | Esforço | Prioridade |
|---|---|---|---|---|---|
| 1 | **Relatórios** | ✅ dados existem (no-show, lançamentos, `cash_flow_daily`, usage) | UI de **painéis: ocupação · no-show · faturamento** | Médio | **Alta** (= promessa do plano Solo) |
| 2 | **Configurações** | ✅ parcial (`clinics`, `ai_clinic_config`, números WhatsApp, `doctor_availability`, catálogo) | UI tenant: perfil/white-label, horários, procedimentos, IA, **conexão WhatsApp** | Médio-Alto | **Alta** (white-label alimenta o receituário; WhatsApp = go-live) |
| 3 | **Documentos** | ✅ C7 (PDFs já geram; páginas `/…/pdf` existem) | rota índice `/documentos` (lista/filtra → linka pros PDFs) | Baixo | Alta (quick win) |
| 4 | **Prontuário** (nav) | ✅ C7 (editor já existe no Consultório) | navegação por paciente (histórico de prontuários) | Baixo-Médio | Média |
| 5 | **Painel "Alertas da IA"** | ✅ `faturamento_pendencias`, `faltou`, `needs_return`, `ai_handoff_queue` | painel que agrega os alertas | Baixo-Médio | Média |
| 6 | **Painel "Ocupação por profissional"** | ✅ `doctor_availability` + `appointments` | cálculo ocupação = agendado/disponível por médico | Baixo-Médio | Média |
| 7 | **Conversas IA** (tenant) | ✅ C11/C12 (msgs cifradas) + padrão de decrypt do C15 | inbox tenant + fila de handoff (decrypt **server-side**) | Médio | Média (útil só com WhatsApp no ar) |
| 8 | **Agenda** | ✅ C6 (state machine/slots/actions completos) | UI de **calendário** (criar/editar/cancelar) | Médio-Alto | Média-Alta |

## Detalhe + como resolver

**1. Relatórios (entrega a promessa Solo "painéis de ocupação, no-show e faturamento").**
Construir `/relatorios` com Recharts (stack §3.1). Faturamento: de `cash_flow_daily` +
`lancamentos`. No-show: `appointments.status='faltou'` por período/médico. Ocupação:
slots agendados ÷ disponíveis. **Sem backend novo** — só queries de leitura + gráficos.
Isto também alimenta o painel #6 do dashboard.

**2. Configurações (tenant).** Sub-seções: **perfil/white-label** (logo, cor, nome em PDF —
**alimenta diretamente o cabeçalho do receituário da Parte I**), **horários** (`doctor_availability`),
**procedimentos/preços** (catálogo de Scheduling), **config da IA** (`ai_clinic_config`,
inclusive `can_disclose_payments_via_agent`), e **conexão do WhatsApp** (seguir o handoff
[whatsapp-connection-flow.md](../whatsapp-connection-flow.md) — Modelo A para destravar). Escrita
via Server Actions com `requireRole`/`requireFreshPermission(manage:settings)`.

**3. Documentos.** Rota `/documentos` (e/ou `/pacientes/[id]/documentos`): lista paginada de
`prescriptions` + `medical_documents` (filtro por paciente/tipo/data) linkando às páginas de PDF
já existentes. **Quase só leitura + UI.** Menor esforço, alto valor.

**4. Prontuário (browse).** Visão por paciente do histórico (`/pacientes/[id]/prontuarios` — já
referenciado em links). Reusa `ProntuarioEditor` (C7/C8) read-only + versões. Sem regra nova.

**5. Painel "Alertas da IA".** Agregar sinais que **já existem**: cobrança ausente
(`faturamento_pendencias` aberta), no-show (`appointments.faltou`), retorno vencido
(`prontuarios.needs_return` + `return_days` estourado), handoff pendente (`ai_handoff_queue`).
Painel de leitura no dashboard. Não depende do LLM.

**6. Painel "Ocupação por profissional".** Mesmo cálculo do #1 (slice "hoje"). Pode sair junto
com Relatórios.

**7. Conversas IA (tenant).** Inbox da clínica + fila de handoff. **Segurança crítica:** decrypt
**server-side apenas**, ciphertext nunca vai ao browser — **espelhar o padrão já validado no C15**
(`docs/testesC15.md`). Valor real só depois do WhatsApp no ar.

**8. Agenda.** Maior peça de UI: calendário (React Big Calendar §3.1) lendo as queries de C6 e
chamando as actions existentes (`schedule/confirm/cancel/reschedule`). Backend **completo** — é
trabalho de front. Desbloqueia ocupação real e tira vários "chega com a Agenda".

## Ordem sugerida (entrega de valor cedo, risco baixo)

1. **Documentos (#3)** + **Prontuário browse (#4)** — quick wins sobre C7 pronto.
2. **Relatórios (#1)** + **Ocupação (#6)** — entrega a promessa Solo dos painéis.
3. **Configurações (#2)** — white-label (alimenta o receituário) + conexão WhatsApp (go-live).
4. **Alertas da IA (#5)** — agrega sinais existentes.
5. **Agenda (#8)** — maior esforço de UI; faz quando a agenda visual virar prioridade.
6. **Conversas IA (#7)** — junto/depois do WhatsApp no ar.

> **Princípio mantido (ADR-018):** enquanto a tela real não existe, o item continua "Em breve" —
> não substituir por mock. Cada item acima vira link real **só quando a rota de destino existir**
> (mesma regra do 4º item da checklist de ativação — [whatsapp-connection-flow.md](../whatsapp-connection-flow.md) §6).
