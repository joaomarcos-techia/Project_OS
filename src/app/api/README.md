# app/api

Route handlers HTTP (webhooks Meta, callbacks Asaas, jobs invocáveis).

**Status:** placeholder. **Camada:** primeiras rotas em C4 (worker trigger) ou C10 (webhook Meta).

Convenção: prefira Server Actions para mutações originadas pela própria UI. Use `api/` para integrações externas (webhooks) ou endpoints invocados por terceiros.
