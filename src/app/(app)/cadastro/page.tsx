import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/shared/logo';
import { env } from '@/lib/env';

import { SignupQuestions } from './signup-questions';

export const dynamic = 'force-dynamic';

/**
 * Entrada do cadastro autônomo.
 *
 * O portão é do §21.20 e existe por um motivo medido, não por precaução: o funil
 * ainda NÃO tem saída. Ele termina em "Plano salvo — nenhuma cobrança foi
 * iniciada" porque O-5 (billing), O-6 (provisionamento) e O-7 (onboarding) não
 * existem. Sem este portão, publicar o link "Cadastre-se" do login entrega a um
 * visitante quatro perguntas, uma conta verificada e um beco sem saída — além de
 * uma linha em `signup_sessions` por visita.
 *
 * Duas condições, com significados diferentes:
 *   - `SIGNUP_ENABLED`: parada de emergência da operação (default LIGADO);
 *   - `SIGNUP_IDENTITY_ENABLED`: o funil só continua onde a identidade existe
 *     (default DESLIGADO). É o que mantém produção fechada sem depender de
 *     alguém lembrar de configurar nada.
 *
 * A tela fechada NÃO monta `<SignupQuestions>`, então nada é criado no banco:
 * quem fecha o funil também fecha a escrita que ele provocaria.
 */
export default function CadastroPage() {
  const open = env.SIGNUP_ENABLED && env.SIGNUP_IDENTITY_ENABLED;

  return (
    <main data-qoro-tokens="qorov2" className="min-h-screen bg-surface text-fg antialiased">
      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-5 py-6 sm:px-8">
        <Logo className="h-auto w-[78px]" />
        <span className="font-mono text-xs font-medium text-fg-subtle">Cadastro seguro</span>
      </header>
      {open ? <SignupQuestions identityEnabled={env.SIGNUP_IDENTITY_ENABLED} /> : <SignupClosed />}
    </main>
  );
}

/**
 * Sem detalhe de configuração na tela: para quem chega, o fato útil é que não dá
 * para criar conta agora e que o login continua funcionando. Qual portão está
 * fechado é assunto da operação, não do visitante.
 */
function SignupClosed() {
  return (
    <div className="mx-auto flex w-full max-w-[520px] px-5 pb-16 pt-6 sm:px-8">
      <Card className="w-full">
        <CardContent>
          <h1 className="text-balance font-display text-2xl font-semibold">
            Cadastro indisponível no momento
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            A criação de novas contas está temporariamente fechada. Nenhum dado foi registrado nesta
            visita.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Se a sua clínica já usa a Qoro, o acesso continua normal pelo login.
          </p>
          <a href="/login" className={`${buttonVariants({ variant: 'primary' })} mt-6`}>
            Ir para o login
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
