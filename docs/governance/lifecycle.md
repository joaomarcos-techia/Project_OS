# Ciclo de Vida da Documentação — status, frescor, exclusão e fontes

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-23
>
> ↩︎ [README](../README.md) · Vizinhos: [authority.md](./authority.md) · [doc-audit.md](./doc-audit.md)

Doc que ninguém confia é pior que doc nenhum. Este documento define **como saber se um doc é verdade
hoje**, **quando deletar** e **como citar a fonte** — as regras vivas da base após a reestruturação de
2026-07-23.

---

## 1. Cabeçalho-padrão

Todo doc em `docs/` (exceto ADRs, §4) começa com:

```markdown
# Título
> **Status:** Ativo · **Owner:** <nome> · **Última revisão:** AAAA-MM-DD
```

| Status | Significado | Ação |
|---|---|---|
| **Ativo** | Verdade atual, code-verified | Manter revisado |
| **Rascunho** | Em construção | Não citar como verdade |
| **Desatualizado** | Sabidamente atrás da realidade | Corrigir ou rebaixar |
| **Histórico** | Foi verdade; hoje é só contexto (vive em `history/`) | Não editar |

## 2. Exclusão (política de 2026-07-23 — substitui o antigo "nunca `rm`")

> ⚠️ **Mudança de política.** A base antiga preservava tudo ("doc velho vira Histórico, nunca `rm`").
> Isso acumulou ruído — auditorias encerradas, snapshots, relatórios — que a IA e humanos liam como se
> fossem estado atual. **Agora deletamos.**

Um doc é **DELETADO** (o git preserva o histórico bruto) quando é **redundante, falso ou obsoleto** e
**não passa no teste de `history/`** (§3). Antes de deletar: **extrair a verdade útil** e registrá-la
na fonte canônica (R1). Só então `rm`.

## 3. `history/` — critério estrito (R6)

Um doc só entra em `history/` se responder **"que conhecimento futuro isto preserva?"** — decisão
importante, mudança arquitetural, marco relevante, ou a **causa** de um problema que pode voltar. Se a
resposta é "nenhum" → **DELETE**. `history/` é pequeno de propósito; o git é a rede para o resto.

## 4. ADRs — carimbo de status (política de 2026-07-23)

> ⚠️ **Mudança de política.** ADRs eram estritamente append-only. Agora cada ADR carrega um **bloco de
> verificação** no topo (status **decisão** + **implementação** vs. código). **A prosa da decisão
> (Context/Decision/Consequences) continua imutável** — só o carimbo de status é adicionado/atualizado.

```markdown
> **Verificação (AAAA-MM-DD)**
> **Decisão:** ACTIVE | SUPERSEDED(→ADR-0XX) | HISTORICAL
> **Implementação:** IMPLEMENTED | PARTIALLY_IMPLEMENTED | NOT_IMPLEMENTED | UNKNOWN | NEEDS_USER_CONFIRMATION
> **Código:** `src/...:NN`  ·  **Divergência:** — (ou descrição)
```

Governança e índice de status: [../adr/README.md](../adr/README.md).

## 5. Regras de conteúdo (guardrails da reestruturação)

- **R1 — Fonte única canônica.** Cada informação operacional (limites, planos, permissões, nomes,
  domínios, fluxos, configs) tem **uma** fonte primária. Outros docs **referenciam** (ex.:
  `Limite Pro: 10 seats → domains/billing.md`), **não** mantêm o valor independentemente. Proíbe-se a
  **duplicação independente da verdade** (15 aqui, 10 ali), não a repetição de contexto com referência.
- **R2 — Três níveis de fonte.** Referência a **arquivo é obrigatória**; **linha exata** só para
  categorias de risco: auth, RLS, multi-tenancy, cripto, billing, isolamento de tenant, dados clínicos,
  regras de acesso. Fatos normais citam o arquivo; simples citam o módulo.
- **R3 — Sem documentação-fantasma.** Toda afirmação importante tem status explícito
  (`IMPLEMENTED · PARTIALLY_IMPLEMENTED · PLANNED · NOT_IMPLEMENTED · SUPERSEDED · HISTORICAL · UNKNOWN`).
  **Proibido verbo no presente para o que não existe** ("o sistema exporta X" → "`PLANNED` — previsto,
  não implementado"). Nunca misturar "planejado" com "existe".

## Veja também
- [authority.md](./authority.md) — qual doc vence; modelo de divergência.
- [doc-audit.md](./doc-audit.md) — inventário code-verified.
