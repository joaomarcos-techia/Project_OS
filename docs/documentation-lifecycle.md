# Ciclo de Vida da Documentação (Freshness)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2026-10-01
>
> ↩︎ Volta para o [índice mestre](./README.md).

Documentação apodrece. Depois de um ano, ninguém sabe se um doc ainda é verdade — e um doc que ninguém confia é pior que doc nenhum, porque induz decisão errada. Este documento define o **padrão de frescor** que mantém a doc do ClinicaOS confiável.

Propósito: cada doc carrega metadados que respondem, em 5 segundos, *"posso confiar nisto hoje?"*.

---

## 1. Cabeçalho-padrão de frescor

Todo doc em `docs/` (exceto ADRs — ver §4) começa com um bloco de metadados logo após o `# Título`:

```markdown
# Título do Documento

> **Status:** Ativo · **Owner:** <nome> · **Última revisão:** AAAA-MM-DD · **Próxima revisão:** AAAA-MM-DD
>
> ↩︎ Volta para o [índice mestre](./README.md).
```

### Campos

| Campo | O que significa | Regra |
|---|---|---|
| **Status** | Confiabilidade atual (ver §2) | Um dos 5 valores canônicos |
| **Owner** | Quem responde pela veracidade | Pessoa (não "time"). Hoje: João Marcos (Qoro) |
| **Última revisão** | Data da última verificação de que o conteúdo ainda é verdade | `AAAA-MM-DD`. Data absoluta, nunca "há 2 meses" |
| **Próxima revisão** | Quando revisitar (cadência em §3) | `AAAA-MM-DD` |

💡 "Última revisão" ≠ "última edição". Reler e confirmar "ainda vale" **atualiza** a data mesmo sem mudar uma vírgula. É o ato de revisão que renova a confiança.

---

## 2. Valores de Status

| Status | Significado | Ação |
|---|---|---|
| **Ativo** | Verdade atual. Pode confiar. | Manter revisado na cadência |
| **Rascunho** | Em construção, ainda não é fonte. | Não citar como verdade |
| **Desatualizado** | Sabidamente atrás da realidade; precisa de revisão. | Corrigir ou rebaixar |
| **Histórico** | Foi verdade; hoje serve só como contexto/registro. | Não editar; preservar |
| **Superseded** | Substituído por outro doc (linkar o sucessor). | Manter para rastreabilidade |

⚠️ Nada é apagado por estar velho. Doc velho vira **Histórico** ou **Superseded** (com link para o sucessor), nunca `rm`. Isso preserva a rastreabilidade de decisões — princípio herdado dos ADRs.

---

## 3. Cadência de revisão por tipo

| Tipo de doc | Cadência-alvo | Racional |
|---|---|---|
| `README.md` (índice mestre) | 3 meses | Porta de entrada — link quebrado aqui custa caro |
| `development/*` (setup, env, onboarding) | 3 meses | Quebra na hora que um dev tenta rodar |
| `CONVENTIONS.md`, `engineering/*` | 6 meses (ou no PR que muda a regra) | Lei viva — edita junto com a mudança |
| `architecture/context-map.md`, `VisãoGeral.md` | 6 meses | Muda devagar; grande impacto |
| `runbooks/*` | 6 meses ou após uso real em incidente | Testado na prática dispara revisão |
| `adr/*` | Nunca (append-only, ver §4) | — |
| `PROGRESS.md` | A cada fechamento de camada/feature | Estado, não princípio |
| `implementation/*`, `audits/*`, `remediation/*` | Não revisar — nascem `Histórico` | Registro de um momento |

📌 Cadência é alvo, não SLA. Solo founder: o gatilho real de revisão é **"toquei nesta área"**. Ao mexer num assunto, revise o doc dele de passagem.

---

## 4. ADRs são a exceção

ADRs (`docs/adr/`) **não** usam este cabeçalho. Eles são **append-only** e têm seu próprio ciclo de vida via campo `Status` (`proposed` → `accepted` → `deprecated`/`superseded`), governado por [adr/README.md](./adr/README.md). Um ADR aceito nunca é editado; quando a decisão muda, escreve-se um novo ADR que cita o anterior. Ver [documentation-authority.md](./documentation-authority.md) para a precedência entre famílias de doc.

---

## 5. Roll-out do cabeçalho (estado atual)

O padrão foi introduzido em 2026-07-01 (modernização da doc, ver [achados/documentation-modernization-report.md](./achados/documentation-modernization-report.md)).

- ✅ **Aplicado já:** todos os docs **novos** desta leva e os índices (`README.md`, `documentation-*`, `development/*`, `architecture/*`, `engineering/*`).
- 🔁 **Backlog (aditivo, conforme forem tocados):** `VisãoGeral.md`, `CONVENTIONS.md`, `PROGRESS.md`, `PlanoAção.md`, `runbooks/*`, `c16/*`, `contracts/*`. Não há reescrita em massa — o cabeçalho entra no próximo PR que tocar cada arquivo (regra de [Documentação Automática](./engineering/ai-development.md#documentação-automática)).

---

## Veja também

- [documentation-authority.md](./documentation-authority.md) — qual doc vence quando dois discordam.
- [documentation-audit.md](./documentation-audit.md) — inventário classificado de toda a doc.
- [engineering/ai-development.md](./engineering/ai-development.md) — regra de Documentação Automática (toda mudança documenta a si mesma).
- [README.md](./README.md) — índice mestre.
