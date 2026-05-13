"""
Tests for GET /api/options/chain/{symbol} and POST /api/options/paper-trade.
Uses httpx AsyncClient + mocked Polygon HTTP calls + mocked Supabase.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import FAKE_OPTIONS_RESPONSE, FAKE_USER


# ── /options/chain/{symbol} ────────────────────────────────────────────────────

class TestOptionsChain:

    async def test_chain_returns_calls_and_puts(self, client):
        """Happy path: Polygon returns two contracts → split into calls/puts."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = FAKE_OPTIONS_RESPONSE

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            resp = await client.get("/api/options/chain/AAPL")

        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "AAPL"
        assert len(data["calls"]) == 1
        assert len(data["puts"]) == 1
        assert data["calls"][0]["contract_type"] == "call"
        assert data["puts"][0]["contract_type"] == "put"
        assert "expirations" in data
        assert "2024-01-19" in data["expirations"]

    async def test_chain_fields_are_present(self, client):
        """Each contract row must expose the columns the frontend table needs."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = FAKE_OPTIONS_RESPONSE

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            resp = await client.get("/api/options/chain/AAPL")

        contract = resp.json()["calls"][0]
        for field in ("ticker", "contract_type", "strike", "expiration",
                      "bid", "ask", "last", "volume", "open_interest", "iv",
                      "delta", "gamma", "theta"):
            assert field in contract, f"Missing field: {field}"

    async def test_chain_polygon_paid_plan_returns_402(self, client):
        """When Polygon returns 403 (plan gate) the API should return 402."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = "forbidden"

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            resp = await client.get("/api/options/chain/AAPL")

        assert resp.status_code == 402

    async def test_chain_polygon_error_returns_502(self, client):
        """Any non-200/403 from Polygon should be surfaced as 502."""
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "internal error"

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            resp = await client.get("/api/options/chain/AAPL")

        assert resp.status_code == 502

    async def test_chain_filters_by_contract_type(self, client):
        """?contract_type=call should be forwarded to Polygon params."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"results": [FAKE_OPTIONS_RESPONSE["results"][0]]}

        captured_params = {}

        async def fake_get(url, params=None):
            captured_params.update(params or {})
            return mock_resp

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = fake_get
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            await client.get("/api/options/chain/AAPL?contract_type=call")

        assert captured_params.get("contract_type") == "call"

    async def test_chain_empty_results(self, client):
        """When Polygon returns no contracts the response is valid with empty lists."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"results": []}

        with patch("api.options_routes.httpx.AsyncClient") as mock_client_cls:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            resp = await client.get("/api/options/chain/AAPL")

        assert resp.status_code == 200
        data = resp.json()
        assert data["calls"] == []
        assert data["puts"] == []
        assert data["total"] == 0


# ── /options/paper-trade ───────────────────────────────────────────────────────

VALID_PAPER_TRADE = {
    "symbol": "AAPL",
    "contract_ticker": "O:AAPL240119C00150000",
    "contract_type": "call",
    "strike_price": 150.0,
    "expiration_date": "2024-01-19",
    "action": "buy",
    "quantity": 2,
    "price_per_contract": 5.50,
    "notes": "test trade",
}


class TestPaperTrade:

    async def test_create_paper_trade_success(self, client):
        """Valid body → 201, premium_paid computed correctly."""
        inserted_row = {
            **VALID_PAPER_TRADE,
            "id": "fake-uuid",
            "user_id": FAKE_USER["user_id"],
            "premium_paid": 1100.0,
            "status": "open",
        }

        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=[inserted_row])
        chain.insert = MagicMock(return_value=chain)
        mock_sb.table = MagicMock(return_value=chain)

        with patch("services.supabase_client.supabase", mock_sb):
            resp = await client.post("/api/options/paper-trade", json=VALID_PAPER_TRADE)

        assert resp.status_code == 201
        data = resp.json()
        assert data["premium_paid"] == 1100.0   # 5.50 × 2 × 100
        assert data["symbol"] == "AAPL"

    async def test_create_paper_trade_invalid_quantity(self, client):
        """quantity=0 must be rejected with 422."""
        bad = {**VALID_PAPER_TRADE, "quantity": 0}
        resp = await client.post("/api/options/paper-trade", json=bad)
        assert resp.status_code == 422

    async def test_create_paper_trade_invalid_price(self, client):
        """price_per_contract <= 0 must be rejected with 422."""
        bad = {**VALID_PAPER_TRADE, "price_per_contract": -1.0}
        resp = await client.post("/api/options/paper-trade", json=bad)
        assert resp.status_code == 422

    async def test_create_paper_trade_invalid_contract_type(self, client):
        """contract_type must be 'call' or 'put'."""
        bad = {**VALID_PAPER_TRADE, "contract_type": "straddle"}
        resp = await client.post("/api/options/paper-trade", json=bad)
        assert resp.status_code == 422

    async def test_create_paper_trade_invalid_action(self, client):
        """action must be 'buy' or 'sell'."""
        bad = {**VALID_PAPER_TRADE, "action": "hold"}
        resp = await client.post("/api/options/paper-trade", json=bad)
        assert resp.status_code == 422

    async def test_premium_calculation(self, client):
        """premium_paid = price_per_contract × quantity × 100."""
        body = {**VALID_PAPER_TRADE, "quantity": 3, "price_per_contract": 2.50}
        expected_premium = 2.50 * 3 * 100  # 750.0

        inserted_row = {
            **body,
            "id": "fake-uuid",
            "user_id": FAKE_USER["user_id"],
            "premium_paid": expected_premium,
            "status": "open",
        }

        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=[inserted_row])
        chain.insert = MagicMock(return_value=chain)
        mock_sb.table = MagicMock(return_value=chain)

        with patch("services.supabase_client.supabase", mock_sb):
            resp = await client.post("/api/options/paper-trade", json=body)

        assert resp.status_code == 201
        assert resp.json()["premium_paid"] == expected_premium


# ── /options/paper-trades (GET) ───────────────────────────────────────────────

class TestListPaperTrades:

    async def test_list_returns_trades(self, client):
        """GET /paper-trades returns the user's trade history."""
        fake_trades = [
            {**VALID_PAPER_TRADE, "id": "t1", "premium_paid": 550.0, "status": "open"},
            {**VALID_PAPER_TRADE, "id": "t2", "premium_paid": 275.0, "status": "open"},
        ]

        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=fake_trades)
        for method in ("select", "eq", "order", "limit"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with patch("services.supabase_client.supabase", mock_sb):
            resp = await client.get("/api/options/paper-trades")

        assert resp.status_code == 200
        assert len(resp.json()["trades"]) == 2

    async def test_list_empty(self, client):
        """Empty trade history returns an empty list, not an error."""
        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=[])
        for method in ("select", "eq", "order", "limit"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with patch("services.supabase_client.supabase", mock_sb):
            resp = await client.get("/api/options/paper-trades")

        assert resp.status_code == 200
        assert resp.json()["trades"] == []
