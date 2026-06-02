/** Clinical context domain errors. `code` + `httpStatus` para o caller/UI mapear. */

export class ClinicalValidationError extends Error {
  readonly code = 'clinical_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ClinicalValidationError';
  }
}

export class ProntuarioNotFoundError extends Error {
  readonly code = 'prontuario_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`prontuário não encontrado: ${id}`);
    this.name = 'ProntuarioNotFoundError';
  }
}

export class PrescriptionNotFoundError extends Error {
  readonly code = 'prescription_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`prescrição não encontrada: ${id}`);
    this.name = 'PrescriptionNotFoundError';
  }
}

export class MedicalDocumentNotFoundError extends Error {
  readonly code = 'medical_document_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`documento não encontrado: ${id}`);
    this.name = 'MedicalDocumentNotFoundError';
  }
}

/** Tentativa de alterar prontuário assinado fora de editSignedProntuario (Regra 3). */
export class ProntuarioImutavelError extends Error {
  readonly code = 'prontuario_imutavel';
  readonly httpStatus = 409;
  constructor(message = 'Prontuário assinado é imutável.') {
    super(message);
    this.name = 'ProntuarioImutavelError';
  }
}

/** Conflito de auto-save (rowVersion stale — outra aba/dispositivo gravou antes). */
export class ProntuarioConflitoError extends Error {
  readonly code = 'prontuario_conflito';
  readonly httpStatus = 409;
  constructor(message = 'Este prontuário foi alterado em outra janela. Recarregue para ver a versão atual.') {
    super(message);
    this.name = 'ProntuarioConflitoError';
  }
}
