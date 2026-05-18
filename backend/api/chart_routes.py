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

_cache: dict = {}
INTRADAY_CACHE_TTL = 15
DAILY_CACHE_TTL    = 300

_live_cache: dict = {}
LIVE_CACHE_TTL = 30

def _safe_float(val):
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except Exception:
        return None

def _period_to_dates(period: str):
    to_date = datetime.utcnow()
    period_map = {
        "1d": timedelta(days=1), "3d": timedelta(days=3), "5d": timedelta(days=5),
        "7d": timedelta(days=7), "10d": timedelta(days=10), "14d": timedelta(days=14),
        "1mo": timedelta(days=30), "3mo": timedelta(days=90), "6mo": timedelta(days=180),
        "1y": timedelta(days=365), "2y": timedelta(days=730), "5y": timedelta(days=1825),
    }
    delta = period_map.get(period, timedelta(days=365))
    from_date = to_date - delta
    return from_date.strftime("%Y-%m-%d"), to_date.strftime("%Y-%m-%d")

POLYGON_INTERVAL_MAP = {
    "5m": ("5", "minute"), "15m": ("15", "minute"), "30m": ("30", "minute"),
    "1h": ("1", "hour"), "2h": ("2", "hour"), "4h": ("4", "hour"),
    "1d": ("1", "day"), "1wk": ("1", "week"),
}

DEFAULT_PERIOD_FOR_INTERVAL = {
    "5m": "5d", "15m": "10d", "30m": "14d", "1h": "1mo",
    "2h": "1mo", "4h": "3mo", "1d": "1y", "1wk": "5y",
}

INTRADAY_INTERVALS = {"5m", "15m", "30m", "1h", "2h", "4h"}


async def _fetch_live_snapshot_yfinance(sym: str) -> dict | None:
    """
    Fetch the current live/last price using yfinance.
    Strategy (most reliable first):
      1. fast_info.last_price  — real-time during market hours
      2. fast_info.previous_close — most recent close (pre/post market)
      3. history(period='2d', interval='1d').Close[-1] — guaranteed to return a price
    """
    import yfinance as yf
    import pandas as pd

    def _fetch():
        try:
            ticker = yf.Ticker(sym)

            # --- Attempt 1: fast_info ---
            try:
                fi = ticker.fast_info
                price = (
                    getattr(fi, 'last_price', None)
                    or getattr(fi, 'regularMarketPrice', None)
                )
                if price and float(price) > 0:
                    prev_close = getattr(fi, 'previous_close', None) or getattr(fi, 'regularMarketPreviousClose', None)
                    change_pct = None
                    if prev_close and float(prev_close) > 0:
                        change_pct = round((float(price) - float(prev_close)) / float(prev_close) * 100, 2)
                    return {
                        "price": round(float(price), 4),
                        "open":  round(float(getattr(fi, 'open', price) or price), 4),
                        "high":  round(float(getattr(fi, 'day_high', price) or price), 4),
                        "low":   round(float(getattr(fi, 'day_low', price) or price), 4),
                        "volume": float(getattr(fi, 'three_month_avg_volume', 0) or 0),
                        "prev_close": round(float(prev_close), 4) if prev_close else None,
                        "change_pct": change_pct,
                    }
            except Exception as e:
                logger.debug(f"fast_info attempt failed for {sym}: {e}")

            # --- Attempt 2: history 2d/1d (always works) ---
            try:
                df = ticker.history(period="2d", interval="1d", auto_adjust=True)
                if df is not None and not df.empty:
                    price = float(df["Close"].iloc[-1])
                    prev_close = float(df["Close"].iloc[-2]) if len(df) > 1 else None
                    change_pct = None
                    if prev_close and prev_close > 0:
                        change_pct = round((price - prev_close) / prev_close * 100, 2)
                    return {
                        "price": round(price, 4),
                        "open":  round(float(df["Open"].iloc[-1]), 4),
                        "high":  round(float(df["High"].iloc[-1]), 4),
                        "low":   round(float(df["Low"].iloc[-1]), 4),
                        "volume": float(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0,
                        "prev_close": round(prev_close, 4) if prev_close else None,
                        "change_pct": change_pct,
                    }
            except Exception as e:
                logger.debug(f"history fallback failed for {sym}: {e}")

            return None
        except Exception as e:
            logger.debug(f"yfinance live price failed for {sym}: {e}")
            return None

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _fetch)
    except Exception as e:
        logger.debug(f"yfinance executor failed for {sym}: {e}")
        return None


async def _fetch_live_snapshot_polygon(sym: str) -> dict | None:
    """Attempt Polygon snapshot (paid plans only). Returns None on free tier."""
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

        return {
            "price": price,
            "open":  _safe_float(day.get("o")) or price,
            "high":  _safe_float(day.get("h")) or price,
            "low":   _safe_float(day.get("l")) or price,
            "volume": _safe_float(day.get("v")) or 0,
            "prev_close": _safe_float(prev_day.get("c")),
            "change_pct": _safe_float(ticker.get("todaysChangePerc")),
        }
    except Exception as e:
        logger.debug(f"Polygon snapshot failed for {sym}: {e}")
        return None


async def _fetch_live_snapshot_price(sym: str) -> dict | None:
    """
    Fetch live price. Tries Polygon first (paid), falls back to yfinance (free).
    Cached LIVE_CACHE_TTL seconds.
    """
    now = time.time()
    if sym in _live_cache:
        cached_at, cached_data = _live_cache[sym]
        if now - cached_at < LIVE_CACHE_TTL:
            return cached_data

    # Try yfinance directly — most reliable on our free Polygon tier
    result = await _fetch_live_snapshot_yfinance(sym)

    # Also try Polygon in case we upgrade later
    if not result:
        result = await _fetch_live_snapshot_polygon(sym)

    if result:
        _live_cache[sym] = (now, result)

    return result


