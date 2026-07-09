"""Receipt OCR.

Priority order:
  1. OCR_PROVIDER=docai  → Google Document AI
  2. OCR_PROVIDER=claude → Anthropic vision (requires ANTHROPIC_API_KEY)
  3. ANTHROPIC_API_KEY set (auto) → Anthropic vision, no config needed
  4. Fallback → heuristic text parser (works for digital/PDF receipts only)
"""
import base64
import re
from datetime import date
from typing import Optional

from dateutil import parser as dateparser

from ..config import get_settings

settings = get_settings()

_AMOUNT_RE = re.compile(r"(\d{1,3}(?:[,\d]{0,12})(?:\.\d{2}))")
_TOTAL_RE = re.compile(r"(?:total|amount due|grand total)\s*[:$]*\s*\$?([\d,]+\.\d{2})", re.I)
_GST_RE = re.compile(r"(?:gst|tax)\s*[:$]*\s*\$?([\d,]+\.\d{2})", re.I)


def _to_cents(s: str) -> int:
    return int(round(float(s.replace(",", "")) * 100))


def parse_text(text: str) -> dict:
    """Heuristic extraction from receipt text."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    vendor = lines[0] if lines else None

    total = None
    m = _TOTAL_RE.search(text)
    if m:
        total = _to_cents(m.group(1))
    else:
        amounts = [_to_cents(a) for a in _AMOUNT_RE.findall(text)]
        if amounts:
            total = max(amounts)

    gst = None
    g = _GST_RE.search(text)
    if g:
        gst = _to_cents(g.group(1))
    elif total:
        gst = round(total / 11)

    parsed_date: Optional[date] = None
    for l in lines:
        try:
            parsed_date = dateparser.parse(l, dayfirst=True, fuzzy=True).date()
            break
        except Exception:
            continue

    return {
        "ocr_vendor": vendor,
        "ocr_date": parsed_date,
        "ocr_total_cents": total,
        "ocr_gst_cents": gst,
        "ocr_raw": text[:5000],
    }


def ocr_image(file_bytes: bytes, content_type: str) -> dict:
    """Run OCR on an uploaded receipt."""
    import os
    provider = settings.ocr_provider.lower()

    if provider == "docai":
        return _docai(file_bytes, content_type)

    if provider == "claude" or (not provider and os.environ.get("ANTHROPIC_API_KEY")):
        try:
            return _claude_vision(file_bytes, content_type)
        except Exception:
            pass  # fall through to text heuristic

    try:
        text = file_bytes.decode("utf-8")
        return parse_text(text)
    except UnicodeDecodeError:
        return {
            "ocr_vendor": None, "ocr_date": None,
            "ocr_total_cents": None, "ocr_gst_cents": None,
            "ocr_raw": "(image OCR requires ANTHROPIC_API_KEY or OCR_PROVIDER=docai in .env)",
        }


def _claude_vision(file_bytes: bytes, content_type: str) -> dict:
    """Extract receipt details using Claude vision."""
    import anthropic

    # Map PDF to a supported media type for the vision API
    if content_type == "application/pdf":
        # Claude supports PDF natively via base64
        media_type = "application/pdf"
    elif content_type in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        media_type = content_type
    else:
        media_type = "image/jpeg"

    b64 = base64.standard_b64encode(file_bytes).decode("utf-8")

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image" if media_type != "application/pdf" else "document",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64,
                    },
                },
                {
                    "type": "text",
                    "text": (
                        "Extract the following from this receipt and reply with ONLY these lines, "
                        "one per line, no labels:\n"
                        "LINE1: vendor/store name\n"
                        "LINE2: date in YYYY-MM-DD format (or blank)\n"
                        "LINE3: total amount in dollars with 2 decimal places (or blank)\n"
                        "LINE4: GST amount in dollars with 2 decimal places (or blank, "
                        "if not shown calculate as total/11 for Australian receipts)\n"
                        "Reply with exactly 4 lines, nothing else."
                    ),
                },
            ],
        }],
    )

    raw = msg.content[0].text.strip()
    lines = [l.strip() for l in raw.splitlines()]
    while len(lines) < 4:
        lines.append("")

    vendor = lines[0] or None

    parsed_date = None
    if lines[1]:
        try:
            parsed_date = dateparser.parse(lines[1], dayfirst=True, fuzzy=True).date()
        except Exception:
            pass

    total = None
    if lines[2]:
        try:
            total = _to_cents(lines[2].lstrip("$"))
        except Exception:
            pass

    gst = None
    if lines[3]:
        try:
            gst = _to_cents(lines[3].lstrip("$"))
        except Exception:
            pass
    elif total:
        gst = round(total / 11)

    return {
        "ocr_vendor": vendor,
        "ocr_date": parsed_date,
        "ocr_total_cents": total,
        "ocr_gst_cents": gst,
        "ocr_raw": raw,
    }


def _docai(file_bytes: bytes, content_type: str) -> dict:  # pragma: no cover
    """Google Document AI receipt processor."""
    from google.cloud import documentai  # type: ignore

    client = documentai.DocumentProcessorServiceClient()
    raw = documentai.RawDocument(content=file_bytes, mime_type=content_type)
    req = documentai.ProcessRequest(name=settings.doc_ai_processor, raw_document=raw)
    result = client.process_document(request=req)
    return parse_text(result.document.text)
