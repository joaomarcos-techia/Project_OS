import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('P-15 — fallbacks de autenticação', () => {
  it('login mantém fallback no CSR e convite server-side usa loading.tsx', () => {
    const login = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/page.tsx'), 'utf8');
    const convite = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/convite/loading.tsx'),
      'utf8',
    );
    expect(login).toContain('<AuthScreenSkeleton');
    expect(login).not.toContain('fallback={null}');
    expect(convite).toContain('<AuthScreenSkeleton variant="invite" />');
  });

  it('usa a marca e os ícones canônicos nas superfícies de autenticação', () => {
    const login = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/page.tsx'), 'utf8');
    const mfa = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/mfa/page.tsx'), 'utf8');

    // Regex e nao string exata: o que importa e que Eye/EyeOff venham do
    // lucide, nao que sejam os unicos icones da lista de import.
    expect(login).toMatch(/import \{[^}]*\bEye\b[^}]*\bEyeOff\b[^}]*\} from 'lucide-react'/u);
    expect(login).not.toContain('function EyeIcon');
    const frame = readFileSync(
      resolve(process.cwd(), 'src/components/shared/login-frame.tsx'),
      'utf8',
    );
    expect(mfa).toContain('<LoginFrame');
    expect(frame).toContain('<Logo');
    expect(mfa).not.toContain('Clinica<b');
  });

  it('expõe recuperação de senha pelo fluxo com grant, sem apontar direto para reset-password', () => {
    const login = readFileSync(resolve(process.cwd(), 'src/app/(app)/login/page.tsx'), 'utf8');
    const recovery = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/login/forgot-password-form.tsx'),
      'utf8',
    );

    expect(login).toContain('<ForgotPasswordForm');
    expect(login).toContain('Esqueci a senha');
    expect(recovery).toContain('forgotPasswordAction');
    expect(recovery).not.toContain('href="/reset-password"');
  });

  it('liga o convite de cadastro do login ao início do fluxo autônomo', () => {
    const frame = readFileSync(
      resolve(process.cwd(), 'src/components/shared/login-frame.tsx'),
      'utf8',
    );

    expect(frame).toMatch(/href="\/cadastro"[\s\S]*Criar conta/u);
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
