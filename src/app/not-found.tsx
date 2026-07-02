import { Compass } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <EmptyState
        icon={<Compass />}
        title="Página não encontrada"
        description="O endereço não existe ou foi movido."
        action={
          <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
            Voltar ao início
          </Link>
        }
      />
    </main>
  );
}
