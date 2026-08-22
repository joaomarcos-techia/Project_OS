# Referências visuais

As oito telas que definem a direção do redesign, fornecidas pelo founder em 2026-08-22.
Reduzidas de 4320px para 1600px de largura (8,6 MB → 1,1 MB) para viverem no repositório.

| Arquivo | Tela | O que a referência estabelece |
| --- | --- | --- |
| `dashboard.jpg` | Dashboard | KPI row de 5, gráfico com rótulo sobre a barra, alertas, listas com hairline, atividade em grid de 4 colunas |
| `agenda.jpg` | Agenda | Toolbar de período, faixa de legenda, grade limpa, chip de evento com dot de status, rodapé de lista de espera |
| `consultorio.jpg` | Consultório | Board de 3 colunas, borda do card carregando estado, ação principal full-width, card fantasma |
| `pacientes.jpg` | Pacientes | Stats inline no lugar de KPI cards, FilterBar, DataTable com célula de duas linhas, paginação com total |
| `documentos.jpg` | Documentos | Linha de acesso rápido, tile de ícone na tabela, radio cards no drawer |
| `financeiro.jpg` | Financeiro | Faixas de alerta, KPI com ênfase no primeiro, barras agrupadas, summary list, breakdown, stacked bar |
| `caixa.jpg` | Caixa | Barra de status, card com toolbar no header, drawer de conferência com bloco de diferença |
| `conversas-ia.jpg` | Conversas IA | Três painéis sem card, bolhas entrada/saída, barra de sugestão da IA, painel de contexto em seções |

## Como usar

Não são especificação funcional — ver [Contract §6](../CONTRACT.md). Elas não mostram estados
de erro, permissões, LGPD, listas longas nem telas administrativas. Quando conflitarem com uma
necessidade operacional, a UX operacional vence.

No GATE 3, comparar lado a lado com as capturas de `.playwright/visual/wave-N/`, na mesma
largura.

```bash
VISUAL_WAVE=wave-1 E2E_BASE_URL=<preview> E2E_AUTH_REUSE=1 pnpm test:visual
```
