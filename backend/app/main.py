import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import date, timedelta

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .config import get_settings
from .database import Base, engine, SessionLocal
from . import models
from .auth import hash_password, verify_password, create_token, get_current_user
from .routers import (
    entities, accounts, transactions, categories, imports,
    receipts, clients, invoices, investments, dashboard, up_banking, commitments,
    networth,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# Create tables on startup (dev). For prod use Alembic migrations.
Base.metadata.create_all(bind=engine)


def _lightweight_migrate():
    """Add new columns to existing SQLite tables without dropping data."""
    if not engine.url.drivername.startswith("sqlite"):
        return
    insp = inspect(engine)
    existing_entities = {c["name"] for c in insp.get_columns("entities")}
    entity_additions = {
        "kind": "VARCHAR DEFAULT 'business'",
        "email": "VARCHAR", "phone": "VARCHAR", "address": "TEXT",
        "bank_name": "VARCHAR", "bsb": "VARCHAR", "bank_account_name": "VARCHAR",
        "bank_account_number": "VARCHAR", "payment_terms_days": "INTEGER DEFAULT 30",
        "invoice_footer": "TEXT", "up_api_token": "VARCHAR",
    }
    existing_accounts = {c["name"] for c in insp.get_columns("accounts")}
    account_additions = {
        "up_account_id": "VARCHAR",
    }
    existing_txns = {c["name"] for c in insp.get_columns("transactions")}
    txn_additions = {
        "is_recurring": "BOOLEAN DEFAULT 0",
        "recurrence_freq": "VARCHAR",
        "recurring_override": "BOOLEAN DEFAULT 0",
    }
    existing_clients = {c["name"] for c in insp.get_columns("clients")}
    client_additions = {
        "phone": "VARCHAR",
    }
    existing_nwi = {c["name"] for c in insp.get_columns("net_worth_items")} if "net_worth_items" in set(insp.get_table_names()) else set()
    existing_receipts = {c["name"] for c in insp.get_columns("receipts")} if "receipts" in set(insp.get_table_names()) else set()
    existing_invoices = {c["name"] for c in insp.get_columns("invoices")}
    invoice_additions = {
        "deposit_cents": "INTEGER",
        "deposit_pct": "FLOAT",
        "reminder_freq": "VARCHAR",
    }
    # Users table and entity ownership (added for multi-user auth)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        if "users" not in existing_tables:
            conn.execute(text(
                "CREATE TABLE users ("
                "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "  email VARCHAR NOT NULL UNIQUE,"
                "  password_hash VARCHAR NOT NULL,"
                "  name VARCHAR DEFAULT '',"
                "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
                ")"
            ))
        if "entities" in existing_tables and "user_id" not in existing_entities:
            conn.execute(text("ALTER TABLE entities ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            # Seed a default admin user from the existing APP_PASSWORD and assign all
            # existing entities to them so no data is orphaned after this migration.
            admin_email = "admin@ledger.local"
            existing_admin = conn.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": admin_email}
            ).fetchone()
            if existing_admin:
                admin_id = existing_admin[0]
            else:
                pw_hash = hash_password(settings.app_password)
                conn.execute(
                    text("INSERT INTO users (email, password_hash, name) VALUES (:e, :p, :n)"),
                    {"e": admin_email, "p": pw_hash, "n": "Admin"},
                )
                admin_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
            conn.execute(
                text("UPDATE entities SET user_id = :uid WHERE user_id IS NULL"),
                {"uid": admin_id},
            )
            logger.info(
                "Migration: created admin user (%s) and assigned existing entities. "
                "Login with email '%s' and your APP_PASSWORD.",
                admin_id, admin_email,
            )
    with engine.begin() as conn:
        for col, ddl in entity_additions.items():
            if col not in existing_entities:
                conn.execute(text(f"ALTER TABLE entities ADD COLUMN {col} {ddl}"))
        for col, ddl in account_additions.items():
            if col not in existing_accounts:
                conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {col} {ddl}"))
        for col, ddl in txn_additions.items():
            if col not in existing_txns:
                conn.execute(text(f"ALTER TABLE transactions ADD COLUMN {col} {ddl}"))
        for col, ddl in client_additions.items():
            if col not in existing_clients:
                conn.execute(text(f"ALTER TABLE clients ADD COLUMN {col} {ddl}"))
        for col, ddl in invoice_additions.items():
            if col not in existing_invoices:
                conn.execute(text(f"ALTER TABLE invoices ADD COLUMN {col} {ddl}"))
        if "net_worth_items" in existing_tables and "user_id" not in existing_nwi:
            conn.execute(text("ALTER TABLE net_worth_items ADD COLUMN user_id INTEGER REFERENCES users(id)"))
        if "receipts" in existing_tables and "user_id" not in existing_receipts:
            conn.execute(text("ALTER TABLE receipts ADD COLUMN user_id INTEGER REFERENCES users(id)"))


_lightweight_migrate()


async def _hourly_up_sync():
    """Background task: sync all UP-connected entities once per hour."""
    from .routers.up_banking import _do_sync as _sync, SyncIn

    INTERVAL = 3600  # seconds
    await asyncio.sleep(60)  # short initial delay so the server is fully up

    while True:
        try:
            db = SessionLocal()
            try:
                entities_with_token = db.query(models.Entity).filter(
                    models.Entity.up_api_token.isnot(None)
                ).all()
                since = (date.today() - timedelta(days=2)).isoformat()
                for entity in entities_with_token:
                    try:
                        _sync(SyncIn(entity_id=entity.id, since=since), db)
                        logger.info("Auto-synced UP for entity %s", entity.id)
                    except Exception as exc:
                        logger.warning("Auto-sync failed for entity %s: %s", entity.id, exc)
            finally:
                db.close()
        except Exception as exc:
            logger.warning("Hourly UP sync error: %s", exc)

        await asyncio.sleep(INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_hourly_up_sync())
    yield
    task.cancel()


if settings.is_using_defaults():
    logger.warning(
        "\n\n  ⚠  Running with default credentials (app_password='changeme').\n"
        "     Set APP_PASSWORD and SECRET_KEY in your .env file before exposing\n"
        "     this app outside localhost.\n"
    )

app = FastAPI(title="Ledger — Finance Manager API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "stripe": bool(settings.stripe_secret_key)}


@app.post("/api/login")
def login(payload: dict):
    db = SessionLocal()
    try:
        user = db.query(models.User).filter_by(email=payload.get("email", "")).first()
        if not user or not verify_password(payload.get("password", ""), user.password_hash):
            raise HTTPException(401, "Invalid email or password")
        return {"token": create_token(user.id), "name": user.name, "email": user.email}
    finally:
        db.close()


@app.post("/api/signup")
def signup(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    name = (payload.get("name") or "").strip()
    if not email or not password:
        raise HTTPException(400, "Email and password are required")
    db = SessionLocal()
    try:
        if db.query(models.User).filter_by(email=email).first():
            raise HTTPException(409, "An account with that email already exists")
        user = models.User(email=email, password_hash=hash_password(password), name=name)
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"token": create_token(user.id), "name": user.name, "email": user.email}
    finally:
        db.close()


@app.get("/api/me")
def me(current_user: models.User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "name": current_user.name}


for r in (entities, accounts, transactions, categories, imports,
          receipts, clients, invoices, investments, dashboard, up_banking, commitments,
          networth):
    app.include_router(r.router)
