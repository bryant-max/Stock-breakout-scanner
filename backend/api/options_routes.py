"""
Options chain API routes — powered by Polygon.io.
Provides live options chain data (calls + puts, Greeks, OI, volume, bid/ask)
for any scanned or watchlisted stock, plus SnapTrade order routing for options.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Security
from pydantic import BaseModel
from typing import Optional, Literal
import httpx
import asyncio
import logging
from datetime import datetime, date, timedelta

from middleware.auth import get_current_user
from middleware.rate_limit import limiter
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

POLYGON_BASE = "https://api.polygon.io"


# ── Models ────────────────────────────────────────────────────────────

class OptionsOrderRequest(BaseModel):
    account_id: str
    symbol: str          # e.g. "AAPL"
    option_symbol: str   # OCC symbol e.g. "AAPL250620C00150000"
    action: Literal["BUY", "SELL"]
    order_type: Literal["Market", "Limit"]
    quantity: int        # number of contracts
    limit_price: Optional[float] = None


# ── Helpers ───────────────────────────────────────────────────────────

async def _polygon(path: str, params: dict | None = None) -> dict:
    """Make an authenticated Polygon.io request."""
    if not settings.POLYGON_API_KEY:
        raise HTTPException(status_code=501, detail="Polygon API key not configured")
    url = f"{POLYGON_BASE}{path}"
    p = {"apiKey": settings.POLYGON_API_KEY, **(params or {})}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=p)
        if resp.status_code == 404:
            return {"results": [], "status": "OK"}
        resp.raise_for_status()
        return resp.json()


def _next_expiries(n: int = 8) -> list[str]:
    """Return the next n monthly option expiry dates (3rd Friday of each month)."""
    expiries = []
    today = date.today()
    y, m = today.year, today.month
    for _ in range(n * 2):  # iterate months until we have enough
        # 3rd Friday
        first = date(y, m, 1)
        first_friday = first + timedelta(days=(4 - first.weekday()) % 7)
        third_friday = first_friday + timedelta(weeks=2)
        if third_friday >= today:
            expiries.append(third_friday.strftime("%Y-%m-%d"))
        m += 1
        if m > 12:
            m = 1
            y += 1
        if len(expiries) >= n:
            break
    return expiries


# ── Routes ────────────────────────────────────────────────────────────

@router.get("/chain/{symbol}")
@limiter.limit("30/minute")
async def get_options_chain(
    symbol: str,
    request: Request,
    expiration_date: Optional[str] = None,
    contract_type: Optional[Literal["call", "put"]] = None,
    strike_price_gte: Optional[float] = None,
    strike_price_lte: Optional[float] = None,
    user: dict = Security(get_current_user, scopes=[]),
):
    """
    Fetch a live options chain for a symbol from Polygon.io.
    Returns calls and puts with Greeks, OI, volume, bid/ask.
    """
    symbol = symbol.upper()
    params: dict = {
        "underlying_ticker": symbol,
        "limit": 250,
        "order": "asc",
        "sort": "strike_price",
    }
    if expiration_date:
        params["expiration_date"] = expiration_date
    else:
        # Default: nearest monthly expiry
        expiries = _next_expiries(1)
        if expiries:
            params["expiration_date"] = expiries[0]
    if contract_type:
        params["contract_type"] = contract_type
    if strike_price_gte:
        params["strike_price.gte"] = strike_price_gte
    if strike_price_lte:
        params["strike_price.lte"] = strike_price_lte

    data = await _polygon("/v3/snapshot/options/" + symbol, params)
    results = data.get("results", [])

    # Separate calls and puts
    calls = [r for r in results if r.get("details", {}).get("contract_type") == "call"]
    puts  = [r for r in results if r.get("details", {}).get("contract_type") == "put"]

    # Get underlying spot price
    spot_data = await _polygon(f"/v2/aggs/ticker/{symbol}/prev")
    spot = spot_data.get("results", [{}])[0].get("c") if spot_data.get("results") else None

    return {
        "symbol": symbol,
        "spot_price": spot,
        "expiration_date": params.get("expiration_date"),
        "calls": calls,
        "puts": puts,
        "total": len(results),
    }


@router.get("/expiries/{symbol}")
@limiter.limit("30/minute")
async def get_expiry_dates(
    symbol: str,
    request: Request,
    user: dict = Security(get_current_user, scopes=[]),
):
    """Return available option expiry dates for a symbol."""
    symbol = symbol.upper()
    params = {
        "underlying_ticker": symbol,
        "limit": 1,
        "order": "asc",
        "sort": "expiration_date",
    }
    # Fetch all unique expiry dates
    data = await _polygon("/v3/reference/options/contracts", {
        "underlying_ticker": symbol,
        "expired": "false",
        "limit": 1000,
    })
    contracts = data.get("results", [])
    expiries = sorted(set(c.get("expiration_date", "") for c in contracts if c.get("expiration_date")))
    return {"symbol": symbol, "expiration_dates": expiries[:40]}  # cap at 40


@router.get("/contract/{option_ticker}")
@limiter.limit("30/minute")
async def get_option_detail(
    option_ticker: str,
    request: Request,
    user: dict = Security(get_current_user, scopes=[]),
):
    """Get full snapshot for a single option contract (Greeks, IV, OI, etc.)."""
    data = await _polygon(f"/v3/snapshot/options/{option_ticker}")
    return data.get("results", data)


@router.post("/order")
@limiter.limit("10/minute")
async def place_options_order(
    body: OptionsOrderRequest,
    request: Request,
    user: dict = Security(get_current_user, scopes=[]),
):
    """
    Place an options order via SnapTrade.
    Routes through the SnapTrade brokerage connection for real money trades.
    """
    from services.snaptrade_service import SnapTradeService
    from services.supabase_client import supabase

    user_id = user["user_id"]

    # Fetch user_secret
    rows = await supabase.table("snaptrade_users").select("user_secret").eq("user_id", user_id).execute()
    if not rows:
        raise HTTPException(status_code=404, detail="SnapTrade account not linked.")
    user_secret = rows[0]["user_secret"]

    service = SnapTradeService()
    result = await service.place_order(
        user_id=user_id,
        user_secret=user_secret,
        account_id=body.account_id,
        symbol=body.option_symbol,
        action=body.action,
        order_type=body.order_type,
        quantity=body.quantity,
        price=body.limit_price,
    )
    return {"order": result, "status": "submitted"}
