/** Escreve docs/security/riscos.md a partir do registro. Sem argumentos. */
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'prettier';
import { auditRiskRegister, renderRiskRegister } from './risk-register';

const violations = auditRiskRegister();
if (violations.length) {
  throw new Error(
    `Registro de risco inválido:\n${violations.map((v) => `  ${v.id}: ${v.problema}`).join('\n')}`,
  );
}
const document = await format(renderRiskRegister(), { parser: 'markdown' });
fs.writeFileSync(path.join(process.cwd(), 'docs/security/riscos.md'), document);
console.info(
  `docs/security/riscos.md atualizado com ${auditRiskRegister().length === 0 ? 'registro válido' : 'erros'}.`,
);
