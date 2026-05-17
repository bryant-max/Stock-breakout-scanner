from fastapi import APIRouter, HTTPException, Query
import yfinance as yf
import pandas as pd
import math
import time
import asyncio
from functools import lru_cache

router = APIRouter()

# In-memory cache: (symbol, period) -> (timestamp, candles)
_cache: dict = {}
CACHE_TTL = 3600  # 1 hour


def _safe_float(val):
    """Convert a value to float, returning None for NaN/inf."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except Exception:
        return None


def _fetch_with_retry(sym: str, period: str, interval: str, retries: int = 3) -> pd.DataFrame:
    """Fetch yfinance data with simple retry on rate limit errors."""
    delay = 2
    last_exc = None
    for attempt in range(retries):
        try:
            ticker = yf.Ticker(sym)
            df = ticker.history(period=period, interval=interval, auto_adjust=True)
            if df is not None and not df.empty:
                return df
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            if "rate" in msg or "too many" in msg or "429" in msg:
                time.sleep(delay * (attempt + 1))
                continue
            raise
    if last_exc:
        raise last_exc
    return pd.DataFrame()


@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    period: str = Query(default="1y", description="yfinance period: 6mo, 1y, 2y"),
    interval: str = Query(default="1d", description="yfinance interval: 1d, 1wk"),
):
    """
    Return OHLCV daily candles for the lightweight-charts frontend chart.
    Response: { symbol, candles: [{time, open, high, low, close, volume}] }
    time is Unix timestamp (seconds).  Results are cached for 1 hour.
    """
    sym = symbol.strip().upper()
    cache_key = (sym, period, interval)
    now = time.time()

    # Return cached result if fresh
    if cache_key in _cache:
        cached_at, cached_candles = _cache[cache_key]
        if now - cached_at < CACHE_TTL:
            return {"symbol": sym, "candles": cached_candles, "cached": True}

    # Fetch from yfinance in a thread pool to avoid blocking the event loop
    try:
        df = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _fetch_with_retry(sym, period, interval)
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No candle data found for {sym}")

    candles = []
    for ts, row in df.iterrows():
        try:
            unix_ts = int(pd.Timestamp(ts).timestamp())
        except Exception:
            continue
        o = _safe_float(row.get("Open"))
        h = _safe_float(row.get("High"))
        lo = _safe_float(row.get("Low"))
        c = _safe_float(row.get("Close"))
        v = _safe_float(row.get("Volume"))
        if any(x is None for x in (o, h, lo, c)):
            continue
        candles.append({"time": unix_ts, "open": o, "high": h, "low": lo, "close": c, "volume": v})

    candles.sort(key=lambda x: x["time"])
    _cache[cache_key] = (now, candles)
    return {"symbol": sym, "candles": candles, "cached": False}
