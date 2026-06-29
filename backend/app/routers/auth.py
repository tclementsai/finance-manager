from datetime import datetime, timedelta

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(days=TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")


def get_current_user(
    authorization: str | None = None,
    db: Session = Depends(get_db),
) -> models.User:
    from fastapi import Header
    raise HTTPException(401, "Use get_user_from_header")


def require_user(db: Session = Depends(get_db)):
    """FastAPI dependency — extracts Bearer token from Authorization header."""
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
    # We do the extraction manually so the dependency works cleanly.
    return db  # placeholder; see the header-aware version below


# ---- Reusable dependency ----
from fastapi import Header as _Header


def current_user(
    authorization: str | None = _Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    user_id = decode_token(token)
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ---- Schemas ----
class RegisterIn(BaseModel):
    username: str
    password: str


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    token: str
    user_id: int
    username: str


# ---- Endpoints ----
@router.post("/register", response_model=TokenOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if len(body.username.strip()) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    existing = db.query(models.User).filter_by(username=body.username.strip().lower()).first()
    if existing:
        raise HTTPException(409, "Username already taken")
    user = models.User(
        username=body.username.strip().lower(),
        password_hash=_hash(body.password),
    )
    db.add(user); db.commit(); db.refresh(user)
    return TokenOut(token=create_token(user.id), user_id=user.id, username=user.username)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(username=body.username.strip().lower()).first()
    if not user or not _verify(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return TokenOut(token=create_token(user.id), user_id=user.id, username=user.username)


@router.get("/me")
def me(user: models.User = Depends(current_user)):
    return {"user_id": user.id, "username": user.username}
