# Definition of Done

## Status

Canonical — condição para concluir uma mudança.

- comportamento solicitado implementado sem ampliar escopo;
- tipos e validação de entrada corretos; erros e casos-limite tratados;
- teste novo/ajustado cobre qualquer mudança de comportamento;
- documentação canônica afetada atualizada;
- nenhum segredo, debug, TODO resolvido, teste desabilitado ou erro engolido;
- `format:check`, typecheck, lint, checks arquiteturais, testes/cobertura e build verdes;
- diff relido, focado e sem alterações preexistentes incorporadas por acidente;
- bordas não testadas são declaradas como `NOT TESTED`/`REQUIRES_MANUAL_VALIDATION`;
- migration, deploy, provider live ou operação destrutiva só foram executados com autorização.

Checklist executável: [development/testing.md](../development/testing.md).
