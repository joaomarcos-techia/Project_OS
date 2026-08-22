import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const AUTH_ROUTES = ['(app)/login/page.tsx', '(app)/convite/page.tsx'];

describe('P-15 — fallbacks de autenticação', () => {
  it.each(AUTH_ROUTES)('%s não deixa a tela vazia durante o CSR bailout', (route) => {
    const source = readFileSync(resolve(process.cwd(), 'src/app', route), 'utf8');

    expect(source).toContain('<AuthScreenSkeleton');
    expect(source).not.toContain('fallback={null}');
  });

  it('usa a marca e os ícones canônicos nas superfícies de autenticação', () => {
    const login = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/page.tsx'), 'utf8');
    const mfa = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/mfa/page.tsx'), 'utf8');

    expect(login).toContain("import { Eye, EyeOff } from 'lucide-react'");
    expect(login).not.toContain('function EyeIcon');
    expect(mfa).toContain('<Logo');
    expect(mfa).not.toContain('Clinica<b');
  });

  it('expõe recuperação de senha pelo fluxo com grant, sem apontar direto para reset-password', () => {
    const login = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/page.tsx'), 'utf8');
    const recovery = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/login/forgot-password-form.tsx'),
      'utf8',
    );

    expect(login).toContain('<ForgotPasswordForm />');
    expect(recovery).toContain('Esqueci minha senha');
    expect(recovery).toContain('forgotPasswordAction');
    expect(recovery).not.toContain('href="/reset-password"');
  });

  it('orienta links expirados para a recuperação autônoma disponível no login', () => {
    const reset = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/reset-password/page.tsx'),
      'utf8',
    );
    const authError = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/auth/auth-error/page.tsx'),
      'utf8',
    );

    expect(reset).toContain('Volte ao login e solicite um novo link');
    expect(authError).toContain('Volte ao login para solicitar outro');
  });

  it('mantém orçamentos independentes entre pedir o link e efetivar a nova senha', () => {
    const requestAction = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/login/actions.ts'),
      'utf8',
    );
    const completionAction = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/reset-password/actions.ts'),
      'utf8',
    );

    expect(requestAction).toContain('assertPasswordResetAllowed');
    expect(completionAction).toContain('assertPasswordResetCompletionAllowed');
    expect(completionAction).not.toContain('assertPasswordResetAllowed(');
  });
});
