# Ledger — Finance Manager

Self-hosted personal + business finance manager. Tracks income, captures receipts for tax deductions, generates Stripe invoices, and tells you **how much you've made** and **how much is actually yours to spend after tax & GST are set aside**.

Built for an AU two-entity setup: a **GST-registered company** and a **sole trader** — plus payroll, interest, and stock investments.

---

## Quick start (Docker — one command from the root)

```bash
cp backend/.env.example backend/.env   # edit secrets (see below)
npm run docker
```

- App: http://localhost:3000
- API docs: http://localhost:8077/docs

Sign up at http://localhost:3000/signup on first run.

---

## Local development (no Docker, SQLite)

**Backend**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit secrets
uvicorn app.main:app --port 8077 --reload
```

**Frontend** (separate terminal)
```bash
cd frontend
npm install
npm run dev
```

App → http://localhost:3000 · API → http://localhost:8077/docs

---

## Required config (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Fernet key for encrypting UP Banking tokens |
| `JWT_SECRET` | Yes | Signing key for login tokens |
| `APP_PASSWORD` | Yes | Password for the initial admin account |

On first startup the backend creates an `admin@ledger.local` account using `APP_PASSWORD` and assigns any existing data to it. Then sign up with your real email at `/signup`.

**Optional**

| Variable | Description |
|---|---|
| `DATABASE_URL` | Defaults to SQLite. Set a Postgres URL for prod. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Enables Stripe invoicing |
| `OCR_PROVIDER=docai` + `DOC_AI_PROCESSOR` | Enables Google Document AI for receipts |
| `DEFAULT_TAX_RATE` | Flat fallback set-aside rate (default `0.30`) |

---

## What's built

- **Auth** — Per-user accounts with JWT. Each user's data is fully isolated.
- **Phase 1** — Entities, accounts, manual entry, CSV import (column mapping + dedupe), categories, rules engine, dashboard with tax set-aside + GST tracking.
- **Phase 2** — Receipt upload + OCR (local heuristic or Google Document AI), deduction tagging with business-use %, EOFY deduction report by ATO category.
- **Phase 3** — Invoice builder with per-entity GST logic, Stripe send + webhook reconciliation.
- **Phase 4** — Holdings, CGT events (50% discount aware), interest/dividend income, EOFY tax pack.
- **Extras** — UP Banking live sync (hourly), recurring transaction detection, net worth tracker, commitments.

## Notes

Tax set-aside uses incremental marginal rate estimates (resident brackets + Medicare levy). Brackets are in [`backend/app/tax.py`](backend/app/tax.py) — **update each FY**. Estimates only; confirm with your accountant.

Full spec: [`docs/PROJECT-SPEC.md`](docs/PROJECT-SPEC.md)
