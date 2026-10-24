"""
Extrai o relatório VR System (Náutica Balby) para CSV de cadastro.

Uso (na raiz do repo):
  python apps/api/scripts/extract-balby-products.py
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "docs" / "balby" / "PRODUTOS NAUTICA BALBY.pdf"
OUT = ROOT / "docs" / "balby" / "produtos-nautica-balby.csv"

NUM = r"-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?"
# Unidades vistas no relatório: UNID, KG, M, LITRO, PARES, M2. O PDF às vezes cola a unidade no nome (2TUNID).
UNIT = r"[A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç0-9.]{0,11}"
ROW_RE = re.compile(
    rf"^(\d+)\s+(.+)\s+({UNIT})\s+({NUM})\s+({NUM})\s+({NUM})(?:\s+({NUM})%)?$"
)
GLUED_UNIT = re.compile(rf"(?<=\S)(UNID|LITRO|PARES|KG|M2)(?=\s+{NUM}\b)")
CODE_START = re.compile(r"^\d+\s+\S")


def is_noise(line: str) -> bool:
    if not line:
        return True
    if line.startswith("-- ") and " of " in line:
        return True
    prefixes = (
        "Estoque com duas",
        "Filial:",
        "Código Produto",
        "Codigo Produto",
        "https://",
        "Página ",
        "Pagina ",
        "Total geral",
        "Média:",
        "Media:",
    )
    return line.startswith(prefixes)


def parse_br(raw: str) -> float:
    s = raw.strip()
    neg = s.startswith("-")
    if neg:
        s = s[1:]
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "." in s:
        parts = s.split(".")
        if len(parts) > 1 and all(len(p) == 3 for p in parts[1:]):
            s = "".join(parts)
    n = float(s)
    return -n if neg else n


def fmt_num(n: float) -> str:
    s = f"{n:.4f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-") else "0"


def map_unit(unit: str) -> str:
    u = unit.strip().upper().rstrip(".")
    if u in ("UNID", "UNIDADE"):
        return "UN"
    return u[:10]


def try_parse(text: str) -> dict | None:
    collapsed = re.sub(r"\s+", " ", text).strip()
    collapsed = GLUED_UNIT.sub(r" \1", collapsed)
    m = ROW_RE.match(collapsed)
    if not m:
        return None
    code, name, unit, qty, cost, price, _pct = m.groups()
    return {
        "sku": code,
        "nome": name.strip(),
        "unidade": map_unit(unit),
        "quantidade": parse_br(qty),
        "custo": parse_br(cost),
        "preco_venda": parse_br(price),
    }


def extract_lines(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    lines: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw in text.splitlines():
            line = raw.strip()
            if is_noise(line):
                continue
            lines.append(line)
    return lines


def leading_code(line: str) -> int | None:
    m = re.match(r"^(\d+)\s+\S", line)
    if not m:
        return None
    return int(m.group(1))


def group_records(lines: list[str]) -> tuple[list[str], list[str]]:
    records: list[str] = []
    skipped: list[str] = []
    buf = ""
    last_code = 0
    for line in lines:
        code = leading_code(line)
        # "15 HP" no meio do nome não é um produto novo; o código do ERP só cresce.
        if code is not None and code > last_code:
            if buf:
                records.append(buf)
            buf = line
            last_code = code
            continue
        if not buf:
            skipped.append(line)
            continue
        if try_parse(buf):
            skipped.append(line)
            continue
        buf = f"{buf} {line}".strip()
    if buf:
        records.append(buf)
    return records, skipped


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"PDF não encontrado: {PDF}")
    lines = extract_lines(PDF)
    records, skipped = group_records(lines)
    rows: list[dict] = []
    failed: list[str] = []
    for rec in records:
        parsed = try_parse(rec)
        if parsed is None:
            failed.append(rec)
        else:
            rows.append(parsed)

    rows.sort(key=lambda r: int(r["sku"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["nome", "sku", "codigo_barras", "preco_venda", "custo", "quantidade", "unidade"],
            delimiter=";",
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "nome": row["nome"],
                    "sku": row["sku"],
                    "codigo_barras": "",
                    "preco_venda": fmt_num(row["preco_venda"]),
                    "custo": fmt_num(row["custo"]),
                    "quantidade": fmt_num(row["quantidade"]),
                    "unidade": row["unidade"],
                }
            )

    skus = [int(r["sku"]) for r in rows]
    missing = [n for n in range(1, (max(skus) if skus else 0) + 1) if n not in set(skus)]
    neg = sum(1 for r in rows if r["quantidade"] < 0)
    zero_price = sum(1 for r in rows if r["preco_venda"] == 0)
    zero_cost = sum(1 for r in rows if r["custo"] == 0)
    print(f"CSV: {OUT}")
    print(f"Produtos: {len(rows)}")
    print(f"Estoque negativo: {neg}")
    print(f"Preço de venda zero: {zero_price}")
    print(f"Custo zero: {zero_cost}")
    print(f"Linhas não lidas: {len(failed)}")
    print(f"Códigos ausentes no PDF entre 1 e {max(skus) if skus else 0}: {len(missing)}")
    if failed:
        print("--- falhas ---")
        for item in failed:
            print(item[:300])
    if skipped:
        print(f"Trechos ignorados após linha já completa: {len(skipped)}")
        for item in skipped[:12]:
            print("  ", item[:200])
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
