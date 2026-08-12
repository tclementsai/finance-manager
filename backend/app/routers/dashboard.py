import re
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from ..database import get_db
from ..auth import get_current_user, get_user_entity_ids
from ..tax import fy_bounds, estimate_tax_setaside, income_tax, MEDICARE_LEVY

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
settings = get_settings()

TAXED_TYPES = {"payroll"}
UNTAXED_TYPES = {"interest", "dividend", "drawing"}


def _normalise_income_label(desc: str) -> str:
    desc = re.split(r"\s*[—–]\s*", desc)[0]
    desc = re.sub(r"\s+\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$", "", desc)
    desc = re.sub(r"\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*\d{2,4}$", "", desc, flags=re.I)
    desc = re.sub(r"\s+\d{6,}$", "", desc)
    desc = desc.strip(" .,;:-")
    return desc[:40] or "Other"


def _fy(start, end):
    if start and end:
        return start, end
    return fy_bounds()


def _summary_for_user(
    start: date,
    end: date,
    flat_rate,
    entity_id,
    db: Session,
    user_entity_ids: list[int],
):
    """Core summary logic — always scoped to user_entity_ids."""
    q = db.query(models.Transaction).filter(
        models.Transaction.date >= start,
        models.Transaction.date <= end,
        models.Transaction.entity_id.in_(user_entity_ids),
    )
    if entity_id:
        q = q.filter(models.Transaction.entity_id == entity_id)
    txs = q.all()

    transfer_cat_ids = {
        c.id for c in db.query(models.Category).filter(
            models.Category.name.in_(["Internal Transfer", "Transfer Income"])
        ).all()
    }
    txs = [t for t in txs if t.category_id not in transfer_cat_ids]

    kinds = {
        e.id: e.kind
        for e in db.query(models.Entity).filter(models.Entity.id.in_(user_entity_ids)).all()
    }
    def _is_stripe_income(t) -> bool:
        """Money in via Stripe is business revenue whichever account it landed in.

        A client paying an invoice is never personal income, even when the
        payout is deposited to a personal bank account. Matches either the
        source field (invoices marked paid) or the description (a Stripe payout
        arriving through a bank feed such as UP).
        """
        if t.direction != "in":
            return False
        if (t.source or "").lower() == "stripe":
            return True
        return "stripe" in (t.description or "").lower()

    # Stripe income is deliberately excluded from `is_personal` as well as being
    # added to `is_business`, so it lands in exactly one of the two totals.
    is_personal = lambda t: (
        kinds.get(t.entity_id) == "personal" and not _is_stripe_income(t)
    )
    is_business = lambda t: (
        kinds.get(t.entity_id) in ("business", "company", "sole_trader")
        or _is_stripe_income(t)
    )

    acct_types = {a.id: a.type for a in db.query(models.Account).filter(
        models.Account.entity_id.in_(user_entity_ids)
    ).all()}
    is_spending_acct = lambda t: acct_types.get(t.account_id, "everyday") not in ("savings", "investment")

    income_total = sum(t.amount_cents for t in txs if t.direction == "in")
    expense_total = sum(t.amount_cents for t in txs if t.direction == "out")

    personal_income = sum(t.amount_cents for t in txs
                          if t.direction == "in" and is_personal(t) and is_spending_acct(t))
    personal_expenses = sum(t.amount_cents for t in txs if t.direction == "out" and is_personal(t))
    drawings = sum(t.amount_cents for t in txs
                   if t.direction == "in" and is_personal(t) and is_spending_acct(t) and t.income_type == "drawing")

    interest_income = sum(t.amount_cents for t in txs
                          if t.direction == "in" and is_personal(t) and (
                              t.income_type == "interest" or
                              any(kw in (t.description or "").lower() for kw in ("interest", "interest payment"))
                          ))

    taxed_income = sum(t.amount_cents for t in txs
                       if t.direction == "in" and is_personal(t) and is_spending_acct(t) and t.income_type in TAXED_TYPES)
    tax_withheld = sum(t.tax_withheld_cents or 0 for t in txs
                       if t.direction == "in" and is_personal(t) and is_spending_acct(t))
    untaxed_income = sum(t.amount_cents for t in txs
                         if t.direction == "in" and is_personal(t) and is_spending_acct(t) and t.income_type in UNTAXED_TYPES)

    business_income = sum(t.amount_cents for t in txs if t.direction == "in" and is_business(t))
    business_expenses = sum(t.amount_cents for t in txs
                            if t.direction == "out" and is_business(t) and t.income_type != "drawing")
    drawings_out = sum(t.amount_cents for t in txs
                       if t.direction == "out" and is_business(t) and t.income_type == "drawing")
    business_net = business_income - business_expenses
    business_retained = business_net - drawings_out

    gst_collected = sum(t.gst_cents or 0 for t in txs if t.direction == "in" and is_business(t))
    gst_credits = sum(t.gst_cents or 0 for t in txs
                      if t.direction == "out" and is_business(t) and t.is_deductible)
    gst_owed = max(gst_collected - gst_credits, 0)

    rate = flat_rate if flat_rate is not None else None

    FREQ_TO_MONTHLY = {
        "weekly": 52 / 12, "fortnightly": 26 / 12,
        "monthly": 1.0, "quarterly": 1 / 3, "annual": 1 / 12,
    }
    recurring_q = db.query(models.Transaction).filter(
        models.Transaction.is_recurring == True,  # noqa: E712
        models.Transaction.direction == "out",
        models.Transaction.entity_id.in_(user_entity_ids),
    )
    if entity_id:
        recurring_q = recurring_q.filter(models.Transaction.entity_id == entity_id)
    else:
        recurring_q = recurring_q.filter(
            models.Transaction.entity_id.in_([eid for eid, k in kinds.items() if k == "personal"])
        )
    seen_recurring: dict[str, int] = {}
    for rt in recurring_q.all():
        key = (rt.description or "").strip().lower()
        if key not in seen_recurring:
            freq = rt.recurrence_freq or "monthly"
            seen_recurring[key] = int(round(rt.amount_cents * FREQ_TO_MONTHLY.get(freq, 1.0)))
    monthly_commitments_cents = sum(seen_recurring.values())

    days_in_period = max(1, (end - start).days + 1)
    commitments_period_cents = int(round(monthly_commitments_cents * days_in_period / 30.44))

    viewing_business = bool(entity_id) and kinds.get(entity_id) in ("business", "company", "sole_trader")

    if viewing_business:
        setaside = estimate_tax_setaside(0, 0, max(business_net, 0) / 100, flat_rate=rate)
        tax_setaside_cents = int(round(setaside["setaside"] * 100))
        available = business_retained - gst_owed
    else:
        setaside = estimate_tax_setaside(
            taxed_income=taxed_income / 100,
            tax_already_withheld=tax_withheld / 100,
            untaxed_income=untaxed_income / 100,
            flat_rate=rate,
        )
        tax_setaside_cents = int(round(setaside["setaside"] * 100))
        available = personal_income - personal_expenses - tax_setaside_cents - commitments_period_cents

    net_cash = income_total - expense_total

    cat_names = {c.id: c.name for c in db.query(models.Category).all()}
    by_entity = defaultdict(lambda: {"in": 0, "out": 0})
    _income_source_totals: dict[str, int] = defaultdict(int)
    _income_source_labels: dict[str, str] = {}
    by_month = defaultdict(lambda: {"in": 0, "out": 0})
    by_category = defaultdict(int)
    for t in txs:
        by_entity[t.entity_id][t.direction] += t.amount_cents
        if t.direction == "in" and is_spending_acct(t):
            if t.income_type:
                display = t.income_type.replace("_", " ").title()
            elif t.category_id and t.category_id in cat_names:
                display = cat_names[t.category_id]
            else:
                display = _normalise_income_label(t.description or "Other")
            key = display.lower().strip()
            _income_source_totals[key] += t.amount_cents
            _income_source_labels[key] = display
        mk = t.date.strftime("%Y-%m")
        by_month[mk][t.direction] += t.amount_cents
        if t.direction == "out":
            cat = cat_names.get(t.category_id, "Uncategorised")
            by_category[cat] += t.amount_cents
    by_income_source = {_income_source_labels[k]: v for k, v in _income_source_totals.items()}

    return {
        "period": {"start": str(start), "end": str(end)},
        "viewing_business": viewing_business,
        "income_total_cents": income_total,
        "expense_total_cents": expense_total,
        "net_cash_cents": net_cash,
        "personal_income_cents": personal_income,
        "interest_income_cents": interest_income,
        "personal_expenses_cents": personal_expenses,
        "drawings_cents": drawings,
        "business_income_cents": business_income,
        "business_expenses_cents": business_expenses,
        "business_net_cents": business_net,
        "business_retained_cents": business_retained,
        "taxed_income_cents": taxed_income,
        "untaxed_income_cents": untaxed_income,
        "tax_withheld_cents": tax_withheld,
        "tax_setaside_cents": tax_setaside_cents,
        "tax_setaside_detail": setaside,
        "gst_collected_cents": gst_collected,
        "gst_credits_cents": gst_credits,
        "gst_owed_cents": gst_owed,
        "available_to_spend_cents": available,
        "monthly_commitments_cents": monthly_commitments_cents,
        "commitments_period_cents": commitments_period_cents,
        "days_in_period": days_in_period,
        "by_entity": {str(k): v for k, v in by_entity.items()},
        "by_income_type": dict(sorted(by_income_source.items(), key=lambda x: -x[1])),
        "by_month": dict(sorted(by_month.items())),
        "by_category": dict(sorted(by_category.items(), key=lambda x: -x[1])),
    }


