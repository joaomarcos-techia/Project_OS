// Cliente do relé da fixture para o E2E no Preview (runner do GitHub), usado como E2E_HI_FIXTURE_CMD.
//
// O runner NÃO recebe credencial de banco (regra do workflow `convenios-preview-e2e.yml`). Os specs
// que mudam estado no meio da sessão (clínica em trial ou suspensa, acesso desativado) ou leem o
// banco para provar que uma recusa não mudou nada pedem isso por aqui:
//   1. o runner grava o pedido como status `e2e-fixture/request` do próprio commit (token do job,
//      só `statuses: write`);
//   2. o executor do lado do DEV (fora do repositório, com o ambiente DEV) lê o pedido, confere a
//      mesma lista fechada, roda `scripts/security/hi-dev-e2e-fixture.ts` e responde com o status
//      `e2e-fixture/result`, criado pela conta dona do repositório;
//   3. este cliente imprime a linha da fixture (`STATE {…}`, `ACTIVE {…}` ou `GUIDE_STATE {…}`),
//      igual à execução local, e o spec segue sem saber do relé.
//
// Lista fechada (o executor confere de novo, com as guias e as contas da execução):
//   set-state --state paid|trial|suspended
//   set-active --account <chave> --active true|false
//   guide-state --guide <uuid>
//   p84-state --guide <uuid>      (P8.4-r: itens adicionais, consumo, recebível e auditoria; só leitura)
//
// Sem resposta em 200 s, ou resposta `ERROR …`, sai com erro: o teste falha dizendo o motivo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALLOWED = [
  /^set-state --state (paid|trial|suspended)$/u,
  /^set-active --account [a-z0-9-]{2,24} --active (true|false)$/u,
  /^guide-state --guide [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  /^p84-state --guide [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
];
const RESULT = /^(STATE|ACTIVE|GUIDE_STATE|P84_STATE) \{.*\}$/u;
const WAIT_MS = 200_000;
const POLL_MS = 2_000;

const line = process.argv.slice(2).join(' ');
if (!ALLOWED.some((r) => r.test(line))) {
  console.error(`relé da fixture: comando fora da lista fechada: ${line}`);
  process.exit(2);
}
const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY_OWNER } =
  process.env;
if (!GH_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_RUN_ID || !GITHUB_REPOSITORY_OWNER) {
  console.error('relé da fixture: só roda no runner do GitHub (faltam GH_TOKEN/GITHUB_*)');
  process.exit(2);
}

// Sequência por execução: o mesmo commit pode ter mais de uma rodada (nova tentativa do job).
const seqFile = join(tmpdir(), `fixture-relay-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT ?? '1'}.seq`);
const seq = (existsSync(seqFile) ? Number(readFileSync(seqFile, 'utf8')) : 0) + 1;
writeFileSync(seqFile, String(seq));
const id = `${GITHUB_RUN_ID}.${GITHUB_RUN_ATTEMPT ?? '1'}.${seq}`;

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${r.status}`);
  return r.json();
};

await api(`/statuses/${GITHUB_SHA}`, {
  method: 'POST',
  body: JSON.stringify({
    state: 'success',
    context: 'e2e-fixture/request',
    description: `#${id} ${line}`,
  }),
});

const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  const statuses = await api(`/commits/${GITHUB_SHA}/statuses?per_page=100`);
  const hit = statuses.find(
    (s) =>
      s.context === 'e2e-fixture/result' &&
      s.creator?.login === GITHUB_REPOSITORY_OWNER &&
      typeof s.description === 'string' &&
      s.description.startsWith(`#${id} `),
  );
  if (!hit) continue;
  const answer = hit.description.slice(`#${id} `.length);
  if (!RESULT.test(answer)) {
    console.error(`relé da fixture: ${answer}`);
    process.exit(1);
  }
  console.log(answer);
  process.exit(0);
}
console.error(`relé da fixture: sem resposta em ${WAIT_MS / 1000} s para #${id} (${line})`);
process.exit(1);
