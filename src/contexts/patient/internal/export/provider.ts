/**
 * PatientExportProvider — extension seam for LGPD exports (ADR-012).
 *
 * Freezes "the export contains only data existing at request time". C5
 * registers the `patient` core collector (cadastral + consents + addresses +
 * contacts + clinical). Future contexts add their own sections WITHOUT C5
 * importing them:
 *
 *   // src/contexts/scheduling/internal/export.ts  (C6)
 *   registerExportCollector('appointments', (tx, clinicId, patientId) => ...);
 *
 * Collectors receive the worker tx so they read within the same RLS-scoped
 * transaction as the export handler. They must NOT decrypt other contexts'
 * data through patient internals — each owns its decryption.
 */
import type { Tx } from '@/lib/db';

import { collectExportBundle } from '../../queries';

export type ExportCollector = (tx: Tx, clinicId: string, patientId: string) => Promise<unknown>;

const collectors = new Map<string, ExportCollector>();

export function registerExportCollector(key: string, fn: ExportCollector): void {
  collectors.set(key, fn);
}

export function getExportCollectors(): ReadonlyMap<string, ExportCollector> {
  return collectors;
}

// C5 core section.
registerExportCollector('patient', (tx, clinicId, patientId) =>
  collectExportBundle(tx, clinicId, patientId),
);
