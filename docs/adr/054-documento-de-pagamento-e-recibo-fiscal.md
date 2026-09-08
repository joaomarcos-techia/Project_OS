# ADR-054 — Documento de pagamento e recibo fiscal da Camada 2

- **Status:** Accepted — 2.1A aprovada em 2026-09-06; Asaas escolhido em 2026-09-07 como parceiro de
  NFS-e para clínicas PJ; revisão jurídico-contábil permanece gate de rollout
- **Data:** 2026-09-06; atualizada em 2026-09-07
- **Contextos:** financial, patient e tenancy, compostos somente na camada de aplicação e entregues
  em slices de no máximo dois bounded contexts
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md),
  [ADR-051](051-conciliacao-sinal-e-recebivel.md) e
  [Qoro v2 §22](../qorov2.md#22-camada-2--21-documento-de-pagamento-spike-regulatório)

## Contexto

O roadmap chama a 2.1 de “recibo PDF”, mas esse nome mistura três documentos diferentes:

1. comprovante operacional de que o Qoro registrou um pagamento;
2. recibo apto a comprovar despesa médica;
3. documento fiscal, como NFS-e ou Receita Saúde.

Tratá-los como sinônimos pode fazer o sistema emitir um PDF visualmente convincente, mas juridicamente
incompleto. Desde 1º de janeiro de 2025, médicos, psicólogos, dentistas, fisioterapeutas,
fonoaudiólogos e terapeutas ocupacionais que prestam o serviço como pessoa física estão obrigados ao
Receita Saúde. O recibo é emitido na data do pagamento e, quando parcelado, existe um recibo por
parcela. A fonte oficial também exige, para comprovação de despesas médicas, descrição do serviço,
identificação e endereço do prestador, CPF/CNPJ, responsável pelo pagamento, beneficiário, data e,
quando não fiscal, assinatura do prestador.

Fontes primárias:

- [Receita Federal — profissionais obrigados ao Receita Saúde](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/preenchimento/manual-mir/rendimentos/rendimentos-do-trabalho);
- [Manual Receita Saúde 2.1](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/orientacao-tributaria/receita-saude-2.1.pdf);
- [Receita Federal — comprovação de despesas médicas](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/malha-fiscal/antecipacao/despesas-medicas);
- [Receita Federal — dados informados na Dmed](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/dmed/o-que-informar-na-dmed).

Fonte do parceiro fiscal escolhido:

- [Asaas — fluxo de NFS-e pela API](https://docs.asaas.com/docs/notas-fiscais);
- [Asaas — emissão e requisitos de NFS-e](https://www.asaas.com/nota-fiscal).

## Evidência do modelo atual

- `payment_transactions` fornece movimentos append-only de baixa e estorno. Ela não possui coluna de
  status: uma linha `kind = 'payment'` é criada pelo Financial quando o valor recebido é reconhecido e
  alocado ao recebível. Essa é a base adequada para um comprovante por baixa, sem inventar um estado
  de confirmação no ledger;
- `clinics` possui nome, endereço e CNPJ opcional, mas não distingue emissor pessoa física de pessoa
  jurídica nem prova que `nome` seja a razão social;
- `patients` possui CPF cifrado e o contexto Patient possui relações de responsável financeiro, mas a
  transação não registra quem efetivamente pagou;
- não existe snapshot imutável de emitente, pagador, beneficiário, descrição do serviço, assinatura,
  número fiscal ou vínculo com Receita Saúde/NFS-e;
- portanto, o banco atual não sustenta honestamente um recibo médico/fiscal definitivo.

## Decisão proposta

1. Separar os conceitos no produto e no código:
   - **comprovante de pagamento Qoro:** documento informativo, explicitamente não fiscal;
   - **recibo fiscal/médico:** documento emitido ou confirmado pela fonte fiscal competente.
2. A primeira entrega segura pode ser um “Comprovante de pagamento” gerado somente para um movimento
   `payment_transactions.kind = 'payment'` já persistido pelo fluxo de baixa. O ledger não possui um
   status próprio a consultar. O documento deve declarar que não substitui Receita Saúde, NFS-e ou
   outro documento fiscal.
3. O comprovante é um snapshot imutável por transação. Estorno não reescreve o PDF anterior: gera
   estado/documento compensatório e mantém a trilha de auditoria.
4. O pagador deve ser selecionado ou confirmado explicitamente no recebimento. Não inferir pagador a
   partir do paciente, responsável legal, titular do cartão ou usuário logado. Beneficiário e pagador
   são identidades distintas.
5. Para prestador pessoa física sujeito ao Receita Saúde, o Qoro não chama seu PDF de recibo fiscal e
   não substitui o serviço oficial. Uma futura automação depende de contrato oficial de integração ou
   delegação formal confirmada em spike próprio.
6. Para clínica pessoa jurídica, o parceiro fiscal escolhido é o **Asaas**, usando sua API de NFS-e
   vinculada à cobrança quando a conta da própria clínica estiver fiscalmente configurada e habilitada.
   O Qoro não implementará motor municipal nem declarará sucesso antes da autorização da prefeitura. A
   Dmed é obrigação declaratória e não transforma, por si só, um PDF interno em documento fiscal.
7. Geração e download serão server-side, tenant-scoped e autorizados por permissão financeira; o
   cliente nunca fornece `clinic_id`, valor, identidade do emitente ou estado do pagamento como
   autoridade.
8. O documento não terá URL pública previsível. Downloads serão autenticados, auditados, limitados e
   com `Content-Disposition`; CPF/endereço serão incluídos somente quando necessários ao tipo de
   documento e nunca irão para logs, métricas ou Sentry.
9. Nenhuma migration, endpoint público ou PDF será implementado até a decisão de produto abaixo ser
   aceita. Este ADR inicia o spike 2.1.0; não declara a Camada 2 implementada.

## Decisão de produto

Decisão do fundador em 2026-09-06:

- **Aprovada — 2.1A:** entregar primeiro o comprovante não fiscal por pagamento e tratar Receita Saúde
  e NFS-e como integrações fiscais separadas. É útil operacionalmente e não promete validade que o
  Qoro ainda não consegue garantir.
- **Rejeitada para este slice:** entregar já um recibo médico/fiscal. Esse caminho continua exigindo
  definir PF/PJ, provedor fiscal, identidade legal do emitente, pagador real, beneficiário,
  assinatura/numeração, cancelamento e retenção.

A aprovação autoriza o desenho em dois lotes; não dispensa a revisão jurídico-contábil da copy e do
enquadramento da clínica piloto antes do rollout.

Decisão complementar do fundador em 2026-09-07:

- **Aprovada — 2.1B/P3:** o Asaas será o parceiro de NFS-e das clínicas PJ. O Qoro orquestra a
  configuração, agenda a nota vinculada à cobrança e projeta o resultado autoritativo recebido do
  Asaas; a emissão continua pertencendo ao prestador e à autoridade fiscal;
- **fora desse contrato:** NF-e de produto, motor fiscal próprio, integração direta com cada prefeitura
  e substituição do Receita Saúde para prestadores PF;
- a emissão é assíncrona: aceitar o POST não equivale a nota autorizada. O estado só fica emitido após
  readback/webhook autoritativo do Asaas; erro ou cancelamento permanecem explícitos e auditáveis;
- cada tenant usa a conta Asaas da própria clínica e sua configuração fiscal. Credenciais, serviço
  municipal, alíquotas e identidade do emitente nunca são compartilhados entre clínicas.

## Auditoria técnica e divisão do trabalho

A infraestrutura de renderização já existe e não exige dependência nova: `@react-pdf/renderer` 4.5.1,
renderizadores puros em `src/lib/pdf` e uma rota Node de referência em `/relatorios/pdf`. Também já
existem o limitador `assertPdfExportAllowed`, `VIEW_FINANCIAL`, headers `no-store`/`Content-Disposition`
e testes que extraem/validam PDF. Esses mecanismos devem ser reutilizados.

Os dados, porém, não estão prontos para um documento imutável:

- Financial relaciona a baixa ao `lancamento`, que possui paciente, descrição e atendimento;
- Tenancy já expõe nome, endereço e CNPJ opcional da clínica, mas não natureza PF/PJ nem razão social
  garantida;
- Patient possui nome/CPF e responsável financeiro, mas o seam `getPaymentIdentity` foi criado
  estritamente para identidade mínima de cobrança no Asaas. Não deve ser reutilizado silenciosamente
  como contrato documental;
- o Checkout hospedado coleta o pagador fora do Qoro, e o runtime atual não persiste essa identidade.
  Logo, nem paciente, responsável cadastrado ou titular do cartão podem ser presumidos como pagador.

Implementar a opção 2.1A em dois lotes revisáveis para respeitar o budget:

1. **2.1A.1 — contrato e snapshot:** no máximo Financial + Patient. Criar seam documental estreito do
   beneficiário, exigir confirmação explícita do pagador, persistir snapshot cifrado/minimizado e
   idempotente ligado à baixa. A camada de aplicação pode compor o perfil público já existente de
   Tenancy, sem importar internals nem alterar esse context.
2. **2.1A.2 — render e entrega:** Financial + app/lib. Renderizador puro, rota Node autenticada,
   `VIEW_FINANCIAL`, rate limit, auditoria, headers seguros, compensação visível e ação no Caixa.

Cada lote terá estimativa própria antes do código e deve permanecer em `≤25 arquivos`, `≤1500 linhas`
e `≤2 bounded contexts`. D72 deve ser publicado separadamente; não misturar o corretivo da Camada 1
com a migration ou o contrato público da Camada 2.

## Contrato mínimo da entrega recomendada

- fonte: um movimento positivo `payment_transactions.kind = 'payment'`, persistido pelo Financial
  como baixa após o recebimento; não existe nem será presumido um `status` da transação;
- identidade: `clinic_id` e `transaction_id` derivados da sessão/rota, nunca aceitos como autoridade
  cruzada do browser;
- conteúdo: identificação visível da clínica, paciente beneficiário, pagador explicitamente
  registrado, descrição não clínica do serviço, valor, forma e data do pagamento, identificador Qoro
  e aviso não fiscal;
- reversão: documento continua auditável e passa a exibir referência à compensação, sem apagar o
  histórico;
- acesso: dono e perfis com permissão financeira; acesso do paciente exige canal/autorização próprios
  e não nasce como link público;
- dados: snapshot cifrado/minimizado, retenção alinhada ao ledger e hard-delete bloqueado quando houver
  obrigação legal de guarda.

## Testes e gates antes de `Accepted`

- unitários de copy, arredondamento, parcela, pagador diferente do beneficiário e estorno;
- integração DB para snapshot, idempotência, concorrência, tenant A → B, RLS e ledger append-only;
- contrato do PDF com texto extraído, metadados seguros, nome de arquivo e ausência de ids/secrets;
- E2E autenticado de gerar/baixar/repetir e RBAC negativo;
- revisão visual do PDF em português, valores e quebra de página;
- confirmação jurídico-contábil da copy “não fiscal” e do caminho PF/PJ;
- lint, typecheck, suíte integral, build, arquitetura, banco, migrations, observabilidade e segurança.

## Alternativas rejeitadas

- chamar qualquer PDF gerado pelo Qoro de “recibo fiscal”: cria confiança indevida;
- usar o paciente automaticamente como pagador: falha para dependentes e terceiros;
- gerar um recibo por atendimento: a regra oficial opera por pagamento/parcela e o ledger registra
  cada baixa, que pode ser parcial;
- editar o documento antigo após estorno: destrói a trilha histórica;
- expor um link permanente sem autenticação: vaza dado financeiro e potencialmente dado de saúde;
- integrar NFS-e/Receita Saúde por scraping ou API não confirmada: instável e incompatível com o
  padrão de segurança do projeto. Para NFS-e de clínica PJ, a API confirmada e escolhida é a do Asaas;
  Receita Saúde PF permanece separado.
