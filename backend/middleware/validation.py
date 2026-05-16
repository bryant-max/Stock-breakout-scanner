"""
Reusable input validation helpers for API routes.
Raises HTTPException(422) on invalid input so FastAPI handles the error response.
"""
import re
from fastapi import HTTPException, status

TICKER_RE = re.compile(r'^[A-Z]{1,5}$')


def validate_ticker(symbol: str) -> str:
    s = symbol.strip().upper()
    if not TICKER_RE.match(s):
        raise HTTPException(status_code=422, detail=f"Invalid ticker symbol: {symbol!r}")
    return s


def validate_expiry(expiry: str) -> str:
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', expiry):
        raise HTTPException(status_code=422, detail=f"Invalid expiry date format (expected YYYY-MM-DD): {expiry!r}")
    return expiry


def validate_quantity(qty: int) -> int:
    if qty < 1 or qty > 10_000:
        raise HTTPException(status_code=422, detail=f"Quantity must be 1–10,000, got {qty}")
    return qty


def validate_price(price: float) -> float:
    if price <= 0 or price > 1_000_000:
        raise HTTPException(status_code=422, detail=f"Price must be > 0 and ≤ 1,000,000, got {price}")
    return round(price, 2)


def validate_account_id(account_id: str) -> str:
    s = account_id.strip()
    if not s or len(s) > 200:
        raise HTTPException(status_code=422, detail="Invalid account_id")
    return s
