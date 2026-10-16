#!/usr/bin/env python3
"""Generate src/lib/canada-defaults.generated.ts from the Canada CSV sources."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COA_PATH = ROOT / "Canada_Small_Business_Chart_of_Accounts_Updated (1).csv"
RULES_PATH = ROOT / "Canada_Bookkeeping_Rules_Mapped_to_Accounts.csv"
OUT_PATH = Path(__file__).resolve().parents[1] / "src/lib/canada-defaults.generated.ts"

TYPE_MAP = {
    "Asset": "ASSET",
    "Liability": "LIABILITY",
    "Equity": "EQUITY",
    "Income": "INCOME",
    "Expense": "EXPENSE",
}
MATCH_MAP = {
    "Contains": "CONTAINS",
    "Starts": "STARTS",
    "Starts with": "STARTS",
    "Exact": "EXACT",
    "Regex": "REGEX",
}
APPLIES_MAP = {
    "Both": "BOTH",
    "Bank": "BANK",
    "Credit Card": "CREDIT_CARD",
}
TAX_MODE_MAP = {
    "Inclusive": "INCLUSIVE",
    "Exclusive": "EXCLUSIVE",
    "Keep": "KEEP",
}


def esc(value: object) -> str:
    return json.dumps(value)


def norm_tax(code: str | None) -> str | None:
    if code is None:
        return None
    c = code.strip()
    if not c:
        return None
    c = c.replace("GST25", "GST2.5")
    return c


def main() -> None:
    accounts = []
    with COA_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            number = (row.get("Account Number") or "").strip()
            name = (row.get("Account / Category Name") or "").strip()
            typ = TYPE_MAP.get((row.get("Account Type") or "").strip())
            gst = norm_tax(row.get("Default GST/HST"))
            pst = norm_tax(row.get("Default PST/QST/RST"))
            if not number or not name or not typ:
                continue
            accounts.append(
                {
                    "number": number,
                    "name": name,
                    "type": typ,
                    "defaultGstCode": None if gst in (None, "NONE") else gst,
                    "defaultPstCode": None if pst in (None, "NONE") else pst,
                }
            )

    rules = []
    with RULES_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("Rule Name") or "").strip()
            match = (row.get("Description Match") or "").strip()
            if not name or not match:
                continue
            gst = norm_tax(row.get("GST / HST"))
            pst = norm_tax(row.get("PST / QST / RST"))
            sales = None if not gst or gst == "NONE" else gst
            province = None if not pst or pst == "NONE" else pst
            tax_codes: list[str] = []
            if sales:
                tax_codes.append(sales)
            elif gst == "NONE":
                tax_codes.append("NONE")
            province_codes = [province] if province else []
            rules.append(
                {
                    "name": name,
                    "descriptionMatch": match,
                    "matchType": MATCH_MAP.get(
                        (row.get("Match Type") or "Contains").strip(), "CONTAINS"
                    ),
                    "appliesTo": APPLIES_MAP.get(
                        (row.get("Applies To") or "Both").strip(), "BOTH"
                    ),
                    "applyDeposit": (row.get("Deposit") or "TRUE").strip().upper()
                    == "TRUE",
                    "applyWithdrawal": (row.get("Withdrawal") or "TRUE").strip().upper()
                    == "TRUE",
                    "accountNumber": (row.get("Account Number") or "").strip() or None,
                    "accountName": (row.get("Category / Account") or "").strip() or None,
                    "taxCodes": tax_codes,
                    "provinceTaxCodes": province_codes,
                    "taxMode": TAX_MODE_MAP.get(
                        (row.get("Tax Treatment") or "Inclusive").strip(), "INCLUSIVE"
                    ),
                    "active": (row.get("Active") or "TRUE").strip().upper() == "TRUE",
                }
            )

    tax_defs = [
        ("NONE", "No Tax", 0, "NONE", None),
        ("GST5", "GST 5% (Sales Tax)", 5, "GST_HST", None),
        ("GST2.5", "GST 2.5% meals (Sales Tax)", 2.5, "GST_HST", None),
        ("HST13", "HST 13% ON (Sales Tax)", 13, "GST_HST", "ON"),
        ("HST15", "HST 15% Atlantic (Sales Tax)", 15, "GST_HST", None),
        ("ZERO", "Zero-rated (Sales Tax)", 0, "GST_HST", None),
        ("EXEMPT", "Exempt", 0, "NONE", None),
        ("BC PST7", "BC PST 7% (Province Tax)", 7, "PST", "BC"),
        ("SK PST6", "SK PST 6% (Province Tax)", 6, "PST", "SK"),
        ("MB RST7", "MB RST 7% (Province Tax)", 7, "PST", "MB"),
        ("QST9975", "QST 9.975% (Province Tax)", 9.975, "PST", "QC"),
    ]

    lines = [
        "/** Auto-generated from Canada COA + Bookkeeping Rules CSVs. */",
        "/** Re-run: python3 scripts/generate-defaults-from-csv.py */",
        "",
        "export const DEFAULT_TAX_CODES = [",
    ]
    for code, name, rate, kind, prov in tax_defs:
        prov_js = "null" if prov is None else esc(prov)
        lines.append(
            f"  {{ code: {esc(code)}, name: {esc(name)}, rate: {rate}, kind: {esc(kind)} as const, province: {prov_js} }},"
        )
    lines.append("] as const;")
    lines.append("")
    lines.append("export const DEFAULT_CHART_ACCOUNTS = [")
    for a in accounts:
        gst = "null" if a["defaultGstCode"] is None else esc(a["defaultGstCode"])
        pst = "null" if a["defaultPstCode"] is None else esc(a["defaultPstCode"])
        lines.append(
            "  {"
            f" number: {esc(a['number'])},"
            f" name: {esc(a['name'])},"
            f" type: {esc(a['type'])} as const,"
            f" defaultGstCode: {gst},"
            f" defaultPstCode: {pst}"
            " },"
        )
    lines.append("] as const;")
    lines.append("")
    lines.append("export const DEFAULT_RULES = [")
    for r in rules:
        lines.append(
            "  {"
            f" name: {esc(r['name'])},"
            f" descriptionMatch: {esc(r['descriptionMatch'])},"
            f" matchType: {esc(r['matchType'])} as const,"
            f" appliesTo: {esc(r['appliesTo'])} as const,"
            f" applyDeposit: {str(r['applyDeposit']).lower()},"
            f" applyWithdrawal: {str(r['applyWithdrawal']).lower()},"
            f" accountNumber: {esc(r['accountNumber']) if r['accountNumber'] else 'null'},"
            f" accountName: {esc(r['accountName']) if r['accountName'] else 'null'},"
            f" taxCodes: {json.dumps(r['taxCodes'])} as string[],"
            f" provinceTaxCodes: {json.dumps(r['provinceTaxCodes'])} as string[],"
            f" taxMode: {esc(r['taxMode'])} as const,"
            f" active: {str(r['active']).lower()}"
            " },"
        )
    lines.append("] as const;")
    lines.append("")

    OUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(accounts)} accounts, {len(rules)} rules)")


if __name__ == "__main__":
    main()
