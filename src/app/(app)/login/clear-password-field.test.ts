// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPasswordField, clearPasswordFieldAfterSubmit } from './clear-password-field';

afterEach(() => {
  vi.useRealTimers();
});

describe('clearPasswordField', () => {
  it('remove a senha do DOM depois de uma tentativa rejeitada', () => {
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.name = 'password';
    password.type = 'password';
    password.value = 'credencial-sintetica';
    form.append(password);

    clearPasswordField(form);

    expect(password.value).toBe('');
  });

  it('tolera formulário ausente ou sem campo de senha', () => {
    expect(() => clearPasswordField(null)).not.toThrow();
    expect(() => clearPasswordField(document.createElement('form'))).not.toThrow();
  });

  it('limpa depois que o submit teve tempo de capturar o FormData', () => {
    vi.useFakeTimers();
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.name = 'password';
    password.type = 'password';
    password.value = 'credencial-sintetica';
    form.append(password);

    clearPasswordFieldAfterSubmit(form);

    expect(password.value).toBe('credencial-sintetica');
    vi.runAllTimers();
    expect(password.value).toBe('');
  });
});
