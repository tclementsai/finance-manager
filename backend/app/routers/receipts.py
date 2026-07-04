import os
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..database import get_db
from ..auth import get_current_user
from ..services.ocr import ocr_image

router = APIRouter(prefix="/api/receipts", tags=["receipts"])
settings = get_settings()


def _s3_client():
    import boto3
    return boto3.client("s3")


def _upload_to_s3(content: bytes, key: str, content_type: str) -> str:
    """Upload bytes to S3 and return the s3:// URI."""
    _s3_client().put_object(
        Bucket=settings.receipt_s3_bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
    )
    return f"s3://{settings.receipt_s3_bucket}/{key}"


def _presign_s3(s3_uri: str, expires: int = 300) -> str:
    """Return a pre-signed URL for a stored receipt."""
    bucket, key = s3_uri.removeprefix("s3://").split("/", 1)
    return _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


@router.get("", response_model=list[schemas.ReceiptOut])
def list_receipts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.Receipt)
        .filter_by(user_id=current_user.id)
        .order_by(models.Receipt.created_at.desc())
        .all()
    )


@router.post("", response_model=schemas.ReceiptOut)
async def upload_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    content = await file.read()
    ext = os.path.splitext(file.filename or "")[1] or ".bin"
    name = f"{uuid.uuid4().hex}{ext}"
    content_type = file.content_type or "application/octet-stream"

    if settings.receipt_s3_bucket:
        key = f"receipts/{current_user.id}/{name}"
        stored_path = _upload_to_s3(content, key, content_type)
    else:
        os.makedirs(settings.upload_dir, exist_ok=True)
        stored_path = os.path.join(settings.upload_dir, name)
        with open(stored_path, "wb") as f:
            f.write(content)

    parsed = ocr_image(content, content_type)
    receipt = models.Receipt(file_path=stored_path, user_id=current_user.id, **parsed)
    db.add(receipt); db.commit(); db.refresh(receipt)
    return receipt


@router.get("/{receipt_id}/file")
def serve_receipt(
    receipt_id: int,
    request: Request,
    token: str | None = None,
    db: Session = Depends(get_db),
):
    from .auth import decode_token
    auth_header = request.headers.get("authorization", "")
    raw = token or (auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else None)
    if not raw:
        raise HTTPException(401, "Not authenticated")
    user_id = decode_token(raw)
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(401, "User not found")
    r = db.get(models.Receipt, receipt_id)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "Receipt not found")

    if r.file_path and r.file_path.startswith("s3://"):
        url = _presign_s3(r.file_path)
        return RedirectResponse(url)

    if not os.path.exists(r.file_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(r.file_path)


@router.patch("/{receipt_id}")
def update_receipt(
    receipt_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = db.get(models.Receipt, receipt_id)
    if not r or r.user_id != current_user.id:
        raise HTTPException(404, "Receipt not found")
    if "ocr_vendor" in body:
        r.ocr_vendor = body["ocr_vendor"] or None
    if "ocr_date" in body:
        from datetime import date as _date
        try:
            r.ocr_date = _date.fromisoformat(body["ocr_date"]) if body["ocr_date"] else None
        except ValueError:
            pass
    if "ocr_total_cents" in body:
        r.ocr_total_cents = int(round(float(body["ocr_total_cents"]) * 100)) if body["ocr_total_cents"] else None
    if "ocr_gst_cents" in body:
        r.ocr_gst_cents = int(round(float(body["ocr_gst_cents"]) * 100)) if body["ocr_gst_cents"] else None
    db.commit(); db.refresh(r)
    return r


@router.delete("/{receipt_id}")
def delete_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = db.get(models.Receipt, receipt_id)
    if not r or r.user_id != current_user.id:
        raise HTTPException(404, "Receipt not found")
    db.query(models.Transaction).filter_by(receipt_id=receipt_id).update({"receipt_id": None})
    if r.file_path:
        if r.file_path.startswith("s3://"):
            try:
                bucket, key = r.file_path.removeprefix("s3://").split("/", 1)
                _s3_client().delete_object(Bucket=bucket, Key=key)
            except Exception:
                pass
        else:
            try:
                if os.path.exists(r.file_path):
                    os.remove(r.file_path)
            except OSError:
                pass
    db.delete(r); db.commit()
    return {"ok": True}
