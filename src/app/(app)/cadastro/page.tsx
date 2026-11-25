import type { Metadata } from 'next';
import {
  PublicBlock,
  PublicHeading,
  PublicPage,
  SignupStage,
  signupFrame,
} from '@/components/shared/signup-frame';
import { buttonVariants } from '@/components/ui/button';
import { env } from '@/lib/env';

import { SignupQuestions } from './signup-questions';

export const metadata: Metadata = { title: 'Criar conta' };

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
    <PublicPage>
      {open ? <SignupQuestions identityEnabled={env.SIGNUP_IDENTITY_ENABLED} /> : <SignupClosed />}
    </PublicPage>
  );
}

/**
 * Sem detalhe de configuração na tela: para quem chega, o fato útil é que não dá
 * para criar conta agora e que o login continua funcionando. Qual portão está
 * fechado é assunto da operação, não do visitante.
 */
function SignupClosed() {
  return (
    <SignupStage>
      <PublicHeading title="Cadastro indisponível no momento" />
      <PublicBlock narrow>
        <p className={signupFrame.text}>
          A criação de novas contas está temporariamente fechada. Nenhum dado foi registrado nesta
          visita.
        </p>
        <p className={signupFrame.text}>
          Se a sua clínica já usa a Qoro, o acesso continua normal pelo login.
        </p>
        <a
          href="/login"
          className={buttonVariants({ variant: 'primary', className: signupFrame.buttonFull })}
        >
          Ir para o login
        </a>
      </PublicBlock>
    </SignupStage>
  );
}
