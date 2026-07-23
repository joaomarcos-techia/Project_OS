/**
 * Tela de erro dos fluxos de link de e-mail (`/auth/confirm` redireciona pra cá
 * quando o token falha). Matriz de motivos do plano.
 */
import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, { title: string; body: string }> = {
  missing_token: {
    title: 'Link inválido',
    body: 'Este link está incompleto. Peça um novo ao administrador da clínica.',
  },
  invalid_type: {
    title: 'Link inválido',
    body: 'Não reconhecemos este link. Peça um novo ao administrador da clínica.',
  },
  invalid_token: {
    title: 'Link inválido ou já utilizado',
    body: 'Este link não é mais válido. Peça um novo ao administrador da clínica.',
  },
  expired: {
    title: 'Link expirado',
    body: 'Este link expirou. Peça um novo ao administrador da clínica.',
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
