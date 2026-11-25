/**
 * P6.4 — `ManualAdapter`: o caminho padrão e completo. Para cada operação, diz o que a clínica faz
 * no portal da operadora (ou no papel) e onde registra o resultado no Qoro. Nunca devolve
 * "enviado"/"autorizado": quem muda o estado é o registro humano naquela tela, com as validações
 * de lá (protocolo, número, senha, validade, comprovante).
 */
import type {
  ManualReason,
  ManualRecordTarget,
  OperatorConnector,
  OperatorOperation,
  OperatorOutcome,
  OperatorRequest,
} from './operator-connector';

const at = (base: string, id: string | undefined): string => (id ? `${base}/${id}` : base);

/** Passos e destino de registro por operação (telas e textos que existem hoje no #55). */
export function manualInstructions(
  operation: OperatorOperation,
  subjectId?: string,
): { steps: readonly string[]; recordIn: ManualRecordTarget } {
  switch (operation) {
    case 'submit_batch':
      return {
        steps: [
          'Baixe o XML do lote no Qoro (já validado no padrão TISS).',
          'Envie o arquivo no portal da operadora.',
          'Anote o protocolo e a data que a operadora informar.',
        ],
        recordIn: { path: at('/convenios/lotes', subjectId), action: 'Marcar como enviado' },
      };
    case 'request_authorization':
      return {
        steps: [
          'Gere o documento oficial da solicitação no Qoro.',
          'Peça a autorização no portal, por telefone ou no papel, como a operadora exigir.',
          'Com a resposta, registre o número da guia na operadora, a senha e a validade (ou a negativa).',
        ],
        recordIn: { path: at('/convenios/solicitacoes', subjectId), action: 'Resposta da operadora' },
      };
    case 'authorization_status':
      return {
        steps: [
          'Consulte a situação do pedido no portal ou na central da operadora.',
          'Se já houver resposta, registre-a no Qoro; se não, nada muda.',
        ],
        recordIn: { path: at('/convenios/solicitacoes', subjectId), action: 'Resposta da operadora' },
      };
    case 'eligibility':
      return {
        steps: [
          'Confira no portal da operadora se a carteirinha está ativa para a data do atendimento.',
          'Se estiver vencida ou inativa, atualize a carteirinha do paciente no Qoro.',
        ],
        recordIn: { path: '/convenios/carteirinhas', action: 'Carteirinhas' },
      };
    case 'protocol_status':
      return {
        steps: [
          'Consulte o protocolo do lote no portal da operadora.',
          'Quando a operadora começar a análise, registre no lote.',
        ],
        recordIn: {
          path: at('/convenios/lotes', subjectId),
          action: 'Operadora iniciou a análise',
        },
      };
    case 'statement':
      return {
        steps: [
          'Baixe o demonstrativo (análise de conta ou pagamento) em XML no portal da operadora.',
          'Importe o arquivo no Qoro: ele concilia por guia e item, sem aplicar valor "por aproximação".',
        ],
        recordIn: {
          path: '/convenios/conciliacao',
          action: 'Importar demonstrativo da operadora',
        },
      };
    case 'submit_appeal':
      return {
        steps: [
          'Gere o XML do recurso de glosa no Qoro (validado no padrão TISS).',
          'Envie o recurso no portal da operadora e anote o protocolo.',
          'Registre o envio do recurso na guia.',
        ],
        recordIn: {
          path: at('/convenios/guias', subjectId),
          action: 'Gerar XML do recurso (TISS)',
        },
      };
  }
}

export function manualOutcome(request: OperatorRequest, reason: ManualReason): OperatorOutcome {
  const { steps, recordIn } = manualInstructions(request.operation, request.subjectId);
  return { kind: 'manual', operation: request.operation, reason, steps, recordIn };
}

/** O adaptador padrão. `reason` explica à tela por que o caminho é manual. */
export function createManualAdapter(reason: ManualReason = 'not_homologated'): OperatorConnector {
  return {
    id: 'manual',
    perform: async (request) => manualOutcome(request, reason),
  };
}
