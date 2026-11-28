# ADR-072 — Convênios e faturamento TISS num contexto próprio, ligado ao financeiro pela guia

## Status

Accepted em 10/11/2026 como direção de arquitetura. Renumerado de 067 para 072 em 11/11/2026,
porque a 067–071 pertencem ao PR #53 (AbacatePay); o comentário da migration `0143_tiss_catalog.sql`
ainda cita "ADR-067" e não foi alterado, porque a migration já está aplicada no DEV. A
execução, as tarefas e as evidências ficam em
[`QORO_TISS_MASTER_PLAN.md`](../../QORO_TISS_MASTER_PLAN.md), a fonte única do módulo. Este ADR
registra só as decisões duradouras. Branch: `feat/convenios-tiss-20261110`.

## Contexto

O Qoro não fatura para operadoras de plano de saúde. A auditoria de 10/11/2026 (seção B do plano)
mostrou que o fluxo atual trata toda consulta atendida como dívida do paciente:

- `financial/internal/handlers/appointment-completed.ts` cria um recebível do paciente pelo valor
  cheio, e o UNIQUE parcial `lancamentos_appointment_uniq` impõe um lançamento por atendimento;
- `payments/internal/remainder-charge.ts` gera link Asaas do saldo desse recebível;
- `financial/dunning-candidates.ts` põe na régua todo recebível vencido com `patient_id`;
- o repasse (`financial/internal/professional-payout.ts`) calcula na conclusão (GROSS) ou espera o
  recebível do atendimento ficar pago (NET).

Uma consulta de convênio que seguisse esse caminho viraria cobrança indevida ao paciente, e o
repasse em NET ficaria preso.

O Padrão TISS 4.03.00 (competência set/2026; fontes e SHA-256 no plano, B.10) tem regras que pesam
no modelo:

- não há campo de CID na Guia de Consulta nem na SP/SADT, e a exigência de CID é vedada;
- a Guia de Consulta não tem senha nem autorização (a SP/SADT tem);
- o lote aceita um tipo de guia e no máximo 100 guias;
- o epílogo leva um MD5 do conteúdo em ISO-8859-1;
- o CNPJ é alfanumérico.

## Decisão

1. **Contexto novo `src/contexts/health-insurance`** ("Convênios" na interface). É dono de:
   - operadoras, planos, credenciamentos, perfil TISS do profissional e contratos por procedimento
     (append-only por vigência);
   - carteirinhas cifradas, coberturas, coparticipação e autorizações;
   - guias e itens, lotes e arquivos, demonstrativos, glosas, recursos e conectores;
   - terminologia TUSS versionada.

   Os contextos existentes guardam só o que já é deles: `scheduling` ganha `appointments.billing_mode`
   e `billingMode` opcional no evento de conclusão; `financial` guarda recebíveis, ledger e repasse;
   `payments` ganha guardas.
2. **Recebível da operadora ligado à guia, não ao atendimento.** Nasce na aprovação da guia para
   faturamento, como `lancamentos` com `patient_id` e `appointment_id` nulos e `tiss_guide_id`
   preenchido. Isso preserva o UNIQUE de um recebível do paciente por atendimento, que passa a
   valer só para particular ou coparticipação confirmada, e tira o recebível da operadora do link do
   saldo e da régua. A troca do CHECK `lancamentos_auto_origin_chk` só é aplicada depois de testada
   contra os lançamentos existentes.
3. **Coparticipação** tem ciclo próprio: estimada, conferida, confirmada, cobrada, paga, mais estornos
   e ajustes. Só a confirmada vira recebível do paciente e só ela pode receber link Asaas, se a
   política da clínica permitir.
4. **Glosa** tem seis estados: informada, em análise, contestada, recurso apresentado, revertida e
   definitiva. **Só a definitiva** baixa sem pagamento no ledger (`payment_transactions.kind =
   write_off`, valor novo no enum). Reverter é lançamento compensatório, nunca exclusão.
5. **Repasse de convênio** fica elegível pela política da clínica: na conclusão, na aprovação ou no
   recebimento. O padrão é no recebimento, sem antecipação. O comportamento particular não muda.
6. **Escopo TISS declarado:**
   - suportados integralmente: Guia de Consulta e Guia SP/SADT (itens da tabela 22, solicitação e
     cobrança), lotes, recurso de glosa e importação de demonstrativos;
   - fora desta versão, e declarado: outras despesas (tabelas 18, 19 e 20);
   - não se aplicam: internação, honorários, odontologia e anexos.

   O Qoro não declara suporte universal ao TISS.
7. **Conformidade em três camadas:** os XSDs oficiais versionados com manifesto, o validador interno
   (XSD com regras próprias) e a verificação cruzada manual em validadores externos, só com corpus
   sintético. Em produção, o Qoro nunca depende de site de terceiros.
8. **Conectores de operadora** ficam atrás de uma porta: o adapter manual é o padrão, e o adapter SOAP
   4.03.00 é genérico por operadora. Uma integração só é "homologada" com aceite real de operadora.
   Uma autorização nunca é marcada como concedida sem número registrado por uma pessoa ou recibo
   real.
9. **CID e dados clínicos** nunca são lidos do prontuário para preencher guia. A `indicacaoClinica`,
   campo opcional da SP/SADT, só entra por ação explícita do médico.
10. **Ativação** por flag em cada clínica e interruptor de plataforma, desligada por padrão. Não fica
   presa a nenhum plano comercial por enquanto.

## Consequências

- O fluxo particular e as clínicas sem convênio ficam como estão. Testes de caracterização vêm antes
  de qualquer mudança no financeiro, no Payments ou na agenda.
- A troca do CHECK do financeiro é a única mudança de constraint existente. Ela tem migration
  própria, testes contra os dados do DEV e um rollback por migration compensatória.
- Recebível, `write_off`, guia e XML exportado nunca são apagados para reverter: são cancelados,
  substituídos ou compensados.
- A terminologia TUSS fica em tabelas globais carregadas por script a partir do pacote oficial, com
  SHA. A atualização é por competência.
- Os números de migration (previstos a partir de 0143) são reconferidos a cada criação. O PR #53
  ocupa 0136 a 0142.

## Alternativas rejeitadas

- **Trocar o UNIQUE para `(appointment_id, pagador)`.** Mexeria no saldo do Payments e em todo
  `onConflict` atual.
- **Espalhar as tabelas por `patient`, `scheduling` e `financial`.** O ciclo da guia é um domínio
  próprio, como `billing` e `payments`.
- **Baixar toda glosa no ledger.** Glosa em análise ou contestada não é perda.
- **Validar só com o XSD interno, ou depender de validador externo em produção.**
- **Usar `libxmljs2`.** É binário nativo, frágil no Windows e na Vercel. A alternativa avaliada é
  `xmllint-wasm`, na tarefa P0.8.

## Revisitar quando

- A ANS publicar nova versão de comunicação: entram builder, XSD e corpus novos.
- Houver demanda real por outras despesas (tabelas 18, 19 e 20).
- Uma operadora oferecer webservice com credencial para homologar o adapter SOAP.
