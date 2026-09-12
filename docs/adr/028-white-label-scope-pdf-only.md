# ADR-028 — White-label: escopo restrito aos PDFs (sem tema de app)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- **Status:** accepted
- **Date:** 2026-06-28
- **Camada:** refinamento de Fundação Visual (refina ADR-018 §5)
- **Refs:** ADR-018 §5 (white-label = sobrescrever `--primary-*` por clínica, "refinamento futuro"), VisãoGeral §1.1 ("white-label leve: logo, cor primária, nome em PDFs"), [whitelabel.ts](../../src/contexts/clinical/internal/whitelabel.ts), [relatorio-pendencias-painel.md](../implementation/relatorio-pendencias-painel.md) (achado S5)

## Context

A ADR-018 §5 deixou em aberto a possibilidade de white-label "completo": sobrescrever
os tokens `--primary-*` por clínica para re-tematizar **a interface do app** em runtime.
A VisãoGeral sempre falou em "white-label **leve**" (logo, cor, nome em PDFs).

Levantamento do código atual (2026-06-28):

- **Consumo (render): pronto.** `loadClinicBranding` → `PdfBranding` é lido no momento
  da geração e usado por TODOS os templates de PDF ([lib/pdf/*](../../src/lib/pdf/)):
  `branding.logoUrl` vira a imagem do cabeçalho; `branding.primaryColor ?? DEFAULT_PRIMARY`
  vira uma faixa colorida. Lido SEMPRE atual (R11), nunca snapshot.
- **Tema do app: NÃO existe.** Os tokens `--primary-*` ([globals.css](../../src/app/globals.css))
  são a marca fixa do ClinicaOS; **não há nenhuma injeção de `clinics.primary_color`** em
  runtime na UI. A ideia da ADR-018 §5 nunca foi implementada.
- **Escrita: só no provisionamento.** `clinics.logo_url`/`primary_color` só são definidos
  por `super_admin`/seed ([seed-clinic-user.ts](../../scripts/seed-clinic-user.ts), env
  `SEED_CLINIC_LOGO_URL`/`SEED_CLINIC_PRIMARY_COLOR`). Não há UI tenant nem admin para
  editar; `logo_url` é uma URL de texto (sem upload). `clinics` UPDATE é `super_admin`-only
  por RLS (achado S5).

A decisão do founder: **manter white-label apenas nos PDFs**; não perseguir tema de app.

## Decision

**White-label no ClinicaOS = cabeçalho dos documentos em PDF, e nada além disso.**

1. O escopo de white-label é exclusivamente o **logo** (`clinics.logo_url`) e a **cor**
   (`clinics.primary_color`) no cabeçalho dos PDFs. A interface do app **não** é
   white-label — `--primary-*` permanece a marca fixa do ClinicaOS. A porta aberta pela
   ADR-018 §5 (override de `--primary-*` por clínica) fica **explicitamente descartada**
   no MVP.

2. **Identidade da clínica ≠ white-label.** `nome`, `endereco`, `telefone`, `cnpj`,
   `cnes` são **dados obrigatórios do documento** (o receituário precisa por lei) — ficam
   independentemente desta decisão. Não confundir "editar dados da clínica" (necessário)
   com "white-label cosmético" (opcional).

3. **Manter as 2 colunas cosméticas** (`logo_url`, `primary_color`): nullable, com default
   neutro no render — custo de manutenção zero, valor real (logo no receituário). **Não**
   removê-las nem mexer nos templates.

4. **Como o logo/cor são definidos hoje:** provisionamento por `super_admin`/seed. Uma UI
   tenant para editar isso (junto da edição dos dados da clínica) é trabalho **futuro** e,
   quando vier, escreve via a action segura descrita no achado S5 (contexto `tenancy`,
   `dbAdmin` + audit, `clinic_id` resolvido do request — nunca do input). Upload de logo
   (em vez de URL) é refinamento ainda mais adiante.

## Consequences

- (+) Zero trabalho novo para "manter" white-label — o caminho de render já funciona.
- (+) Sem injeção de tema por clínica = sem complexidade de runtime/CSS por tenant para
  manter, testar ou debugar (princípio solo-founder, VisãoGeral §1.5).
- (+) A tela "Perfil da clínica" do roadmap é reposicionada: edita **dados da clínica para
  os documentos** (+ opcionalmente logo/cor), não "white-label do app".
- (−) Clínicas não personalizam a aparência do app — aceito (não é diferencial; o moat é
  IA + cobrança + auditoria, VisãoGeral §1.3).
- Porta aberta: se um dia houver demanda real (plano enterprise), retomar a ADR-018 §5 com
  um novo ADR que cite este.

## Alternatives

- **White-label completo (tema do app por clínica):** rejeitado — overengineering para o
  MVP, custo de manutenção (geração de escala de cor, contraste, dark mode por tenant) sem
  retorno claro. Era a porta da ADR-018 §5; fica fechada.
- **Remover logo/cor dos PDFs e dropar as colunas:** rejeitado — migration destrutiva para
  eliminar 2 colunas nullable que não custam manutenção e entregam valor concreto (logo no
  receituário).

## References

- ADR-018 §5 (esta ADR refina/descarta a porta aberta lá)
- VisãoGeral §1.1, §1.5
- [src/contexts/clinical/internal/whitelabel.ts](../../src/contexts/clinical/internal/whitelabel.ts), [src/lib/pdf/types.ts](../../src/lib/pdf/types.ts), [src/lib/pdf/receituario-controle-especial.tsx](../../src/lib/pdf/receituario-controle-especial.tsx)
- [scripts/seed-clinic-user.ts](../../scripts/seed-clinic-user.ts) (única via de escrita hoje)
- [docs/implementation/relatorio-pendencias-painel.md](../implementation/relatorio-pendencias-painel.md) — achado S5 (clinics UPDATE = super_admin only)
