"""
Paper Trading API -- simulated trading with virtual money.
Stores virtual portfolios, positions, and order history in Supabase.
Prices are fetched live from Polygon so P&L is realistic.
"""
from fastapi import APIRouter, HTTPException, Security, Request
from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime, timezone
import httpx
import logging

from middleware.auth import get_current_user
from middleware.rate_limit import limiter
from services.supabase_client import supabase
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

PAPER_ACCOUNT_START_BALANCE = 100_000.0
POLYGON_BASE = "https://api.polygon.io"


# -- Models
class PaperOrderRequest(BaseModel):
    symbol: str
    asset_type: Literal["stock", "option"] = "stock"
    option_symbol: Optional[str] = None
    action: Literal["BUY", "SELL"]
    order_type: Literal["Market", "Limit"] = "Market"
    quantity: float
    limit_price: Optional[float] = None

    @field_validator("symbol")
    @classmethod
    def upper_symbol(cls, v): return v.strip().upper()

    @field_validator("quantity")
    @classmethod
    def positive_qty(cls, v):
        if v <= 0: raise ValueError("Quantity must be positive")
        return v

class PaperResetRequest(BaseModel):
    starting_balance: Optional[float] = PAPER_ACCOUNT_START_BALANCE


# -- Helpers
async def _get_live_price(symbol: str, asset_type: str = "stock", option_symbol: str = "") -> float:
    if not settings.POLYGON_API_KEY:
        raise HTTPException(status_code=501, detail="Polygon not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        if asset_type == "option" and option_symbol:
            url = f"{POLYGON_BASE}/v3/snapshot/options/{option_symbol}"
            r = await client.get(url, params={"apiKey": settings.POLYGON_API_KEY})
            data = r.json()
            results = data.get("results", {})
            price = results.get("day", {}).get("close") or results.get("last_quote", {}).get("ask") or 0
        else:
            url = f"{POLYGON_BASE}/v2/aggs/ticker/{symbol}/prev"
            r = await client.get(url, params={"apiKey": settings.POLYGON_API_KEY})
            data = r.json()
            results = data.get("results", [{}])
            price = results[0].get("c", 0) if results else 0
    if not price:
        raise HTTPException(status_code=422, detail=f"Could not fetch live price for {symbol}")
    return float(price)

async def _ensure_paper_account(user_id: str) -> dict:
    rows = await supabase.table("paper_accounts").select("*").eq("user_id", user_id).execute()
    if rows: return rows[0]
    new_account = {
        "user_id": user_id,
        "balance": PAPER_ACCOUNT_START_BALANCE,
        "starting_balance": PAPER_ACCOUNT_START_BALANCE,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await supabase.table("paper_accounts").insert([new_account]).execute()
    return result[0] if result else new_account


# -- Routes
@router.get("/account")
async def get_paper_account(request: Request, user: dict = Security(get_current_user, scopes=[]),):
    user_id = user["user_id"]
    account = await _ensure_paper_account(user_id)
    positions = await supabase.table("paper_positions").select("*").eq("user_id", user_id).eq("is_open", True).execute()
    total_pnl = sum(float(p.get("unrealized_pnl", 0)) for p in (positions or []))
    return {"account": account, "open_positions": len(positions or []), "total_unrealized_pnl": total_pnl, "equity": float(account["balance"]) + total_pnl}

@router.post("/order")
@limiter.limit("20/minute")
async def place_paper_order(body: PaperOrderRequest, request: Request, user: dict = Security(get_current_user, scopes=[]),):
    user_id = user["user_id"]
    account = await _ensure_paper_account(user_id)
    fill_price = body.limit_price if body.order_type == "Limit" and body.limit_price else await _get_live_price(body.symbol, body.asset_type, body.option_symbol or "")
    multiplier = 100 if body.asset_type == "option" else 1
    total_cost = fill_price * body.quantity * multiplier
    balance = float(account["balance"])
    now = datetime.now(timezone.utc).isoformat()
    ticker = body.option_symbol if body.asset_type == "option" else body.symbol
    new_balance = balance

    if body.action == "BUY":
        if total_cost > balance: raise HTTPException(status_code=400, detail=f"Insufficient paper balance. Need ${total_cost:,.2f}, have ${balance:,.2f}")
        new_balance = balance - total_cost
        await supabase.table("paper_accounts").update({"balance": new_balance, "updated_at": now}).eq("user_id", user_id).execute()
        existing = await supabase.table("paper_positions").select("*").eq("user_id", user_id).eq("ticker", ticker).eq("is_open", True).execute()
        if existing:
            pos = existing[0]
            old_qty, old_avg = float(pos["quantity"]), float(pos["avg_price"])
            new_qty = old_qty + body.quantity
            new_avg = ((old_avg * old_qty) + (fill_price * body.quantity)) / new_qty
            await supabase.table("paper_positions").update({"quantity": new_qty, "avg_price": new_avg, "updated_at": now}).eq("id", pos["id"]).execute()
        else:
            await supabase.table("paper_positions").insert([{"user_id": user_id, "symbol": body.symbol, "ticker": ticker, "asset_type": body.asset_type, "quantity": body.quantity, "avg_price": fill_price, "current_price": fill_price, "unrealized_pnl": 0.0, "is_open": True, "opened_at": now, "updated_at": now}]).execute()
    else:
        existing = await supabase.table("paper_positions").select("*").eq("user_id", user_id).eq("ticker", ticker).eq("is_open", True).execute()
        if not existing: raise HTTPException(status_code=404, detail=f"No open position in {ticker}")
        pos = existing[0]
        hold_qty = float(pos["quantity"])
        if body.quantity > hold_qty: raise HTTPException(status_code=400, detail=f"Cannot sell {body.quantity}; only holding {hold_qty}")
        realized_pnl = (fill_price - float(pos["avg_price"])) * body.quantity * multiplier
        new_balance = balance + total_cost
        await supabase.table("paper_accounts").update({"balance": new_balance, "updated_at": now}).eq("user_id", user_id).execute()
        remaining = hold_qty - body.quantity
        if remaining <= 0:
            await supabase.table("paper_positions").update({"is_open": False, "quantity": 0, "realized_pnl": float(pos.get("realized_pnl", 0)) + realized_pnl, "closed_at": now, "updated_at": now}).eq("id", pos["id"]).execute()
        else:
            await supabase.table("paper_positions").update({"quantity": remaining, "realized_pnl": float(pos.get("realized_pnl", 0)) + realized_pnl, "updated_at": now}).eq("id", pos["id"]).execute()

    await supabase.table("paper_orders").insert([{"user_id": user_id, "symbol": body.symbol, "ticker": ticker, "asset_type": body.asset_type, "action": body.action, "order_type": body.order_type, "quantity": body.quantity, "fill_price": fill_price, "total_value": total_cost, "executed_at": now}]).execute()
    return {"status": "filled", "action": body.action, "symbol": ticker, "quantity": body.quantity, "fill_price": fill_price, "total_value": total_cost, "new_balance": new_balance}

@router.get("/positions")
async def get_paper_positions(request: Request, user: dict = Security(get_current_user, scopes=[]), include_closed: bool = False,):
    user_id = user["user_id"]
    query = supabase.table("paper_positions").select("*").eq("user_id", user_id)
    if not include_closed: query = query.eq("is_open", True)
    positions = await query.order("opened_at", desc=True).execute()
    updated = []
    for pos in (positions or []):
        if pos.get("is_open"):
            try:
                live = await _get_live_price(pos["symbol"], pos.get("asset_type", "stock"), pos.get("ticker", ""))
                multiplier = 100 if pos.get("asset_type") == "option" else 1
                upnl = (live - float(pos["avg_price"])) * float(pos["quantity"]) * multiplier
                pos["current_price"] = live
                pos["unrealized_pnl"] = round(upnl, 2)
                await supabase.table("paper_positions").update({"current_price": live, "unrealized_pnl": round(upnl, 2)}).eq("id", pos["id"]).execute()
            except Exception: pass
        updated.append(pos)
    return {"positions": updated}

@router.get("/orders")
async def get_paper_orders(request: Request, user: dict = Security(get_current_user, scopes=[]), limit: int = 50,):
    user_id = user["user_id"]
    orders = await supabase.table("paper_orders").select("*").eq("user_id", user_id).order("executed_at", desc=True).limit(min(limit, 200)).execute()
    return {"orders": orders or []}

@router.post("/reset")
@limiter.limit("3/minute")
async def reset_paper_account(body: PaperResetRequest, request: Request, user: dict = Security(get_current_user, scopes=[]),):
    user_id = user["user_id"]
    now = datetime.now(timezone.utc).isoformat()
    starting = min(body.starting_balance or PAPER_ACCOUNT_START_BALANCE, 10_000_000)
    await supabase.table("paper_positions").update({"is_open": False, "closed_at": now, "updated_at": now}).eq("user_id", user_id).eq("is_open", True).execute()
    rows = await supabase.table("paper_accounts").select("id").eq("user_id", user_id).execute()
    if rows: await supabase.table("paper_accounts").update({"balance": starting, "starting_balance": starting, "updated_at": now}).eq("user_id", user_id).execute()
    else: await supabase.table("paper_accounts").insert([{"user_id": user_id, "balance": starting, "starting_balance": starting, "created_at": now, "updated_at": now}]).execute()
    return {"status": "reset", "new_balance": starting}
