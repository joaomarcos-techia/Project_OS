# Autoridade da Documentação — quem vence quando dois docs discordam

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-23 · **source_of_truth:** ver §1
>
> ↩︎ [README](../README.md) · Vizinhos: [lifecycle.md](./lifecycle.md) · [doc-audit.md](./doc-audit.md)

Quando dois documentos discordam, **qual vence?** Sem regra explícita, cada leitor decide sozinho e a
doc perde autoridade. Este doc define a precedência — e, crucialmente, **como tratar divergência entre
doc e código** sem colapsar dois conceitos diferentes.

---

## 1. Dois eixos que nunca se colapsam

A verdade da documentação vive em **dois eixos distintos**:

```
ESTADO FACTUAL ATUAL  ─ o que EXISTE hoje ─→  Código · Banco · Migrations · Config · Testes
                                              (refletido em CURRENT-STATE, domains/, security/, operations/)

INTENÇÃO ARQUITETURAL ─ o que foi DECIDIDO ─→  ADRs
```

- **O código é a prova de _o que existe_.** Se a doc diz que X existe e o código não implementa X, **X
  não existe** — a doc está errada e se corrige.
- **O ADR é a prova de _o que foi decidido e por quê_.** O código divergir de um ADR **não** significa
  que "o código venceu a decisão".

## 2. Ordem de precedência (para regras e prosa)

Do mais forte ao mais fraco:

```
1. Código + Banco + Testes   → estado factual (o que existe)
2. ADRs                      → decisão arquitetural (o que foi decidido e por quê)
3. CONVENTIONS               → regras operacionais derivadas
4. CURRENT-STATE / architecture / domains / security / operations  → estado atual descrito
5. planning/                 → o que ainda não existe (planos/specs ativos)
6. history/                  → foi verdade num momento; nunca define o estado atual
```

## 3. Divergência doc↔código: **classificar, nunca auto-resolver**

Quando **ADR = X** e **Código = Y**, o resultado **não** é "Y venceu". O resultado é:

```
Estado factual atual:      Y
Decisão registrada (ADR):  X
Status:                    DIVERGÊNCIA
```

…e a divergência é **classificada** como uma de:

| Classe | Significado | Ação |
|---|---|---|
| Implementação incorreta | O código deveria seguir X e não segue (bug) | Registrar dívida; corrigir o **código** (fora do escopo documental) |
| Dívida técnica | Divergência conhecida e aceita temporariamente | Registrar em CURRENT-STATE (dívida) |
| Decisão superada | X não vale mais; Y é a nova decisão | Novo/atualizado ADR; carimbar o antigo `SUPERSEDED` |
| Necessita confirmação | Não dá pra saber a intenção | **Perguntar ao usuário** antes de escrever |

> 🔒 **Nunca usar o código para apagar automaticamente a intenção de um ADR.** Especialmente em
> **auth, RLS, multi-tenancy, criptografia, billing, dados clínicos**: divergência nessas áreas
> **para** a migração daquele doc/domínio até o dono decidir.

## 4. Regras de conflito

1. **ADR mais novo supersede o mais antigo** (cadeia bidirecional: antigo `SUPERSEDED · Successor: ADR-XXX`,
   novo `Supersedes: ADR-XXX`). Ver [../adr/README.md](../adr/README.md).
2. **Conflito de _decisão_ → novo ADR**, não edição silenciosa do doc mais fraco.
3. **Ao resolver, reconcilie o perdedor** (aponte a autoridade; não deixe dois valores divergentes vivos — [lifecycle.md](./lifecycle.md) R1 fonte única).
4. **O carimbo de status do ADR** (decisão + implementação) é a fonte rápida de "essa decisão ainda vale e está no código?".

## Veja também
- [lifecycle.md](./lifecycle.md) — status, frescor e política de exclusão.
- [doc-audit.md](./doc-audit.md) — inventário code-verified.
- [../adr/README.md](../adr/README.md) — governança e índice de status dos ADRs.
