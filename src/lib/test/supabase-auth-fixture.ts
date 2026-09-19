/** Auth sintético em loopback para exercitar o SDK SSR instalado. Não é GoTrue nem prova o provedor. */
import { createServer } from 'node:http';
import type { Session, User } from '@supabase/supabase-js';
import { z } from 'zod';

export async function startSupabaseAuthFixture() {
  const user: User = {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'convite@localhost.invalid',
    app_metadata: {},
    user_metadata: { clinica: 'Clínica sintética', convidado_por: 'Administrador' },
    created_at: '2026-09-14T00:00:00Z',
  };
  let generation = 0;
  let session: Session;
  const requests: string[] = [];
  const validAccessTokens = new Set<string>();
  let passwordUpdates = 0;

  function nextSession(): Session {
    generation += 1;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const accessToken =
      [
        { alg: 'HS256', typ: 'JWT' },
        { sub: user.id, exp: expiresAt, generation, role: 'authenticated' },
      ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
        .join('.') + '.synthetic';
    validAccessTokens.add(accessToken);
    session = {
      access_token: accessToken,
      refresh_token: `synthetic-refresh-${generation}`,
      expires_at: expiresAt,
      expires_in: 3600,
      token_type: 'bearer',
      user,
    };
    return session;
  }
  nextSession();

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      response.writeHead(400).end(JSON.stringify({ msg: 'Invalid JSON' }));
      return;
    }
    const validated = z.record(z.unknown()).safeParse(parsed);
    if (!validated.success) {
      response.writeHead(400).end(JSON.stringify({ msg: 'Invalid object' }));
      return;
    }
    const body = validated.data;
    if (url.pathname === '/auth/v1/verify') {
      if (body.token_hash !== 'valid-invite') {
        response.writeHead(403).end(
          JSON.stringify({
            code: 403,
            error_code: body.token_hash === 'expired-invite' ? 'otp_expired' : 'otp_disabled',
            msg: body.token_hash === 'expired-invite' ? 'Token expired' : 'Token invalid',
          }),
        );
        return;
      }
      response.end(JSON.stringify(nextSession()));
      return;
    }
    if (url.pathname === '/auth/v1/token' && body.refresh_token === session.refresh_token) {
      response.end(JSON.stringify(nextSession()));
      return;
    }
    if (!validAccessTokens.has(request.headers.authorization?.replace(/^Bearer /, '') ?? '')) {
      response.writeHead(401).end(JSON.stringify({ msg: 'Invalid JWT' }));
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.method === 'PUT') {
        if (typeof body.password !== 'string' || body.password.length < 8) {
          response.writeHead(400).end(JSON.stringify({ msg: 'Invalid password' }));
          return;
        }
        passwordUpdates += 1;
      }
      response.end(JSON.stringify(user));
      return;
    }
    if (url.pathname === '/auth/v1/logout') {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end(JSON.stringify({ msg: 'Fixture endpoint does not exist' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    user,
    requests,
    get passwordUpdates() {
      return passwordUpdates;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
