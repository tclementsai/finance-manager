"""Net worth tracking — manual assets/liabilities plus live bank balances."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/networth", tags=["networth"])

# Category → display label. Order here drives display order on the page.
ASSET_CATEGORIES = {
    "bank": "Bank accounts",
    "shares": "Shares",
    "crypto": "Crypto",
    "vehicle": "Vehicles",
    "property": "Property",
    "equipment": "Equipment",
}
LIABILITY_CATEGORIES = {
    "loan": "Loans",
    "credit_card": "Credit cards",
    "mortgage": "Mortgages",
}
LABELS = {**ASSET_CATEGORIES, **LIABILITY_CATEGORIES}


def _kind(category: str) -> str:
    return "liability" if category in LIABILITY_CATEGORIES else "asset"


def _bank_live_cents(db: Session) -> int:
    """Sum of all tracked bank/cash account balances (e.g. synced from UP)."""
    accounts = db.query(models.Account).filter(
        models.Account.type.in_(["bank", "cash", "everyday", "savings"])
    ).all()
    return sum(a.balance_cents or 0 for a in accounts)


def _serialize(item: models.NetWorthItem) -> schemas.NetWorthItemOut:
    return schemas.NetWorthItemOut(
        id=item.id, name=item.name, category=item.category,
        value_cents=item.value_cents, notes=item.notes, kind=_kind(item.category),
    )


@router.get("", response_model=list[schemas.NetWorthItemOut])
def list_items(db: Session = Depends(get_db)):
    items = db.query(models.NetWorthItem).order_by(models.NetWorthItem.category).all()
    return [_serialize(i) for i in items]


@router.get("/summary", response_model=schemas.NetWorthSummary)
def summary(db: Session = Depends(get_db)):
    items = db.query(models.NetWorthItem).all()
    bank_live = _bank_live_cents(db)

    # Group manual items by category.
    by_cat: dict[str, list[models.NetWorthItem]] = {}
    for it in items:
        by_cat.setdefault(it.category, []).append(it)

    groups: list[schemas.NetWorthGroup] = []
    # Emit every known category in display order; include the live bank balance
    # as a synthetic, read-only line under "bank".
    for cat, label in LABELS.items():
        members = by_cat.get(cat, [])
        out_items = [_serialize(m) for m in members]
        total = sum(m.value_cents or 0 for m in members)
        if cat == "bank":
            total += bank_live
            if bank_live:
                out_items.insert(0, schemas.NetWorthItemOut(
                    id=-1, name="Bank accounts (live)", category="bank",
                    value_cents=bank_live, kind="asset",
                ))
        if not out_items:
            continue
        groups.append(schemas.NetWorthGroup(
            category=cat, label=label, kind=_kind(cat), total_cents=total, items=out_items,
        ))

    assets = sum(g.total_cents for g in groups if g.kind == "asset")
    liabilities = sum(g.total_cents for g in groups if g.kind == "liability")
    return schemas.NetWorthSummary(
        assets_cents=assets,
        liabilities_cents=liabilities,
        net_worth_cents=assets - liabilities,
        bank_live_cents=bank_live,
        groups=groups,
    )


@router.post("", response_model=schemas.NetWorthItemOut)
def create_item(body: schemas.NetWorthItemIn, db: Session = Depends(get_db)):
    if body.category not in LABELS:
        raise HTTPException(400, f"Unknown category '{body.category}'.")
    item = models.NetWorthItem(**body.model_dump())
    db.add(item); db.commit(); db.refresh(item)
    return _serialize(item)


@router.put("/{item_id}", response_model=schemas.NetWorthItemOut)
def update_item(item_id: int, body: schemas.NetWorthItemIn, db: Session = Depends(get_db)):
    item = db.get(models.NetWorthItem, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    if body.category not in LABELS:
        raise HTTPException(400, f"Unknown category '{body.category}'.")
    for k, v in body.model_dump().items():
        setattr(item, k, v)
    db.commit(); db.refresh(item)
    return _serialize(item)


@router.delete("/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(models.NetWorthItem, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    db.delete(item); db.commit()
    return {"ok": True}
