# P8.4 no consultório: contrato e patch para o PR #56 (UI oficial), 24/11/2026

**Para quem:** o responsável pelo PR #56 (repaginação da UI), dono das telas do consultório.

**Decisão do fundador (24/11):** "exceção do médico: SIM", só na própria sessão clínica, pelo consultório. O médico registra o item executado além do agendado; não vê valor, não liga autorização, não inclui na guia.

**O que pedimos:** montar o bloco pronto do #55 no painel do atendimento (`attending-panel.tsx`). São **duas linhas**, no patch [`patches/56-consultorio-p84r.patch`](patches/56-consultorio-p84r.patch), gerado contra o `fe892902`. O #55 não cria tela paralela e não mexe na branch do #56.

## O que o #55 entrega

| Peça | Onde | Contrato |
| --- | --- | --- |
| Bloco pronto | `ConsultorioExtraItems` (`src/app/(app)/(shell)/convenios/_lib/session-extra-items-ui.tsx`) | `<ConsultorioExtraItems appointmentId refreshKey? />`: carrega, lista e registra; sem 0167, sem convênio SP/SADT ou em sessão de outra pessoa, não renderiza nada |
| Leitura | `loadSessionExtraItemsAction({ appointmentId })` → `getAppointmentExtraItems` | itens da sessão (código, descrição do contrato, quantidade, estado em texto), **sem valor nem decisão de faturamento**; linhas de contrato SP/SADT vigentes na data da sessão. Sem visão ampla de Convênios, só o profissional da sessão lê |
| Registro | `recordOwnSessionExtraItemAction({ appointmentId, contractLineId, quantity })` | regra `ownSession` (quem vê Convênios) + posse do atendimento conferida no servidor, na mesma transação; origem `consultorio`; repetição idêntica devolve o item existente; auditada (`health_insurance.extra_item.recorded_own_session`) |
| Regras | serviço + gatilhos da 0167 | atendimento em andamento ou concluído; só linha de contrato SP/SADT da operadora do atendimento, vigente na data; guia fechada não aceita registro novo |
| Testes | `extra-items-ui.test.tsx`, `extra-item-actions.test.ts` | bloco (lista, registro, releitura, nada para sessão alheia); ação (posse antes de gravar, sessão de outro recusada sem auditoria) |

## O patch para o #56

```diff
 import { ProntuarioEditor } from '../pacientes/[id]/prontuarios/[pid]/prontuario-editor';
+// P8.4-r (exceção do médico, 24/11): bloco do TISS para itens executados além do agendado.
+import { ConsultorioExtraItems } from '../convenios/_lib/session-extra-items-ui';
 …
+      {/* P8.4-r: só aparece em convênio SP/SADT, na sessão do próprio profissional (posse no servidor). */}
+      {emAtendimento || finalizada ? <ConsultorioExtraItems appointmentId={appointmentId} refreshKey={data.status} /> : null}
+
       {data.prontuario ? (
```

**Prova integrada:** o patch entra na composição descartável #53 → #56 → #55 (PR #63), onde a CI e o E2E da P8.4 rodam com as duas branches juntas. No #56 sozinho, o arquivo `session-extra-items-ui.tsx` não existe: o patch só se aplica depois do #55 ou na composição.

## Patches adicionais para telas do #56 (25/11)

Os três seguem o mesmo procedimento: gerados contra o `fe892902`, aplicados só na composição descartável (commits
`compose-only`), provados lá. Nenhum toca a branch do #56.

| Patch | Tarefa | O que muda na tela do #56 | Prova |
| --- | --- | --- | --- |
| [`56-consultorio-p84r.patch`](patches/56-consultorio-p84r.patch) | P8.4 (exceção do médico), P5.2 | monta `ConsultorioExtraItems` no painel do atendimento (bloco de itens e resumo do convênio, sem valor) | `e2e/convenios-p84-consultorio-preview.spec.ts` na tripla |
| [`56-agenda-p33-p52.patch`](patches/56-agenda-p33-p52.patch) | P3.3, P5.2 | monta `<AgendaInsuranceStrip />` antes do calendário em `agenda/page.tsx` (faixa "Convênios de hoje": pendência pré-consulta, carteirinha mascarada, link para Convênios só para quem opera) | `agenda-insurance-strip.test.tsx` e o mesmo spec na tripla |
| [`56-financeiro-p106.patch`](patches/56-financeiro-p106.patch) | P10.6 | `financeiro/page.tsx`: filtro "Origem" (pacientes e outros × operadoras de convênio), "A receber" dividido por origem (mesma fórmula `valor − valorPago − valorGlosado`), selo "Operadora" na linha; `page.test.tsx` com 2 testes | `page.test.tsx` na tripla; backend no #55 (`getOpenReceivablesByOrigin`, filtro `origem`), harness da ponte 19/19 |

`git apply --check` dos três contra os arquivos do `fe892902`: limpo. O patch do Financeiro preserva o saldo parcial
que desconta a glosa (`l.valor - l.valorPago - l.valorGlosado`), que o #56 ainda não tem.

## Quando

- O bloco funciona assim que a 0167 estiver no DEV (GO condicional, `go-0167-dev.md`).
- A ordem de merge combinada continua #53 → #56 → #55. Como o #55 é o último, o patch pode entrar no próprio rebase final do #55, se o dono do #56 preferir.
