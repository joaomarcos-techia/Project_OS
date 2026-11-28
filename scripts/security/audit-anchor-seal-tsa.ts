/**
 * S5 / P12.10 — provas do SELO das âncoras por carimbo de tempo RFC 3161, sem banco e sem rede externa: duas TSAs
 * LOCAIS (cada uma com a própria autoridade certificadora, criadas pelo OpenSSL num diretório temporário) servem por
 * HTTP no loopback, e a ferramenta do operador (`audit-anchor.ts seal | verify-seal`) roda de verdade contra elas.
 * As âncoras são sintéticas (o cálculo contra o banco é provado em `audit-anchor-db.ts`).
 *
 *   1. selo com duas TSAs: dois carimbos válidos; o pedido leva só o SHA-256 do enunciado (nenhum dado da trilha);
 *   2. o dono do banco reescreve a trilha e RECALCULA âncoras coerentes: o selo antigo acusa a trilha que mudou;
 *   3. o arquivo de âncoras guardado editado (meio da cadeia e cabeça): acusado sem o banco;
 *   4. selo forjado (enunciado novo com o carimbo antigo): a assinatura não confere com o resumo novo;
 *   5. carimbo de uma TSA em que não se confia (outra raiz): recusado;
 *   6. TSA fora do ar: com a outra no ar, o selo sai com um carimbo; com as duas fora, NADA é gravado (código 4);
 *   7. recuperação: selar depois de dias marca a janela como atrasada (fica visível, não some);
 *   8. lugar de guarda perdido (o arquivo do selo sumiu): "sem selo" com código próprio (3), nunca "íntegro".
 *
 *   npx tsx scripts/security/audit-anchor-seal-tsa.ts          (precisa só do OpenSSL no PATH)
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ANCHOR_GENESIS, chainDay, type DayAnchor } from '../../src/lib/db/audit-anchor';
import { sealDigest, type SealRecord } from '../../src/lib/db/audit-anchor-seal';

import { openssl, timestampInfo } from './audit-anchor-tsa';

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};

const root = mkdtempSync(path.join(tmpdir(), 'qoro-seal-'));
const posix = (p: string) => p.replace(/\\/gu, '/');
const file = (name: string) => path.join(root, name);

/** Uma TSA local: raiz própria, certificado de carimbo (EKU timeStamping) e configuração do `openssl ts -reply`. */
function makeTsa(name: string) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const p = (f: string) => posix(path.join(dir, f));
  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    p('ca.key'),
    '-out',
    p('ca.crt'),
    '-subj',
    `/CN=Qoro Synthetic ${name} Root`,
    '-days',
    '2',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);
  openssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    p('tsa.key'),
    '-out',
    p('tsa.csr'),
    '-subj',
    `/CN=Qoro Synthetic ${name}`,
  ]);
  writeFileSync(
    p('ext.cnf'),
    'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n',
  );
  openssl([
    'x509',
    '-req',
    '-in',
    p('tsa.csr'),
    '-CA',
    p('ca.crt'),
    '-CAkey',
    p('ca.key'),
    '-CAcreateserial',
    '-out',
    p('tsa.crt'),
    '-days',
    '2',
    '-extfile',
    p('ext.cnf'),
  ]);
  writeFileSync(p('serial'), '01\n');
  writeFileSync(
    p('tsa.cnf'),
    [
      '[ tsa ]',
      'default_tsa = tsa_config',
      '[ tsa_config ]',
      `serial = ${p('serial')}`,
      `signer_cert = ${p('tsa.crt')}`,
      `signer_key = ${p('tsa.key')}`,
      'signer_digest = sha256',
      'default_policy = 1.2.3.4.1',
      'digests = sha256',
      'accuracy = secs:1',
      'ordering = yes',
      'tsa_name = yes',
      'ess_cert_id_chain = no',
      'ess_cert_id_alg = sha256',
      '',
    ].join('\n'),
  );
  let down = false;
  const queries: Buffer[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (down) {
        res.writeHead(503).end();
        return;
      }
      const query = Buffer.concat(chunks);
      queries.push(query);
      const q = p(`q-${randomBytes(4).toString('hex')}.tsq`);
      const r = q.replace(/\.tsq$/u, '.tsr');
      writeFileSync(q, query);
      const out = spawnSync(
        process.env.ANCHOR_OPENSSL ?? 'openssl',
        ['ts', '-reply', '-config', p('tsa.cnf'), '-queryfile', q, '-out', r],
        { encoding: 'utf8' },
      );
      if (out.status !== 0) {
        res.writeHead(500).end(out.stderr);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/timestamp-reply' }).end(readFileSync(r));
    });
  });
  return {
    ca: p('ca.crt'),
    queries,
    setDown: (v: boolean) => (down = v),
    url: '',
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      this.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/tsr`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Âncoras sintéticas de uma trilha, encadeadas do gênese, como o `compute` gravaria. */
function anchorsFor(trail: DayAnchor['trail'], days: string[], salt: string): DayAnchor[] {
  let prev = ANCHOR_GENESIS;
  return days.map((day, i) => {
    const rows = Array.from({ length: i + 1 }, (_, k) =>
      createHash('sha256').update(`${salt}/${day}/${k}`).digest('hex'),
    );
    const digest = chainDay(prev, trail, day, rows);
    const a: DayAnchor = { trail, day, count: rows.length, prev, digest };
    prev = digest;
    return a;
  });
}
const jsonl = (anchors: readonly DayAnchor[]) =>
  anchors.map((a) => JSON.stringify(a)).join('\n') + '\n';
const utcDay = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/** A ferramenta do operador, de verdade, como processo (assíncrono: as TSAs locais respondem neste processo). */
function cli(...cliArgs: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/security/audit-anchor.ts', ...cliArgs],
      {
        env: { ...process.env, ANCHOR_DATABASE_URL: '' },
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

const A = makeTsa('tsa-a');
const B = makeTsa('tsa-b');
try {
  await A.listen();
  await B.listen();
  const days = [utcDay(-3), utcDay(-2), utcDay(-1)];
  const clinic = anchorsFor('clinic_audit', days, 'clinica');
  const platform = anchorsFor('platform_audit', days, 'plataforma');
  writeFileSync(file('clinic.jsonl'), jsonl(clinic));
  writeFileSync(file('platform.jsonl'), jsonl(platform));
  writeFileSync(file('cas.pem'), readFileSync(A.ca, 'utf8') + readFileSync(B.ca, 'utf8'));
  const anchorsArgs = ['--anchors', file('clinic.jsonl'), '--anchors', file('platform.jsonl')];

  // ── 1. selo com duas TSAs ─────────────────────────────────────────────
  {
    const r = await cli(
      'seal',
      ...anchorsArgs,
      '--tsa',
      A.url,
      '--tsa',
      B.url,
      '--out',
      file('selo.json'),
    );
    assert.equal(r.code, 0, r.err);
    const seal = JSON.parse(readFileSync(file('selo.json'), 'utf8')) as SealRecord;
    assert.equal(seal.tokens.length, 2);
    assert.equal(seal.digest, sealDigest(seal.statement));
    for (const t of seal.tokens) {
      const info = timestampInfo(Buffer.from(t.response, 'base64'));
      assert.equal(info.granted, true);
      assert.equal(info.digest, seal.digest);
      assert.ok(info.stampedAt && Math.abs(info.stampedAt.getTime() - Date.now()) < 120_000);
    }
    // O pedido leva só o resumo (o enunciado e as âncoras não saem da máquina).
    const q = A.queries[0]!;
    assert.ok(q.length < 200, `pedido com ${q.length} bytes`);
    assert.ok(q.includes(Buffer.from(seal.digest, 'hex')));
    assert.ok(!q.includes(Buffer.from(clinic[2]!.digest, 'hex')));
    const v = await cli(
      'verify-seal',
      ...anchorsArgs,
      '--seal',
      file('selo.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(v.code, 0, v.err + v.out);
    assert.equal((v.out.match(/"signature":"ok"/gu) ?? []).length, 2);
    assert.match(v.out, /"late":false/u);
    pass(
      'selo com duas TSAs independentes: dois carimbos válidos; à TSA só vai o SHA-256 do enunciado',
    );
  }

  // ── 2. trilha reescrita e âncoras recalculadas pelo dono do banco ─────────
  {
    const rewritten = anchorsFor('clinic_audit', days, 'clinica-reescrita');
    writeFileSync(file('clinic-reescrita.jsonl'), jsonl(rewritten));
    const v = await cli(
      'verify-seal',
      '--anchors',
      file('clinic-reescrita.jsonl'),
      '--anchors',
      file('platform.jsonl'),
      '--seal',
      file('selo.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(v.code, 1, v.out);
    assert.match(v.out, /"kind":"statement_mismatch","trail":"clinic_audit"/u);
    assert.doesNotMatch(v.out, /"trail":"platform_audit"/u);
    pass(
      'o dono do banco reescreve a trilha e recalcula âncoras coerentes: o selo antigo acusa a trilha que mudou',
    );
  }

  // ── 3. arquivo de âncoras guardado editado ─────────────────────────────
  {
    const middle = clinic.map((a, i) => (i === 1 ? { ...a, digest: 'f'.repeat(64) } : a));
    writeFileSync(file('clinic-meio.jsonl'), jsonl(middle));
    const m = await cli(
      'verify-seal',
      '--anchors',
      file('clinic-meio.jsonl'),
      '--anchors',
      file('platform.jsonl'),
      '--seal',
      file('selo.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(m.code, 1);
    assert.match(m.out, /"kind":"chain_broken"/u);
    const head = clinic.map((a, i) => (i === 2 ? { ...a, digest: 'e'.repeat(64) } : a));
    writeFileSync(file('clinic-cabeca.jsonl'), jsonl(head));
    const h = await cli(
      'verify-seal',
      '--anchors',
      file('clinic-cabeca.jsonl'),
      '--anchors',
      file('platform.jsonl'),
      '--seal',
      file('selo.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(h.code, 1);
    assert.match(h.out, /"kind":"statement_mismatch","trail":"clinic_audit"/u);
    pass(
      'o arquivo de âncoras guardado editado (no meio da cadeia ou na cabeça) é acusado sem o banco',
    );
  }

  // ── 4. selo forjado com o carimbo antigo ───────────────────────────────
  {
    const seal = JSON.parse(readFileSync(file('selo.json'), 'utf8')) as SealRecord;
    const rewritten = anchorsFor('clinic_audit', days, 'clinica-reescrita');
    const heads = seal.heads.map((h) =>
      h.trail === 'clinic_audit' ? { ...h, head: rewritten[2]!.digest } : h,
    );
    const statement = [
      seal.statement.split('\n')[0],
      ...heads.map((h) => `${h.trail} ${h.from} ${h.to} ${h.head}`),
    ].join('\n');
    const forged: SealRecord = { ...seal, heads, statement, digest: sealDigest(statement) };
    writeFileSync(file('selo-forjado.json'), JSON.stringify(forged));
    const v = await cli(
      'verify-seal',
      '--anchors',
      file('clinic-reescrita.jsonl'),
      '--anchors',
      file('platform.jsonl'),
      '--seal',
      file('selo-forjado.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(v.code, 4, v.out + v.err);
    assert.equal((v.out.match(/"signature":"invalid"/gu) ?? []).length, 2);
    pass(
      'selo forjado (enunciado novo, carimbo antigo): as duas assinaturas não conferem com o resumo novo',
    );
  }

  // ── 5. TSA em que não se confia ────────────────────────────────────────
  {
    const v = await cli('verify-seal', ...anchorsArgs, '--seal', file('selo.json'), '--ca', A.ca);
    // Confiando só na raiz da TSA A, o carimbo da B é recusado e o da A vale.
    assert.equal(v.code, 0, v.err);
    assert.equal((v.out.match(/"signature":"ok"/gu) ?? []).length, 1);
    assert.equal((v.out.match(/"signature":"invalid"/gu) ?? []).length, 1);
    const seal = JSON.parse(readFileSync(file('selo.json'), 'utf8')) as SealRecord;
    const onlyB: SealRecord = { ...seal, tokens: seal.tokens.filter((t) => t.tsa === B.url) };
    writeFileSync(file('selo-so-b.json'), JSON.stringify(onlyB));
    const w = await cli(
      'verify-seal',
      ...anchorsArgs,
      '--seal',
      file('selo-so-b.json'),
      '--ca',
      A.ca,
    );
    assert.equal(w.code, 4);
    pass('carimbo de uma TSA fora das raízes confiáveis é recusado (com só ele, o selo não vale)');
  }

  // ── 6. TSA fora do ar ─────────────────────────────────────────────────
  {
    A.setDown(true);
    const one = await cli(
      'seal',
      ...anchorsArgs,
      '--tsa',
      A.url,
      '--tsa',
      B.url,
      '--out',
      file('selo-um.json'),
    );
    assert.equal(one.code, 0, one.err);
    assert.match(one.err, /TSA indisponível/u);
    assert.equal(
      (JSON.parse(readFileSync(file('selo-um.json'), 'utf8')) as SealRecord).tokens.length,
      1,
    );
    B.setDown(true);
    const none = await cli(
      'seal',
      ...anchorsArgs,
      '--tsa',
      A.url,
      '--tsa',
      B.url,
      '--out',
      file('selo-nenhum.json'),
    );
    assert.equal(none.code, 4);
    assert.equal(existsSync(file('selo-nenhum.json')), false);
    A.setDown(false);
    B.setDown(false);
    pass(
      'TSA fora do ar: com a outra no ar o selo sai com um carimbo; com as duas fora nada é gravado (código 4)',
    );
  }

  // ── 7. recuperação: selo atrasado ─────────────────────────────────────
  {
    const old = [utcDay(-12), utcDay(-11), utcDay(-10)];
    writeFileSync(file('clinic-antigo.jsonl'), jsonl(anchorsFor('clinic_audit', old, 'antigo')));
    const s = await cli(
      'seal',
      '--anchors',
      file('clinic-antigo.jsonl'),
      '--tsa',
      A.url,
      '--out',
      file('selo-antigo.json'),
    );
    assert.equal(s.code, 0, s.err);
    const v = await cli(
      'verify-seal',
      '--anchors',
      file('clinic-antigo.jsonl'),
      '--seal',
      file('selo-antigo.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(v.code, 0, v.err);
    assert.match(v.out, /"late":true/u);
    pass('recuperação: selar dias atrasados vale, mas a janela aparece como atrasada (nunca some)');
  }

  // ── 8. lugar de guarda perdido ─────────────────────────────────────────
  {
    const v = await cli(
      'verify-seal',
      ...anchorsArgs,
      '--seal',
      file('selo-que-sumiu.json'),
      '--ca',
      file('cas.pem'),
    );
    assert.equal(v.code, 3);
    assert.match(v.err, /SEM SELO/u);
    pass('lugar de guarda perdido: "sem selo" com código próprio (3), nunca "íntegro"');
  }

  console.log(`\naudit-anchor-seal-tsa: ${passed}/8 PASS`);
  assert.equal(passed, 8);
} finally {
  await A.close().catch(() => undefined);
  await B.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
