/**
 * Superfície pública dos DOWNLOADS de Convênios (P12.7), separada do `index.ts`: o PDF
 * da guia puxa o renderizador (@react-pdf), que não deve entrar em toda rota que usa o
 * contexto. Só as rotas de download importam daqui.
 */
import 'server-only';

export { AuthorizationReceiptUnavailableError, readAuthorizationReceipt } from './internal/authorizations';
export { GuideAccessError } from './internal/guide-access';
export { renderIssuedGuideAttendanceCopyPdf, renderIssuedGuidePdf, type IssuedGuidePdf } from './internal/guide-pdf';
export { findSadtRequestDocument, type SadtRequestDocumentLookup } from './internal/sadt-request-document';
export {
  readTissFile,
  TissFileIntegrityError,
  TissFileMissingError,
  type TissFilePurpose,
} from './internal/tiss-file-access';
export { GuidePrintError } from './tiss/print/print-data';
