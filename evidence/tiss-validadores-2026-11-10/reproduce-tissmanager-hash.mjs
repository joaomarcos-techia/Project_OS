// Reprodução independente da divergência B3 do TISS Manager (hash do epílogo).
// Para cada arquivo em que o TISS Manager acusou "Hash divergente", calcula:
//   (a) o hash pela regra da ANS: MD5 dos valores em ISO-8859-1 (Componente Organizacional 202609, p. 49);
//   (b) o hash lendo o mesmo arquivo como UTF-8 (bytes inválidos viram U+FFFD) e gravando U+FFFD como "?";
// e compara com o hash declarado no arquivo e com o "esperado" mostrado pelo TISS Manager.
// Uso: node evidence/tiss-validadores-2026-11-10/reproduce-tissmanager-hash.mjs  (na raiz do repositório)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CORPUS = 'data/tiss/corpus/4.03.00/c1/';
const results = JSON.parse(readFileSync('evidence/tiss-validadores-2026-11-10/tissmanager/results.json', 'utf8')).results;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const md5 = (b) => createHash('md5').update(b).digest('hex');
const values = (text) =>
  [...text.replace(/<\?[\s\S]*?\?>/u, '').replace(/<ans:epilogo>[\s\S]*<\/ans:epilogo>/u, '').matchAll(/>([^<]+)</gu)]
    .map((m) => m[1])
    .filter((v) => v.trim() !== '')
    .map((v) => v.replace(/&(amp|lt|gt|quot|apos);/gu, (_, e) => ENT[e]));

let reproduced = 0;
let total = 0;
for (const r of results) {
  const expected = r.text?.match(/Esperado[^"]*"([0-9a-f]{32})"/u)?.[1];
  if (!expected) continue;
  total += 1;
  const bytes = readFileSync(CORPUS + r.file);
  const declared = bytes.toString('latin1').match(/<ans:hash>([0-9a-f]{32})</u)?.[1];
  const ans = md5(Buffer.from(values(bytes.toString('latin1')).join(''), 'latin1'));
  const misread = md5(Buffer.from(values(new TextDecoder('utf-8').decode(bytes)).join('').replace(/�/gu, '?'), 'latin1'));
  const ok = misread === expected;
  if (ok) reproduced += 1;
  console.log(
    `${r.id.padEnd(44)} sha256=${r.sha256.slice(0, 12)} declarado=${declared} ANS=${ans} ${ans === declared ? '(confere)' : '(NÃO confere)'} | TM esperado=${expected} | leitura UTF-8=${misread} ${ok ? '=> reproduzido' : ''}`,
  );
}
console.log(`\n${reproduced}/${total} "esperados" do TISS Manager reproduzidos pela leitura UTF-8.`);
