# Fonte da Verdade da Documentação (Authority)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](./README.md).

Quando dois documentos discordam, **qual vence?** Sem uma regra explícita, cada leitor decide por conta própria e a doc perde autoridade. Este documento define a **ordem de precedência** entre as famílias de documento do ClinicaOS.

---

## 1. A ordem de precedência

Do mais forte para o mais fraco:

```
1. ADRs           → decisões arquiteturais (o QUE foi decidido e POR QUÊ)
2. CONVENTIONS    → regras operacionais derivadas das decisões (o COMO no dia a dia)
3. VisãoGeral     → visão, contexto e racional de produto/arquitetura
4. PlanoAção /    → execução e estado (o que foi/será construído, camada a camada)
   PROGRESS
5. implementation/, → registro histórico (foi verdade num momento)
   audits/, remediation/
```

Se o ADR-024 diz "sem feature-gating" e uma frase antiga da VisãoGeral sugere o contrário, **o ADR vence** e a VisãoGeral deve ser reconciliada (a própria VisãoGeral §4.2 já faz isso, apontando ADR-024 como autoridade).

---

## 2. Por que essa ordem

| Camada | Papel | Por que essa posição |
|---|---|---|
| **ADRs** | Decisão + racional + alternativas rejeitadas | São a unidade atômica de decisão, **append-only** e datadas. O racional preservado é o que permite reabrir a decisão com consciência. |
| **CONVENTIONS** | Regras executáveis (naming, imports, RLS, templates) | Traduz decisões em regra do dia a dia. É "lei viva": edita junto com o PR que muda a regra. |
| **VisãoGeral** | Visão de produto + arquitetura em prosa | Rica em contexto e racional, mas escrita em blocos grandes que envelhecem; quando conflita com um ADR mais novo, o ADR é a autoridade. |
| **PlanoAção / PROGRESS** | Plano e estado de execução | Descrevem *o que está sendo feito*, não *o que é regra*. Mudam a cada camada. |
| **implementation / audits / remediation** | Fotografia de um momento | Nascem `Histórico` (ver [documentation-lifecycle.md](./documentation-lifecycle.md) §2). Úteis para contexto, nunca para decidir o estado atual. |

---

## 3. Regras de resolução de conflito

1. **ADR mais novo supersede ADR mais antigo.** ADRs são append-only; quando a decisão muda, o novo ADR cita o antigo e marca-o `superseded by`. Nunca se edita um ADR aceito. (Governado por [adr/README.md](./adr/README.md).)
2. **Conflito real → abra um ADR.** Se a discordância é sobre uma *decisão* (não um typo), a resolução é um novo ADR — não editar silenciosamente o doc mais fraco. Ver [engineering/decision-guide.md](./engineering/decision-guide.md).
3. **Ao resolver, reconcilie o perdedor.** Depois que o ADR decide, atualize (aditivamente) a VisãoGeral/CONVENTIONS para apontar a autoridade — como a VisãoGeral já faz com comentários `<!-- ADR-024 ... -->`.
4. **Código é a prova final de *o que existe*, não de *o que deveria ser*.** Se o código diverge de um ADR aceito, é bug ou dívida — o ADR continua sendo a intenção. Registre a divergência (PROGRESS ou novo ADR), não presuma que o código "venceu".

---

## 4. O que este documento NÃO faz

- Não substitui o `adr/README.md` (que governa o ciclo de vida interno dos ADRs).
- Não define frescor — isso é [documentation-lifecycle.md](./documentation-lifecycle.md).
- Não é uma lista de conflitos conhecidos — a [auditoria](./documentation-audit.md) registra que, hoje, **não há conflito estrutural aberto**; esta ordem existe para quando um surgir.

---

## Veja também

- [adr/README.md](./adr/README.md) — governança e índice dos ADRs (a autoridade máxima).
- [CONVENTIONS.md](./CONVENTIONS.md) — as regras executáveis.
- [documentation-lifecycle.md](./documentation-lifecycle.md) — status e frescor de cada doc.
- [engineering/decision-guide.md](./engineering/decision-guide.md) — quando um conflito exige um ADR.
- [README.md](./README.md) — índice mestre.
