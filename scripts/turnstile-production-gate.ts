/** Janela autorizada: Siteverify real, sem criar conta nem abrir o cadastro. */
import assert from 'node:assert/strict';
async function main(): Promise<void> {
  assert.equal(process.env.TURNSTILE_PRODUCTION_GATE, 'approved');
  const secret = process.env.TURNSTILE_SECRET_KEY;
  assert.ok(
    secret && !/^[123]x0{10}/u.test(secret),
    'Exige secret real do widget, nunca chave dummy',
  );
  let token = '';
  for await (const chunk of process.stdin) {
    token += String(chunk);
    if (token.length > 2050) throw new Error('Token inválido');
  }
  token = token.trim();
  assert.ok(token.length > 0 && token.length <= 2048);
  async function verify(
    response: string,
  ): Promise<{ success: boolean; hostname?: string; codes: string[] }> {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: secret!, response }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(res.status, 200, 'Siteverify indisponível');
    const data: unknown = await res.json();
    assert.ok(
      data && typeof data === 'object' && 'success' in data && typeof data.success === 'boolean',
    );
    const codes: unknown = Reflect.get(data, 'error-codes');
    return {
      success: data.success,
      ...('hostname' in data && typeof data.hostname === 'string'
        ? { hostname: data.hostname }
        : {}),
      codes: Array.isArray(codes)
        ? codes.filter(
            (value: unknown): value is string =>
              typeof value === 'string' && /^[a-z-]{1,64}$/u.test(value),
          )
        : [],
    };
  }
  const positive = await verify(token);
  assert.equal(positive.success, true);
  assert.equal(positive.hostname, 'app.qoro.dev');
  const replay = await verify(token);
  assert.equal(replay.success, false);
  assert.ok(replay.codes.includes('timeout-or-duplicate'));
  const invalid = await verify('synthetic-invalid-production-gate');
  assert.equal(invalid.success, false);
  process.stdout.write(
    'PASS real Siteverify: app.qoro.dev token accepted, replay and invalid token denied; signup unchanged\n',
  );
}
main().catch(() => {
  process.stderr.write('FAIL production Turnstile gate; token/secret/response suppressed\n');
  process.exitCode = 1;
});
