"""
Extrai o registro de inventário VR System (Náutica Balby) para CSV.

Fonte: docs/balby/PRODUTOS NAUTICA.pdf
Saída: docs/balby/produtos-nautica-balby.csv

Preserva preço de venda já extraído (mesmo SKU) quando o inventário
só traz custo e quantidade.

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
PDF = ROOT / "docs" / "balby" / "PRODUTOS NAUTICA.pdf"
OUT = ROOT / "docs" / "balby" / "produtos-nautica-balby.csv"

NUM = r"-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?"
# Unidades vistas no inventário (KIT em tinta/primer; o PDF cola UNID no nome).
KNOWN_UNITS = (
    "UNIDADE",
    "UNID",
    "LITROS",
    "LITRO",
    "PARES",
    "PAR",
    "GALAO",
    "GALÃO",
    "BALDE",
    "ROLO",
    "LATA",
    "FARDO",
    "SACO",
    "PCT",
    "JOGO",
    "TUBO",
    "PECA",
    "PEÇA",
    "KIT",
    "CX",
    "KG",
    "M2",
    "ML",
    "PC",
    "PÇ",
    "UN",
    "M",
    "GL",
)
UNIT_ALT = "|".join(KNOWN_UNITS)
# Localização (ex.: CX100) é opcional e começa com letra — não come quantidade.
LOC = r"[A-Za-z][A-Za-z0-9./_-]{0,19}"
ROW_RE = re.compile(
    rf"^(\d+)\s+(.+?)\s+({UNIT_ALT})\s+(?:({LOC})\s+)?({NUM})\s+({NUM})\s+({NUM})$",
    re.IGNORECASE,
)
GLUED_UNIT = re.compile(rf"(?<=\S)({UNIT_ALT})(?=\s+{NUM}\b)", re.IGNORECASE)
CODE_START = re.compile(r"^(\d+)\s+\S")
EXPECTED_ITEMS_RE = re.compile(r"Itens:\s*([\d.]+)", re.IGNORECASE)


def is_noise(line: str) -> bool:
    if not line:
        return True
    if line.startswith("-- ") and " of " in line:
        return True
    prefixes = (
        "Registro de invent",
        "Estoque com duas",
        "Filial:",
        "Código Produto",
        "Codigo Produto",
        "https://",
        "Página ",
        "Pagina ",
        "Total geral",
        "Itens:",
        "Média:",
        "Media:",
    )
    if line.startswith(prefixes):
        return True
    if re.match(r"^\d{1,2} de \w+ de \d{4}\b", line):
        return True
    return False


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
    if u == "PÇ":
        return "PC"
    return u[:10]


def try_parse(text: str) -> dict | None:
    collapsed = re.sub(r"\s+", " ", text).strip()
    collapsed = GLUED_UNIT.sub(r" \1", collapsed)
    m = ROW_RE.match(collapsed)
    if not m:
        return None
    code, name, unit, _loc, qty, cost, _total = m.groups()
    return {
        "sku": code,
        "nome": name.strip(),
        "unidade": map_unit(unit),
        "quantidade": parse_br(qty),
        "custo": parse_br(cost),
    }


def extract_lines(pdf_path: Path) -> tuple[list[str], int | None]:
    reader = PdfReader(str(pdf_path))
    lines: list[str] = []
    expected: int | None = None
    for page in reader.pages:
        text = page.extract_text() or ""
        m = EXPECTED_ITEMS_RE.search(text)
        if m:
            expected = int(m.group(1).replace(".", ""))
        for raw in text.splitlines():
            line = raw.strip()
            if is_noise(line):
                continue
            lines.append(line)
    return lines, expected


def group_records(lines: list[str]) -> tuple[list[str], list[str]]:
    records: list[str] = []
    skipped: list[str] = []
    buf = ""
    for line in lines:
        starts_code = CODE_START.match(line) is not None
        if starts_code:
            if buf and try_parse(buf):
                records.append(buf)
                buf = line
                continue
            if not buf:
                buf = line
                continue
            # Nome quebrado começando com número ("15 HP") vs produto novo.
            if try_parse(line) and not try_parse(f"{buf} {line}".strip()):
                skipped.append(buf)
                buf = line
                continue
            buf = f"{buf} {line}".strip()
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


def load_previous_prices(csv_path: Path) -> dict[str, str]:
    if not csv_path.exists():
        return {}
    text = csv_path.read_text(encoding="utf-8").replace("\ufeff", "")
    rows = list(csv.DictReader(text.splitlines(), delimiter=";"))
    out: dict[str, str] = {}
    for row in rows:
        sku = (row.get("sku") or "").strip()
        price = (row.get("preco_venda") or "").strip()
        if sku and price and price not in ("0", "0.0"):
            out[sku] = price
    return out


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"PDF não encontrado: {PDF}")
    prev_prices = load_previous_prices(OUT)
    lines, expected = extract_lines(PDF)
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
                    "preco_venda": prev_prices.get(row["sku"], "0"),
                    "custo": fmt_num(row["custo"]),
                    "quantidade": fmt_num(row["quantidade"]),
                    "unidade": row["unidade"],
                }
            )

    skus = [int(r["sku"]) for r in rows]
    unique = len(set(skus))
    neg = sum(1 for r in rows if r["quantidade"] < 0)
    zero_cost = sum(1 for r in rows if r["custo"] == 0)
    priced = sum(1 for r in rows if prev_prices.get(r["sku"]))
    print(f"CSV: {OUT}")
    print(f"Fonte: {PDF.name}")
    print(f"Produtos: {len(rows)} (SKUs únicos: {unique})")
    if expected is not None:
        print(f"Itens no rodapé do PDF: {expected}")
    print(f"Estoque negativo: {neg}")
    print(f"Custo zero: {zero_cost}")
    print(f"Preço de venda herdado do CSV anterior: {priced}")
    print(f"Linhas não lidas: {len(failed)}")
    if failed:
        print("--- falhas ---")
        for item in failed[:30]:
            print(item[:300])
    if skipped:
        print(f"Trechos ignorados após linha já completa: {len(skipped)}")
        for item in skipped[:12]:
            print("  ", item[:200])
    if failed:
        sys.exit(1)
    if expected is not None and len(rows) != expected:
        print(f"AVISO: extraidos {len(rows)} != {expected} itens do PDF.")


if __name__ == "__main__":
    main()
