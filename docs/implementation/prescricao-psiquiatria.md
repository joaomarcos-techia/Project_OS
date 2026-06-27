# Spec de Implementação — Prescrição para Psiquiatria (Controle Especial + Modelos de Receita)

**Status:** proposta (não implementada) · **Camada:** follow-up de C7 (Clinical) ·
**Origem:** lead Ricardo Souza (psiquiatra solo) — requisitos essenciais #3 (receita de
controle especial) e #4 (modelos de receita próprios). ·
**Refs:** ADR-013 (clinical-data ownership), ADR-012 (encryption per-tenant),
ADR-017 (retenção CFM), ADR-011 (outbox/audit/idempotência), VisãoGeral §7
(prescrição, "Receitas favoritas — v2.1", "Receita controlada — não substitui talão").

> **Por que este doc existe.** O C7 entrega prescrição **simples** (PDF imprimível,
> assinatura física). Para um psiquiatra de volume, dois itens viram pré-requisito de
> compra: (A) **Receituário de Controle Especial** no formato legal, e (B) **modelos de
> receita** reutilizáveis. Ambos são construíveis sobre o C7 sem reabrir contratos
> congelados. Este doc separa o que é **software-printável** do que é **regulado por
> talão físico / assinatura digital** — porque vender o segundo como se fosse o primeiro
> destrói a confiança de um prescritor (ele conhece a Portaria 344/98 melhor que nós).

---

## 0. Resumo executivo (o que é bloqueador, o que é construível)

> **Decisão de produto (2026-06-24):** receita de **controle especial despriorizada** no
> curto prazo — produto foca no **âmbito generalista**; comunicado ao lead que não está
> disponível hoje, "complicações iniciais de implementação", possível no futuro. A Parte A
> abaixo permanece **tecnicamente construível** e fica registrada para retomada. A **Parte B
> (modelos de receita)** segue como candidata de curto prazo (generalista, sem risco regulatório).
>
> **Atualização (2026-06-24, após o modelo real do lead):** o lead confirmou que esta é a
> receita **branca de 2 vias (lista C1 / tarja vermelha)** — NÃO o talão numerado (B/A, tarja
> preta). **Insight de negócio:** ela **não é específica de psiquiatria** — é **muito usada por
> clínicos gerais** (antibióticos são super prescritos; também tramadol/codeína). Logo, dentro
> do **foco generalista** escolhido, esta receita é **core, não nicho** — a justificativa da
> despriorização acima ("coisa de psiquiatra") não se sustenta. Implementação confirmada como
> **trivial**: PDF de 2 vias pré-preenchido + assinatura/carimbo físico (sem integração, sem
> numeração, sem talão, sem assinatura digital). **Recomendação: reconsiderar e priorizar a Parte A.**

| Item do Ricardo | Hoje (C7) | Veredito | Esforço |
|---|---|---|---|
| Receituário de **Controle Especial branco, 2 vias** (lista C1 / tarja vermelha — antidepressivos, antipsicóticos, estabilizadores **e antibióticos / tramadol / codeína: muito prescritos por clínicos**) | só receita simples | **construível** — PDF de 2 vias pré-preenchido + assinatura física (validado contra modelo real do lead) | **Baixo–Médio** |
| **Notificação de Receita B (azul)** — benzodiazepínicos (clonazepam, alprazolam…) | — | **parcial**: gerar rascunho/pré-preenchimento; a **via válida exige talão numerado** da Vigilância (físico) ou fluxo de **assinatura digital ICP** | Médio→Alto |
| **Notificação de Receita A (amarela)** — psicoestimulantes (metilfenidato, lisdexanfetamina / TDAH) | — | mesmo caso da B (talão numerado / ICP) | Médio→Alto |
| **Modelos de receita** próprios do médico | não existe (era v2.1) | **construível** (CRUD por médico) | Baixo→Médio |

**Conclusão de negócio:** o item (A) cobre **a maior parte do receituário diário de um
psiquiatra** e é 100% nosso. Os itens de **talão numerado** (benzo/estimulante) são
regulados no *meio* (papel oficial numerado) — resolvemos de verdade só com **prescrição
eletrônica assinada (ICP-Brasil / Memed)**, que já está no roadmap (VisãoGeral §10.2,
"Memed integration v2.1"). **Modelos de receita** é baixo esforço e alto valor percebido.

---

## 1. Contexto do que já existe (C7)

