from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids

router = APIRouter(prefix="/api/commitments", tags=["commitments"])


def _owned(c: models.Commitment, eids: list[int]) -> bool:
    return c.entity_id is None or c.entity_id in eids


@router.get("", response_model=list[schemas.CommitmentOut])
def list_commitments(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    from sqlalchemy import or_
    return (
        db.query(models.Commitment)
        .filter(or_(models.Commitment.entity_id.is_(None), models.Commitment.entity_id.in_(eids)))
        .order_by(models.Commitment.amount_cents.desc())
        .all()
    )


@router.post("", response_model=schemas.CommitmentOut)
def create_commitment(
    body: schemas.CommitmentIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if body.entity_id is not None:
        eids = get_user_entity_ids(current_user, db)
        if body.entity_id not in eids:
            raise HTTPException(403, "Forbidden")
    c = models.Commitment(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.patch("/{cid}", response_model=schemas.CommitmentOut)
def update_commitment(
    cid: int,
    body: schemas.CommitmentIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    c = db.get(models.Commitment, cid)
    eids = get_user_entity_ids(current_user, db)
    if not c or not _owned(c, eids):
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit(); db.refresh(c)
    return c


@router.delete("/{cid}")
def delete_commitment(
    cid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    c = db.get(models.Commitment, cid)
    eids = get_user_entity_ids(current_user, db)
    if not c or not _owned(c, eids):
        raise HTTPException(404, "Not found")
    db.delete(c); db.commit()
    return {"ok": True}
