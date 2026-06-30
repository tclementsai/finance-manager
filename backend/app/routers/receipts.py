import os
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..database import get_db
from ..auth import get_current_user
from ..services.ocr import ocr_image

router = APIRouter(prefix="/api/receipts", tags=["receipts"])
settings = get_settings()


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
    os.makedirs(settings.upload_dir, exist_ok=True)
    content = await file.read()
    ext = os.path.splitext(file.filename or "")[1] or ".bin"
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(settings.upload_dir, name)
    with open(path, "wb") as f:
        f.write(content)

    parsed = ocr_image(content, file.content_type or "application/octet-stream")
    receipt = models.Receipt(file_path=path, user_id=current_user.id, **parsed)
    db.add(receipt); db.commit(); db.refresh(receipt)
    return receipt


@router.get("/{receipt_id}/file")
def serve_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = db.get(models.Receipt, receipt_id)
    if not r or r.user_id != current_user.id:
        raise HTTPException(404, "Receipt not found")
    if not os.path.exists(r.file_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(r.file_path)


@router.delete("/{receipt_id}")
def delete_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = db.get(models.Receipt, receipt_id)
    if not r or r.user_id != current_user.id:
        raise HTTPException(404, "Receipt not found")
    # Unlink from any transactions
    db.query(models.Transaction).filter_by(receipt_id=receipt_id).update({"receipt_id": None})
    try:
        if os.path.exists(r.file_path):
            os.remove(r.file_path)
    except OSError:
        pass
    db.delete(r); db.commit()
    return {"ok": True}
