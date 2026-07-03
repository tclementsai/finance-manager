import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..routers.auth import current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings_route(
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    return {
        "stripe_connected": bool(user.stripe_secret_key),
        "stripe_key_hint": f"...{user.stripe_secret_key[-6:]}" if user.stripe_secret_key else None,
    }


@router.patch("")
def update_settings(
    body: dict,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    if "stripe_secret_key" in body:
        user.stripe_secret_key = body["stripe_secret_key"] or None
    if "stripe_webhook_secret" in body:
        user.stripe_webhook_secret = body["stripe_webhook_secret"] or None
    db.commit()
    return {
        "stripe_connected": bool(user.stripe_secret_key),
        "stripe_key_hint": f"...{user.stripe_secret_key[-6:]}" if user.stripe_secret_key else None,
    }


@router.delete("/stripe")
def disconnect_stripe(
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    user.stripe_secret_key = None
    user.stripe_webhook_secret = None
    db.commit()
    return {"ok": True}


@router.get("/export")
def export_data(
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """Export all user data as a JSON snapshot for backup/recovery."""
    eids = [e.id for e in db.query(models.Entity).filter_by(user_id=user.id).all()]

    def row(obj):
        return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}

    entities = db.query(models.Entity).filter(models.Entity.id.in_(eids)).all()
    accounts = db.query(models.Account).filter(models.Account.entity_id.in_(eids)).all()
    transactions = db.query(models.Transaction).filter(models.Transaction.entity_id.in_(eids)).all()
    categories = db.query(models.Category).all()
    clients = db.query(models.Client).filter(models.Client.entity_id.in_(eids)).all()
    invoices = db.query(models.Invoice).filter(models.Invoice.entity_id.in_(eids)).all()
    commitments = db.query(models.Commitment).filter(models.Commitment.entity_id.in_(eids)).all()
    net_worth = db.query(models.NetWorthItem).filter_by(user_id=user.id).all()
    holdings = db.query(models.InvestmentHolding).filter(models.InvestmentHolding.entity_id.in_(eids)).all()
    balances = db.query(models.InvestmentBalance).filter(models.InvestmentBalance.entity_id.in_(eids)).all()

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "entities": [row(r) for r in entities],
        "accounts": [row(r) for r in accounts],
        "transactions": [row(r) for r in transactions],
        "categories": [row(r) for r in categories],
        "clients": [row(r) for r in clients],
        "invoices": [row(r) for r in invoices],
        "commitments": [row(r) for r in commitments],
        "net_worth_items": [row(r) for r in net_worth],
        "investment_holdings": [row(r) for r in holdings],
        "investment_balances": [row(r) for r in balances],
    }

    # Optional: push to S3 if configured
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    if bucket:
        try:
            import boto3
            s3 = boto3.client("s3")
            key = f"backups/{datetime.now(timezone.utc).strftime('%Y/%m/%d/%H%M%S')}.json"
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(payload), ContentType="application/json")
        except Exception:
            pass  # S3 backup is best-effort; never block the download

    filename = f"finance-manager-backup-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
