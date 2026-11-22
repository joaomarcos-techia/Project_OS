import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Clock3, XCircle } from 'lucide-react';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Raiz (`/`) — retorno público do Checkout do paciente ou entrada pelo login.
 * O parâmetro de retorno não é prova de pagamento: só webhook/readback do Asaas
 * pode alterar a cobrança, a agenda e o financeiro.
 */
export const metadata: Metadata = {
  title: 'Acompanhamento do pagamento',
  robots: { index: false, follow: false },
};

type PaymentReturn = 'success' | 'cancelled' | 'expired';

const RETURN_CONTENT: Record<PaymentReturn, { title: string; description: string }> = {
  success: {
    title: 'Estamos verificando seu pagamento',
    description:
      'O Asaas ainda precisa confirmar a cobrança. Depois da confirmação, a agenda e o financeiro da clínica serão atualizados automaticamente.',
  },
  cancelled: {
    title: 'Pagamento ainda não confirmado',
    description:
      'O Checkout foi interrompido. Se você concluiu o pagamento, a clínica receberá a atualização quando o Asaas confirmar a cobrança.',
  },
  expired: {
    title: 'Prazo do Checkout encerrado',
    description:
      'Este link chegou ao fim do prazo. Se você concluiu o pagamento, a clínica receberá a atualização quando o Asaas confirmar a cobrança.',
  },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  if (payment !== 'success' && payment !== 'cancelled' && payment !== 'expired') {
    redirect('/login');
  }

  const content = RETURN_CONTENT[payment];
  const Icon = payment === 'success' ? Clock3 : XCircle;

  return (
    <main
      data-qoro-tokens="qorov2"
      className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-12 text-fg antialiased"
    >
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <Logo className="h-7 w-auto" />
        </div>
        <Card>
          <CardContent className="text-center">
            <Icon aria-hidden="true" className="mx-auto size-9 text-primary" />
            <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-widest text-fg-muted">
              Acompanhamento do pagamento
            </p>
            <h1 className="mt-3 text-balance font-display text-2xl font-semibold">
              {content.title}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">{content.description}</p>
            <div className="mt-6 rounded-lg border border-border bg-surface-2 px-4 py-3 text-left text-sm leading-relaxed text-fg-muted">
              Esta página não é um comprovante. Você pode voltar à conversa com a clínica; evite
              iniciar outro pagamento antes de conferir o status com ela.
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
