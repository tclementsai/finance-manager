"""Stripe invoicing. Falls back to a local-only flow when no key is set."""
from typing import Optional

from ..config import get_settings

settings = get_settings()

if settings.stripe_secret_key:
    import stripe
    stripe.api_key = settings.stripe_secret_key


def enabled() -> bool:
    return bool(settings.stripe_secret_key)


def _bank_footer(entity) -> str:
    if not entity:
        return ""
    parts = []
    if entity.abn:
        parts.append(f"ABN: {entity.abn}")
    if entity.bank_account_number:
        parts.append(
            "Pay by bank transfer — "
            f"{entity.bank_account_name or entity.name} · "
            f"BSB {entity.bsb or '—'} · Acct {entity.bank_account_number}"
            + (f" ({entity.bank_name})" if entity.bank_name else "")
        )
    if entity.invoice_footer:
        parts.append(entity.invoice_footer)
    return "\n".join(parts)


def create_and_send_invoice(invoice, client, entity=None, stripe_key: str | None = None) -> dict:
    """Create a Stripe invoice from a local Invoice ORM object.

    Returns {stripe_invoice_id, hosted_url, status}. If Stripe isn't configured,
    returns a stub so the rest of the app keeps working in dev.
    """
    key = stripe_key or settings.stripe_secret_key
    if not key:
        return {
            "stripe_invoice_id": None,
            "hosted_url": None,
            "status": "sent",
            "note": "Stripe not configured — invoice tracked locally only.",
        }

    import stripe as _stripe
    _stripe.api_key = key

    customer_id = None
    if client and client.email:
        existing = _stripe.Customer.list(email=client.email, limit=1).data
        customer = existing[0] if existing else _stripe.Customer.create(
            name=client.name, email=client.email
        )
        customer_id = customer.id
    elif client:
        customer_id = _stripe.Customer.create(name=client.name).id

    for line in invoice.lines:
        amount = int(round(line.unit_cents * line.qty))
        _stripe.InvoiceItem.create(
            customer=customer_id,
            amount=amount,
            currency="aud",
            description=line.description,
        )

    si = _stripe.Invoice.create(
        customer=customer_id,
        collection_method="send_invoice",
        days_until_due=30,
        auto_advance=True,
        footer=_bank_footer(entity) or None,
    )
    si = _stripe.Invoice.finalize_invoice(si.id)
    _stripe.Invoice.send_invoice(si.id)
    return {
        "stripe_invoice_id": si.id,
        "hosted_url": si.hosted_invoice_url,
        "status": "sent",
    }


def parse_webhook(payload: bytes, sig_header: str, webhook_secret: str | None = None):
    """Verify + parse a Stripe webhook event."""
    import stripe as _stripe
    secret = webhook_secret or settings.stripe_webhook_secret
    return _stripe.Webhook.construct_event(payload, sig_header, secret)
