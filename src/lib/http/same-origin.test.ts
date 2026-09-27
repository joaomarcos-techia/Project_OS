import { describe, expect, it } from 'vitest';

import { isSameOriginMutationRequest } from './same-origin';

function request(url: string, origin?: string, secFetchSite: string = 'same-origin'): Request {
  const headers = new Headers({ 'sec-fetch-site': secFetchSite });
  if (origin !== undefined) headers.set('origin', origin);
  return new Request(url, { method: 'POST', headers });
}

describe('isSameOriginMutationRequest', () => {
  it.each([
    'https://app.qoro.dev',
    'https://project-os-git-preview.example.vercel.app',
    'https://alias-preview.example.com',
    'http://localhost:3000',
  ])('aceita a origem efetiva do deployment: %s', (origin) => {
    expect(isSameOriginMutationRequest(request(`${origin}/api/signup`, origin))).toBe(true);
  });

  it.each([
    ['origem ausente', undefined, 'same-origin'],
    ['origem divergente', 'https://evil.example', 'same-origin'],
    ['fetch cross-site', 'https://app.qoro.dev', 'cross-site'],
    ['origem com caminho', 'https://app.qoro.dev/path', 'same-origin'],
    ['origem inválida', 'null', 'same-origin'],
  ])('recusa %s', (_label, origin, secFetchSite) => {
    expect(
      isSameOriginMutationRequest(request('https://app.qoro.dev/api/signup', origin, secFetchSite)),
    ).toBe(false);
  });
});
