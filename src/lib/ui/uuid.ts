/**
 * UUID v4 client-safe. `crypto.randomUUID` só existe em CONTEXTO SEGURO
 * (https/localhost) — acessando o dev pelo IP da rede (http://192.168.x.x) ou
 * em webviews antigas ele não existe e quebrava toda mutação com idempotency
 * key. Fallback RFC 4122 v4 via getRandomValues (sempre disponível).
 */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40; // versão 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}
