/**
 * Gera `docs/convenios/pdf-guias-mapeamento.md` a partir do catálogo de campos
 * (`tiss/print/fields.ts`) e dos rótulos do modelo oficial extraído da ANS: o
 * documento não diverge do código. `--check` falha se o arquivo estiver desatualizado.
 *
 *   npx tsx scripts/tiss/print/mapping-doc.ts [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONSULTA_FIELDS, SP_SADT_FIELDS, type PrintFieldSpec } from '../../../src/contexts/health-insurance/tiss/print/fields';
import { CONSULTA_MODEL, officialLabel, SP_SADT_MODEL, type OfficialModel } from '../../../src/contexts/health-insurance/tiss/print/official-model';

const OUT = path.join(process.cwd(), 'docs/convenios/pdf-guias-mapeamento.md');
const RULE = { obrigatorio: 'Obrigatório', condicionado: 'Condicionado', opcional: 'Opcional' } as const;
const SOURCE = { xml: 'XML (snapshot)', impresso: 'só impresso (snapshot `print`)', manual: 'à mão no papel' } as const;

function label(model: OfficialModel, no: number): string {
  const direct = officialLabel(model, no);
  // O "2- Nº" e o "Guia no Prestador" são dois textos na mesma linha do modelo.
  if (direct && no === 2) return `${direct.text} Guia no Prestador`;
  if (direct) return direct.text.replace(/\|.*$/u, '').trim();
  // Campos que dividem o rótulo com o vizinho na mesma linha do modelo (39, 40, 44, 45, 49, 50, 57).
  for (const l of model.labels) {
    const m = new RegExp(`(?:^|\\s)(${no}\\s*-\\s*[^0-9]+?)(?=\\s\\d{1,2}\\s*-|$)`, 'u').exec(l.text);
    if (m) return m[1]!.trim();
  }
  return `${no}`;
}

const esc = (s: string) => s.replace(/\|/gu, '\\|');
function table(model: OfficialModel, fields: readonly PrintFieldSpec[]): string {
  const rows = [...fields]
    .sort((a, b) => a.no - b.no)
    .map((f) => `| ${f.no} | ${esc(label(model, f.no))} | ${RULE[f.rule]} | ${SOURCE[f.source]} | ${f.xml ? `\`${esc(f.xml)}\`` : '—'} | ${esc(f.qoro)} |`);
  return ['| Nº | Rótulo no modelo oficial | Condição (legenda ANS) | Origem no Qoro | Caminho no XML | De onde vem / por que fica em branco |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

const doc = `# PDFs oficiais das guias TISS — mapeamento campo a campo

> Gerado por \`scripts/tiss/print/mapping-doc.ts\` a partir de \`src/contexts/health-insurance/tiss/print/fields.ts\` e do
> modelo oficial extraído (\`src/contexts/health-insurance/tiss/print/models/\`). Não editar à mão.

**Fonte oficial:** Padrão TISS — Componente de Conteúdo e Estrutura 202511 (zip SHA-256
\`${CONSULTA_MODEL.source.zipSha256}\`; PDF \`${CONSULTA_MODEL.source.pdfSha256}\`). Guia de Consulta: modelo na p. ${CONSULTA_MODEL.source.page},
legenda nas p. 470–473. Guia SP/SADT: modelo na p. ${SP_SADT_MODEL.source.page}, legenda nas p. 521–531.

## Decisões do mapeamento

1. **O impresso e o XML não têm os mesmos campos.** O papel exige o nome do beneficiário (Consulta 7, SP/SADT 10) e o
   nome do contratado executante (Consulta 10, SP/SADT 30), que não existem no XML 4.03.00. Eles são lidos na transação
   da emissão e gravados no snapshot cifrado, no bloco \`print\`, **fora** do dado do XML: o construtor do XML nunca os
   lê, e o PDF nunca relê o cadastro atual.
2. **Um modelo só para a SP/SADT.** A ANS tem um formulário único de SP/SADT, com o bloco de solicitação (21–28) e o de
   execução (32–55, 59–65). O Qoro gera o mesmo modelo nos dois usos: na solicitação, execução, autorização (4–7) e
   quantidade autorizada (28) ficam em branco (são da operadora ou do atendimento); na cobrança, o bloco de solicitação
   vem da solicitação vinculada congelada no snapshot, ou fica em branco (o executado nunca vira "solicitado").
3. **Nada fictício.** Campo sem dado fica em branco: nome social (o Qoro não coleta), validade da carteira (só na
   contingência em papel), assinaturas e datas de série (à mão), totais de outras despesas (o Qoro não as fatura).
4. **Layout:** caixas, faixas, título e rótulos são desenhados nas coordenadas extraídas do PDF oficial (A4 paisagem).
   No lugar do exemplo "12345678901234567890" vai o número da guia; no do "Logo da Empresa", o nome da operadora (o
   Qoro não guarda logotipo de terceiro). As máscaras de preenchimento à mão (\`|___|\`) não são reproduzidas.
5. **Texto longo:** o valor é quebrado e o corpo reduzido até caber na caixa; se não couber no corpo mínimo, a caixa
   mostra o início e o aviso, e o texto **integral** vai para a folha de continuação. Nada é cortado em silêncio.
6. **Paginação (SP/SADT):** 5 linhas de procedimentos solicitados, 5 de executados e 4 de equipe por folha, como no
   modelo; com mais itens, novas folhas do mesmo modelo, numeração contínua e totais (59–65) só na última.
7. **Rastreabilidade (R36/S7):** rodapé com software, número da guia, revisão, início do SHA-256 do snapshot e a página
   do modelo da ANS. Metadados do PDF sem dado pessoal.
8. **CID:** não existe na Consulta nem na SP/SADT 4.03.00 e nunca é impresso. A indicação clínica (SP/SADT 23) é só o
   texto que o profissional escreveu para a solicitação, nunca copiado do prontuário (D17).

## Guia de Consulta (${CONSULTA_FIELDS.length} campos: 1–7 e 9–29; o 8, CNS, saiu do modelo)

${table(CONSULTA_MODEL, CONSULTA_FIELDS)}

## Guia SP/SADT — cobrança e solicitação (${SP_SADT_FIELDS.length} campos: 1–10, 12–68 e 89–92; o 11, CNS, saiu do modelo)

${table(SP_SADT_MODEL, SP_SADT_FIELDS)}

## Como verificar

- Testes: \`src/contexts/health-insurance/tiss/print/print.test.ts\` (rótulos no lugar do modelo, valores dentro da caixa,
  consistência com o XML, paginação, texto longo, acentos, metadados e logs).
- Visual, reproduzível: \`TISS_CONTEUDO_PDF=<pdf oficial> npx tsx scripts/tiss/print/visual-check.ts <pasta>\` gera as
  folhas em PNG ao lado das páginas oficiais (\`index.html\`) e as medidas (\`report.json\`).
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== doc) throw new Error('docs/convenios/pdf-guias-mapeamento.md desatualizado: rode scripts/tiss/print/mapping-doc.ts');
  console.log('mapeamento em dia');
} else {
  writeFileSync(OUT, doc);
  console.log(`${OUT}: Consulta ${CONSULTA_FIELDS.length} campos, SP/SADT ${SP_SADT_FIELDS.length} campos`);
}
