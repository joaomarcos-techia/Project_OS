import { cva } from 'class-variance-authority';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Logo } from '@/components/shared/logo';
import { cn } from '@/lib/ui/cn';

import styles from './signup-frame.module.css';

export { styles as signupFrame };

export type SignupStep = 1 | 2 | 3;

/**
 * O canvas chama a etapa 1 de "Como conheceu". Aqui ela reúne quatro perguntas
 * sobre a clínica, e só a última é sobre a origem.
 */
const STEP_LABELS = ['Perfil', 'Clínica', 'Pagamento'] as const;

const MARKETING_SITE = 'https://qoro.dev/';

/** Página pública: traz os tokens do app e as medidas de campo e botão do canvas. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <main data-slot="public-page" data-qoro-tokens="app-v5" className={styles.page}>
      {children}
    </main>
  );
}

/**
 * "Entrar" é opcional de propósito: depois que a conta existe, ou com o cadastro
 * expirado, o fluxo não pode oferecer um login que abriria outra sessão.
 */
export function PublicHeader({
  step,
  showLogin = false,
}: {
  step?: SignupStep;
  showLogin?: boolean;
}) {
  return (
    <>
      <header className={styles.head}>
        <a className={styles.logoLink} href={MARKETING_SITE} aria-label="Qoro, página inicial">
          <Logo className={cn(styles.logo, 'text-current dark:text-current')} />
        </a>
        {step ? <SignupSteps step={step} /> : <span aria-hidden="true" />}
        {showLogin ? (
          <p className={styles.headAside}>
            <span className={styles.headAsidePrefix}>Já tem conta?</span>
            <a href="/login">Entrar</a>
          </p>
        ) : null}
      </header>
      {step ? (
        <div className={styles.mobileProgress}>
          <span className={styles.mobileProgressText}>
            <span>Etapa {step} de 3</span>
            <span>{STEP_LABELS[step - 1]}</span>
          </span>
          <span className={styles.mobileBar} aria-hidden="true">
            <span style={{ width: `${Math.round((step * 100) / 3)}%` }} />
          </span>
        </div>
      ) : null}
    </>
  );
}

function SignupSteps({ step }: { step: SignupStep }) {
  return (
    <ol className={styles.steps} aria-label="Etapas do cadastro">
      {STEP_LABELS.map((label, index) => {
        const number = index + 1;
        const done = step > number;
        const current = step === number;
        return (
          <li
            key={label}
            className={cn(styles.step, done && styles.stepDone)}
            aria-current={current ? 'step' : undefined}
          >
            <span className={styles.stepNumber}>
              {done ? <Check aria-hidden="true" /> : number}
            </span>
            <span className={styles.stepLabel}>{label}</span>
            {done ? <span className="sr-only">, concluída</span> : null}
            {current ? <span className="sr-only">, etapa atual</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Topo com as etapas e a área central de conteúdo de uma tela do cadastro. */
export function SignupStage({
  step,
  showLogin = false,
  children,
}: {
  step?: SignupStep;
  showLogin?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <PublicHeader showLogin={showLogin} {...(step ? { step } : {})} />
      <div className={styles.wrap}>{children}</div>
    </>
  );
}

export function PublicHeading({
  id,
  eyebrow,
  title,
  lead,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <div data-slot="public-heading" className={cn(styles.heading, className)} {...props}>
      {eyebrow ? <p className={cn(styles.eyebrow, 'm-0')}>{eyebrow}</p> : null}
      <h1 id={id} className={cn(styles.title, 'text-balance')}>
        {title}
      </h1>
      {lead ? <div className={cn(styles.lead, 'text-pretty')}>{lead}</div> : null}
    </div>
  );
}

const publicBlock = cva(styles.block, {
  variants: { narrow: { true: styles.blockNarrow, false: '' } },
  defaultVariants: { narrow: false },
});

/** Bloco cinza arredondado que recebe o conteúdo principal da etapa. */
export function PublicBlock({
  narrow = false,
  className,
  ...props
}: ComponentProps<'div'> & { narrow?: boolean }) {
  return (
    <div data-slot="public-block" className={cn(publicBlock({ narrow }), className)} {...props} />
  );
}
