/**
 * P15.5 — POST do conector SOAP com política de destino (SSRF).
 *
 * O endereço do webservice vem da configuração homologada, mas mesmo assim o conector só conecta a
 * endereço PÚBLICO: o IP é conferido no momento da conexão (no `lookup` do socket), então um nome
 * que resolva para rede interna — por erro de configuração ou por DNS trocado depois da conferência
 * ("rebinding") — é recusado antes de qualquer byte sair. Recusados: loopback, redes privadas,
 * link-local (inclui o endereço de metadados das nuvens, 169.254.169.254), CGNAT, multicast,
 * reservados e os equivalentes IPv6 (inclui IPv4 mapeado).
 *
 * Sem redirecionamento (o `http`/`https` do Node não segue), com teto de resposta e cancelamento pelo
 * `AbortSignal` do contrato da P2.5. O loopback em HTTP só passa com `allowLoopback` (stub dos testes).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** O endereço é de rede interna ou reservada (nunca destino de operadora)? */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
    if (mapped) return blocked.check(mapped, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

const isLoopback = (address: string) =>
  isIP(address) === 4 ? LOOPBACK.check(address, 'ipv4') : isIP(address) === 6 ? LOOPBACK.check(address, 'ipv6') : false;

export class BlockedDestinationError extends Error {
  constructor() {
    super('destino do webservice recusado: endereço de rede interna ou reservada');
    this.name = 'BlockedDestinationError';
  }
}

/** `lookup` que só entrega endereço permitido (conferido na conexão, não antes). */
export function guardedLookup(allowLoopback: boolean, resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = (Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }]) as LookupAddress[];
      const ok = list.filter((a) => !isBlockedAddress(a.address) || (allowLoopback && isLoopback(a.address)));
      // Um único endereço proibido na resposta recusa o nome inteiro (sem "escolher o bom").
      if (ok.length === 0 || ok.length !== list.length) return callback(new BlockedDestinationError(), '', 0);
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, ok);
      return callback(null, ok[0]!.address, ok[0]!.family);
    });
  };
}

export interface GuardedPostResult {
  status: number;
  /** `null` se a resposta passou do teto. */
  bytes: Uint8Array | null;
}

export function guardedPost(
  url: URL,
  init: { headers: Record<string, string>; body: Uint8Array; signal: AbortSignal; maxBytes: number; allowLoopback: boolean; resolve?: typeof dnsLookup },
): Promise<GuardedPostResult> {
  return new Promise((resolvePromise, reject) => {
    // IP literal não passa pelo `lookup`: confere aqui.
    const literal = url.hostname.replace(/^\[|\]$/gu, '');
    if (isIP(literal) && isBlockedAddress(literal) && !(init.allowLoopback && isLoopback(literal))) {
      reject(new BlockedDestinationError());
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: literal,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...init.headers, 'Content-Length': String(init.body.byteLength) },
        lookup: guardedLookup(init.allowLoopback, init.resolve),
        signal: init.signal,
      },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? '0');
        if (declared > init.maxBytes) {
          res.destroy();
          resolvePromise({ status: res.statusCode ?? 0, bytes: null });
          return;
        }
        const parts: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > init.maxBytes) {
            res.destroy();
            resolvePromise({ status: res.statusCode ?? 0, bytes: null });
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, bytes: Buffer.concat(parts) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(Buffer.from(init.body));
  });
}
