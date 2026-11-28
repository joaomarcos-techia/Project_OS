'use server';

import { historicalCoveragePort } from '@/contexts/health-insurance';
import { importAppointmentHistory } from '@/contexts/scheduling/actions';

export type ImportHistoryState = {
  error: string | null;
  message: string | null;
};

const MAX_JSON_BYTES = 1_000_000;

function value(fd: FormData, key: string): string {
  const raw = fd.get(key);
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function importAppointmentHistoryForm(
  _previous: ImportHistoryState,
  fd: FormData,
): Promise<ImportHistoryState> {
  const source = value(fd, 'source');
  const justification = value(fd, 'justification');
  const payload = value(fd, 'payload');
  const idempotencyKey = value(fd, 'idempotencyKey');
  if (!source || !justification || !payload || !idempotencyKey) {
    return { error: 'Preencha fonte, justificativa e arquivo JSON.', message: null };
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_JSON_BYTES) {
    return { error: 'O arquivo JSON deve ter no maximo 1 MB.', message: null };
  }

  let items: unknown;
  try {
    items = JSON.parse(payload);
  } catch {
    return { error: 'O arquivo não contém JSON válido.', message: null };
  }
  if (!Array.isArray(items)) {
    return { error: 'O JSON deve conter uma lista de atendimentos.', message: null };
  }

  try {
    // P4.7-b: o Convênios valida e grava as linhas de convênio histórico (nunca gera guia nem cobrança).
    const result = await importAppointmentHistory(
      { source, justification, items },
      idempotencyKey,
      {
        historicalCoverage: historicalCoveragePort,
      },
    );
    const convenio =
      result.historicalCoverages > 0
        ? ` ${result.historicalCoverages} de convênio, registrado(s) só como histórico (sem guia e sem cobrança).`
        : '';
    return {
      error: null,
      message: `Lote ${result.batchId}: ${result.importedAppointments} atendimento(s) importado(s).${convenio}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Falha ao importar o histórico.',
      message: null,
    };
  }
}
