-- Paper trading table for simulated options trades
CREATE TABLE IF NOT EXISTS public.paper_trades (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    contract_ticker TEXT NOT NULL,
    contract_type   TEXT NOT NULL CHECK (contract_type IN ('call', 'put')),
    strike_price    NUMERIC(12, 4) NOT NULL,
    expiration_date DATE NOT NULL,
    action          TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    price_per_contract NUMERIC(12, 4) NOT NULL,
    premium_paid    NUMERIC(14, 2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
    notes           TEXT,
    traded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS paper_trades_user_id_idx
    ON public.paper_trades (user_id, traded_at DESC);

-- RLS: users can only see and manage their own paper trades
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper trades"
    ON public.paper_trades FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own paper trades"
    ON public.paper_trades FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paper trades"
    ON public.paper_trades FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admin read all
CREATE POLICY "Admins can view all paper trades"
    ON public.paper_trades FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.is_admin = true
        )
    );
