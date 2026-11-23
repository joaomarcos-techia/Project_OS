# P8.4 no consultório: contrato para o PR #56 (UI oficial), 23/11/2026

**Para quem:** o responsável pelo PR #56 (repaginação da UI), dono das telas do consultório.

**O que pedimos:**
- o registro do item executado adicional entra **na tela oficial do consultório**, no painel do atendimento;
- o #55 não cria tela paralela e não mexe na branch do #56.

**Quando:**
- só depois da decisão do fundador sobre **quem registra no consultório** (`decisao-p84r.md`, "exceção do médico");
- e depois da 0167 no DEV (`go-0167-dev.md`).

Até lá, o registro acontece na **conferência da guia** (painel do #55, já pronto).

## O que já existe no #55 (backend e conferência)

| Peça | Onde | Contrato |
| --- | --- | --- |
| Registrar | `recordExtraItemAction` (`src/contexts/health-insurance/actions.ts`) | entrada `{ appointmentId, contractLineId, quantity (1–999), source: 'consultorio' \| 'conferencia' }`; saída `{ ok: true, id }` ou `{ ok: false, message }` em português, sem detalhe técnico; auditada (`health_insurance.extra_item.recorded`) |
| Cancelar | `cancelExtraItemAction` | `{ itemId, reason (3–300) }`; cancelado não volta; auditada |
| Ler (por guia) | `getGuideExtraItems(clinicId, guideId)` (`queries.ts`) | `{ available, items[] }`; `available: false` sem a 0167 (o painel não aparece) |
| Regras | serviço + gatilhos da 0167 | só linha de contrato SP/SADT da operadora do atendimento, vigente na data da sessão; atendimento em andamento ou concluído; guia fechada não muda; código, descrição e "exige autorização" vêm do contrato |
| Painel da conferência | `src/app/(app)/(shell)/convenios/_lib/extra-items-ui.tsx` | referência de textos e estados para o consultório |

## O que o consultório precisaria (para o #56)

1. **Onde:** no painel do atendimento em andamento (`attending-panel.tsx` na versão do #56), uma seção recolhida "Itens executados além do agendado", só para atendimento de convênio SP/SADT.
2. **O que mostra:**
   - lista dos itens registrados na sessão: código, descrição do contrato e quantidade, **sem valor**;
   - formulário: escolher a linha do contrato e a quantidade;
   - **nenhum campo clínico**; o médico não é obrigado a preencher.
3. **Leitura que falta (o #55 entrega quando o fundador decidir):** `getAppointmentExtraItems(clinicId, appointmentId)` com os itens da sessão e as linhas de contrato elegíveis (SP/SADT, operadora do atendimento, vigentes na data). A guia ainda não existe no consultório, então a leitura por guia não serve.
4. **Permissão:**
   - com **"exceção do médico: sim"**, o #55 acrescenta a regra restrita: só o profissional da própria sessão, só `source: 'consultorio'`, só registrar (não cancela item de outra pessoa, não vê valor);
   - com **"não"**, a seção só aparece para quem opera Convênios (recepção).
5. **Textos:** os mesmos do painel da conferência ("Registrar item executado", "Este procedimento já está registrado nesta sessão…", "A guia desta sessão já foi fechada…").
6. **Testes que acompanham a tela:**
   - componente: lista, formulário, quantidade inválida sem chamar o servidor, mensagem de regra;
   - E2E no Preview junto da jornada da P8.4, depois da 0167 no DEV.

## Composição atual (23/11)

- **Heads:** #56 `fe892902`, #53 `bc955f4e`, #55 em `feat/convenios-tiss-20261110`.
- **#53 + #56:** 9 conflitos, todos em cadastro e plano; nenhum em Convênios.
- **Acrescentando o #55:** mais 11 conflitos:
  - `acoes.md` e o journal;
  - `arch-db-check.ts` e `local-build.ts`;
  - telas que o #56 repaginou e o #55 tocou (fuso da clínica e convênio): agenda, caixa, consultório (`format.ts`, `waiting-card.tsx`) e financeiro.
- **Mudanças do #55 nessas telas:** são de dado (fuso, modalidade de convênio), não de estilo. Na fusão, vale a forma do #56 com o dado do #55.
- **Bloqueio de banco da composição tripla:** a 0159 do #53 fora do journal. O dono é o #53, e o gate não se contorna.
