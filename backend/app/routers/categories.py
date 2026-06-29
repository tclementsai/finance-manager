from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids
from ..services.rules_engine import apply_rules

# keyword → category name mapping for auto-categorisation
AUTO_RULES: dict[str, list[str]] = {
    "Dining & Takeaway": [
        "mcdonald", "mcdonalds", "hungry jack", "kfc", "subway", "domino",
        "pizza", "burger", "sushi", "noodle", "ramen", "thai", "indian",
        "chinese", "dumpling", "taco", "kebab", "grill", "bistro", "cafe",
        "restaurant", "takeaway", "take away", "doordash", "uber eats",
        "ubereats", "menulog", "deliveroo", "oporto", "guzman", "grill'd",
        "schnitz", "nando", "zambreros", "sizzler", "diner", "brasserie",
        "eatery", "food court", "food hall", "bakery", "patisserie",
        "starbucks", "coffee", "brew", "espresso", "barista", "pancake",
        "fish and chip", "fish & chip", "dim sum", "yum cha", "hot dog",
        "sandwich", "wrap", "salad bar", "juice bar", "smoothie",
        "milk bar", "gelato", "ice cream", "dessert",
    ],
    "Parking": [
        "parking", "car park", "carpark", "wilson parking",
        "secure parking", "care park", "park&go", "park & go",
        "meters", "meter", "autopay", "parking meter",
    ],
    "Fuel": [
        "bp ", "shell", "caltex", "ampol", "7-eleven fuel", "united petrol",
        "petrol", "diesel", "fuel", "servo", "service station",
    ],
    "Groceries": [
        "woolworths", "coles", "aldi", "iga", "spar", "foodland",
        "harris farm", "costco", "fruit market", "greengrocer",
        "butcher", "deli", "supermarket",
    ],
    "Transport": [
        "uber", "ola cab", "didi", "lyft", "taxi", "cabcharge",
        "myki", "opal", "go card", "translink", "ptv", "metro",
        "train", "bus ticket", "tram", "ferry", "lime ", "neuron",
        "bird scooter",
    ],
    "Health & Pharmacy": [
        "chemist", "pharmacy", "priceline", "terry white", "amcal",
        "blooms", "doctor", "medical centre", "clinic", "pathology",
        "radiology", "dentist", "optometrist", "physiotherapy",
        "physio", "chiropractor", "hospital", "medicare", "healthscope",
    ],
    "Shopping": [
        "kmart", "target", "big w", "myer", "david jones", "h&m",
        "zara", "uniqlo", "cotton on", "country road", "witchery",
        "review", "bonds", "kathmandu", "rebel sport", "bcf",
        "bunnings", "ikea", "harvey norman", "jb hi-fi", "officeworks",
    ],
    "Entertainment": [
        "cinema", "hoyts", "village cinema", "event cinema", "reading cinema",
        "ticketek", "ticketmaster", "eventbrite", "museum", "gallery",
        "theme park", "bowling", "laser tag", "escape room",
        "concert", "theatre", "stadium", "festival",
    ],
}

router = APIRouter(prefix="/api", tags=["categories & rules"])


@router.get("/categories", response_model=list[schemas.CategoryOut])
def list_categories(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    eids = get_user_entity_ids(current_user, db)
    # Return global categories (entity_id IS NULL) plus this user's entity-specific ones
    from sqlalchemy import or_
    return db.query(models.Category).filter(
        or_(models.Category.entity_id.is_(None), models.Category.entity_id.in_(eids))
    ).all()


@router.post("/categories", response_model=schemas.CategoryOut)
def create_category(
    body: schemas.CategoryIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if body.entity_id is not None:
        eids = get_user_entity_ids(current_user, db)
        if body.entity_id not in eids:
            raise HTTPException(403, "Forbidden")
    c = models.Category(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.post("/categories/auto-categorise")
def auto_categorise(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Seed keyword rules for common categories and apply them to all transactions."""
    created_cats = 0
    created_rules = 0
    updated_txns = 0

    for cat_name, keywords in AUTO_RULES.items():
        # Ensure category exists
        cat = db.query(models.Category).filter_by(name=cat_name).first()
        if not cat:
            cat = models.Category(name=cat_name, kind="expense")
            db.add(cat)
            db.flush()  # get cat.id
            created_cats += 1

        # Upsert one rule per keyword
        for kw in keywords:
            existing = db.query(models.Rule).filter_by(
                match_field="description", match_op="contains", match_value=kw
            ).first()
            if not existing:
                db.add(models.Rule(
                    match_field="description",
                    match_op="contains",
                    match_value=kw,
                    set_category_id=cat.id,
                    priority=20,  # lower priority than user-defined rules (5)
                ))
                created_rules += 1

    db.commit()

    # Apply all rules to every uncategorised expense transaction for this user
    eids = get_user_entity_ids(current_user, db)
    txns = db.query(models.Transaction).filter(
        models.Transaction.direction == "out",
        models.Transaction.category_id.is_(None),
        models.Transaction.entity_id.in_(eids),
    ).all()
    for tx in txns:
        before = tx.category_id
        apply_rules(db, tx)
        if tx.category_id != before:
            updated_txns += 1
    db.commit()

    return {
        "categories_created": created_cats,
        "rules_created": created_rules,
        "transactions_updated": updated_txns,
    }


@router.delete("/categories/{cid}")
def delete_category(
    cid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    c = db.get(models.Category, cid)
    if not c:
        raise HTTPException(404, "Not found")
    if c.entity_id is not None:
        eids = get_user_entity_ids(current_user, db)
        if c.entity_id not in eids:
            raise HTTPException(403, "Forbidden")
    db.delete(c); db.commit()
    return {"ok": True}


@router.get("/rules", response_model=list[schemas.RuleOut])
def list_rules(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.Rule).order_by(models.Rule.priority).all()


@router.post("/rules", response_model=schemas.RuleOut)
def create_rule(
    body: schemas.RuleIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = models.Rule(**body.model_dump())
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.delete("/rules/{rid}")
def delete_rule(
    rid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    r = db.get(models.Rule, rid)
    if not r:
        raise HTTPException(404, "Not found")
    db.delete(r); db.commit()
    return {"ok": True}