@router.get("/summary")
def summary(
    start: date | None = None,
    end: date | None = None,
    flat_rate: float | None = None,
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    start, end = _fy(start, end)
    eids = get_user_entity_ids(current_user, db)
    return _summary_for_user(start, end, flat_rate, entity_id, db, eids)


@router.get("/deductions")
def deduction_report(
    entity_id: int | None = None,
    start: date | None = None,
    end: date | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    start, end = _fy(start, end)
    eids = get_user_entity_ids(current_user, db)
    q = db.query(models.Transaction).filter(
        models.Transaction.direction == "out",
        models.Transaction.is_deductible == True,  # noqa: E712
        models.Transaction.date >= start,
        models.Transaction.date <= end,
        models.Transaction.entity_id.in_(eids),
    )
    if entity_id:
        q = q.filter(models.Transaction.entity_id == entity_id)

    groups = defaultdict(lambda: {"total_cents": 0, "gst_cents": 0, "count": 0, "items": []})
    cat_lookup = {c.id: c for c in db.query(models.Category).all()}
    for t in q.all():
        cat = cat_lookup.get(t.category_id)
        key = (cat.ato_deduction_category or cat.name) if cat else "Uncategorised"
        claimable = int(round(t.amount_cents * (t.business_use_pct or 100) / 100))
        g = groups[key]
        g["total_cents"] += claimable
        g["gst_cents"] += t.gst_cents or 0
        g["count"] += 1
        g["items"].append({
            "date": str(t.date),
            "description": t.description,
            "amount_cents": t.amount_cents,
            "business_use_pct": t.business_use_pct,
            "claimable_cents": claimable,
            "gst_cents": t.gst_cents,
            "entity_id": t.entity_id,
        })

    total = sum(g["total_cents"] for g in groups.values())
    return {
        "period": {"start": str(start), "end": str(end)},
        "total_deductible_cents": total,
        "by_category": groups,
    }


@router.get("/pnl")
def pnl(
    start: date | None = None,
    end: date | None = None,
    entity_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Business profit & loss: revenue by category, expenses by category, gross profit, net profit."""
    start, end = _fy(start, end)

    entities = db.query(models.Entity).all()
    kinds = {e.id: e.kind for e in entities}
    entity_names = {e.id: e.name for e in entities}

    # Determine which entity ids count as "business" for this view
    if entity_id:
        biz_ids = {entity_id}
    else:
        biz_ids = {eid for eid, k in kinds.items() if k in ("business", "company", "sole_trader")}

    q = db.query(models.Transaction).filter(
        models.Transaction.date >= start,
        models.Transaction.date <= end,
        models.Transaction.entity_id.in_(biz_ids),
    )
    txs = q.all()

    # Exclude internal transfers
    transfer_cat_ids = {
        c.id for c in db.query(models.Category).filter(
            models.Category.name.in_(["Internal Transfer", "Transfer Income"])
        ).all()
    }
    txs = [t for t in txs if t.category_id not in transfer_cat_ids]

    cat_names = {c.id: c.name for c in db.query(models.Category).all()}

    # Revenue by category
    revenue_by_cat: dict[str, int] = defaultdict(int)
    # Expenses by category
    expenses_by_cat: dict[str, int] = defaultdict(int)
    # Expenses by entity (for breakdown)
    expenses_by_entity: dict[str, int] = defaultdict(int)

    total_revenue = 0
    total_expenses = 0
    drawings_total = 0

    for t in txs:
        cat = cat_names.get(t.category_id, "Uncategorised")
        if t.direction == "in":
            revenue_by_cat[cat] += t.amount_cents
            total_revenue += t.amount_cents
        else:
            if t.income_type == "drawing":
                drawings_total += t.amount_cents
            else:
                expenses_by_cat[cat] += t.amount_cents
                expenses_by_entity[entity_names.get(t.entity_id, "Unknown")] += t.amount_cents
                total_expenses += t.amount_cents

    gross_profit = total_revenue - total_expenses
    net_profit = gross_profit - drawings_total

    # Month-by-month P&L
    by_month: dict[str, dict] = defaultdict(lambda: {"revenue": 0, "expenses": 0})
    for t in txs:
        mk = t.date.strftime("%Y-%m")
        if t.direction == "in":
            by_month[mk]["revenue"] += t.amount_cents
        elif t.income_type != "drawing":
            by_month[mk]["expenses"] += t.amount_cents

    return {
        "period": {"start": str(start), "end": str(end)},
        "total_revenue_cents": total_revenue,
        "total_expenses_cents": total_expenses,
        "gross_profit_cents": gross_profit,
        "drawings_cents": drawings_total,
        "net_profit_cents": net_profit,
        "revenue_by_category": dict(sorted(revenue_by_cat.items(), key=lambda x: -x[1])),
        "expenses_by_category": dict(sorted(expenses_by_cat.items(), key=lambda x: -x[1])),
        "expenses_by_entity": dict(sorted(expenses_by_entity.items(), key=lambda x: -x[1])),
        "by_month": dict(sorted(by_month.items())),
    }


@router.get("/tax-pack")
def tax_pack(
    start: date | None = None,
    end: date | None = None,
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    start, end = _fy(start, end)
    eids = get_user_entity_ids(current_user, db)
    s = _summary_for_user(start, end, None, entity_id, db, eids)

    cq = db.query(models.CgtEvent).filter(
        models.CgtEvent.date >= start,
        models.CgtEvent.date <= end,
        models.CgtEvent.entity_id.in_(eids),
    )
    if entity_id:
        cq = cq.filter(models.CgtEvent.entity_id == entity_id)
    cgt = cq.all()
    cgt_gross = sum(e.gain_cents for e in cgt)
    cgt_taxable = sum(
        int(e.gain_cents * (0.5 if e.discounted and e.gain_cents > 0 else 1.0))
        for e in cgt
    )

    taxable_income = (s["taxed_income_cents"] + s["untaxed_income_cents"] + cgt_taxable) / 100
    est_tax = income_tax(taxable_income) + taxable_income * MEDICARE_LEVY

    return {
        "period": s["period"],
        "income_by_type_cents": s["by_income_type"],
        "capital_gains_gross_cents": cgt_gross,
        "capital_gains_taxable_cents": cgt_taxable,
        "estimated_taxable_income_cents": int(round(taxable_income * 100)),
        "estimated_tax_cents": int(round(est_tax * 100)),
        "tax_withheld_cents": s["tax_withheld_cents"],
        "estimated_balance_owing_cents": int(round(est_tax * 100)) - s["tax_withheld_cents"],
        "gst_owed_cents": s["gst_owed_cents"],
    }
