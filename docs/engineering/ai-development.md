# AI Development Guidelines (Claude Code)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

O ClinicaOS é desenvolvido em parceria com agentes de IA (Claude Code). Este doc define **como** trabalhar com IA neste repositório sem perder rigor, rastreabilidade ou a confiança na documentação.

---

## 1. Princípios

1. **A IA é engenheira operacional, não oráculo.** Ela executa com disciplina; quem decide arquitetura é o dono (via ADR). Espelha o princípio de produto: "IA é funcionário, não decisor" (VisãoGeral §2.9).
2. **Verificar antes de afirmar.** Nunca declarar "funciona/passa/está feito" sem rodar o comando e ver a saída. Evidência antes de asserção.
3. **Citar a fonte.** Ao falar de código, referencie `arquivo:linha`. Ao falar de decisão, referencie o ADR. Sem "eu acho".
4. **Preservar, não reescrever.** Doc/código existente maduro se estende aditivamente; não se apaga contexto por preferência estética.

---

## 2. Como usar Claude Code aqui

- **Planos antes de código.** Tarefas multi-passo começam com um plano. Planos ficam em `~/.claude/plans/` (fora do repo). O plano aprovado é o contrato da execução.
- **Skills.** Use as skills do projeto quando aplicáveis (brainstorming antes de criar, systematic-debugging antes de consertar bug, TDD antes de implementar). Elas definem o *como*.
- **Gates locais sempre.** Antes de afirmar conclusão: `pnpm typecheck lint test` (+ `arch:*` quando toca estrutura). Ver [git-workflow.md](./git-workflow.md).
- **Memória persistente.** Fatos não-óbvios e feedback do usuário vão para a memória em `~/.claude/projects/.../memory/` — não para o código.

---

## 3. Regras de prompt

- Dê **contexto de arquivo** (paths), não descrições vagas.
- Para mudança arquitetural, aponte o ADR relevante — ou peça um novo.
- Peça **verificação explícita** ("rode os testes e mostre a saída"), não "confie".
- Rejeite escopo que a IA queira inflar; mudança pequena = PR pequeno.

## 4. Revisão de código gerado

Trate código de IA como PR de terceiro. Cheque:

- [ ] Respeita a **matriz de imports** e RLS/threat model ([CONVENTIONS.md](../CONVENTIONS.md))?
- [ ] Passa nos gates (`typecheck`, `lint`, `arch:*`, `test`)?
- [ ] Não reimplementa isolamento de tenant à mão (usa `withTenant`/RLS)?
- [ ] Sem `console.log`, sem `dbAdmin` fora do allowlist, sem forjar claims?
- [ ] A mudança está **documentada** no lugar certo (§5)?

## 5. Anti-alucinação

| Risco | Contramedida |
|---|---|
| Inventar API/arquivo | Abrir o arquivo e citar `arquivo:linha` antes de usar |
| Afirmar "passa" sem rodar | Rodar o comando; colar a saída |
| Confiar em memória sobre libs/versões | Conferir `package.json` / doc oficial |
| Recomendar algo de doc velha | Checar o **Status** (freshness) e a [authority](../documentation-authority.md) |

---

## Documentação Automática

**Regra permanente:** toda vez que se toma uma decisão, escreve, muda, cria ou mexe em qualquer parte do projeto, **documenta-se automaticamente no local adequado** — o quê, para quê, como e a **justificativa**.

### Roteamento canônico

| Tipo de mudança | Documentar em |
|---|---|
| Decisão arquitetural | novo **ADR** em [`adr/`](../adr/) + linha no [adr/README.md](../adr/README.md) |
| Regra/convenção nova | [**CONVENTIONS.md**](../CONVENTIONS.md) |
| Fechamento/avanço de camada ou feature | [**PROGRESS.md**](../PROGRESS.md) / plano correspondente |
| Contrato de evento novo/alterado | [contracts/](../contracts/) + [ADR-015](../adr/015-event-versioning.md) |
| Procedimento operacional | [runbooks/](../runbooks/) |
| WHY não-óbvio no código (invariante escondida, workaround, restrição externa) | **comentário WHY** no próprio código |
| **Qualquer** mudança | **mensagem de commit** conventional descrevendo o porquê |

### Reconciliação com CONVENTIONS

O [CONVENTIONS.md](../CONVENTIONS.md) diz: *"default: NÃO escreva comentários; nunca explique o QUÊ"*. Isso **não** conflita com esta regra. "Documentar a função" significa registrar a **justificativa no lugar certo** — não poluir o código com o *o quê* (que o código já diz). Comentário só para WHY não-óbvio; o resto vai para ADR / commit / PROGRESS.

### Definition of Done (documental)

Uma mudança só está "pronta" quando:

- [ ] Código passa nos gates.
- [ ] A justificativa está documentada no lugar da tabela acima.
- [ ] Se mudou decisão arquitetural → ADR existe (regra dura, ver [git-workflow.md](./git-workflow.md)).
- [ ] Docs afetados tiveram o **Status/Última revisão** atualizados ([documentation-lifecycle.md](../documentation-lifecycle.md)).

> A DoD *completa* (testes, segurança, logs) fica para o 2º passo; a parte **documental** vale desde já.

---

## Veja também

- [decision-guide.md](./decision-guide.md) — o fluxograma que dispara "isto precisa de ADR?".
- [git-workflow.md](./git-workflow.md) — commits `docs:` e a regra dura de ADR.
- [../documentation-lifecycle.md](../documentation-lifecycle.md) — frescor dos docs.
- [../documentation-authority.md](../documentation-authority.md) — qual doc vence.
- [README.md](../README.md) — índice mestre.
