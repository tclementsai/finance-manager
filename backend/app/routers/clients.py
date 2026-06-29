from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("", response_model=list[schemas.ClientOut])
def list_clients(
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.Client).filter(models.Client.entity_id.in_(eids))
    if entity_id:
        if entity_id not in eids:
            raise HTTPException(403, "Forbidden")
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("", response_model=schemas.ClientOut)
def create_client(
    body: schemas.ClientIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    if body.entity_id not in eids:
        raise HTTPException(403, "Forbidden")
    c = models.Client(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.put("/{cid}", response_model=schemas.ClientOut)
def update_client(
    cid: int,
    body: schemas.ClientIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    c = db.get(models.Client, cid)
    if not c or c.entity_id not in eids:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit(); db.refresh(c)
    return c


@router.delete("/{cid}")
def delete_client(
    cid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    c = db.get(models.Client, cid)
    if not c or c.entity_id not in eids:
        raise HTTPException(404, "Not found")
    db.delete(c); db.commit()
    return {"ok": True}
