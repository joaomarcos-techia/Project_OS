"""Validação independente do corpus TISS 4.03.00 (c1) com a biblioteca aberta da Voa (`tiss`, PyPI).

Só dados sintéticos (o corpus do repositório). A biblioteca roda OFFLINE: este script bloqueia
qualquer conexão de rede antes de importá-la, e falha se alguma for tentada.

Para cada XML do manifesto: confere o sha256, roda `tiss.validate`, separa as camadas (XSD,
hash do epílogo, codificação, versão e regras) e compara com a expectativa do manifesto e com
os dois motores XSD já usados (xmllint-wasm/libxml2 e System.Xml.Schema/.NET). Também compara,
byte a byte, os XSD 4.03.00 embutidos na biblioteca com os do Qoro.

    python -I scripts/tiss/corpus/validate-voa.py            # grava VOA_RESULTS.json
    python -I scripts/tiss/corpus/validate-voa.py --check    # CI: falha se divergir do gravado

Sai com código 1 se: a camada XSD da Voa discordar dos outros dois motores; o hash adulterado
não for detectado; um arquivo do manifesto mudar; ou (com --check) o resultado divergir do
gravado.
"""

from __future__ import annotations

import hashlib
import json
import socket
import sys
from importlib import metadata
from pathlib import Path


def _no_network(*_args: object, **_kwargs: object) -> None:
    raise RuntimeError("rede bloqueada: a validação do corpus é offline")


socket.socket.connect = _no_network  # type: ignore[method-assign]
socket.socket.connect_ex = _no_network  # type: ignore[method-assign,assignment]
socket.create_connection = _no_network  # type: ignore[assignment]
socket.getaddrinfo = _no_network  # type: ignore[assignment]

import tiss  # noqa: E402  (depois do bloqueio de rede, de propósito)
from lxml import etree  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CORPUS = ROOT / "data/tiss/corpus/4.03.00/c1"
OURS_XSD = ROOT / "src/contexts/health-insurance/tiss/schemas/4.03.00"
OUT = CORPUS / "VOA_RESULTS.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def schema_comparison() -> dict[str, object]:
    voa_dir = Path(tiss.__file__).parent / "_data/schemas/4.03.00"
    voa = {p.name: sha256(p.read_bytes()) for p in sorted(voa_dir.glob("*.xsd"))}
    ours = {p.name: sha256(p.read_bytes()) for p in sorted(OURS_XSD.glob("*.xsd"))}
    names = sorted(set(voa) | set(ours))
    rows = [
        {
            "file": n,
            "qoro": ours.get(n),
            "voa": voa.get(n),
            "same": ours.get(n) is not None and ours.get(n) == voa.get(n),
        }
        for n in names
    ]
    return {"files": rows, "allSame": all(r["same"] for r in rows)}


def layers(report: object) -> dict[str, object]:
    findings = [f.to_dict() for f in report.findings]  # type: ignore[attr-defined]
    codes = sorted({f["code"] for f in findings})
    errors = sorted({f["code"] for f in findings if f["severity"] == "error"})
    warnings = sorted({f["code"] for f in findings if f["severity"] == "warning"})
    malformed = "xml.malformado" in codes
    encoding = any(c.startswith("xml.encoding") for c in codes)
    return {
        "valid": bool(report.valid),  # type: ignore[attr-defined]
        "version": report.version,  # type: ignore[attr-defined]
        # XML que nem é lido (truncado) não passa em XSD nenhum, como nos outros dois motores.
        "xsdValid": not malformed and not any(c.startswith("xsd.") for c in codes),
        # Codificação recusada antes do parse: a Voa não chega ao XSD nem ao hash.
        "xsdEvaluated": not encoding,
        "hashEvaluated": not malformed and not encoding,
        "hashMismatch": "lote.hash_divergente" in codes,
        "encodingIssue": encoding,
        "malformed": malformed,
        "versionIssue": any(c.startswith("versao.") for c in codes),
        "errorCodes": errors,
        "warningCodes": warnings,
        "ruleErrorCodes": [
            c for c in errors if not c.startswith(("xsd.", "xml.", "versao.")) and c != "lote.hash_divergente"
        ],
    }


