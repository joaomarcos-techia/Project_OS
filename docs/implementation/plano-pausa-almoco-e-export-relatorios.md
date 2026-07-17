# Plano — Pausa de almoço (Horários) + Export PDF de Relatórios

> Mini-fases aprovadas pelo founder (2026-07-03) no pós-refatoração DS v2.
> Executadas na sequência, com gates completos por fase.

## Fase A — Pausa de almoço nos horários

**Achado de auditoria:** o modelo do C6 (`doctor_availability`) JÁ é
N janelas por (médico, dia) — cada linha é um intervalo com UNIQUE +
EXCLUDE anti-sobreposição, e o slot-resolver une as janelas. A action
`setDoctorAvailability` também já existe. **Não há migração de schema.**
O gap era a UX: o form de Horários mostrava um único início/fim e não
comunicava que múltiplas janelas = pausa de almoço.

**Entrega (UI apenas, `configuracoes/horarios/horarios-manager.tsx`):**
1. Visão semanal agrupada por dia: cada dia lista suas janelas como chips
   ("08:00–12:00" ×) com remover; dias sem janela mostram "—".
2. Form "Adicionar expediente" com **checkbox "com pausa de almoço"**: marcado,
   expõe manhã (início/fim) + tarde (início/fim) e cria DUAS janelas na
   submissão (2 chamadas à action existente, cada uma idempotente).
3. "+ janela" por dia para intervalos avulsos.
4. Validações client (fim > início; tarde > manhã) — o servidor mantém as dele
   (EXCLUDE de overlap responde como conflito amigável).

**Aceite:** médico com 08–12 + 13:30–18 na segunda; slot-resolver não oferece
horário no meio da pausa (Agenda/ocupação intactas — nada muda no backend).

## Fase B — Export PDF de Relatórios + consolidado por profissional

**Entrega:**
1. **Consolidado por profissional** (composição no app layer — sem JOIN
   cross-context): scheduling fornece atendimentos do período por médico
   (total/atendidos/faltas); financial fornece recebidos com `appointmentId`;
   o app junta appointmentId→doctorId e agrega faturamento por médico.
   Gate: linhas de faturamento só com `view:financial`.
2. **Rota `GET /relatorios/pdf?periodo=X`** (route handler, Node runtime):
   gera PDF via `@react-pdf/renderer` (mesma infra dos receituários/documentos)
   com: cabeçalho (clínica + período), KPIs (faturamento/no-show/ocupação) e
   tabela consolidada por profissional. Auth: `requireUser` + mesmas permissões
   da página; auditoria `report.exported`.
3. Botão **"Exportar PDF"** em `/relatorios` (abre em nova aba).

**Aceite:** PDF baixa com os mesmos números da tela; sem permissão financeira,
o PDF omite as colunas de faturamento; ação auditada.
