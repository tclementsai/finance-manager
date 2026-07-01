from fastapi import APIRouter, Depends
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
