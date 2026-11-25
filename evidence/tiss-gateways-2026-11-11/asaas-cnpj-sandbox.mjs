// Teste controlado (B11): o Asaas SANDBOX aceita CNPJ alfanumérico em POST /v3/customers?
// Só sandbox: aborta se a URL não for sandbox ou se a chave não for de homologação. Sem cobrança.
// Cria clientes sintéticos com notificações desligadas e os apaga no fim. Não imprime segredo.
import { readFileSync } from 'node:fs';

const env = readFileSync('C:/dev/ClinicaOS_V2/.env.local', 'utf8');
const get = (k) => ((env.match(new RegExp(`^${k}=(.*)$`, 'mu')) ?? [])[1] ?? '').replace(/["']/gu, '').trim();
const base = get('ASAAS_BASE_URL_DEV');
const key = get('ASAAS_API_KEY_DEV');
if (!/^https:\/\/(api-)?sandbox\.asaas\.com\//u.test(base)) throw new Error('URL não é de sandbox: abortando');
if (!key.includes('aact_hmlg') || key.includes('aact_prod')) throw new Error('chave não é de sandbox: abortando');

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', access_token: key, 'User-Agent': 'qoro-convenios-sandbox-test' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
};

const cases = [
  ['controle: CNPJ numérico válido', '11222333000181'],
  ['alfanumérico oficial (Receita), sem pontuação', '12ABC34501DE35'],
  ['alfanumérico oficial, com pontuação', '12.ABC.345/01DE-35'],
  ['alfanumérico com DV errado', '12ABC34501DE36'],
];
const created = [];
const out = [];
for (const [label, doc] of cases) {
  const r = await call('POST', '/customers', {
    name: `Qoro Teste CNPJ (sandbox) ${label.slice(0, 20)}`,
    cpfCnpj: doc,
    notificationDisabled: true,
    externalReference: 'qoro-convenios-b11-teste',
  });
  if (r.json?.id) created.push(r.json.id);
  out.push({
    caso: label,
    enviado: doc,
    http: r.status,
    aceito: Boolean(r.json?.id),
    cpfCnpjDevolvido: r.json?.cpfCnpj ?? null,
    personType: r.json?.personType ?? null,
    erros: (r.json?.errors ?? []).map((e) => `${e.code}: ${e.description}`),
  });
}
const cleanup = [];
for (const id of created) {
  const r = await call('DELETE', `/customers/${id}`);
  cleanup.push({ http: r.status, deleted: r.json?.deleted ?? null });
}
console.log(JSON.stringify({ ambiente: base.replace(/\/v3.*/u, ''), data: new Date().toISOString(), resultados: out, limpeza: cleanup }, null, 2));
