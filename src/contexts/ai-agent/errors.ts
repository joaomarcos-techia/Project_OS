/**
 * Erros de domínio do painel de conversas (ADR-047).
 *
 * Classes com `name` próprio porque a camada de app discrimina por `err.name`,
 * nunca por parsing da mensagem (idiom de financeiro/action-result.ts). A
 * mensagem pode mudar sem quebrar o mapeamento da UI.
 */

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversa não encontrada.');
    this.name = 'ConversationNotFoundError';
  }
}

/**
 * Envio manual exige status='handoff'. Não é burocracia: em 'active' o agente
 * ainda responde ao próximo inbound e humano + IA responderiam o mesmo paciente
 * em paralelo.
 */
export class ConversationNotInHandoffError extends Error {
  constructor(public readonly status: string) {
    super('A conversa precisa estar assumida por um humano para receber resposta manual.');
    this.name = 'ConversationNotInHandoffError';
  }
}

/** Transição de status inválida (ex.: devolver ao agente algo que não está em handoff). */
export class InvalidConversationTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Transição inválida: ${from} → ${to}.`);
    this.name = 'InvalidConversationTransitionError';
  }
}

/** Fora da janela de 24h da Meta — texto livre seria rejeitado pelo provider. */
export class MetaWindowClosedError extends Error {
  constructor() {
    super(
      'A janela de 24h da Meta expirou: só é possível enviar texto livre até 24h após a última mensagem do paciente.',
    );
    this.name = 'MetaWindowClosedError';
  }
}

/**
 * Devolver ao agente esbarrou na unique parcial de conversa ativa por contato:
 * já existe outra conversa ATIVA com o mesmo telefone. Duas ativas para um
 * telefone tornariam `findOrCreateConversation` ambíguo no próximo inbound.
 */
export class ActiveConversationConflictError extends Error {
  constructor(public readonly conversationId: string) {
    super('Já existe outra conversa ativa com este contato. Encerre-a antes de devolver esta ao agente.');
    this.name = 'ActiveConversationConflictError';
  }
}

export class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationValidationError';
  }
}

export class ConversationAssignmentRequiredError extends Error {
  constructor() {
    super('Assuma formalmente a conversa antes de responder ou devolvê-la ao agente.');
    this.name = 'ConversationAssignmentRequiredError';
  }
}

export class ManualMessageNotRetryableError extends Error {
  constructor() {
    super('Somente mensagens manuais com falha confirmada podem ser reenviadas.');
    this.name = 'ManualMessageNotRetryableError';
  }
}
