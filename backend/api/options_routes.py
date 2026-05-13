from fastapi import APIRouter, HTTPException, Request, Security, Depends
from pydantic import BaseModel
from typing import Optional, Literal
import httpx
import logging
from datetime import date, timedelta

from middleware.auth import get_current_user
from middleware.rate_limit import limiter
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

POLYGON_BASE = "https://api.polygon.io"


class OptionsOrderRequest(BaseModel):
    account_id: str
    symbol: str
    option_symbol: str
    action: Literal["BUY", "SELL"]
    order_type: Literal["Market", "Limit"]
    quantity: int
    limit_price: Optional[float] = None


async def polygon_get(path: str, params: dict = None) -> dict:
    url = f"{POLYGON_BASE}{path}"
    p = {"apiKey": settings.POLYGON_API_KEY, **(params or {})}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=p)
        if r.status_code == 404:
            return {"results": []}
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


@router.get("/options/expiries/{symbol}")
@limiter.limit("30/minute")
async def get_option_expiries(symbol: str, request: Request):
    try:
        today = date.today().isoformat()
        data = await polygon_get(
            "/v3/reference/options/contracts",
            {
                "underlying_ticker": symbol.upper(),
                "expiration_date.gte": today,
                "limit": 250,
                "sort": "expiration_date",
                "order": "asc",
            },
        )
        results = data.get("results", [])
        expiries = sorted(set(r["expiration_date"] for r in results if "expiration_date" in r))
        return {"symbol": symbol.upper(), "expiration_dates": expiries}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching expiries for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/options/chain/{symbol}")
@limiter.limit("30/minute")
async def get_options_chain(
    symbol: str,
    request: Request,
    expiration_date: Optional[str] = None,
    user: dict = Security(get_current_user, scopes=[]),
):
    try:
        exp = expiration_date or (date.today() + timedelta(days=30)).strftime("%Y-%m-%d")
        data = await polygon_get(
            "/v3/reference/options/contracts",
            {
                "underlying_ticker": symbol.upper(),
                "expiration_date": exp,
                "limit": 250,
                "sort": "strike_price",
                "order": "asc",
            },
        )
        results = data.get("results", [])
        calls, puts = [], []
        for r in results:
            contract_type = r.get("contract_type", "").lower()
            row = {
                "ticker": r.get("ticker", ""),
                "strike": r.get("strike_price"),
                "expiry": r.get("expiration_date", exp),
                "bid": r.get("day", {}).get("open", 0),
                "ask": r.get("day", {}).get("close", 0),
                "mid": None,
                "iv": r.get("implied_volatility"),
                "delta": r.get("greeks", {}).get("delta") if r.get("greeks") else None,
                "gamma": r.get("greeks", {}).get("gamma") if r.get("greeks") else None,
                "theta": r.get("greeks", {}).get("theta") if r.get("greeks") else None,
                "vega": r.get("greeks", {}).get("vega") if r.get("greeks") else None,
                "open_interest": r.get("open_interest", 0),
                "volume": r.get("day", {}).get("volume", 0),
            }
            if row["bid"] is not None and row["ask"] is not None:
                row["mid"] = round((row["bid"] + row["ask"]) / 2, 4)
            if contract_type == "call":
                calls.append(row)
            elif contract_type == "put":
                puts.append(row)
        return {
            "symbol": symbol.upper(),
            "expiration_date": exp,
            "calls": calls,
            "puts": puts,
            "total": len(calls) + len(puts),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching options chain for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/options/contract/{option_ticker:path}")
@limiter.limit("30/minute")
async def get_option_contract(
    option_ticker: str,
    request: Request,
    user: dict = Security(get_current_user, scopes=[]),
):
    try:
        data = await polygon_get(f"/v3/reference/options/contracts/{option_ticker}")
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching contract {option_ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/options/order")
@limiter.limit("10/minute")
async def place_options_order(
    order: OptionsOrderRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    try:
        from services.snaptrade_service import snaptrade
        result = await snaptrade.place_order(
            user_id=current_user["id"],
            account_id=order.account_id,
            symbol=order.option_symbol,
            action=order.action,
            order_type=order.order_type,
            quantity=order.quantity,
            limit_price=order.limit_price,
        )
        return {"order": result, "status": "submitted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error placing options order: {e}")
        raise HTTPException(status_code=500, detail=str(e))
