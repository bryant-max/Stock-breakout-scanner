from fastapi import APIRouter, HTTPException, Query
import yfinance as yf
import pandas as pd
import math

router = APIRouter()


def _safe_float(val):
    """Convert a value to float, returning None for NaN/inf."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except Exception:
        return None


@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    period: str = Query(default="1y", description="yfinance period: 6mo, 1y, 2y"),
    interval: str = Query(default="1d", description="yfinance interval: 1d, 1wk"),
):
    """
    Return OHLCV daily candles for the lightweight-charts frontend chart.
    Response shape: { symbol, candles: [{time, open, high, low, close, volume}] }
    time is a Unix timestamp (seconds).
    """
    sym = symbol.strip().upper()
    try:
        ticker = yf.Ticker(sym)
        df: pd.DataFrame = ticker.history(period=period, interval=interval, auto_adjust=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No candle data found for {sym}")

    candles = []
    for ts, row in df.iterrows():
        # ts is a pandas Timestamp; convert to Unix seconds
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
    return {"symbol": sym, "candles": candles}
