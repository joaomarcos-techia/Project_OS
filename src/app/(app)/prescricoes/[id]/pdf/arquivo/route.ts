import { serveClinicalPdf } from '../../../../_lib/clinical-pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return serveClinicalPdf(request, id, 'prescription');
}