async def _fetch_polygon_candles(sym: str, from_date: str, to_date: str, interval: str) -> list:
    """Fetch OHLCV candles from Polygon.io."""
    multiplier, timespan = POLYGON_INTERVAL_MAP.get(interval, ("1", "day"))
    url = f"{POLYGON_BASE}/v2/aggs/ticker/{sym}/range/{multiplier}/{timespan}/{from_date}/{to_date}"
    data = await polygon_get(url, {"adjusted": "true", "sort": "asc", "limit": 50000})
    results = data.get("results", [])
    candles = []
    for r in results:
        unix_ts = int(r.get("t", 0)) // 1000
        o = _safe_float(r.get("o")); h = _safe_float(r.get("h"))
        lo = _safe_float(r.get("l")); c = _safe_float(r.get("c"))
        v = _safe_float(r.get("v"))
        if any(x is None for x in (o, h, lo, c)): continue
        candles.append({"time": unix_ts, "open": o, "high": h, "low": lo, "close": c, "volume": v or 0})
    candles.sort(key=lambda x: x["time"])
    return candles


async def _fetch_yfinance_candles(sym: str, period: str, interval: str) -> list:
    """Fallback candles from yfinance."""
    import yfinance as yf
    import pandas as pd

    yf_interval_map = {
        "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h",
        "2h": "2h", "4h": "4h", "1d": "1d", "1wk": "1wk",
    }
    yf_interval = yf_interval_map.get(interval, "1d")
    if yf_interval == "4h": yf_interval = "1h"

    yf_period_map = {
        "1d": "1d", "3d": "5d", "5d": "5d", "7d": "7d", "10d": "10d",
        "14d": "14d", "1mo": "1mo", "3mo": "3mo", "6mo": "6mo",
        "1y": "1y", "2y": "2y", "5y": "5y",
    }
    yf_period = yf_period_map.get(period, "1y")

    def _fetch():
        ticker = yf.Ticker(sym)
        return ticker.history(period=yf_period, interval=yf_interval, auto_adjust=True)

    df = await asyncio.get_event_loop().run_in_executor(None, _fetch)
    if df is None or df.empty: return []

    candles = []
    for ts, row in df.iterrows():
        try:
            import pandas as pd2
            unix_ts = int(pd2.Timestamp(ts).timestamp())
        except Exception: continue
        o = _safe_float(row.get("Open")); h = _safe_float(row.get("High"))
        lo = _safe_float(row.get("Low")); c = _safe_float(row.get("Close"))
        v = _safe_float(row.get("Volume"))
        if any(x is None for x in (o, h, lo, c)): continue
        candles.append({"time": unix_ts, "open": o, "high": h, "low": lo, "close": c, "volume": v or 0})
    candles.sort(key=lambda x: x["time"])
    return candles


@router.get("/live-price/{symbol}")
async def get_live_price(symbol: str):
    """
    Return the current real-time price.
    Uses yfinance history(2d) as guaranteed fallback — always returns a price.
    Cached 30 seconds.
    """
    sym = symbol.strip().upper()
    snap = await _fetch_live_snapshot_price(sym)
    if not snap:
        raise HTTPException(status_code=404, detail=f"No live price data for {sym}")
    return {"symbol": sym, **snap}


@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    period: str = Query(default="1y"),
    interval: str = Query(default="1d"),
):
    """
    Return OHLCV candles. Polygon for history, yfinance for live price patch on last candle.
    Intraday cache: 15s. Daily cache: 5min.
    """
    sym = symbol.strip().upper()
    is_intraday = interval in INTRADAY_INTERVALS

    if period == "1y" and interval != "1d":
        period = DEFAULT_PERIOD_FOR_INTERVAL.get(interval, "1mo")

    cache_key = (sym, period, interval)
    now = time.time()
    ttl = INTRADAY_CACHE_TTL if is_intraday else DAILY_CACHE_TTL

    if cache_key in _cache:
        cached_at, cached_candles = _cache[cache_key]
        if now - cached_at < ttl:
            snap = await _fetch_live_snapshot_price(sym)
            candles = list(cached_candles)
            if snap and candles:
                last = dict(candles[-1])
                last["close"] = snap["price"]
                if snap["high"] and snap["high"] > last["high"]: last["high"] = snap["high"]
                if snap["low"] and snap["low"] < last["low"]: last["low"] = snap["low"]
                candles[-1] = last
            return {
                "symbol": sym, "candles": candles,
                "live_price": snap["price"] if snap else None,
                "change_pct": snap.get("change_pct") if snap else None,
                "source": "cache",
            }

    from_date, to_date = _period_to_dates(period)
    candles = []; snap = None; source = "polygon"

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
        except Exception as e:
            logger.error(f"yfinance fallback failed for {sym}: {e}")
            raise HTTPException(status_code=502, detail=f"Data fetch failed for {sym}: {e}")

    if not candles:
        raise HTTPException(status_code=404, detail=f"No candle data found for {sym}")

    _cache[cache_key] = (now, candles)

    live_price = None; change_pct = None
    if snap:
        live_price = snap["price"]; change_pct = snap.get("change_pct")
        last = dict(candles[-1])
        last["close"] = snap["price"]
        if snap["high"] and snap["high"] > last["high"]: last["high"] = snap["high"]
        if snap["low"] and snap["low"] < last["low"]: last["low"] = snap["low"]
        candles = candles[:-1] + [last]

    return {
        "symbol": sym, "candles": candles,
        "live_price": live_price, "change_pct": change_pct, "source": source,
    }
