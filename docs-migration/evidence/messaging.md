# Evidence — Messaging / WhatsApp (Onda 0, verificação parcial)

> Verificação exaustiva na Onda 3 (domínio). Categoria R4 (WhatsApp) → divergência aqui é stop-and-ask.

## Afirmação: WhatsApp via Meta Cloud API com fallback Z-API ("swap em ~30 min")
- **Evidência (código):** `src/contexts/messaging/` tem só caminho **Meta** — `internal/sender.ts`,
  `internal/inbound.ts`, `internal/meta-onboarding.ts`. **Não há** `internal/providers/` nem adapter Z-API.
  Glob completo do contexto não mostra arquivo `zapi`/`z-api`.
- **Docs/ADR que afirmam:** `VisãoGeral.md:275-276,340,427-440` ("swap pra Z-API em 30 min", "plano B operacional");
  **ADR-004** título = "Meta Cloud API com fallback ZAPI".
- **Resultado:** `DIVERGÊNCIA (fantasma parcial)` — a **abstração** existe, mas **o adapter Z-API não**.
  "Swap em 30 min" é aspiracional. Classificar fallback Z-API como `NOT_IMPLEMENTED` (abstração pronta,
  adapter ausente). VisãoGeral usa "permite swap" (condicional) — redação quase honesta; ADR-004 supõe pronto.
  → confirmar intenção na Onda 3.
