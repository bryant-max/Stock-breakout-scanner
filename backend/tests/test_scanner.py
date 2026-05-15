"""
Tests for the breakout scanner logic and scan API endpoints.
Uses mock data so no Polygon API key is needed.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ── Mock data / scan logic ─────────────────────────────────────────────────────

class TestMockScanResults:
    """Verify that mock_results returns plausible ScanResult objects."""

    async def test_get_mock_results_returns_list(self):
        from scan.mock_results import get_mock_results
        results = await get_mock_results()
        assert isinstance(results, list)
        assert len(results) > 0

    async def test_mock_result_fields(self):
        from scan.mock_results import get_mock_results
        results = await get_mock_results()
        r = results[0]
        assert hasattr(r, "symbol")
        assert hasattr(r, "price")
        assert hasattr(r, "trigger_price")
        assert hasattr(r, "breakout_score")
        assert hasattr(r, "distance_pct")
        assert hasattr(r, "setup_type")

    async def test_mock_result_scores_in_range(self):
        from scan.mock_results import get_mock_results
        results = await get_mock_results()
        for r in results:
            assert 0 <= r.breakout_score <= 100, f"{r.symbol} score out of range"

    async def test_mock_result_trigger_above_price(self):
        from scan.mock_results import get_mock_results
        results = await get_mock_results()
        for r in results:
            assert r.trigger_price >= r.price, (
                f"{r.symbol}: trigger {r.trigger_price} below price {r.price}"
            )

    async def test_mock_result_distance_pct_positive(self):
        from scan.mock_results import get_mock_results
        results = await get_mock_results()
        for r in results:
            assert r.distance_pct >= 0


# ── API: POST /api/scan/symbol ─────────────────────────────────────────────────

class TestScanSymbolEndpoint:

    async def test_scan_symbol_with_mock(self, client):
        """Scanning with use_mock=True should not call Polygon."""
        resp = await client.post(
            "/api/scan/symbol",
            json={"symbol": "AAPL", "use_mock": True},
        )
        # Either 200 (found) or 200 with empty results — no crash
        assert resp.status_code == 200

    async def test_scan_universe_with_mock(self, client):
        """Universe scan with use_mock=True returns results without Polygon calls."""
        resp = await client.post(
            "/api/scan/universe",
            json={"use_mock": True, "save_to_db": False},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data


# ── Technical indicator helpers ────────────────────────────────────────────────

class TestEMACalculation:
    """EMA uses Wilder smoothing: first value = values[0], no None warmup."""

    def test_ema_returns_correct_length(self):
        from indicators.ema import ema
        closes = [float(i) for i in range(1, 51)]
        result = ema(closes, period=21)
        assert len(result) == len(closes)

    def test_ema_non_empty(self):
        from indicators.ema import ema
        closes = [100.0] * 30
        result = ema(closes, period=21)
        assert len(result) == 30
        assert all(v is not None for v in result)

    def test_ema_constant_series(self):
        """EMA of a constant series should converge to that constant."""
        from indicators.ema import ema
        closes = [50.0] * 50
        result = ema(closes, period=21)
        # After the warmup the values should be very close to 50
        for val in result[20:]:
            assert abs(val - 50.0) < 0.01

    def test_ema_empty_input(self):
        from indicators.ema import ema
        assert ema([], period=21) == []


def _make_candles(data: list[tuple]) -> list:
    """Build Candle objects the proper Pydantic way."""
    from models.candle import Candle
    return [
        Candle(t=i, o=c, h=h, l=l, c=c, v=1_000_000)
        for i, (h, l, c) in enumerate(data)
    ]


class TestATRCalculation:

    def test_atr_returns_list_of_correct_length(self):
        from indicators.atr import atr
        data = [(105.0, 100.0, 102.0), (104.0, 99.0, 101.0),
                (106.0, 101.0, 103.0), (103.0, 98.0, 100.0),
                (107.0, 102.0, 104.0)] * 6
        candles = _make_candles(data)
        result = atr(candles, period=14)
        assert len(result) == len(candles)

    def test_atr_values_positive(self):
        from indicators.atr import atr
        data = [(105.0, 100.0, 102.0), (104.0, 99.0, 101.0),
                (106.0, 101.0, 103.0), (103.0, 98.0, 100.0),
                (107.0, 102.0, 104.0)] * 6
        candles = _make_candles(data)
        result = atr(candles, period=14)
        assert all(v > 0 for v in result)


class TestADRCalculation:

    def test_adr_returns_percentage(self):
        from indicators.adr import adr_pct
        data = [(105.0, 100.0, 102.0)] * 30
        candles = _make_candles(data)
        result = adr_pct(candles, period=14)
        assert isinstance(result, float)
        assert result > 0


# ── Breakout score ─────────────────────────────────────────────────────────────

class TestBreakoutScore:

    def _params(self, **overrides):
        base = {
            "tight_base": True,
            "atr_down": True,
            "higher_lows": True,
            "flat_top_touches": 3,
            "volume_ok": True,
            "range_pct": 5.0,
            "distance_pct": 1.5,
        }
        base.update(overrides)
        return base

    def test_score_in_range(self):
        """score_breakout result must always be 0–100."""
        from scoring.breakout_score import score_breakout
        result = score_breakout(self._params())
        assert 0 <= result["score"] <= 100

    def test_tight_base_adds_points(self):
        """A tight base should outscore a wide base."""
        from scoring.breakout_score import score_breakout
        tight = score_breakout(self._params(tight_base=True))
        wide  = score_breakout(self._params(tight_base=False, range_pct=30.0))
        assert tight["score"] >= wide["score"]

    def test_high_distance_lowers_score(self):
        """Setup far from trigger should score lower than one near it."""
        from scoring.breakout_score import score_breakout
        near = score_breakout(self._params(distance_pct=0.5))
        far  = score_breakout(self._params(distance_pct=10.0))
        assert near["score"] >= far["score"]

    def test_result_has_notes(self):
        """score_breakout must return a dict with 'score' and 'notes'."""
        from scoring.breakout_score import score_breakout
        result = score_breakout(self._params())
        assert "score" in result
        assert "notes" in result
        assert isinstance(result["notes"], list)
