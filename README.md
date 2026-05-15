# Orbis — Stock Breakout Scanner

Orbis is a real-time stock breakout scanner and trading intelligence platform. It scans the market for technical breakout patterns, delivers AI-powered insights, and gives traders the tools to find high-probability setups before they move.

---

## Pricing

| Plan | Price | Trial |
|------|-------|-------|
| **Core** | $39 / month | 7-day free trial |
| **Premium** | $79 / month | 7-day free trial |

**Core** includes the breakout scanner, charting & technicals, up to 5 saved scans, email alerts, and paper trading.

**Premium** adds full alt data, AI Insights (Sean), unlimited saved strategies & scans, SMS alerts, and broker connections.

> Stripe integration is coming soon. Placeholder price IDs (`price_core_monthly`, `price_premium_monthly`) are defined in `frontend/src/lib/pricing.ts`.

---

## Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- Framer Motion
- React Router v7
- Supabase JS (auth + data)
- Recharts

**Backend**
- Python / Flask
- SQLAlchemy
- Supabase (Postgres)

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- A Supabase project (see `SUPABASE_SETUP.sql`)

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # add DATABASE_URL and other secrets
python app.py
```

---

## Notes

- **Stripe integration is coming soon.** The pricing config and placeholder price IDs are already wired up in `frontend/src/lib/pricing.ts` — connect a Stripe Checkout or Billing session when ready.
- See `backend/SETUP.md` for detailed backend configuration and `backend/TESTING.md` for running the test suite.
