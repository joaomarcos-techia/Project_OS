import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PublicPage, SignupStage } from '@/components/shared/signup-frame';

import { PaymentReturn } from './payment-return';

export const metadata: Metadata = { title: 'Pagamento' };

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
    <PublicPage>
      <SignupStage step={3}>
        <PaymentReturn result={resultado as Result} />
      </SignupStage>
    </PublicPage>
  );
}
