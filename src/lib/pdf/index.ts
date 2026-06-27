/**
 * Engine de PDF (C7). Funções PURAS: input tipado → Buffer. Sem DB, sem upload,
 * sem efeito (§7.7). Server-side via @react-pdf/renderer (renderToBuffer).
 */
export { renderPrescriptionPDF } from './prescription';
export { renderReceituarioControleEspecialPDF } from './receituario-controle-especial';
export { renderAtestadoPDF } from './atestado';
export { renderDeclaracaoPDF } from './declaracao';
export { renderExamePDF } from './exame';
export { renderEncaminhamentoPDF } from './encaminhamento';
export { quantityToWords, integerToWords } from './quantity-to-words';

export type {
  PdfBranding,
  PdfDoctor,
  PdfMedicamento,
  PrescriptionPdfData,
  ReceituarioControleEspecialPdfData,
  AtestadoPdfData,
  DeclaracaoPdfData,
  ExamePdfData,
  EncaminhamentoPdfData,
} from './types';
