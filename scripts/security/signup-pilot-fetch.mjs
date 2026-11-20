/** Runner-only transport boundary. Never imported by application code. */
import assert from 'node:assert/strict';
assert.equal(process.env.SIGNUP_LOCAL_PILOT, 'true');
const actualFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return actualFetch(input, init);
  if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
    return actualFetch(`${process.env.PILOT_MAIL_URL}/send`, {
      ...init,
      headers: {
        authorization: `Bearer ${process.env.PILOT_MAIL_TOKEN}`,
        'content-type': 'application/json',
      },
    });
  }
  if (
    url.origin === 'https://api.pwnedpasswords.com' &&
    /^\/range\/[A-F0-9]{5}$/u.test(url.pathname)
  )
    // A valid padded k-anonymity response, not an empty provider failure.
    // Zero occurrences is a synthetic safe result; no password leaves the runner.
    return new Response(`${'0'.repeat(35)}:0\r\n`, { status: 200 });
  throw new Error('External network forbidden in synthetic pilot proof');
};
