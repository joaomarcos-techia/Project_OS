import type { Metadata } from 'next';
/**
 * Tela de erro dos fluxos de link de e-mail (`/auth/confirm` redireciona pra cá
 * quando o token falha). Matriz de motivos do plano.
 */
import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Link inválido' };

export const dynamic = 'force-dynamic';

const REASONS: Record<string, { title: string; body: string }> = {
  missing_token: {
    title: 'Link inválido',
    body: 'Este link está incompleto. Volte ao login para solicitar outro ou, se for um convite, contate o administrador.',
  },
  invalid_type: {
    title: 'Link inválido',
    body: 'Não reconhecemos este link. Volte ao login para solicitar outro ou, se for um convite, contate o administrador.',
  },
  invalid_token: {
    title: 'Link inválido ou já utilizado',
    body: 'Este link não é mais válido. Volte ao login para solicitar outro ou, se for um convite, contate o administrador.',
  },
  expired: {
    title: 'Link expirado',
    body: 'Este link expirou. Volte ao login para solicitar outro ou, se for um convite, contate o administrador.',
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const info = REASONS[reason ?? ''] ?? REASONS.invalid_token!;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      {/* UX-017: a página não tinha h1; o título visível continua no Alert. */}
      <h1 className="sr-only">{info.title}</h1>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-7 w-auto" />
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Alert variant="danger" title={info.title}>
              {info.body}
            </Alert>
            <a href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Voltar para o login
            </a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
