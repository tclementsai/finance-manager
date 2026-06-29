import json
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids
from .. import models
from ..services.csv_import import import_csv

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/csv")
async def import_csv_endpoint(
    entity_id: int = Form(...),
    account_id: int | None = Form(None),
    mapping: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    if entity_id not in eids:
        raise HTTPException(403, "Forbidden")
    content = await file.read()
    mapping_dict = json.loads(mapping)
    return import_csv(db, entity_id, account_id, content, mapping_dict)
