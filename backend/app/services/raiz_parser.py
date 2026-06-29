"""Parse Raiz (formerly Acorns AU) PDF statements to extract balance and transactions."""
import re
from typing import Optional


def _clean_money(s: str) -> Optional[int]:
    """Convert '$1,234.56' or '1234.56' string to cents."""
    if not s:
        return None
    s = re.sub(r"[,$\s]", "", s)
    try:
        return int(round(float(s) * 100))
    except ValueError:
        return None


def parse_raiz_pdf(content: bytes) -> dict:
    """
    Extract key data from a Raiz statement PDF.
    Returns dict with: balance_cents, portfolio_value_cents, transactions, period, raw_text.
    """
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber is required: pip install pdfplumber")

    import io
    text_pages = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_pages.append(t)

    full_text = "\n".join(text_pages)

    result = {
        "balance_cents": None,
        "portfolio_value_cents": None,
        "transactions": [],
        "period": None,
        "platform": "Raiz",
        "raw_text": full_text[:2000],  # preview only
    }

    # ── Period ──
    period_m = re.search(r"(Statement Period|Period)[:\s]+([A-Za-z0-9 ,\-]+)", full_text)
    if period_m:
        result["period"] = period_m.group(2).strip()

    # ── Portfolio / account value ── (Raiz shows "Portfolio Value" or "Account Value")
    for label in [r"Portfolio Value", r"Account Value", r"Total Portfolio Value", r"Closing Balance"]:
        m = re.search(label + r"[\s\n]+\$?([\d,]+\.?\d*)", full_text, re.IGNORECASE)
        if m:
            cents = _clean_money(m.group(1))
            if cents is not None:
                result["balance_cents"] = cents
                result["portfolio_value_cents"] = cents
                break

    # ── Transactions ── look for date + description + amount patterns
    # Raiz format: DD/MM/YYYY  Description  $amount
    tx_pattern = re.compile(
        r"(\d{2}/\d{2}/\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})",
        re.MULTILINE
    )
    for m in tx_pattern.finditer(full_text):
        date_str = m.group(1)
        desc = m.group(2).strip()
        amount = _clean_money(m.group(3))
        if amount and amount > 0:
            # Guess direction: withdrawals / fees are out, everything else in
            direction = "out" if any(kw in desc.lower() for kw in ["withdrawal", "fee", "charge", "tax"]) else "in"
            result["transactions"].append({
                "date": f"{date_str[6:10]}-{date_str[3:5]}-{date_str[0:2]}",  # ISO
                "description": desc,
                "amount_cents": amount,
                "direction": direction,
            })

    # ── Holdings breakdown ── symbol + units + value
    holdings = []
    holding_pattern = re.compile(
        r"([A-Z]{2,6})\s+([\d,]+\.?\d*)\s+\$([\d,]+\.?\d*)",
        re.MULTILINE
    )
    for m in holding_pattern.finditer(full_text):
        sym = m.group(1)
        qty = float(m.group(2).replace(",", ""))
        val = _clean_money(m.group(3))
        if val and val > 100:  # filter noise
            holdings.append({"symbol": sym, "qty": qty, "value_cents": val})
    result["holdings"] = holdings

    return result
