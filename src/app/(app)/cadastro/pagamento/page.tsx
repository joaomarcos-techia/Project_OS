import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';

import { PaymentReturn } from './payment-return';

export const dynamic = 'force-dynamic';

type Result = 'success' | 'pending' | 'cancelled' | 'expired';

export default async function SignupPaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>;
}) {
  const { resultado } = await searchParams;
  if (
    resultado !== 'success' &&
    resultado !== 'pending' &&
    resultado !== 'cancelled' &&
    resultado !== 'expired'
  ) {
    redirect('/cadastro/plano');
  }

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
          <CardContent>
            <PaymentReturn result={resultado as Result} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
