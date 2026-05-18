from fastapi import APIRouter, HTTPException, Query
import math
import time
import asyncio
import logging
from datetime import datetime, timedelta
from config import settings
from providers.polygon import POLYGON_BASE, polygon_get

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory cache: cache_key -> (timestamp, candles)
_cache: dict = {}
# Intraday intervals cache 15 seconds; daily caches 5 minutes
INTRADAY_CACHE_TTL = 15   # seconds — keeps chart nearly real-time during market hours
DAILY_CACHE_TTL    = 300  # seconds — daily bars don't need frequent refresh

# Separate cache for live snapshot prices (5-second TTL)
_live_cache: dict = {}
LIVE_CACHE_TTL = 5  # seconds

def _safe_float(val):
    """Convert a value to float, returning None for NaN/inf."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except Exception:
        return None

def _period_to_dates(period: str):
    """Convert a period string like '1y', '6mo' to (from_date, to_date) strings."""
    to_date = datetime.utcnow()
    period_map = {
        "1d": timedelta(days=1),
        "3d": timedelta(days=3),
        "5d": timedelta(days=5),
        "7d": timedelta(days=7),
        "10d": timedelta(days=10),
        "14d": timedelta(days=14),
        "1mo": timedelta(days=30),
        "3mo": timedelta(days=90),
        "6mo": timedelta(days=180),
        "1y": timedelta(days=365),
        "2y": timedelta(days=730),
        "5y": timedelta(days=1825),
    }
    delta = period_map.get(period, timedelta(days=365))
    from_date = to_date - delta
    return from_date.strftime("%Y-%m-%d"), to_date.strftime("%Y-%m-%d")

# Maps our interval key -> (polygon multiplier, polygon timespan)
POLYGON_INTERVAL_MAP = {
    "5m": ("5", "minute"),
    "15m": ("15", "minute"),
    "30m": ("30", "minute"),
    "1h": ("1", "hour"),
    "2h": ("2", "hour"),
    "4h": ("4", "hour"),
    "1d": ("1", "day"),
    "1wk": ("1", "week"),
}

# Default period to fetch for each interval (enough bars to be useful)
DEFAULT_PERIOD_FOR_INTERVAL = {
    "5m": "5d",
    "15m": "10d",
    "30m": "14d",
    "1h": "1mo",
    "2h": "1mo",
    "4h": "3mo",
    "1d": "1y",
    "1wk": "5y",
}

INTRADAY_INTERVALS = {"5m", "15m", "30m", "1h", "2h", "4h"}


async def _fetch_live_snapshot_price(sym: str) -> dict | None:
    """
    Fetch the current live price from Polygon snapshot.
    Returns dict with price, open, high, low, volume or None on failure.
    Bypasses the candle cache — always fresh.
    """
    # Check short-lived live cache first
    now = time.time()
    if sym in _live_cache:
        cached_at, cached_data = _live_cache[sym]
        if now - cached_at < LIVE_CACHE_TTL:
            return cached_data

    try:
        url = f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{sym}"
        data = await polygon_get(url)
        ticker = data.get("ticker", {})

        # Intraday running day bar
        day = ticker.get("day", {})
        last_trade = ticker.get("lastTrade", {})
        prev_day = ticker.get("prevDay", {})

        # Best live price: last trade > day close > prev close
        price = (
            _safe_float(last_trade.get("p"))
            or _safe_float(day.get("c"))
            or _safe_float(prev_day.get("c"))
        )
        if not price:
            return None

        result = {
            "price": price,
            "open":  _safe_float(day.get("o")) or price,
            "high":  _safe_float(day.get("h")) or price,
            "low":   _safe_float(day.get("l")) or price,
            "volume": _safe_float(day.get("v")) or 0,
            "prev_close": _safe_float(prev_day.get("c")),
            "change_pct": _safe_float(ticker.get("todaysChangePerc")),
        }
        _live_cache[sym] = (now, result)
        return result

    except Exception as e:
        logger.debug(f"Snapshot fetch failed for {sym}: {e}")
        return None


async def _fetch_polygon_candles(sym: str, from_date: str, to_date: str, interval: str) -> list:
    """Fetch OHLCV candles from Polygon.io. Returns list of candle dicts."""
    multiplier, timespan = POLYGON_INTERVAL_MAP.get(interval, ("1", "day"))

    url = f"{POLYGON_BASE}/v2/aggs/ticker/{sym}/range/{multiplier}/{timespan}/{from_date}/{to_date}"
    data = await polygon_get(url, {
        "adjusted": "true",
        "sort": "asc",
        "limit": 50000,
    })

    results = data.get("results", [])
    candles = []
    for r in results:
        # Polygon timestamps are milliseconds — convert to seconds
        unix_ts = int(r.get("t", 0)) // 1000
        o = _safe_float(r.get("o"))
        h = _safe_float(r.get("h"))
        lo = _safe_float(r.get("l"))
        c = _safe_float(r.get("c"))
        v = _safe_float(r.get("v"))
        if any(x is None for x in (o, h, lo, c)):
            continue
        candles.append({"time": unix_ts, "open": o, "high": h, "low": lo, "close": c, "volume": v or 0})

    candles.sort(key=lambda x: x["time"])
    return candles


async def _fetch_yfinance_candles(sym: str, period: str, interval: str) -> list:
    """Fallback: fetch OHLCV from yfinance. Returns list of candle dicts."""
    import yfinance as yf
    import pandas as pd

    # yfinance interval strings differ from ours
    yf_interval_map = {
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "2h": "2h",
        "4h": "4h",  # yfinance doesn't support 4h natively — will use 1h
        "1d": "1d",
        "1wk": "1wk",
    }
    yf_interval = yf_interval_map.get(interval, "1d")
    # yfinance 4h not supported — fall back to 1h
    if yf_interval == "4h":
        yf_interval = "1h"

    # yfinance period strings
    yf_period_map = {
        "1d": "1d", "3d": "5d", "5d": "5d", "7d": "7d",
        "10d": "10d", "14d": "14d", "1mo": "1mo", "3mo": "3mo",
        "6mo": "6mo", "1y": "1y", "2y": "2y", "5y": "5y",
    }
    yf_period = yf_period_map.get(period, "1y")

    def _fetch():
        ticker = yf.Ticker(sym)
        df = ticker.history(period=yf_period, interval=yf_interval, auto_adjust=True)
        return df

    df = await asyncio.get_event_loop().run_in_executor(None, _fetch)
    if df is None or df.empty:
        return []

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
        candles.append({"time": unix_ts, "open": o, "high": h, "low": lo, "close": c, "volume": v or 0})

    candles.sort(key=lambda x: x["time"])
    return candles


@router.get("/live-price/{symbol}")
async def get_live_price(symbol: str):
    """
    Return the current real-time price from Polygon snapshot.
    Bypasses the candle cache. Cached for 5 seconds max.
    Used by the frontend for the live price tick overlay.
    Response: { symbol, price, open, high, low, volume, change_pct, prev_close }
    """
    sym = symbol.strip().upper()
    snap = await _fetch_live_snapshot_price(sym)
    if not snap:
        raise HTTPException(status_code=404, detail=f"No live price data for {sym}")
    return {"symbol": sym, **snap}


@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    period: str = Query(default="1y", description="Period: 5d, 1mo, 3mo, 1y, etc."),
    interval: str = Query(default="1d", description="Interval: 5m, 15m, 30m, 1h, 2h, 4h, 1d"),
):
    """
    Return OHLCV candles for the lightweight-charts frontend chart.
    Supports intraday (5m, 15m, 30m, 1h, 2h, 4h) and daily (1d) intervals.
    Primary source: Polygon.io. Fallback: yfinance.

    Intraday intervals: cached 15 seconds. Daily: cached 5 minutes.
    The LAST candle is always patched with the live Polygon snapshot price so
    the chart shows the current tick price even if the last completed bar is stale.

    Response: { symbol, candles: [{time, open, high, low, close, volume}], live_price }
    time is Unix timestamp (seconds).
    """
    sym = symbol.strip().upper()
    is_intraday = interval in INTRADAY_INTERVALS

    # If no period specified, pick a sensible default for the interval
    if period == "1y" and interval != "1d":
        period = DEFAULT_PERIOD_FOR_INTERVAL.get(interval, "1mo")

    cache_key = (sym, period, interval)
    now = time.time()
    ttl = INTRADAY_CACHE_TTL if is_intraday else DAILY_CACHE_TTL

    # Return cached result if fresh
    if cache_key in _cache:
        cached_at, cached_candles = _cache[cache_key]
        if now - cached_at < ttl:
            # Even on cache hit, patch last candle with fresh snapshot
            snap = await _fetch_live_snapshot_price(sym)
            candles = list(cached_candles)  # shallow copy
            if snap and candles:
                last = dict(candles[-1])  # don't mutate cached entry
                last["close"] = snap["price"]
                if snap["high"] and snap["high"] > last["high"]:
                    last["high"] = snap["high"]
                if snap["low"] and snap["low"] < last["low"]:
                    last["low"] = snap["low"]
                candles[-1] = last
            return {
                "symbol": sym,
                "candles": candles,
                "live_price": snap["price"] if snap else None,
                "source": "cache",
            }

    from_date, to_date = _period_to_dates(period)

    # Try Polygon first; run candle fetch + snapshot concurrently
    candles = []
    source = "polygon"
    snap = None
    try:
        candles, snap = await asyncio.gather(
            _fetch_polygon_candles(sym, from_date, to_date, interval),
            _fetch_live_snapshot_price(sym),
        )
        logger.info(f"Polygon returned {len(candles)} {interval} candles for {sym}")
    except Exception as e:
        logger.warning(f"Polygon candle fetch failed for {sym} ({interval}): {e} — falling back to yfinance")
        source = "yfinance"

    # Fallback to yfinance if Polygon returned nothing or errored
    if not candles:
        try:
            candles = await _fetch_yfinance_candles(sym, period, interval)
            source = "yfinance"
            logger.info(f"yfinance returned {len(candles)} {interval} candles for {sym}")
        except Exception as e:
            logger.error(f"yfinance fallback also failed for {sym}: {e}")
            raise HTTPException(status_code=502, detail=f"Data fetch failed for {sym}: {e}")

    if not candles:
        raise HTTPException(status_code=404, detail=f"No candle data found for {sym}")

    # Store raw candles in cache (without snapshot patch so cache stays neutral)
    _cache[cache_key] = (now, candles)

    # Patch last candle with live snapshot price so chart shows current tick
    live_price = None
    if snap:
        live_price = snap["price"]
        last = dict(candles[-1])
        last["close"] = snap["price"]
        if snap["high"] and snap["high"] > last["high"]:
            last["high"] = snap["high"]
        if snap["low"] and snap["low"] < last["low"]:
            last["low"] = snap["low"]
        candles = candles[:-1] + [last]

    return {
        "symbol": sym,
        "candles": candles,
        "live_price": live_price,
        "source": source,
    }