- **Tabela `prescriptions`** ([clinical/schema.ts](../../src/contexts/clinical/schema.ts)):
  `medicamentos jsonb (Medicamento[])`, `observacoes`, `pdf_storage_path`, **snapshot**
  de paciente + médico (nome/CRM/UF/especialidade) congelado na emissão (R8). Hoje há **um
  único tipo** de prescrição — sem distinção de controlado.
- **`Medicamento`** ([clinical/types.ts](../../src/contexts/clinical/types.ts)):
  `{ nome, dosagem?, posologia?, quantidade?, via? }`.
- **`medical_documents`** com enum `['atestado','exame','declaracao','encaminhamento']` —
  cobre **pedido de exame** e **encaminhamento** (essenciais #3 do lead, já prontos).
- **Server Action `createPrescription`** ([clinical/actions.ts](../../src/contexts/clinical/actions.ts)):
  pipeline congelado `requireUser → requireFreshPermission(create:prescription) → Zod →
  idempotentMutation({audit}) → split-TX`; PDF via `ensurePrescriptionPdf`
  (`internal/pdf-pipeline`, `@react-pdf/renderer`); evento `clinical.prescription.created`.
- **`assertDoctorHasCrm`** já exige CRM do emitente na prescrição (snapshot obrigatório).
- **Imutabilidade pós-emissão**: prescrição é append-only (não há UPDATE de conteúdo;
  correção = nova prescrição). Mantemos.

> **Não é SAMD.** Tudo aqui é **geração de documento** (o médico decide e assina). Não há
> sugestão de conduta, interação medicamentosa automática nem triagem — fora do escopo
> ANVISA/SAMD (VisãoGeral §2.9). **Não é SNGPC**: SNGPC é escrituração de *dispensação*
> (lado farmácia), não emissão de receita. Continua fora (VisãoGeral §1.6).

---

## 2. Parte A — Receituário de Controle Especial (branco, 2 vias)

### 2.1 O que a lei exige (Portaria SVS/MS 344/98, art. 35 + Anexo)

O **Receituário de Controle Especial** (substâncias da lista **C1** e correlatas) é emitido
em **2 vias**, em papel comum (NÃO exige talão numerado da Vigilância), com os blocos:

> **Dois regimes, um mesmo documento:** tramadol/codeína e a maioria dos psiquiátricos seguem
> a **Portaria 344/98 (C1)**; **antibióticos** seguem a **RDC ANVISA 20/2011** (venda com
> retenção de receita). Regras distintas, mas na prática **o mesmo receituário branco de 2
> vias** atende aos dois — muda só a substância. O template é único.

1. **Identificação do emitente** (impressa): nome do profissional, **CRM/UF**, **endereço
   completo do consultório** e **telefone**. *(Temos nome/CRM/UF; falta endereço/telefone do
   consultório no snapshot.)*
2. **Paciente**: nome e **endereço completo**. *(Endereço vive em `patient_addresses`,
   cifrado — decifrar no render, snapshotar no documento.)*
3. **Medicamento(s)**: nome, **dosagem/concentração**, **quantidade** (algarismo + por
   extenso é a prática recomendada), **posologia**.
4. **Data de emissão.**
5. **Identificação do comprador** (preenchida na farmácia — o documento só **reserva o
   espaço/os campos**): nome, identidade (RG) + órgão emissor, endereço, **cidade, UF**, telefone.
6. **Identificação do fornecedor/farmácia** (idem): nome do estabelecimento, do
   farmacêutico, e data do atendimento.
7. **Carimbo + assinatura** do prescritor.

> **Layout validado contra um modelo real do lead** (Receituário de Controle Especial,
> Prefeitura de Vinhedo/SP). Ordem na folha: cabeçalho com **identificação do
> estabelecimento/emitente** (nome, endereço, telefone) → título "RECEITUÁRIO DE CONTROLE
> ESPECIAL" → "Nome do Paciente" + "Endereço do Paciente" → **corpo da prescrição sob rótulo
> "Uso Interno"/"Uso Externo"** (medicamentos + posologia) → "Data" → "Carimbo e assinatura
> do prescritor" → dois quadros inferiores lado a lado (**Comprador** | **Fornecedor**).
>
> **Vias:** as duas são **idênticas em conteúdo**; o rótulo de cada via segue a Portaria
> 344/98 (1ª via – retida na farmácia/drogaria; 2ª via – orientação ao paciente), **ajustável
> ao modelo local** — o modelo do lead rotula "1ª via paciente / 2ª via farmácia". Validade
> legal usual: **30 dias** (o PDF cobre a emissão; não controlamos dispensação).
>
> **Dica de layout do lead (adotar como padrão):** imprimir as **duas vias na MESMA página**
> (metade superior / metade inferior), não em 2 folhas separadas — economiza papel e é o
> padrão prático (ex.: NotreDame). Fallback opcional: 2 folhas.

### 2.2 Mudanças de schema (migration nova, aditiva)

```
-- enum novo
prescription_kind  = ['simples', 'controle_especial']   -- default 'simples'

-- ALTER TABLE prescriptions
+ kind                prescription_kind NOT NULL DEFAULT 'simples'
-- snapshot ampliado do emitente (R8) — só preenchido quando kind='controle_especial'
+ snapshot_emitente_endereco   text
+ snapshot_emitente_telefone   text
-- snapshot do endereço do paciente (R8; decifrado no momento da emissão)
+ snapshot_patient_endereco    text
```

- Aditivo e backward-compatible: linhas existentes ficam `kind='simples'`, novos campos
  `NULL`. RLS/grants herdados (mesma tabela tenant-scoped, ADR-007 §10).
- **Endereço do consultório**: ler de `clinics` (já tem endereço — VisãoGeral §4.2) no ato
  da emissão e snapshotar. Endereço do paciente: `patient_addresses` (decrypt → snapshot).
- `quantidade` continua em `Medicamento`; opcionalmente um helper de "por extenso" no render
  (puro, testável). Sem mudar o `MedicamentoSchema`.

### 2.3 Server Action / domínio

- Estender `CreatePrescriptionSchema` com `kind: z.enum(['simples','controle_especial'])`
  (default `'simples'`).
- Em `createPrescription`, quando `kind='controle_especial'`:
  - resolver e snapshotar endereço/telefone do consultório (clinic) e endereço do paciente;
  - **`assertDoctorHasCrm`** já obriga CRM — manter (no controle especial é inegociável).
- **PDF**: novo template em `internal/pdf-pipeline` (`PrescricaoControleEspecialPDF`) que
  renderiza **2 vias** com os 7 blocos do §2.1. Reusa o cabeçalho white-label do C7.
- Evento `clinical.prescription.created` ganha `kind` no payload (aditivo, JSON-safe).
- Pipeline, idempotência, audit, snapshot: **inalterados** (só novo ramo de layout).

### 2.4 Fora de escopo nesta parte (honestidade explícita)

- **Notificação de Receita A (amarela) e B (azul)** — benzodiazepínicos e psicoestimulantes:
  a via legal é **talão numerado** fornecido pela Vigilância Sanitária (controle de
  numeração estadual), **ou** prescrição eletrônica com **assinatura digital ICP-Brasil**.
  O sistema pode, no máximo, **pré-preencher um rascunho** para o médico transcrever no
  talão. A solução digital completa = **Parte C (roadmap)**. Deixar isso claro na UI
  ("para benzodiazepínicos/estimulantes use seu talão oficial — emissão digital chega com a
  assinatura ICP").

---

## 3. Parte B — Modelos de receita do médico

> VisãoGeral §7.3 marcou "Receitas favoritas do médico" como **v2.1** e o C7 deliberadamente
> não criou `clinical_templates` (R5, que tratava de templates **SOAP em código**). Esta
> parte **antecipa** o item de receita-favorita, com tabela própria — é dado do usuário
> (editável), não template curado.

### 3.1 Schema (migration aditiva)

```
prescription_templates (tenant-scoped; RLS defaultTenantPolicy(v1) + FORCE)
  id            uuid pk
  clinic_id     uuid  tenantIdRef (FK clinics, CASCADE)
  doctor_id     uuid  -- FK profiles via migration; modelo é POR médico
  nome          text  not null            -- rótulo no dropdown ("Sertralina 50mg — início")
  medicamentos  jsonb not null  $type<Medicamento[]>   -- mesma forma do prescriptions
  observacoes   text
  kind          prescription_kind not null default 'simples'  -- modelo já nasce ciente do tipo
  created_by    uuid
  created_at / updated_at
  index (clinic_id, doctor_id)
```

- **Não** é PII clínica de paciente (é gabarito de medicação) → não precisa de cifra
  per-tenant; RLS por tenant basta. Isolamento por médico via `doctor_id` no WHERE.
- Append/edição livre (é conteúdo do usuário, não documento legal emitido).

### 3.2 Server Actions (contexto Clinical)

- `createPrescriptionTemplate(input)` · `listPrescriptionTemplates()` (por médico logado) ·
  `updatePrescriptionTemplate(id, input)` · `deletePrescriptionTemplate(id)`.
- Permissão: reusar `create:prescription` (quem prescreve gerencia os próprios modelos) ou
  permission nova `manage:prescription_templates` (preferível p/ granularidade — append no
  catálogo de 21 → 22 + seed em role_permissions p/ owner/doctor; segue padrão C5 F-07).
- Pipeline padrão (`requireUser → require*Permission → Zod → idempotentMutation` p/ create).

### 3.3 UI (editor de prescrição, Consultório)

- Dropdown **"Aplicar modelo"** (carrega `medicamentos`/`observacoes`/`kind` no formulário —
  editável antes de emitir; modelo nunca emite sozinho).
- Botão **"Salvar como modelo"** a partir da receita atual.
- Gestão simples em `/configuracoes` ou aba do médico.

---

## 4. Parte C — Roadmap consciente (não construir agora, mas registrar)

Itens que o lead citou como **complementos** (não decisivos) — alinhados ao roadmap existente:

1. **Assinatura digital (ICP-Brasil / Memed)** — destrava a versão **digital válida** de
   Notificação A/B e da receita de controle especial sem papel. Hoje: papel + assinatura
   física (CFM 2.299 aceita — VisãoGeral §7). Roadmap: VisãoGeral §10.2 (Memed v2.1).
   **É o que realmente fecha o ciclo de prescrição de um psiquiatra.**
   > **Custo / dependências (não é grátis nem plug-and-play — verificar termos atuais):**
   > - **Certificado ICP-Brasil (e-CPF A1/A3)**: pago pelo **médico** (~R$ 150–500/ano,
   >   emitido por AC credenciada pelo ITI). É a "documentação governamental" exigida.
   > - **Memed**: básico grátis pro médico; **integração via API exige parceria** (termos/custo
   >   variam) e **cobertura de controle especial não é garantida** (foco histórico = receita simples).
   > - **Assinatura em nuvem** (BirdID/Soluti, VIDaaS/Valid): API com **custo por assinatura**.
   > - A plataforma **não** precisa de licença governamental para o usuário assinar, mas deve
   >   seguir o formato CFM/ANVISA. Esforço de integração real — **descomprometido por ora.**
2. **Transcrição de anamnese por IA (áudio → texto)** — **DESCOPADO** (decisão do founder,
   2026-06-24: esforço alto, sem prioridade no momento). Registro técnico para retomada
   futura: STT preenchendo o campo do prontuário **não é SAMD nem pré-anamnese** (é
   transcrição literal, sem decisão clínica), logo seria permitido — diferente da
   "pré-anamnese via IA" proibida (PlanoAção §7.1.11). Custo: provider de STT
   (Whisper/Gemini audio). Marcado "Mídia áudio→texto — futuro" (PlanoAção).
3. **Interação medicamentosa** (alerta + override auditado) — VisãoGeral §7, v2.1.

---

## 5. Ordem sugerida e gates

1. **Parte B (modelos)** — menor esforço, valor imediato, zero risco regulatório. Entra primeiro.
2. **Parte A (controle especial C1)** — cobre o grosso do receituário psiquiátrico; migration
   aditiva + 1 template PDF + snapshot ampliado.
3. **Parte C** — quando o canal de **assinatura digital** for priorizado (destrava benzo/estimulante de verdade).

**Gate de aceite (Parte A):** PDF de controle especial em 2 vias com os 7 blocos, snapshot
de emitente/paciente congelado, validado contra um modelo oficial; smoke do split-TX +
idempotência herdados do C7. **Gate (Parte B):** criar/aplicar/editar/excluir modelo por
médico, RLS A/B (médico não vê modelo de outra clínica), aplicar não emite sozinho.

## 6. Invariantes preservadas

- Pipeline C7 (require → Zod → idempotentMutation → split-TX) **intocado**; só novos ramos.
- Snapshot R8 (documento histórico imutável) estendido, não substituído.
- Sem SAMD, sem SNGPC, sem multi-gateway. RLS FORCE + grants do padrão ADR-007.
- Migrations **aditivas** (enum default `'simples'`, colunas NULL) — zero churn nas linhas existentes.
