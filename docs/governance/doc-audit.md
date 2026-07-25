# Auditoria da Documentação — estado real (code-verified)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-23
>
> ↩︎ [README](../README.md) · Vizinhos: [authority.md](./authority.md) · [lifecycle.md](./lifecycle.md)

Substitui o antigo `documentation-audit.md` (2026-07-01). Aquele declarava **"nenhum conflito, nenhum
obsoleto"** — um veredito **aspiracional, não verificado contra o código**. Esta versão registra a
realidade apurada na reestruturação de **2026-07-23**.

---

## 1. Correção do registro

| Afirmação antiga | Realidade 2026-07-23 |
|---|---|
| "Nenhum conflito estrutural aberto" | **Falso.** Havia divergências doc↔código (ex.: plano `Pro+` inexistente no código; fallback Z-API sem adapter). Ver §3. |
| "Nenhum obsoleto — nada apagado" | Acúmulo de auditorias/relatórios/snapshots encerrados lidos como estado atual. Política mudou: **deletamos** ([lifecycle.md §2](./lifecycle.md)). |
| "30 ADRs" (`adr-conformance`) | São **47** (001–047). Índice de status refeito. |

## 2. O que mudou na estrutura

De 3 monólitos (776 KB) + 138 arquivos para uma base navegável: `CURRENT-STATE.md` (estado atual),
`architecture/` + `domains/` + `security/` (arquitetura viva), `operations/` (runbooks + observability),
`planning/` (o que ainda não existe), `history/` (o que foi verdade). Autoridade em [authority.md](./authority.md).

## 3. Divergências conhecidas (verificadas contra o código)

Registro vivo; cada uma é resolvida na onda do domínio (parar-e-perguntar em áreas de risco).

| Tema | Doc dizia | Código | Status |
|---|---|---|---|
| Plano `Pro+` | listado como plano | enum só `solo/clinica/pro` (`billing/events.ts:44`) | corrigir p/ `PLANNED` ou remover |
| Fallback Z-API | "swap em 30 min" | sem adapter (só Meta) | `NOT_IMPLEMENTED` (abstração existe) |
| Seats do maior plano | (memória: 15) | 10 (`rate-limit.ts:413`) | **já corrigido** na VisãoGeral |
| `admin.qoro.dev` | subdomínio próprio | vive em `app.qoro.dev/admin` | **já corrigido** na VisãoGeral |

## 4. Método (por que confiar nesta auditoria)

Cada afirmação factual aponta código (`arquivo:linha` para risco; arquivo/módulo para o resto —
[lifecycle.md R2](./lifecycle.md)). A migração de 2026-07-23 registrou evidências por domínio antes de
deletar qualquer coisa (R7). O inventário classificado completo é finalizado na última onda da migração.

## Veja também
- [authority.md](./authority.md) · [lifecycle.md](./lifecycle.md) · [../adr/README.md](../adr/README.md)
