# app/(app)

Rotas das clínicas (consultório, kanban, financeiro UI, prontuário, etc).

**Status:** placeholder. **Camada:** C8+ popula UIs reais. Rotas aqui exigem auth de clínica.

Convenção: cada feature é uma pasta dentro do route group. Lógica de negócio NÃO mora aqui — vive em `src/contexts/<X>/`. Esta pasta apenas compõe UI + chama API interna do contexto.
