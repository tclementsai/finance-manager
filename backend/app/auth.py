"""Auth helpers — delegates JWT/password to routers/auth.py for a single source of truth."""
from sqlalchemy.orm import Session
from sqlalchemy import select

from . import models
from .routers.auth import (
    current_user as get_current_user,
    _hash as hash_password,
    _verify as verify_password,
    create_token,
)

__all__ = ["get_current_user", "hash_password", "verify_password", "create_token", "get_user_entity_ids"]


def get_user_entity_ids(user: models.User, db: Session) -> list[int]:
    rows = db.execute(
        select(models.Entity.id).where(models.Entity.user_id == user.id)
    ).scalars().all()
    return list(rows)
