# Conformidade dos ADRs ao template

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](./README.md).

Auditoria da aderência dos 30 ADRs ao [template](./adr/000-template.md) (seções **Context · Decision · Consequences · Alternatives · References**). Gerada por checagem programática dos cabeçalhos + status, não por leitura subjetiva.

⚠️ ADRs são **append-only** ([adr/README.md](./adr/README.md)) — este relatório **não** altera nenhum ADR. Ele registra o estado e orienta os **futuros** ADRs.

---

## Veredito

**Conformidade alta.** Os 30 ADRs (001–030) têm as **3 seções essenciais** (Context, Decision, Consequences) e estão todos `accepted`. Onde falta uma seção, é sempre a **Alternatives** e/ou **References** — e frequentemente porque as alternativas foram discutidas *inline* ou porque o ADR é refinamento de um anterior que já cobriu as alternativas.

| Métrica | Resultado |
|---|---|
| ADRs auditados | 30 (001–030; 000 é template) |
| Com Context + Decision + Consequences | **30 / 30** ✅ |
| Status `accepted` | 30 / 30 |
| Com seção **Alternatives** nomeada | 20 / 30 |
| Com seção **References** nomeada | 22 / 30 |

---

## Detalhe por ADR

Legenda: ✅ presente · — ausente (seção **nomeada**; conteúdo pode existir inline).

| ADR | Status | Context | Decision | Consequences | Alternatives | References |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 001–013 | accepted | ✅ | ✅ | ✅ | ✅ | ✅ |
| 014 | accepted | ✅ | ✅ | ✅ | — | — |
| 015 | accepted | ✅ | ✅ | ✅ | — | ✅ |
| 016 | accepted | ✅ | ✅ | ✅ | — | — |
| 017–019 | accepted | ✅ | ✅ | ✅ | ✅ | ✅ |
| 020 | accepted | ✅ | ✅ | ✅ | — | ✅ |
| 021 | accepted | ✅ | ✅ | ✅ | ✅ | ✅ |
| 022–027 | accepted | ✅ | ✅ | ✅ | — | maioria — |
| 028–030 | accepted | ✅ | ✅ | ✅ | ✅ | ✅ |

Sem seção **Alternatives** nomeada: **014, 015, 016, 020, 022, 023, 024, 025, 026, 027**.
Sem seção **References** nomeada: **014, 016, 022, 023, 024, 025, 026, 027**.

---

## Recomendações

1. **Não retrofitar** os ADRs existentes (append-only). O que falta é a seção *nomeada*, não necessariamente o raciocínio.
2. **Futuros ADRs** devem incluir as 5 seções do template — especialmente **Alternatives** (o "porquê não X" é o que dá valor à releitura em 2 anos) e **References**.
3. Se um ADR antigo precisar mesmo registrar alternativas esquecidas, isso vira um **novo ADR** que refina/cita o anterior — nunca edição do original.

---

## Como reproduzir

Checagem de cabeçalhos `## Context|Decision|Consequences|Alternatives|References` (+ variantes pt) e do campo `Status` em cada `docs/adr/0*.md` (exceto `000-template.md`).

## Veja também

- [adr/README.md](./adr/README.md) — índice e governança dos ADRs.
- [documentation-audit.md](./documentation-audit.md) — auditoria geral da doc.
- [engineering/decision-guide.md](./engineering/decision-guide.md) — quando abrir um ADR.
- [README.md](./README.md) — índice mestre.
