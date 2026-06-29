"""JWT authentication dependency and password utilities."""
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Header
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from . import models


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.jwt_secret,
        algorithm="HS256",
    )


def get_user_entity_ids(user: "models.User", db: Session) -> list[int]:
    """Return all entity IDs owned by this user."""
    from sqlalchemy import select
    rows = db.execute(
        select(models.Entity.id).where(models.Entity.user_id == user.id)
    ).scalars().all()
    return list(rows)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_error = HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise credentials_error
    token = authorization.removeprefix("Bearer ")
    try:
        settings = get_settings()
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise credentials_error
    user = db.get(models.User, user_id)
    if not user:
        raise credentials_error
    return user
