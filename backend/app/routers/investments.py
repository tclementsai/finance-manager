from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids

router = APIRouter(prefix="/api", tags=["investments"])


@router.get("/holdings", response_model=list[schemas.HoldingOut])
def list_holdings(
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.Holding).filter(models.Holding.entity_id.in_(eids))
    if entity_id:
        if entity_id not in eids:
            raise HTTPException(403, "Forbidden")
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("/holdings", response_model=schemas.HoldingOut)
def create_holding(
    body: schemas.HoldingIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    if body.entity_id not in eids:
        raise HTTPException(403, "Forbidden")
    h = models.Holding(**body.model_dump())
    db.add(h); db.commit(); db.refresh(h)
    return h


@router.delete("/holdings/{hid}")
def delete_holding(
    hid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    h = db.get(models.Holding, hid)
    if not h or h.entity_id not in eids:
        raise HTTPException(404, "Not found")
    db.delete(h); db.commit()
    return {"ok": True}


@router.get("/cgt-events", response_model=list[schemas.CgtEventOut])
def list_cgt(
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.CgtEvent).filter(models.CgtEvent.entity_id.in_(eids))
    if entity_id:
        if entity_id not in eids:
            raise HTTPException(403, "Forbidden")
        q = q.filter_by(entity_id=entity_id)
    return q.order_by(models.CgtEvent.date.desc()).all()


@router.post("/cgt-events", response_model=schemas.CgtEventOut)
def create_cgt(
    body: schemas.CgtEventIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    if body.entity_id not in eids:
        raise HTTPException(403, "Forbidden")
    gain = body.proceeds_cents - body.cost_cents
    ev = models.CgtEvent(**body.model_dump(), gain_cents=gain)
    db.add(ev); db.commit(); db.refresh(ev)
    return ev


@router.delete("/cgt-events/{eid}")
def delete_cgt(
    eid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    ev = db.get(models.CgtEvent, eid)
    if not ev or ev.entity_id not in eids:
        raise HTTPException(404, "Not found")
    db.delete(ev); db.commit()
    return {"ok": True}
