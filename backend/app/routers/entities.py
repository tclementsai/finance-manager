from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user

router = APIRouter(prefix="/api/entities", tags=["entities"])


@router.get("", response_model=list[schemas.EntityOut])
def list_entities(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.Entity).filter_by(user_id=current_user.id).all()


@router.post("", response_model=schemas.EntityOut)
def create_entity(
    body: schemas.EntityIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    e = models.Entity(**body.model_dump(), user_id=current_user.id)
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.patch("/{entity_id}", response_model=schemas.EntityOut)
def update_entity(
    entity_id: int,
    body: schemas.EntityIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    e = db.query(models.Entity).filter_by(id=entity_id, user_id=current_user.id).first()
    if not e:
        raise HTTPException(404, "Entity not found")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    db.commit(); db.refresh(e)
    return e


@router.delete("/{entity_id}")
def delete_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    e = db.query(models.Entity).filter_by(id=entity_id, user_id=current_user.id).first()
    if not e:
        raise HTTPException(404, "Entity not found")
    db.delete(e); db.commit()
    return {"ok": True}
