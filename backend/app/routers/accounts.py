from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[schemas.AccountOut])
def list_accounts(
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.Account).filter(models.Account.entity_id.in_(eids))
    if entity_id:
        if entity_id not in eids:
            raise HTTPException(403, "Forbidden")
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("", response_model=schemas.AccountOut)
def create_account(
    body: schemas.AccountIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    if body.entity_id not in eids:
        raise HTTPException(403, "Forbidden")
    a = models.Account(**body.model_dump())
    db.add(a); db.commit(); db.refresh(a)
    return a


@router.get("/balances")
def account_balances(
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.Account).filter(models.Account.entity_id.in_(eids))
    if entity_id:
        if entity_id not in eids:
            raise HTTPException(403, "Forbidden")
        q = q.filter_by(entity_id=entity_id)
    accounts = q.all()
    items = [
        {"id": a.id, "name": a.name, "type": a.type, "balance_cents": a.balance_cents or 0}
        for a in accounts
    ]
    return {
        "accounts": items,
        "total_cents": sum(i["balance_cents"] for i in items),
    }


@router.patch("/{account_id}")
def update_account(
    account_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    a = db.get(models.Account, account_id)
    if not a or a.entity_id not in eids:
        raise HTTPException(404, "Account not found")
    allowed = {"name", "type", "balance_cents", "currency"}
    for k, v in body.items():
        if k in allowed:
            setattr(a, k, v)
    db.commit(); db.refresh(a)
    return {"id": a.id, "name": a.name, "type": a.type, "balance_cents": a.balance_cents or 0}


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    a = db.get(models.Account, account_id)
    if not a or a.entity_id not in eids:
        raise HTTPException(404, "Account not found")
    db.delete(a); db.commit()
    return {"ok": True}
