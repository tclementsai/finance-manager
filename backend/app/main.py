import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .config import get_settings
from .database import Base, engine, SessionLocal
from . import models
from .auth import hash_password
from .routers import (
    entities, accounts, transactions, categories, imports,
    receipts, clients, invoices, investments, dashboard, up_banking, commitments,
    networth, auth, settings,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# Create tables on startup (dev). For prod use Alembic migrations.
Base.metadata.create_all(bind=engine)


def _lightweight_migrate():
    """Add new columns to existing tables without dropping data."""
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
        "income_type": "VARCHAR",
        "tax_withheld_cents": "INTEGER DEFAULT 0",
        "gst_cents": "INTEGER DEFAULT 0",
        "is_deductible": "BOOLEAN DEFAULT FALSE",
        "business_use_pct": "INTEGER DEFAULT 100",
        "source": "VARCHAR DEFAULT 'manual'",
        "external_id": "VARCHAR",
        "is_recurring": "BOOLEAN DEFAULT FALSE",
        "recurrence_freq": "VARCHAR",
        "recurring_override": "BOOLEAN DEFAULT FALSE",
        "receipt_id": "INTEGER REFERENCES receipts(id)",
        "created_at": "DATETIME",
        "account_id": "INTEGER REFERENCES accounts(id)",
    }
    existing_clients = {c["name"] for c in insp.get_columns("clients")}
    client_additions = {
        "phone": "VARCHAR",
    }
    existing_tables = set(insp.get_table_names())
    existing_nwi = {c["name"] for c in insp.get_columns("net_worth_items")} if "net_worth_items" in existing_tables else set()
    existing_receipts_cols = {c["name"] for c in insp.get_columns("receipts")} if "receipts" in existing_tables else set()
    existing_invoices = {c["name"] for c in insp.get_columns("invoices")}
    invoice_additions = {
        "deposit_cents": "INTEGER",
        "deposit_pct": "FLOAT",
        "reminder_freq": "VARCHAR",
    }

    with engine.begin() as conn:
        if "users" not in existing_tables:
            conn.execute(text(
                "CREATE TABLE users ("
                "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "  username VARCHAR NOT NULL UNIQUE,"
                "  password_hash VARCHAR NOT NULL,"
                "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
                ")"
            ))
        if "entities" in existing_tables and "user_id" not in existing_entities:
            conn.execute(text("ALTER TABLE entities ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            # Seed a default admin user and assign all existing entities to them.
            admin_username = "admin"
            existing_admin = conn.execute(
                text("SELECT id FROM users WHERE username = :u"), {"u": admin_username}
            ).fetchone()
            if existing_admin:
                admin_id = existing_admin[0]
            else:
                pw_hash = hash_password(settings.app_password)
                conn.execute(
                    text("INSERT INTO users (username, password_hash) VALUES (:u, :p)"),
                    {"u": admin_username, "p": pw_hash},
                )
                admin_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
            conn.execute(
                text("UPDATE entities SET user_id = :uid WHERE user_id IS NULL"),
                {"uid": admin_id},
            )
            logger.info(
                "Migration: created admin user (id=%s). "
                "Login with username 'admin' and your APP_PASSWORD.",
                admin_id,
            )

    with engine.begin() as conn:
        existing_users = {c["name"] for c in insp.get_columns("users")}
        if "totp_secret" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN totp_secret VARCHAR"))
        if "totp_enabled" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE"))
        if "stripe_secret_key" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN stripe_secret_key VARCHAR"))
        if "stripe_webhook_secret" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN stripe_webhook_secret VARCHAR"))

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
        if "receipts" in existing_tables and "user_id" not in existing_receipts_cols:
            conn.execute(text("ALTER TABLE receipts ADD COLUMN user_id INTEGER REFERENCES users(id)"))


_lightweight_migrate()


def _seed_accounts():
    """Create default dev user accounts if they don't already exist."""
    from .routers.auth import _hash
    db = SessionLocal()
    try:
        defaults = [
            ("trstnclements", "password"),
            ("s4m.seymon", "password"),
        ]
        for username, password in defaults:
            if not db.query(models.User).filter_by(username=username).first():
                db.add(models.User(username=username, password_hash=_hash(password)))
        db.commit()
    finally:
        db.close()


_seed_accounts()


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
        "     Set APP_PASSWORD, SECRET_KEY, and JWT_SECRET in your .env file before\n"
        "     exposing this app outside localhost.\n"
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


for r in (auth, entities, accounts, transactions, categories, imports,
          receipts, clients, invoices, investments, dashboard, up_banking, commitments,
          networth, settings):
    app.include_router(r.router)
