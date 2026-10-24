"""
Extrai o cadastro de clientes VR System (Náutica Balby) para CSV.

Fonte: docs/balby/CLIENTES NAUTICA BALBY.pdf
Saída: docs/balby/clientes-nautica-balby.csv

Uso (na raiz do repo):
  python apps/api/scripts/extract-balby-customers.py
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "docs" / "balby" / "CLIENTES NAUTICA BALBY.pdf"
OUT = ROOT / "docs" / "balby" / "clientes-nautica-balby.csv"

CODE_RE = re.compile(r"^(\d{1,4})\s+(.*)$")
FIELD_RE = re.compile(
    r"^(Telefone|CPF|CNPJ|RG|IE|Nascimento|Email|E-mail)\s*:\s*(.+)$",
    re.IGNORECASE,
)
INLINE_FIELD_RE = re.compile(
    r"(Telefone|CPF|CNPJ|RG|IE|Nascimento|Email|E-mail)\s*:\s*",
    re.IGNORECASE,
)
CITY_UF_RE = re.compile(r"\b([A-Za-zÀ-ÿ .'-]+)-([A-Z]{2})\s*$")
ADDR_START = re.compile(
    r"^(,|RUA\b|R\.|AV\.|AVENIDA\b|ESTRADA\b|TRAVESSA\b|BVD\b|COMUNIDADE\b|"
    r"IGARAP[ÉE]\b|MARGEM\b|RODOVIA\b|ALAMEDA\b|PRA[ÇC]A\b|BECO\b)",
    re.IGNORECASE,
)
TOTAL_RE = re.compile(r"Total de registros:\s*(\d+)", re.IGNORECASE)
NOISE_PREFIXES = (
    "Relatório cadastro",
    "Relatorio cadastro",
    "Tipo:",
    "Inicio:",
    "Início:",
    "Código Nome",
    "Codigo Nome",
    "https://",
    "Página ",
    "Pagina ",
    "Total de registros",
)


def is_noise(line: str) -> bool:
    if not line:
        return True
    if line.startswith(NOISE_PREFIXES):
        return True
    if re.match(r"^\d{1,2} de \w+ de \d{4}\b", line):
        return True
    return False


def split_inline_fields(line: str) -> list[tuple[str, str]]:
    matches = list(INLINE_FIELD_RE.finditer(line))
    if not matches:
        return []
    out: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
        value = line[m.end() : end].strip(" ,;")
        out.append((m.group(1).upper(), value))
    return out


def only_digits(raw: str) -> str:
    return re.sub(r"\D", "", raw or "")


def normalize_phone(raw: str) -> str:
    digits = only_digits(raw)
    if len(digits) >= 10:
        # Remove DDI 55 quando vier junto; some relatórios prefixam 0.
        if digits.startswith("55") and len(digits) >= 12:
            digits = digits[2:]
        if digits.startswith("0") and len(digits) >= 11:
            digits = digits[1:]
        return digits[:13]
    return digits or raw.strip()


def parse_birth(raw: str) -> str:
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if not m:
        return ""
    d, mo, y = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return f"{y:04d}-{mo:02d}-{d:02d}"


def parse_address(line: str) -> dict[str, str]:
    raw = re.sub(r"\s+", " ", line).strip().strip(",")
    city_m = CITY_UF_RE.search(raw)
    city = ""
    state = ""
    rest = raw
    if city_m:
        city = city_m.group(1).strip(" ,")
        state = city_m.group(2).upper()
        rest = raw[: city_m.start()].rstrip(" ,")
    parts = [p.strip() for p in rest.split(",") if p.strip()]
    street = ""
    number = ""
    district = ""
    complement = ""
    if not parts:
        if not city and raw:
            city = raw
    elif len(parts) == 1:
        if parts[0].startswith(",") or not city:
            city = city or parts[0].lstrip(", ").strip()
        else:
            street = parts[0]
    elif len(parts) == 2:
        street, maybe = parts
        if re.search(r"\d|S/?N|N[º°]", maybe, re.I):
            number = maybe
        else:
            district = maybe
    else:
        street = parts[0]
        number = parts[1]
        district = parts[-1]
        if len(parts) > 3:
            complement = ", ".join(parts[2:-1])
    if number.upper() in {"S/N", "SN", "S\\N"}:
        number = "S/N"
    return {
        "street": street[:180],
        "number": number[:20],
        "complement": complement[:120],
        "district": district[:80],
        "city": city[:80],
        "state": state[:2],
    }


def looks_like_address(line: str) -> bool:
    if ADDR_START.match(line):
        return True
    if CITY_UF_RE.search(line):
        return True
    if line.startswith(",") and len(line) > 2:
        return True
    return False


def new_record(code: str, name: str) -> dict:
    return {
        "codigo_vr": code,
        "nome": name.strip(),
        "documento": "",
        "telefone": "",
        "email": "",
        "nascimento": "",
        "street": "",
        "number": "",
        "complement": "",
        "district": "",
        "city": "",
        "state": "",
        "ie": "",
        "rg": "",
        "notes_extra": "",
    }


def apply_field(rec: dict, key: str, value: str) -> None:
    k = key.upper()
    if k == "TELEFONE":
        phone = normalize_phone(value)
        if phone and not rec["telefone"]:
            rec["telefone"] = phone
        elif phone and phone not in rec["telefone"]:
            rec["telefone"] = f"{rec['telefone']};{phone}"
        return
    if k in ("CPF", "CNPJ"):
        digits = only_digits(value)
        if digits and not rec["documento"]:
            rec["documento"] = digits
        return
    if k == "NASCIMENTO":
        rec["nascimento"] = parse_birth(value) or rec["nascimento"]
        return
    if k == "RG":
        rec["rg"] = value.strip()
        return
    if k == "IE":
        rec["ie"] = value.strip()
        return
    if k in ("EMAIL", "E-MAIL"):
        rec["email"] = value.strip()


def apply_line(rec: dict, line: str) -> None:
    inline = split_inline_fields(line)
    if inline:
        prefix = line[: INLINE_FIELD_RE.search(line).start()].strip(" ,;")
        if prefix and looks_like_address(prefix):
            addr = parse_address(prefix)
            for k, v in addr.items():
                if v and not rec[k]:
                    rec[k] = v
        for key, value in inline:
            apply_field(rec, key, value)
        return
    if looks_like_address(line):
        addr = parse_address(line)
        for k, v in addr.items():
            if v and not rec[k]:
                rec[k] = v
        return
    extra = line.strip()
    if extra:
        rec["nome"] = f"{rec['nome']} {extra}".strip()


def extract_records(pdf_path: Path) -> tuple[list[dict], int | None]:
    reader = PdfReader(str(pdf_path))
    expected: int | None = None
    records: list[dict] = []
    current: dict | None = None
    for page in reader.pages:
        text = page.extract_text() or ""
        m = TOTAL_RE.search(text)
        if m:
            expected = int(m.group(1))
        for raw in text.splitlines():
            line = raw.strip()
            if is_noise(line):
                continue
            code_m = CODE_RE.match(line)
            if code_m and not INLINE_FIELD_RE.match(line):
                if current:
                    records.append(current)
                current = new_record(code_m.group(1), code_m.group(2))
                continue
            if current is None:
                continue
            apply_line(current, line)
    if current:
        records.append(current)
    return records, expected


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"PDF não encontrado: {PDF}")
    rows, expected = extract_records(PDF)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "codigo_vr",
        "nome",
        "documento",
        "telefone",
        "email",
        "nascimento",
        "street",
        "number",
        "complement",
        "district",
        "city",
        "state",
        "ie",
        "rg",
        "notes_extra",
    ]
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    docs = sum(1 for r in rows if r["documento"])
    phones = sum(1 for r in rows if r["telefone"])
    cities = sum(1 for r in rows if r["city"])
    print(f"CSV: {OUT}")
    print(f"Clientes: {len(rows)}")
    if expected is not None:
        print(f"Total no rodapé do PDF: {expected}")
    print(f"Com documento: {docs}")
    print(f"Com telefone: {phones}")
    print(f"Com cidade: {cities}")
    if expected is not None and len(rows) != expected:
        print(f"AVISO: extraidos {len(rows)} != {expected} clientes.")
        sys.exit(1)


if __name__ == "__main__":
    main()
