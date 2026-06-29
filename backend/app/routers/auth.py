import io
import base64
from datetime import datetime, timedelta

import bcrypt
import pyotp
import qrcode
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
TOTP_PENDING_MINUTES = 5  # short-lived token between password step and TOTP step


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
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _create_pending_token(user_id: int) -> str:
    """Short-lived token issued after password check when 2FA is required."""
    settings = get_settings()
    payload = {
        "sub": str(user_id),
        "2fa_pending": True,
        "exp": datetime.utcnow() + timedelta(minutes=TOTP_PENDING_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        if payload.get("2fa_pending"):
            raise HTTPException(401, "2FA verification required")
        return int(payload["sub"])
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")


def _decode_pending_token(token: str) -> int:
    """Decode a 2FA pending token (only valid for the /2fa/verify endpoint)."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        if not payload.get("2fa_pending"):
            raise HTTPException(400, "Not a 2FA pending token")
        return int(payload["sub"])
    except JWTError:
        raise HTTPException(401, "Invalid or expired 2FA session — please log in again")


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


class LoginOut(BaseModel):
    """Login response — either a full token or a 2FA challenge."""
    token: str | None = None
    user_id: int | None = None
    username: str | None = None
    two_factor_required: bool = False
    pending_token: str | None = None


class TwoFactorVerifyIn(BaseModel):
    pending_token: str
    code: str


class TwoFactorSetupOut(BaseModel):
    secret: str
    qr_uri: str
    qr_image_b64: str  # base64 PNG for inline display


class TwoFactorEnableIn(BaseModel):
    code: str


class TwoFactorDisableIn(BaseModel):
    code: str


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


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(username=body.username.strip().lower()).first()
    if not user or not _verify(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    if user.totp_enabled:
        return LoginOut(
            two_factor_required=True,
            pending_token=_create_pending_token(user.id),
        )
    return LoginOut(token=create_token(user.id), user_id=user.id, username=user.username)


@router.post("/2fa/verify", response_model=TokenOut)
def verify_2fa(body: TwoFactorVerifyIn, db: Session = Depends(get_db)):
    """Second step of login — submit TOTP code with the pending token."""
    user_id = _decode_pending_token(body.pending_token)
    user = db.get(models.User, user_id)
    if not user or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(400, "2FA not configured for this account")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code.strip(), valid_window=1):
        raise HTTPException(401, "Invalid or expired authentication code")
    return TokenOut(token=create_token(user.id), user_id=user.id, username=user.username)


@router.get("/2fa/setup", response_model=TwoFactorSetupOut)
def setup_2fa(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Generate a new TOTP secret and QR code. Does NOT enable 2FA yet."""
    if user.totp_enabled:
        raise HTTPException(400, "2FA is already enabled — disable it first to re-setup")
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user.username, issuer_name="Ledger")

    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    # Store the secret tentatively — overwritten on each setup call, activated on /enable
    user.totp_secret = secret
    db.commit()

    return TwoFactorSetupOut(secret=secret, qr_uri=uri, qr_image_b64=qr_b64)


@router.post("/2fa/enable")
def enable_2fa(
    body: TwoFactorEnableIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Confirm the TOTP code from the authenticator app to activate 2FA."""
    if user.totp_enabled:
        raise HTTPException(400, "2FA is already enabled")
    if not user.totp_secret:
        raise HTTPException(400, "Run /api/auth/2fa/setup first")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code.strip(), valid_window=1):
        raise HTTPException(401, "Invalid code — make sure your authenticator app is synced")
    user.totp_enabled = True
    db.commit()
    return {"ok": True, "message": "Two-factor authentication enabled"}


@router.post("/2fa/disable")
def disable_2fa(
    body: TwoFactorDisableIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Disable 2FA — requires a valid current TOTP code."""
    if not user.totp_enabled:
        raise HTTPException(400, "2FA is not enabled")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code.strip(), valid_window=1):
        raise HTTPException(401, "Invalid code")
    user.totp_enabled = False
    user.totp_secret = None
    db.commit()
    return {"ok": True, "message": "Two-factor authentication disabled"}


@router.get("/me")
def me(user: models.User = Depends(current_user)):
    return {
        "user_id": user.id,
        "username": user.username,
        "two_factor_enabled": bool(user.totp_enabled),
    }
