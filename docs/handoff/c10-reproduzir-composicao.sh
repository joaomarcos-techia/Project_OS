#!/usr/bin/env bash
# Reproduz a composição descartável da ordem real (#53 → #56 → #55) e, com --prova-0159, o
# procedimento do dono do banco para a 0159. NADA aqui vai para branch de outra frente, para DEV
# ou para Production: é um worktree descartável a partir dos branches `integracao/c9-*`.
#
# Uso (na raiz de qualquer worktree do repositório):
#   bash docs/handoff/c10-reproduzir-composicao.sh <pasta-descartável> [--prova-0159]
#
# Sem --prova-0159: o gate de migrations falha em "Migration journal order invalid at index 159"
# (a 0159 do #53 não está no journal de nenhuma branch, por desenho).
# Com --prova-0159: copia o SQL CONGELADO do #53 (saas_period_snapshot.candidate.sql), confere o
# sha256 contra docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json e acrescenta a
# linha do journal do manifesto. O gate passa; os testes de formato do journal do #55 ainda
# reprovam por construção (ver handoff C10.2, parte B).
set -euo pipefail
DEST=${1:?pasta descartável}
PROVA=${2:-}
git fetch origin integracao/c9-53-56-55 --quiet
git worktree add --detach "$DEST" origin/integracao/c9-53-56-55
cd "$DEST"
if [ "$PROVA" = "--prova-0159" ]; then
  M=docs/decoupling/asaas-to-abacatepay/migrations
  cp "$M/saas_period_snapshot.candidate.sql" drizzle/migrations/0159_saas_period_snapshot.sql
  python3 - <<'PY'
import hashlib, io, json
m = json.load(open('docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json', encoding='utf-8'))
body = open('drizzle/migrations/0159_saas_period_snapshot.sql', 'rb').read().replace(b'\r\n', b'\n')
assert hashlib.sha256(body).hexdigest() == m['financialSql']['sha256'], 'SQL difere do congelado'
p = 'drizzle/migrations/meta/_journal.json'
raw = io.open(p, encoding='utf-8').read(); j = json.loads(raw)
assert all(e['idx'] != 159 for e in j['entries']), '0159 já está no journal'
e = m['financialEntry']
j['entries'].append({k: e[k] for k in ('idx', 'version', 'when', 'tag', 'breakpoints')})
j['entries'].sort(key=lambda x: x['idx'])
assert all(x['idx'] == i for i, x in enumerate(j['entries'])), 'journal não contíguo'
io.open(p, 'w', encoding='utf-8', newline='').write(json.dumps(j, indent=2, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
print('0159 do manifesto acrescentada; journal contíguo com', len(j['entries']), 'entradas')
PY
fi
npx tsx scripts/check-migration-safety.ts || echo "gate de migrations: FALHOU (esperado sem --prova-0159)"
npx vitest run --maxWorkers=2 --minWorkers=1 \
  src/contexts/health-insurance/migration-ledger.test.ts \
  src/lib/db/migration-composition.test.ts \
  src/contexts/payments/external-refund-migration.test.ts || true
