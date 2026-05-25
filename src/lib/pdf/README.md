# lib/pdf

Geração de PDFs (prescrição, atestado, exames, comprovantes).

**Status:** vazio. **Camada:** C7 preenche.

C7 vai criar:
- `renderer.ts` wrapper sobre lib de PDF escolhida (pdfkit, react-pdf, ou puppeteer headless — decisão em C7)
- Templates por tipo de documento
- Sem dados clínicos hardcoded (recebe payload tipado, renderiza)
