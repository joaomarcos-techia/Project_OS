/**
 * Erros de domínio do Payments.
 *
 * Existem para a UI distinguir DOIS casos que o operador vive de formas opostas:
 * "sua chave está errada" (ação dele) e "não consegui falar com o Asaas agora"
 * (ação de ninguém, tentar de novo). Tratar os dois como "erro ao salvar" levaria
 * o operador a trocar uma chave que estava certa.
 *
 * Nenhuma mensagem daqui carrega a chave, o corpo do provedor ou stack.
 */
export class PaymentCredentialRejectedError extends Error {
  readonly code = 'payment_credential_rejected';
  /** Códigos estáveis do Asaas já sanitizados pelo adapter (nunca o corpo bruto). */
  readonly providerErrorCodes: readonly string[];
  constructor(providerErrorCodes: readonly string[] = []) {
    super(
      providerErrorCodes.includes('invalid_environment')
        ? 'Esta chave é de outro ambiente do Asaas (Sandbox ou produção). Use uma chave do mesmo ambiente desta instalação da Qoro.'
        : 'O Asaas não aceitou essa chave. Confira se copiou a chave inteira da conta certa.',
    );
    this.name = 'PaymentCredentialRejectedError';
    this.providerErrorCodes = providerErrorCodes;
  }
}

export class PaymentProviderUnavailableError extends Error {
  readonly code = 'payment_provider_unavailable';
  constructor() {
    super('Não deu para confirmar a chave com o Asaas agora. Tente de novo em instantes.');
    this.name = 'PaymentProviderUnavailableError';
  }
}

export class PaymentValidationError extends Error {
  readonly code = 'payment_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}
