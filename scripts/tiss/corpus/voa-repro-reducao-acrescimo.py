"""Reprodução mínima do falso positivo da Voa `tiss` (0.5.0) com fator de redução/acréscimo.

Só o corpus sintético do repositório (V2c-sadt-itens-variados.xml), OFFLINE (rede bloqueada antes de importar).

O item 2 da guia SP/SADT tem quantidadeExecutada 3, valorUnitario 33,33, reducaoAcrescimo 0,70 e valorTotal 69,99
(3 × 33,33 × 0,70 = 69,993 → 69,99). A regra `item.valor_divergente` de `validate()` compara só unitário ×
quantidade (99,99) e acusa divergência; o próprio cálculo da biblioteca para a linha usa o fator.

    python -I scripts/tiss/corpus/voa-repro-reducao-acrescimo.py

Saída: `REPRODUZIDO` (código 0) enquanto o defeito existir; `CORRIGIDO` (código 0) quando a regra passar a usar o
fator — sinal para retirar a exceção registrada em VOA_RESULTS.json. Código 1 só se o arquivo mudar.
"""

from __future__ import annotations

import hashlib
import socket
import sys
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path


def _no_network(*_args: object, **_kwargs: object) -> None:
    raise RuntimeError("rede bloqueada: reprodução offline")


socket.socket.connect = _no_network  # type: ignore[method-assign]
socket.socket.connect_ex = _no_network  # type: ignore[method-assign,assignment]
socket.create_connection = _no_network  # type: ignore[assignment]
socket.getaddrinfo = _no_network  # type: ignore[assignment]

import tiss  # noqa: E402
from lxml import etree  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FILE = ROOT / "data/tiss/corpus/4.03.00/c1/V2c-sadt-itens-variados.xml"
NS = {"ans": "http://www.ans.gov.br/padroes/tiss/schemas"}
ITEM = "/ans:mensagemTISS/ans:prestadorParaOperadora/ans:loteGuias/ans:guiasTISS/ans:guiaSP-SADT/ans:procedimentosExecutados/ans:procedimentoExecutado[2]"


def main() -> int:
    raw = FILE.read_bytes()
    print(f"arquivo: {FILE.name} sha256 {hashlib.sha256(raw).hexdigest()}")
    doc = etree.fromstring(raw)
    item = doc.xpath(ITEM, namespaces=NS)
    if len(item) != 1:
        print("o item 2 não está no arquivo: o corpus mudou")
        return 1
    get = lambda tag: Decimal(item[0].findtext(f"ans:{tag}", namespaces=NS))  # noqa: E731
    qtd, unit, fator, total = get("quantidadeExecutada"), get("valorUnitario"), get("reducaoAcrescimo"), get("valorTotal")
    esperado = (qtd * unit * fator).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
    print(f"item 2: {qtd} x {unit} x {fator} = {qtd * unit * fator} -> {esperado}; valorTotal no XML {total}")
    if esperado != total:
        print("o XML do corpus não fecha com o fator: o corpus mudou")
        return 1
    hits = [
        f.to_dict()  # type: ignore[attr-defined]
        for f in tiss.validate(raw).findings  # type: ignore[attr-defined]
        if f.to_dict().get("code") == "item.valor_divergente" and str(f.to_dict().get("xpath", "")).endswith("procedimentoExecutado[2]/ans:valorTotal")  # type: ignore[attr-defined]
    ]
    version = getattr(tiss, "__version__", None)
    if version is None:
        from importlib import metadata

        version = metadata.version("tiss")
    if hits:
        print(f"REPRODUZIDO na tiss {version}: {hits[0]['code']} em {hits[0]['xpath']}")
    else:
        print(f"CORRIGIDO na tiss {version}: a regra não acusa mais o item com fator")
    return 0


if __name__ == "__main__":
    sys.exit(main())
