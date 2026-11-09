import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Logo } from '@/components/shared/logo';
import { PublicPage, signupFrame } from '@/components/shared/signup-frame';
import { cn } from '@/lib/ui/cn';

import styles from './login-frame.module.css';

export { styles as loginFrame };

const MARKETING_SITE = 'https://qoro.dev';

/** Tela dividida do login: formulário à esquerda e painel azul à direita. */
export function LoginFrame({
  showSignup = false,
  children,
}: {
  showSignup?: boolean;
  children: ReactNode;
}) {
  return (
    <PublicPage>
      <div className={styles.split}>
        <div className={styles.side}>
          <header className={styles.top}>
            <a
              className={signupFrame.logoLink}
              href={`${MARKETING_SITE}/`}
              aria-label="Qoro, página inicial"
            >
              <Logo className={cn(signupFrame.logo, 'text-current dark:text-current')} />
            </a>
            {showSignup ? (
              <p className={signupFrame.headAside}>
                <span className={signupFrame.headAsidePrefix}>Ainda não tem conta?</span>
                <Link href="/cadastro">Criar conta</Link>
              </p>
            ) : null}
          </header>
          <div className={styles.mid}>{children}</div>
          <footer className={styles.foot}>
            <span>© {new Date().getFullYear()} Qoro</span>
            <a href={`${MARKETING_SITE}/termos-de-uso`}>Termos de Uso</a>
            <a href={`${MARKETING_SITE}/politica-de-privacidade`}>Política de Privacidade</a>
          </footer>
        </div>
        <LoginArt />
      </div>
    </PublicPage>
  );
}

export function LoginIntro({ title, lead }: { title: ReactNode; lead: ReactNode }) {
  return (
    <div className={styles.intro}>
      <h1 className={signupFrame.title}>{title}</h1>
      <p className={signupFrame.lead}>{lead}</p>
    </div>
  );
}

function Star() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 2.5l2 6.2 6.5 1.3-6.5 1.3-2 6.2-2-6.2-6.5-1.3 6.5-1.3z" />
    </svg>
  );
}

function Typing({ className }: { className: string | undefined }) {
  return (
    <span className={cn(styles.typing, styles.loop, className)}>
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}

/** A conversa é ilustrativa: fica fora da árvore de leitura, resumida em uma frase. */
function LoginArt() {
  return (
    <aside className={styles.art} aria-label="Sobre a Qoro">
      <span className={cn(styles.ring, styles.ringOuter)} aria-hidden="true" />
      <span className={cn(styles.ring, styles.ringInner)} aria-hidden="true" />
      <div className={styles.artCopy}>
        <p className={cn(styles.artTitle, styles.in)}>
          Enquanto você atende, a Qoro cuida do WhatsApp.
        </p>
        <p className={cn(styles.artLead, styles.in, styles.delay2, styles.short)}>
          O agente de IA agenda, confirma e remarca consultas. Quando o paciente pede para falar com
          alguém, a conversa vai para a sua equipe.
        </p>
        <p className={cn(styles.artBadge, styles.in, styles.delay3, styles.short)}>
          <ShieldCheck aria-hidden="true" />
          Integração oficial do WhatsApp · parceira de tecnologia da Meta
        </p>
      </div>
      <div
        className={styles.stage}
        role="img"
        aria-label="Exemplo ilustrativo: uma paciente pergunta pelo WhatsApp se há horário na sexta de manhã, o agente de IA oferece dois horários e agenda a consulta."
      >
        <div className={styles.chat}>
          <div className={styles.chatHead}>
            <span className={styles.avatar}>JF</span>
            <span className={styles.chatWho}>
              <b className={styles.chatName}>Juliana Freitas</b>
              <span className={styles.chatSub}>Conversa de exemplo · WhatsApp</span>
            </span>
            <span className={styles.chatState}>
              <span className={cn(styles.pill, styles.pillAgent, styles.loop, styles.pa)}>
                <span className={styles.live} />
                Agente respondendo
              </span>
              <span className={cn(styles.pill, styles.pillDone, styles.loop, styles.pb)}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Consulta agendada
              </span>
            </span>
          </div>
          <div className={styles.messages}>
            <p className={cn(styles.received, styles.loop, styles.m1)}>
              Oi! Tem horário na sexta de manhã?
            </p>
            <div className={styles.reply}>
              <Typing className={styles.t1} />
              <span className={cn(styles.agentTag, styles.loop, styles.m2)}>
                <Star />
                Agente de IA
              </span>
              <p className={cn(styles.sent, styles.loop, styles.m2)}>
                Tenho 08:30 e 09:00 na sexta, 13/11. Qual fica melhor para você?
              </p>
            </div>
            <p className={cn(styles.received, styles.loop, styles.m3)}>Pode ser às 09:00.</p>
            <div className={styles.reply}>
              <Typing className={styles.t2} />
              <span className={cn(styles.agentTag, styles.loop, styles.m4)}>
                <Star />
                Agente de IA
              </span>
              <p className={cn(styles.sent, styles.loop, styles.m4)}>
                Pronto, Juliana! Sua consulta com a Dra. Ana Costa ficou para sexta, 13/11, às
                09:00. Vou te lembrar na véspera.
              </p>
            </div>
            <div className={cn(styles.booked, styles.loop, styles.cd)}>
              <span className={styles.bookedIcon}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span className={styles.bookedText}>
                <b className={styles.bookedTitle}>Consulta agendada</b>
                <span className={styles.bookedSub}>Juliana Freitas · sex, 13/11 · 09:00</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
