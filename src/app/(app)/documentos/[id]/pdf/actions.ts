'use server';

import { redirect } from 'next/navigation';

import { regenerateDocumentPdf } from '@/contexts/clinical/actions';

export type FormState = { error: string | null };

export async function regenerateDocumentPdfForm(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const id = typeof fd.get('id') === 'string' ? (fd.get('id') as string) : '';
  if (!id) return { error: 'id ausente.' };
  try {
    await regenerateDocumentPdf(id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao gerar PDF.' };
  }
  redirect(`/documentos/${id}/pdf`);
}
