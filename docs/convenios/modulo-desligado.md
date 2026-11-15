# Interruptor do módulo Convênios × operações (parecer e correção de 15/11/2026, noite)

**Pergunta do fundador:** conferir, aprovar e montar lote não olhavam o interruptor do módulo (`hi_clinic_settings.enabled`);
só a geração de guia olhava. Uma clínica com o módulo desligado podia continuar avançando trabalho TISS por chamada
direta ao servidor.

**Política já aprovada** (implementada aqui, não criada):
- ADR-072, item 10: ativação por flag em cada clínica, desligada por padrão;
- `bloqueio-comercial-trial.md`: "assinatura paga com o módulo desligado não opera Convênios". A flag se soma ao
  gate comercial D24, não o substitui;
- diretriz do fundador de 15/11: o módulo desligado não cria nem avança operação TISS por chamada direta, e o bloqueio
  não pode impedir de preservar obrigação já faturada.

**Não mudou:** a política global de habilitação. Quem liga o módulo, o interruptor de plataforma (P1.13) e o vínculo
com o plano ficam como estão.

## Diferenças que importam

| Situação | O que decide | Efeito em Convênios |
| --- | --- | --- |
| Trial (14 dias) | D24 (`qoro_premium_denial`) | conhecer o sistema; nenhuma operação real. A resposta é comercial ("contrate") |
| Assinatura parada ou clínica suspensa | D24 | operação nova barrada; preservação continua |
| Assinatura paga e ativa, **módulo desligado** | interruptor | operação nova barrada (a partir deste ciclo); preservação continua |
| Assinatura paga e ativa, módulo ligado | permissão do usuário | opera conforme o papel |
| Permissão do usuário | `requireCachedPermission`/`requireFreshPermission` | sempre se soma às anteriores |

## Classes de ação

| Classe | Ações | Guard antes | Guard agora |
| --- | --- | --- | --- |
| **A**: cria ou avança trabalho TISS | conferir guia; devolver para correção; ajustar dados da Consulta; aprovar e emitir (Consulta e SP/SADT); montar, exportar, pedir exportação e enviar lote; pedir autorização e registrar a resposta (Consulta, P6.1); solicitação SP/SADT (criar, conferir, indicação clínica, documento oficial); cobertura no check-in e correção de cobertura; confirmar coparticipação | D24 apenas | **D24 + módulo ligado** (`assertConveniosOperableTx`) |
| A, já coberta antes | gerar guia da Consulta; atualizar guia automática; execução SP/SADT (sessão → guia) | D24 + módulo (resultado `module_disabled`, que vira pendência) | sem mudança |
| **B**: consulta e histórico | telas; guia emitida, PDF, XML e arquivos (leitura auditada); histórico e revisões | permissão + leitura auditada | sem mudança. Desligar não apaga nem esconde o que existe (retenção) |
| **C**: preservação e encerramento | cancelar guia ainda não enviada; cancelar lote não enviado; protocolo, análise, retorno e demonstrativo do lote **já enviado**; glosas; recursos; pagamentos da operadora, alocação e estorno de alocação; conciliação; repasse do convênio; cancelar ou concluir solicitação SP/SADT; registrar autorização ou negativa da operadora para a SP/SADT | permissão (sem D24, por decisão de 11/11) | sem mudança. São fatos ou obrigações sobre trabalho já entregue; recusá-los perderia dado financeiro |

**Inconsistência anotada, sem mudança:** a resposta da operadora à autorização da **Consulta** (P6.1) é barrada como
operação nova, mas a da **SP/SADT** é preservação. Pela regra da D24 ("fatos da operadora sobre trabalho já
entregue"), as duas deveriam ser preservação. Decisão do fundador; a mais restritiva fica até lá.

## Impacto

- **Guias existentes:**
  - com o módulo desligado, nada é apagado, cancelado ou escondido;
  - guias em edição, conferidas ou aprovadas ficam paradas onde estão, e voltam a andar quando o módulo é religado;
  - o que já foi enviado continua recebendo protocolo, retorno, glosa, pagamento e recurso.
- **Financeiro:** nenhum valor muda. Nenhuma cobrança, recebível ou repasse é criado ou desfeito pelo interruptor.
  - A coparticipação ainda não confirmada espera.
  - Uma cobrança Asaas de coparticipação já confirmada segue o portão próprio (`patient_charges`), sem mudança.
- **Em segundo plano:**
  - a exportação de lote pedida antes de desligar termina como recusa definitiva (`module_disabled`), sem nova
    tentativa;
  - a troca de forma de atendimento na agenda deixa a cobertura pendente;
  - a cobertura no agendamento devolve a mensagem do módulo.

## Mensagem para o usuário

"Convênios está desligado nesta clínica. Para voltar a operar, a gestão liga o módulo em Convênios › Configuração; os
registros já feitos continuam disponíveis para consulta."

Sem dado interno do banco. No trial ou com a assinatura parada, aparece a mensagem comercial, que tem prioridade.

## Testes

- **Unitários:**
  - `internal/module-guard.test.ts`: ligado; desligado; sem configuração; comercial primeiro;
  - `actions.test.ts`: conferir e devolver recusados com o módulo desligado ou sem configuração, sem UPDATE e sem
    auditoria.
- **Banco descartável (job sintético do Actions):** `scripts/security/health-insurance-module-switch-db.ts`, 4 provas:
  - classe A recusada sem tocar em nada;
  - classe C continua;
  - trial com o módulo desligado responde a comercial;
  - religado, a mesma operação passa.
- **Telas:** a tela de Convênios com o módulo desligado já mostra "não habilitado" (E15). Nada novo na interface.

## O que fica para decisão

1. Confirmar a classe C como está (especialmente o repasse e o cancelamento de lote não enviado).
2. Resposta da operadora à autorização da Consulta: preservação, como a da SP/SADT?
3. Levar o interruptor também para os gatilhos do banco (hoje só o D24 está no banco). Isso exige migration nova e
   autorização.
