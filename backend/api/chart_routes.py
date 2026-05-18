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
INTRADAY_CACHE_TTL = 15   # seconds
DAILY_CACHE_TTL    = 300  # seconds

# Separate cache for live snapshot prices (30-second TTL)
_live_cache: dict = {}
LIVE_CACHE_TTL = 30  # seconds

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


async def _fetch_live_snapshot_yfinance(sym: str) -> dict | None:
    """
    Fetch the current live/last price from yfinance (free, no API key needed).
    Returns dict with price, open, high, low, volume, change_pct or None on failure.
    yfinance gives the real-time last trade price during market hours.
    """
    import yfinance as yf

    def _fetch():
        try:
            ticker = yf.Ticker(sym)
            info = ticker.fast_info
            # fast_info has: last_price, open, day_high, day_low, three_month_avg_volume, etc.
            price = getattr(info, 'last_price', None) or getattr(info, 'regularMarketPrice', None)
            if not price:
                return None
            prev_close = getattr(info, 'previous_close', None)
            change_pct = None
            if prev_close and prev_close > 0:
                change_pct = round((price - prev_close) / prev_close * 100, 2)
            return {
                "price": round(float(price), 4),
                "open":  round(float(getattr(info, 'open', price) or price), 4),
                "high":  round(float(getattr(info, 'day_high', price) or price), 4),
                "low":   round(float(getattr(info, 'day_low', price) or price), 4),
                "volume": float(getattr(info, 'three_month_avg_volume', 0) or 0),
                "prev_close": round(float(prev_close), 4) if prev_close else None,
                "change_pct": change_pct,
            }
        except Exception as e:
            logger.debug(f"yfinance fast_info failed for {sym}: {e}")
            return None

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        return result
    except Exception as e:
        logger.debug(f"yfinance live price executor failed for {sym}: {e}")
        return None


async def _fetch_live_snapshot_polygon(sym: str) -> dict | None:
    """
    Attempt Polygon snapshot — works on paid plans.
    Falls back gracefully to None on free tier (403/empty response).
    """
    try:
        url = f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{sym.upper()}"
        data = await polygon_get(url)
        ticker = data.get("ticker", {})
        day = ticker.get("day", {})
        last_trade = ticker.get("lastTrade", {})
        prev_day = ticker.get("prevDay", {})

        price = (
            _safe_float(last_trade.get("p"))
            or _safe_float(day.get("c"))
            or _safe_float(prev_day.get("c"))
        )
        if not price:
            return None

        prev_close = _safe_float(prev_day.get("c"))
        change_pct = _safe_float(ticker.get("todaysChangePerc"))

        return {
            "price": price,
            "open":  _safe_float(day.get("o")) or price,
            "high":  _safe_float(day.get("h")) or price,
            "low":   _safe_float(day.get("l")) or price,
            "volume": _safe_float(day.get("v")) or 0,
            "prev_close": prev_close,
            "change_pct": change_pct,
        }
    except Exception as e:
        logger.debug(f"Polygon snapshot failed for {sym}: {e}")
        return None


async def _fetch_live_snapshot_price(sym: str) -> dict | None:
    """
    Fetch live price. Tries Polygon first (paid tier), falls back to yfinance (free).
    Results cached for LIVE_CACHE_TTL seconds to avoid hammering APIs.
    """
    now = time.time()
    if sym in _live_cache:
        cached_at, cached_data = _live_cache[sym]
        if now - cached_at < LIVE_CACHE_TTL:
            return cached_data

    # Try Polygon first (fast if on paid tier)
    result = await _fetch_live_snapshot_polygon(sym)

    # Fall back to yfinance if Polygon gave nothing
    if not result:
        result = await _fetch_live_snapshot_yfinance(sym)

    if result:
        _live_cache[sym] = (now, result)

    return result


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

    yf_interval_map = {
        "5m": "5m", "15m": "15m", "30m": "30m",
        "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1d", "1wk": "1wk",
    }
    yf_interval = yf_interval_map.get(interval, "1d")
    if yf_interval == "4h":
        yf_interval = "1h"

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
            import pandas as pd2
            unix_ts = int(pd2.Timestamp(ts).timestamp())
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
    Return the current real-time price.
    Primary: Polygon snapshot (paid tier). Fallback: yfinance (free, real-time).
    Cached for 30 seconds to avoid hammering APIs.
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
    Primary source: Polygon.io (historical). Fallback: yfinance.
    Live price patched onto last candle from yfinance fast_info (free, real-time).
    Intraday cache: 15 seconds. Daily cache: 5 minutes.
    Response: { symbol, candles: [{time,open,high,low,close,volume}], live_price }
    """
    sym = symbol.strip().upper()
    is_intraday = interval in INTRADAY_INTERVALS

    if period == "1y" and interval != "1d":
        period = DEFAULT_PERIOD_FOR_INTERVAL.get(interval, "1mo")

    cache_key = (sym, period, interval)
    now = time.time()
    ttl = INTRADAY_CACHE_TTL if is_intraday else DAILY_CACHE_TTL

    # Return cached result if fresh — still patch last candle with fresh live price
    if cache_key in _cache:
        cached_at, cached_candles = _cache[cache_key]
        if now - cached_at < ttl:
            snap = await _fetch_live_snapshot_price(sym)
            candles = list(cached_candles)
            if snap and candles:
                last = dict(candles[-1])
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
                "change_pct": snap["change_pct"] if snap else None,
                "source": "cache",
            }

    from_date, to_date = _period_to_dates(period)

    # Fetch candles + live price concurrently
    candles = []
    snap = None
    source = "polygon"
    try:
        candles, snap = await asyncio.gather(
            _fetch_polygon_candles(sym, from_date, to_date, interval),
            _fetch_live_snapshot_price(sym),
        )
        logger.info(f"Polygon returned {len(candles)} {interval} candles for {sym}")
    except Exception as e:
        logger.warning(f"Polygon candle fetch failed for {sym} ({interval}): {e}")
        source = "yfinance"

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

    # Cache raw candles
    _cache[cache_key] = (now, candles)

    # Patch last candle with live price so chart always shows current tick
    live_price = None
    change_pct = None
    if snap:
        live_price = snap["price"]
        change_pct = snap.get("change_pct")
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
        "change_pct": change_pct,
        "source": source,
    }
