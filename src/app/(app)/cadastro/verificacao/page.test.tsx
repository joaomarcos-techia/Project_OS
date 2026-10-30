import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { SIGNUP_ENABLED: false },
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('./signup-protection-check', () => ({
  SignupProtectionCheck: () => <form data-testid="protection-check" />,
}));

import Page, { metadata } from './page';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-10-30T22:00:00Z');
  mocks.env.SIGNUP_ENABLED = false;
});
afterEach(() => vi.useRealTimers());

describe('release verification page', () => {
  it('explains what is tested and does not mount signup', () => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('data-testid="protection-check"');
    expect(html).toContain('O cadastro permanece fechado');
    expect(html).not.toContain('signup-questions');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('is absent after reopening', () => {
    mocks.env.SIGNUP_ENABLED = true;
    expect(() => Page()).toThrow('not-found');
  });
  it('is absent at the deadline even if signup remains closed', () => {
    vi.setSystemTime('2026-11-02T03:00:00Z');
    expect(() => Page()).toThrow('not-found');
  });
});