def main() -> int:
    check = "--check" in sys.argv
    manifest = json.loads((CORPUS / "MANIFEST.json").read_text(encoding="utf-8"))
    libxml = {r["id"]: r for r in json.loads((CORPUS / "XSD_RESULTS.json").read_text(encoding="utf-8"))["results"]}
    dotnet = {r["id"]: r for r in json.loads((CORPUS / "XSD_RESULTS_DOTNET.json").read_text(encoding="utf-8"))["results"]}

    problems: list[str] = []
    results = []
    for s in manifest["scenarios"]:
        path = CORPUS / s["file"] if s.get("file") else None
        if path is None or not path.exists():
            results.append({"id": s["id"], "file": None, "note": "sem arquivo por desenho (o montador recusa)"})
            continue
        raw = path.read_bytes()
        if sha256(raw) != s["sha256"]:
            problems.append(f"{s['id']}: sha256 do arquivo diferente do manifesto")
        voa = layers(tiss.validate(raw))
        rejected = set(s.get("rejectedBy") or [])
        expected_xsd_valid = "xsd" not in rejected
        xsd_agree = (not voa["xsdEvaluated"]) or (
            voa["xsdValid"] == libxml[s["id"]]["xsdValid"] == dotnet[s["id"]]["xsdValid"]
        )
        if not xsd_agree:
            problems.append(f"{s['id']}: camada XSD da Voa ({voa['xsdValid']}) diverge dos dois motores")
        # Hash do epílogo (implementação independente da nossa): adulterado = "hash" esperado.
        hash_agree = (not voa["hashEvaluated"]) or (voa["hashMismatch"] == ("hash" in rejected))
        if not hash_agree:
            problems.append(f"{s['id']}: hash do epílogo da Voa ({voa['hashMismatch']}) diverge do esperado")
        if "hash" in rejected and not (voa["hashMismatch"] or voa["encodingIssue"] or voa["malformed"] or not voa["xsdValid"]):
            problems.append(f"{s['id']}: adulteração do hash/codificação não detectada")
        detected = not voa["valid"]
        results.append(
            {
                "id": s["id"],
                "file": s["file"],
                "sha256": s["sha256"],
                "expected": s["expected"],
                "rejectedBy": sorted(rejected),
                "qoroIssues": [i.get("code", i) if isinstance(i, dict) else i for i in (s.get("expectedIssues") or [])],
                "xsd": {
                    "expectedValid": expected_xsd_valid,
                    "libxml2Wasm": libxml[s["id"]]["xsdValid"],
                    "dotnet": dotnet[s["id"]]["xsdValid"],
                    "voa": voa["xsdValid"] if voa["xsdEvaluated"] else None,
                    "agree": xsd_agree,
                },
                "hash": {"evaluated": voa["hashEvaluated"], "voaMismatch": voa["hashMismatch"], "agree": hash_agree},
                "voa": voa,
                "outcome": (
                    "concorda: válido" if s["expected"] == "valid" and not detected
                    else "concorda: recusado" if s["expected"] != "valid" and detected
                    else "falso positivo (Voa recusa um válido)" if s["expected"] == "valid"
                    else "não detectado pela Voa"
                ),
            }
        )

    summary = {
        "files": sum(1 for r in results if r.get("file")),
        "xsdEvaluated": sum(1 for r in results if r.get("file") and r["xsd"]["voa"] is not None),
        "xsdAgreement": sum(1 for r in results if r.get("file") and r["xsd"]["voa"] is not None and r["xsd"]["agree"]),
        "hashEvaluated": sum(1 for r in results if r.get("file") and r["hash"]["evaluated"]),
        "hashAgreement": sum(1 for r in results if r.get("file") and r["hash"]["evaluated"] and r["hash"]["agree"]),
        "agreeValid": sum(1 for r in results if r.get("outcome") == "concorda: válido"),
        "agreeRejected": sum(1 for r in results if r.get("outcome") == "concorda: recusado"),
        "falsePositives": [r["id"] for r in results if r.get("outcome", "").startswith("falso positivo")],
        "notDetected": [r["id"] for r in results if r.get("outcome") == "não detectado pela Voa"],
    }
    out = {
        "corpus": manifest["corpus"],
        "tool": "tiss (Voa Health, Apache-2.0)",
        "toolVersion": metadata.version("tiss"),
        "lxml": metadata.version("lxml"),
        "libxml2": ".".join(str(p) for p in etree.LIBXML_VERSION),
        "python": sys.version.split()[0],
        "network": "bloqueada (socket) durante toda a validação",
        "schemas": schema_comparison(),
        "summary": summary,
        "results": results,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    if check:
        recorded = json.loads(OUT.read_text(encoding="utf-8"))
        # O ambiente pode mudar (Python, lxml do runner); o que se compara é o resultado.
        for key in ("python", "lxml", "libxml2"):
            recorded.pop(key, None)
            out.pop(key, None)
        if recorded != out:
            problems.append("resultado diferente do VOA_RESULTS.json gravado (rodar sem --check e revisar)")
    else:
        OUT.write_text(text, encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    print(f"esquemas iguais aos do Qoro: {out['schemas']['allSame']}")
    for p in problems:
        print(f"PROBLEMA: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
