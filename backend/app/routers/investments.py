from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.raiz_parser import parse_raiz_pdf

router = APIRouter(prefix="/api", tags=["investments"])


@router.get("/holdings", response_model=list[schemas.HoldingOut])
def list_holdings(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Holding)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("/holdings", response_model=schemas.HoldingOut)
def create_holding(body: schemas.HoldingIn, db: Session = Depends(get_db)):
    h = models.Holding(**body.model_dump())
    db.add(h); db.commit(); db.refresh(h)
    return h


@router.delete("/holdings/{hid}")
def delete_holding(hid: int, db: Session = Depends(get_db)):
    h = db.get(models.Holding, hid)
    if not h:
        raise HTTPException(404, "Not found")
    db.delete(h); db.commit()
    return {"ok": True}


@router.get("/cgt-events", response_model=list[schemas.CgtEventOut])
def list_cgt(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.CgtEvent)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.order_by(models.CgtEvent.date.desc()).all()


@router.post("/cgt-events", response_model=schemas.CgtEventOut)
def create_cgt(body: schemas.CgtEventIn, db: Session = Depends(get_db)):
    gain = body.proceeds_cents - body.cost_cents
    ev = models.CgtEvent(**body.model_dump(), gain_cents=gain)
    db.add(ev); db.commit(); db.refresh(ev)
    return ev


@router.delete("/cgt-events/{eid}")
def delete_cgt(eid: int, db: Session = Depends(get_db)):
    ev = db.get(models.CgtEvent, eid)
    if not ev:
        raise HTTPException(404, "Not found")
    db.delete(ev); db.commit()
    return {"ok": True}


# ── Investment Balances ────────────────────────────────────────────────────────

@router.get("/investment-balances", response_model=list[schemas.InvestmentBalanceOut])
def list_balances(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.InvestmentBalance)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.order_by(models.InvestmentBalance.platform).all()


@router.post("/investment-balances", response_model=schemas.InvestmentBalanceOut)
def create_balance(body: schemas.InvestmentBalanceIn, db: Session = Depends(get_db)):
    b = models.InvestmentBalance(**body.model_dump())
    db.add(b); db.commit(); db.refresh(b)
    return b


@router.put("/investment-balances/{bid}", response_model=schemas.InvestmentBalanceOut)
def update_balance(bid: int, body: schemas.InvestmentBalanceIn, db: Session = Depends(get_db)):
    b = db.get(models.InvestmentBalance, bid)
    if not b:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    db.commit(); db.refresh(b)
    return b


@router.delete("/investment-balances/{bid}")
def delete_balance(bid: int, db: Session = Depends(get_db)):
    b = db.get(models.InvestmentBalance, bid)
    if not b:
        raise HTTPException(404, "Not found")
    db.delete(b); db.commit()
    return {"ok": True}


# ── Raiz PDF import ───────────────────────────────────────────────────────────

@router.post("/investment-balances/raiz-import")
async def raiz_import(
    entity_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        parsed = parse_raiz_pdf(content)
    except Exception as e:
        raise HTTPException(400, f"Could not parse PDF: {e}")

    # Upsert the balance for Raiz
    existing = db.query(models.InvestmentBalance).filter_by(
        entity_id=entity_id, platform="Raiz"
    ).first()

    if parsed["balance_cents"] is not None:
        if existing:
            existing.balance_cents = parsed["balance_cents"]
            existing.method = "ETF"
        else:
            db.add(models.InvestmentBalance(
                entity_id=entity_id,
                platform="Raiz",
                method="ETF",
                balance_cents=parsed["balance_cents"],
            ))
        db.commit()

    # Import transactions (dedupe by date+description)
    imported_txns = 0
    from datetime import date as date_type
    import dateutil.parser
    for tx in parsed.get("transactions", []):
        ext_id = f"raiz-{tx['date']}-{tx['description'][:30]}"
        exists = db.query(models.Transaction).filter_by(external_id=ext_id).first()
        if not exists:
            db.add(models.Transaction(
                entity_id=entity_id,
                date=dateutil.parser.parse(tx["date"]).date(),
                amount_cents=tx["amount_cents"],
                direction=tx["direction"],
                description=tx["description"],
                source="raiz",
                external_id=ext_id,
                income_type="dividend" if tx["direction"] == "in" else None,
            ))
            imported_txns += 1
    db.commit()

    return {
        "balance_cents": parsed["balance_cents"],
        "period": parsed["period"],
        "transactions_imported": imported_txns,
        "holdings_found": len(parsed.get("holdings", [])),
        "holdings": parsed.get("holdings", []),
    }
