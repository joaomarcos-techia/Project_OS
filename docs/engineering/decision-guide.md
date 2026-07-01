# Decision Guide — "Vou criar/mudar X. E agora?"

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Fluxograma de decisão antes de escrever código. Amarra o [checklist anti-vazamento do CONVENTIONS](../CONVENTIONS.md), os ADRs e a regra de [Documentação Automática](./ai-development.md#documentação-automática). (Absorve o antigo "change-process".)

---

## O fluxo

```
Vou criar/mudar algo.
        │
        ▼
1. JÁ EXISTE?  ── sim ─▶ reusar/estender. Nunca duplicar.
        │ não              (função, tabela, evento, doc, runbook)
        ▼
2. QUAL BOUNDED CONTEXT é dono?  ── indefinido ─▶ decidir o dono ANTES.
        │                                          Área cinza = risco de hidra.
        ▼
3. MUDA UMA DECISÃO ARQUITETURAL?  ── sim ─▶ ABRIR ADR (regra dura).
        │ não                                 Sem ADR = PR bloqueado.
        ▼
4. TOCA O BANCO (nova tabela / coluna / migration)?  ── sim ─▶ checklist ADR-007 §10
        │ não                                                   + RLS + migration doc.
        ▼
5. PRECISA NOTIFICAR OUTRO CONTEXT?  ── sim ─▶ EVENTO no outbox (nunca JOIN/chamada
        │ não                                   direta). Contrato + ADR-015.
        ▼
6. IMPLEMENTAR ── depois ─▶ DOCUMENTAR (roteamento de Documentação Automática).
```

---

## As 5 perguntas, em detalhe

### 1. Já existe?
Procure antes de criar: função em `src/lib/*`, tabela no schema, evento no catálogo, doc/runbook. Duplicar é anti-padrão explícito ([CONVENTIONS.md](../CONVENTIONS.md): sem `utils.ts` genérico, sem `types/index.ts` central).

### 2. Qual bounded context é dono?
Regra é financeira → Financial. É clínica → Clinical. **Não há área cinza** (ADR-001). Se você não sabe o dono, decida isso primeiro — é a decisão mais importante. Ver [architecture/context-map.md](../architecture/context-map.md).

### 3. Muda uma decisão arquitetural? → ADR
Isolamento de tenant, outbox, encryption, ownership de dado clínico, modelo de planos, provider de mensageria/IA/pagamento, lifecycle de clínica — tudo isso tem ADR. Mudar → **novo ADR** citando o anterior (append-only). **Regra dura: sem ADR, o PR é bloqueado** ([git-workflow.md](./git-workflow.md)). Como propor: [adr/README.md](../adr/README.md).

### 4. Toca o banco? → RLS + migration + checklist
Nova tabela/coluna exige: categorização ADR-007 §10 (tenant-scoped / global protected / operational), `ENABLE + FORCE RLS` na **mesma** migration, índice em `clinic_id`, e o checklist colado no PR. Migration é imutável após aplicar. Ver [CONVENTIONS.md](../CONVENTIONS.md) (templates) e [runbooks/migrations.md](../runbooks/migrations.md).

### 5. Precisa notificar outro context? → evento
Nunca JOIN cross-context nem chamada direta. Emita um evento no **outbox** (transacional, idempotente). Novo tipo de evento = contrato documentado + versionamento [ADR-015](../adr/015-event-versioning.md). Ver [ADR-003](../adr/003-outbox-pattern.md)/[011](../adr/011-outbox-audit-idempotency-patterns.md).

---

## Depois de implementar → documentar

Aplique o roteamento de [Documentação Automática](./ai-development.md#documentação-automática): a decisão/mudança vai para ADR, CONVENTIONS, PROGRESS, contrato de evento, comentário WHY e/ou mensagem de commit — conforme o tipo. Uma mudança sem sua documentação **não está pronta**.

Em conflito entre docs durante o processo, use a [ordem de autoridade](../documentation-authority.md).

---

## Veja também

- [../CONVENTIONS.md](../CONVENTIONS.md) — checklist de nova tabela + anti-padrões (a lei).
- [../adr/README.md](../adr/README.md) — como propor um ADR.
- [../architecture/context-map.md](../architecture/context-map.md) — quem é dono de quê.
- [ai-development.md](./ai-development.md) · [git-workflow.md](./git-workflow.md) — as regras que este guia amarra.
- [README.md](../README.md) — índice mestre.
