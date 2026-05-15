"""
Tests for SnapTrade routes: /api/snaptrade/*
Covers registration, connect URL, status check, order placement, and disconnect.
All external SnapTrade SDK calls are mocked.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import FAKE_USER


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_service_mock(**overrides):
    """Return a MagicMock SnapTradeService with sensible defaults."""
    svc = MagicMock()
    svc.register_user = AsyncMock(return_value={"userId": FAKE_USER["user_id"], "userSecret": "secret-abc"})
    svc.get_login_redirect_url = AsyncMock(return_value={"redirectURI": "https://snaptrade.com/connect"})
    svc.list_accounts = AsyncMock(return_value=[{"id": "acc-1", "name": "Test Broker"}])
    svc.get_account_balances = AsyncMock(return_value=[{"currency": "USD", "cash": 10000}])
    svc.get_holdings = AsyncMock(return_value={"positions": []})
    svc.place_order = AsyncMock(return_value={"orderId": "order-xyz", "status": "ACCEPTED"})
    svc.get_order_impact = AsyncMock(return_value={"estimatedCommissions": 0, "netAmount": -500})
    svc.get_activities = AsyncMock(return_value=[])
    svc.search_symbols = AsyncMock(return_value=[{"symbol": "AAPL", "id": "sym-1"}])
    svc.delete_user = AsyncMock(return_value={"status": "deleted"})
    for k, v in overrides.items():
        setattr(svc, k, v)
    return svc


def _patch_service(svc):
    """Context-manager: replace SnapTradeService() constructor with our mock."""
    return patch("api.snaptrade_routes.get_snaptrade_service", return_value=svc)


def _patch_supabase(rows=None, secret="secret-abc"):
    """Mock Supabase calls inside snaptrade_routes."""
    mock_sb = MagicMock()
    chain = MagicMock()
    chain.execute = AsyncMock(return_value=rows if rows is not None else [{"user_secret": secret}])
    for method in ("select", "eq", "insert", "update", "delete"):
        setattr(chain, method, MagicMock(return_value=chain))
    mock_sb.table = MagicMock(return_value=chain)
    return patch("api.snaptrade_routes.supabase", mock_sb)


# ── /register ──────────────────────────────────────────────────────────────────

class TestSnapTradeRegister:

    async def test_register_new_user(self, client):
        """Registering a brand-new user persists their user_secret."""
        svc = _make_service_mock()

        mock_sb = MagicMock()
        chain = MagicMock()
        # First call: select returns [] (user not yet in DB)
        # Second call: insert succeeds
        chain.execute = AsyncMock(side_effect=[[], [{"id": 1}]])
        for method in ("select", "eq", "insert", "update"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with _patch_service(svc), patch("api.snaptrade_routes.supabase", mock_sb):
            resp = await client.post("/api/snaptrade/register")

        assert resp.status_code == 200
        assert resp.json()["status"] == "registered"

    async def test_register_existing_user(self, client):
        """Re-registering a user updates their stored secret."""
        svc = _make_service_mock()

        mock_sb = MagicMock()
        chain = MagicMock()
        # First call: select returns existing row
        chain.execute = AsyncMock(side_effect=[[{"id": 99}], [{"id": 99}]])
        for method in ("select", "eq", "insert", "update"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with _patch_service(svc), patch("api.snaptrade_routes.supabase", mock_sb):
            resp = await client.post("/api/snaptrade/register")

        assert resp.status_code == 200


# ── /connect ───────────────────────────────────────────────────────────────────

class TestSnapTradeConnect:

    async def test_connect_returns_redirect_url(self, client):
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase():
            resp = await client.get("/api/snaptrade/connect")

        assert resp.status_code == 200
        assert "redirect_url" in resp.json()
        assert "snaptrade.com" in resp.json()["redirect_url"]

    async def test_connect_no_secret_raises_404(self, client):
        """If user_secret is not in DB, 404 is returned."""
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase(rows=[]):
            resp = await client.get("/api/snaptrade/connect")

        assert resp.status_code == 404


# ── /status ────────────────────────────────────────────────────────────────────

class TestSnapTradeStatus:

    async def test_status_registered_with_accounts(self, client):
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase():
            resp = await client.get("/api/snaptrade/status")

        data = resp.json()
        assert data["registered"] is True
        assert data["accounts_linked"] == 1

    async def test_status_not_registered(self, client):
        """No user_secret → registered=False, no error."""
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase(rows=[]):
            resp = await client.get("/api/snaptrade/status")

        assert resp.status_code == 200
        assert resp.json()["registered"] is False


# ── /accounts ──────────────────────────────────────────────────────────────────

class TestSnapTradeAccounts:

    async def test_list_accounts(self, client):
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase():
            resp = await client.get("/api/snaptrade/accounts")

        assert resp.status_code == 200
        assert len(resp.json()["accounts"]) == 1


# ── /order/place ───────────────────────────────────────────────────────────────

class TestSnapTradeOrderPlace:

    VALID_ORDER = {
        "account_id": "acc-1",
        "symbol": "sym-aapl-id",
        "action": "BUY",
        "order_type": "Market",
        "quantity": 5,
    }

    async def test_place_market_order(self, client):
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase():
            resp = await client.post("/api/snaptrade/order/place", json=self.VALID_ORDER)

        assert resp.status_code == 200
        assert resp.json()["order"]["orderId"] == "order-xyz"

    async def test_place_order_invalid_quantity(self, client):
        """quantity=0 must be rejected before hitting SnapTrade."""
        bad = {**self.VALID_ORDER, "quantity": 0}
        resp = await client.post("/api/snaptrade/order/place", json=bad)
        assert resp.status_code == 422

    async def test_place_order_invalid_action(self, client):
        bad = {**self.VALID_ORDER, "action": "HOLD"}
        resp = await client.post("/api/snaptrade/order/place", json=bad)
        assert resp.status_code == 422

    async def test_place_limit_order_requires_price(self, client):
        """Limit orders with no price are still accepted by the route (Pydantic allows None price),
        but the service would reject. Here we verify the route passes through."""
        limit_order = {**self.VALID_ORDER, "order_type": "Limit", "price": 175.50}
        svc = _make_service_mock()
        with _patch_service(svc), _patch_supabase():
            resp = await client.post("/api/snaptrade/order/place", json=limit_order)
        assert resp.status_code == 200


# ── /disconnect ────────────────────────────────────────────────────────────────

class TestSnapTradeDisconnect:

    async def test_disconnect_removes_record(self, client):
        svc = _make_service_mock()
        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=[])
        for method in ("delete", "eq"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with _patch_service(svc), patch("api.snaptrade_routes.supabase", mock_sb):
            resp = await client.post("/api/snaptrade/disconnect")

        assert resp.status_code == 200
        assert resp.json()["status"] == "disconnected"

    async def test_disconnect_tolerates_snaptrade_failure(self, client):
        """Even if SnapTrade delete_user raises, we still clean up locally and return 200."""
        svc = _make_service_mock()
        svc.delete_user = AsyncMock(side_effect=Exception("SnapTrade unavailable"))

        mock_sb = MagicMock()
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=[])
        for method in ("delete", "eq"):
            setattr(chain, method, MagicMock(return_value=chain))
        mock_sb.table = MagicMock(return_value=chain)

        with _patch_service(svc), patch("api.snaptrade_routes.supabase", mock_sb):
            resp = await client.post("/api/snaptrade/disconnect")

        assert resp.status_code == 200
        assert resp.json()["status"] == "disconnected"
