import { createHash } from 'node:crypto';

/** Conteúdo inline imutável da ponte. O hash permite uma CSP sem `unsafe-inline`. */
export const AUTH_CONFIRM_BRIDGE_STYLE =
  'html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#eef3f4;color:#202b2d;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.card{max-width:28rem;margin:1rem;padding:2rem;border:1px solid #d9dfe2;border-radius:14px;background:#fff;text-align:center}.dot{display:inline-block;width:.65rem;height:.65rem;margin-right:.55rem;border-radius:50%;background:#00737e;animation:pulse 1.1s ease-in-out infinite alternate}@keyframes pulse{to{opacity:.28}}';

export const AUTH_CONFIRM_BRIDGE_SCRIPT = `(() => {
    'use strict';
    const hadFragment = window.location.hash.length > 1;
    const hadQuery = window.location.search.length > 1;
    const source = hadFragment ? window.location.hash.slice(1) : window.location.search.slice(1);
    window.history.replaceState(null, '', '/auth/confirm');

    const fail = (reason) => {
      window.location.replace('/auth/auth-error?reason=' + encodeURIComponent(reason));
    };
    if (!source) return fail('missing_token');
    if (hadFragment && hadQuery) return fail('invalid_token');

    const params = new URLSearchParams(source);
    const allowed = new Set(['token_hash', 'type', 'next', 'signup_ref']);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) return fail('invalid_token');
    }
    const tokenHash = params.get('token_hash') || '';
    const type = params.get('type') || '';
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(tokenHash)) return fail('missing_token');
    if (!['invite', 'recovery', 'email', 'magiclink', 'signup', 'email_change'].includes(type)) {
      return fail('invalid_type');
    }

    void fetch('/auth/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString(),
      credentials: 'same-origin',
      redirect: 'follow',
      cache: 'no-store',
    }).then((response) => {
      if (!response.ok) return fail('invalid_token');
      const target = new URL(response.url, window.location.origin);
      if (target.origin !== window.location.origin) return fail('invalid_token');
      window.location.replace(target.pathname + target.search);
    }).catch(() => fail('invalid_token'));
  })();`;

function sha256Source(value: string): string {
  return `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
}

export const AUTH_CONFIRM_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src ${sha256Source(AUTH_CONFIRM_BRIDGE_SCRIPT)}`,
  `style-src ${sha256Source(AUTH_CONFIRM_BRIDGE_STYLE)}`,
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
