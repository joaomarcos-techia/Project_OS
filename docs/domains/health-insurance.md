# Convênios e TISS

## Status

Canonical para o módulo Convênios (ADR-072). **Produção: NO-GO.** O módulo existe no DEV e no Preview; o plano e o estado vivem em `QORO_TISS_MASTER_PLAN.md`.

## Source of Truth

`src/contexts/health-insurance` (serviços em `internal/`, padrão TISS em `tiss/`), as telas em `src/app/(app)/(shell)/convenios` e as migrations 0143–0166. Os XSD oficiais 4.03.00 estão versionados com SHA-256 em `tiss/schemas/4.03.00/MANIFEST.json`.

## Escopo suportado

Guia de Consulta e Guia SP/SADT (procedimentos da tabela 22), lotes, recurso de glosa e importação de demonstrativos no Padrão TISS 4.03.00. Não há suporte universal ao TISS (`docs/roadmap/known-limitations.md`, A.3 do plano).

## Entidades

Configuração por clínica: interruptor e tipo de prestador (`hi_clinic_settings`), operadoras, planos, contratos por procedimento, credenciamento da clínica e dos profissionais, perfis TISS dos profissionais e credenciais de webservice cifradas.

Paciente: carteirinhas (`hi_memberships`, número cifrado) e cobertura por atendimento (`hi_appointment_coverages`).

Faturamento:
- autorizações (`hi_authorizations`, com itens e consumo por unidade);
- solicitações SP/SADT;
- guias (`hi_guides`, com itens, snapshot aprovado cifrado e eventos);
- lotes (`hi_batches`, com guias, eventos e retornos);
- glosas e recursos, pagamentos da operadora e alocações;
- coparticipação (`hi_copayments`) e repasses.

Arquivos TISS ficam no armazenamento privado com SHA-256 (`hi_files`).

## Estados

| Objeto | Estados |
| --- | --- |
| Guia | `pending_data` → `ready_for_review` → `reviewed` → `approved` → `in_batch` → `exported` → `sent` → `under_review` → `paid` / `partially_paid` / `partially_glossed` / `fully_glossed` → `closed`. Fora do caminho: `cancelled` (até `approved`) e `replaced` (substituição com recibo da operadora). |
| Lote | `prepared`, `validated`, `exported`, `sent`, `received`, `under_review`, `processed`, `cancelled` |
| Glosa | `informed`, `under_analysis`, `contested`, `appeal_filed`, `reversed`, `definitive` |
| Autorização | `draft`, `requested`, `pending_operator`, `authorized`, `partially_authorized`, `denied`, `expired`, `cancelled` |
| Solicitação SP/SADT | `draft`, `checked`, `awaiting_authorization`, `authorized`, `partially_authorized`, `denied`, `ready`, `completed`, `cancelled`, `expired` |
| Coparticipação | `estimated`, `calculated`, `checked`, `confirmed`, `charged`, `paid`, `refunded`, `waived`, `cancelled` |

As transições do faturamento são funções `SECURITY DEFINER` presas à clínica da sessão. O runtime lê; não escreve estado de lote, glosa ou pagamento diretamente.

## Eventos

| Evento | Quem publica | Efeito |
| --- | --- | --- |
| `scheduling.appointment.insurance_completed` | Agenda, ao concluir um atendimento de convênio | Gera a guia, processada logo depois da resposta, com o cron como reserva. |
| `health_insurance.copay.confirmed` | Gestão, ao confirmar a coparticipação | O financeiro cria o recebível do paciente. |
| `health_insurance.batch.export_requested` | Lote, em "Gerar XML em segundo plano" | O worker gera e valida o XML; uma chave por lote e versão. |
| `health_insurance.batch.send_requested` | Lote, em "Enviar pelo webservice da operadora" (só com operadora homologada; em produção, nenhuma) | Envia pelo conector SOAP e registra envio e protocolo só com o recibo conferido; nunca reenvia sozinho. |
| `health_insurance.authorization_alerts.delivery_requested` | Manutenção | Avisos de autorização a vencer, sem dado de paciente no evento. |

O `financial-reconcile` varre "convênio sem guia" e a sincronização da coparticipação.

## Invariantes

- Saldo da guia = `valor - valorPago - valorGlosado`. Guia e recebível conferem pela visão `hi_ledger_drift`.
- Nada é "enviado", "recebido" ou "autorizado" sem registro humano com comprovante ou recibo real da operadora.
- Só sai XML que passou no XSD oficial; validador indisponível = nada sai.
- O número da guia no prestador nunca se repete. A substituição exige o recibo de cancelamento da operadora.
- Uma autorização é consumida por unidade e por atendimento, até a quantidade autorizada.
- Trial e assinatura parada não operam (D24). O módulo desligado bloqueia operação nova e preserva o que já foi faturado.
- Toda tabela do módulo tem RLS por clínica. Leituras de dado sensível (carteirinha, snapshot) são auditadas.
- A credencial de webservice só é decifrada pelo adaptador SOAP, na hora do envio. Nenhuma operadora está homologada.

## Operação

Runbooks: `docs/convenios/runbooks-operacionais.md`. Permissões: `docs/convenios/matriz-permissoes-i2.md`. Desempenho medido: H.2 do plano (P14.4).
